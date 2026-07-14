/**
 * Unit tests for `src/aiflowbridge/pricing/openrouter-fetch.ts`.
 *
 * Strategy: inject a fake `fetch` via the `fetchImpl` option so the
 * HTTP layer is exercised end-to-end without hitting the network. The
 * parser is exercised separately on synthetic response shapes.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  fetchOpenRouterModels,
  parseOpenRouterPricing,
  type FetchLike,
  type OpenRouterRawResponse,
} from '../src/aiflowbridge/pricing/openrouter-fetch';

const FETCHED_AT = '2026-07-13T17:55:00.000Z';

function makeFetch(body: string | (() => string), status = 200, statusText = 'OK'): FetchLike & { calls: number } {
  const fetchImpl: FetchLike & { calls: number } = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => (typeof body === 'string' ? body : body()),
  })) as unknown as FetchLike & { calls: number };
  return fetchImpl;
}

describe('parseOpenRouterPricing', () => {
  it('converts per-token USD strings to per-million USD numbers', () => {
    const raw: OpenRouterRawResponse = {
      data: [
        {
          id: 'anthropic/claude-3.5-sonnet',
          name: 'Claude 3.5 Sonnet',
          pricing: { prompt: '0.000003', completion: '0.000015' },
        },
      ],
    };
    const out = parseOpenRouterPricing(raw, FETCHED_AT);
    expect(out['anthropic/claude-3.5-sonnet']).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
      currency: 'USD',
      fetchedAt: FETCHED_AT,
    });
  });

  it('drops free / unmetered models where prompt is "0"', () => {
    const raw: OpenRouterRawResponse = {
      data: [
        { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' } },
        { id: 'openai/gpt-4o', pricing: { prompt: '0.000005', completion: '0.000015' } },
      ],
    };
    const out = parseOpenRouterPricing(raw, FETCHED_AT);
    expect(Object.keys(out).sort()).toEqual(['openai/gpt-4o']);
  });

  it('drops entries missing pricing keys', () => {
    const raw: OpenRouterRawResponse = {
      data: [
        { id: 'a' },
        { id: 'b', pricing: {} },
        { id: 'c', pricing: { prompt: '0.000001' } }, // missing completion
        { id: 'd', pricing: { completion: '0.000002' } }, // missing prompt
        { id: 'e', pricing: { prompt: '0.000003', completion: '0.000004' } },
      ],
    };
    const out = parseOpenRouterPricing(raw, FETCHED_AT);
    expect(Object.keys(out)).toEqual(['e']);
  });

  it('drops entries with non-numeric or negative pricing', () => {
    const raw: OpenRouterRawResponse = {
      data: [
        { id: 'a', pricing: { prompt: 'abc', completion: '0.000001' } },
        { id: 'b', pricing: { prompt: 'NaN', completion: '0.000001' } },
        { id: 'c', pricing: { prompt: '-0.000001', completion: '0.000001' } },
        { id: 'd', pricing: { prompt: '0.000001', completion: 'Infinity' } },
        { id: 'e', pricing: { prompt: '0.000001', completion: '0.000002' } },
      ],
    };
    const out = parseOpenRouterPricing(raw, FETCHED_AT);
    expect(Object.keys(out)).toEqual(['e']);
  });

  it('returns an empty map on a malformed response', () => {
    const raw = { data: 'not-an-array' } as unknown as OpenRouterRawResponse;
    const out = parseOpenRouterPricing(raw, FETCHED_AT);
    expect(out).toEqual({});
  });

  it('rounds sub-cent precision to 6 decimals', () => {
    const raw: OpenRouterRawResponse = {
      data: [
        { id: 'a', pricing: { prompt: '0.0000012345678', completion: '0.00000987654321' } },
      ],
    };
    const out = parseOpenRouterPricing(raw, FETCHED_AT);
    expect(out['a']).toEqual({
      inputPerMillion: 1.234568,
      outputPerMillion: 9.876543,
      currency: 'USD',
      fetchedAt: FETCHED_AT,
    });
  });

  it('attaches the fetchedAt timestamp to every entry', () => {
    const raw: OpenRouterRawResponse = {
      data: [
        { id: 'a', pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'b', pricing: { prompt: '0.000003', completion: '0.000004' } },
      ],
    };
    const out = parseOpenRouterPricing(raw, '2026-08-01T00:00:00.000Z');
    expect(out['a'].fetchedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(out['b'].fetchedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('handles a real-shaped response with mixed free / metered / malformed entries', () => {
    const raw: OpenRouterRawResponse = {
      data: [
        { id: 'openai/gpt-oss-120b:free', pricing: { prompt: '0', completion: '0' } },
        { id: 'anthropic/claude-3-haiku', pricing: { prompt: '0.00000025', completion: '0.00000125' } },
        { id: 'google/gemini-2.5-pro', pricing: { prompt: '0.00000125', completion: '0.00001' } },
        { id: 'malformed' }, // dropped
      ],
    };
    const out = parseOpenRouterPricing(raw, FETCHED_AT);
    expect(Object.keys(out).sort()).toEqual([
      'anthropic/claude-3-haiku',
      'google/gemini-2.5-pro',
    ]);
    expect(out['anthropic/claude-3-haiku'].inputPerMillion).toBe(0.25);
    expect(out['anthropic/claude-3-haiku'].outputPerMillion).toBe(1.25);
    expect(out['google/gemini-2.5-pro'].inputPerMillion).toBe(1.25);
    expect(out['google/gemini-2.5-pro'].outputPerMillion).toBe(10);
  });
});

describe('fetchOpenRouterModels', () => {
  it('parses a successful 200 response', async () => {
    const body = JSON.stringify({ data: [{ id: 'a', pricing: { prompt: '0.000001', completion: '0.000002' } }] });
    const fetchImpl = makeFetch(body);
    const raw = await fetchOpenRouterModels({ fetchImpl });
    expect(raw.data).toHaveLength(1);
    expect(raw.data[0].id).toBe('a');
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = makeFetch('upstream error', 502, 'Bad Gateway');
    await expect(fetchOpenRouterModels({ fetchImpl })).rejects.toThrow(/HTTP 502/);
  });

  it('throws on invalid JSON', async () => {
    const fetchImpl = makeFetch('{not-json');
    await expect(fetchOpenRouterModels({ fetchImpl })).rejects.toThrow(/invalid JSON/);
  });

  it('throws on schema drift (missing top-level data array)', async () => {
    const fetchImpl = makeFetch(JSON.stringify({ models: [] }));
    await expect(fetchOpenRouterModels({ fetchImpl })).rejects.toThrow(/schema drift/);
  });

  it('forwards an external AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input: string, init?: { signal?: AbortSignal }) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      return { ok: false, status: 0, statusText: 'aborted', text: async () => '' };
    }) as unknown as FetchLike;
    await expect(
      fetchOpenRouterModels({ fetchImpl, signal: controller.signal })
    ).rejects.toThrow();
  });
});
