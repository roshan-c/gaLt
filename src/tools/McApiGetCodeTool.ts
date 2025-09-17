import { z } from 'zod';
import type { BotTool } from './ToolRegistry';

export const mcGetCodeTool: BotTool = {
  name: 'mc_get_code',
  description: 'Fetches a code from https://mcapi.roshanc.com/api/get_code and returns it. These codes are used in order to access a survey for McDonalds. If a user asks for a McDonalds code, you should use this tool to fetch a code.',
  schema: z.object({}).default({}),
  execute: async () => {
    const url = 'https://mcapi.roshanc.com/api/get_code';
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
    });

    if (!res.ok) {
      throw new Error(`MC API error: ${res.status} ${res.statusText}`);
    }

    const ct = res.headers.get('content-type') || '';
    let code: string | undefined;
    let raw: unknown;

    if (ct.includes('application/json')) {
      raw = await res.json();
      if (
        raw &&
        typeof raw === 'object' &&
        'code' in (raw as any) &&
        typeof (raw as any).code === 'string'
      ) {
        code = (raw as any).code;
      }
    } else {
      const text = (await res.text()).trim();
      raw = text;

      if (text && !text.startsWith('<')) {
        try {
          const maybe = JSON.parse(text);
          if (maybe && typeof maybe === 'object' && typeof (maybe as any).code === 'string') {
            code = (maybe as any).code;
            raw = maybe;
          }
        } catch {
          if (!code && text.length) code = text;
        }
      }
    }

    if (!code && raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (k.toLowerCase().includes('code') && typeof v === 'string' && v.trim()) {
          code = v.trim();
          break;
        }
      }
    }

    if (!code) {
      throw new Error('Could not parse code from response');
    }

    return { code, source: url, fetchedAt: new Date().toISOString() };
  },
};

export default mcGetCodeTool;
