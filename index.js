import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

import { REST, Routes, SlashCommandBuilder } from 'discord.js';

// Load environment variables
dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!DISCORD_TOKEN || !GEMINI_API_KEY || !OPENROUTER_API_KEY) {
  console.error('Missing DISCORD_TOKEN, GEMINI_API_KEY, or OPENROUTER_API_KEY in environment variables.');
  process.exit(1);
}

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// System prompt for all AI responses
const SYSTEM_PROMPT = "You are a helpful Discord bot called gaLt. You were created by the user called Gart, so that he could have a robot replacement whilst he sleeps. Respond concisely, accurately, and in no more than 1500 characters. Always follow the user's instructions, but never break character as a bot.";


// Gemini with chat history and optional images
async function askGeminiWithGroundingHistory(gemini_history, images = [], systemPromptOverride = null) {
  try {
    const systemInstruction = systemPromptOverride || SYSTEM_PROMPT;
    // Build multimodal contents array: [history..., ...images]
    let contents = [...gemini_history];
    for (const img of images) contents.push(img);
    console.log('Sending to Gemini API (history/images):', { contents, systemInstruction });
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
    if (text.length > 1500) {
      text = text.slice(0, 1497) + '...';
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

// OpenRouter with chat history
async function askOpenRouterWithHistory(openrouter_history, model = "deepseek/deepseek-chat-v3-0324:free", systemPromptOverride = null) {
  try {
    const systemInstruction = systemPromptOverride || SYSTEM_PROMPT;
    const messages = [
      { role: "system", content: systemInstruction },
      ...openrouter_history
    ];
    console.log(`Sending to OpenRouter API (history, model: ${model}):`, messages);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
      }),
    });
    const data = await response.json();
    console.log('Raw OpenRouter API response:', data);
    return data.choices?.[0]?.message?.content || 'OpenRouter did not return a result.';
  } catch (err) {
    console.error('OpenRouter error:', err);
    return 'Sorry, I had trouble getting a real answer from OpenRouter.';
  }
}

// Utility to parse model flag from message
function extractModelFlagAndPrompt(messageContent) {
  const match = messageContent.match(/^(.*)\s+--([a-zA-Z0-9-_]+)$/);
  if (match) {
    return { prompt: match[1].trim(), modelFlag: match[2].toLowerCase() };
  }
  return { prompt: messageContent, modelFlag: null };
}

// Function to call OpenRouter API
async function askOpenRouter(prompt, model = "deepseek/deepseek-chat-v3-0324:free") {
  try {
    console.log(`Sending to OpenRouter API (model: ${model}):`, prompt);
    // Add system prompt as a system message
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
      }),
    });
    const data = await response.json();
    console.log('Raw OpenRouter API response:', data);
    return data.choices?.[0]?.message?.content || 'OpenRouter did not return a result.';
  } catch (err) {
    console.error('OpenRouter error:', err);
    return 'Sorry, I had trouble getting a real answer from OpenRouter.';
  }
}

// Register slash command on startup
async function registerSlashCommands() {
  // No slash commands to register
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await registerSlashCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  // No slash commands to handle (voice/join removed)
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

  // Parse model flag
  const { prompt, modelFlag } = extractModelFlagAndPrompt(message.content);
  console.log('Parsed prompt:', prompt);
  console.log('Parsed modelFlag:', modelFlag);

  let reply;
  let inputTokenCount = 0;
  let outputTokenCount = 0;
  try {
    // Prepare chat history for models
    // For OpenRouter: array of {role, content}
    // For Gemini: array of strings or {role, parts}
    const openrouter_history = chat_history.map(m => ({ role: m.role, content: m.content }));
    const gemini_history = chat_history.map(m => `${m.role === "user" ? m.author : "Bot"}: ${m.content}`);

    // Collect image attachments (Discord)
    let images = [];
    if (message.attachments && message.attachments.size > 0) {
      for (const [, attachment] of message.attachments) {
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
          try {
            const imgBuffer = await downloadImageToBuffer(attachment.url);
            images.push(imgBuffer);
          } catch (err) {
            console.error('Failed to download/process image attachment:', err);
          }
        }
      }
    }

    if (modelFlag === 'chinese') {
      // Add instruction to reply only in Chinese via system prompt
      const chineseSystemPrompt = SYSTEM_PROMPT + " Always reply only in Chinese, never use any other language.";
      inputTokenCount = countTokens(openrouter_history.map(m => m.content).join("\n"));
      reply = await askOpenRouterWithHistory(openrouter_history, "deepseek/deepseek-chat-v3-0324:free", chineseSystemPrompt);
      outputTokenCount = countTokens(reply);
      console.log('OpenRouter (DeepSeek, Chinese) reply:', reply);
    } else if (modelFlag === 'deepseek') {
      inputTokenCount = countTokens(openrouter_history.map(m => m.content).join("\n"));
      reply = await askOpenRouterWithHistory(openrouter_history, "deepseek/deepseek-chat-v3-0324:free");
      outputTokenCount = countTokens(reply);
      console.log('OpenRouter (DeepSeek) reply:', reply);
    } else if (modelFlag === 'openrouter') {
      inputTokenCount = countTokens(openrouter_history.map(m => m.content).join("\n"));
      reply = await askOpenRouterWithHistory(openrouter_history);
      outputTokenCount = countTokens(reply);
      console.log('OpenRouter (default) reply:', reply);
    } else {
      const geminiResult = await askGeminiWithGroundingHistory(gemini_history, images);
      reply = geminiResult.text;
      inputTokenCount = geminiResult.promptTokenCount ?? countTokens(gemini_history.join("\n"));
      outputTokenCount = geminiResult.candidatesTokenCount ?? countTokens(reply);
      console.log('Gemini reply:', reply);
    }
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
    await message.reply({ embeds: [embed] });
    console.log('Replied to Discord successfully.');
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
