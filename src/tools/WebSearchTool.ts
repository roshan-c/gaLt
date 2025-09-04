import { z } from 'zod';
import type { BotTool } from './ToolRegistry';
import OpenAI from 'openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';
import { metrics } from '../utils/Metrics';
import { getOpenAiPerTokenCostsUSD } from '../utils/Pricing';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const geminiModelId = 'gemini-2.5-flash-lite';

// Simple in-memory TTL cache with naive LRU trimming
type CacheEntry = { value: any; expiresAt: number; lastAccess: number };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 200;
const cache: Map<string, CacheEntry> = new Map();

function makeKey(args: any, finalQuery: string) {
  return JSON.stringify({
    q: finalQuery,
    c: args.count || 5,
    d: !!args.deep,
    m: args.maxSnippetLength || 300,
    a: !!args.appendDate,
  });
}

function getStatusCode(error: any): number | undefined {
  if (!error) return undefined;
  if (typeof error.status === 'number') return error.status;
  if (typeof error.code === 'number') return error.code;
  if (typeof error.code === 'string') {
    const n = Number(error.code);
    if (!Number.isNaN(n)) return n;
  }
  const resp = (error.response || error.res || error.error || {}) as any;
  if (typeof resp?.status === 'number') return resp.status;
  return undefined;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function jitter(baseMs: number, spread = 0.4) {
  const j = baseMs * spread * Math.random();
  return Math.max(0, baseMs - j / 2 + j);
}

async function fetchWithTimeoutAndRetry(url: string, init: RequestInit, timeoutMs: number, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) {
        // retry on 429/5xx
        if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
          await sleep(jitter(300 * (attempt + 1)));
          continue;
        }
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText} ${text ? `- ${text.slice(0, 200)}` : ''}`);
      }
      return res;
    } catch (err: any) {
      clearTimeout(id);
      if ((err?.name === 'AbortError' || err?.message?.includes('aborted')) && attempt < retries) {
        await sleep(jitter(300 * (attempt + 1)));
        continue;
      }
      const code = getStatusCode(err);
      if (code && [429, 500, 502, 503, 504].includes(code) && attempt < retries) {
        await sleep(jitter(300 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

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
    const started = Date.now();
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    if (!TAVILY_API_KEY) {
      return {
        summary: 'Search unavailable: missing Tavily API key.',
        keyPoints: [],
        sources: [],
        meta: {
          totalSources: 0,
          searchDepth: args.deep ? 'advanced' : 'basic',
          queryUsed: args.query,
          reliable: false,
          cacheHit: false,
          processingMs: Date.now() - started,
          failureReason: 'Missing TAVILY_API_KEY',
        },
      };
    }

    let finalQuery: string = args.query;
    if (args.appendDate) {
      const today = new Date().toISOString().split('T')[0];
      finalQuery += ` (${today})`;
    }

    const cacheKey = makeKey(args, finalQuery);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      cached.lastAccess = Date.now();
      const cachedVal = cached.value;
      return {
        ...cachedVal,
        meta: { ...cachedVal.meta, cacheHit: true, processingMs: 0 },
      };
    } else if (cached) {
      cache.delete(cacheKey);
    }

    let sources: Source[] = [];
    try {
      // Step 1: Fetch raw results from Tavily with timeout+retry
      const tavilyRes = await fetchWithTimeoutAndRetry(
        'https://api.tavily.com/search',
        {
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
        },
        7000,
        2
      );

      const tavilyData = (await tavilyRes.json()) as TavilyResponse;
      sources = (tavilyData.results || []).map((item: TavilyResult): Source => ({
        title: item.title,
        url: item.url,
        snippet: (item.content || '').slice(0, args.maxSnippetLength),
      }));
    } catch (err: any) {
      const result = {
        summary: 'Web search failed to fetch results.',
        keyPoints: [],
        sources: [],
        meta: {
          totalSources: 0,
          searchDepth: args.deep ? 'advanced' : 'basic',
          queryUsed: finalQuery,
          reliable: false,
          cacheHit: false,
          processingMs: Date.now() - started,
          failureReason: `Tavily error: ${err?.message || 'unknown'}`,
        },
      };
      // Cache the failure briefly to avoid hammering
      cache.set(cacheKey, { value: result, expiresAt: Date.now() + 60_000, lastAccess: Date.now() });
      trimCache();
      return result;
    }

    if (sources.length === 0) {
      const result = {
        summary: 'No reliable sources were found for this query. Please try rephrasing or checking back later.',
        keyPoints: [],
        sources: [],
        meta: {
          totalSources: 0,
          searchDepth: args.deep ? 'advanced' : 'basic',
          queryUsed: finalQuery,
          reliable: false,
          cacheHit: false,
          processingMs: Date.now() - started,
        },
      };
      cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS, lastAccess: Date.now() });
      trimCache();
      return result;
    }

    // Step 2: Compress results into structured JSON using OpenAI with fallback to Gemini
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

    let compressedJson: { summary?: string; keyPoints?: string[]; reliable?: boolean } = {};
    let usageIn = 0, usageOut = 0, usageTotal = 0;

    async function compressWithOpenAI() {
      // Two attempts with timeout
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await openai.chat.completions.create({
            model: 'gpt-4.1-nano',
            messages: [{ role: 'user', content: compressionPrompt }],
            temperature: 0,
            max_tokens: 300,
            response_format: { type: 'json_object' },
            signal: controller.signal as any,
          } as any);
          clearTimeout(id);
          // capture usage if available
          const u: any = (res as any).usage || {};
          usageIn += Number(u.prompt_tokens || 0);
          usageOut += Number(u.completion_tokens || 0);
          usageTotal += Number(u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0));
          try {
            compressedJson = JSON.parse(res.choices[0]?.message?.content || '{}');
          } catch {
            compressedJson = { summary: 'Error parsing compression output.', keyPoints: [], reliable: false };
          }
          return true;
        } catch (err) {
          clearTimeout(id);
          const code = getStatusCode(err);
          if ((code && [429, 500, 502, 503, 504].includes(code)) || (err as any)?.name === 'AbortError') {
            // retry once
            continue;
          }
          throw err;
        }
      }
      throw new Error('OpenAI compression failed after retries');
    }

    async function compressWithGeminiFallback() {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error('Missing GOOGLE_API_KEY for fallback');
      const gemini = new ChatGoogleGenerativeAI({ apiKey, model: geminiModelId, temperature: 0 });
      const msg = await gemini.invoke(compressionPrompt);
      const text = (msg as any)?.content ?? '';
      try {
        compressedJson = JSON.parse(typeof text === 'string' ? text : String(text));
      } catch {
        compressedJson = { summary: 'Fallback parser failed to produce JSON.', keyPoints: [], reliable: false };
      }
    }

    try {
      await compressWithOpenAI();
    } catch (openAiErr) {
      try {
        await compressWithGeminiFallback();
      } catch (fallbackErr) {
        const result = {
          summary: 'Web search succeeded but summarization failed.',
          keyPoints: [],
          sources: sources.map((s: Source) => ({ title: s.title, url: s.url })),
          meta: {
            totalSources: sources.length,
            searchDepth: args.deep ? 'advanced' : 'basic',
            queryUsed: finalQuery,
            reliable: false,
            cacheHit: false,
            processingMs: Date.now() - started,
            failureReason: `Compression failed: ${((openAiErr as any)?.message || 'openai error')} ; fallback: ${((fallbackErr as any)?.message || 'gemini error')}`,
          },
        };
        cache.set(cacheKey, { value: result, expiresAt: Date.now() + 60_000, lastAccess: Date.now() });
        trimCache();
        return result;
      }
    }

    // Record token metrics for OpenAI compression if any
    try {
      if (usageIn || usageOut || usageTotal) {
        const { inputPerToken, outputPerToken } = getOpenAiPerTokenCostsUSD();
        const cost = usageIn * inputPerToken + usageOut * outputPerToken;
        metrics.recordTokens(usageIn, usageOut, usageTotal, cost);
      }
    } catch {}

    const result = {
      summary: compressedJson.summary,
      keyPoints: compressedJson.keyPoints || [],
      sources: sources.map((s: Source) => ({ title: s.title, url: s.url })),
      meta: {
        totalSources: sources.length,
        searchDepth: args.deep ? 'advanced' : 'basic',
        queryUsed: finalQuery,
        reliable: (compressedJson.reliable ?? false) === true,
        cacheHit: false,
        processingMs: Date.now() - started,
      },
    };

    // Cache result
    cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS, lastAccess: Date.now() });
    trimCache();
    return result;
  },
};

function trimCache() {
  if (cache.size <= CACHE_MAX) return;
  // Remove oldest by lastAccess
  const entries = Array.from(cache.entries());
  entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  const toDelete = Math.max(0, entries.length - CACHE_MAX);
  for (let i = 0; i < toDelete; i++) {
    const entry = entries[i];
    const key = entry?.[0];
    if (key !== undefined) cache.delete(key);
  }
}

export default webSearchTool;


