export interface BotConfig {
  discordToken: string;
  googleApiKey: string;
  googleModel: string;
}

export interface ConversationMessage {
  id: string;
  userId: string;
  channelId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  id?: string;
}

export interface ToolResult {
  success: boolean;
  result: any;
  error?: string;
  message: any; // LangChain ToolMessage
}