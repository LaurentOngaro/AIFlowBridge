/**
 * Regression tests for `src/aiflowbridge/vscode-context-adapter.ts`.
 *
 * Specifically: the `VscodeFileSystemAdapter.readFile` conversion from
 * `UriLike` (the runtime-agnostic URI shape that `joinPath()` in
 * `modelRegistry.ts` produces) to a real `vscode.Uri` that
 * `vscode.workspace.fs.readFile` can resolve.
 *
 * History: FEAT7 (`adb793b`) introduced `joinPath()` which returns a plain
 * `{ fsPath, toString }` object (no `scheme` / `authority`). The VS Code
 * adapter previously cast it to `vscode.Uri` and passed it through, which
 * made VS Code's internal `FileSystemProvider` lookup fail with
 * "Unable to resolve filesystem provider with relative file path ''" at
 * extension activation. The existing `modelRegistry.test.ts` mock path
 * (`options.fs`) bypasses the adapter entirely, so the bug was invisible
 * to the test suite.
 *
 * These tests exercise the adapter end-to-end with a real
 * `createVSCodeContext()` + a spy on `vscode.workspace.fs.readFile`, so
 * the conversion (or lack thereof) is now visible.
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
				// Real `vscode.Uri.file(path)` returns a Uri with the right
				// scheme/authority/path fields. The mock preserves the
				// `fsPath` so the adapter can still resolve it.
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
				// Spy: the tests below replace `readFile` via the captured
				// reference (`vscodeWorkspaceFs.readFile = vi.fn(...)`).
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

describe('VscodeFileSystemAdapter - UriLike to vscode.Uri conversion', () => {
	it('converts a plain { fsPath, toString } object to a real vscode.Uri (FEAT7 regression)', async () => {
		// This is the exact shape `joinPath()` in `modelRegistry.ts`
		// produces: a plain object with `fsPath` and `toString`, but no
		// `scheme` / `authority` / `path`. Before the fix, this object
		// was cast to `vscode.Uri` and `vscode.workspace.fs.readFile`
		// rejected it ("Unable to resolve filesystem provider with
		// relative file path ''"). After the fix, the adapter calls
		// `vscode.Uri.file(fsPath)` which produces a valid file:// URI.
		const readFileSpy = vi.fn(async (_uri: unknown) => new Uint8Array());
		// Replace the mock's readFile with our spy.
		(vscode.workspace.fs as { readFile: typeof readFileSpy }).readFile = readFileSpy;

		const ctx = createVSCodeContext(makeContext());
		expect(ctx.fs).toBeDefined();

		const plainUriLike = {
			fsPath: '/extension/resources/models.json',
			toString: () => '/extension/resources/models.json',
		};

		await ctx.fs!.readFile(plainUriLike);

		expect(readFileSpy).toHaveBeenCalledTimes(1);
		const passedUri = readFileSpy.mock.calls[0][0] as vscode.Uri;
		// The fix routes the plain object through `vscode.Uri.file()`,
		// so the inner `vscode.workspace.fs.readFile` receives a real
		// Uri (not the plain object). We assert on the side-effect of
		// `vscode.Uri.file()` having been called - the mock tags the
		// returned object with `_viaFile: true`.
		expect((passedUri as unknown as { _viaFile?: boolean })._viaFile).toBe(true);
		expect((passedUri as unknown as { fsPath: string }).fsPath).toBe('/extension/resources/models.json');
	});

	it('passes a real vscode.Uri through unchanged when one is supplied (VscodeUriAdapter case)', async () => {
		const readFileSpy = vi.fn(async (_uri: unknown) => new Uint8Array());
		(vscode.workspace.fs as { readFile: typeof readFileSpy }).readFile = readFileSpy;

		const ctx = createVSCodeContext(makeContext());

		// `createVSCodeContext` wraps `context.extensionUri` in a
		// `VscodeUriAdapter` that implements `UriLike`. When the loader
		// passes it through `joinPath()`, the result is still backed by
		// a real `vscode.Uri`. The adapter must call `vscode.Uri.file()`
		// (the mock's `file` tags with `_viaFile: true`) rather than
		// passing the adapter object through unchanged.
		const realUri = new MockUri('/some/other/path');
		const uriLikeAdapter = {
			fsPath: realUri.fsPath,
			toString: () => realUri.fsPath,
			_inner: realUri,
		};

		await ctx.fs!.readFile(uriLikeAdapter);

		const passedUri = readFileSpy.mock.calls[0][0] as vscode.Uri;
		expect((passedUri as unknown as { _viaFile?: boolean })._viaFile).toBe(true);
		expect((passedUri as unknown as { fsPath: string }).fsPath).toBe('/some/other/path');
	});
});
