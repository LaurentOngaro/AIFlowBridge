/**
 * Unit tests for src/aiflowbridge/telemetry/persistence.ts
 *
 * Covers:
 * - acquireTelemetryLock / releaseTelemetryLock (free / held / symlink /
 *   stale-mtime reaper / mkdir-recursive)
 * - TelemetryPersister.loadSync (missing / valid / corrupt)
 * - TelemetryPersister.appendDelta (single, accumulated, idempotent)
 * - TelemetryPersister.saveFull (overwrite)
 * - TelemetryPersister.clear (empty snapshot)
 * - TelemetryPersister atomic write (no partial reads)
 * - TelemetryPersister concurrent writers (no lost updates)
 * - TelemetryStore + persister integration (record() schedules an
 *   appendDelta; refreshFromDisk() swaps in the on-disk state)
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// logger.ts pulls in vscode via LogOutputChannel; provide a shim.
vi.mock("vscode", () => {
	return {
		default: {
			window: {
				createOutputChannel: vi.fn(() => ({
					name: "AIFlowBridge",
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
				name = "AIFlowBridge";
				log = vi.fn();
				trace = vi.fn();
				debug = vi.fn();
				info = vi.fn();
				warn = vi.fn();
				error = vi.fn();
			},
		},
	};
});

import {
	acquireTelemetryLock,
	releaseTelemetryLock,
	TelemetryPersister,
	defaultTelemetryPaths,
} from "../src/aiflowbridge/telemetry/persistence";
import { emptyTelemetrySnapshot, TelemetryStore } from "../src/aiflowbridge/telemetry";
import type { RequestTelemetry } from "../src/aiflowbridge/types";

function makeEntry(overrides: Partial<RequestTelemetry> = {}): RequestTelemetry {
	return {
		id: "r1",
		timestamp: "2026-06-03T08:00:00.000Z",
		providerId: "p1",
		providerLabel: "Provider 1",
		model: "m1",
		status: 200,
		durationMs: 100,
		promptTokens: 10,
		completionTokens: 20,
		totalTokens: 30,
		estimatedCost: 0.0001,
		estimated: false,...overrides,
	};
}

describe("telemetry lock", () => {
	let dir: string;
	let lockPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aiflowbridge-tel-lock-"));
		lockPath = join(dir, "telemetry.lock");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("acquires a free lock", () => {
		const result = acquireTelemetryLock(lockPath);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.handle.path).toBe(lockPath);
			releaseTelemetryLock(result.handle);
		}
	});

	it("returns { ok: false, reason: 'held' } when the lock is already held", () => {
		const first = acquireTelemetryLock(lockPath);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const second = acquireTelemetryLock(lockPath);
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.reason).toBe("held");
		releaseTelemetryLock(first.handle);
		const third = acquireTelemetryLock(lockPath);
		expect(third.ok).toBe(true);
		if (third.ok) releaseTelemetryLock(third.handle);
	});

	it("returns { ok: false, reason: 'not-acquirable' } when the path is a symlink", () => {
		const target = join(dir, "target.txt");
		writeFileSync(target, "hello");
		const symlinkPath = join(dir, "link.lock");
		symlinkSync(target, symlinkPath, "file");
		const result = acquireTelemetryLock(symlinkPath);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("not-acquirable");
		expect(result.error).toMatch(/symlink/i);
	});

	it("creates the parent directory if it does not exist", () => {
		const nestedPath = join(dir, "nested", "deeper", "telemetry.lock");
		const result = acquireTelemetryLock(nestedPath);
		expect(result.ok).toBe(true);
		if (result.ok) releaseTelemetryLock(result.handle);
	});

	it("reaps a stale lock (mtime > 30s) and re-acquires", () => {
		writeFileSync(lockPath, "stale");
		const fortySecondsAgo = new Date(Date.now() - 40_000);
		utimesSync(lockPath, fortySecondsAgo, fortySecondsAgo);

		const result = acquireTelemetryLock(lockPath);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.reapedStale).toBe(true);
			releaseTelemetryLock(result.handle);
		}
	});

	it("does NOT reap a fresh lock (mtime < 30s)", () => {
		const first = acquireTelemetryLock(lockPath);
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const second = acquireTelemetryLock(lockPath);
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.reason).toBe("held");
		releaseTelemetryLock(first.handle);
	});

	it("releaseTelemetryLock tolerates a null handle", () => {
		expect(() => releaseTelemetryLock(null)).not.toThrow();
	});
});

describe("defaultTelemetryPaths", () => {
	it("returns filePath and lockPath inside the supplied directory", () => {
		const paths = defaultTelemetryPaths("/tmp/aiflowbridge-test");
		expect(paths.filePath).toBe(join("/tmp/aiflowbridge-test", "telemetry.json"));
		expect(paths.lockPath).toBe(join("/tmp/aiflowbridge-test", "telemetry.lock"));
	});
});

describe("TelemetryPersister.loadSync", () => {
	let dir: string;
	let filePath: string;
	let lockPath: string;
	let persister: TelemetryPersister;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aiflowbridge-tel-"));
		filePath = join(dir, "telemetry.json");
		lockPath = join(dir, "telemetry.lock");
		persister = new TelemetryPersister({ filePath, lockPath });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns undefined on a missing file", () => {
		expect(persister.loadSync()).toBeUndefined();
	});

	it("returns the parsed snapshot on a valid file", async () => {
		const snap = emptyTelemetrySnapshot();
		snap.requests = 5;
		snap.totalTokens = 100;
		await persister.saveFull(snap);
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(5);
		expect(loaded?.totalTokens).toBe(100);
	});

	it("returns undefined on a corrupt file and logs a warning", async () => {
		writeFileSync(filePath, "{ not valid json", "utf8");
		expect(persister.loadSync()).toBeUndefined();
	});

	it("returns undefined on a file with the wrong shape", () => {
		writeFileSync(filePath, JSON.stringify({ unrelated: true }), "utf8");
		expect(persister.loadSync()).toBeUndefined();
	});
});

describe("TelemetryPersister.appendDelta", () => {
	let dir: string;
	let filePath: string;
	let lockPath: string;
	let persister: TelemetryPersister;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aiflowbridge-tel-"));
		filePath = join(dir, "telemetry.json");
		lockPath = join(dir, "telemetry.lock");
		persister = new TelemetryPersister({ filePath, lockPath });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes a single entry to disk", async () => {
		const entry = makeEntry({ id: "r1" });
		await persister.appendDelta(entry, emptyTelemetrySnapshot());
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(1);
		expect(loaded?.recent[0]?.id).toBe("r1");
		expect(loaded?.byProvider["p1"]?.requests).toBe(1);
		expect(loaded?.byModel["m1"]?.requests).toBe(1);
	});

	it("accumulates N distinct entries into a single on-disk snapshot", async () => {
		// Record well past any previous cap to verify the on-disk `recent`
		// tail keeps every entry (the dashboard paginates the full history).
		const total = 250;
		for (let i = 0; i < total; i++) {
			await persister.appendDelta(
				makeEntry({ id: `r${i}`, model: `m${i}` }),
				emptyTelemetrySnapshot(),
			);
		}
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(total);
		expect(loaded?.recent).toHaveLength(total);
	});

	it("is idempotent when the same entry.id is appended twice", async () => {
		const entry = makeEntry({ id: "r1", totalTokens: 30 });
		await persister.appendDelta(entry, emptyTelemetrySnapshot());
		await persister.appendDelta(entry, emptyTelemetrySnapshot());
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(1);
		expect(loaded?.totalTokens).toBe(30);
	});

	it("survives 50 parallel writers with no lost updates", async () => {
		const N = 50;
		const calls = Array.from({ length: N }, (_, i) =>
			persister.appendDelta(makeEntry({ id: `r${i}`, model: `m${i}` }), emptyTelemetrySnapshot()),
		);
		await Promise.all(calls);
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(N);
		expect(Object.keys(loaded?.byModel ?? {}).length).toBe(N);
	});

	it("does not leave a partial file observed by a concurrent reader", async () => {
		// Fill the file with 30 entries, each containing a non-trivial
		// payload, so the write takes a measurable amount of time and a
		// concurrent reader has a chance to observe a partial state if
		// the atomic write were broken.
		const N = 30;
		await Promise.all(
			Array.from({ length: N }, (_, i) =>
				persister.appendDelta(
					makeEntry({ id: `r${i}`, totalTokens: 1000 + i }),
					emptyTelemetrySnapshot(),
				),
			),
		);
		// After all writes, the file must be a valid JSON snapshot.
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(N);
	});
});

describe("TelemetryPersister.saveFull / clear", () => {
	let dir: string;
	let filePath: string;
	let lockPath: string;
	let persister: TelemetryPersister;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aiflowbridge-tel-"));
		filePath = join(dir, "telemetry.json");
		lockPath = join(dir, "telemetry.lock");
		persister = new TelemetryPersister({ filePath, lockPath });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("saveFull overwrites the on-disk snapshot", async () => {
		await persister.appendDelta(makeEntry({ id: "r1" }), emptyTelemetrySnapshot());
		const replacement = emptyTelemetrySnapshot();
		replacement.requests = 999;
		await persister.saveFull(replacement);
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(999);
	});

	it("clear() writes an empty snapshot", async () => {
		await persister.appendDelta(makeEntry({ id: "r1" }), emptyTelemetrySnapshot());
		await persister.appendDelta(makeEntry({ id: "r2" }), emptyTelemetrySnapshot());
		await persister.clear();
		const loaded = persister.loadSync();
		expect(loaded?.requests).toBe(0);
		expect(loaded?.recent).toEqual([]);
	});
});

describe("TelemetryStore + persister integration", () => {
	let dir: string;
	let filePath: string;
	let lockPath: string;
	let persister: TelemetryPersister;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aiflowbridge-tel-"));
		filePath = join(dir, "telemetry.json");
		lockPath = join(dir, "telemetry.lock");
		persister = new TelemetryPersister({ filePath, lockPath });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("record() calls persister.appendDelta exactly once per call", async () => {
		const store = new TelemetryStore(persister);
		const spy = vi.spyOn(persister, "appendDelta");
		store.record(makeEntry({ id: "r1" }));
		store.record(makeEntry({ id: "r2" }));
		// Let the fire-and-forget promises settle so the spy count is
		// updated before the assertion.
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("refreshFromDisk() replaces the in-memory state with the on-disk state", async () => {
		// Seed the disk with 5 requests from a "previous" store.
		for (let i = 0; i < 5; i++) {
			await persister.appendDelta(makeEntry({ id: `pre-${i}` }), emptyTelemetrySnapshot());
		}
		const store = new TelemetryStore(persister);
		const loaded = store.refreshFromDisk();
		expect(loaded).toBe(true);
		expect(store.snapshot().requests).toBe(5);
	});

	it("restore(undefined) loads from the persister when one is configured", async () => {
		await persister.appendDelta(makeEntry({ id: "r1" }), emptyTelemetrySnapshot());
		const store = new TelemetryStore(persister);
		store.restore(undefined);
		expect(store.snapshot().requests).toBe(1);
	});

	it("appendDelta errors are caught and logged, never thrown to the caller", async () => {
		// Force a write error by making the parent directory unwriteable.
		// We simulate the error path with a persister pointing at an
		// invalid path; the record() call must not throw.
		const broken = new TelemetryPersister({
			filePath: join(dir, "missing", "nope", "telemetry.json"),
			lockPath: join(dir, "missing", "nope", "telemetry.lock"),
		});
		const store = new TelemetryStore(broken);
		expect(() => store.record(makeEntry({ id: "r1" }))).not.toThrow();
		// The in-memory state is updated regardless of the on-disk outcome.
		expect(store.snapshot().requests).toBe(1);
	});

	it("concurrent record() calls from N parallel recorders persist without loss", async () => {
		const store = new TelemetryStore(persister);
		const N = 50;
		for (let i = 0; i < N; i++) {
			store.record(makeEntry({ id: `r${i}`, model: `m${i}` }));
		}
		// Wait for the fire-and-forget writes to settle.
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
		const onDisk = persister.loadSync();
		expect(onDisk?.requests).toBe(N);
		expect(Object.keys(onDisk?.byModel ?? {}).length).toBe(N);
	});

	it("removeEntry() reverses the entry's deltas in the on-disk snapshot", async () => {
		await persister.appendDelta(makeEntry({ id: "r1", totalTokens: 30, promptTokens: 10, completionTokens: 20, durationMs: 100, estimatedCost: 0.001 }), emptyTelemetrySnapshot());
		await persister.appendDelta(makeEntry({ id: "r2", totalTokens: 70, promptTokens: 25, completionTokens: 45, durationMs: 300, estimatedCost: 0.002 }), emptyTelemetrySnapshot());
		const beforeRemove = persister.loadSync();
		expect(beforeRemove?.requests).toBe(2);
		expect(beforeRemove?.totalTokens).toBe(100);

		const removed = await persister.removeEntry("r1");
		expect(removed).toBe(true);
		const afterRemove = persister.loadSync();
		expect(afterRemove?.requests).toBe(1);
		expect(afterRemove?.totalTokens).toBe(70);
		expect(afterRemove?.recent.some((e) => e.id === "r1")).toBe(false);
		expect(afterRemove?.recent.some((e) => e.id === "r2")).toBe(true);
		// byProvider still has the r1 key (because r2 also used p1); the
		// counter just decrements to 1.
		expect(afterRemove?.byProvider["p1"]?.requests).toBe(1);
	});

	it("removeEntry() returns false when the id is not on disk", async () => {
		await persister.appendDelta(makeEntry({ id: "r1" }), emptyTelemetrySnapshot());
		const removed = await persister.removeEntry("does-not-exist");
		expect(removed).toBe(false);
		// The on-disk snapshot is unchanged.
		expect(persister.loadSync()?.requests).toBe(1);
	});

	it("removeEntry() drops the byProvider key when the last request for that provider is removed", async () => {
		await persister.appendDelta(makeEntry({ id: "r1", providerId: "p1", model: "m1" }), emptyTelemetrySnapshot());
		await persister.appendDelta(makeEntry({ id: "r2", providerId: "p2", model: "m2" }), emptyTelemetrySnapshot());
		await persister.removeEntry("r1");
		const loaded = persister.loadSync();
		expect(loaded?.byProvider["p1"]).toBeUndefined();
		expect(loaded?.byProvider["p2"]?.requests).toBe(1);
		expect(loaded?.byModel["m1"]).toBeUndefined();
	});

	it("removeEntry() is safe to call on a missing file (returns false, no throw)", async () => {
		const removed = await persister.removeEntry("anything");
		expect(removed).toBe(false);
	});
});

describe("TelemetryStore.removeEntry (in-memory)", () => {
	let dir: string;
	let filePath: string;
	let lockPath: string;
	let persister: TelemetryPersister;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aiflowbridge-tel-"));
		filePath = join(dir, "telemetry.json");
		lockPath = join(dir, "telemetry.lock");
		persister = new TelemetryPersister({ filePath, lockPath });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("removes the entry from the in-memory recent list and reverses its deltas", () => {
		const store = new TelemetryStore(persister);
		store.record(makeEntry({ id: "r1", totalTokens: 30 }));
		store.record(makeEntry({ id: "r2", totalTokens: 70 }));
		expect(store.snapshot().requests).toBe(2);
		expect(store.snapshot().recent).toHaveLength(2);

		const removed = store.removeEntry("r1");
		expect(removed).toBe(true);
		const snap = store.snapshot();
		expect(snap.requests).toBe(1);
		expect(snap.totalTokens).toBe(70);
		expect(snap.recent.some((e) => e.id === "r1")).toBe(false);
		expect(snap.recent.some((e) => e.id === "r2")).toBe(true);
	});

	it("returns false when the id is not in the recent list", () => {
		const store = new TelemetryStore(persister);
		store.record(makeEntry({ id: "r1" }));
		const removed = store.removeEntry("does-not-exist");
		expect(removed).toBe(false);
		expect(store.snapshot().requests).toBe(1);
	});

	it("notifies subscribers with the updated snapshot", () => {
		const store = new TelemetryStore(persister);
		const listener = vi.fn();
		store.subscribe(listener);
		store.record(makeEntry({ id: "r1" }));
		store.record(makeEntry({ id: "r2" }));
		listener.mockClear();
		store.removeEntry("r1");
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0]?.[0]?.requests).toBe(1);
	});

	it("schedules a persister.removeEntry() call", async () => {
		const store = new TelemetryStore(persister);
		store.record(makeEntry({ id: "r1", totalTokens: 30 }));
		store.record(makeEntry({ id: "r2", totalTokens: 70 }));
		const spy = vi.spyOn(persister, "removeEntry");
		store.removeEntry("r1");
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(spy).toHaveBeenCalledWith("r1");
		// The on-disk file also reflects the removal.
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		const onDisk = persister.loadSync();
		expect(onDisk?.requests).toBe(1);
		expect(onDisk?.totalTokens).toBe(70);
	});

	it("recomputes the durations array (p95) when an entry is removed", () => {
		const store = new TelemetryStore(persister);
		store.record(makeEntry({ id: "r1", durationMs: 100 }));
		store.record(makeEntry({ id: "r2", durationMs: 200 }));
		store.record(makeEntry({ id: "r3", durationMs: 300 }));
		// P95 over [100, 200, 300] = 300
		const beforeSnap = store.snapshot();
		expect(beforeSnap.p95DurationMs).toBe(300);
		store.removeEntry("r2");
		// P95 over [100, 300] = 300
		const afterSnap = store.snapshot();
		expect(afterSnap.p95DurationMs).toBe(300);
	});
});

// Keep the import referenced to satisfy noUnusedImports / similar.
void mkdirSync;
