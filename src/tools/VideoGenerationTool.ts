import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { AttachmentBuilder } from 'discord.js';
import type { BotTool } from './ToolRegistry';

const videoGenerationSchema = z.object({
  prompt: z.string().describe('The detailed description of the video to generate'),
});

export const videoGenerationTool: BotTool = {
  name: 'generate_video',
  description:
    "Generate a video using Google's Veo 3 model based on a text prompt",
  schema: videoGenerationSchema,
  execute: async ({ prompt }) => {
    try {
      console.log(
        `🎥 Generating video with prompt: "${String(prompt).substring(0, 50)}..."`
      );

      if (!process.env.GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY environment variable is required for video generation');
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GOOGLE_API_KEY,
      });

      // Start video generation
      let operation = await ai.models.generateVideos({
        model: 'veo-3.0-generate-001',
        prompt: prompt,
      });

      console.log('🕐 Video generation started, polling for completion...');

      // Poll the operation status until the video is ready
      let pollCount = 0;
      const maxPolls = 60; // Maximum 10 minutes (60 * 10 seconds)

      while (!operation.done && pollCount < maxPolls) {
        console.log(`⏳ Video generation in progress... (poll ${pollCount + 1}/${maxPolls})`);
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

        operation = await ai.operations.getVideosOperation({
          operation: operation,
        });

        pollCount++;
      }

      if (!operation.done) {
        throw new Error('Video generation timed out after 10 minutes');
      }

      if (!operation.response?.generatedVideos?.[0]?.video) {
        throw new Error('No video data received from Google Veo 3');
      }

      const videoFile = operation.response.generatedVideos[0].video;
      console.log('📥 Downloading generated video...');

      // Download the video to a buffer instead of a file
      const response = await ai.files.download({
        file: videoFile,
      });

      let videoBuffer: Buffer;
      if (response instanceof ArrayBuffer) {
        videoBuffer = Buffer.from(response);
      } else if (Buffer.isBuffer(response)) {
        videoBuffer = response;
      } else {
        throw new Error('Unexpected response type from video download');
      }

      const timestamp = Date.now();
      const filename = `generated_video_${timestamp}.mp4`;

      console.log(
        `✅ Video generated successfully (${videoBuffer.length} bytes)`
      );

      return {
        success: true,
        message: `Generated video: "${prompt}"`,
        videoBuffer,
        filename,
        prompt,
      };
    } catch (error) {
      console.error('❌ Video generation failed:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';

      return {
        success: false,
        message: `Failed to generate video: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// Helper function to create Discord attachment from video tool result
export function createVideoAttachment(toolResult: any): AttachmentBuilder | null {
  if (!toolResult.success || !toolResult.videoBuffer) {
    return null;
  }

  return new AttachmentBuilder(toolResult.videoBuffer, {
    name: toolResult.filename
  });
}
