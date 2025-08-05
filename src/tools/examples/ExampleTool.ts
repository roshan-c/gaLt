import { z } from 'zod';
import type { BotTool } from '../ToolRegistry';

// Example tool that performs basic calculations
export const calculatorTool: BotTool = {
  name: 'calculator',
  description: 'Performs basic arithmetic operations (add, subtract, multiply, divide)',
  schema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The arithmetic operation to perform'),
    a: z.number().describe('The first number'),
    b: z.number().describe('The second number'),
  }),
  execute: async (args: { operation: string; a: number; b: number }) => {
    const { operation, a, b } = args;
    
    switch (operation) {
      case 'add':
        return { result: a + b, operation: `${a} + ${b}` };
      case 'subtract':
        return { result: a - b, operation: `${a} - ${b}` };
      case 'multiply':
        return { result: a * b, operation: `${a} × ${b}` };
      case 'divide':
        if (b === 0) {
          throw new Error('Division by zero is not allowed');
        }
        return { result: a / b, operation: `${a} ÷ ${b}` };
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
};

// Example tool that gets current time information
export const timeTool: BotTool = {
  name: 'get_time',
  description: 'Gets current time information in various formats',
  schema: z.object({
    timezone: z.string().optional().describe('Timezone (e.g., "America/New_York", "UTC"). Defaults to UTC'),
    format: z.enum(['iso', 'human', 'unix']).optional().describe('Output format. Defaults to human-readable'),
  }),
  execute: async (args: { timezone?: string; format?: string }) => {
    const { timezone = 'UTC', format = 'human' } = args;
    const now = new Date();
    
    try {
      let timeString: string;
      
      switch (format) {
        case 'iso':
          timeString = now.toISOString();
          break;
        case 'unix':
          timeString = Math.floor(now.getTime() / 1000).toString();
          break;
        case 'human':
        default:
          timeString = now.toLocaleString('en-US', { 
            timeZone: timezone,
            dateStyle: 'full',
            timeStyle: 'long'
          });
          break;
      }
      
      return {
        time: timeString,
        timezone,
        format,
        timestamp: now.getTime(),
      };
    } catch (error) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
  },
};

// Default export for backward compatibility
export const exampleTool = calculatorTool;