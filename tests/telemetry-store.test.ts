/**
 * Unit tests for src/aiflowbridge/telemetry.ts
 * Covers record(), snapshot(), restore() (cumulative persistence),
 * subscribe() (listener for live updates), and reset() (clear state).
 */

import { describe, expect, it, vi } from 'vitest';
import { TelemetryStore } from '../src/aiflowbridge/telemetry';
import type { RequestTelemetry, TelemetrySnapshot } from '../src/aiflowbridge/types';

// telemetry.ts now imports the logger (to warn on a failed persister write
// and on a corrupt on-disk snapshot), and logger.ts pulls in vscode via
// LogOutputChannel. Provide a shim so the unit test stays pure.
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
    },
  },
}));

function makeEntry(overrides: Partial<RequestTelemetry> = {}): RequestTelemetry {
  return {
    id: 'r1',
    timestamp: '2026-06-03T08:00:00.000Z',
    providerId: 'p1',
    providerLabel: 'Provider 1',
    model: 'm1',
    status: 200,
    durationMs: 100,
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    estimatedCost: 0.0001,
    estimated: false,
    ...overrides,
  };
}

describe('TelemetryStore - record / snapshot', () => {
  it('returns an empty snapshot on a fresh store', () => {
    const store = new TelemetryStore();
    const snap = store.snapshot();
    expect(snap.requests).toBe(0);
    expect(snap.totalTokens).toBe(0);
    expect(snap.recent).toEqual([]);
    expect(snap.byProvider).toEqual({});
    expect(snap.byModel).toEqual({});
  });

  it('aggregates totals and byProvider / byModel maps', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1', totalTokens: 30, promptTokens: 10, completionTokens: 20, durationMs: 100 }));
    store.record(makeEntry({ id: 'r2', providerId: 'p2', model: 'm2', totalTokens: 50, promptTokens: 25, completionTokens: 25, durationMs: 200 }));
    const snap = store.snapshot();
    expect(snap.requests).toBe(2);
    expect(snap.totalTokens).toBe(80);
    expect(snap.promptTokens).toBe(35);
    expect(snap.completionTokens).toBe(45);
    expect(snap.averageDurationMs).toBe(150);
    expect(snap.byProvider.p1?.requests).toBe(1);
    expect(snap.byProvider.p2?.requests).toBe(1);
    expect(snap.byModel.m1?.requests).toBe(1);
    expect(snap.byModel.m2?.requests).toBe(1);
  });

  it('counts errors (status >= 400)', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ status: 200 }));
    store.record(makeEntry({ status: 500 }));
    store.record(makeEntry({ status: 404 }));
    const snap = store.snapshot();
    expect(snap.errors).toBe(2);
    expect(snap.byProvider.p1?.errors).toBe(2);
  });

  it('keeps the full recent list when below the default memoryCap', () => {
    const store = new TelemetryStore();
    const total = 250;
    for (let i = 0; i < total; i++) {
      store.record(makeEntry({ id: `r${i}`, model: `m${i}` }));
    }
    const snap = store.snapshot();
    expect(snap.recent).toHaveLength(total);
    expect(snap.recent[0]?.id).toBe(`r${total - 1}`);
    expect(snap.recent[total - 1]?.id).toBe(`r0`);
    expect(snap.requests).toBe(total);
  });

  it('drops the oldest entries from recent once memoryCap is raeched', () => {
    const store = new TelemetryStore(undefined, { memoryCap: 5 });
    for (let i = 0; i < 10; i++) {
      store.record(makeEntry({ id: `r${i}`, model: `m${i}` }));
    }
    const snap = store.snapshot();
    // In-memory recent is capped at 5; the snapshot returns it
    // reverse-chronologically (newest first).
    expect(snap.recent).toHaveLength(5);
    expect(snap.recent[0]?.id).toBe('r9');
    expect(snap.recent[4]?.id).toBe('r5');
    // Cumulative totals still cover the full history - only the
    // in-memory list is bounded.
    expect(snap.requests).toBe(10);
  });

  it('computes p95 from the recent list (cached, no desync after removeEntry)', () => {
    const store = new TelemetryStore();
    // 100 entries with durations 0..99 -> p95 index = ceil(100*0.95)-1 = 94.
    for (let i = 0; i < 100; i++) {
      store.record(makeEntry({ id: `r${i}`, durationMs: i }));
    }
    expect(store.snapshot().p95DurationMs).toBe(94);

    // Remove the entry at the p95 position (id r94, durationMs=94).
    store.removeEntry('r94');
    // p95 must be recomputed from the remaining entries - not
    // stuck at the cached 94. With 99 entries, index = ceil(99*0.95)-1
    // = ceil(94.05)-1 = 95-1 = 94, so the value is r94 again (the
    // next entry, durationMs=94 would still be r95->95 after removal,
    // but we removed r94, so the sorted list is 0..93,95..99 and
    // the new sorted[94] = 95).
    expect(store.snapshot().p95DurationMs).toBe(95);

    // Snapshot is consistent across two calls (cache works).
    expect(store.snapshot().p95DurationMs).toBe(95);
  });

  it('rebuilds the p95 cache after restore()', () => {
    const storeA = new TelemetryStore();
    for (let i = 0; i < 50; i++) {
      storeA.record(makeEntry({ id: `r${i}`, durationMs: i }));
    }
    const persisted = storeA.snapshot();
    // ceil(50*0.95)-1 = ceil(47.5)-1 = 48-1 = 47.
    expect(persisted.p95DurationMs).toBe(47);

    const storeB = new TelemetryStore();
    storeB.restore(persisted);
    expect(storeB.snapshot().p95DurationMs).toBe(47);
  });
});

describe('TelemetryStore - restore (cumulative persistence)', () => {
  it('restores totals, byProvider, byModel, and recent from a snapshot', () => {
    const storeA = new TelemetryStore();
    storeA.record(makeEntry({ providerId: 'p1', model: 'm1', totalTokens: 100, promptTokens: 60, completionTokens: 40, durationMs: 200 }));
    storeA.record(makeEntry({ id: 'r2', providerId: 'p1', model: 'm1', totalTokens: 200, promptTokens: 120, completionTokens: 80, durationMs: 400 }));
    storeA.record(makeEntry({ id: 'r3', providerId: 'p2', model: 'm2', totalTokens: 50, promptTokens: 25, completionTokens: 25, durationMs: 100 }));
    const persisted = storeA.snapshot();

    const storeB = new TelemetryStore();
    storeB.restore(persisted);

    const snap = storeB.snapshot();
    expect(snap.requests).toBe(3);
    expect(snap.totalTokens).toBe(350);
    expect(snap.promptTokens).toBe(205);
    expect(snap.completionTokens).toBe(145);
    expect(snap.averageDurationMs).toBeCloseTo(700 / 3);
    expect(snap.byProvider.p1?.requests).toBe(2);
    expect(snap.byProvider.p2?.requests).toBe(1);
    expect(snap.byModel.m1?.requests).toBe(2);
    expect(snap.byModel.m2?.requests).toBe(1);
    expect(snap.recent).toHaveLength(3);
  });

  it('restore(undefined) clears all state', () => {
    const store = new TelemetryStore();
    store.record(makeEntry());
    expect(store.snapshot().requests).toBe(1);
    store.restore(undefined);
    const snap = store.snapshot();
    expect(snap.requests).toBe(0);
    expect(snap.recent).toEqual([]);
    expect(snap.byProvider).toEqual({});
    expect(snap.byModel).toEqual({});
  });

  it('additional record() calls after restore() are cumulative', () => {
    const storeA = new TelemetryStore();
    storeA.record(makeEntry({ id: 'r1', totalTokens: 100, promptTokens: 50, completionTokens: 50, durationMs: 200 }));
    const persisted = storeA.snapshot();

    const storeB = new TelemetryStore();
    storeB.restore(persisted);
    storeB.record(makeEntry({ id: 'r2', totalTokens: 100, promptTokens: 50, completionTokens: 50, durationMs: 200 }));

    const snap = storeB.snapshot();
    expect(snap.requests).toBe(2);
    expect(snap.totalTokens).toBe(200);
    expect(snap.averageDurationMs).toBe(200);
  });
});

describe('TelemetryStore - subscribe', () => {
  it('notifies listeners on each record() with the latest snapshot', () => {
    const store = new TelemetryStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.record(makeEntry());
    store.record(makeEntry());
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]?.[0]?.requests).toBe(1);
    expect(listener.mock.calls[1]?.[0]?.requests).toBe(2);
  });

  it('returns an unsubscribe function', () => {
    const store = new TelemetryStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.record(makeEntry());
    off();
    store.record(makeEntry());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('listener exceptions do not break record()', () => {
    const store = new TelemetryStore();
    store.subscribe(() => {
      throw new Error('listener boom');
    });
    expect(() => store.record(makeEntry())).not.toThrow();
    expect(store.snapshot().requests).toBe(1);
  });
});

describe('TelemetryStore - reset', () => {
  it('clears all state and notifies listeners', () => {
    const store = new TelemetryStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.record(makeEntry());
    store.record(makeEntry());
    listener.mockClear();

    store.reset();
    const snap = store.snapshot();
    expect(snap.requests).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]?.requests).toBe(0);
  });

  // Regression: reset() used to go through restore(undefined), which
  // reloaded the on-disk state from the persister. When the disk
  // still had old data, the in-memory counters came right back, so
  // the user-visible dashboard never showed a reset. The fix is to
  // clear in-memory directly and have the persister wipe the disk
  // (fire-and-forget) instead.
  it('clears in-memory state even when a persister is configured (no disk reload)', () => {
    const fakePersister = {
      loadSync: vi.fn(() => undefined),
      appendDelta: vi.fn(async () => undefined),
      removeEntry: vi.fn(async () => false),
      clear: vi.fn(async () => undefined),
    };
    const store = new TelemetryStore(fakePersister);
    store.record(makeEntry({ id: 'r1', totalTokens: 100 }));
    store.record(makeEntry({ id: 'r2', totalTokens: 200 }));
    expect(store.snapshot().requests).toBe(2);

    store.reset();
    // The in-memory store is empty immediately, regardless of what
    // the persister would have returned from loadSync.
    expect(store.snapshot().requests).toBe(0);
    expect(store.snapshot().totalTokens).toBe(0);
    expect(store.snapshot().recent).toEqual([]);
    // loadSync was NOT called by reset (the bug would have called
    // it once, returning the pre-reset state and undoing the wipe).
    expect(fakePersister.loadSync).not.toHaveBeenCalled();
    // The persister was asked to wipe its disk, asynchronously.
    expect(fakePersister.clear).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners with the empty snapshot after reset (with persister)', () => {
    const fakePersister = {
      loadSync: vi.fn(() => undefined),
      appendDelta: vi.fn(async () => undefined),
      removeEntry: vi.fn(async () => false),
      clear: vi.fn(async () => undefined),
    };
    const store = new TelemetryStore(fakePersister);
    const listener = vi.fn();
    store.subscribe(listener);
    store.record(makeEntry());
    listener.mockClear();

    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]?.requests).toBe(0);
  });
});

describe('TelemetryStore - round trip via snapshot/restore preserves snapshot shape', () => {
  it('snapshot() output is a valid input for restore()', () => {
    const a = new TelemetryStore();
    a.record(makeEntry());
    a.record(makeEntry({ id: 'r2', providerId: 'p2', model: 'm2', totalTokens: 5 }));
    const persisted: TelemetrySnapshot = a.snapshot();

    const b = new TelemetryStore();
    b.restore(persisted);
    const restored = b.snapshot();
    // Totals should match exactly; per-provider / per-model snapshot
    // copies may be a new object identity but with equal values.
    expect(restored.requests).toBe(persisted.requests);
    expect(restored.totalTokens).toBe(persisted.totalTokens);
    expect(restored.promptTokens).toBe(persisted.promptTokens);
    expect(restored.completionTokens).toBe(persisted.completionTokens);
    expect(restored.errors).toBe(persisted.errors);
    expect(restored.averageDurationMs).toBeCloseTo(persisted.averageDurationMs);
  });
});
