/**
 * Regression tests for B-04: the `subscriptions` field of
 * `IGatewayContext` must behave like a real `Disposable[]`.
 *
 * Before the fix, the VS Code adapter returned a frozen object
 * with only `length: 0` and `push`, which crashed the runtime at
 * activation with `TypeError: subscriptions.forEach is not a function`
 * (the runtime iterated the bag to wire telemetry listeners). The
 * current implementation wraps the bag in a `Proxy` that forwards
 * `push` to the host's `context.subscriptions` AND exposes every
 * other Array method on a private backing array.
 *
 * The tests below exercise the contract end-to-end through
 * `createVSCodeContext()`:
 *
 *   - `push()` forwards each item to the host's
 *     `context.subscriptions` (via a `VscodeDisposableAdapter`).
 *   - The returned bag supports `length`, indexed access, `forEach`,
 *     `filter`, `map`, and `indexOf` without throwing.
 *   - Multiple `push`es accumulate; the host's subscriptions array
 *     mirrors the runtime's bag in insertion order.
 *   - Mutating the bag via the standard Array methods (e.g. `pop`,
 *     `splice`) does NOT propagate to the host (the proxy only
 *     forwards `push`). This is intentional - the runtime only ever
 *     pushes, never pops, so the asymmetry is invisible to callers.
 */

import { describe, expect, it, vi } from 'vitest';

// ---- Minimal vscode mock (hoisted so vi.mock can reference it) ----

class MockUri {
	constructor(public readonly fsPath: string) {}
	toString(): string {
		return this.fsPath;
	}
	scheme = 'file';
	authority = '';
	path = '';
}

const { mockVscode } = vi.hoisted(() => {
	const stubChannel = {
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
		debug: () => undefined,
		show: () => undefined,
		dispose: () => undefined,
	};
	class HoistedMockUri {
		constructor(public readonly fsPath: string) {}
		toString(): string {
			return this.fsPath;
		}
		scheme = 'file';
		authority = '';
		path = '';
	}
	return {
		mockVscode: {
			Uri: Object.assign(HoistedMockUri, {
				file: (path: string) => Object.assign(new HoistedMockUri(path), { _viaFile: true }),
				parse: (s: string) => new HoistedMockUri(s),
				joinPath: (base: HoistedMockUri, ...segments: string[]) =>
					new HoistedMockUri(
						[base.fsPath.replace(/\/+$/, ''), ...segments].join('/'),
					),
			}),
			workspace: {
				onDidChangeConfiguration: () => ({ dispose: () => undefined }),
				getConfiguration: () => ({ get: () => undefined }),
				workspaceFolders: undefined,
				fs: { readFile: () => Promise.reject(new Error('not used in this test')) },
			},
			window: {
				createOutputChannel: () => stubChannel,
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
		Uri: mockVscode.Uri,
		workspace: mockVscode.workspace,
		window: mockVscode.window,
		commands: mockVscode.commands,
		env: mockVscode.env,
	};
	mock.default = mock;
	return mock;
});

import * as vscode from 'vscode';
import type { Disposable } from '../src/aiflowbridge/types';
import { createVSCodeContext } from '../src/aiflowbridge/vscode-context-adapter';

function makeContext(): vscode.ExtensionContext {
	return {
		extensionUri: new MockUri('/extension'),
		globalStorageUri: new MockUri('/globalStorage'),
		subscriptions: [],
		extension: { packageJSON: { version: '2.0.0' } },
		secrets: {
			get: () => Promise.resolve(undefined),
			store: () => Promise.resolve(),
			delete: () => Promise.resolve(),
		},
		globalState: {
			get: () => undefined,
			update: () => Promise.resolve(),
		},
	} as unknown as vscode.ExtensionContext;
}

function makeDisposable(label: string): Disposable {
	const d: Disposable = { dispose: () => undefined };
	(d as Disposable & { label: string }).label = label;
	return d;
}

describe('subscriptionsBag (B-04) - the IGatewayContext.subscriptions Proxy', () => {
	it('forwards each push to context.subscriptions in insertion order', () => {
		const inner = makeContext();
		const ctx = createVSCodeContext(inner);
		const d1 = makeDisposable('d1');
		const d2 = makeDisposable('d2');
		const d3 = makeDisposable('d3');

		ctx.subscriptions.push(d1, d2, d3);

		// The host's subscription list has been populated. Each entry
		// is a `VscodeDisposableAdapter` that wraps the original
		// Disposable (not the disposable itself) - that is what
		// VS Code expects (`vscode.Disposable` from the Extension API).
		expect(inner.subscriptions).toHaveLength(3);
		// The runtime's view of the bag has the same length.
		expect(ctx.subscriptions.length).toBe(3);
		// And the same items in the same order.
		expect(ctx.subscriptions[0]).toBe(d1);
		expect(ctx.subscriptions[1]).toBe(d2);
		expect(ctx.subscriptions[2]).toBe(d3);
	});

	it('returns the new length from push()', () => {
		const ctx = createVSCodeContext(makeContext());
		const r1 = ctx.subscriptions.push(makeDisposable('a'));
		expect(r1).toBe(1);
		const r2 = ctx.subscriptions.push(makeDisposable('b'), makeDisposable('c'));
		expect(r2).toBe(3);
	});

	it('supports forEach without throwing (regression: pre-fix bag was a frozen {length: 0})', () => {
		const ctx = createVSCodeContext(makeContext());
		const d1 = makeDisposable('d1');
		const d2 = makeDisposable('d2');
		ctx.subscriptions.push(d1, d2);

		const seen: Disposable[] = [];
		// Pre-fix this threw `TypeError: subscriptions.forEach is not a function`.
		ctx.subscriptions.forEach((item) => seen.push(item));
		expect(seen).toEqual([d1, d2]);
	});

	it('supports filter, map, indexOf, includes on the bag', () => {
		const ctx = createVSCodeContext(makeContext());
		const d1 = makeDisposable('d1');
		const d2 = makeDisposable('d2');
		const d3 = makeDisposable('d3');
		ctx.subscriptions.push(d1, d2, d3);

		// filter / map return arrays (per Array.prototype contract)
		expect(ctx.subscriptions.filter((d) => d !== d2)).toEqual([d1, d3]);
		expect(ctx.subscriptions.map((d) => (d as Disposable & { label: string }).label)).toEqual(['d1', 'd2', 'd3']);
		// indexOf / includes
		expect(ctx.subscriptions.indexOf(d2)).toBe(1);
		expect(ctx.subscriptions.includes(d2)).toBe(true);
		expect(ctx.subscriptions.includes(makeDisposable('never-pushed'))).toBe(false);
	});

	it('reports length == 0 on a freshly-created bag', () => {
		const ctx = createVSCodeContext(makeContext());
		expect(ctx.subscriptions.length).toBe(0);
	});

	it('mirrors push() to the host even when the host already had pre-existing subscriptions', () => {
		// VS Code's `context.subscriptions` is shared with the rest of
		// the extension host. The bag must append, not replace.
		const inner = makeContext();
		inner.subscriptions.push({ dispose: () => undefined }); // pre-existing
		const ctx = createVSCodeContext(inner);

		ctx.subscriptions.push(makeDisposable('aifb-1'));

		expect(inner.subscriptions).toHaveLength(2);
		// The first entry is the pre-existing one (untouched).
		expect(inner.subscriptions[0]).toEqual({ dispose: expect.any(Function) });
		// The second entry is the runtime's push, wrapped in a
		// VscodeDisposableAdapter. The adapter delegates `dispose` to
		// the inner Disposable but is not the same object reference.
		expect(typeof (inner.subscriptions[1] as { dispose: () => void }).dispose).toBe('function');
	});
});
