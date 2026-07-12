/**
 * regression tests:
 *   - `enforceEntrySizeCap` truncates oversized prompt / response summaries.
 *   - `pruneByRetention` drops entries older than the cutoff and
 *     re-derives the cumulative totals.
 *   - `TelemetryPersister` respects both the cap and the retention
 *     window through the construction options.
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

import { applyEntryToSnapshot, emptyTelemetrySnapshot } from '../src/aiflowbridge/telemetry';
import { byteLengthUtf8, enforceEntrySizeCap, truncateUtf8ToBytes } from '../src/aiflowbridge/telemetry/cap';
import { pruneByRetention, TelemetryPersister } from '../src/aiflowbridge/telemetry/persistence';
import type { RequestTelemetry, TelemetrySnapshot } from '../src/aiflowbridge/types';

function makeEntry(overrides: Partial<RequestTelemetry> = {}): RequestTelemetry {
  return {
    id: overrides.id ?? 'r1',
    timestamp: overrides.timestamp ?? '2026-06-03T08:00:00.000Z',
    providerId: overrides.providerId ?? 'p1',
    providerLabel: overrides.providerLabel ?? 'Provider 1',
    model: overrides.model ?? 'm1',
    status: overrides.status ?? 200,
    durationMs: overrides.durationMs ?? 100,
    promptTokens: overrides.promptTokens ?? 10,
    completionTokens: overrides.completionTokens ?? 20,
    totalTokens: overrides.totalTokens ?? 30,
    estimatedCost: overrides.estimatedCost ?? 0,
    estimated: overrides.estimated ?? false,
    promptSummary: overrides.promptSummary,
    responseSummary: overrides.responseSummary,
    clientId: overrides.clientId,
    source: overrides.source,
  };
}

describe('enforceEntrySizeCap', () => {
  it('is a no-op when the cap is disabled (maxBytes <= 0)', () => {
    const entry = makeEntry({ promptSummary: 'hello world'.repeat(100) });
    expect(enforceEntrySizeCap(entry, 0)).toBe(entry);
    expect(enforceEntrySizeCap(entry, -1)).toBe(entry);
  });

  it('is a no-op when the entry already fits the cap', () => {
    const entry = makeEntry({ promptSummary: 'hi', responseSummary: 'ok' });
    const out = enforceEntrySizeCap(entry, 8192);
    expect(out).toBe(entry);
  });

  it('truncates responseSummary first when oversized', () => {
    const long = 'x'.repeat(200_000);
    const entry = makeEntry({ promptSummary: 'short prompt', responseSummary: long });
    const out = enforceEntrySizeCap(entry, 4096);
    expect(out).not.toBe(entry);
    expect(out.responseSummary).toBeDefined();
    expect(out.responseSummary!.length).toBeLessThan(long.length);
    expect(out.responseSummary!.endsWith('...')).toBe(true);
    // The capped JSON-serialized entry must now fit the cap.
    expect(byteLengthUtf8(JSON.stringify(out))).toBeLessThanOrEqual(4096);
  });

  it('drops both summaries when the JSON envelope already exceeds the cap', () => {
    // Use a cap below the static JSON overhead (the entry fields
    // outside of `promptSummary` / `responseSummary`). The cap is
    // then unachievable for any non-empty summary, so the
    // implementation drops both fields rather than produce a
    // truncated marker that pushes the entry over the limit.
    const entry = makeEntry({ promptSummary: 'p'.repeat(2000), responseSummary: 'r'.repeat(2000) });
    const out = enforceEntrySizeCap(entry, 256);
    expect(byteLengthUtf8(JSON.stringify(out))).toBeLessThanOrEqual(256);
    expect(out.promptSummary).toBeUndefined();
    expect(out.responseSummary).toBeUndefined();
  });

  it('survives JSON.stringify + JSON.parse (valid UTF-8, no truncated codepoint)', () => {
    // Build an entry that mixes ASCII + multi-byte characters and
    // verify the truncated output is still JSON-roundtrippable.
    const multiByte = 'héllo 🌍 '.repeat(500);
    const entry = makeEntry({ promptSummary: 'hi', responseSummary: multiByte });
    const out = enforceEntrySizeCap(entry, 4096);
    expect(() => JSON.stringify(out)).not.toThrow();
    const round = JSON.parse(JSON.stringify(out));
    expect(typeof round.responseSummary).toBe('string');
    // No half-codepoint: encode the result and confirm it round-trips.
    expect(Buffer.from(round.responseSummary, 'utf8').toString('utf8')).toBe(round.responseSummary);
  });
});

describe('truncateUtf8ToBytes', () => {
  it('returns the input unchanged when it fits', () => {
    expect(truncateUtf8ToBytes('hello', 100)).toBe('hello');
  });

  it('truncates ASCII strings and appends the ... suffix', () => {
    const out = truncateUtf8ToBytes('abcdefghij', 6);
    expect(out.endsWith('...')).toBe(true);
    expect(byteLengthUtf8(out)).toBeLessThanOrEqual(6);
  });

  it('never splits a multi-byte codepoint', () => {
    const text = 'é'.repeat(1000); // 2 bytes each in UTF-8
    const out = truncateUtf8ToBytes(text, 20);
    // The output must be valid UTF-8 (round-trip via Buffer.byteLength).
    expect(byteLengthUtf8(out)).toBeLessThanOrEqual(20);
    // Re-encoding must yield the same length.
    const encoded = Buffer.from(out, 'utf8');
    expect(encoded.toString('utf8').length).toBe(out.length);
  });
});

describe('pruneByRetention', () => {
  function snapshotWithEntries(entries: RequestTelemetry[]): TelemetrySnapshot {
    const snap = emptyTelemetrySnapshot();
    // `applyEntryToSnapshot` works in insertion order; the existing
    // `recent` list is reverse-chronological. We mirror that here so
    // the test mirrors the on-disk shape.
    const chronological = [...entries].reverse();
    for (const entry of chronological) {
      applyEntryToSnapshot(snap, entry);
    }
    snap.recent = [...entries];
    return snap;
  }

  it('returns the snapshot unchanged when retention is disabled', () => {
    const snap = snapshotWithEntries([makeEntry({ id: 'r1', timestamp: '2000-01-01T00:00:00.000Z' })]);
    const out = pruneByRetention(snap, 0);
    expect(out).toBe(snap);
  });

  it('drops entries older than the cutoff and re-derives totals', () => {
    const fresh = makeEntry({ id: 'r-new', timestamp: new Date().toISOString(), durationMs: 100, promptTokens: 5 });
    const old = makeEntry({ id: 'r-old', timestamp: '2000-01-01T00:00:00.000Z', durationMs: 100, promptTokens: 5 });
    const snap = snapshotWithEntries([fresh, old]); // fresh first (newest)
    const before = snap.requests;
    const out = pruneByRetention(snap, 24 * 60 * 60 * 1000); // 1 day
    expect(out.requests).toBe(before - 1);
    // cumulative tokens reflect only the fresh entry
    expect(out.promptTokens).toBe(fresh.promptTokens);
    expect(out.recent.length).toBe(1);
    expect(out.recent[0].id).toBe(fresh.id);
  });

  it('preserves zero-state when every entry is stale', () => {
    const old1 = makeEntry({ id: 'r1', timestamp: '2000-01-01T00:00:00.000Z' });
    const old2 = makeEntry({ id: 'r2', timestamp: '2000-01-02T00:00:00.000Z' });
    const snap = snapshotWithEntries([old2, old1]);
    const out = pruneByRetention(snap, 24 * 60 * 60 * 1000);
    expect(out.requests).toBe(0);
    expect(out.totalTokens).toBe(0);
    expect(out.recent).toEqual([]);
    expect(Object.keys(out.byProvider)).toEqual([]);
  });
});

describe('TelemetryPersister wiring', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aifb-aud01-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('truncates oversized summaries on appendDelta (cap)', async () => {
    const filePath = join(tmp, 'telemetry.json');
    const lockPath = join(tmp, 'telemetry.lock');
    const persister = new TelemetryPersister({ filePath, lockPath, capBytes: 2048, retentionMs: 0 });
    const bigPrompt = 'p'.repeat(50_000);
    const bigResponse = 'r'.repeat(50_000);
    const entry = makeEntry({ id: 'big', promptSummary: bigPrompt, responseSummary: bigResponse });
    await persister.appendDelta(entry, emptyTelemetrySnapshot());

    const onDisk = persister.loadSync();
    expect(onDisk).toBeDefined();
    const stored = onDisk!.recent[0];
    expect(stored.id).toBe('big');
    // The serialized entry must fit the cap.
    expect(byteLengthUtf8(JSON.stringify(stored))).toBeLessThanOrEqual(2048);
    // ...and the long string must have been truncated.
    expect((stored.promptSummary ?? '').length).toBeLessThan(bigPrompt.length);
  });

  it('prunes entries older than `retentionMs` on load', async () => {
    const filePath = join(tmp, 'telemetry.json');
    const lockPath = join(tmp, 'telemetry.lock');
    // Seed the file with two entries: one fresh (kept), one stale (pruned).
    const snap = emptyTelemetrySnapshot();
    snap.recent = [
      makeEntry({ id: 'fresh', timestamp: new Date().toISOString(), promptTokens: 5 }),
      makeEntry({ id: 'stale', timestamp: '2000-01-01T00:00:00.000Z', promptTokens: 50 }),
    ];
    snap.requests = 2;
    snap.promptTokens = 55;
    snap.byProvider = {
      p1: {
        requests: 2,
        promptTokens: 55,
        completionTokens: 0,
        totalTokens: 55,
        estimatedCost: 0,
        errors: 0,
        averageDurationMs: 0,
      },
    };
    writeFileSync(filePath, JSON.stringify(snap), 'utf8');

    const persister = new TelemetryPersister({ filePath, lockPath, retentionMs: 24 * 60 * 60 * 1000 });
    const loaded = persister.loadSync();
    expect(loaded).toBeDefined();
    expect(loaded!.requests).toBe(1);
    expect(loaded!.promptTokens).toBe(5);
    expect(loaded!.recent.length).toBe(1);
    expect(loaded!.recent[0].id).toBe('fresh');
  });

  it('retention disabled (retentionMs=0) keeps every entry', async () => {
    const filePath = join(tmp, 'telemetry.json');
    const lockPath = join(tmp, 'telemetry.lock');
    const snap = emptyTelemetrySnapshot();
    snap.recent = [
      makeEntry({ id: 'fresh', timestamp: new Date().toISOString() }),
      makeEntry({ id: 'stale', timestamp: '2000-01-01T00:00:00.000Z' }),
    ];
    snap.requests = 2;
    writeFileSync(filePath, JSON.stringify(snap), 'utf8');
    const persister = new TelemetryPersister({ filePath, lockPath, retentionMs: 0 });
    const loaded = persister.loadSync();
    expect(loaded!.requests).toBe(2);
    expect(loaded!.recent.length).toBe(2);
  });
});
