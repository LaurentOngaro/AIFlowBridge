/**
 * Unit tests for the UX-related command regressions R-01..R-04
 * introduced after the FEAT7 refactor. The runtime is exercised
 * end-to-end against a mock `IGatewayContext` that captures every
 * command registration, every host hook invocation, and every
 * config reload. The model registry cache is pre-seeded with
 * `setLoadedRegistry()` so the runtime does not need a real
 * filesystem or `loadModelRegistry()` to succeed.
 *
 * Covered regressions:
 *   R-01: `aiflowbridge.resetMetrics` asks for confirmation via
 *         `ctx.confirm` and aborts on anything other than "Reset".
 *   R-02: `aiflowbridge.copyGatewayUrl` writes the URL via
 *         `ctx.clipboardWrite` (or to stdout when the hook is
 *         absent, e.g. in standalone mode).
 *   R-03: `aiflowbridge.openSettings` delegates to
 *         `ctx.openSettings("aiflowbridge")` (or surfaces the
 *         standalone config path on stderr/info when the hook is
 *         absent).
 *   R-04: `aiflowbridge.setVisionModel` re-registers as an alias
 *         to `aiflowbridge.providers.deepseek.setVisionModel` via
 *         `ctx.executeCommand`.
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
	commands: Map<string, (...args: unknown[]) => unknown>;
	confirmCalls: Array<{ message: string; buttons: string[] }>;
	confirmResult: string | undefined;
	clipboardWrites: string[];
	openSettingsCalls: string[];
	executeCommandCalls: Array<{ command: string; args: unknown[] }>;
	informationMessages: string[];
	warnings: string[];
	configStore: Map<string, unknown>;
}

function makeMockHost(): MockHost {
	const commands = new Map<string, (...args: unknown[]) => unknown>();
	const confirmCalls: Array<{ message: string; buttons: string[] }> = [];
	const clipboardWrites: string[] = [];
	const openSettingsCalls: string[] = [];
	const executeCommandCalls: Array<{ command: string; args: unknown[] }> = [];
	const informationMessages: string[] = [];
	const warnings: string[] = [];
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
		async get() { return undefined; },
		async store() { /* noop */ },
		async delete() { /* noop */ },
	};

	const ctx: IGatewayContext = {
		secrets: fakeSecretStorage,
		globalStorageDir: '/tmp/aiflowbridge-test',
		extensionVersion: '2.0.0',
		subscriptions: [],
		getConfiguration: () => configReader,
		registerCommand: (command: string, callback: (...args: unknown[]) => unknown): Disposable => {
			commands.set(command, callback);
			return { dispose: () => { commands.delete(command); } };
		},
		showInformation: (message: string) => { informationMessages.push(message); },
		showWarning: (message: string) => { warnings.push(message); },
		confirm: async (message: string, ...buttons: string[]) => {
			confirmCalls.push({ message, buttons });
			return confirmResult;
		},
		clipboardWrite: (text: string) => { clipboardWrites.push(text); },
		openSettings: (query?: string) => { openSettingsCalls.push(query ?? ''); },
		executeCommand: async (command: string, ...args: unknown[]) => {
			executeCommandCalls.push({ command, args });
			return undefined;
		},
	};

	let confirmResult: string | undefined = undefined;

	return {
		ctx,
		commands,
		confirmCalls,
		get confirmResult() { return confirmResult; },
		set confirmResult(value: string | undefined) { confirmResult = value; },
		clipboardWrites,
		openSettingsCalls,
		executeCommandCalls,
		informationMessages,
		warnings,
		configStore,
	};
}

describe('AIFlowBridgeRuntime - UX command regressions (R-01..R-04)', () => {
	let host: MockHost;
	let runtime: AIFlowBridgeRuntime;

	beforeEach(async () => {
		// Pre-seed the registry cache so `loadModelRegistry()` is a
		// no-op and the runtime does not need a real filesystem. The
		// shape matches what the loader normally returns; only the
		// fields that the runtime touches are populated.
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

		host = makeMockHost();
		runtime = new AIFlowBridgeRuntime(host.ctx);
		await runtime.activate();
	});

	afterEach(() => {
		setLoadedRegistry(undefined);
		void runtime.deactivate();
	});

	it('R-01: resetMetrics prompts via ctx.confirm and aborts on Cancel', async () => {
		const handler = host.commands.get('aiflowbridge.resetMetrics');
		expect(handler).toBeDefined();

		host.confirmResult = 'Cancel';
		await (handler as (...args: unknown[]) => unknown)();

		expect(host.confirmCalls).toHaveLength(1);
		expect(host.confirmCalls[0].message).toMatch(/reset/i);
		expect(host.confirmCalls[0].buttons).toEqual(['Reset', 'Cancel']);
		// On cancel, no "metrics reset" confirmation is shown.
		expect(host.informationMessages.some((m) => /reset/i.test(m))).toBe(false);
	});

	it('R-01: resetMetrics prompts via ctx.confirm and proceeds on Reset', async () => {
		const handler = host.commands.get('aiflowbridge.resetMetrics');
		expect(handler).toBeDefined();

		host.confirmResult = 'Reset';
		await (handler as (...args: unknown[]) => unknown)();

		expect(host.confirmCalls).toHaveLength(1);
		expect(host.informationMessages.some((m) => /metrics reset/i.test(m))).toBe(true);
	});

	it('R-02: copyGatewayUrl writes the gateway URL to ctx.clipboardWrite', async () => {
		const handler = host.commands.get('aiflowbridge.copyGatewayUrl');
		expect(handler).toBeDefined();

		await (handler as (...args: unknown[]) => unknown)();

		expect(host.clipboardWrites).toEqual(['http://127.0.0.1:8787/v1']);
		expect(host.informationMessages.some((m) => /copied/i.test(m))).toBe(true);
	});

	it('R-03: openSettings delegates to ctx.openSettings scoped to aiflowbridge', async () => {
		const handler = host.commands.get('aiflowbridge.openSettings');
		expect(handler).toBeDefined();

		await (handler as (...args: unknown[]) => unknown)();

		expect(host.openSettingsCalls).toEqual(['aiflowbridge']);
	});

	it('R-04: setVisionModel forwards via ctx.executeCommand to the deepseek alias', async () => {
		const handler = host.commands.get('aiflowbridge.setVisionModel');
		expect(handler).toBeDefined();

		await (handler as (...args: unknown[]) => unknown)();

		expect(host.executeCommandCalls).toHaveLength(1);
		expect(host.executeCommandCalls[0].command).toBe('aiflowbridge.providers.deepseek.setVisionModel');
	});
});
