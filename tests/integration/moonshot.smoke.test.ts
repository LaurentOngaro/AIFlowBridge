/**
 * MoonshotAI (Kimi) smoke test.
 *
 * `moonshot` is a gateway-only vendor (Path B in
 * `docs/agent-instructions/tasks.md`): no
 * `vscode.LanguageModelChatProvider` class, only an
 * OpenAI-compatible profile synthesized from the bundled registry.
 * This test pins the registry entry, the four current model ids, and
 * the API key resolution for both the vendor id and the upstream
 * `kimi-*` model-id prefix.
 *
 * VS-Code-free: imports the bundled registry and the pure helpers
 * directly, so it runs without a VS Code host.
 */

import { describe, expect, it } from 'vitest';
import bundled from '../../resources/models.json';
import { resolveVendorApiKey } from '../../src/aiflowbridge/api-key-resolver';
import { validateRegistryStructure } from '../../src/aiflowbridge/modelRegistry.schema';
import { isValidProviderBaseUrl } from '../../src/aiflowbridge/providers';
import { API_KEY_SECRETS } from '../../src/consts';

const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';

describe('MoonshotAI smoke - registry shape', () => {
  it('bundled resources/models.json is structurally valid', () => {
    expect(() => validateRegistryStructure(bundled)).not.toThrow();
  });

  it('bundled registry declares the moonshot vendor with the canonical baseUrl', () => {
    const moonshot = (bundled.vendors as Record<string, { baseUrl: string; apiKeySecret: string }> | undefined)?.moonshot;
    expect(moonshot).toBeDefined();
    expect(moonshot?.baseUrl).toBe(MOONSHOT_BASE_URL);
    expect(moonshot?.apiKeySecret).toBe('aiflowbridge.providers.moonshot.apiKey');
  });

  it('the canonical moonshot baseUrl passes the SSRF guard', () => {
    expect(isValidProviderBaseUrl(MOONSHOT_BASE_URL)).toBe(true);
  });

  it('bundled registry lists the four current Kimi models', () => {
    const models = (bundled.models as Array<{ id: string; family: string }>).filter((m) => m.family === 'moonshot');
    expect(models.length).toBeGreaterThanOrEqual(4);
    const ids = models.map((m) => m.id);
    expect(ids).toContain('kimi-k3');
    expect(ids).toContain('kimi-k2.7-code');
    expect(ids).toContain('kimi-k2.7-code-highspeed');
    expect(ids).toContain('kimi-k2.6');
  });

  it('does not bundle the discontinued kimi-k2 and kimi-k2.5 series', () => {
    // Upstream discontinued the whole `kimi-k2` series on 2026-05-25
    // and `kimi-k2.5` on 2026-08-31. Bundling them would ship dead ids.
    const ids = (bundled.models as Array<{ id: string; family: string }>)
      .filter((m) => m.family === 'moonshot')
      .map((m) => m.id);
    for (const dead of ['kimi-k2.5', 'kimi-k2-turbo-preview', 'moonshot-v1-8k', 'kimi-latest']) {
      expect(ids, `discontinued id "${dead}" is still bundled`).not.toContain(dead);
    }
  });

  it('every moonshot model declares a positive context and output window', () => {
    const models = (bundled.models as Array<{ family: string; maxInputTokens: number; maxOutputTokens: number }>).filter(
      (m) => m.family === 'moonshot'
    );
    for (const m of models) {
      expect(m.maxInputTokens).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeGreaterThan(0);
    }
  });
});

describe('MoonshotAI smoke - API key resolution', () => {
  it('API_KEY_SECRETS registers the moonshot secret', () => {
    expect(API_KEY_SECRETS.moonshot).toBe('aiflowbridge.providers.moonshot.apiKey');
  });

  it('resolveVendorApiKey returns the moonshot key for a bare "moonshot" id', async () => {
    const secrets = { get: async (key: string) => (key === API_KEY_SECRETS.moonshot ? 'moonshot-test-key' : undefined) };
    expect(await resolveVendorApiKey('moonshot', secrets)).toBe('moonshot-test-key');
  });

  it('resolveVendorApiKey returns the moonshot key for a "kimi-" model id', async () => {
    const secrets = { get: async (key: string) => (key === API_KEY_SECRETS.moonshot ? 'moonshot-test-key' : undefined) };
    expect(await resolveVendorApiKey('kimi-k3', secrets)).toBe('moonshot-test-key');
  });
});
