import { ConversationMessage } from '../types/BotConfig';

export class MemoryManager {
  private conversations: Map<string, ConversationMessage[]> = new Map();
  private readonly maxHistoryLength = 50; // Maximum messages to keep in memory per conversation

  private getConversationKey(userId: string, channelId: string): string {
    return `${userId}-${channelId}`;
  }

  async addMessage(
    userId: string,
    channelId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    const key = this.getConversationKey(userId, channelId);
    const conversations = this.conversations.get(key) || [];

    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      userId,
      channelId,
      role,
      content,
      timestamp: new Date(),
    };

    conversations.push(message);

    // Keep only the most recent messages
    if (conversations.length > this.maxHistoryLength) {
      conversations.splice(0, conversations.length - this.maxHistoryLength);
    }

    this.conversations.set(key, conversations);
  }

  async getHistory(
    userId: string,
    channelId: string,
    limit?: number
  ): Promise<ConversationMessage[]> {
    const key = this.getConversationKey(userId, channelId);
    const conversations = this.conversations.get(key) || [];
    
    if (limit && limit > 0) {
      return conversations.slice(-limit);
    }
    
    return conversations;
  }

  async clearHistory(userId: string, channelId: string): Promise<void> {
    const key = this.getConversationKey(userId, channelId);
    this.conversations.delete(key);
  }

  async getAllConversations(): Promise<Map<string, ConversationMessage[]>> {
    return new Map(this.conversations);
  }

  async getConversationCount(): Promise<number> {
    return this.conversations.size;
  }

  async getTotalMessageCount(): Promise<number> {
    let total = 0;
    for (const conversations of this.conversations.values()) {
      total += conversations.length;
    }
    return total;
  }

  // Advanced RAG features could be added here:
  // - Vector embeddings for semantic search
  // - Message summarization for long conversations
  // - External storage integration (Redis, PostgreSQL, etc.)
  // - Contextual retrieval based on relevance
}