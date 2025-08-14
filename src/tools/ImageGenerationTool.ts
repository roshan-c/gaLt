import OpenAI from 'openai';
import { z } from 'zod';
import { AttachmentBuilder } from 'discord.js';
import type { BotTool } from './ToolRegistry';

const imageGenerationSchema = z.object({
  prompt: z.string().describe('The detailed description of the image to generate'),
  style: z
    .enum(['natural', 'vivid'])
    .optional()
    .describe(
      'The style of the image - natural for more natural looking images, vivid for more dramatic/artistic images'
    ),
  size: z
    .enum(['1024x1024', '1024x1792', '1792x1024'])
    .optional()
    .describe('The size of the image to generate'),
});

export const imageGenerationTool: BotTool = {
  name: 'generate_image',
  description:
    "Generate an image using OpenAI's GPT-Image-1 model based on a text prompt",
  schema: imageGenerationSchema,
  execute: async ({ prompt, style = 'natural', size = '1024x1024' }) => {
    try {
      console.log(
        `🎨 Generating image with prompt: "${String(prompt).substring(0, 50)}..."`
      );

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
      });

      // Enforce 1024x1024 on gpt-image-1 with low quality
      const enforcedSize = '1024x1024' as const;
      const result = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: prompt,
        size: enforcedSize,
        quality: 'low',
        n: 1,
      });

      const first = result.data?.[0];
      if (!first) {
        throw new Error('No image data received from OpenAI');
      }

      let imageBuffer: Buffer | null = null;
      if (first.b64_json) {
        imageBuffer = Buffer.from(first.b64_json, 'base64');
      } else if (first.url) {
        const resp = await fetch(first.url);
        if (!resp.ok) {
          throw new Error(`Failed to download image (${resp.status})`);
        }
        const arrayBuffer = await resp.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }

      if (!imageBuffer) {
        throw new Error('OpenAI returned no b64_json or url for image');
      }

      const timestamp = Date.now();
      const filename = `generated_image_${timestamp}.png`;

      console.log(
        `✅ Image generated successfully (${imageBuffer.length} bytes)`
      );

      return {
        success: true,
        message: `Generated image: "${prompt}"`,
        imageBuffer,
        filename,
        prompt,
        style,
        size: enforcedSize,
      };
    } catch (error) {
      console.error('❌ Image generation failed:', error);

      const anyErr: any = error as any;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      const status = typeof anyErr?.status === 'number' ? anyErr.status : (anyErr?.response?.status ?? undefined);
      const errorCode = anyErr?.error?.code || anyErr?.code || undefined;
      const errorType = anyErr?.error?.type || anyErr?.type || undefined;
      const moderationBlocked =
        errorCode === 'moderation_blocked' || /moderation|safety system/i.test(String(errorMessage));
      return {
        success: false,
        message: `Failed to generate image: ${errorMessage}`,
        error: errorMessage,
        status,
        errorCode,
        errorType,
        moderationBlocked,
      };
    }
  },
};

// Helper function to create Discord attachment from image tool result
export function createImageAttachment(toolResult: any): AttachmentBuilder | null {
  if (!toolResult.success || !toolResult.imageBuffer) {
    return null;
  }
  
  return new AttachmentBuilder(toolResult.imageBuffer, { 
    name: toolResult.filename 
  });
}