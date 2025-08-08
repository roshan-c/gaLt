import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { ToolMessage } from '@langchain/core/messages';
import type { ToolCall, ToolResult } from '../types/BotConfig';

export interface BotTool {
  name: string;
  description: string;
  schema: z.ZodSchema<any>;
  execute: (args: any) => Promise<any>;
}

export class ToolRegistry {
  private tools: Map<string, BotTool> = new Map();
  private langchainTools: any[] = [];

  registerTool(botTool: BotTool): void {
    // Register in our internal registry
    this.tools.set(botTool.name, botTool);

    // Create LangChain tool
    const langchainTool = tool(
      async (args: any) => {
        try {
          const result = await botTool.execute(args);
          return JSON.stringify(result);
        } catch (error) {
          console.error(`Error executing tool ${botTool.name}:`, error);
          throw error;
        }
      },
      {
        name: botTool.name,
        description: botTool.description,
        schema: botTool.schema,
      }
    );

    this.langchainTools.push(langchainTool);
  }

  getToolDefinitions(): any[] {
    return this.langchainTools;
  }

  getToolByName(name: string): BotTool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): BotTool[] {
    return Array.from(this.tools.values());
  }

  getToolCount(): number {
    return this.tools.size;
  }

  async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      try {
        const tool = this.getToolByName(toolCall.name);
        
        if (!tool) {
          const error = `Tool '${toolCall.name}' not found`;
          results.push({
            success: false,
            result: null,
            error,
            message: new ToolMessage({
              content: error,
              tool_call_id: toolCall.id || '',
            }),
          });
          continue;
        }

        // Validate arguments against schema
        const validatedArgs = tool.schema.parse(toolCall.args);
        
        // Execute the tool
        const result = await tool.execute(validatedArgs);

        // Sanitize tool result for sending back to the LLM (avoid huge/binary payloads)
        const sanitized = (() => {
          try {
            // Special-case common binary fields
            if (result && typeof result === 'object') {
              const clone: Record<string, any> = {};
              for (const [key, value] of Object.entries(result)) {
                if (key.toLowerCase().includes('buffer')) {
                  // Replace buffers with a size summary
                  const size = (value && typeof value === 'object' && 'length' in value)
                    ? Number((value as any).length) : undefined;
                  clone[key] = size != null ? `[binary omitted: ${size} bytes]` : '[binary omitted]';
                } else if (typeof value === 'string' && value.length > 2000) {
                  // Truncate very long strings
                  clone[key] = value.slice(0, 2000) + `... [omitted ${value.length - 2000} chars]`;
                } else {
                  clone[key] = value;
                }
              }
              return clone;
            }
            return result;
          } catch {
            return { info: 'tool result (sanitization failed)' };
          }
        })();

        results.push({
          success: true,
          result,
          message: new ToolMessage({
            content: JSON.stringify(sanitized),
            tool_call_id: toolCall.id || '',
          }),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          success: false,
          result: null,
          error: errorMessage,
          message: new ToolMessage({
            content: `Error: ${errorMessage}`,
            tool_call_id: toolCall.id || '',
          }),
        });
      }
    }

    return results;
  }

  removeToolByName(name: string): boolean {
    if (this.tools.has(name)) {
      this.tools.delete(name);
      // Also remove from langchain tools
      this.langchainTools = this.langchainTools.filter(tool => tool.name !== name);
      return true;
    }
    return false;
  }

  clearAllTools(): void {
    this.tools.clear();
    this.langchainTools = [];
  }
}