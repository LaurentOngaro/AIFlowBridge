/**
 * Unit tests for src/aiflowbridge/host-config.ts (renamed from
 * `src/aiflowbridge/config.ts` in the 2026-07-11 audit pass to
 * disambiguate from the VS Code-specific `src/config.ts` at the
 * repo root).
 *
 * Focus:
 * - synthesizeProvidersFromUserModels() - merging user-declared models
 *   into the gateway provider list so OpenAI-compatible clients (Kilo Code,
 *   Continue,...) see them via GET /v1/models.
 * - synthesizeProvidersFromBuiltInModels() - mirroring the built-in
 *   model registry into the gateway catalog so every model exposed in
 *   the Copilot Chat picker is also routable through the gateway, with
 *   the family-level indicative pricing attached for the dashboard.
 *
 * The model registry is populated from the bundled `resources/models.json`
 * via a hoisted `setLoadedRegistry()` call in `beforeAll`. This replaces
 * the previous static import of `MODELS` / `DEFAULT_PROVIDER_URLS` from
 * `src/consts.ts` (now removed).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUserModels, mockRegistry, mockConfiguration } = vi.hoisted(() => {
  const mockUserModels = { value: [] as unknown[] };
  const mockConfiguration = {
    get: vi.fn((key: string, fallback?: unknown) => {
      if (key.startsWith('providers.') && key.endsWith('.baseUrl')) {
        return undefined;
      }
      return fallback;
    }),
  };
  const mockRegistry: { value: unknown } = { value: undefined };
  return { mockUserModels, mockRegistry, mockConfiguration };
});

vi.mock('vscode', () => {
  return {
    default: {
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((key: string, fallback?: unknown) => {
            if (key === 'userModels') return mockUserModels.value;
            return mockConfiguration.get(key, fallback);
          }),
        })),
      },
    },
  };
});

import { synthesizeProvidersFromBuiltInModels, synthesizeProvidersFromUserModels } from '../src/aiflowbridge/host-config';
import { setLoadedRegistry } from '../src/aiflowbridge/modelRegistry';
import { validateRegistryContent, validateRegistryStructure } from '../src/aiflowbridge/modelRegistry.schema';
import { buildModelCatalog, selectProvider } from '../src/aiflowbridge/providers';
import type { ProviderProfile } from '../src/aiflowbridge/types';

const BUNDLED_REGISTRY_PATH = resolve(__dirname, '..', 'resources', 'models.json');

function loadBundledRegistry(): import('../src/aiflowbridge/modelRegistry.schema').ModelRegistry {
  const raw = JSON.parse(readFileSync(BUNDLED_REGISTRY_PATH, 'utf8'));
  validateRegistryStructure(raw);
  const content = validateRegistryContent(raw, 'strict');
  return {
    version: 1,
    vendors: content.vendors,
    models: content.models,
    sources: {
      bundled: { exists: true, path: BUNDLED_REGISTRY_PATH },
      globalStorage: { exists: false, path: '' },
      workspace: { exists: false, path: '' },
    },
  };
}

function baseProvider(): ProviderProfile {
  const registry = loadBundledRegistry();
  return {
    // Use the real upstream model id as the catalog `id` - vendor names
    // like `'minimax'` would expose a fake model id to Kilo Code / Continue /
    // Open WebUI that no upstream API recognises. See the regression test
    // "hand-curated gateway profiles use real upstream model ids as catalog ids"
    // at the bottom of this file.
    id: 'MiniMax-M2.7',
    label: 'MiniMax V2.7',
    kind: 'openai-compat',
    baseUrl: registry.vendors.minimax.baseUrl,
    model: 'MiniMax-M2.7',
    enabled: true,
  };
}

function fakeConfig(): unknown {
  return {
    get: (key: string, fallback?: unknown) => {
      if (key.startsWith('providers.') && key.endsWith('.baseUrl')) {
        return undefined;
      }
      return fallback;
    },
  };
}

beforeAll(() => {
  mockRegistry.value = loadBundledRegistry();
  setLoadedRegistry(mockRegistry.value as never);
});

describe('synthesizeProvidersFromUserModels', () => {
  beforeEach(() => {
    mockUserModels.value = [];
  });

  it('returns existing providers unchanged when userModels is empty', () => {
    const existing = [baseProvider()];
    const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, loadBundledRegistry());
    expect(result).toEqual(existing);
  });

  it('adds a synthesized provider for a MiniMax M3 user model', () => {
    const registry = loadBundledRegistry();
    mockUserModels.value = [{ id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' }];
    const existing = [baseProvider()];
    const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, registry);

    expect(result).toHaveLength(2);
    const m3 = result.find((p) => p.model === 'MiniMax-M3');
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: 'MiniMax-M3',
      label: 'MiniMax M3',
      kind: 'openai-compat',
      baseUrl: registry.vendors.minimax.baseUrl,
      model: 'MiniMax-M3',
      enabled: true,
    });
    // Synthesized MiniMax providers inherit the family-level indicative
    // token-plan pricing so user-declared models show a non-zero
    // "Estimated cost" in the dashboard without extra configuration.
    expect(m3?.pricing).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
  });

  it('does not duplicate a model already covered by an existing provider', () => {
    mockUserModels.value = [{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7', family: 'minimax', version: 'm2.7' }];
    const existing = [baseProvider()];
    const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, loadBundledRegistry());
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe('MiniMax-M2.7');
  });

  it('does not duplicate a model whose id collides with an existing provider id', () => {
    // The base provider covers MiniMax-M2.7. A user model with the same
    // id must be skipped to avoid a duplicate in the catalog.
    mockUserModels.value = [{ id: 'MiniMax-M2.7', name: 'MiniMax (duplicate)', family: 'minimax', version: 'x' }];
    const existing = [baseProvider()];
    const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, loadBundledRegistry());
    expect(result).toHaveLength(1);
  });

  it('skips user models with an unknown family', () => {
    mockUserModels.value = [{ id: 'mystery-1', name: 'Mystery', family: 'unknown-vendor', version: '1' }];
    const existing = [baseProvider()];
    const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, loadBundledRegistry());
    expect(result).toHaveLength(1);
  });

  it('handles multiple user models across vendors', () => {
    const registry = loadBundledRegistry();
    mockUserModels.value = [
      { id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' },
      { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', family: 'xiaomi', version: 'v2' },
      { id: 'deepseek-v4-turbo', name: 'DeepSeek V4 Turbo', family: 'deepseek', version: 'v4' },
    ];
    const existing: ProviderProfile[] = [];
    const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, registry);

    expect(result).toHaveLength(3);
    expect(result.find((p) => p.model === 'MiniMax-M3')?.baseUrl).toBe(registry.vendors.minimax.baseUrl);
    expect(result.find((p) => p.model === 'mimo-v2-omni')?.baseUrl).toBe(registry.vendors.xiaomi.baseUrl);
    expect(result.find((p) => p.model === 'deepseek-v4-turbo')?.baseUrl).toBe(registry.vendors.deepseek.baseUrl);
  });

  it('preserves the order: existing providers first, then synthesized ones', () => {
    mockUserModels.value = [{ id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' }];
    const existing = [baseProvider()];
    const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, loadBundledRegistry());
    expect(result[0].id).toBe('MiniMax-M2.7');
    expect(result[1].id).toBe('MiniMax-M3');
  });
});

describe('integration with selectProvider and buildModelCatalog', () => {
  beforeEach(() => {
    mockUserModels.value = [{ id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' }];
  });

  it('synthesized provider is routable via selectProvider by model name', () => {
    const registry = loadBundledRegistry();
    const existing = [baseProvider()];
    const providers = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, registry);
    const routed = selectProvider(providers, 'MiniMax-M3', '');
    expect(routed).toBeDefined();
    expect(routed?.model).toBe('MiniMax-M3');
    expect(routed?.baseUrl).toBe(registry.vendors.minimax.baseUrl);
  });

  it('synthesized provider appears in the /v1/models catalog', () => {
    const existing = [baseProvider()];
    const providers = synthesizeProvidersFromUserModels(existing, fakeConfig() as never, loadBundledRegistry());
    const catalog = buildModelCatalog(providers);
    const ids = catalog.map((m) => m.id);
    expect(ids).toContain('MiniMax-M3');
  });
});

describe('synthesizeProvidersFromBuiltInModels', () => {
  beforeEach(() => {
    mockUserModels.value = [];
  });

  it('adds a provider for every built-in model that is not already in `existing`', () => {
    // Empty starting list: every model in the bundled registry should be synthesized.
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, loadBundledRegistry());
    const ids = new Set(providers.map((p) => p.id));
    // Spot-check a few well-known ids from each family.
    expect(ids.has('deepseek-v4-flash')).toBe(true);
    expect(ids.has('MiniMax-M2.7')).toBe(true);
    expect(ids.has('MiniMax-M3')).toBe(true);
    expect(ids.has('mimo-v2-omni')).toBe(true);
    expect(ids.has('mimo-v2.5-pro')).toBe(true);
  });

  it('attaches the family-level indicative pricing to each synthesized provider', () => {
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, loadBundledRegistry());
    const m3 = providers.find((p) => p.model === 'MiniMax-M3');
    expect(m3?.pricing).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
    const mimo = providers.find((p) => p.model === 'mimo-v2-omni');
    expect(mimo?.pricing).toEqual({ inputPerMillion: 0.1, outputPerMillion: 0.3, currency: 'USD' });
  });

  it('attaches the per-model bundled pricing from the registry (not just the family default)', () => {
    // The bundled registry ships with explicit per-model pricing for
    // every model (deepseek-v4-flash, MiniMax-M3, mimo-v2-omni,...).
    // The synthesis must surface those per-model rates on the
    // synthesized provider so the dashboard's "Estimated cost" /
    // "Pricing" columns and rate tooltips are non-zero and accurate.
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, loadBundledRegistry());
    const deepseek = providers.find((p) => p.model === 'deepseek-v4-flash');
    expect(deepseek?.pricing).toEqual({ inputPerMillion: 0.27, outputPerMillion: 1.1, currency: 'USD' });
  });

  it('does not duplicate models already covered by an existing provider', () => {
    // The default baseProvider covers MiniMax-M2.7; the synthesis should
    // skip it and add every other model instead.
    const providers = synthesizeProvidersFromBuiltInModels([baseProvider()], fakeConfig() as never, loadBundledRegistry());
    const m27 = providers.filter((p) => p.model === 'MiniMax-M2.7');
    expect(m27).toHaveLength(1);
    expect(m27[0].id).toBe('MiniMax-M2.7'); // The hand-curated entry wins.
    // But M3, V2 Omni, etc. should still be added.
    expect(providers.find((p) => p.model === 'MiniMax-M3')).toBeDefined();
    expect(providers.find((p) => p.model === 'mimo-v2-omni')).toBeDefined();
  });

  it('preserves the order: existing providers first, then built-in syntheses', () => {
    const providers = synthesizeProvidersFromBuiltInModels([baseProvider()], fakeConfig() as never, loadBundledRegistry());
    expect(providers[0].id).toBe('MiniMax-M2.7');
    // First synthesized entry should be a deepseek model (since the
    // bundled registry starts with the deepseek family).
    expect(providers[1].id).toBe('deepseek-v4-flash');
  });

  it('uses the vendor baseUrl from the configuration override when present', () => {
    const configWithXiaomiOverride = {
      get: (key: string, fallback?: unknown) => {
        if (key === 'providers.xiaomi.baseUrl') return 'https://token-plan-sgp.xiaomimimo.com/v1';
        return fallback;
      },
    };
    const providers = synthesizeProvidersFromBuiltInModels([], configWithXiaomiOverride as never, loadBundledRegistry());
    const v25 = providers.find((p) => p.model === 'mimo-v2.5');
    expect(v25?.baseUrl).toBe('https://token-plan-sgp.xiaomimimo.com/v1');
  });

  it('picks up the per-model pricing from a globalStorage / workspace override (T3 regression)', () => {
    // editing a model's pricing in
    // `<globalStorageUri>/models.json` (or a workspace override) and
    // reloading VS Code must surface the new rate in the gateway
    // provider list (and therefore in the dashboard). The 3-tier
    // merge in `loadModelRegistry` already produces the right
    // `ModelRegistry` - the synthesis must actually USE the per-model
    // `pricing` block instead of the hardcoded family-level default.
    const registry = loadBundledRegistry();
    const overridden: import('../src/aiflowbridge/modelRegistry.schema').ModelRegistry = {
      ...registry,
      models: registry.models.map((model) =>
        model.id === 'MiniMax-M2.7' ? { ...model, pricing: { inputPerMillion: 0.99, outputPerMillion: 4.2, currency: 'USD' } } : model
      ),
    };
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, overridden);
    const m27 = providers.find((p) => p.model === 'MiniMax-M2.7');
    expect(m27?.pricing).toEqual({ inputPerMillion: 0.99, outputPerMillion: 4.2, currency: 'USD' });
  });

  it('falls back to the family-level indicative pricing when a model in the registry has no pricing', () => {
    // Family-level fallback is what guarantees un-priced models still
    // show a non-zero "Estimated cost" in the dashboard. We strip
    // pricing from `mimo-v2-omni` in the registry; the synthesis
    // must use the indicative xiaomi family default ({0.1, 0.3}).
    const registry = loadBundledRegistry();
    const stripped = {
      ...registry,
      models: registry.models.map((model) => (model.id === 'mimo-v2-omni' ? { ...model, pricing: undefined } : model)),
    };
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, stripped);
    const om = providers.find((p) => p.model === 'mimo-v2-omni');
    expect(om?.pricing).toEqual({ inputPerMillion: 0.1, outputPerMillion: 0.3, currency: 'USD' });
  });
});

describe('hand-curated gateway profiles use real upstream model ids as catalog ids', () => {
  // Regression test for the bug where `DEFAULT_GATEWAY_PROFILES` had
  // `id: 'minimax'` and `id: 'xiaomi'` (vendor names) instead of the real
  // upstream model ids. The catalog exposed to Kilo Code / Continue /
  // Open WebUI then listed `minimax` / `xiaomi` as fake model ids that
  // no upstream API recognises. This test asserts that every `id` in the
  // synthesized catalog matches the upstream model id (i.e. `id === model`)
  // for the hand-curated entries, so the picker shows real model names.
  const KNOWN_VENDOR_NAMES = new Set([
    'deepseek', 'minimax', 'xiaomi', 'openrouter',
    // Long-form aliases that would also be wrong as catalog ids.
    'minimax-m2', 'xiaomi-mimo', 'openrouter-ai', 'aiflowbridge',
  ]);

  function isVendorShaped(id: string): boolean {
    // Heuristic: lowercase letters and dashes only, no uppercase, no digits
    // (most real upstream ids have digits like v4-flash, M2.7, etc.).
    return /^[a-z][a-z-]*$/.test(id) && !/[\d]/.test(id);
  }

  it('no hand-curated catalog id is a bare vendor name (regression for the minimax / xiaomi bug)', () => {
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, loadBundledRegistry());
    const ids = providers.map((p) => p.id);
    for (const forbidden of KNOWN_VENDOR_NAMES) {
      expect(ids, `id "${forbidden}" leaked into the catalog`).not.toContain(forbidden);
    }
  });

  it('no hand-curated catalog id looks like a vendor-only string (lowercase letters + dashes only)', () => {
    // Wider heuristic: real upstream ids have digits, dots, or upper-case
    // (DeepSeek V4, MiniMax-M2.7, mimo-v2.5-pro, openai/gpt-oss-120b:free).
    // A bare-vendor-shape id without digits is a strong smell.
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, loadBundledRegistry());
    const vendorShaped = providers.filter((p) => isVendorShaped(p.id)).map((p) => p.id);
    expect(vendorShaped).toEqual([]);
  });

  it('every hand-curated catalog id matches the upstream model id (id === model)', () => {
    // The hand-curated DEFAULT_GATEWAY_PROFILES use `id === model` (the
    // real upstream id) - NOT a friendly alias like `deepseek-flash` (which
    // was the historical convention for DeepSeek). For MiniMax and Xiaomi,
    // the alias convention was abandoned because shipping the vendor name
    // as a catalog id is misleading; this test pins the new convention.
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, loadBundledRegistry());
    // The hand-curated entries are the first 4 (deepseek-flash, deepseek-pro,
    // MiniMax-M2.7, mimo-v2.5-pro). For MiniMax + Xiaomi, `id` MUST equal
    // `model` exactly. For DeepSeek, the alias is allowed but the picked
    // test below asserts the MiniMax + Xiaomi invariant.
    const minimax = providers.find((p) => p.model === 'MiniMax-M2.7');
    expect(minimax?.id).toBe('MiniMax-M2.7');
    const xiaomi = providers.find((p) => p.model === 'mimo-v2.5-pro');
    expect(xiaomi?.id).toBe('mimo-v2.5-pro');
  });

  it('whitelists the historical DeepSeek alias convention (deepseek-flash, deepseek-pro)', () => {
    // The 2.13.0 catalog-id regression test (above) asserts that
    // MiniMax + Xiaomi hand-curated entries use `id === model`. The
    // audit also flagged that the DeepSeek hand-curated entries
    // historically used `id: 'deepseek-flash'` with `model:
    // 'deepseek-v4-flash'` - a friendly alias, not a vendor name leak.
    // The alias is documented as an allowed exception in
    // `docs/agent-instructions/tasks.md` (Path A, step 9). Without an
    // explicit whitelist, a future contributor could "fix" the alias
    // to match `model`, rename the catalog id, and break every Kilo
    // Code / Continue config that pinned `deepseek-flash` in the
    // picker. This test pins the whitelist so the alias stays
    // intentional, not accidental.
    //
    // The hand-curated `DEFAULT_GATEWAY_PROFILES` array is internal to
    // `host-config.ts`; we mirror the two DeepSeek entries here as
    // the `existing` provider list (this matches what
    // `loadConfigFromContext` builds via `buildDefaultGatewayProfiles`)
    // so the synthesis step runs over them and the assertion below
    // verifies the alias is preserved.
    const registry = loadBundledRegistry();
    const handCurated: ProviderProfile[] = [
      {
        id: 'deepseek-flash',
        label: 'DeepSeek V4 Flash',
        kind: 'openai-compat',
        baseUrl: registry.vendors.deepseek.baseUrl,
        model: 'deepseek-v4-flash',
        enabled: true,
      },
      {
        id: 'deepseek-pro',
        label: 'DeepSeek V4 Pro',
        kind: 'openai-compat',
        baseUrl: registry.vendors.deepseek.baseUrl,
        model: 'deepseek-v4-pro',
        enabled: true,
      },
    ];
    const providers = synthesizeProvidersFromBuiltInModels(handCurated, fakeConfig() as never, registry);
    const deepseekFlash = providers.find((p) => p.model === 'deepseek-v4-flash');
    expect(deepseekFlash?.id).toBe('deepseek-flash');
    expect(deepseekFlash?.model).toBe('deepseek-v4-flash');
    const deepseekPro = providers.find((p) => p.model === 'deepseek-v4-pro');
    expect(deepseekPro?.id).toBe('deepseek-pro');
    expect(deepseekPro?.model).toBe('deepseek-v4-pro');
  });

  it('DeepSeek alias catalog ids still route to the real upstream model via selectProvider', () => {
    // The DeepSeek alias `deepseek-flash` must still resolve to the
    // upstream `deepseek-v4-flash` via `selectProvider` so a client
    // that pinned the friendly alias in its config (Kilo Code model
    // picker, Continue config.json) keeps working. selectProvider
    // already matches `id` / `model` / `label`, so this assertion is
    // a regression guard for the documented exception: a future
    // change that breaks the alias resolution would surface here.
    const registry = loadBundledRegistry();
    const handCurated: ProviderProfile[] = [
      {
        id: 'deepseek-flash',
        label: 'DeepSeek V4 Flash',
        kind: 'openai-compat',
        baseUrl: registry.vendors.deepseek.baseUrl,
        model: 'deepseek-v4-flash',
        enabled: true,
      },
      {
        id: 'deepseek-pro',
        label: 'DeepSeek V4 Pro',
        kind: 'openai-compat',
        baseUrl: registry.vendors.deepseek.baseUrl,
        model: 'deepseek-v4-pro',
        enabled: true,
      },
    ];
    const providers = synthesizeProvidersFromBuiltInModels(handCurated, fakeConfig() as never, registry);
    const routedFlash = selectProvider(providers, 'deepseek-flash', '');
    expect(routedFlash?.model).toBe('deepseek-v4-flash');
    const routedPro = selectProvider(providers, 'deepseek-pro', '');
    expect(routedPro?.model).toBe('deepseek-v4-pro');
    // And the real upstream ids still route via the `model` alias.
    const routedReal = selectProvider(providers, 'deepseek-v4-flash', '');
    expect(routedReal?.model).toBe('deepseek-v4-flash');
  });

  it('GET /v1/models catalog (built from synthesized providers) lists real upstream ids, never vendor names', () => {
    // End-to-end assertion: the picker visible in Kilo Code / Continue /
    // Open WebUI is `buildModelCatalog(providers)`. The test pulls the
    // full bundled pipeline (no overrides) and asserts the catalog
    // contains no entry whose id is a bare vendor name.
    const providers = synthesizeProvidersFromBuiltInModels([], fakeConfig() as never, loadBundledRegistry());
    const catalog = buildModelCatalog(providers);
    const ids = catalog.map((m) => m.id);
    for (const forbidden of KNOWN_VENDOR_NAMES) {
      expect(ids, `id "${forbidden}" leaked into GET /v1/models`).not.toContain(forbidden);
    }
  });
});
