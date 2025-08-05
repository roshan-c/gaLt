import { Client, GatewayIntentBits, Events, Message, TextBasedChannel } from 'discord.js';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { MemoryManager } from './src/memory/MemoryManager';
import { ToolRegistry } from './src/tools/ToolRegistry';
import type { BotConfig, ConversationMessage, ToolResult } from './src/types/BotConfig';
import { exampleTool, calculatorTool, timeTool } from './src/tools/examples/ExampleTool';
import { weatherTool, randomFactTool } from './src/tools/examples/WeatherTool';

// Load environment variables
const config: BotConfig = {
  discordToken: process.env.DISCORD_TOKEN!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
};

// Validate environment variables
if (!config.discordToken) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}
if (!config.openaiApiKey) {
  throw new Error('OPENAI_API_KEY environment variable is required');
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize LangChain OpenAI model
const llm = new ChatOpenAI({
  openAIApiKey: config.openaiApiKey,
  modelName: config.openaiModel,
  temperature: 0.7,
});

// Initialize memory manager
const memoryManager = new MemoryManager();

// Initialize tool registry and register example tools
const toolRegistry = new ToolRegistry();
toolRegistry.registerTool(calculatorTool);
toolRegistry.registerTool(timeTool);
toolRegistry.registerTool(weatherTool);
toolRegistry.registerTool(randomFactTool);

// Bind tools to the LLM
const llmWithTools = llm.bindTools(toolRegistry.getToolDefinitions());

// Bot ready event
client.once(Events.ClientReady, (readyClient) => {
  console.log(`🚀 ${readyClient.user.tag} is online and ready!`);
  console.log(`📊 Registered ${toolRegistry.getToolCount()} tools`);
});

// Message handling
client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore messages from bots
  if (message.author.bot) return;
  
  // Only respond when bot is mentioned
  if (!message.mentions.has(client.user!)) return;
  
  try {
    // Clean the message content (remove the mention)
    const cleanContent = message.content
      .replace(`<@${client.user!.id}>`, '')
      .replace(`<@!${client.user!.id}>`, '')
      .trim();
    
    if (!cleanContent) {
      await message.reply('Hello! How can I help you today?');
      return;
    }
    
    // Show typing indicator
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }
    
    // Get conversation history from memory
    const conversationHistory = await memoryManager.getHistory(
      message.author.id,
      message.channel.id
    );
    
    // Add user message to history
    await memoryManager.addMessage(
      message.author.id,
      message.channel.id,
      'user',
      cleanContent
    );
    
    // Prepare messages for LangChain
    const messages = [
      ...conversationHistory.map((msg: ConversationMessage) => 
        msg.role === 'user' 
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
      new HumanMessage(cleanContent)
    ];
    
    // Get response from LangChain with tools
    const response = await llmWithTools.invoke(messages);
    
    // Handle tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Execute tools
      const toolResults = await toolRegistry.executeTools(response.tool_calls);
      
      // Add tool results to conversation and get final response
      const toolMessages = toolResults.map((result: ToolResult) => result.message);
      const finalResponse = await llmWithTools.invoke([
        ...messages,
        response,
        ...toolMessages
      ]);
      
      // Add final response to memory
      await memoryManager.addMessage(
        message.author.id,
        message.channel.id,
        'assistant',
        finalResponse.content as string
      );
      
      // Send response to Discord
      await message.reply(finalResponse.content as string);
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
      
      // Send response to Discord
      await message.reply(responseContent);
    }
    
  } catch (error) {
    console.error('Error processing message:', error);
    await message.reply('Sorry, I encountered an error while processing your message. Please try again.');
  }
});

// Error handling
client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(config.discordToken);