import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// Load environment variables
dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
  console.error('Missing DISCORD_TOKEN or GEMINI_API_KEY in environment variables.');
  process.exit(1);
}

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// List of unhelpful fake responses
const fakeResponses = [
  "I'm jerking it",
  "Who's up jerkin it rn??!!?!",
  "Magic 8 Ball says No",
  "Ask me again later.",
  "League. Of Legends.",
  "Theoden Lysander Aspinall",
  "no response.. too busy... e-sex....",
  "Womp womp",
  "It's literally free loot",
  "That's a great question for someone else!"
];

function getRandomFakeResponse() {
  return fakeResponses[Math.floor(Math.random() * fakeResponses.length)];
}

function shouldUseGemini() {
  // 10% chance
  return Math.random() < 0.1;
}

async function askGeminiWithGrounding(prompt) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [prompt],
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const text = response.text || 'Gemini did not return a result.';
    let grounding = '';
    if (
      response.candidates &&
      response.candidates[0] &&
      response.candidates[0].groundingMetadata &&
      response.candidates[0].groundingMetadata.searchEntryPoint &&
      response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent
    ) {
      grounding = '\n\n**Grounded Web Content:**\n' + response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent;
    }
    return text + grounding;
  } catch (err) {
    console.error('Gemini error:', err);
    return 'Sorry, I had trouble getting a real answer this time.';
  }
}

client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Only respond if the bot is mentioned
  if (!message.mentions.has(client.user)) return;

  if (shouldUseGemini()) {
    try {
      const geminiReply = await askGeminiWithGrounding(message.content);
      message.reply(geminiReply);
    } catch (err) {
      console.error('Gemini error:', err);
      message.reply('Sorry, I had trouble getting a real answer this time.');
    }
  } else {
    // 90% of the time, reply with a fake, unhelpful message
    message.reply(getRandomFakeResponse());
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.login(DISCORD_TOKEN);
