import { Client, GatewayIntentBits, Events, Message } from 'discord.js';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { MemoryManager } from './src/memory/MemoryManager';
import { ToolRegistry } from './src/tools/ToolRegistry';
import { EmbedResponse } from './src/utils/EmbedResponse';
import type { BotConfig, ConversationMessage, ToolResult } from './src/types/BotConfig';
import { calculatorTool, timeTool } from './src/tools/examples/ExampleTool';
import { weatherTool, randomFactTool } from './src/tools/examples/WeatherTool';
import { imageGenerationTool, createImageAttachment } from './src/tools/ImageGenerationTool';
import webSearchTool from './src/tools/WebSearchTool';

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

// Initialize LangChain Google Gemini model
const llm = new ChatGoogleGenerativeAI({
  apiKey: config.googleApiKey,
  model: config.googleModel,
  temperature: 1,
});

// Initialize memory manager
const memoryManager = new MemoryManager();

// Initialize tool registry and register example tools
const toolRegistry = new ToolRegistry();
toolRegistry.registerTool(calculatorTool);
toolRegistry.registerTool(timeTool);
toolRegistry.registerTool(weatherTool);
toolRegistry.registerTool(randomFactTool);
toolRegistry.registerTool(imageGenerationTool);
  toolRegistry.registerTool(webSearchTool);

// Bind tools to the LLM
const llmWithTools = llm.bindTools(toolRegistry.getToolDefinitions());

// Bot ready event
if (!g.__GA_LT_READY_LISTENER) {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`🚀 ${readyClient.user.tag} is online and ready!`);
    console.log(`📊 Registered ${toolRegistry.getToolCount()} tools`);
    console.log(`🎨 Image generation available via GPT-Image-1`);

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
    
    // Prepare messages for LangChain (conversationHistory already includes current context)
    const messages = [
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
    const response = await llmWithTools.invoke(messages, { callbacks: [tokenTracker] });
    
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
        const [result] = await toolRegistry.executeTools([toolCall]);
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
              // Capture prompt and filename for embed formatting
              if (!imagePrompt) imagePrompt = rawResult.prompt;
              if (!imageFilename) imageFilename = rawResult.filename;
            }
          } catch (error) {
            console.error('📎 Failed to create image attachment:', error);
          }
        }
      }
      
      console.log(`📎 Total attachments: ${attachments.length}`);
      
      // Add tool results to conversation and get final response
      const toolMessages = toolResults.map((result: ToolResult) => result.message);
      // Limit the amount of prior context to avoid huge token usage on the second call
      const recentContext = messages.slice(-6);
      const finalResponse = await llmWithTools.invoke([
        ...recentContext,
        response,
        ...toolMessages
      ], { callbacks: [tokenTracker] });
      
      // Add final response to memory
      await memoryManager.addMessage(
        message.author.id,
        message.channel.id,
        'assistant',
        finalResponse.content as string
      );
      
      // Get token usage stats
      const tokenUsage = tokenTracker.getUsage();
      console.log(`📊 Token usage: ${tokenUsage.inputTokens} input, ${tokenUsage.outputTokens} output, ${tokenUsage.totalTokens} total`);
      
      // Send response to Discord using embeds with tool indicators
      const responseContent = finalResponse.content as string;
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
      const responseContent = response.content as string;
      
      // Add response to memory
      await memoryManager.addMessage(
        message.author.id,
        message.channel.id,
        'assistant',
        responseContent
      );
      
      // Get token usage stats
      const tokenUsage = tokenTracker.getUsage();
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

      const messages = [
        ...conversationHistory.map((msg: ConversationMessage) =>
          msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
        ),
        new HumanMessage(cleanContent),
      ];

      const tokenTracker = new TokenTracker();
      const response = await llmWithTools.invoke(messages, { callbacks: [tokenTracker] });

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
        }

        const toolMessages = toolResults.map((tr: ToolResult) => tr.message);
        const recentContext = messages.slice(-6);
        const finalResponse = await llmWithTools.invoke(
          [...recentContext, response, ...toolMessages],
          { callbacks: [tokenTracker] }
        );

        await memoryManager.addMessage(
          interaction.user.id,
          interaction.channelId,
          'assistant',
          finalResponse.content as string
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
            const responseContent = finalResponse.content as string;
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
        const responseContent = response.content as string;
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