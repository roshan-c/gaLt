import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import fetch from 'node-fetch';

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

async function askGeminiWithGrounding(prompt) {
  try {
    const limitedPrompt = `${prompt}\n\nPlease answer in no more than 1500 characters.`;
    console.log('Sending to Gemini API:', limitedPrompt);
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [limitedPrompt],
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    console.log('Raw Gemini API response:', response);
    let text = response.text || 'Gemini did not return a result.';
    if (text.length > 1500) {
      text = text.slice(0, 1497) + '...';
    }
    return text;
  } catch (err) {
    console.error('Gemini error:', err);
    return 'Sorry, I had trouble getting a real answer this time.';
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
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;
  if (message.channel.id !== '1368705925808132136') {
    console.log(`Message received in unauthorized channel ${message.channel.id}. Ignoring.`);
    return;
  }

  console.log('---');
  console.log(`[${new Date().toISOString()}] Message received:`, message.content);
  console.log(`From user: ${message.author.tag} (ID: ${message.author.id}) in channel: ${message.channel.id}`);

  // Parse model flag
  const { prompt, modelFlag } = extractModelFlagAndPrompt(message.content);
  console.log('Parsed prompt:', prompt);
  console.log('Parsed modelFlag:', modelFlag);

  let reply;
  try {
    if (modelFlag === 'chinese') {
      // Add instruction to reply only in Chinese
      const chinesePrompt = `${prompt}\n\n请只用中文回答，不要用其他语言。`;
      console.log('Selected model: DeepSeek (Chinese mode) via OpenRouter');
      console.log('Prompt to OpenRouter (Chinese):', chinesePrompt);
      reply = await askOpenRouter(chinesePrompt, "deepseek/deepseek-chat-v3-0324:free");
      console.log('OpenRouter (DeepSeek, Chinese) reply:', reply);
    } else if (modelFlag === 'deepseek') {
      console.log('Selected model: DeepSeek via OpenRouter');
      console.log('Prompt to OpenRouter:', prompt);
      reply = await askOpenRouter(prompt, "deepseek/deepseek-chat-v3-0324:free");
      console.log('OpenRouter (DeepSeek) reply:', reply);
    } else if (modelFlag === 'openrouter') {
      console.log('Selected model: OpenRouter default');
      console.log('Prompt to OpenRouter:', prompt);
      reply = await askOpenRouter(prompt);
      console.log('OpenRouter (default) reply:', reply);
    } else {
      console.log('Selected model: Gemini');
      console.log('Prompt to Gemini:', prompt);
      reply = await askGeminiWithGrounding(prompt);
      console.log('Gemini reply:', reply);
    }
  } catch (err) {
    console.error('Error during model call:', err);
    reply = 'Sorry, an error occurred while processing your request.';
  }

  try {
    await message.reply(reply);
    console.log('Replied to Discord successfully.');
  } catch (err) {
    console.error('Failed to reply to Discord:', err);
  }
  console.log('---');
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.login(DISCORD_TOKEN);
