/**
 * Unit tests for `src/aiflowbridge/pricing/loader.ts` - the 4-tier pricing
 * registry loader.
 *
 * Strategy: inject a fake `fs.readFile` (returns the bytes of a
 * pre-built JSON string per path) so the loader exercises the real
 * merge logic without touching disk. Mirrors the seam used by
 * `tests/modelRegistry.test.ts` for the 3-tier model registry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// ---- Minimal vscode mock (hoisted so vi.mock can reference it) ----

class MockUri {
  constructor(public readonly fsPath: string) {}
  toString(): string {
    return this.fsPath;
  }
}

const { mockVscode } = vi.hoisted(() => {
  class HoistedMockUri {
    constructor(public readonly fsPath: string) {}
    toString(): string {
      return this.fsPath;
    }
  }
  const stubChannel = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  };
  return {
    mockVscode: {
      Uri: {
        joinPath: (base: HoistedMockUri, ...segments: string[]) =>
          new HoistedMockUri([base.fsPath.replace(/\/+$/, ''), ...segments].join('/')),
      },
      workspace: {
        fs: { readFile: () => Promise.reject(new Error('not used in this test')) },
        workspaceFolders: undefined,
      },
      window: { createOutputChannel: () => stubChannel },
    },
  };
});

vi.mock('vscode', () => {
  const mock: Record<string, unknown> = {
    Uri: mockVscode.Uri,
    workspace: mockVscode.workspace,
    window: mockVscode.window,
  };
  mock.default = mock;
  return mock;
});

import { loadPricingRegistry, replacePricingEntries, setPricingRegistry, tryGetLoadedPricingRegistry } from '../src/aiflowbridge/pricing/loader';
import type { PricingEntry } from '../src/aiflowbridge/pricing/loader';

const ENCODER = new TextEncoder();
const BUNDLED_PRICING_PATH = '/extension/resources/pricing.json';
const GLOBAL_STORAGE_PATH = '/globalStorage';
const WORKSPACE_PATH = '/workspace';

function makeContext(): { extensionUri: MockUri; globalStorageDir: string; workspaceFolder?: MockUri } {
  return {
    extensionUri: new MockUri(BUNDLED_PRICING_PATH.replace('/resources/pricing.json', '')),
    globalStorageDir: GLOBAL_STORAGE_PATH,
    workspaceFolder: new MockUri(WORKSPACE_PATH),
  };
}

interface FakeFs {
  readFile: Mock<(uri: MockUri) => Promise<Uint8Array>>;
}

function makeFs(filesByPath: Record<string, unknown>): FakeFs {
  return {
    readFile: vi.fn(async (uri: MockUri) => {
      const key = uri.toString();
      if (!Object.prototype.hasOwnProperty.call(filesByPath, key)) {
        const err = new Error(`File not found: ${key}`) as Error & { code: string; name: string };
        err.code = 'FileNotFound';
        err.name = 'FileNotFound';
        throw err;
      }
      return ENCODER.encode(JSON.stringify(filesByPath[key]));
    }),
  };
}

function pricingFile(entries: Record<string, Partial<PricingEntry>>, overrides: { generatedAt?: string; version?: string } = {}): unknown {
  return {
    schemaVersion: 1,
    generatedAt: overrides.generatedAt ?? '2026-07-13T15:00:00Z',
    source: 'openrouter',
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    aiflowbridgeVersion: overrides.version ?? '2.14.0',
    models: Object.fromEntries(
      Object.entries(entries).map(([id, e]) => [
        id,
        {
          inputPerMillion: e.inputPerMillion ?? 0,
          outputPerMillion: e.outputPerMillion ?? 0,
          currency: 'USD',
          fetchedAt: e.fetchedAt ?? '2026-07-13T15:00:00Z',
        },
      ])
    ),
  };
}

beforeEach(() => {
  setPricingRegistry(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loadPricingRegistry - 4-tier merge', () => {
  it('returns just the bundled tier when no overrides exist', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    const result = await loadPricingRegistry(makeContext(), { fs });

    expect(Object.keys(result.models)).toEqual(['openai/gpt-4o']);
    expect(result.sourceByModel['openai/gpt-4o']).toBe('bundled (pricing.json)');
    expect(result.bundledFetchedAt).toBe('2026-07-13T15:00:00Z');
    expect(result.bundledVersion).toBe('2.14.0');
    expect(result.sources.bundled.exists).toBe(true);
    expect(result.sources.globalStorage.exists).toBe(false);
    expect(result.sources.workspace.exists).toBe(false);
  });

  it('globalStorage override wins over the bundled tier', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const override = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 6, outputPerMillion: 18, fetchedAt: '2026-07-20T00:00:00Z' } });
    const fs = makeFs({
      [BUNDLED_PRICING_PATH]: bundled,
      [`${GLOBAL_STORAGE_PATH}/pricing-override.json`]: override,
    });
    const result = await loadPricingRegistry(makeContext(), { fs });

    expect(result.models['openai/gpt-4o'].inputPerMillion).toBe(6);
    expect(result.models['openai/gpt-4o'].outputPerMillion).toBe(18);
    expect(result.sourceByModel['openai/gpt-4o']).toBe('override (globalStorage)');
  });

  it('workspace override wins over globalStorage and bundled', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const override = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 6, outputPerMillion: 18 } });
    const workspace = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 7, outputPerMillion: 21 } });
    const fs = makeFs({
      [BUNDLED_PRICING_PATH]: bundled,
      [`${GLOBAL_STORAGE_PATH}/pricing-override.json`]: override,
      [`${WORKSPACE_PATH}/.vscode/aiflowbridge.pricing.json`]: workspace,
    });
    const result = await loadPricingRegistry(makeContext(), { fs });

    expect(result.models['openai/gpt-4o'].inputPerMillion).toBe(7);
    expect(result.sourceByModel['openai/gpt-4o']).toBe('override (workspace)');
  });

  it('falls back to per-model models.json pricing blocks for entries not in pricing.json', async () => {
    const bundled = pricingFile({}); // empty bundled pricing
    const perModel = {
      'deepseek-v4-pro': { inputPerMillion: 0.55, outputPerMillion: 2.19, currency: 'USD', fetchedAt: '' } as PricingEntry,
    };
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    const result = await loadPricingRegistry(makeContext(), { fs }, perModel);

    expect(result.models['deepseek-v4-pro']).toEqual({
      inputPerMillion: 0.55,
      outputPerMillion: 2.19,
      currency: 'USD',
      fetchedAt: '',
    });
    expect(result.sourceByModel['deepseek-v4-pro']).toBe('bundled (models.json)');
  });

  it('per-model models.json pricing is shadowed by bundled pricing.json', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const perModel = {
      'openai/gpt-4o': { inputPerMillion: 99, outputPerMillion: 99 } as PricingEntry,
    };
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    const result = await loadPricingRegistry(makeContext(), { fs }, perModel);

    expect(result.models['openai/gpt-4o'].inputPerMillion).toBe(5);
    expect(result.sourceByModel['openai/gpt-4o']).toBe('bundled (pricing.json)');
  });

  it('skips a malformed override file and falls through to the next tier', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const fs = makeFs({
      [BUNDLED_PRICING_PATH]: bundled,
      [`${GLOBAL_STORAGE_PATH}/pricing-override.json`]: { thisIsNotAValidPricingFile: true },
    });
    const result = await loadPricingRegistry(makeContext(), { fs });

    // The malformed override is skipped; the bundled tier wins.
    expect(result.models['openai/gpt-4o'].inputPerMillion).toBe(5);
    expect(result.sourceByModel['openai/gpt-4o']).toBe('bundled (pricing.json)');
  });

  it('skips a malformed bundled file and returns whatever the override tiers had', async () => {
    const override = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 6, outputPerMillion: 18 } });
    const fs = makeFs({
      [BUNDLED_PRICING_PATH]: { thisIsNotAValidPricingFile: true },
      [`${GLOBAL_STORAGE_PATH}/pricing-override.json`]: override,
    });
    const result = await loadPricingRegistry(makeContext(), { fs });

    expect(result.models['openai/gpt-4o'].inputPerMillion).toBe(6);
    expect(result.sourceByModel['openai/gpt-4o']).toBe('override (globalStorage)');
    expect(result.bundledFetchedAt).toBe('');
    expect(result.bundledVersion).toBe('');
  });

  it('drops invalid entries (negative numbers, non-finite) but keeps the rest', async () => {
    const bundled = {
      schemaVersion: 1,
      generatedAt: '2026-07-13T15:00:00Z',
      source: 'openrouter',
      models: {
        'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15, currency: 'USD', fetchedAt: '2026-07-13T15:00:00Z' },
        'broken/a': { inputPerMillion: -1, outputPerMillion: 1, currency: 'USD', fetchedAt: '2026-07-13T15:00:00Z' },
        'broken/b': { inputPerMillion: 1, outputPerMillion: 'NaN', currency: 'USD', fetchedAt: '2026-07-13T15:00:00Z' },
      },
    };
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    const result = await loadPricingRegistry(makeContext(), { fs });

    expect(Object.keys(result.models)).toEqual(['openai/gpt-4o']);
  });

  it('skips a workspace override when no workspace folder is configured', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    const ctx = {
      extensionUri: new MockUri(BUNDLED_PRICING_PATH.replace('/resources/pricing.json', '')),
      globalStorageDir: GLOBAL_STORAGE_PATH,
    };
    const result = await loadPricingRegistry(ctx, { fs });

    expect(result.sources.workspace.exists).toBe(false);
    expect(result.sourceByModel['openai/gpt-4o']).toBe('bundled (pricing.json)');
  });

  it('is idempotent: subsequent calls return the cached registry', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    const ctx = makeContext();
    const first = await loadPricingRegistry(ctx, { fs });
    const callCountAfterFirst = fs.readFile.mock.calls.length;
    const second = await loadPricingRegistry(ctx, { fs });
    expect(second).toBe(first);
    // The cached path never calls `readFile` again. The first call
    // tried three tiers (bundled, globalStorage, workspace).
    expect(fs.readFile).toHaveBeenCalledTimes(callCountAfterFirst);
  });
});

describe('replacePricingEntries', () => {
  it('updates the cached registry in place and labels new sources as globalStorage override', async () => {
    const bundled = pricingFile({ 'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 } });
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    await loadPricingRegistry(makeContext(), { fs });

    const newEntries: Record<string, PricingEntry> = {
      'openai/gpt-4o': { inputPerMillion: 6, outputPerMillion: 18, currency: 'USD', fetchedAt: '2026-07-20T00:00:00Z' },
      'anthropic/claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25, currency: 'USD', fetchedAt: '2026-07-20T00:00:00Z' },
    };
    const updated = replacePricingEntries(newEntries);
    expect(updated?.models['openai/gpt-4o'].inputPerMillion).toBe(6);
    expect(updated?.models['anthropic/claude-3-haiku'].inputPerMillion).toBe(0.25);
  });

  it('returns undefined when no registry has been loaded', () => {
    setPricingRegistry(undefined);
    expect(replacePricingEntries({})).toBeUndefined();
  });

  it('preserves existing entries that were not part of the update', async () => {
    const bundled = pricingFile({
      'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 },
      'anthropic/claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },
    });
    const fs = makeFs({ [BUNDLED_PRICING_PATH]: bundled });
    await loadPricingRegistry(makeContext(), { fs });

    replacePricingEntries({
      'openai/gpt-4o': { inputPerMillion: 6, outputPerMillion: 18, currency: 'USD', fetchedAt: '2026-07-20T00:00:00Z' },
    });

    const registry = tryGetLoadedPricingRegistry();
    expect(registry?.models['anthropic/claude-3-haiku'].inputPerMillion).toBe(0.25);
    expect(registry?.models['openai/gpt-4o'].inputPerMillion).toBe(6);
  });
});
