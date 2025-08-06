import { EmbedBuilder, Message } from 'discord.js';

export interface EmbedChunk {
  title?: string;
  description: string;
  color?: number;
  footer?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class EmbedResponse {
  private static readonly MAX_EMBED_DESCRIPTION = 4096;
  private static readonly MAX_EMBEDS_PER_MESSAGE = 10;
  private static readonly DEFAULT_COLOR = 0x5865F2; // Discord Blurple

  static async sendLongResponse(
    message: Message,
    content: string,
    options?: {
      title?: string;
      color?: number;
      includeContext?: boolean;
      toolsUsed?: string[];
      tokenUsage?: TokenUsage;
    }
  ): Promise<void> {
    const chunks = this.chunkContent(content);
    const embeds: EmbedBuilder[] = [];

    for (let i = 0; i < chunks.length && i < this.MAX_EMBEDS_PER_MESSAGE; i++) {
      const chunk = chunks[i];
      
      // Add tool usage and token info to the last chunk
      let description = chunk;
      if (i === chunks.length - 1) {
        const footerInfo: string[] = [];
        
        // Add tool usage
        if (options?.toolsUsed && options.toolsUsed.length > 0) {
          footerInfo.push(`Used tools: ${options.toolsUsed.join(', ')}`);
        }
        
        // Add token usage
        if (options?.tokenUsage) {
          const { inputTokens, outputTokens, totalTokens } = options.tokenUsage;
          footerInfo.push(`Tokens: ${inputTokens} in, ${outputTokens} out, ${totalTokens} total`);
        }
        
        if (footerInfo.length > 0) {
          description += `\n\n*${footerInfo.join(' • ')}*`;
        }
      }
      
      const embed = new EmbedBuilder()
        .setDescription(description)
        .setColor(options?.color || this.DEFAULT_COLOR);

      // Add title only to first embed
      if (i === 0 && options?.title) {
        embed.setTitle(options.title);
      }

      // Add page indicator if multiple chunks
      if (chunks.length > 1) {
        embed.setFooter({ 
          text: `Page ${i + 1} of ${Math.min(chunks.length, this.MAX_EMBEDS_PER_MESSAGE)}` 
        });
      }

      // Add context indicator to first embed
      if (i === 0 && options?.includeContext) {
        embed.setAuthor({ 
          name: '🧠 Enhanced with conversation memory',
          iconURL: message.client.user?.displayAvatarURL()
        });
      }

      embeds.push(embed);
    }

    // Send embeds (Discord allows up to 10 embeds per message)
    try {
      await message.reply({ embeds });
    } catch (error) {
      console.error('Failed to send embed response:', error);
      // Fallback to simple text response
      const truncated = content.length > 2000 
        ? content.substring(0, 1997) + '...'
        : content;
      await message.reply(truncated);
    }
  }

  static chunkContent(content: string): string[] {
    if (content.length <= this.MAX_EMBED_DESCRIPTION) {
      return [content];
    }

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= this.MAX_EMBED_DESCRIPTION) {
        chunks.push(remaining);
        break;
      }

      // Find a good breaking point (prefer line breaks, then sentences, then words)
      let breakPoint = this.MAX_EMBED_DESCRIPTION;
      const chunk = remaining.substring(0, this.MAX_EMBED_DESCRIPTION);

      // Look for line breaks
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > this.MAX_EMBED_DESCRIPTION * 0.7) {
        breakPoint = lastNewline;
      } else {
        // Look for sentence endings
        const lastSentence = Math.max(
          chunk.lastIndexOf('. '),
          chunk.lastIndexOf('! '),
          chunk.lastIndexOf('? ')
        );
        if (lastSentence > this.MAX_EMBED_DESCRIPTION * 0.7) {
          breakPoint = lastSentence + 1;
        } else {
          // Look for word boundaries
          const lastSpace = chunk.lastIndexOf(' ');
          if (lastSpace > this.MAX_EMBED_DESCRIPTION * 0.7) {
            breakPoint = lastSpace;
          }
        }
      }

      chunks.push(remaining.substring(0, breakPoint).trim());
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }

  static async sendError(message: Message, error: string): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription(error)
      .setColor(0xFF0000); // Red

    try {
      await message.reply({ embeds: [embed] });
    } catch {
      await message.reply(`❌ ${error}`);
    }
  }

  static async sendInfo(message: Message, title: string, description: string): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(0x00FF00); // Green

    try {
      await message.reply({ embeds: [embed] });
    } catch {
      await message.reply(`${title}: ${description}`);
    }
  }

  static getResponseStats(content: string): { length: number; chunks: number; willUseEmbeds: boolean } {
    const chunks = this.chunkContent(content);
    return {
      length: content.length,
      chunks: chunks.length,
      willUseEmbeds: true // Always use embeds for consistent formatting and tool display
    };
  }
}