import { ChromaClient } from 'chromadb';
import type { Collection } from 'chromadb';
import type { ConversationMessage } from '../types/BotConfig';
import OpenAI from 'openai';

export class MemoryManager {
  private conversations: Map<string, ConversationMessage[]> = new Map();
  private readonly maxHistoryLength = 50;
  private readonly recentContextLimit = 15;
  private readonly ragContextLimit = 10;
  private chromaClient: ChromaClient;
  private collection: Collection | null = null;
  private openai: OpenAI;
  constructor() {
    // Parse CHROMA_URL or use defaults
    const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
    const url = new URL(chromaUrl);
    
    this.chromaClient = new ChromaClient({
      host: url.hostname,
      port: url.port ? parseInt(url.port) : 8000,
      ssl: url.protocol === 'https:'
    });
    
    // Initialize OpenAI for embeddings
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!
    });
    
    this.initializeCollection();
  }

  private async initializeCollection(): Promise<void> {
    try {
      // Use null embedding function to avoid local model issues
      // Embeddings will be generated and supplied by the application code (using OpenAI), not by ChromaDB's internal embedding function
      this.collection = await this.chromaClient.getOrCreateCollection({
        name: 'discord_conversations',
        embeddingFunction: null
      });
      
      console.log('✅ ChromaDB collection initialized (manual embeddings)');
    } catch (error) {
      console.error('❌ Failed to initialize ChromaDB collection:', error);
      console.log('🔄 Continuing with basic memory only');
    }
  }

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

    if (conversations.length > this.maxHistoryLength) {
      conversations.splice(0, conversations.length - this.maxHistoryLength);
    }

    this.conversations.set(key, conversations);

    // Store in ChromaDB for RAG (async, don't block)
    this.storeInRAG(message).catch(error => {
      console.error('Failed to store message in RAG:', error);
    });
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text
      });
      const embedding = response?.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error('No embedding returned');
      }
      return embedding as unknown as number[];
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  private async storeInRAG(message: ConversationMessage): Promise<void> {
    if (!this.collection) return;

    try {
      const embedding = await this.generateEmbedding(message.content);
      
      await this.collection.add({
        ids: [message.id],
        embeddings: [embedding],
        documents: [message.content],
        metadatas: [{
          userId: message.userId,
          channelId: message.channelId,
          role: message.role,
          timestamp: message.timestamp.toISOString()
        }]
      });
    } catch (error) {
      console.error('Failed to add message to ChromaDB:', error);
    }
  }

  async getEnhancedHistory(
    userId: string,
    channelId: string,
    currentMessage?: string
  ): Promise<ConversationMessage[]> {
    const key = this.getConversationKey(userId, channelId);
    const conversations = this.conversations.get(key) || [];

    // Get recent context (last 15 messages)
    const recentMessages = conversations.slice(-this.recentContextLimit);
    
    // Get RAG context if ChromaDB is available and we have a current message
    let ragMessages: ConversationMessage[] = [];
    if (this.collection && currentMessage) {
      ragMessages = await this.getSimilarMessages(userId, channelId, currentMessage, recentMessages);
    }

    // Combine and deduplicate
    const combinedMessages = [...recentMessages, ...ragMessages];
    const uniqueMessages = this.deduplicateMessages(combinedMessages);
    
    // Sort by timestamp
    return uniqueMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private async getSimilarMessages(
    userId: string,
    channelId: string,
    queryText: string,
    excludeMessages: ConversationMessage[]
  ): Promise<ConversationMessage[]> {
    if (!this.collection) return [];

    try {
      const excludeIds = excludeMessages.map(msg => msg.id);
      
      const queryEmbedding = await this.generateEmbedding(queryText);
      
      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: this.ragContextLimit,
        where: {
          $and: [
            { userId: { $eq: userId } },
            { channelId: { $eq: channelId } }
          ]
        }
      });

      if (!results.ids?.[0] || !results.documents?.[0] || !results.metadatas?.[0]) {
        return [];
      }

      const similarMessages: ConversationMessage[] = [];
      
      for (let i = 0; i < results.ids[0].length; i++) {
        const id = results.ids[0][i];
        const document = results.documents[0][i];
        const metadata = results.metadatas[0][i] as any;
        
        // Skip if this message is already in recent context
        if (!id || !document || !metadata || excludeIds.includes(id)) continue;
        
        similarMessages.push({
          id,
          userId: metadata.userId || userId,
          channelId: metadata.channelId || channelId,
          role: metadata.role || 'user',
          content: document,
          timestamp: new Date(metadata.timestamp || Date.now())
        });
      }
      
      return similarMessages;
    } catch (error) {
      console.error('Failed to query similar messages:', error);
      return [];
    }
  }

  private deduplicateMessages(messages: ConversationMessage[]): ConversationMessage[] {
    const seen = new Set<string>();
    return messages.filter(msg => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
  }

  // Keep existing methods for backward compatibility
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
}