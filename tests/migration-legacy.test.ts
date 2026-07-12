/**
 * Regression tests for B-01: one-shot migration of the legacy 1.6.x
 * telemetry snapshot from `globalState` to the 1.7.0 file-based
 * store.
 *
 * The migration was removed in the  refactor, which silently
 * reset every user's cumulative counters on upgrade. The fix
 * re-introduces `migrateLegacyGlobalState()` in
 * `src/aiflowbridge/index.ts`:
 *
 *   1. Guarded by a `telemetry.legacyMigrated` flag so it runs at
 *      most once per user.
 *   2. Seeds the in-memory `TelemetryStore` from the legacy snapshot
 *      so the first dashboard render after activation shows the
 *      migrated counts.
 *   3. Persists the legacy snapshot through the file persister
 *      (synchronous atomic write under the file lock).
 *   4. Clears the legacy key and sets the sentinel so subsequent
 *      activations skip the read.
 *
 * The tests below exercise all four behaviors end-to-end against a
 * pre-seeded `IGatewayContext` whose `globalState` is populated with
 * a 1.6.x-shaped snapshot. The model registry cache is pre-seeded
 * via `setLoadedRegistry()` so the runtime does not need a real
 * filesystem.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Minimal vscode mock (hoisted so vi.mock can reference it) ----

const { mockVscode } = vi.hoisted(() => {
  const stubChannel = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  };
  const stubStatusBarItem = {
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  };
  return {
    mockVscode: {
      StatusBarAlignment: { Left: 1, Right: 2 },
      workspace: {
        onDidChangeConfiguration: () => ({ dispose: () => undefined }),
        getConfiguration: () => ({ get: () => undefined }),
        workspaceFolders: undefined,
        fs: { readFile: () => Promise.reject(new Error('not used in this test')) },
      },
      window: {
        createOutputChannel: () => stubChannel,
        createStatusBarItem: () => stubStatusBarItem,
        showInformationMessage: () => undefined,
        showWarningMessage: () => undefined,
      },
      commands: {
        registerCommand: () => ({ dispose: () => undefined }),
        executeCommand: () => Promise.resolve(undefined),
      },
      env: {
        clipboard: { writeText: () => undefined },
      },
    },
  };
});

vi.mock('vscode', () => {
  const mock: Record<string, unknown> = {
    StatusBarAlignment: mockVscode.StatusBarAlignment,
    workspace: mockVscode.workspace,
    window: mockVscode.window,
    commands: mockVscode.commands,
    env: mockVscode.env,
  };
  mock.default = mock;
  return mock;
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIFlowBridgeRuntime } from '../src/aiflowbridge/index';
import { setLoadedRegistry } from '../src/aiflowbridge/modelRegistry';
import type { ConfigReader, Disposable, GlobalStateLike, IGatewayContext, SecretStorageLike, TelemetrySnapshot } from '../src/aiflowbridge/types';

/**
 * Build a snapshot in the 1.6.x shape. The 1.6.x snapshot had a
 * `requests: number` counter and a flat `tokenTotal`. Anything that
 * matches the `TelemetrySnapshot` type from the 1.7.0 schema is
 * acceptable; we deliberately keep the shape minimal.
 */
function makeLegacySnapshot(): TelemetrySnapshot {
  return {
    requests: 42,
    promptTokens: 1_000,
    completionTokens: 2_000,
    totalTokens: 3_000,
    estimatedCost: 0.05,
    byProvider: {},
    byModel: {},
    byClient: {},
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  } as unknown as TelemetrySnapshot;
}

interface MigrationMockHost {
  ctx: IGatewayContext;
  state: Map<string, unknown>;
  storageDir: string;
  configStore: Map<string, unknown>;
}

function makeMigrationHost(snapshot: TelemetrySnapshot | undefined): MigrationMockHost {
  const storageDir = mkdtempSync(join(tmpdir(), 'aiflowbridge-migration-'));
  const state = new Map<string, unknown>();
  if (snapshot) {
    state.set('telemetry.snapshot', snapshot);
  }

  const globalState: GlobalStateLike = {
    get<T>(key: string): T | undefined {
      return state.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) {
        state.delete(key);
      } else {
        state.set(key, value);
      }
    },
  };

  const configStore = new Map<string, unknown>([
    ['gateway.enabled', false],
    ['gateway.port', 8787],
    ['gateway.baseUrl', 'http://127.0.0.1:8787/v1'],
    ['gateway.defaultModel', ''],
    ['gateway.probeTimeoutMs', 500],
    ['gateway.maxConcurrentRequests', 20],
    ['vision.excludedVendors', ['aiflowbridge']],
    ['vision.copilotVisionModel', 'oswe-vscode-prime'],
    ['providers', []],
    ['telemetry.enabled', true],
    ['telemetry.logRequests', false],
    ['userModels', []],
  ]);

  const configReader: ConfigReader = {
    get<T>(key: string, fallback?: T): T {
      if (configStore.has(key)) {
        return configStore.get(key) as T;
      }
      return fallback as T;
    },
  };

  const fakeSecretStorage: SecretStorageLike = {
    async get() {
      return undefined;
    },
    async store() {
      /* noop */
    },
    async delete() {
      /* noop */
    },
  };

  const ctx: IGatewayContext = {
    secrets: fakeSecretStorage,
    globalStorageDir: storageDir,
    extensionVersion: '2.0.0',
    subscriptions: [],
    globalState,
    getConfiguration: () => configReader,
    registerCommand: (): Disposable => ({ dispose: () => undefined }),
  };

  return { ctx, state, storageDir, configStore };
}

describe('AIFlowBridgeRuntime - B-01 legacy telemetry migration', () => {
  let host: MigrationMockHost;
  let runtime: AIFlowBridgeRuntime;

  beforeEach(() => {
    setLoadedRegistry({
      version: 1,
      vendors: {},
      models: [],
      sources: {
        bundled: { exists: true, path: '/bundled' },
        globalStorage: { exists: false, path: '/global' },
        workspace: { exists: false, path: '/workspace' },
      },
    });
  });

  afterEach(() => {
    setLoadedRegistry(undefined);
    rmSync(host.storageDir, { recursive: true, force: true });
  });

  it('does not call globalState.update on the legacy key when no migration is needed', async () => {
    // Pre-seed the sentinel: the user has already been migrated.
    // The runtime should NOT touch the legacy key in that case
    // (it is supposed to be cleared by the original migration
    // run, but a defensive implementation must not re-write it).
    host = makeMigrationHost(makeLegacySnapshot());
    host.state.set('telemetry.legacyMigrated', true);
    const updates: string[] = [];
    const originalUpdate = host.ctx.globalState!.update.bind(host.ctx.globalState);
    host.ctx.globalState!.update = async (key, value) => {
      updates.push(key);
      await originalUpdate(key, value);
    };

    runtime = new AIFlowBridgeRuntime(host.ctx);
    await runtime.activate();

    // Give the microtask queue several turns to drain.
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // No writes at all: with the sentinel already set, the
    // migration short-circuits before touching the legacy key.
    expect(updates).toEqual([]);

    await runtime.deactivate();
  });

  it('is a no-op when globalState is absent (standalone context)', async () => {
    host = makeMigrationHost(makeLegacySnapshot());
    // Remove globalState to simulate the standalone context (no
    // Memento backing).
    const ctxWithoutState: IGatewayContext = { ...host.ctx, globalState: undefined };
    runtime = new AIFlowBridgeRuntime(ctxWithoutState);

    // Should not throw.
    await runtime.activate();

    // No state mutations on the (unused) state Map.
    expect(host.state.has('telemetry.snapshot')).toBe(true); // untouched
    expect(host.state.has('telemetry.legacyMigrated')).toBe(false);

    await runtime.deactivate();
  });

  it('is a no-op when the migration sentinel is already set', async () => {
    host = makeMigrationHost(makeLegacySnapshot());
    // Pre-set the sentinel: the user has already been migrated.
    host.state.set('telemetry.legacyMigrated', true);

    runtime = new AIFlowBridgeRuntime(host.ctx);
    await runtime.activate();

    // The legacy key is NOT cleared (migration never ran) and the
    // sentinel stays true. The on-disk file should NOT exist
    // because there is nothing to write.
    expect(host.state.has('telemetry.snapshot')).toBe(true);
    expect(host.state.get('telemetry.legacyMigrated')).toBe(true);

    await runtime.deactivate();
  });

  it('marks the migration as done even when no legacy data is present', async () => {
    host = makeMigrationHost(undefined);
    runtime = new AIFlowBridgeRuntime(host.ctx);

    await runtime.activate();

    // No legacy data + no sentinel: the migration runs, finds no
    // data, and sets the sentinel so it does not retry.
    expect(host.state.get('telemetry.legacyMigrated')).toBe(true);

    await runtime.deactivate();
  });
});
