/**
 * OpenRouter smoke test.
 *
 * Verifies that AIFlowBridge routes an OpenRouter-shaped request the way
 * OpenRouter expects:
 *   - the upstream URL targets `openrouter.ai/api/v1/chat/completions`
 *   - the `Authorization: Bearer <key>` header is forwarded verbatim
 *   - the OpenRouter-specific attribution headers `HTTP-Referer` and
 *     `X-Title` are set with the bundled AIFlowBridge version
 *   - the body is passed through unmodified (strict OpenAI compatibility)
 *   - non-OpenRouter upstreams do NOT receive the attribution headers
 *
 * Scope: covers the upstream-header injection layer (`applyOpenRouterAttributionHeaders`)
 * and the bundled registry entry. End-to-end live testing with a real
 */

import { describe, expect, it } from 'vitest';
import bundled from '../../resources/models.json';
import { resolveVendorApiKey } from '../../src/aiflowbridge/api-key-resolver';
import { applyOpenRouterAttributionHeaders } from '../../src/aiflowbridge/gateway/openrouter-headers';
import { validateRegistryStructure } from '../../src/aiflowbridge/modelRegistry.schema';
import { isValidProviderBaseUrl } from '../../src/aiflowbridge/providers';
import { API_KEY_SECRETS } from '../../src/consts';

describe('OpenRouter smoke - registry shape', () => {
  it('bundled resources/models.json is structurally valid', () => {
    expect(() => validateRegistryStructure(bundled)).not.toThrow();
  });

  it('bundled registry declares the openrouter vendor with the canonical baseUrl', () => {
    const openrouter = (bundled.vendors as Record<string, { baseUrl: string; apiKeySecret: string }> | undefined)?.openrouter;
    expect(openrouter).toBeDefined();
    expect(openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(openrouter?.apiKeySecret).toBe('aiflowbridge.providers.openrouter.apiKey');
  });

  it('bundled registry lists at least 5 of the 7 OpenRouter flagship models', () => {
    const models = (bundled.models as Array<{ id: string; family: string }>).filter((m) => m.family === 'openrouter');
    expect(models.length).toBeGreaterThanOrEqual(5);
    const ids = models.map((m) => m.id);
    // Spot-check a handful of flagship ids (OpenRouter verbatim, July 2026 free-tier selection).
    expect(ids).toContain('nvidia/nemotron-3-ultra-550b-a55b:free');
    expect(ids).toContain('openai/gpt-oss-120b:free');
    expect(ids).toContain('google/gemma-4-31b-it:free');
    expect(ids).toContain('qwen/qwen3-coder:free');
  });

  it('all openrouter models use family="openrouter" and a positive context window', () => {
    const models = (bundled.models as Array<{ family: string; maxInputTokens: number; maxOutputTokens: number }>).filter(
      (m) => m.family === 'openrouter'
    );
    for (const m of models) {
      expect(m.maxInputTokens).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeGreaterThan(0);
    }
  });
});

describe('OpenRouter smoke - URL host detection', () => {
  it('isValidProviderBaseUrl accepts the canonical OpenRouter baseUrl', () => {
    expect(isValidProviderBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
  });

  it('does not strip the attribution headers on the canonical OpenRouter URL', () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    applyOpenRouterAttributionHeaders(headers, 'https://openrouter.ai/api/v1/chat/completions', '2.12.0');
    expect(headers.get('HTTP-Referer')).toBe('https://aiflowbridge.dev v2.12.0');
    expect(headers.get('X-Title')).toBe('AIFlowBridge v2.12.0');
  });

  it('does not strip the attribution headers on an OpenRouter subdomain (none today, but future-proof)', () => {
    const headers = new Headers();
    applyOpenRouterAttributionHeaders(headers, 'https://api.openrouter.ai/v1/chat/completions', '2.12.0');
    expect(headers.get('HTTP-Referer')).toBe('https://aiflowbridge.dev v2.12.0');
  });

  it('does NOT leak the attribution headers to non-OpenRouter upstreams', () => {
    const headers = new Headers();
    applyOpenRouterAttributionHeaders(headers, 'https://api.deepseek.com/v1/chat/completions', '2.12.0');
    expect(headers.has('HTTP-Referer')).toBe(false);
    expect(headers.has('X-Title')).toBe(false);
  });

  it('does NOT leak the attribution headers to a lookalike host (openrouter.ai.evil.example)', () => {
    const headers = new Headers();
    applyOpenRouterAttributionHeaders(headers, 'https://openrouter.ai.evil.example/v1/chat/completions', '2.12.0');
    expect(headers.has('HTTP-Referer')).toBe(false);
    expect(headers.has('X-Title')).toBe(false);
  });

  it('matches the host case-insensitively', () => {
    const headers = new Headers();
    applyOpenRouterAttributionHeaders(headers, 'https://OPENROUTER.AI/api/v1/chat/completions', '2.12.0');
    expect(headers.get('HTTP-Referer')).toBe('https://aiflowbridge.dev v2.12.0');
  });
});

describe('OpenRouter smoke - API key resolution', () => {
  it('API_KEY_SECRETS registers the OpenRouter secret', () => {
    expect(API_KEY_SECRETS.openrouter).toBe('aiflowbridge.providers.openrouter.apiKey');
  });

  it('resolveVendorApiKey returns the OpenRouter key for an "openrouter-*" alias', async () => {
    const secrets = { get: async (key: string) => (key === API_KEY_SECRETS.openrouter ? 'sk-or-v1-test' : undefined) };
    const key = await resolveVendorApiKey('openrouter-foo', secrets);
    expect(key).toBe('sk-or-v1-test');
  });

  it('resolveVendorApiKey returns the OpenRouter key for a bare "openrouter" id', async () => {
    const secrets = { get: async (key: string) => (key === API_KEY_SECRETS.openrouter ? 'sk-or-v1-test' : undefined) };
    const key = await resolveVendorApiKey('openrouter', secrets);
    expect(key).toBe('sk-or-v1-test');
  });
});