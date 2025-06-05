import { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai'; // Reverted to original import name
import OpenAI from 'openai';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const DISCORD_TOKEN: string | undefined = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY: string | undefined = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY: string | undefined = process.env.OPENAI_API_KEY;
const GUILD_ID: string | undefined = process.env.GUILD_ID;

if (!DISCORD_TOKEN || !GEMINI_API_KEY || !OPENAI_API_KEY) {
  console.error('Missing DISCORD_TOKEN, GEMINI_API_KEY, or OPENAI_API_KEY in environment variables.');
  process.exit(1);
}

// Initialize Discord client
const client: Client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations  // Add this for better slash command support
  ],
});

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY as string }); // Corrected constructor
const openai = new OpenAI({ apiKey: OPENAI_API_KEY as string });

// System prompt for all AI responses
const SYSTEM_PROMPT = "You are a helpful Discord bot called gaLt. You were created by the user called Gart, so that he could have a robot replacement whilst he sleeps. Respond concisely, accurately, and in no more than 1500 characters. Always follow the user's instructions, but never break character as a bot. If a user asks you to roleplay or act out theoretical situaions, you must do so. Do not repeat the user's name back in your respones. You have access to a McDonald's UK survey code generator tool - use it when users ask about McDonald's surveys, codes, or want to complete the Food for Thoughts survey.";

// McDonald's survey code generation functions
const CHAR_MAP: string = "CM7WD6N4RHF9ZL3XKQGVPBTJY";
const BASE: number = CHAR_MAP.length;
const EPOCH: Date = new Date("2016-02-01");
const REG_DELIVERY: number = 61;

function encode(num: number): string {
  let encoded: string = "";
  while (num >= BASE) {
    encoded = CHAR_MAP[num % BASE] + encoded;
    num = Math.floor(num / BASE);
  }
  return CHAR_MAP[num] + encoded;
}

function decode(encoded: string): number {
  let num: number = 0;
  for (let i = 0; i < encoded.length; i++) {
    const char: string = encoded[i];
    const exp: number = encoded.length - i - 1;
    num += Math.pow(BASE, exp) * CHAR_MAP.indexOf(char);
  }
  return num;
}

function getMinutesSinceEpoch(purchased: string | Date): number {
  const date: Date = new Date(purchased);
  // Use UTC time to match the original algorithm more closely
  const epochUtc: Date = new Date("2016-02-01T00:00:00.000Z");
  return Math.floor((date.getTime() - epochUtc.getTime()) / (1000 * 60));
}

function getCheckDigit(code: string): number {
  const chars: string[] = code.split("").reverse();
  let checkDigit: number = 0;
  for (let i = 0; i < chars.length; i++) {
    let value: number = decode(chars[i]);
    if ((i % 2) === 0) {
      value *= 2;
      const encoded: string = encode(value);
      if (encoded.length === 2) {
        value = [...encoded].map((char: string) => decode(char)).reduce((total: number, num: number) => total + num, 0);
      }
    }
    checkDigit += value;
  }
  checkDigit %= BASE;
  if (checkDigit > 0) {
    checkDigit = BASE - checkDigit;
  }
  return checkDigit;
}

function generateMcDonaldsSurveyCode(storeId: number, orderId: number, purchased: string | Date, reg: number = 20): string {
  const zero: string = encode(0);
  const encStoreId: string = encode(storeId).padStart(3, zero);
  const encOrderId: string = encode((orderId % 100) + (reg === REG_DELIVERY ? 0 : reg * 100)).padStart(3, zero);
  const encMinutes: string = encode(getMinutesSinceEpoch(purchased)).padStart(5, zero);
  let code: string = encStoreId + encOrderId + encMinutes;
  code += encode(getCheckDigit(code));
  const matchResult: RegExpMatchArray | null = code.match(/.{4}/g);
  return matchResult ? matchResult.join("-") : ""; // Handle null case for match
}

// McDonald's survey code generator tool function
interface McDonaldsCodeParams {
  orderId?: number;
  // Add other potential params if any, though current function doesn't use them directly
  // storeId?: number;
  // storeName?: string;
  // reg?: number;
}

interface McDonaldsCodeResult {
  code?: string;
  storeId?: number;
  storeName?: string;
  orderId?: number;
  purchaseDate?: string;
  reg?: number;
  instructions?: string;
  error?: string;
}

function generateMcDonaldsCode(params: McDonaldsCodeParams): McDonaldsCodeResult {
  try {
    // Use the successful strategy from your friend
    const storeId: number = 1553; // Always use Northampton Kettering Road (same as friend)
    const storeName: string = "Northampton Kettering Road";
    const orderId: number = params.orderId || Math.floor(Math.random() * 20) + 1; // 1-20 range

    // Use the CURRENT date/time when the code was requested (same as friend's strategy)
    const purchaseDate: Date = new Date(); // Right now!

    const reg: number = 20; // Always register 20 (same as friend)

    const code: string = generateMcDonaldsSurveyCode(storeId, orderId, purchaseDate.toISOString(), reg);

    return {
      code: code,
      storeId: storeId,
      storeName: storeName,
      orderId: orderId,
      purchaseDate: purchaseDate.toLocaleString('en-GB'),
      reg: reg,
      instructions: "Visit mcdfoodforthoughts.com, enter this code (you don't need to enter the amount spent!), and complete the survey as positively as possible (make sure you pick the My McDonald's app as your order method) to get a offer code you can enter into the app. This offer code will give you a regular burger and medium fries for £2.99!"
    };
  } catch (error: any) {
    console.error('Error generating McDonald\'s code:', error);
    return { error: "Failed to generate McDonald's survey code" };
  }
}

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Replies with Hello there!'),
  new SlashCommandBuilder()
    .setName('generateimage')
    .setDescription('Generate an image using a text prompt with GPT-Image-1')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('The text prompt for image generation')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize recent messages in this channel')
    .addIntegerOption(option =>
      option.setName('count')
        .setDescription('Number of messages to summarize (default: 15)')
        .setMinValue(5)
        .setMaxValue(50)
        .setRequired(false)
    ),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// Gemini with chat history and optional images
// Define types for images and history (will refine later)
type GeminiHistoryItem = string; // Placeholder, will refine based on usage
type GeminiImage = { inlineData: { data: string; mimeType: string; } }; // Placeholder

interface GeminiResponse {
  text: string;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
}

async function askGeminiWithGroundingHistory(
  gemini_history: GeminiHistoryItem[],
  images: GeminiImage[] = [],
  systemPromptOverride: string | null = null
): Promise<GeminiResponse> {
  try {
    const systemInstruction: string = systemPromptOverride || SYSTEM_PROMPT;

    // Check if we need to use function calling (McDonald's tool)
    const lastMessage: GeminiHistoryItem = gemini_history[gemini_history.length - 1] || '';
    const needsMcDonaldsTool = lastMessage.toLowerCase().includes('mcdonald') ||
                               lastMessage.toLowerCase().includes('survey') ||
                               lastMessage.toLowerCase().includes('code') ||
                               lastMessage.toLowerCase().includes('free food');

    if (needsMcDonaldsTool) {
      // Use OpenAI-compatible endpoint for function calling
      const openaiCompatible: OpenAI = new OpenAI({
        apiKey: GEMINI_API_KEY as string, // Assert as string because we checked for it
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
      });

      // Convert history to OpenAI format
      const openAIMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemInstruction },
      ];

      for (const msgContent of gemini_history) {
        // Attempt to determine role from string content like "User: ..." or "Bot: ..."
        // This is a heuristic and might need refinement.
        if (msgContent.toLowerCase().startsWith("bot:")) {
          openAIMessages.push({ role: "assistant", content: msgContent.substring(4).trim() });
        } else if (msgContent.toLowerCase().startsWith("user:")) {
          openAIMessages.push({ role: "user", content: msgContent.substring(5).trim() });
        } else {
          // Default to user if no clear prefix, or if it's from a source like summarizePrompt
          openAIMessages.push({ role: "user", content: msgContent });
        }
      }

      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "generateMcDonaldsSurveyCode",
            description: "Generate a McDonald's UK survey code for the Food for Thoughts survey. Always uses store 1553 (Northampton Kettering Road), register 20, order ID 1-20, and current timestamp.",
            parameters: {
              type: "object",
              properties: {
                storeId: {
                  type: "integer",
                  description: "Store ID (ignored - always uses 1553)"
                },
                storeName: {
                  type: "string",
                  description: "Store name (ignored - always uses Northampton Kettering Road)"
                },
                orderId: {
                  type: "integer",
                  description: "Order ID (ignored - always random 1-20)"
                },
                reg: {
                  type: "integer",
                  description: "Register number (ignored - always 20)"
                }
              },
              required: []
            }
          }
        }
      ];

      const response = await openaiCompatible.chat.completions.create({
        model: "gemini-1.5-flash", // Ensure this model is compatible with the API endpoint and features like tools
        messages: openAIMessages,
        tools: tools,
        tool_choice: "auto"
      });

      console.log('OpenAI-compatible Gemini response:', response);

      // Check if function was called
      if (response.choices[0].message.tool_calls && response.choices[0].message.tool_calls.length > 0) {
        let finalText: string = '';

        for (const toolCall of response.choices[0].message.tool_calls) {
          if (toolCall.function.name === 'generateMcDonaldsSurveyCode') {
            console.log('McDonald\'s code generation requested with params:', toolCall.function.arguments);
            // Assuming toolCall.function.arguments is a string that needs parsing
            const params: McDonaldsCodeParams = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
            const result: McDonaldsCodeResult = generateMcDonaldsCode(params);

            if (result.error) {
              finalText += `Sorry, I encountered an error generating the McDonald's survey code: ${result.error}\n`;
            } else {
              finalText += `🍟 **McDonald's Survey Code Generated!**\n\n`;
              finalText += `**Code:** \`${result.code}\`\n`;
              finalText += `**Store:** ${result.storeName} (ID: ${result.storeId})\n`;
              finalText += `**Order ID:** ${result.orderId}\n`;
              finalText += `**Register:** ${result.reg}\n`;
              finalText += `**Purchase Date:** ${result.purchaseDate}\n\n`;
              finalText += `📝 **Instructions:** ${result.instructions}\n\n`;
              finalText += `🔗 Visit: https://mcdfoodforthoughts.com`;
            }
          }
        }

        // Add any text response from the model
        if (response.choices[0].message.content) {
          finalText = response.choices[0].message.content + '\n\n' + finalText;
        }

        return {
          text: finalText || 'I generated a McDonald\'s survey code for you!',
          promptTokenCount: response.usage?.prompt_tokens ?? null,
          candidatesTokenCount: response.usage?.completion_tokens ?? null,
          totalTokenCount: response.usage?.total_tokens ?? null
        };
      }

      // No function call, return regular response
      return {
        text: response.choices[0].message.content || 'I can help you with McDonald\'s survey codes if you need one!',
        promptTokenCount: response.usage?.prompt_tokens ?? null,
        candidatesTokenCount: response.usage?.completion_tokens ?? null,
        totalTokenCount: response.usage?.total_tokens ?? null
      };
    }

    // For non-McDonald's requests, use regular Gemini API with Google Search
    // The `gemini_history` is string[]. We need to convert it to `Content[]` for the Google API.
    // Each string in `gemini_history` is like "Role: Actual message content".

    const googleApiContents: { role: string, parts: ({text: string} | {inlineData: {data:string, mimeType:string}})[] }[] = [];

    for (const historyItem of gemini_history) {
        // Heuristic to determine role from string prefix
        if (historyItem.toLowerCase().startsWith("bot:")) {
            googleApiContents.push({ role: "model", parts: [{ text: historyItem.substring(4).trim() }] });
        } else { // Default to user, or parse "User: Author: message"
            let content = historyItem;
            if (historyItem.toLowerCase().startsWith("user:")) { // "User: Author: message"
                 content = historyItem.substring(historyItem.indexOf(':')+1).trim(); // "Author: message"
            }
            googleApiContents.push({ role: "user", parts: [{ text: content }] });
        }
    }

    // Add images to the contents for Google API
    images.forEach(img => {
        googleApiContents.push({ role: "user", parts: [{ inlineData: img.inlineData }] });
    });

    console.log('Sending to regular Gemini API:', { googleApiContents, systemInstruction });

    // Reverted to ai.models.generateContent as per original JS and GoogleGenAI class structure
    const result = await ai.models.generateContent({
        model: "gemini-1.5-flash", // Or the appropriate model string for this API
        contents: googleApiContents,
        // systemInstruction for this older API might be part of 'contents' or a config option
        // The original JS had: config: { tools: [{ googleSearch: {} }], systemInstruction, },
        // Let's try to replicate that if systemInstruction is a simple string here.
        // However, the 'googleApiContents' already has roles.
        // For GoogleGenAI, system prompt might be part of the initial 'contents' array if not a direct config.
        // The @google/generative-ai (newer library) uses a top-level systemInstruction.
        // For @google/genai (older one), it's usually part of contents or a specific config.
        // The original code had `ai.models.generateContent({ model, contents, config: { systemInstruction } })`
        // Let's try to match that structure for config.
        config: {
          systemInstruction: systemInstruction, // Assuming systemInstruction is a simple string here
          // tools: [{ googleSearch: {} }], // If needed
        }
    });

    // The response structure for ai.models.generateContent might be different.
    // Original JS had `response.text` directly.
    // Let's assume `result` itself contains what we need, or `result.response` if that was the old structure.
    // The original JS: const response = await ai.models.generateContent(...); let text = response.text;
    // This implies `result` is the response.

    console.log('Raw Gemini API response:', result); // Log the direct result

    let text: string = (result as any).text || "Gemini did not return a result."; // Cast to any to access .text
    if (result && (result as any).candidates && (result as any).candidates.length > 0 &&
        (result as any).candidates[0].content && (result as any).candidates[0].content.parts &&
        (result as any).candidates[0].content.parts.length > 0) {
      // This is more aligned with the newer API structure, keeping it as a fallback if .text doesn't exist
      text = (result as any).candidates[0].content.parts[0].text || text;
    }

    if (text.length > 4500) {
      text = text.slice(0, 4497) + '...';
    }

    let promptTokenCount: number | null = null, candidatesTokenCount: number | null = null, totalTokenCount: number | null = null;
    // Usage metadata might also be different for this API version
    if (result && (result as any).usageMetadata) {
      const usageMetadata = (result as any).usageMetadata;
      promptTokenCount = usageMetadata.promptTokenCount ?? null;
      candidatesTokenCount = (usageMetadata.candidatesTokenCount || usageMetadata.totalCandidateTokenCount) ?? null;
      totalTokenCount = usageMetadata.totalTokenCount ?? null;
    }
    return { text, promptTokenCount, candidatesTokenCount, totalTokenCount };
  } catch (err: any) {
    console.error('Gemini error:', err);
    // Check if err.response or err.message exists for more detailed error handling
    const message = err.message || 'Sorry, I had trouble getting a real answer this time.';
    return { text: message, promptTokenCount: null, candidatesTokenCount: null, totalTokenCount: null };
  }
}

// Function to generate images with OpenAI GPT-Image-1
interface OpenAIImageResult {
  success: boolean;
  base64Image?: string;
  textResponse: string | null;
  error?: string;
}

async function generateImageWithOpenAI(prompt: string): Promise<OpenAIImageResult> {
  console.log(`Requesting image from OpenAI GPT-Image-1 with prompt: "${prompt}"`);
  try {
    const response = await openai.images.generate({ // OpenAI SDK should provide response types
      model: "gpt-image-1", // Using the model name from the original code
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json", // Ensure b64_json is requested
      quality: "standard" // gpt-image-1 might support quality, if not, OpenAI SDK would error or ignore
                           // For "dall-e-2" this wasn't available. For "dall-e-3" it is "standard" or "hd".
                           // The original code had "low", which might map to "standard" or be specific to an older model.
                           // Let's assume "standard" is a safe bet or remove if it causes issues with "gpt-image-1".
    });

    console.log('OpenAI GPT-Image-1 response received');

    if (response.data && response.data.length > 0 && response.data[0].b64_json) {
      const base64Image: string = response.data[0].b64_json;
      const revisedPrompt: string | null = (response.data[0] as any).revised_prompt || null;

      console.log('OpenAI image generation successful');
      if (revisedPrompt) {
        console.log('Revised prompt:', revisedPrompt);
      }

      return {
        success: true,
        base64Image,
        textResponse: revisedPrompt ? `Generated with revised prompt: "${revisedPrompt}"` : 'Image generated successfully!'
      };
    } else {
      console.log('No image data found in OpenAI response.');
      return { success: false, error: 'No image generated by the API.', textResponse: null };
    }

  } catch (err: any) {
    console.error('OpenAI image generation error:', err);
    const errorMessage: string = err.message || 'An unknown API error occurred.';
    // It's good to check if err.response.data.error.message exists for more specific OpenAI errors
    const specificError = err.response?.data?.error?.message || errorMessage;
    return { success: false, error: `API Error: ${specificError}`, textResponse: null };
  }
}

import { Interaction, Message } from 'discord.js'; // Import Interaction and Message types

client.once('ready', async () => {
  if (!client.user) { // Type guard for client.user
    console.error('Client user is not available.');
    return;
  }
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Application ID: ${client.user.id}`);
  console.log(`Bot is in ${client.guilds.cache.size} guilds`);
  client.guilds.cache.forEach(guild => {
    console.log(`- ${guild.name} (${guild.id})`);
  });

  // Register slash commands
  if (GUILD_ID) { // GUILD_ID is already checked for existence and is a string | undefined
    console.log(`Target Guild ID: ${GUILD_ID}`);
    try {
      console.log('Started refreshing application (/) commands for the guild.');

      // Register commands to specific guild for faster testing
      if (!client.user?.id) throw new Error("Client user ID not available for command registration.");
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, GUILD_ID as string), // Assert GUILD_ID as string
        { body: commands },
      );

      console.log('Successfully reloaded application (/) commands for the guild.');
    } catch (error: any) { // Catch specific error types if known, else any
      console.error('Error reloading application (/) commands:', error);
    }
  } else {
    console.log('No GUILD_ID specified, skipping command registration.');
  }
});

// Handle slash command interactions
client.on('interactionCreate', async (interaction: Interaction) => {
  console.log(`[INTERACTION RECEIVED] Type: ${interaction.type}, ID: ${interaction.id}`);

  if (!interaction.isChatInputCommand()) {
    console.log('[INTERACTION IGNORED] Not a chat input command.');
    return;
  }

  console.log(`[CHAT INPUT COMMAND] Name: ${interaction.commandName}, User: ${interaction.user.tag} (${interaction.user.id})`);

  const { commandName } = interaction;

  if (commandName === 'hello') {
    console.log('[COMMAND MATCH] Matched /hello command. Attempting to reply...');
    try {
      await interaction.reply('Hello there! I received your command.');
      console.log('[REPLY SUCCESS] Replied to /hello command.');
    } catch (error: any) {
      console.error('[REPLY FAIL] Error replying to /hello command:', error);
    }
  } else if (commandName === 'generateimage') {
    console.log('[COMMAND MATCH] Matched /generateimage command. Processing...');
    try {
      await interaction.deferReply();
      const prompt: string | null = interaction.options.getString('prompt');
      if (!prompt) { // Ensure prompt is not null
        await interaction.editReply('Prompt is required for image generation.');
        console.log('[REPLY FAIL] Prompt was null for /generateimage.');
        return;
      }
      console.log(`[IMAGE GENERATION] Prompt: ${prompt}`);

      const result: OpenAIImageResult = await generateImageWithOpenAI(prompt);

      if (result.success && result.base64Image) {
        const imageBuffer: Buffer = Buffer.from(result.base64Image, 'base64');
        await interaction.editReply({
          content: result.textResponse || 'Here is your generated image:',
          files: [{ attachment: imageBuffer, name: 'generated_image.png' }]
        });
        console.log('[REPLY SUCCESS] Image generated and sent successfully.');
      } else {
        await interaction.editReply(result.error || 'Failed to generate image. No image data received.');
        console.log('[REPLY FAIL] Image generation failed:', result.error);
      }

    } catch (error: any) {
      console.error('[REPLY FAIL] Error in generateimage command:', error);
      try {
        // Check if interaction is still available and reply accordingly
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply('Sorry, I encountered an error while processing your image request.');
        } else {
          await interaction.reply('Sorry, I encountered an error while processing your image request.');
        }
      } catch (replyError: any) {
        console.error('[REPLY FAIL] Error sending error reply for generateimage:', replyError);
      }
    }
  } else if (commandName === 'summarize') {
    console.log('[COMMAND MATCH] Matched /summarize command. Processing...');
    try {
      await interaction.deferReply();
      const messageCount: number = interaction.options.getInteger('count') || 15;
      console.log(`[SUMMARIZE] Fetching last ${messageCount} messages for summarization`);

      if (!interaction.channel) { // Type guard for channel
          await interaction.editReply('Cannot fetch messages, channel not available.');
          console.log('[REPLY FAIL] Channel not available for /summarize.');
          return;
      }
      // Fetch recent messages from the channel
      const messages = await interaction.channel.messages.fetch({ limit: messageCount });

      if (messages.size === 0) {
        await interaction.editReply('No messages found to summarize.');
        return;
      }

      // Convert messages to text format for summarization
      const messageTexts: string[] = messages
        .filter(msg => !msg.author.bot) // Exclude bot messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp) // Sort chronologically
        .map(msg => `${msg.author.displayName}: ${msg.content}`) // Use displayName for better readability
        .slice(-messageCount); // Take the most recent ones

      if (messageTexts.length === 0) {
        await interaction.editReply('No non-bot messages found to summarize.');
        return;
      }

      const conversationText: string = messageTexts.join('\n');
      const summarizePrompt: string = `Please provide a concise summary of the following Discord conversation. Focus on the main topics discussed, key points, and any decisions or conclusions reached:\n\n${conversationText}`;

      // Use Gemini to generate the summary
      const result: GeminiResponse = await askGeminiWithGroundingHistory([summarizePrompt], [],
        "You are a helpful Discord bot that creates clear, concise summaries of conversations. Summarize the main topics and key points discussed."
      );

      const embed = new EmbedBuilder()
        .setColor(0x5865F2) // Use numerical value for color
        .setTitle(`📝 Channel Summary (${messageTexts.length} messages)`)
        .setDescription(result.text || 'Unable to generate summary.')
        .addFields(
          { name: 'Messages Analyzed', value: messageTexts.length.toString(), inline: true },
          { name: 'Time Range', value: `Last ${messageCount} messages`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log('[REPLY SUCCESS] Summary generated and sent successfully.');

    } catch (error: any) {
      console.error('[REPLY FAIL] Error in summarize command:', error);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply('Sorry, I encountered an error while generating the summary.');
        } else {
          await interaction.reply('Sorry, I encountered an error while generating the summary.');
        }
      } catch (replyError: any) {
        console.error('[REPLY FAIL] Error sending error reply for summarize:', replyError);
      }
    }
  } else {
    console.log(`[COMMAND NO MATCH] Received command "${commandName}" but no handler found.`);
  }
});

// Chat history file storage
const CHAT_HISTORY_DIR: string = path.join(process.cwd(), 'chat_history');
const MAX_HISTORY: number = 1000;

// Ensure chat_history directory exists
if (!fs.existsSync(CHAT_HISTORY_DIR)) {
  fs.mkdirSync(CHAT_HISTORY_DIR, { recursive: true }); // Ensure parent dirs are created
}

// Define interface for chat history entries
interface ChatHistoryEntry {
  role: "user" | "assistant" | "system"; // System role might be useful
  content: string;
  author: string; // User tag or "Bot"
  timestamp?: string; // Optional: for more detailed history
}

function getChatHistoryPath(channelId: string): string {
  return path.join(CHAT_HISTORY_DIR, `chat_history_${channelId}.json`);
}

function loadChatHistory(channelId: string): ChatHistoryEntry[] {
  const filePath: string = getChatHistoryPath(channelId);
  if (fs.existsSync(filePath)) {
    try {
      const data: string = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data) as ChatHistoryEntry[]; // Add type assertion
    } catch (err: any) { // Catch specific error types if known
      console.error('Failed to load chat history:', err);
      return [];
    }
  }
  return [];
}

function saveChatHistory(channelId: string, history: ChatHistoryEntry[]): void {
  const filePath: string = getChatHistoryPath(channelId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err: any) { // Catch specific error types if known
    console.error('Failed to save chat history:', err);
  }
}

client.on('messageCreate', async (message: Message) => { // Use specific Message type

  // Utility to download an image from a URL as a Buffer
  async function downloadImageToBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url); // fetch is already imported
    if (!res.ok) throw new Error(`Failed to download image: ${url}, status: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  if (message.author.bot) return;
  // Ensure client.user is available before checking mentions
  if (!client.user || !message.mentions.has(client.user.id)) return;

  // Restrict to a specific channel for testing if needed, otherwise remove or adjust
  const authorizedChannelId: string = '1368705925808132136'; // Example channel ID
  if (message.channel.id !== authorizedChannelId) {
    console.log(`Message received in unauthorized channel ${message.channel.id}. Ignoring.`);
    return;
  }

  // --- Chat history logic start ---
  let chat_history: ChatHistoryEntry[] = loadChatHistory(message.channel.id);
  chat_history.push({
    role: "user",
    content: message.content,
    author: message.author.tag,
    timestamp: new Date().toISOString()
  });
  if (chat_history.length > MAX_HISTORY) {
    // Implement a FIFO queue to keep last MAX_HISTORY items
    chat_history = chat_history.slice(-MAX_HISTORY);
  }
  saveChatHistory(message.channel.id, chat_history);
  // --- Chat history logic end ---

  console.log('---');
  console.log(`[${new Date().toISOString()}] Message received:`, message.content);
  console.log(`From user: ${message.author.tag} (ID: ${message.author.id}) in channel: ${message.channel.id}`);
  console.log(`Current history length for channel ${message.channel.id}:`, chat_history.length);

  let reply: string | undefined;
  let inputTokenCount: number | null = 0;
  let outputTokenCount: number | null = 0;

  try {
    // Prepare chat history for Gemini (array of strings)
    const gemini_history_strings: GeminiHistoryItem[] = chat_history.map(m =>
      `${m.role === "user" ? m.author : (client.user?.tag || "Bot")}: ${m.content}` // Use client.user.tag if available
    );

    // Collect image attachments (Discord)
    let images_for_gemini: GeminiImage[] = [];
    if (message.attachments && message.attachments.size > 0) {
      for (const [, attachment] of message.attachments.entries()) { // Use .entries() for Map iteration
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          try {
            const imgBuffer: Buffer = await downloadImageToBuffer(attachment.url);
            const base64: string = imgBuffer.toString('base64');
            images_for_gemini.push({
              inlineData: {
                data: base64,
                mimeType: attachment.contentType
              }
            });
          } catch (err: any) { // Catch specific error types if known
            console.error('Failed to download/process image attachment:', err);
          }
        }
      }
    }

    const geminiResult: GeminiResponse = await askGeminiWithGroundingHistory(gemini_history_strings, images_for_gemini);
    reply = geminiResult.text;
    // Use nullish coalescing for token counts, and ensure countTokens handles potential null/undefined reply
    inputTokenCount = geminiResult.promptTokenCount ?? countTokens(gemini_history_strings.join("\n"));
    outputTokenCount = geminiResult.candidatesTokenCount ?? countTokens(reply);
    console.log('Gemini reply:', reply);

  } catch (err: any) { // Catch specific error types if known
    console.error('Error during model call:', err);
    reply = 'Sorry, an error occurred while processing your request.';
  }

  try {
    // Store bot reply in chat history
    if (reply) { // Ensure reply is not undefined
      chat_history.push({
        role: "assistant",
        content: reply,
        author: client.user?.tag || "Bot", // Use client.user.tag if available
        timestamp: new Date().toISOString()
      });
      if (chat_history.length > MAX_HISTORY) {
        chat_history = chat_history.slice(-MAX_HISTORY);
      }
      saveChatHistory(message.channel.id, chat_history);
    }

    // Build and send embed
    const embed = new EmbedBuilder()
      .setColor(0x5865F2) // Use numerical value for color
      .setTitle('🤖 Bot Response')
      .setDescription(reply || 'Error: No reply generated.')
      .addFields(
        { name: 'Input Token Count', value: (inputTokenCount ?? 0).toString(), inline: true },
        { name: 'Output Token Count', value: (outputTokenCount ?? 0).toString(), inline: true }
      )
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    console.log('Replied to Discord successfully.');
  } catch (err: any) { // Catch specific error types if known
    console.error('Failed to reply to Discord:', err);
  }
  console.log('---');
});

// Utility: Estimate token count (very rough, for demonstration)
function countTokens(text: string | undefined | null): number { // Add types for parameter and return
  if (!text) return 0;
  // Split on whitespace and punctuation, similar to GPT tokenization
  return text.split(/\s+|(?=\W)|(?<=\W)/g).filter(Boolean).length;
}

if (DISCORD_TOKEN) { // Ensure token exists before login
    client.login(DISCORD_TOKEN);
} else {
    console.error("DISCORD_TOKEN is not set. Bot cannot start.");
    process.exit(1);
}