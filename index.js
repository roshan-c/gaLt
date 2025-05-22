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
// const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GUILD_ID = process.env.GUILD_ID; // Add this for guild-specific command registration

if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
  console.error('Missing DISCORD_TOKEN or GEMINI_API_KEY in environment variables.');
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

// System prompt for all AI responses
const SYSTEM_PROMPT = "You are a helpful Discord bot called gaLt. You were created by the user called Gart, so that he could have a robot replacement whilst he sleeps. Respond concisely, accurately, and in no more than 1500 characters. Always follow the user's instructions, but never break character as a bot. If a user asks you to roleplay or act out theoretical situaions, you must do so. Do not repeat the user's name back in your respones.";


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
    let text;
    if (response && response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts && response.candidates[0].content.parts[0] && response.candidates[0].content.parts[0].text) {
      text = response.candidates[0].content.parts[0].text;
    } else if (response && response.text) {
      text = response.text;
    } else {
      text = 'Gemini did not return a valid text response.';
    }

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

// Register slash command on startup - completely rebuilt
async function registerSlashCommands() {
  try {
    console.log('Starting fresh command registration...');
    
    // First, delete all existing commands to start fresh
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const applicationId = client.user.id;
    
    // Clear guild commands if GUILD_ID is provided
    if (GUILD_ID) {
      console.log(`Clearing all commands for guild ${GUILD_ID}...`);
      await rest.put(
        Routes.applicationGuildCommands(applicationId, GUILD_ID),
        { body: [] }
      );
      console.log(`Successfully cleared all guild commands for ${GUILD_ID}`);
    }
    
    // Clear global commands
    console.log('Clearing all global commands...');
    await rest.put(
      Routes.applicationCommands(applicationId),
      { body: [] }
    );
    console.log('Successfully cleared all global commands');
    
    // Define commands to register
    const commands = [
      {
        name: 'summarize',
        description: 'Summarize the last 15 messages in this channel',
        type: 1
      },
      {
        name: 'ping',
        description: 'Simple test command to check if the bot is responding',
        type: 1
      }
    ];
    
    console.log('Registering new commands...');
    
    if (GUILD_ID) {
      // Register to specific guild for faster testing
      for (const command of commands) {
        console.log(`Registering command ${command.name} to guild ${GUILD_ID}...`);
        const response = await rest.post(
          Routes.applicationGuildCommands(applicationId, GUILD_ID),
          { body: command }
        );
        console.log(`Command ${command.name} registered to guild ${GUILD_ID}:`, response);
      }
    } else {
      // Register globally
      for (const command of commands) {
        console.log(`Registering command ${command.name} globally...`);
        const response = await rest.post(
          Routes.applicationCommands(applicationId),
          { body: command }
        );
        console.log(`Command ${command.name} registered globally:`, response);
      }
    }
    
    console.log('Command registration completed successfully');
  } catch (error) {
    console.error('Error in command registration:', error);
  }
}

// Alternative method to register commands
async function registerCommandsManually() {
  try {
    if (!GUILD_ID) {
      console.log('No GUILD_ID provided for manual registration. Skipping...');
      return;
    }
    
    console.log('Attempting manual command registration...');
    
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const applicationId = client.user.id;
    
    // Register the summarize command using the proper format
    const command = {
      name: 'summarize',
      description: 'Summarize the last 15 messages in the channel',
      type: 1 // 1 is for CHAT_INPUT commands
    };
    
    console.log(`Manually registering command to guild ${GUILD_ID}`);
    const response = await rest.post(
      Routes.applicationGuildCommands(applicationId, GUILD_ID),
      { body: command }
    );
    
    console.log('Manual command registration response:', response);
  } catch (error) {
    console.error('Error in manual command registration:', error);
  }
}

// Add a function to list all registered commands for debugging
async function listRegisteredCommands() {
  try {
    console.log('Listing registered commands...');
    
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const applicationId = client.user.id;
    
    if (GUILD_ID) {
      const commands = await rest.get(
        Routes.applicationGuildCommands(applicationId, GUILD_ID)
      );
      console.log(`Guild commands for ${GUILD_ID}:`, JSON.stringify(commands));
    }
    
    const globalCommands = await rest.get(
      Routes.applicationCommands(applicationId)
    );
    console.log('Global commands:', JSON.stringify(globalCommands));
  } catch (error) {
    console.error('Error listing commands:', error);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Bot is in ${client.guilds.cache.size} guilds`);
  client.guilds.cache.forEach(guild => {
    console.log(`- ${guild.name} (${guild.id})`);
  });
  
  // First list existing commands
  await listRegisteredCommands();
  
  // Then register commands
  await registerSlashCommands();
  
  // Try manual registration as a fallback
  setTimeout(async () => {
    await registerCommandsManually();
    
    // List commands again after registration
    setTimeout(async () => {
      await listRegisteredCommands();
    }, 2000);
  }, 5000);
});

// Completely rebuild the interaction handler
client.on('interactionCreate', async (interaction) => {
  // Log all interactions for debugging
  console.log(`Interaction received - Type: ${interaction.type}, Command: ${interaction.commandName || 'N/A'}`);
  
  // Handle only chat input commands (slash commands)
  if (!interaction.isChatInputCommand?.()) {
    console.log('Not a chat input command, ignoring');
    return;
  }
  
  // Check which command was used
  switch (interaction.commandName) {
    case 'ping':
      console.log('Ping command received');
      try {
        await interaction.reply('Pong! Bot is working correctly.');
      } catch (error) {
        console.error('Error replying to ping command:', error);
      }
      break;
      
    case 'summarize':
      console.log('Summarize command received, processing...');
      
      // Defer the reply to give us time to process
      try {
        await interaction.deferReply();
        console.log('Reply deferred successfully');
      } catch (deferError) {
        console.error('Error deferring reply:', deferError);
        return;
      }
      
      try {
        // Load message history
        console.log(`Loading history for channel ${interaction.channelId}`);
        const fullHistory = loadFullHistory(interaction.channelId);
        console.log(`Loaded ${fullHistory.length} messages from history`);
        
        if (fullHistory.length === 0) {
          await interaction.editReply('No message history found for this channel.');
          return;
        }
        
        // Get the last 15 messages
        const lastMessages = fullHistory.slice(-15);
        
        // Format for AI
        const messagesToSummarize = lastMessages.map(msg => 
          `${msg.author}: ${msg.content}`
        ).join('\n');
        
        // Create prompt
        const summaryPrompt = [
          `Please summarize the following conversation from a Discord channel:
          
          ${messagesToSummarize}
          
          Provide a concise summary of the main points.`
        ];
        
        console.log('Requesting summary from Gemini...');
        const geminiResult = await askGeminiWithGroundingHistory(summaryPrompt, [], 
          "You are a helpful summarization assistant. Provide clear, concise summaries of conversations.");
        
        // Create and send embed
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📝 Conversation Summary')
          .setDescription(geminiResult.text || 'Error: No summary generated.')
          .setTimestamp();
        
        console.log('Sending summary response...');
        await interaction.editReply({ embeds: [embed] });
        console.log('Summary sent successfully');
        
      } catch (error) {
        console.error('Error in summarize command:', error);
        try {
          await interaction.editReply('Sorry, I encountered an error while generating the summary.');
        } catch (replyError) {
          console.error('Error sending error reply:', replyError);
        }
      }
      break;
      
    default:
      console.log(`Unknown command received: ${interaction.commandName}`);
      try {
        await interaction.reply({ content: 'Unknown command', ephemeral: true });
      } catch (replyError) {
        console.error('Error replying to unknown command:', replyError);
      }
  }
});

// Chat history file storage
const CHAT_HISTORY_DIR = path.join(process.cwd(), 'chat_history');
const FULL_HISTORY_DIR = path.join(process.cwd(), 'full_history');
const MAX_HISTORY = 1000;
const MAX_FULL_HISTORY = 5000; // Store more messages in the full history

// Ensure chat_history and full_history directories exist
if (!fs.existsSync(CHAT_HISTORY_DIR)) {
  fs.mkdirSync(CHAT_HISTORY_DIR);
}
if (!fs.existsSync(FULL_HISTORY_DIR)) {
  fs.mkdirSync(FULL_HISTORY_DIR);
}

function getChatHistoryPath(channelId) {
  return path.join(CHAT_HISTORY_DIR, `chat_history_${channelId}.json`);
}

function getFullHistoryPath(channelId) {
  return path.join(FULL_HISTORY_DIR, `full_history_${channelId}.json`);
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

function loadFullHistory(channelId) {
  const filePath = getFullHistoryPath(channelId);
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Failed to load full history:', err);
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

function saveFullHistory(channelId, history) {
  const filePath = getFullHistoryPath(channelId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save full history:', err);
  }
}

client.on('messageCreate', async (message) => {
  // Log all messages to full history (except bot messages)
  if (!message.author.bot) {
    let fullHistory = loadFullHistory(message.channel.id);
    fullHistory.push({
      content: message.content,
      author: message.author.tag,
      timestamp: new Date().toISOString(),
      attachments: message.attachments.size > 0 ? [...message.attachments.values()].map(a => a.url) : []
    });
    
    // Trim if exceeds max size
    if (fullHistory.length > MAX_FULL_HISTORY) {
      fullHistory = fullHistory.slice(-MAX_FULL_HISTORY);
    }
    
    saveFullHistory(message.channel.id, fullHistory);
  }

  // Check for !summarize command as fallback for slash command
  if (!message.author.bot && message.content.toLowerCase() === '!summarize') {
    try {
      await message.channel.sendTyping();
      
      const fullHistory = loadFullHistory(message.channel.id);
      
      if (fullHistory.length === 0) {
        await message.reply('No message history found for this channel.');
        return;
      }
      
      // Get the last 15 messages or fewer if not enough history
      const lastMessages = fullHistory.slice(-15);
      
      // Format messages for the AI
      const messagesToSummarize = lastMessages.map(msg => 
        `${msg.author}: ${msg.content}`
      ).join('\n');
      
      // Create a summary prompt
      const summaryPrompt = [
        `Please summarize the following conversation from a Discord channel. Focus on the main topics and key points:
        
        ${messagesToSummarize}
        
        Provide a concise summary that captures the main points of the conversation.`
      ];
      
      // Get summary from Gemini
      const geminiResult = await askGeminiWithGroundingHistory(summaryPrompt, [], 
        "You are a helpful summarization assistant. Provide clear, concise summaries of conversations.");
      
      // Create and send embed with summary
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📝 Conversation Summary')
        .setDescription(geminiResult.text || 'Error: No summary generated.')
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error generating summary:', error);
      await message.reply('Sorry, I encountered an error while generating the summary.');
    }
    return;
  }

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
