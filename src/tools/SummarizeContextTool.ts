import { z } from 'zod';
import type { BotTool } from './ToolRegistry';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type SummarizerJson = {
  summary?: string;
  keyPoints?: string[];
  actionItems?: string[];
  openQuestions?: string[];
  participants?: string[];
  externalQueries?: string[];
  needsMoreContext?: boolean;
};

function formatConversationForPrompt(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((m, i) => `${i + 1}. ${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n');
}

async function runSummarizer(model: string, conversationText: string): Promise<SummarizerJson> {
  const prompt = `You are a precise conversation summarization assistant.
Analyze the recent conversation below and return a compact JSON object with this exact structure:
{
  "summary": "2-4 sentence concise summary of the conversation",
  "keyPoints": ["short bullet 1", "short bullet 2"],
  "actionItems": ["next action 1", "next action 2"],
  "openQuestions": ["question 1", "question 2"],
  "participants": ["User", "Assistant"],
  "externalQueries": ["web search query 1", "web search query 2"],
  "needsMoreContext": true
}

Rules:
- Keep it factual and grounded only in the conversation text.
- Only include externalQueries if there are specific topics that clearly require web context to summarize accurately (e.g., recent events, version-specific info, news).
- Set needsMoreContext to true only if the conversation references earlier details not included here (e.g., "as mentioned above", "earlier we decided").

Conversation:
${conversationText}`;

  const res = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 600,
    response_format: { type: 'json_object' },
  });

  try {
    const parsed: SummarizerJson = JSON.parse(res.choices[0]?.message?.content || '{}');
    return parsed || {};
  } catch {
    return { summary: 'Failed to parse summarizer output.', keyPoints: [], actionItems: [], openQuestions: [], participants: [], externalQueries: [], needsMoreContext: false };
  }
}

export const summarizeContextTool: BotTool = {
  name: 'summarize_context',
  description:
    'Summarizes the recent conversation (last 15 messages by default; may expand if needed) and optionally enriches with web search for external context.',
  schema: z.object({
    userId: z.string().describe('Discord user ID associated with the conversation'),
    channelId: z.string().describe('Discord channel ID for the conversation'),
    minMessages: z
      .number()
      .min(1)
      .max(100)
      .default(15)
      .describe('Minimum number of most recent messages to include initially'),
    maxMessages: z
      .number()
      .min(1)
      .max(200)
      .default(50)
      .describe('Upper bound for messages if more context is needed'),
    useWeb: z
      .boolean()
      .default(true)
      .describe('If true, performs targeted web searches when external context is required'),
    appendDateToWebQueries: z
      .boolean()
      .default(true)
      .describe("If true, appends today's date to web queries for freshness"),
  }),
  execute: async (args) => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Missing OPENAI_API_KEY in environment variables');
    }

    const memoryManager = (globalThis as any).__GA_LT_MEMORY_MANAGER;
    if (!memoryManager || typeof memoryManager.getHistory !== 'function') {
      throw new Error('Memory manager is not available to the tool');
    }

    // Fetch full history for adaptive windowing
    const fullHistory = await memoryManager.getHistory(args.userId, args.channelId);
    if (!fullHistory || fullHistory.length === 0) {
      return {
        summary: 'No conversation history found.',
        keyPoints: [],
        actionItems: [],
        openQuestions: [],
        participants: [],
        includedMessageCount: 0,
        usedWebSearch: false,
        webResults: [],
      };
    }

    const totalAvailable = fullHistory.length;
    const initialWindow = Math.min(Math.max(args.minMessages ?? 15, 1), totalAvailable);
    const maxWindow = Math.min(Math.max(args.maxMessages ?? 50, initialWindow), totalAvailable);

    const toPlain = (msgs: any[]) => msgs.map((m: any) => ({ role: m.role, content: String(m.content || '') }));

    let windowSize = initialWindow;
    let usedMessages = fullHistory.slice(-windowSize);
    let conversationText = formatConversationForPrompt(toPlain(usedMessages));

    // Prefer compact, fast model for structuring; same as search tool family
    const summarizerModel = 'gpt-4.1-nano';
    let summaryJson = await runSummarizer(summarizerModel, conversationText);

    if (summaryJson.needsMoreContext && windowSize < maxWindow) {
      windowSize = Math.min(maxWindow, windowSize + initialWindow);
      usedMessages = fullHistory.slice(-windowSize);
      conversationText = formatConversationForPrompt(toPlain(usedMessages));
      summaryJson = await runSummarizer(summarizerModel, conversationText);
    }

    const externalQueries = Array.isArray(summaryJson.externalQueries)
      ? summaryJson.externalQueries.filter((q) => typeof q === 'string' && q.trim().length > 0)
      : [];

    const webResults: Array<{
      query: string;
      summary?: string;
      keyPoints?: string[];
      sources: Array<{ title: string; url: string }>;
      meta?: any;
    }> = [];

    if ((args.useWeb ?? true) && externalQueries.length > 0) {
      const toolRegistry = (globalThis as any).__GA_LT_TOOL_REGISTRY;
      const hasRegistry = toolRegistry && typeof toolRegistry.executeTools === 'function';
      const limitedQueries = externalQueries.slice(0, 3);
      if (!hasRegistry) {
        for (const q of limitedQueries) {
          const query = String(q ?? '');
          webResults.push({ query, summary: 'Web search unavailable (registry missing).', keyPoints: [], sources: [], meta: { reliable: false } });
        }
      } else {
        const calls = limitedQueries.map((q) => ({ name: 'web_search', args: { query: q, count: 3, deep: true, appendDate: args.appendDateToWebQueries ?? true, maxSnippetLength: 300 } }));
        const settledResults = await Promise.allSettled(calls.map((c: any) => toolRegistry.executeTools([c])));
        settledResults.forEach((res, idx) => {
          const query = String(limitedQueries[idx] ?? '');
          if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value[0]?.success) {
            webResults.push({ query, ...(res.value[0].result || {}) });
          } else {
            webResults.push({ query, summary: 'Web search failed for this query.', keyPoints: [], sources: [] });
          }
        });
      }
    }

    return {
      summary: summaryJson.summary || 'No summary available.',
      keyPoints: summaryJson.keyPoints || [],
      actionItems: summaryJson.actionItems || [],
      openQuestions: summaryJson.openQuestions || [],
      participants: summaryJson.participants || [],
      includedMessageCount: usedMessages.length,
      usedWebSearch: webResults.length > 0,
      webResults,
    };
  },
};

export default summarizeContextTool;
