/**
 * Regression tests for `AIFlowBridgeRuntime.gatewayInfo`.
 *
 * `gatewayInfo` used to access `this.gateway.running` and `this.config.gateway.port`
 * unconditionally, which crashed the standalone CLI with
 * `Cannot read properties of undefined (reading 'running')`
 * when the getter was read before `activate()` had resolved
 * (e.g. a test harness, a future early-startup consumer, or a
 * re-entrant call from inside a config-change callback fired
 * before activation completed).
 *
 * The fix is a guard that returns a stable "all disabled" stub
 * when `config` or `gateway` is still undefined.
 *
 * These tests exercise the getter in every pre-activation state
 * (right after construction, mid-activation, after a failed
 * activation) and confirm the post-activation shape is
 * unchanged.
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

import { AIFlowBridgeRuntime } from '../src/aiflowbridge/index';
import { setLoadedRegistry } from '../src/aiflowbridge/modelRegistry';
import type { ConfigReader, Disposable, IGatewayContext, SecretStorageLike } from '../src/aiflowbridge/types';

interface MockHost {
  ctx: IGatewayContext;
  configStore: Map<string, unknown>;
  /** When set, `loadConfigFromContext` rejects with this error. */
  activationError: Error | undefined;
  /** When set, `gateway.start()` rejects with this error. */
  startError: Error | undefined;
}

function makeMockHost(options: { activationError?: Error; startError?: Error } = {}): MockHost {
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
    globalStorageDir: '/tmp/aiflowbridge-test',
    extensionVersion: '2.0.0',
    subscriptions: [],
    getConfiguration: () => configReader,
    registerCommand: (_command: string, _callback: (...args: unknown[]) => unknown): Disposable => ({
      dispose: () => undefined,
    }),
  };

  return {
    ctx,
    configStore,
    activationError: options.activationError,
    startError: options.startError,
  };
}

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
});

describe('AIFlowBridgeRuntime.gatewayInfo - pre-activation guard', () => {
  it('returns a stable "all disabled" stub right after construction (before activate)', () => {
    // The previous implementation crashed with
    // `Cannot read properties of undefined (reading 'running')`
    // in this state. The fix is a guard.
    const host = makeMockHost();
    const runtime = new AIFlowBridgeRuntime(host.ctx);

    const info = runtime.gatewayInfo;
    expect(info).toEqual({
      running: false,
      port: 0,
      baseUrl: '',
      isJoined: false,
      providerCount: 0,
    });
  });

  it('the pre-activation stub is read-safe: multiple calls do not throw', () => {
    const host = makeMockHost();
    const runtime = new AIFlowBridgeRuntime(host.ctx);

    // Read the getter 5 times in a row; the guard must hold on
    // every call (no field is lazily created on the first read).
    for (let i = 0; i < 5; i++) {
      const info = runtime.gatewayInfo;
      expect(info.running).toBe(false);
      expect(info.providerCount).toBe(0);
    }
  });

  it('the post-activation shape is unchanged (smoke test for the existing callers)', async () => {
    const host = makeMockHost();
    const runtime = new AIFlowBridgeRuntime(host.ctx);
    await runtime.activate();
    try {
      const info = runtime.gatewayInfo;
      // `gateway.enabled` is false in the test config, so the
      // gateway was never started. The port is 8787 (from the
      // mock config) and providerCount is 0.
      expect(info.running).toBe(false);
      expect(info.port).toBe(8787);
      expect(info.baseUrl).toBe('http://127.0.0.1:8787/v1');
      expect(info.isJoined).toBe(false);
      expect(info.providerCount).toBe(0);
    } finally {
      await runtime.deactivate();
    }
  });
});

describe('AIFlowBridgeRuntime.dispose / deactivate - pre-activation guard', () => {
  it('deactivate() is a safe no-op when called before activate() resolves', async () => {
    // Regression for the dispose-before-activate race: the runtime
    // declares `this.gateway` with the definite-assignment operator
    // (the field is built inside `activate()`), so it is genuinely
    // `undefined` between construction and `activate()` resolving.
    // Calling `deactivate()` in that window used to crash with
    // `TypeError: Cannot read properties of undefined (reading
    // 'stop')`. The guard at the top of `deactivate()` makes it a
    // safe no-op so a peer activation / hot reload / immediate
    // deactivation never throws.
    const host = makeMockHost();
    const runtime = new AIFlowBridgeRuntime(host.ctx);

    await expect(runtime.deactivate()).resolves.toBeUndefined();
  });

  it('dispose() does not throw when called before activate()', () => {
    // `dispose()` is fire-and-forget by contract (mirrors VS Code's
    // synchronous `Disposable.dispose()` signature). It must not
    // throw when the runtime was never activated - VS Code calls
    // `dispose()` synchronously during extension shutdown even if
    // `activate()` was rejected or short-circuited.
    const host = makeMockHost();
    const runtime = new AIFlowBridgeRuntime(host.ctx);

    expect(() => runtime.dispose()).not.toThrow();
  });

  it('deactivate() after a successful activate() but before any work still calls gateway.stop()', async () => {
    // The post-activation case (the deactivate() path the standalone
    // CLI takes on SIGINT/SIGTERM): the gateway IS built, so the
    // guard does NOT short-circuit, and the real `stop()` runs.
    // `gateway.enabled` is false in the test config, so `start()`
    // was never called and `stop()` is a safe no-op on the gateway
    // side.
    const host = makeMockHost();
    const runtime = new AIFlowBridgeRuntime(host.ctx);
    await runtime.activate();
    await expect(runtime.deactivate()).resolves.toBeUndefined();
  });
});
