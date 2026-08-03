/**
 * Unit tests for `src/aiflowbridge/modelRegistry.ts` - the 3-tier loader.
 *
 * Strategy: inject a fake `fs.readFile` and a fake `workspaceFolder` via
 * the loader's `options` seam, so we never touch real disk. The minimal
 * `vscode` mock provides a `Uri.joinPath` shim that returns a Uri-like
 * object whose `toString()` is the path - this is what the loader records
 * in `sources.bundled.path` etc.
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
        joinPath: (base: HoistedMockUri, ...segments: string[]) => new HoistedMockUri([base.fsPath.replace(/\/+$/, ''), ...segments].join('/')),
      },
      workspace: {
        fs: { readFile: () => Promise.reject(new Error('not used in this test')) },
        workspaceFolders: undefined,
      },
      window: {
        createOutputChannel: () => stubChannel,
      },
    },
  };
});

vi.mock('vscode', () => {
  const mock: Record<string, unknown> = {
    Uri: mockVscode.Uri,
    workspace: mockVscode.workspace,
    window: mockVscode.window,
  };
  // Some transitive imports (`src/logger.ts`) use `import vscode from 'vscode'`
  // while the loader uses `import * as vscode from 'vscode'`. Expose both
  // shapes so vitest's export-completeness check passes for either style.
  mock.default = mock;
  return mock;
});

import * as vscode from 'vscode';
import { loadModelRegistry, setLoadedRegistry } from '../src/aiflowbridge/modelRegistry';

const ENCODER = new TextEncoder();
const BUNDLED_PATH = '/extension/resources/models.json';
const GLOBAL_STORAGE_PATH = '/globalStorage';
const WORKSPACE_PATH = '/workspace';

function makeContext(): vscode.ExtensionContext {
  return {
    extensionUri: new MockUri(BUNDLED_PATH.replace('/resources/models.json', '')),
    globalStorageUri: new MockUri(GLOBAL_STORAGE_PATH),
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function makeWorkspaceFolder(): vscode.WorkspaceFolder {
  return { uri: new MockUri(WORKSPACE_PATH), name: 'test', index: 0 } as unknown as vscode.WorkspaceFolder;
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

function minimalRegistry(overrides: { vendors?: unknown; models?: unknown[]; version?: number } = {}) {
  return {
    version: overrides.version ?? 1,
    vendors: overrides.vendors ?? {
      deepseek: { baseUrl: 'https://api.deepseek.com', apiKeySecret: 'k.deepseek' },
    },
    models: overrides.models ?? [
      {
        id: 'm1',
        name: 'M1',
        family: 'deepseek',
        version: '1',
        detail: 'd',
        maxInputTokens: 1,
        maxOutputTokens: 1,
        capabilities: { toolCalling: true, imageInput: false, thinking: false },
        requiresThinkingParam: false,
      },
    ],
  };
}

function bundledRegistry() {
  return minimalRegistry({
    vendors: {
      deepseek: { baseUrl: 'https://api.deepseek.com', apiKeySecret: 'k.deepseek' },
      minimax: { baseUrl: 'https://api.minimax.io/v1', apiKeySecret: 'k.minimax' },
      xiaomi: { baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1', apiKeySecret: 'k.xiaomi' },
    },
    models: [
      {
        id: 'm1',
        name: 'M1',
        family: 'deepseek',
        version: '1',
        detail: 'd',
        maxInputTokens: 1,
        maxOutputTokens: 1,
        capabilities: { toolCalling: true, imageInput: false, thinking: false },
        requiresThinkingParam: false,
      },
      {
        id: 'm2',
        name: 'M2',
        family: 'minimax',
        version: '1',
        detail: 'd',
        maxInputTokens: 1,
        maxOutputTokens: 1,
        capabilities: { toolCalling: true, imageInput: false, thinking: false },
        requiresThinkingParam: false,
      },
    ],
  });
}

beforeEach(() => {
  // Make sure the loader starts with a clean cache for each test.
  setLoadedRegistry(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loadModelRegistry - 3-tier merge', () => {
  it('returns just the bundled tier when no overrides exist', async () => {
    const fs = makeFs({ [`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`]: bundledRegistry() });
    const context = makeContext();
    const result = await loadModelRegistry(context, { fs });

    expect(result.models).toHaveLength(2);
    expect(Object.keys(result.vendors).sort()).toEqual(['deepseek', 'minimax', 'xiaomi']);
    expect(result.sources.bundled.exists).toBe(true);
    expect(result.sources.globalStorage.exists).toBe(false);
    expect(result.sources.workspace.exists).toBe(false);
  });

  it('recognises "openrouter" as a valid family in the bundled tier', async () => {
    // The bundled tier ships seven OpenRouter models (one entry per
    // flagship id). The KNOWN_FAMILIES Set in
    // src/aiflowbridge/modelRegistry.schema.ts MUST contain
    // "openrouter", otherwise every OpenRouter entry would be
    // rejected at validateModelEntry() and silently dropped from the
    // picker. This test exercises the full validateRegistryContent
    // path against a fixture that mirrors the real bundled registry.
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = {
      version: 1,
      vendors: {
        openrouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKeySecret: 'aiflowbridge.providers.openrouter.apiKey' },
      },
      models: [
        {
          id: 'openai/gpt-5',
          name: 'GPT-5',
          family: 'openrouter',
          version: 'gpt-5',
          detail: 'd',
          maxInputTokens: 400000,
          maxOutputTokens: 32768,
          capabilities: { toolCalling: true, imageInput: true, thinking: false },
          requiresThinkingParam: false,
        },
        {
          id: 'anthropic/claude-sonnet-4.5',
          name: 'Claude Sonnet 4.5',
          family: 'openrouter',
          version: 'claude-sonnet-4.5',
          detail: 'd',
          maxInputTokens: 200000,
          maxOutputTokens: 64000,
          capabilities: { toolCalling: true, imageInput: true, thinking: false },
          requiresThinkingParam: false,
        },
      ],
    };

    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs });

    expect(result.models.map((m) => m.id).sort()).toEqual(['anthropic/claude-sonnet-4.5', 'openai/gpt-5']);
    expect(result.vendors.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('resolves an unknown OpenRouter model added through a workspace override (100+ models reachable)', async () => {
    // OpenRouter exposes 100+ models; the bundled registry only lists
    // seven flagships. A user adding an OpenRouter-only model to their
    // .vscode/aiflowbridge.models.json must see the entry preserved
    // verbatim (id, family, capabilities all deep-merged from the
    // bundled tier where applicable).
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = bundledRegistry();
    files[`${WORKSPACE_PATH}/.vscode/aiflowbridge.models.json`] = {
      version: 1,
      models: [
        {
          id: 'openai/gpt-5',
          name: 'GPT-5 (Workspace override)',
          family: 'openrouter',
          version: 'gpt-5',
          detail: 'd-ws',
          maxInputTokens: 400000,
          maxOutputTokens: 32768,
          capabilities: { toolCalling: true, imageInput: true, thinking: false },
          requiresThinkingParam: false,
        },
      ],
    };

    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs, workspaceFolder: makeWorkspaceFolder() });

    const gpt5 = result.models.find((m) => m.id === 'openai/gpt-5');
    expect(gpt5).toBeDefined();
    expect(gpt5?.family).toBe('openrouter');
    expect(gpt5?.name).toBe('GPT-5 (Workspace override)');
    expect(gpt5?.detail).toBe('d-ws');
  });

  it('merges globalStorage override on top of bundled', async () => {
    const bundled = bundledRegistry();
    const override: Record<string, unknown> = {};
    override[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = bundled;
    override[`${GLOBAL_STORAGE_PATH}/models.json`] = minimalRegistry({
      models: [
        {
          id: 'm1',
          name: 'M1 OVERRIDE',
          family: 'deepseek',
          version: '1',
          detail: 'd-override',
          maxInputTokens: 999,
          maxOutputTokens: 1,
          capabilities: { toolCalling: true, imageInput: false, thinking: false },
          requiresThinkingParam: false,
          pricing: { inputPerMillion: 9, outputPerMillion: 9, currency: 'USD' },
        },
      ],
    });

    const fs = makeFs(override);
    const result = await loadModelRegistry(makeContext(), { fs });

    expect(result.models).toHaveLength(2);
    const m1 = result.models.find((m) => m.id === 'm1');
    expect(m1?.name).toBe('M1 OVERRIDE');
    expect(m1?.detail).toBe('d-override');
    expect(m1?.maxInputTokens).toBe(999);
    // pricing comes from the override (workspace would override it, but globalStorage does)
    expect(m1?.pricing).toEqual({ inputPerMillion: 9, outputPerMillion: 9, currency: 'USD' });
    expect(result.sources.globalStorage.exists).toBe(true);
  });

  it('accepts a partial globalStorage override that only changes pricing (T3 regression)', async () => {
    // the user edits `<globalStorageUri>/models.json`
    // to change the pricing of one model. In real life the user writes
    // a minimal entry with just `id` and `pricing` (the other fields are
    // inherited from the bundled tier). Before the partial-mode fix the
    // validator rejected this entry as "missing required field (name/family/...)"
    // and the override was silently dropped - the bundled pricing won
    // and the dashboard never reflected the change.
    const bundled = bundledRegistry();
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = bundled;
    files[`${GLOBAL_STORAGE_PATH}/models.json`] = {
      version: 1,
      models: [
        {
          id: 'm2',
          pricing: { inputPerMillion: 0.99, outputPerMillion: 4.2, currency: 'USD' },
        },
      ],
    };

    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs });

    const m2 = result.models.find((m) => m.id === 'm2');
    expect(m2).toBeDefined();
    // Fields not present in the override fall through to the bundled entry.
    expect(m2?.name).toBe('M2');
    expect(m2?.family).toBe('minimax');
    expect(m2?.detail).toBe('d');
    expect(m2?.maxInputTokens).toBe(1);
    // The pricing override wins.
    expect(m2?.pricing).toEqual({ inputPerMillion: 0.99, outputPerMillion: 4.2, currency: 'USD' });
  });

  it('still rejects an invalid pricing in a partial override (silent fail-soft is the wrong default)', async () => {
    // If the user mistypes `inputPerMillion: -1`, the whole override
    // entry is dropped (fail-soft). The merged registry keeps the
    // bundled pricing. We want a loud warning, not silent acceptance.
    const bundled = bundledRegistry();
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = bundled;
    files[`${GLOBAL_STORAGE_PATH}/models.json`] = {
      version: 1,
      models: [
        {
          id: 'm2',
          pricing: { inputPerMillion: -1, outputPerMillion: 4.2, currency: 'USD' },
        },
      ],
    };

    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs });

    const m2 = result.models.find((m) => m.id === 'm2');
    expect(m2).toBeDefined();
    // Override dropped: pricing falls back to bundled. (The bundled
    // entry in the test fixture doesn't have pricing, so the result
    // is undefined.)
    expect(m2?.pricing).toBeUndefined();
  });

  it('merges workspace override above globalStorage and bundled', async () => {
    const bundled = bundledRegistry();
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = bundled;
    files[`${GLOBAL_STORAGE_PATH}/models.json`] = minimalRegistry({
      models: [
        {
          id: 'm1',
          name: 'M1 GS',
          family: 'deepseek',
          version: '1',
          detail: 'gs',
          maxInputTokens: 100,
          maxOutputTokens: 1,
          capabilities: { toolCalling: true, imageInput: false, thinking: false },
          requiresThinkingParam: false,
        },
      ],
    });
    files[`${WORKSPACE_PATH}/.vscode/aiflowbridge.models.json`] = minimalRegistry({
      models: [
        {
          id: 'm1',
          name: 'M1 WS',
          family: 'deepseek',
          version: '1',
          detail: 'ws',
          maxInputTokens: 200,
          maxOutputTokens: 1,
          capabilities: { toolCalling: true, imageInput: false, thinking: false },
          requiresThinkingParam: false,
        },
        {
          id: 'workspace-only',
          name: 'WS Only',
          family: 'deepseek',
          version: '1',
          detail: 'd',
          maxInputTokens: 1,
          maxOutputTokens: 1,
          capabilities: { toolCalling: true, imageInput: false, thinking: false },
          requiresThinkingParam: false,
        },
      ],
    });

    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs, workspaceFolder: makeWorkspaceFolder() });

    const m1 = result.models.find((m) => m.id === 'm1');
    expect(m1?.name).toBe('M1 WS');
    expect(m1?.detail).toBe('ws');
    expect(m1?.maxInputTokens).toBe(200);
    // workspace-only model survives
    expect(result.models.find((m) => m.id === 'workspace-only')).toBeDefined();
    expect(result.sources.workspace.exists).toBe(true);
  });

  it('preserves a vendor defined only in the globalStorage override', async () => {
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = bundledRegistry();
    files[`${GLOBAL_STORAGE_PATH}/models.json`] = {
      version: 1,
      vendors: { custom: { baseUrl: 'https://custom', apiKeySecret: 'k.custom' } },
      models: [],
    };

    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs });

    expect(result.vendors.custom?.baseUrl).toBe('https://custom');
    // bundled vendors are still there
    expect(result.vendors.deepseek?.baseUrl).toBe('https://api.deepseek.com');
  });

  it('deep-merges a vendor override (externalUrls from both tiers)', async () => {
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = {
      version: 1,
      vendors: {
        deepseek: {
          baseUrl: 'https://api.deepseek.com',
          apiKeySecret: 'k',
          externalUrls: { apiKeys: 'https://platform.deepseek.com/api_keys' },
        },
      },
      models: [],
    };
    files[`${GLOBAL_STORAGE_PATH}/models.json`] = {
      version: 1,
      vendors: {
        deepseek: {
          baseUrl: 'https://api.deepseek.com',
          apiKeySecret: 'k',
          externalUrls: { usage: 'https://platform.deepseek.com/usage' },
        },
      },
      models: [],
    };

    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs });

    expect(result.vendors.deepseek?.externalUrls).toEqual({
      apiKeys: 'https://platform.deepseek.com/api_keys',
      usage: 'https://platform.deepseek.com/usage',
    });
  });

  it('caches the result so subsequent calls return the same object', async () => {
    const fs = makeFs({
      [`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`]: bundledRegistry(),
    });
    const result1 = await loadModelRegistry(makeContext(), { fs });
    const result2 = await loadModelRegistry(makeContext(), { fs });
    expect(result2).toBe(result1);
  });
});

describe('loadModelRegistry - error handling', () => {
  it('throws on a structure error in the bundled tier', async () => {
    const fs = makeFs({
      [`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`]: { version: 99, models: [] },
    });
    await expect(loadModelRegistry(makeContext(), { fs })).rejects.toThrow(/unsupported version/);
  });

  it('skips an override tier with a structure error and warns', async () => {
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = bundledRegistry();
    files[`${GLOBAL_STORAGE_PATH}/models.json`] = { version: 99, models: [] };
    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs });

    // Falls back to bundled
    expect(result.sources.globalStorage.exists).toBe(false);
    expect(result.models).toHaveLength(2);
  });

  it('drops invalid model entries and warns (fail-soft)', async () => {
    const files: Record<string, unknown> = {};
    files[`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`] = {
      version: 1,
      models: [
        {
          id: 'good',
          name: 'G',
          family: 'deepseek',
          version: '1',
          detail: 'd',
          maxInputTokens: 1,
          maxOutputTokens: 1,
          capabilities: { toolCalling: true, imageInput: false, thinking: false },
          requiresThinkingParam: false,
        },
        {
          id: 'bad',
          name: 'B',
          family: 'unknown-vendor',
          version: '1',
          detail: 'd',
          maxInputTokens: 1,
          maxOutputTokens: 1,
          capabilities: { toolCalling: true, imageInput: false, thinking: false },
          requiresThinkingParam: false,
        },
      ],
    };
    const fs = makeFs(files);
    const result = await loadModelRegistry(makeContext(), { fs });
    expect(result.models.map((m) => m.id)).toEqual(['good']);
  });
});

describe('loadModelRegistry - paths', () => {
  it('records the bundled / globalStorage / workspace paths in sources', async () => {
    const fs = makeFs({
      [`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`]: bundledRegistry(),
    });
    const result = await loadModelRegistry(makeContext(), { fs, workspaceFolder: makeWorkspaceFolder() });

    expect(result.sources.bundled.path).toBe(`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`);
    expect(result.sources.globalStorage.path).toBe(`${GLOBAL_STORAGE_PATH}/models.json`);
    expect(result.sources.workspace.path).toBe(`${WORKSPACE_PATH}/.vscode/aiflowbridge.models.json`);
  });

  it('skips the workspace tier when no workspace folder is open', async () => {
    const fs = makeFs({
      [`${BUNDLED_PATH.replace('/resources/models.json', '')}/resources/models.json`]: bundledRegistry(),
    });
    const result = await loadModelRegistry(makeContext(), { fs, workspaceFolder: undefined });

    expect(result.sources.workspace.exists).toBe(false);
    expect(result.sources.workspace.path).toBe('');
  });
});
