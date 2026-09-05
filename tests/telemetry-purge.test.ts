/**
 * regression test for `TelemetryStore.purgeSessionLog` /
 * `TelemetryPersister.purgeSessionLog`. Covers the privacy-driven
 * "drop the captured prompt / response text without touching the
 * counters" affordance.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  return {
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
        })),
      },
    },
  };
});

import { TelemetryStore } from '../src/aiflowbridge/telemetry';
import { TelemetryPersister } from '../src/aiflowbridge/telemetry/persistence';
import type { RequestTelemetry } from '../src/aiflowbridge/types';

function makeEntry(overrides: Partial<RequestTelemetry> = {}): RequestTelemetry {
  const base: RequestTelemetry = {
    id: overrides.id ?? 'r1',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    providerId: overrides.providerId ?? 'p1',
    providerLabel: overrides.providerLabel ?? 'Provider 1',
    model: overrides.model ?? 'm1',
    status: overrides.status ?? 200,
    durationMs: overrides.durationMs ?? 100,
    promptTokens: overrides.promptTokens ?? 10,
    completionTokens: overrides.completionTokens ?? 20,
    totalTokens: overrides.totalTokens ?? 30,
    estimatedCost: overrides.estimatedCost ?? 0.0001,
    estimated: overrides.estimated ?? false,
  };
  if ('promptSummary' in overrides) {
    base.promptSummary = overrides.promptSummary;
  } else {
    base.promptSummary = 'secret prompt';
  }
  if ('responseSummary' in overrides) {
    base.responseSummary = overrides.responseSummary;
  } else {
    base.responseSummary = 'secret response';
  }
  return base;
}

describe('purgeSessionLog', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aifb-purge-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('wipes promptSummary + responseSummary without touching counters', async () => {
    const filePath = join(tmp, 'telemetry.json');
    const lockPath = join(tmp, 'telemetry.lock');
    const persister = new TelemetryPersister({ filePath, lockPath });
    const store = new TelemetryStore(persister);

    // Two entries with summaries.
    store.record(makeEntry({ id: 'r1' }));
    store.record(makeEntry({ id: 'r2' }));
    // Wait for the on-disk append to settle (the persister uses a
    // promise chain).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(store.getEntry('r1')?.promptSummary).toBe('secret prompt');
    expect(store.snapshot().requests).toBe(2);
    expect(store.snapshot().totalTokens).toBe(60);

    const { inMemory, onDisk } = store.purgeSessionLog();
    expect(inMemory).toBe(2);
    const onDiskCleared = await onDisk;
    expect(onDiskCleared).toBe(2);

    // Counters preserved.
    expect(store.snapshot().requests).toBe(2);
    expect(store.snapshot().totalTokens).toBe(60);
    // Summaries wiped in memory.
    expect(store.getEntry('r1')?.promptSummary).toBeUndefined();
    expect(store.getEntry('r1')?.responseSummary).toBeUndefined();
    expect(store.getEntry('r2')?.promptSummary).toBeUndefined();

    // On-disk file reflects the wipe.
    const reloaded = persister.loadSync();
    expect(reloaded).toBeDefined();
    const r1 = reloaded!.recent.find((e) => e.id === 'r1');
    const r2 = reloaded!.recent.find((e) => e.id === 'r2');
    expect(r1?.promptSummary).toBeUndefined();
    expect(r1?.responseSummary).toBeUndefined();
    expect(r2?.promptSummary).toBeUndefined();
    expect(r2?.responseSummary).toBeUndefined();
    // Counters persisted.
    expect(reloaded!.requests).toBe(2);
    expect(reloaded!.totalTokens).toBe(60);
  });

  it('is a no-op when no summaries are present', async () => {
    const filePath = join(tmp, 'telemetry.json');
    const lockPath = join(tmp, 'telemetry.lock');
    const persister = new TelemetryPersister({ filePath, lockPath });
    const store = new TelemetryStore(persister);
    store.record(
      makeEntry({
        id: 'r1',
        promptSummary: undefined,
        responseSummary: undefined,
      })
    );
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const { inMemory, onDisk } = store.purgeSessionLog();
    expect(inMemory).toBe(0);
    const onDiskCleared = await onDisk;
    expect(onDiskCleared).toBe(0);
  });

  it('survives a corrupted / missing file (returns 0)', async () => {
    const filePath = join(tmp, 'missing.json');
    const lockPath = join(tmp, 'missing.lock');
    const persister = new TelemetryPersister({ filePath, lockPath });
    const cleared = await persister.purgeSessionLog();
    expect(cleared).toBe(0);
  });

  it('handles a malformed snapshot gracefully', async () => {
    const filePath = join(tmp, 'telemetry.json');
    const lockPath = join(tmp, 'telemetry.lock');
    writeFileSync(filePath, '{ not valid json', 'utf8');
    const persister = new TelemetryPersister({ filePath, lockPath });
    const cleared = await persister.purgeSessionLog();
    expect(cleared).toBe(0);
  });
});
