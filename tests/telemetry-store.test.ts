/**
 * Unit tests for src/aiflowbridge/telemetry.ts
 * Covers record(), snapshot(), restore() (cumulative persistence),
 * subscribe() (listener for live updates), and reset() (clear state).
 */

import { describe, it, expect, vi } from "vitest";
import { TelemetryStore } from "../src/aiflowbridge/telemetry";
import type { RequestTelemetry, TelemetrySnapshot } from "../src/aiflowbridge/types";

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
		estimated: false,
		...overrides,
	};
}

describe("TelemetryStore - record / snapshot", () => {
	it("returns an empty snapshot on a fresh store", () => {
		const store = new TelemetryStore();
		const snap = store.snapshot();
		expect(snap.requests).toBe(0);
		expect(snap.totalTokens).toBe(0);
		expect(snap.recent).toEqual([]);
		expect(snap.byProvider).toEqual({});
		expect(snap.byModel).toEqual({});
	});

	it("aggregates totals and byProvider / byModel maps", () => {
		const store = new TelemetryStore();
		store.record(makeEntry({ id: "r1", totalTokens: 30, promptTokens: 10, completionTokens: 20, durationMs: 100 }));
		store.record(makeEntry({ id: "r2", providerId: "p2", model: "m2", totalTokens: 50, promptTokens: 25, completionTokens: 25, durationMs: 200 }));
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

	it("counts errors (status >= 400)", () => {
		const store = new TelemetryStore();
		store.record(makeEntry({ status: 200 }));
		store.record(makeEntry({ status: 500 }));
		store.record(makeEntry({ status: 404 }));
		const snap = store.snapshot();
		expect(snap.errors).toBe(2);
		expect(snap.byProvider.p1?.errors).toBe(2);
	});

	it("caps the recent list at 20 entries (most recent first)", () => {
		const store = new TelemetryStore();
		for (let i = 0; i < 25; i++) {
			store.record(makeEntry({ id: `r${i}`, model: `m${i}` }));
		}
		const snap = store.snapshot();
		expect(snap.recent).toHaveLength(20);
		expect(snap.recent[0]?.id).toBe("r24");
		expect(snap.recent[19]?.id).toBe("r5");
		// Older requests should be reflected in totals, not the recent list
		expect(snap.requests).toBe(25);
	});
});

describe("TelemetryStore - restore (cumulative persistence)", () => {
	it("restores totals, byProvider, byModel, and recent from a snapshot", () => {
		const storeA = new TelemetryStore();
		storeA.record(makeEntry({ providerId: "p1", model: "m1", totalTokens: 100, promptTokens: 60, completionTokens: 40, durationMs: 200 }));
		storeA.record(makeEntry({ id: "r2", providerId: "p1", model: "m1", totalTokens: 200, promptTokens: 120, completionTokens: 80, durationMs: 400 }));
		storeA.record(makeEntry({ id: "r3", providerId: "p2", model: "m2", totalTokens: 50, promptTokens: 25, completionTokens: 25, durationMs: 100 }));
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

	it("restore(undefined) clears all state", () => {
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

	it("additional record() calls after restore() are cumulative", () => {
		const storeA = new TelemetryStore();
		storeA.record(makeEntry({ id: "r1", totalTokens: 100, promptTokens: 50, completionTokens: 50, durationMs: 200 }));
		const persisted = storeA.snapshot();

		const storeB = new TelemetryStore();
		storeB.restore(persisted);
		storeB.record(makeEntry({ id: "r2", totalTokens: 100, promptTokens: 50, completionTokens: 50, durationMs: 200 }));

		const snap = storeB.snapshot();
		expect(snap.requests).toBe(2);
		expect(snap.totalTokens).toBe(200);
		expect(snap.averageDurationMs).toBe(200);
	});
});

describe("TelemetryStore - subscribe", () => {
	it("notifies listeners on each record() with the latest snapshot", () => {
		const store = new TelemetryStore();
		const listener = vi.fn();
		store.subscribe(listener);
		store.record(makeEntry());
		store.record(makeEntry());
		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener.mock.calls[0]?.[0]?.requests).toBe(1);
		expect(listener.mock.calls[1]?.[0]?.requests).toBe(2);
	});

	it("returns an unsubscribe function", () => {
		const store = new TelemetryStore();
		const listener = vi.fn();
		const off = store.subscribe(listener);
		store.record(makeEntry());
		off();
		store.record(makeEntry());
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("listener exceptions do not break record()", () => {
		const store = new TelemetryStore();
		store.subscribe(() => {
			throw new Error("listener boom");
		});
		expect(() => store.record(makeEntry())).not.toThrow();
		expect(store.snapshot().requests).toBe(1);
	});
});

describe("TelemetryStore - reset", () => {
	it("clears all state and notifies listeners", () => {
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
});

describe("TelemetryStore - round trip via snapshot/restore preserves snapshot shape", () => {
	it("snapshot() output is a valid input for restore()", () => {
		const a = new TelemetryStore();
		a.record(makeEntry());
		a.record(makeEntry({ id: "r2", providerId: "p2", model: "m2", totalTokens: 5 }));
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
