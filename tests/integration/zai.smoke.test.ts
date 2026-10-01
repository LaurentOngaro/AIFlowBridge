/**
 * Z.ai (GLM) smoke test.
 *
 * `zai` is a gateway-only vendor (Path B in
 * `docs/agent-instructions/tasks.md`): no
 * `vscode.LanguageModelChatProvider` class, only an
 * OpenAI-compatible profile synthesized from the bundled registry.
 * This test pins the four things that silently break a Path B vendor:
 *   - the bundled registry is structurally valid (a broken bundled file
 *     is fatal, unlike a broken override)
 *   - the `zai` vendor entry carries a usable baseUrl + apiKeySecret
 *   - the GLM 5.3 family is actually present (an undeclared family is
 *     dropped fail-soft: a warn in the logs, the model disappears from
 *     the catalog with no visible error)
 *   - the API key secret slot exists and resolves for both the vendor
 *     id and the upstream `glm-*` model-id prefix
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

const ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';

describe('Z.ai smoke - registry shape', () => {
  it('bundled resources/models.json is structurally valid', () => {
    expect(() => validateRegistryStructure(bundled)).not.toThrow();
  });

  it('bundled registry declares the zai vendor with the canonical baseUrl', () => {
    const zai = (bundled.vendors as Record<string, { baseUrl: string; apiKeySecret: string }> | undefined)?.zai;
    expect(zai).toBeDefined();
    expect(zai?.baseUrl).toBe(ZAI_BASE_URL);
    expect(zai?.apiKeySecret).toBe('aiflowbridge.providers.zai.apiKey');
  });

  it('the canonical zai baseUrl passes the SSRF guard', () => {
    expect(isValidProviderBaseUrl(ZAI_BASE_URL)).toBe(true);
  });

  it('bundled registry lists the three GLM 5.3 models', () => {
    const models = (bundled.models as Array<{ id: string; family: string }>).filter((m) => m.family === 'zai');
    expect(models.length).toBeGreaterThanOrEqual(3);
    const ids = models.map((m) => m.id);
    expect(ids).toContain('glm-5.3');
    expect(ids).toContain('glm-5.3-flash');
    expect(ids).toContain('glm-5.3-flashx');
  });

  it('every zai model declares a positive context and output window', () => {
    const models = (bundled.models as Array<{ family: string; maxInputTokens: number; maxOutputTokens: number }>).filter(
      (m) => m.family === 'zai'
    );
    for (const m of models) {
      expect(m.maxInputTokens).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it('flags glm-5.3 as text-only and glm-5.3-flash as multimodal', () => {
    // Upstream: GLM 5.3 is text-only input, GLM 5.3-Flash is the first
    // native multimodal model of the series. A wrong flag makes the
    // vision proxy send an image to a model that rejects it.
    const models = (bundled.models as Array<{ id: string; capabilities: { imageInput: boolean } }>).filter(
      (m) => m.id === 'glm-5.3' || m.id === 'glm-5.3-flash'
    );
    expect(models.find((m) => m.id === 'glm-5.3')?.capabilities.imageInput).toBe(false);
    expect(models.find((m) => m.id === 'glm-5.3-flash')?.capabilities.imageInput).toBe(true);
  });
});

describe('Z.ai smoke - API key resolution', () => {
  it('API_KEY_SECRETS registers the zai secret', () => {
    expect(API_KEY_SECRETS.zai).toBe('aiflowbridge.providers.zai.apiKey');
  });

  it('resolveVendorApiKey returns the zai key for a bare "zai" id', async () => {
    const secrets = { get: async (key: string) => (key === API_KEY_SECRETS.zai ? 'zai-test-key' : undefined) };
    expect(await resolveVendorApiKey('zai', secrets)).toBe('zai-test-key');
  });

  it('resolveVendorApiKey returns the zai key for a "glm-" model id', async () => {
    const secrets = { get: async (key: string) => (key === API_KEY_SECRETS.zai ? 'zai-test-key' : undefined) };
    expect(await resolveVendorApiKey('glm-5.3-flash', secrets)).toBe('zai-test-key');
  });

  it('resolveVendorApiKey does NOT return the zai key for the OpenRouter id z-ai/glm-5.3', async () => {
    // `z-ai/glm-5.3` is an OpenRouter upstream id, not a Z.ai one. It
    // contains a slash so it misses every `zai` alias and must fall
    // through to the OpenRouter family fallback.
    const secrets = {
      get: async (key: string) => {
        if (key === API_KEY_SECRETS.zai) return 'zai-test-key';
        if (key === API_KEY_SECRETS.openrouter) return 'sk-or-test';
        return undefined;
      },
    };
    expect(await resolveVendorApiKey('z-ai/glm-5.3', secrets)).toBe('sk-or-test');
  });
});
