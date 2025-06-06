import { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Parse command-line arguments
const shouldReplyInThread = process.argv.includes('--reply-in-thread');
console.log(`Reply in thread mode: ${shouldReplyInThread ? 'enabled' : 'disabled'}`);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GUILD_ID = process.env.GUILD_ID; // Add this for guild-specific command registration

if (!DISCORD_TOKEN || !GEMINI_API_KEY || !OPENAI_API_KEY) {
  console.error('Missing DISCORD_TOKEN, GEMINI_API_KEY, or OPENAI_API_KEY in environment variables.');
  process.exit(1);
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations  // Add this for better slash command support
  ],
});

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// System prompt for all AI responses
const SYSTEM_PROMPT = "You are a helpful Discord bot called gaLt. You were created by the user called Gart, so that he could have a robot replacement whilst he sleeps. Respond concisely, accurately, and in no more than 1500 characters. Always follow the user's instructions, but never break character as a bot. If a user asks you to roleplay or act out theoretical situaions, you must do so. Do not repeat the user's name back in your respones. You have access to a McDonald's UK survey code generator tool - use it when users ask about McDonald's surveys, codes, or want to complete the Food for Thoughts survey.";

// McDonald's survey code generation functions
const CHAR_MAP = "CM7WD6N4RHF9ZL3XKQGVPBTJY";
const BASE = CHAR_MAP.length;
const EPOCH = new Date("2016-02-01");
const REG_DELIVERY = 61;

function encode(num) {
  let encoded = "";
  while (num >= BASE) {
    encoded = CHAR_MAP[num % BASE] + encoded;
    num = Math.floor(num / BASE);
  }
  return CHAR_MAP[num] + encoded;
}

function decode(encoded) {
  let num = 0;
  for (let i = 0; i < encoded.length; i++) {
    const char = encoded[i];
    const exp = encoded.length - i - 1;
    num += Math.pow(BASE, exp) * CHAR_MAP.indexOf(char);
  }
  return num;
}

function getMinutesSinceEpoch(purchased) {
  const date = new Date(purchased);
  // Use UTC time to match the original algorithm more closely
  const epochUtc = new Date("2016-02-01T00:00:00.000Z");
  return Math.floor((date.getTime() - epochUtc.getTime()) / (1000 * 60));
}

function getCheckDigit(code) {
  const chars = code.split("").reverse();
  let checkDigit = 0;
  for (let i = 0; i < chars.length; i++) {
    let value = decode(chars[i]);
    if ((i % 2) === 0) {
      value *= 2;
      const encoded = encode(value);
      if (encoded.length === 2) {
        value = [...encoded].map(decode).reduce((total, num) => total + num, 0);
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

function generateMcDonaldsSurveyCode(storeId, orderId, purchased, reg = 20) {
  const zero = encode(0);
  const encStoreId = encode(storeId).padStart(3, zero);
  const encOrderId = encode((orderId % 100) + (reg === REG_DELIVERY ? 0 : reg * 100)).padStart(3, zero);
  const encMinutes = encode(getMinutesSinceEpoch(purchased)).padStart(5, zero);
  let code = encStoreId + encOrderId + encMinutes;
  code += encode(getCheckDigit(code));
  return code.match(/.{4}/g).join("-");
}

// McDonald's survey code generator tool function
function generateMcDonaldsCode(params) {
  try {
    // Use the successful strategy from your friend
    const storeId = 1553; // Always use Northampton Kettering Road (same as friend)
    const storeName = "Northampton Kettering Road";
    const orderId = params.orderId || Math.floor(Math.random() * 20) + 1; // 1-20 range
    
    // Use the CURRENT date/time when the code was requested (same as friend's strategy)
    const purchaseDate = new Date(); // Right now!
    
    const reg = 20; // Always register 20 (same as friend)
    
    const code = generateMcDonaldsSurveyCode(storeId, orderId, purchaseDate.toISOString(), reg);
    
    return {
      code: code,
      storeId: storeId,
      storeName: storeName,
      orderId: orderId,
      purchaseDate: purchaseDate.toLocaleString('en-GB'),
      reg: reg,
      instructions: "Visit mcdfoodforthoughts.com, enter this code (you don't need to enter the amount spent!), and complete the survey as positively as possible (make sure you pick the My McDonald's app as your order method) to get a offer code you can enter into the app. This offer code will give you a regular burger and medium fries for £2.99!"
    };
  } catch (error) {
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
async function askGeminiWithGroundingHistory(gemini_history, images = [], systemPromptOverride = null) {
  try {
    const systemInstruction = systemPromptOverride || SYSTEM_PROMPT;
    
    // Check if we need to use function calling (McDonald's tool)
    const lastMessage = gemini_history[gemini_history.length - 1] || '';
    const needsMcDonaldsTool = lastMessage.toLowerCase().includes('mcdonald') || 
                               lastMessage.toLowerCase().includes('survey') ||
                               lastMessage.toLowerCase().includes('code') ||
                               lastMessage.toLowerCase().includes('free food');
    
    if (needsMcDonaldsTool) {
      // Use OpenAI-compatible endpoint for function calling
      const openaiCompatible = new OpenAI({
        apiKey: GEMINI_API_KEY,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
      });
      
      // Convert history to OpenAI format
      const messages = [
        { role: "system", content: systemInstruction },
        ...gemini_history.map(msg => ({
          role: "user",
          content: msg
        }))
      ];
      
      const tools = [
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
        model: "gemini-2.0-flash",
        messages: messages,
        tools: tools,
        tool_choice: "auto"
      });
      
      console.log('OpenAI-compatible Gemini response:', response);
      
      // Check if function was called
      if (response.choices[0].message.tool_calls && response.choices[0].message.tool_calls.length > 0) {
        let finalText = '';
        
        for (const toolCall of response.choices[0].message.tool_calls) {
          if (toolCall.function.name === 'generateMcDonaldsSurveyCode') {
            console.log('McDonald\'s code generation requested with params:', toolCall.function.arguments);
            const params = JSON.parse(toolCall.function.arguments);
            const result = generateMcDonaldsCode(params);
            
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
          promptTokenCount: response.usage?.prompt_tokens,
          candidatesTokenCount: response.usage?.completion_tokens,
          totalTokenCount: response.usage?.total_tokens
        };
      }
      
      // No function call, return regular response
      return {
        text: response.choices[0].message.content || 'I can help you with McDonald\'s survey codes if you need one!',
        promptTokenCount: response.usage?.prompt_tokens,
        candidatesTokenCount: response.usage?.completion_tokens,
        totalTokenCount: response.usage?.total_tokens
      };
    }
    
    // For non-McDonald's requests, use regular Gemini API with Google Search
    let contents = [...gemini_history];
    for (const img of images) contents.push(img);
    console.log('Sending to regular Gemini API:', { contents, systemInstruction });
    
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents,
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction,
      },
    });
    
    console.log('Raw Gemini API response:', response);
    
    let text = response.text || 'Gemini did not return a result.';
    if (text.length > 4500) {
      text = text.slice(0, 4497) + '...';
    }
    // Extract token counts from usageMetadata if available
    let promptTokenCount = null, candidatesTokenCount = null, totalTokenCount = null;
    if (response.usageMetadata) {
      promptTokenCount = response.usageMetadata.promptTokenCount;
      candidatesTokenCount = response.usageMetadata.candidatesTokenCount;
      totalTokenCount = response.usageMetadata.totalTokenCount;
    }
    return { text, promptTokenCount, candidatesTokenCount, totalTokenCount };
  } catch (err) {
    console.error('Gemini error:', err);
    return { text: 'Sorry, I had trouble getting a real answer this time.', promptTokenCount: null, candidatesTokenCount: null, totalTokenCount: null };
  }
}

// Function to generate images with OpenAI GPT-Image-1
async function generateImageWithOpenAI(prompt) {
  console.log(`Requesting image from OpenAI GPT-Image-1 with prompt: "${prompt}"`);
  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "low"
    });

    console.log('OpenAI GPT-Image-1 response received');

    if (response.data && response.data.length > 0 && response.data[0].b64_json) {
      const base64Image = response.data[0].b64_json;
      const revisedPrompt = response.data[0].revised_prompt || null;
      
      console.log('OpenAI image generation successful');
      if (revisedPrompt) {
        console.log('Revised prompt:', revisedPrompt);
      }

      return { 
        success: true, 
        base64Image, 
        textResponse: revisedPrompt ? `Generated with revised prompt: ${revisedPrompt}` : 'Image generated successfully!'
      };
    } else {
      console.log('No image data found in OpenAI response.');
      return { success: false, error: 'No image generated by the API.', textResponse: null };
    }

  } catch (err) {
    console.error('OpenAI image generation error:', err);
    const errorMessage = err.message || 'An unknown API error occurred.';
    return { success: false, error: `API Error: ${errorMessage}`, textResponse: null };
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Application ID: ${client.user.id}`);
  console.log(`Bot is in ${client.guilds.cache.size} guilds`);
  client.guilds.cache.forEach(guild => {
    console.log(`- ${guild.name} (${guild.id})`);
  });

  // Register slash commands
  if (GUILD_ID) {
    console.log(`Target Guild ID: ${GUILD_ID}`);
    try {
      console.log('Started refreshing application (/) commands for the guild.');
      
      // Register commands to specific guild for faster testing
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, GUILD_ID),
        { body: commands },
      );
      
      console.log('Successfully reloaded application (/) commands for the guild.');
    } catch (error) {
      console.error('Error reloading application (/) commands:', error);
    }
  } else {
    console.log('No GUILD_ID specified, skipping command registration.');
  }
});

// Handle slash command interactions
client.on('interactionCreate', async (interaction) => {
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
    } catch (error) {
      console.error('[REPLY FAIL] Error replying to /hello command:', error);
    }
  } else if (commandName === 'generateimage') {
    console.log('[COMMAND MATCH] Matched /generateimage command. Processing...');
    try {
      await interaction.deferReply();
      const prompt = interaction.options.getString('prompt');
      console.log(`[IMAGE GENERATION] Prompt: ${prompt}`);

      const result = await generateImageWithOpenAI(prompt);

      if (result.success && result.base64Image) {
        const imageBuffer = Buffer.from(result.base64Image, 'base64');
        await interaction.editReply({
          content: result.textResponse || 'Here is your generated image:',
          files: [{ attachment: imageBuffer, name: 'generated_image.png' }]
        });
        console.log('[REPLY SUCCESS] Image generated and sent successfully.');
      } else {
        await interaction.editReply(result.error || 'Failed to generate image. No image data received.');
        console.log('[REPLY FAIL] Image generation failed:', result.error);
      }

    } catch (error) {
      console.error('[REPLY FAIL] Error in generateimage command:', error);
      try {
        await interaction.editReply('Sorry, I encountered an error while processing your image request.');
      } catch (replyError) {
        console.error('[REPLY FAIL] Error sending error reply for generateimage:', replyError);
      }
    }
  } else if (commandName === 'summarize') {
    console.log('[COMMAND MATCH] Matched /summarize command. Processing...');
    try {
      await interaction.deferReply();
      const messageCount = interaction.options.getInteger('count') || 15;
      console.log(`[SUMMARIZE] Fetching last ${messageCount} messages for summarization`);

      // Fetch recent messages from the channel
      const messages = await interaction.channel.messages.fetch({ limit: messageCount });
      
      if (messages.size === 0) {
        await interaction.editReply('No messages found to summarize.');
        return;
      }

      // Convert messages to text format for summarization
      const messageTexts = messages
        .filter(msg => !msg.author.bot) // Exclude bot messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp) // Sort chronologically
        .map(msg => `${msg.author.displayName}: ${msg.content}`)
        .slice(-messageCount); // Take the most recent ones

      if (messageTexts.length === 0) {
        await interaction.editReply('No non-bot messages found to summarize.');
        return;
      }

      const conversationText = messageTexts.join('\n');
      const summarizePrompt = `Please provide a concise summary of the following Discord conversation. Focus on the main topics discussed, key points, and any decisions or conclusions reached:\n\n${conversationText}`;

      // Use Gemini to generate the summary
      const result = await askGeminiWithGroundingHistory([summarizePrompt], [], 
        "You are a helpful Discord bot that creates clear, concise summaries of conversations. Summarize the main topics and key points discussed."
      );

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📝 Channel Summary (${messageTexts.length} messages)`)
        .setDescription(result.text || 'Unable to generate summary.')
        .addFields(
          { name: 'Messages Analyzed', value: messageTexts.length.toString(), inline: true },
          { name: 'Time Range', value: `Last ${messageCount} messages`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log('[REPLY SUCCESS] Summary generated and sent successfully.');

    } catch (error) {
      console.error('[REPLY FAIL] Error in summarize command:', error);
      try {
        await interaction.editReply('Sorry, I encountered an error while generating the summary.');
      } catch (replyError) {
        console.error('[REPLY FAIL] Error sending error reply for summarize:', replyError);
      }
    }
  } else {
    console.log(`[COMMAND NO MATCH] Received command "${commandName}" but no handler found.`);
  }
});

// Chat history file storage
const CHAT_HISTORY_DIR = path.join(process.cwd(), 'chat_history');
const MAX_HISTORY = 1000;

// Ensure chat_history directory exists
if (!fs.existsSync(CHAT_HISTORY_DIR)) {
  fs.mkdirSync(CHAT_HISTORY_DIR);
}

function getChatHistoryPath(channelId) {
  return path.join(CHAT_HISTORY_DIR, `chat_history_${channelId}.json`);
}

function loadChatHistory(channelId) {
  const filePath = getChatHistoryPath(channelId);
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Failed to load chat history:', err);
      return [];
    }
  }
  return [];
}

function saveChatHistory(channelId, history) {
  const filePath = getChatHistoryPath(channelId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save chat history:', err);
  }
}

client.on('messageCreate', async (message) => {

  // Utility to download an image from a URL as a Buffer
  async function downloadImageToBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download image: ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;
  if (message.channel.id !== '1368705925808132136') {
    console.log(`Message received in unauthorized channel ${message.channel.id}. Ignoring.`);
    return;
  }

  // --- Chat history logic start ---
  let chat_history = loadChatHistory(message.channel.id);
  chat_history.push({
    role: "user",
    content: message.content,
    author: message.author.tag
  });
  if (chat_history.length > MAX_HISTORY) {
    // Reset history when exceeding max
    chat_history = [];
  }
  saveChatHistory(message.channel.id, chat_history);
  // --- Chat history logic end ---

  console.log('---');
  console.log(`[${new Date().toISOString()}] Message received:`, message.content);
  console.log(`From user: ${message.author.tag} (ID: ${message.author.id}) in channel: ${message.channel.id}`);
  console.log(`Current history length for channel ${message.channel.id}:`, chat_history.length);

  let reply;
  let inputTokenCount = 0;
  let outputTokenCount = 0;
  try {
    // Prepare chat history for models
    // For OpenRouter: array of {role, content}
    // For Gemini: array of strings or {role, parts}
    // const openrouter_history = chat_history.map(m => ({ role: m.role, content: m.content }));
    const gemini_history = chat_history.map(m => `${m.role === "user" ? m.author : "Bot"}: ${m.content}`);

    // Collect image attachments (Discord)
    let images = [];
    if (message.attachments && message.attachments.size > 0) {
      for (const [, attachment] of message.attachments) {
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          try {
            const imgBuffer = await downloadImageToBuffer(attachment.url);
            const base64 = imgBuffer.toString('base64');
            images.push({
              inlineData: {
                data: base64,
                mimeType: attachment.contentType
              }
            });
          } catch (err) {
            console.error('Failed to download/process image attachment:', err);
          }
        }
      }
    }

    const geminiResult = await askGeminiWithGroundingHistory(gemini_history, images);
    reply = geminiResult.text;
    inputTokenCount = geminiResult.promptTokenCount ?? countTokens(gemini_history.join("\n"));
    outputTokenCount = geminiResult.candidatesTokenCount ?? countTokens(reply);
    console.log('Gemini reply:', reply);
    // }
  } catch (err) {
    console.error('Error during model call:', err);
    reply = 'Sorry, an error occurred while processing your request.';
  }

  try {
    // Store bot reply in chat history
    chat_history.push({
      role: "assistant",
      content: reply,
      author: "Bot"
    });
    if (chat_history.length > MAX_HISTORY) {
      chat_history = [];
    }
    saveChatHistory(message.channel.id, chat_history);

    // Build and send embed
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Bot Response')
      .setDescription(reply || 'Error: No reply generated.')
      .addFields(
        { name: 'Input Token Count', value: inputTokenCount.toString(), inline: true },
        { name: 'Output Token Count', value: outputTokenCount.toString(), inline: true }
      )
      .setTimestamp();

    if (shouldReplyInThread) {
      let threadName = message.content.substring(0, 30).trim();
      if (!threadName) threadName = "Discussion";
      const thread = await message.startThread({ name: threadName, autoArchiveDuration: 60 });
      await thread.send({ embeds: [embed] });
      console.log('Replied in new thread successfully.');
    } else {
      await message.reply({ embeds: [embed] });
      console.log('Replied to Discord successfully.');
    }
  } catch (err) {
    console.error('Failed to reply to Discord:', err);
  }
  console.log('---');
});

// Utility: Estimate token count (very rough, for demonstration)
function countTokens(text) {
  if (!text) return 0;
  // Split on whitespace and punctuation, similar to GPT tokenization
  return text.split(/\s+|(?=\W)|(?<=\W)/g).filter(Boolean).length;
}

client.login(DISCORD_TOKEN);