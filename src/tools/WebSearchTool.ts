import { z } from 'zod';
import type { BotTool } from './ToolRegistry';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type TavilyResult = {
  title: string;
  url: string;
  content?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
};

type Source = { title: string; url: string; snippet: string };

export const webSearchTool: BotTool = {
  name: 'web_search',
  description:
    'Performs a live web search using Tavily and returns a grounded, compressed summary with key points and sources.',
  schema: z.object({
    query: z.string().describe('The web search query for fresh information'),
    count: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .describe('Number of search results to fetch (default: 5)'),
    deep: z
      .boolean()
      .default(false)
      .describe('If true, performs a deeper, more comprehensive search'),
    appendDate: z
      .boolean()
      .default(false)
      .describe("If true, appends today's date to the query for freshness"),
    maxSnippetLength: z
      .number()
      .default(300)
      .describe('Maximum characters per snippet before compression'),
  }),
  execute: async (args) => {
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    if (!TAVILY_API_KEY) {
      throw new Error('Missing TAVILY_API_KEY in environment variables');
    }

    let finalQuery: string = args.query;
    if (args.appendDate) {
      const today = new Date().toISOString().split('T')[0];
      finalQuery += ` (${today})`;
    }

    // Step 1: Fetch raw results from Tavily
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query: finalQuery,
        num_results: args.count || 5,
        search_type: 'search',
        search_depth: args.deep ? 'advanced' : 'basic',
      }),
    });

    if (!tavilyRes.ok) {
      throw new Error(`Tavily API error: ${tavilyRes.status} ${tavilyRes.statusText}`);
    }

    const tavilyData = (await tavilyRes.json()) as TavilyResponse;
    const sources: Source[] = (tavilyData.results || []).map((item: TavilyResult): Source => ({
      title: item.title,
      url: item.url,
      snippet: (item.content || '').slice(0, args.maxSnippetLength),
    }));

    if (sources.length === 0) {
      return {
        summary:
          'No reliable sources were found for this query. Please try rephrasing or checking back later.',
        keyPoints: [],
        sources: [],
        meta: {
          totalSources: 0,
          searchDepth: args.deep ? 'advanced' : 'basic',
          queryUsed: finalQuery,
          reliable: false,
        },
      };
    }

    // Step 2: Compress results into structured JSON using OpenAI
    const searchLines = sources
      .map((s: Source, i: number) => `${i + 1}. ${s.title} - ${s.snippet} (Source: ${s.url})`)
      .join('\n');

    const compressionPrompt = `You are a compression assistant. Summarize the following search results into a JSON object with this exact structure:\n{
  "summary": "A short, factual summary (max 3 sentences)",
  "keyPoints": ["bullet point 1", "bullet point 2", "bullet point 3"],
  "reliable": true
}

Rules:
- Only use facts from the provided search results.
- Do not add extra information.
- Keep the summary concise and factual.
- Key points should be short and clear.

Search Results:
${searchLines}`;

    const compressionRes = await openai.chat.completions.create({
      model: 'gpt-4.1-nano',
      messages: [{ role: 'user', content: compressionPrompt }],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    let compressedJson: { summary?: string; keyPoints?: string[]; reliable?: boolean } = {};
    try {
      compressedJson = JSON.parse(compressionRes.choices[0]?.message?.content || '{}');
    } catch {
      compressedJson = { summary: 'Error parsing compression output.', keyPoints: [], reliable: false };
    }

    return {
      summary: compressedJson.summary,
      keyPoints: compressedJson.keyPoints || [],
      sources: sources.map((s: Source) => ({ title: s.title, url: s.url })),
      meta: {
        totalSources: sources.length,
        searchDepth: args.deep ? 'advanced' : 'basic',
        queryUsed: finalQuery,
        reliable: compressedJson.reliable ?? true,
      },
    };
  },
};

export default webSearchTool;


