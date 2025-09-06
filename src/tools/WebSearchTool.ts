import { z } from 'zod';
import type { BotTool } from './ToolRegistry';
import OpenAI from 'openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { metrics } from '../utils/Metrics';
import { getOpenAiPerTokenCostsUSD } from '../utils/Pricing';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const geminiModelId = 'gemini-2.5-flash-lite';

// Simple in-memory TTL cache with naive LRU trimming
type CacheEntry = { value: any; expiresAt: number; lastAccess: number };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 200;
const cache: Map<string, CacheEntry> = new Map();

// Types for Tavily API
export type TavilyResult = {
  title: string;
  url: string;
  content?: string;
  published_date?: string | null;
};

type TavilyResponse = {
  results?: TavilyResult[];
};

export type Source = { title: string; url: string; snippet: string; domain: string; publishedDate?: string | null };

function makeKey(args: any, finalQuery: string) {
  return JSON.stringify({
    q: finalQuery,
    c: args.count || 5,
    d: !!args.deep,
    m: args.maxSnippetLength || 300,
    a: !!args.appendDate,
    tr: args.timeRange || null,
    inc: Array.isArray(args.includeDomains) ? [...args.includeDomains].sort() : [],
    exc: Array.isArray(args.excludeDomains) ? [...args.excludeDomains].sort() : [],
    topic: args.topic || null,
    lang: args.lang || 'en',
    mt: args.maxTokens || 300,
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

function extractDomain(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch { return ''; }
}

function trimCache() {
  if (cache.size <= CACHE_MAX) return;
  const entries = Array.from(cache.entries());
  entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  const toDelete = Math.max(0, entries.length - CACHE_MAX);
  for (let i = 0; i < toDelete; i++) {
    const entry = entries[i];
    const key = entry?.[0];
    if (key !== undefined) cache.delete(key);
  }
}

function computeRecencyScore(sources: Source[]): number {
  const now = Date.now();
  const withDates = sources.filter(s => s.publishedDate && !Number.isNaN(Date.parse(s.publishedDate as any)));
  if (withDates.length === 0) return 0.3; // unknown recency
  const weights = withDates.map(s => {
    const ageDays = (now - new Date(s.publishedDate as any).getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays <= 7) return 1.0;
    if (ageDays <= 30) return 0.7;
    if (ageDays <= 365) return 0.5;
    return 0.2;
  });
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  return Math.max(0, Math.min(1, Number(avg.toFixed(2))));
}

function computeConsensusScore(sources: Source[]): number {
  if (sources.length === 0) return 0;
  const byDomain: Record<string, number> = {};
  for (const s of sources) byDomain[s.domain] = (byDomain[s.domain] || 0) + 1;
  const unique = Object.keys(byDomain).length;
  const concentration = Math.max(...Object.values(byDomain));
  const spread = unique / Math.max(1, sources.length); // more unique domains => higher score
  const concentrationPenalty = 1 - (concentration - 1) / Math.max(1, sources.length - 1);
  const score = (0.7 * spread + 0.3 * concentrationPenalty);
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export const webSearchTool: BotTool = {
  name: 'web_search',
  description:
    'Performs a live web search using Tavily and returns a grounded, compressed summary with key points, citations, and sources.',
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
      .describe('If true, performs a deeper, more comprehensive search (allows multiple hits per domain).'),
    appendDate: z
      .boolean()
      .default(false)
      .describe("If true, appends today's date to the query for freshness"),
    maxSnippetLength: z
      .number()
      .default(300)
      .describe('Maximum characters per snippet before compression'),
    timeRange: z
      .enum(['day', 'week', 'month', 'year', 'all']).optional()
      .describe('Limit results to a relative time window when supported'),
    includeDomains: z.array(z.string()).default([]).describe('Prefer/include only these domains if supported'),
    excludeDomains: z.array(z.string()).default([]).describe('Exclude these domains if supported'),
    topic: z.string().optional().describe('Optional topical bias (e.g., news, finance); passed-through if supported'),
    lang: z.string().default('en').describe('Language code for the summary and key points'),
    maxTokens: z.number().min(100).max(1000).default(300).describe('Max tokens for summarization model'),
  }),
  execute: async (args) => {
    const started = Date.now();
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    if (!TAVILY_API_KEY) {
      return {
        summary: 'Search unavailable: missing Tavily API key.',
        keyPoints: [],
        citations: [],
        sources: [],
        meta: {
          totalSources: 0,
          uniqueDomains: 0,
          domains: [],
          searchDepth: args.deep ? 'advanced' : 'basic',
          queryUsed: args.query,
          reliable: false,
          cacheHit: false,
          processingMs: Date.now() - started,
          failureReason: 'Missing TAVILY_API_KEY',
          consensusScore: 0,
          recencyScore: 0,
          language: args.lang || 'en',
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
      const payload: any = {
        query: finalQuery,
        num_results: args.count || 5,
        search_type: 'search',
        search_depth: args.deep ? 'advanced' : 'basic',
      };
      if (args.timeRange) payload.time_range = args.timeRange; // passthrough if supported
      if (args.includeDomains?.length) payload.include_domains = args.includeDomains;
      if (args.excludeDomains?.length) payload.exclude_domains = args.excludeDomains;
      if (args.topic) payload.topic = args.topic;

      const tavilyRes = await fetchWithTimeoutAndRetry(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TAVILY_API_KEY}`,
          },
          body: JSON.stringify(payload),
        },
        7000,
        2
      );

      const tavilyData = (await tavilyRes.json()) as TavilyResponse;
      const raw = (tavilyData.results || []) as TavilyResult[];

      // Map and trim
      const mapped: Source[] = raw.map((item) => ({
        title: item.title,
        url: item.url,
        snippet: (item.content || '').slice(0, args.maxSnippetLength),
        domain: extractDomain(item.url),
        publishedDate: item.published_date ?? undefined,
      }));

      // Dedupe: always dedupe by URL; if not deep, limit to one per domain
      const byUrl = new Map<string, Source>();
      for (const s of mapped) {
        if (!byUrl.has(s.url)) byUrl.set(s.url, s);
      }
      let deduped = Array.from(byUrl.values());
      if (!args.deep) {
        const seenDomain = new Set<string>();
        const onePerDomain: Source[] = [];
        for (const s of deduped) {
          if (s.domain && !seenDomain.has(s.domain)) {
            seenDomain.add(s.domain);
            onePerDomain.push(s);
          }
        }
        deduped = onePerDomain;
      }

      // Respect count after dedupe
      sources = deduped.slice(0, args.count || 5);
    } catch (err: any) {
      const result = {
        summary: 'Web search failed to fetch results.',
        keyPoints: [],
        citations: [],
        sources: [],
        meta: {
          totalSources: 0,
          uniqueDomains: 0,
          domains: [],
          searchDepth: args.deep ? 'advanced' : 'basic',
          queryUsed: finalQuery,
          reliable: false,
          cacheHit: false,
          processingMs: Date.now() - started,
          failureReason: `Tavily error: ${err?.message || 'unknown'}`,
          consensusScore: 0,
          recencyScore: 0,
          language: args.lang || 'en',
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
        citations: [],
        sources: [],
        meta: {
          totalSources: 0,
          uniqueDomains: 0,
          domains: [],
          searchDepth: args.deep ? 'advanced' : 'basic',
          queryUsed: finalQuery,
          reliable: false,
          cacheHit: false,
          processingMs: Date.now() - started,
          consensusScore: 0,
          recencyScore: 0,
          language: args.lang || 'en',
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
  "summary": "A short, factual summary (max 3 sentences) in ${args.lang}",
  "keyPoints": ["bullet point 1", "bullet point 2", "bullet point 3"],
  "reliable": true,
  "citations": [ { "point": 0, "sources": [1,2] } ]
}

Rules:
- Only use facts from the provided search results.
- Do not add extra information.
- Keep the summary concise and factual.
- Key points should be short and clear.
- Each key point MUST cite at least one source index.
- Return JSON only, no prose.

Search Results:
${searchLines}`;

    let compressedJson: { summary?: string; keyPoints?: string[]; reliable?: boolean; citations?: Array<{ point: number; sources: number[] }> } = {};
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
            max_tokens: args.maxTokens || 300,
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
            compressedJson = { summary: 'Error parsing compression output.', keyPoints: [], reliable: false, citations: [] };
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
        compressedJson = { summary: 'Fallback parser failed to produce JSON.', keyPoints: [], reliable: false, citations: [] };
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
          citations: [],
          sources: sources.map((s: Source) => ({ title: s.title, url: s.url, domain: s.domain, publishedDate: s.publishedDate })),
          meta: {
            totalSources: sources.length,
            uniqueDomains: new Set(sources.map(s => s.domain)).size,
            domains: Array.from(new Set(sources.map(s => s.domain))).slice(0, 20),
            searchDepth: args.deep ? 'advanced' : 'basic',
            queryUsed: finalQuery,
            reliable: false,
            cacheHit: false,
            processingMs: Date.now() - started,
            failureReason: `Compression failed: ${((openAiErr as any)?.message || 'openai error')} ; fallback: ${((fallbackErr as any)?.message || 'gemini error')}`,
            consensusScore: 0,
            recencyScore: 0,
            language: args.lang || 'en',
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

    // Build meta/reliability
    const uniqueDomains = new Set(sources.map(s => s.domain));
    const consensusScore = computeConsensusScore(sources);
    const recencyScore = computeRecencyScore(sources);
    const reliableHeuristic = sources.length >= 2 && consensusScore >= 0.5 && recencyScore >= 0.4;

    // Ensure citations shape exists; if missing, create naive mapping (top-2 sources)
    const citations = Array.isArray((compressedJson as any).citations)
      ? (compressedJson as any).citations
      : Array.isArray(compressedJson.keyPoints)
        ? compressedJson.keyPoints.map((_, idx) => ({ point: idx, sources: [1, 2].filter(n => n <= sources.length) }))
        : [];

    const result = {
      summary: compressedJson.summary,
      keyPoints: compressedJson.keyPoints || [],
      citations,
      sources: sources.map((s: Source) => ({ title: s.title, url: s.url, domain: s.domain, publishedDate: s.publishedDate })),
      meta: {
        totalSources: sources.length,
        uniqueDomains: uniqueDomains.size,
        domains: Array.from(uniqueDomains).slice(0, 20),
        searchDepth: args.deep ? 'advanced' : 'basic',
        queryUsed: finalQuery,
        reliable: (compressedJson.reliable ?? reliableHeuristic) === true,
        cacheHit: false,
        processingMs: Date.now() - started,
        consensusScore,
        recencyScore,
        language: args.lang || 'en',
      },
    };

    // Cache result
    cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS, lastAccess: Date.now() });
    trimCache();
    return result;
  },
};

export default webSearchTool;
