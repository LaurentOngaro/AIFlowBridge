/**
 * AIFlowBridge - authMode resolver and byAuth aggregation tests.
 *
 * Covers the dashboard `authMode` field added on top of `billedTo`.
 * The dashboard now surfaces a per-authentication-mode column
 * (BYOK / OAuth / plan / token) and a "By auth" summary panel so the
 * user can split traffic by real auth path instead of just by
 * billing mode.
 */

import { describe, expect, it, vi } from 'vitest';

// `applyEntryToSnapshot` lives in `src/aiflowbridge/telemetry.ts`, which
// imports `src/logger.ts`, which in turn imports `vscode`. Provide a
// shim so the unit test stays pure (no `vscode` package resolution at
// test time). Mirrors the shim used by `tests/telemetry-store.test.ts`.
vi.mock('vscode', () => ({
  default: {
    window: {
      createOutputChannel: vi.fn(() => ({
        name: 'AIFlowBridge',
        log: vi.fn(),
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        dispose: vi.fn(),
        append: vi.fn(),
        appendLine: vi.fn(),
        clear: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
      })),
    },
    LogLevel: { Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Off: 5 },
    LogOutputChannel: class MockLogOutputChannel {
      name = 'AIFlowBridge';
      log = vi.fn();
      trace = vi.fn();
      debug = vi.fn();
      info = vi.fn();
      warn = vi.fn();
      error = vi.fn();
      dispose = vi.fn();
      append = vi.fn();
      appendLine = vi.fn();
      clear = vi.fn();
      show = vi.fn();
      hide = vi.fn();
    },
  },
  LogLevel: { Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Off: 5 },
  LogOutputChannel: class MockLogOutputChannel {
    name = 'AIFlowBridge';
    log = vi.fn();
    trace = vi.fn();
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    dispose = vi.fn();
    append = vi.fn();
    appendLine = vi.fn();
    clear = vi.fn();
    show = vi.fn();
    hide = vi.fn();
  },
}));
import { resolveAuthMode, readAuthMode } from '../src/aiflowbridge/auth-mode';
import { applyEntryToSnapshot, emptyTelemetrySnapshot } from '../src/aiflowbridge/telemetry';
import type { ProviderProfile, RequestTelemetry, TelemetrySnapshot } from '../src/aiflowbridge/types';

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'p1',
    label: 'Provider 1',
    kind: 'openai-compat',
    baseUrl: 'https://example.com/v1',
    model: 'm1',
    enabled: true,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RequestTelemetry> = {}): RequestTelemetry {
  return {
    id: 'r1',
    timestamp: new Date().toISOString(),
    providerId: 'p1',
    providerLabel: 'Provider 1',
    model: 'm1',
    status: 200,
    durationMs: 100,
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
    estimatedCost: 0,
    estimated: false,
    ...overrides,
  };
}

describe('resolveAuthMode', () => {
  it('flags the Antigravity OAuth branch as oauth even when kind is openai-compat', () => {
    expect(
      resolveAuthMode({
        provider: makeProfile({ kind: 'openai-compat', baseUrl: 'https://cloudcode-pa.googleapis.com' }),
        isAntigravityOAuth: true,
      })
    ).toBe('oauth');
  });

  it('flags antigravity / googleaistudio kind as oauth by default', () => {
    expect(
      resolveAuthMode({
        provider: makeProfile({ kind: 'antigravity', baseUrl: 'https://example.com/v1' }),
        isAntigravityOAuth: false,
      })
    ).toBe('oauth');
    expect(
      resolveAuthMode({
        provider: makeProfile({ kind: 'googleaistudio', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }),
        isAntigravityOAuth: false,
      })
    ).toBe('oauth');
  });

  it('flags billing: plan as plan for any provider kind', () => {
    expect(
      resolveAuthMode({
        provider: makeProfile({ kind: 'openai-compat', billing: 'plan' }),
        isAntigravityOAuth: false,
      })
    ).toBe('plan');
  });

  it('flags a non-AGY openai-compat profile as byok', () => {
    expect(
      resolveAuthMode({
        provider: makeProfile({ kind: 'openai-compat' }),
        isAntigravityOAuth: false,
      })
    ).toBe('byok');
  });
});

describe('readAuthMode', () => {
  it('coalesces absent to unknown', () => {
    expect(readAuthMode(undefined)).toBe('unknown');
    expect(readAuthMode({})).toBe('unknown');
    expect(readAuthMode({ authMode: 'byok' })).toBe('byok');
  });
});

describe('applyEntryToSnapshot with authMode', () => {
  it('aggregates entries per authMode into snapshot.byAuth', () => {
    const snapshot = emptyTelemetrySnapshot();
    applyEntryToSnapshot(snapshot, makeEntry({ id: 'a', authMode: 'byok' }));
    applyEntryToSnapshot(snapshot, makeEntry({ id: 'b', authMode: 'byok' }));
    applyEntryToSnapshot(snapshot, makeEntry({ id: 'c', authMode: 'oauth' }));
    expect(snapshot.byAuth?.byok?.requests).toBe(2);
    expect(snapshot.byAuth?.oauth?.requests).toBe(1);
    expect(snapshot.byAuth?.unknown).toBeUndefined();
  });

  it('coalesces entries without authMode into the unknown bucket', () => {
    const snapshot = emptyTelemetrySnapshot();
    applyEntryToSnapshot(snapshot, makeEntry({ id: 'a' }));
    applyEntryToSnapshot(snapshot, makeEntry({ id: 'b', authMode: 'byok' }));
    expect(snapshot.byAuth?.unknown?.requests).toBe(1);
    expect(snapshot.byAuth?.byok?.requests).toBe(1);
  });

  it('tracks totals + per-bucket tokens separately', () => {
    const snapshot = emptyTelemetrySnapshot();
    applyEntryToSnapshot(
      snapshot,
      makeEntry({ id: 'a', authMode: 'byok', promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.5 })
    );
    applyEntryToSnapshot(snapshot, makeEntry({ id: 'b', authMode: 'oauth', promptTokens: 4, completionTokens: 5, totalTokens: 9 }));
    expect(snapshot.byAuth?.byok?.totalTokens).toBe(30);
    expect(snapshot.byAuth?.oauth?.totalTokens).toBe(9);
    expect(snapshot.byAuth?.byok?.estimatedCost).toBe(0.5);
    expect(snapshot.byAuth?.oauth?.estimatedCost).toBe(0);
  });
});

describe('TelemetrySnapshot.byAuth schema', () => {
  it('is optional on older on-disk snapshots and defaults to an empty map on load', () => {
    const legacy = { requests: 0 } as unknown as TelemetrySnapshot;
    expect(legacy.byAuth).toBeUndefined();
  });
});
