/**
 * Google AI Studio (Gemini BYOK) smoke test.
 *
 * `googleaistudio` is a gateway-only vendor (Path B in
 * `docs/agent-instructions/tasks.md`): no
 * `vscode.LanguageModelChatProvider` class, only an
 * OpenAI-compatible profile synthesized from the bundled registry. The
 * OAuth branch of the same vendor (Antigravity / Cloud Code Assist) has
 * its own coverage in the antigravity suites; this file pins the BYOK
 * path.
 *
 * This test pins the things that silently break a Path B vendor:
 *   - the bundled registry is structurally valid (a broken bundled file
 *     is fatal, unlike a broken override)
 *   - the `googleaistudio` vendor entry carries a usable baseUrl +
 *     apiKeySecret, and the baseUrl passes the SSRF guard
 *   - the `gemini-*` family is actually present (an undeclared family is
 *     dropped fail-soft: a warn in the logs, the model disappears from
 *     the catalog with no visible error)
 *   - the API key secret slot exists and resolves for the vendor id and
 *     for the upstream `gemini-*` model-id prefix
 *   - the key is NOT declared as a plaintext setting. It lives in
 *     SecretStorage; a contributed `aiflowbridge.providers.<vendor>.apiKey`
 *     setting would invite the user to paste a key into `settings.json`
 *     (and would be workspace-overridable).
 *
 * VS-Code-free: imports the bundled registry and the pure helpers
 * directly, so it runs without a VS Code host.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import bundled from '../../resources/models.json';
import { resolveVendorApiKey } from '../../src/aiflowbridge/api-key-resolver';
import { validateRegistryStructure } from '../../src/aiflowbridge/modelRegistry.schema';
import { isValidProviderBaseUrl } from '../../src/aiflowbridge/providers';
import { API_KEY_SECRETS } from '../../src/consts';

const GOOGLE_AISTUDIO_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

describe('Google AI Studio smoke - registry shape', () => {
  it('bundled resources/models.json is structurally valid', () => {
    expect(() => validateRegistryStructure(bundled)).not.toThrow();
  });

  it('bundled registry declares the googleaistudio vendor with the canonical baseUrl', () => {
    const vendor = (bundled.vendors as Record<string, { baseUrl: string; apiKeySecret: string }> | undefined)?.googleaistudio;
    expect(vendor).toBeDefined();
    expect(vendor?.baseUrl).toBe(GOOGLE_AISTUDIO_BASE_URL);
    expect(vendor?.apiKeySecret).toBe('aiflowbridge.providers.googleaistudio.apiKey');
  });

  it('the canonical googleaistudio baseUrl passes the SSRF guard', () => {
    expect(isValidProviderBaseUrl(GOOGLE_AISTUDIO_BASE_URL)).toBe(true);
  });

  it('bundled registry lists the Gemini flash models', () => {
    const models = (bundled.models as Array<{ id: string; family: string }>).filter((m) => m.family === 'googleaistudio');
    const ids = models.map((m) => m.id);
    expect(ids).toContain('gemini-3.8-flash');
    expect(ids).toContain('gemini-flash-latest');
  });

  it('every googleaistudio model declares a positive context and output window', () => {
    const models = (bundled.models as Array<{ family: string; maxInputTokens: number; maxOutputTokens: number }>).filter(
      (m) => m.family === 'googleaistudio'
    );
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.maxInputTokens).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeGreaterThan(0);
    }
  });
});

describe('Google AI Studio smoke - API key resolution', () => {
  it('API_KEY_SECRETS registers the googleaistudio secret', () => {
    expect(API_KEY_SECRETS.googleaistudio).toBe('aiflowbridge.providers.googleaistudio.apiKey');
  });

  it('resolveVendorApiKey returns the googleaistudio key for a bare vendor id', async () => {
    const secrets = {
      get: async (key: string) => (key === API_KEY_SECRETS.googleaistudio ? 'gemini-test-key' : undefined),
    };
    expect(await resolveVendorApiKey('googleaistudio', secrets)).toBe('gemini-test-key');
  });

  it('resolveVendorApiKey returns the googleaistudio key for a "gemini-" model id', async () => {
    const secrets = {
      get: async (key: string) => (key === API_KEY_SECRETS.googleaistudio ? 'gemini-test-key' : undefined),
    };
    expect(await resolveVendorApiKey('gemini-3.8-flash', secrets)).toBe('gemini-test-key');
  });

  it('does NOT leak the key to an unrelated vendor id', async () => {
    const secrets = {
      get: async (key: string) => (key === API_KEY_SECRETS.googleaistudio ? 'gemini-test-key' : undefined),
    };
    expect(await resolveVendorApiKey('anthropic/claude-sonnet-5.5', secrets)).toBeUndefined();
  });

  it('is not declared as a plaintext setting in package.json', () => {
    // The key belongs in SecretStorage (`API_KEY_SECRETS` above). A
    // contributed setting would put it in `settings.json`, which is
    // workspace-overridable and world-readable in a shared repo.
    const manifest = readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8');
    const properties = JSON.parse(manifest).contributes?.configuration?.properties ?? {};
    expect(Object.keys(properties)).not.toContain('aiflowbridge.providers.googleaistudio.apiKey');
    for (const key of Object.keys(properties)) {
      expect(key, 'API keys must never be a contributed setting').not.toMatch(/\.apiKey$/);
    }
  });
});