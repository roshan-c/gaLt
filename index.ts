import { Client, GatewayIntentBits, Events, Message } from 'discord.js';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { MemoryManager } from './src/memory/MemoryManager';
import { ToolRegistry } from './src/tools/ToolRegistry';
import { EmbedResponse } from './src/utils/EmbedResponse';
import type { BotConfig, ConversationMessage, ToolResult } from './src/types/BotConfig';
import { calculatorTool, timeTool } from './src/tools/examples/ExampleTool';
import { weatherTool, randomFactTool } from './src/tools/examples/WeatherTool';
import { imageGenerationTool, createImageAttachment } from './src/tools/ImageGenerationTool';
import webSearchTool from './src/tools/WebSearchTool';
import summarizeContextTool from './src/tools/SummarizeContextTool';
import mcGetCodeTool from './src/tools/McApiGetCodeTool';
import { metrics } from './src/utils/Metrics';
import { getImageCostUSD, getOpenAiPerTokenCostsUSD } from './src/utils/Pricing';
import { startMetricsServer } from './src/metrics/DashboardServer';

// Load environment variables
const config: BotConfig = {
  discordToken: process.env.DISCORD_TOKEN!,
  googleApiKey: process.env.GOOGLE_API_KEY!,
  googleModel: process.env.GOOGLE_MODEL || 'gemini-2.0-flash',
};

// Validate environment variables
if (!config.discordToken) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}
if (!config.googleApiKey) {
  throw new Error('GOOGLE_API_KEY environment variable is required');
}
// OpenAI key is still required elsewhere (embeddings, image generation)
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required for embeddings and image generation');
}

// Initialize Discord client (singleton across hot reloads)
const g: any = globalThis as any;
let client: Client = g.__GA_LT_CLIENT as Client;
if (!client) {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  g.__GA_LT_CLIENT = client;
}

// Deduplicate message processing to prevent multiple executions per Discord message
const processedMessages: Map<string, number> = g.__GA_LT_PROCESSED_MESSAGES || new Map<string, number>();
g.__GA_LT_PROCESSED_MESSAGES = processedMessages;
const MESSAGE_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
function markAndCheckProcessed(messageId: string): boolean {
  const now = Date.now();
  // prune occasionally
  if (processedMessages.size > 1000) {
    for (const [id, ts] of processedMessages) {
      if (now - ts > MESSAGE_DEDUP_TTL_MS) processedMessages.delete(id);
    }
  }
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, now);
  // auto-expire entry to avoid unbounded growth
  setTimeout(() => processedMessages.delete(messageId), MESSAGE_DEDUP_TTL_MS).unref?.();
  return false;
}

// Token tracking callback
class TokenTracker extends BaseCallbackHandler {
  name = "TokenTracker";
  inputTokens = 0;
  outputTokens = 0;
  totalTokens = 0;

  reset() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.totalTokens = 0;
  }

  override async handleLLMEnd(output: any) {
    if (output.llmOutput?.tokenUsage) {
      const usage = output.llmOutput.tokenUsage;
      this.inputTokens += usage.promptTokens || 0;
      this.outputTokens += usage.completionTokens || 0;
      this.totalTokens += usage.totalTokens || 0;
    }
  }

  getUsage() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens
    };
  }
}

// Initialize primary (Gemini) and fallback (OpenAI) models
const geminiLlm = new ChatGoogleGenerativeAI({
  apiKey: config.googleApiKey,
  model: config.googleModel,
  temperature: 1,
});
const openaiLlm = new ChatOpenAI({
  model: 'gpt-5-mini',
  temperature: 1,
});

// Initialize memory manager
const memoryManager = new MemoryManager();
// Expose memory manager globally so tools can access conversation history
(g as any).__GA_LT_MEMORY_MANAGER = memoryManager;

// Initialize tool registry and register example tools
const toolRegistry = new ToolRegistry();
toolRegistry.registerTool(calculatorTool);
toolRegistry.registerTool(timeTool);
toolRegistry.registerTool(weatherTool);
toolRegistry.registerTool(randomFactTool);
toolRegistry.registerTool(imageGenerationTool);
  toolRegistry.registerTool(webSearchTool);
  toolRegistry.registerTool(summarizeContextTool);
  toolRegistry.registerTool(mcGetCodeTool);

// Circuit breaker state (global across hot reloads)
type CircuitState = {
  tripped: boolean;
  untilTs: number | null;
  testTimer?: ReturnType<typeof setTimeout>;
};
const cb: CircuitState = (g.__GA_LT_CIRCUIT as CircuitState) || { tripped: false, untilTs: null };
g.__GA_LT_CIRCUIT = cb;

const CB_ERROR_CODES = new Set([400, 403, 404, 429, 500, 503, 504]);

function getErrorStatusCode(error: any): number | undefined {
  // Try common places where status might live
  if (!error) return undefined;
  if (typeof error.status === 'number') return error.status;
  if (typeof error.code === 'number') return error.code;
  if (typeof error.code === 'string') {
    const maybe = Number(error.code);
    if (!Number.isNaN(maybe)) return maybe;
  }
  const resp = (error.response || error.res || error.error || {}) as any;
  if (typeof resp.status === 'number') return resp.status;
  return undefined;
}

function tripCircuitBreakerFor(durationMs: number) {
  cb.tripped = true;
  cb.untilTs = Date.now() + durationMs;
  if (cb.testTimer) {
    try { cb.testTimer && clearTimeout(cb.testTimer); } catch {}
  }
  cb.testTimer = setTimeout(async () => {
    try {
      // Minimal health probe to Gemini without tools
      await geminiLlm.invoke([new HumanMessage('ping')]);
      // Success: reset breaker
      cb.tripped = false;
      cb.untilTs = null;
      if (cb.testTimer) { try { clearTimeout(cb.testTimer); } catch {} }
      cb.testTimer = undefined;
      console.log('✅ Circuit breaker: Gemini healthy again. Switching back.');
    } catch (err) {
      const status = getErrorStatusCode(err);
      console.warn('⚠️ Circuit breaker test failed, status:', status);
      // Reschedule another test in 10 minutes
      tripCircuitBreakerFor(10 * 60 * 1000);
    }
  }, Math.max(1, durationMs));
  (cb.testTimer as any).unref?.();
  console.warn('🚨 Circuit breaker tripped: routing to OpenAI for', durationMs, 'ms');
}

function getActiveLlm() {
  if (cb.tripped) return openaiLlm;
  // If breaker has an expiry in the past, consider it recovered
  if (cb.untilTs && Date.now() > cb.untilTs) {
    cb.tripped = false;
    cb.untilTs = null;
  }
  return geminiLlm;
}

function getActiveModelName(): string {
  const llm = getActiveLlm();
  return llm === openaiLlm ? 'gpt-5-mini' : config.googleModel;
}

function getLlmWithTools() {
  return getActiveLlm().bindTools(toolRegistry.getToolDefinitions());
}

// Simple intent detection for summarization requests
function detectSummarizeIntent(text: string): { isSummarize: boolean; requestedMin?: number } {
  const lower = text.toLowerCase().trim();
  const phrases = [
    'summarize this channel',
    'summarise this channel',
    'summarize the channel',
    'summarise the channel',
    'what have i missed',
    'what did i miss',
    'catch me up',
    'give me a summary',
    'channel summary',
    'tldr',
    'tl;dr'
  ];
  if (phrases.some(p => lower.includes(p))) {
    const match = lower.match(/last\s+(\d{1,3})\s+messages?/);
    const requestedMin = match ? Math.max(1, Math.min(100, Number(match[1]))) : undefined;
    return { isSummarize: true, requestedMin };
  }
  return { isSummarize: false };
}

async function invokeWithCircuitBreaker(messages: any[], callbacks: any[]) {
  const usingGemini = getActiveLlm() === geminiLlm;
  try {
    metrics.recordRequest();
    return await getLlmWithTools().invoke(messages, { callbacks });
  } catch (error) {
    const status = getErrorStatusCode(error);
    if (usingGemini && status && CB_ERROR_CODES.has(status)) {
      // Trip for 10 minutes and retry once on OpenAI
      tripCircuitBreakerFor(10 * 60 * 1000);
      try {
        return await getLlmWithTools().invoke(messages, { callbacks });
      } catch (retryErr) {
        throw retryErr;
      }
    }
    throw error;
  }
}

// Load and prepare system prompt
import fs from 'fs';
import path from 'path';
const systemPromptPath = path.resolve(__dirname, 'SYSTEM.md');
let baseSystemPrompt = '';
try {
  baseSystemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');
} catch {
  baseSystemPrompt = 'You are gaLt, an AI assistant.';
}
function buildSystemMessage(): SystemMessage {
  const toolsList = toolRegistry.getAllTools().map(t => `- ${t.name}: ${t.description}`).join('\n');
  const rendered = baseSystemPrompt
    .replace(/\{\{MODEL_NAME\}\}/g, getActiveModelName())
    .replace(/\{\{DATETIME\}\}/g, new Date().toString())
    .replace(/\{\{TOOLS\}\}/g, toolsList);
  return new SystemMessage(rendered);
}

function stripSpeakerLabelHead(text: string): string {
  if (!text) return text as any;
  return text.replace(/^\s*(Aigis|Assistant|System|Bot)\s*[:\-—–]\s*/i, '');
}

function cleanAssistantContent(text: string): string {
  const stripped = stripSpeakerLabelHead(text);
  return typeof stripped === 'string' ? stripped.trim() : (text as any);
}

// Bot ready event
if (!g.__GA_LT_READY_LISTENER) {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`🚀 ${readyClient.user.tag} is online and ready!`);
    console.log(`📊 Registered ${toolRegistry.getToolCount()} tools`);
    console.log(`🎨 Image generation available via GPT-Image-1`);
    // Start metrics dashboard server (Bun only). Set METRICS_PORT to override.
    try { startMetricsServer(); } catch (err) { console.warn('Metrics dashboard failed to start:', err); }

    // Register a simple global slash command for chatting
    if (!g.__GA_LT_COMMANDS_REGISTERED) {
      const commands = [
        {
          name: 'chat',
          description: 'Ask the assistant (supports tools like image generation)',
          options: [
            {
              name: 'prompt',
              description: 'What would you like to say? (the bot may use tools)',
              type: 3, // STRING
              required: true,
            },
          ],
        },
      ];
      readyClient.application?.commands
        .set(commands)
        .then(() => console.log('📝 Slash commands registered'))
        .catch((err) => console.error('Failed to register slash commands:', err));
      g.__GA_LT_COMMANDS_REGISTERED = true;
    }
  });
  g.__GA_LT_READY_LISTENER = true;
}

// Message handling
if (!g.__GA_LT_MESSAGE_LISTENER) {
client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore messages from bots
  if (message.author.bot) return;
  // Dedup guard: skip if we've already processed this message ID
  if (markAndCheckProcessed(message.id)) return;
  
  // Only respond when bot is mentioned
  if (!message.mentions.has(client.user!)) return;
  
  // Prepare patience timer reference for long-running operations
  let patienceTimeout: ReturnType<typeof setTimeout> | undefined;
  let patienceFired = false;
  let patienceMessageRef: Message | undefined;
  
  try {
    // Clean the message content (remove the mention)
    const cleanContent = message.content
      .replace(`<@${client.user!.id}>`, '')
      .replace(`<@!${client.user!.id}>`, '')
      .trim();
    
    if (!cleanContent) {
      await EmbedResponse.sendInfo(
        message,
        '👋 Hello!',
        'How can I help you today?'
      );
      return;
    }
    
    // Show typing indicator
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }
    
    // Schedule a patience message if processing takes longer than 10 seconds
    patienceTimeout = setTimeout(async () => {
      patienceFired = true;
      patienceMessageRef = await EmbedResponse.sendPatienceReply(message);
    }, 7_000);
    (patienceTimeout as any).unref?.();
    
    // Get enhanced conversation history with RAG context
    const conversationHistory = await memoryManager.getEnhancedHistory(
      message.author.id,
      message.channel.id,
      cleanContent
    );
    
    // Add user message to history
    await memoryManager.addMessage(
      message.author.id,
      message.channel.id,
      'user',
      cleanContent
    );
    
    // Early intercept: if the user explicitly asked for a channel summary, run the summarize tool directly
    const intent = detectSummarizeIntent(cleanContent);
    if (intent.isSummarize) {
      try {
        const minMessages = intent.requestedMin ?? 15;
        const maxMessages = Math.max(minMessages, Math.min(50, minMessages * 2));
        const [toolResult] = await toolRegistry.executeTools([
          {
            name: 'summarize_context',
            args: {
              userId: message.author.id,
              channelId: message.channel.id,
              minMessages,
              maxMessages,
              useWeb: true,
              appendDateToWebQueries: true,
            },
          },
        ]);

        const data: any = toolResult?.result || {};
        const parts: string[] = [];
        if (data.summary) parts.push(`**Summary**\n${data.summary}`);
        if (Array.isArray(data.keyPoints) && data.keyPoints.length) {
          parts.push(`**Key points**\n- ${data.keyPoints.slice(0, 10).join('\n- ')}`);
        }
        if (Array.isArray(data.actionItems) && data.actionItems.length) {
          parts.push(`**Action items**\n- ${data.actionItems.slice(0, 10).join('\n- ')}`);
        }
        if (Array.isArray(data.openQuestions) && data.openQuestions.length) {
          parts.push(`**Open questions**\n- ${data.openQuestions.slice(0, 10).join('\n- ')}`);
        }
        if (Array.isArray(data.webResults) && data.webResults.length) {
          const srcs: string[] = [];
          for (const wr of data.webResults) {
            if (wr?.sources && wr.sources.length) {
              for (const s of wr.sources.slice(0, 3)) {
                srcs.push(`- ${s.title}: ${s.url}`);
              }
            }
          }
          if (srcs.length) parts.push(`**Sources**\n${srcs.join('\n')}`);
        }
        const content = parts.join('\n\n') || 'No summary available.';

        // Add assistant reply to memory
        await memoryManager.addMessage(
          message.author.id,
          message.channel.id,
          'assistant',
          content
        );

        // Clear patience timer before sending the final response
        if (patienceTimeout) clearTimeout(patienceTimeout);
        try { if (patienceMessageRef) await patienceMessageRef.delete(); } catch {}

        const toolsUsed = data.usedWebSearch ? ['summarize_context', 'web_search'] : ['summarize_context'];
        await EmbedResponse.sendLongResponse(message, content, {
          title: '🧾 Channel Summary',
          includeContext: true,
          toolsUsed,
        });
        return;
      } catch (summaryErr) {
        console.error('Summarize intent handling failed:', summaryErr);
        // Fall-through to normal LLM flow
      }
    }

    // Prepare messages for LangChain (conversationHistory already includes current context)
    const messages = [
      buildSystemMessage(),
      ...conversationHistory.map((msg: ConversationMessage) => 
        msg.role === 'user' 
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
      new HumanMessage(cleanContent)
    ];
    
    console.log(`🧠 Using ${conversationHistory.length} messages as context (recent + RAG)`);
    
    // Initialize token tracker for this request
    const tokenTracker = new TokenTracker();
    
    // Get response from LangChain with tools
    const response = await invokeWithCircuitBreaker(messages, [tokenTracker]);
    
    // Handle tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Track which tools were used
      const toolsUsed = response.tool_calls.map(toolCall => toolCall.name);
      console.log(`🔧 Tools used: ${toolsUsed.join(', ')}`);
      
      // Execute tools with single-image policy: only allow the first generate_image per message
      const toolResults: ToolResult[] = [];
      let imageToolUsed = false;
      for (const toolCall of response.tool_calls) {
        if (toolCall.name === 'generate_image') {
          if (imageToolUsed) {
            toolResults.push({
              success: true,
              result: {
                success: false,
                message: 'Image already generated for this message; ignoring duplicate request.',
              },
              message: new ToolMessage({
                content: 'Image already generated for this message; ignoring duplicate request.',
                tool_call_id: toolCall.id || '',
              }),
            });
            continue;
          }

          imageToolUsed = true;
        }
        // Inject default context for summarize_context if args are missing
        if (toolCall.name === 'summarize_context') {
          toolCall.args = {
            userId: toolCall.args?.userId || message.author.id,
            channelId: toolCall.args?.channelId || message.channel.id,
            minMessages: toolCall.args?.minMessages ?? 15,
            maxMessages: toolCall.args?.maxMessages ?? 50,
            useWeb: toolCall.args?.useWeb ?? true,
            appendDateToWebQueries: toolCall.args?.appendDateToWebQueries ?? true,
          };
        }
        const [result] = await toolRegistry.executeTools([toolCall]);
        metrics.recordToolCall(toolCall.name, !!result?.success);
        if (result) {
          toolResults.push(result);
        }
      }
      
      // Check for image generation results and create attachments
      const attachments: any[] = [];
      let imagePrompt: string | undefined;
      let imageFilename: string | undefined;
      let imageAlreadyAttached = false;
      
      // We need to directly check the tool calls since ToolRegistry converts results to JSON
      for (let i = 0; i < response.tool_calls.length; i++) {
        const toolCall = response.tool_calls[i];
        const result = toolResults[i];
        
        console.log(`🔍 Tool "${toolCall?.name}" result:`, {
          success: result?.success,
          hasResult: !!result?.result
        });
        
        if (!toolCall || !result) continue;
        
        // If this was an image generation tool, use the raw result from the first execution
        if (toolCall.name === 'generate_image' && result.success && !imageAlreadyAttached) {
          try {
            const rawResult: any = result.result;
            console.log('🔍 Raw image result:', {
              success: rawResult?.success,
              hasImageBuffer: !!rawResult?.imageBuffer,
              bufferSize: rawResult?.imageBuffer?.length
            });

            if (rawResult?.success && rawResult.imageBuffer) {
              const attachment = createImageAttachment(rawResult);
              if (attachment) {
                attachments.push(attachment);
                console.log('📎 Created image attachment successfully');
                imageAlreadyAttached = true;
              }
              // Estimate image cost via configurable pricing
              metrics.recordImageGeneration(getImageCostUSD('1024', 'low'));
              // Capture prompt and filename for embed formatting
              if (!imagePrompt) imagePrompt = rawResult.prompt;
              if (!imageFilename) imageFilename = rawResult.filename;
            }
          } catch (error) {
            console.error('📎 Failed to create image attachment:', error);
          }
        }
        // If image generation failed with moderation, surface a user-friendly message
        if (toolCall.name === 'generate_image' && !result.success) {
          const raw: any = result.result;
          if (raw?.moderationBlocked) {
            const friendly = '❌ Image request blocked by safety filters. Please adjust the prompt to avoid sensitive or disallowed content.';
            // Add to memory and send a concise notice inline before continuing
            try {
              await memoryManager.addMessage(
                message.author.id,
                message.channel.id,
                'assistant',
                friendly
              );
            } catch {}
            try {
              await EmbedResponse.sendLongResponse(message, friendly, {
                title: '⚠️ Moderation Notice',
                includeContext: true,
                toolsUsed: ['generate_image'],
              });
            } catch {}
          }
        }
      }
      
      console.log(`📎 Total attachments: ${attachments.length}`);
      
      // Add tool results to conversation and get final response
      const toolMessages = toolResults.map((result: ToolResult) => result.message);
      // Limit the amount of prior context to avoid huge token usage on the second call
      // IMPORTANT: ensure only one system message at the very beginning
      const recentContext = messages
        .filter((m: any) => !(m instanceof SystemMessage))
        .slice(-6);
      const finalResponse = await invokeWithCircuitBreaker([
        buildSystemMessage(),
        ...recentContext,
        response,
        ...toolMessages,
      ], [tokenTracker]);
      const cleanedFinal = cleanAssistantContent(finalResponse.content as string);
      
      // Add final response to memory
      await memoryManager.addMessage(
        message.author.id,
        message.channel.id,
        'assistant',
        cleanedFinal
      );
      
      // Get token usage stats
      const tokenUsage = tokenTracker.getUsage();
      // Add cost estimate: Gemini is free; OpenAI priced per your rule
      let tokenCost = 0;
      if (getActiveLlm() === openaiLlm) {
        const { inputPerToken, outputPerToken } = getOpenAiPerTokenCostsUSD();
        tokenCost = tokenUsage.inputTokens * inputPerToken + tokenUsage.outputTokens * outputPerToken;
      }
      try { metrics.recordTokens(tokenUsage.inputTokens, tokenUsage.outputTokens, tokenUsage.totalTokens, tokenCost); } catch {}
      try { metrics.recordTokens(tokenUsage.inputTokens, tokenUsage.outputTokens, tokenUsage.totalTokens); } catch {}
      console.log(`📊 Token usage: ${tokenUsage.inputTokens} input, ${tokenUsage.outputTokens} output, ${tokenUsage.totalTokens} total`);
      
      // Send response to Discord using embeds with tool indicators
      const responseContent = cleanedFinal;
      const stats = EmbedResponse.getResponseStats(responseContent);
      console.log(`📨 Sending response: ${stats.length} chars, ${stats.chunks} chunks, embeds: ${stats.willUseEmbeds}`);
      
      // Clear patience timer and delete patience message before sending the final response
      if (patienceTimeout) clearTimeout(patienceTimeout);
      try { if (patienceMessageRef) await patienceMessageRef.delete(); } catch {}
      
      await EmbedResponse.sendLongResponse(
        message,
        responseContent,
        {
          title: '🤖 Response',
          includeContext: true,
          toolsUsed: toolsUsed,
          tokenUsage: tokenUsage,
          attachments: attachments,
          imagePrompt: imagePrompt,
          imageFilename: imageFilename
        }
      );
    } else {
      // No tool calls, just respond with the content
      const responseContent = cleanAssistantContent(response.content as string);
      
      // Add response to memory
      await memoryManager.addMessage(
        message.author.id,
        message.channel.id,
        'assistant',
        responseContent
      );
      
      // Get token usage stats
      const tokenUsage = tokenTracker.getUsage();
      let tokenCost = 0;
      if (getActiveLlm() === openaiLlm) {
        const { inputPerToken, outputPerToken } = getOpenAiPerTokenCostsUSD();
        tokenCost = tokenUsage.inputTokens * inputPerToken + tokenUsage.outputTokens * outputPerToken;
      }
      try { metrics.recordTokens(tokenUsage.inputTokens, tokenUsage.outputTokens, tokenUsage.totalTokens, tokenCost); } catch {}
      try { metrics.recordTokens(tokenUsage.inputTokens, tokenUsage.outputTokens, tokenUsage.totalTokens); } catch {}
      console.log(`📊 Token usage: ${tokenUsage.inputTokens} input, ${tokenUsage.outputTokens} output, ${tokenUsage.totalTokens} total`);
      
      // Send response to Discord using embeds (no tools used)
      const stats = EmbedResponse.getResponseStats(responseContent);
      console.log(`📨 Sending response: ${stats.length} chars, ${stats.chunks} chunks, embeds: ${stats.willUseEmbeds}`);
      
      // Clear patience timer and delete patience message before sending the final response
      if (patienceTimeout) clearTimeout(patienceTimeout);
      try { if (patienceMessageRef) await patienceMessageRef.delete(); } catch {}
      
      await EmbedResponse.sendLongResponse(
        message,
        responseContent,
        {
          title: '🤖 Response',
          includeContext: true,
          tokenUsage: tokenUsage
        }
      );
    }
    
  } catch (error) {
    console.error('Error processing message:', error);
    // Clear patience timer and delete patience message before sending error response
    if (patienceTimeout) clearTimeout(patienceTimeout);
    try { if (patienceMessageRef) await patienceMessageRef.delete(); } catch {}
    await EmbedResponse.sendError(
      message,
      'Sorry, I encountered an error while processing your message. Please try again.'
    );
  }
});
g.__GA_LT_MESSAGE_LISTENER = true;
}

// Interaction (slash command) handling with true ephemeral notices
if (!g.__GA_LT_INTERACTION_LISTENER) {
  client.on(Events.InteractionCreate, async (interaction: any) => {
    try {
      if (!interaction.isChatInputCommand?.()) return;
      if (interaction.commandName !== 'chat') return;

      const cleanContent: string = interaction.options.getString('prompt', true);

      // Show typing in the channel (non-blocking)
      interaction.channel?.sendTyping?.();

      // Defer ephemeral reply so we can follow up with notices
      await interaction.deferReply({ ephemeral: true });

      // Enhanced history via memory manager
      const conversationHistory = await memoryManager.getEnhancedHistory(
        interaction.user.id,
        interaction.channelId,
        cleanContent
      );

      await memoryManager.addMessage(
        interaction.user.id,
        interaction.channelId,
        'user',
        cleanContent
      );

      // Early intercept for summarize intent in slash command text
      const intent = detectSummarizeIntent(cleanContent);
      if (intent.isSummarize) {
        try {
          const minMessages = intent.requestedMin ?? 15;
          const maxMessages = Math.max(minMessages, Math.min(50, minMessages * 2));
          const [toolResult] = await toolRegistry.executeTools([
            {
              name: 'summarize_context',
              args: {
                userId: interaction.user.id,
                channelId: interaction.channelId,
                minMessages,
                maxMessages,
                useWeb: true,
                appendDateToWebQueries: true,
              },
            },
          ]);

          const data: any = toolResult?.result || {};
          const parts: string[] = [];
          if (data.summary) parts.push(`**Summary**\n${data.summary}`);
          if (Array.isArray(data.keyPoints) && data.keyPoints.length) {
            parts.push(`**Key points**\n- ${data.keyPoints.slice(0, 10).join('\n- ')}`);
          }
          if (Array.isArray(data.actionItems) && data.actionItems.length) {
            parts.push(`**Action items**\n- ${data.actionItems.slice(0, 10).join('\n- ')}`);
          }
          if (Array.isArray(data.openQuestions) && data.openQuestions.length) {
            parts.push(`**Open questions**\n- ${data.openQuestions.slice(0, 10).join('\n- ')}`);
          }
          if (Array.isArray(data.webResults) && data.webResults.length) {
            const srcs: string[] = [];
            for (const wr of data.webResults) {
              if (wr?.sources && wr.sources.length) {
                for (const s of wr.sources.slice(0, 3)) {
                  srcs.push(`- ${s.title}: ${s.url}`);
                }
              }
            }
            if (srcs.length) parts.push(`**Sources**\n${srcs.join('\n')}`);
          }
          const content = parts.join('\n\n') || 'No summary available.';

          await memoryManager.addMessage(
            interaction.user.id,
            interaction.channelId,
            'assistant',
            content
          );

          // Publish summary to the channel
          try {
            const toolsUsed = data.usedWebSearch ? ['summarize_context', 'web_search'] : ['summarize_context'];
            await interaction.channel?.sendTyping?.();
            await EmbedResponse.sendLongResponse(
              (interaction as any).channel?.lastMessage || interaction, // fallback shape
              content,
              { title: '🧾 Channel Summary', includeContext: true, toolsUsed }
            );
          } catch (sendErr) {
            console.error('Failed to send channel summary (slash):', sendErr);
          }

          try { await interaction.editReply({ content: '✅ Summary posted in the channel.' }); } catch {}
          return;
        } catch (summaryErr) {
          console.error('Summarize intent handling (slash) failed:', summaryErr);
          // Fall-through to normal LLM flow
        }
      }

      const messages = [
        buildSystemMessage(),
        ...conversationHistory.map((msg: ConversationMessage) =>
          msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
        ),
        new HumanMessage(cleanContent),
      ];

      const tokenTracker = new TokenTracker();
      const response = await invokeWithCircuitBreaker(messages, [tokenTracker]);

      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolsUsed = response.tool_calls.map((tc: any) => tc.name);
        console.log(`🔧 Tools used (slash): ${toolsUsed.join(', ')}`);

        const toolResults: ToolResult[] = [];
        let imageToolUsed = false;
        let imageGenNoticeSent = false;
        for (const toolCall of response.tool_calls) {
          if (toolCall.name === 'generate_image') {
            if (imageToolUsed) {
              toolResults.push({
                success: true,
                result: {
                  success: false,
                  message: 'Image already generated for this message; ignoring duplicate request.',
                },
                message: new ToolMessage({
                  content: 'Image already generated for this message; ignoring duplicate request.',
                  tool_call_id: toolCall.id || '',
                }),
              });
              continue;
            }

            // Send ephemeral in-channel notice to only the user with a cat GIF
            if (!imageGenNoticeSent) {
              try {
                const catGifUrl = 'https://cataas.com/cat/gif';
                let files: any[] | undefined = undefined;
                try {
                  const resp = await fetch(catGifUrl);
                  if (resp.ok) {
                    const arrayBuffer = await resp.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    files = [{ attachment: buffer, name: 'please-wait-cat.gif' }];
                  }
                } catch (_) {}
                await interaction.followUp({
                  ephemeral: true,
                  content:
                    '🎨 Generating your image now — this can take a little while. I\'ll post it in the channel when it\'s ready! Here\'s a cat while you wait 😺',
                  files,
                });
              } catch (notifyError) {
                console.warn('Failed to send ephemeral image-generation notice:', notifyError);
              }
              imageGenNoticeSent = true;
            }

            imageToolUsed = true;
          }
          // Inject default context for summarize_context if args are missing
          if (toolCall.name === 'summarize_context') {
            toolCall.args = {
              userId: toolCall.args?.userId || interaction.user.id,
              channelId: toolCall.args?.channelId || interaction.channelId,
              minMessages: toolCall.args?.minMessages ?? 15,
              maxMessages: toolCall.args?.maxMessages ?? 50,
              useWeb: toolCall.args?.useWeb ?? true,
              appendDateToWebQueries: toolCall.args?.appendDateToWebQueries ?? true,
            };
          }
          const [result] = await toolRegistry.executeTools([toolCall]);
          if (result) {
            toolResults.push(result);
          }
        }

        // Prepare image attachments
        const attachments: any[] = [];
        let imagePrompt: string | undefined;
        let imageFilename: string | undefined;
        let imageAlreadyAttached = false;
        for (let i = 0; i < response.tool_calls.length; i++) {
          const toolCall = response.tool_calls[i];
          const result = toolResults[i];
          if (!toolCall || !result) continue;
           if (toolCall.name === 'generate_image' && result.success && !imageAlreadyAttached) {
            try {
              const rawResult: any = result.result;
              if (rawResult?.success && rawResult.imageBuffer) {
                const attachment = createImageAttachment(rawResult);
                if (attachment) {
                  attachments.push(attachment);
                  imageAlreadyAttached = true;
                }
                if (!imagePrompt) imagePrompt = rawResult.prompt;
                if (!imageFilename) imageFilename = rawResult.filename;
              }
            } catch (err) {
              console.error('📎 Failed to create image attachment (slash):', err);
            }
          }
          // If image generation failed with moderation on slash flow, surface notice publicly
          if (toolCall.name === 'generate_image' && !result.success) {
            const raw: any = result.result;
            if (raw?.moderationBlocked) {
              const friendly = '❌ Image request blocked by safety filters. Please adjust the prompt to avoid sensitive or disallowed content.';
              try {
                await memoryManager.addMessage(
                  interaction.user.id,
                  interaction.channelId,
                  'assistant',
                  friendly
                );
              } catch {}
              try {
                await interaction.channel?.sendTyping?.();
                await EmbedResponse.sendLongResponse(
                  (interaction as any).channel?.lastMessage || interaction,
                  friendly,
                  { title: '⚠️ Moderation Notice', includeContext: true, toolsUsed: ['generate_image'] }
                );
              } catch {}
            }
          }
        }

        const toolMessages = toolResults.map((tr: ToolResult) => tr.message);
        const recentContext = messages
          .filter((m: any) => !(m instanceof SystemMessage))
          .slice(-6);
          const finalResponse = await invokeWithCircuitBreaker(
            [buildSystemMessage(), ...recentContext, response, ...toolMessages],
            [tokenTracker]
          );
          const cleanedFinal = cleanAssistantContent(finalResponse.content as string);
 
          await memoryManager.addMessage(
            interaction.user.id,
            interaction.channelId,
            'assistant',
            cleanedFinal
          );
 
          // Send final response publicly in the same channel
          try {
          if (attachments.length > 0 && imagePrompt) {
            const embed: any = {
              color: 0x5865f2,
              fields: [{ name: 'Prompt', value: imagePrompt }],
              image: imageFilename ? { url: `attachment://${imageFilename}` } : undefined,
              description: 'Here is your image',
              title: '🤖 Response',
            };
            await interaction.channel?.send({
              embeds: [embed],
              files: attachments,
              allowedMentions: { repliedUser: false },
            });
            } else {
              const responseContent = cleanedFinal;
              const chunks = EmbedResponse.chunkContent(responseContent);

            const embeds = chunks.slice(0, 10).map((chunk, idx) => {
              const footerInfo: string[] = [];
              if (idx === chunks.length - 1) {
                if (toolsUsed?.length) footerInfo.push(`Used tools: ${toolsUsed.join(', ')}`);
                const usage = tokenTracker.getUsage();
                footerInfo.push(
                  `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.totalTokens} total`
                );
              }
              const description = idx === chunks.length - 1 && footerInfo.length
                ? `${chunk}\n\n*${footerInfo.join(' • ')}*`
                : chunk;
              const embed: any = {
                color: 0x5865f2,
                description,
                title: idx === 0 ? '🤖 Response' : undefined,
                footer:
                  chunks.length > 1
                    ? { text: `Page ${idx + 1} of ${Math.min(chunks.length, 10)}` }
                    : undefined,
                author:
                  idx === 0
                    ? { name: '🧠 Enhanced with conversation memory', icon_url: interaction.client.user?.displayAvatarURL() || undefined }
                    : undefined,
              };
              return embed;
            });
            await interaction.channel?.send({
              embeds,
              allowedMentions: { repliedUser: false },
            });
          }
        } catch (sendErr) {
          console.error('Failed to send public response (slash):', sendErr);
          await interaction.followUp({
            ephemeral: true,
            content: 'Sorry, I could not send the response to the channel.',
          });
        }
      } else {
        // No tools used; just send content publicly
        const responseContent = cleanAssistantContent(response.content as string);
        await memoryManager.addMessage(
          interaction.user.id,
          interaction.channelId,
          'assistant',
          responseContent
        );
        const chunks = EmbedResponse.chunkContent(responseContent);
        const embeds = chunks.slice(0, 10).map((chunk, idx) => ({
          color: 0x5865f2,
          description: chunk,
          title: idx === 0 ? '🤖 Response' : undefined,
          footer:
            chunks.length > 1
              ? { text: `Page ${idx + 1} of ${Math.min(chunks.length, 10)}` }
              : undefined,
          author:
            idx === 0
              ? { name: '🧠 Enhanced with conversation memory', icon_url: interaction.client.user?.displayAvatarURL() || undefined }
              : undefined,
        }));
        await interaction.channel?.send({ embeds, allowedMentions: { repliedUser: false } });
      }

      // Edit the ephemeral deferred reply to a short confirmation
      try {
        await interaction.editReply({ content: '✅ Done! Posted in the channel.' });
      } catch {}
    } catch (error) {
      console.error('Error handling interaction:', error);
      try {
        if (interaction.isRepliable?.()) {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ An error occurred.' });
          } else {
            await interaction.reply({ ephemeral: true, content: '❌ An error occurred.' });
          }
        }
      } catch {}
    }
  });
  g.__GA_LT_INTERACTION_LISTENER = true;
}

// Error handling
client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(config.discordToken);