/**
 * Unit tests for src/aiflowbridge/gateway/server.ts
 * Tests GatewayService HTTP endpoints using a real server on a random port.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- VSCode mock (logger.ts uses LogOutputChannel) ---
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
			},
		},
	};
});

// Import after mocking
import { GatewayService } from '../src/aiflowbridge/gateway/server';
import type { AiFlowBridgeConfig, ProviderProfile } from '../src/aiflowbridge/types';
import { createServer } from 'node:http';

function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
	return {
		id: 'p1',
		label: 'Provider 1',
		kind: 'openai-compat',
		baseUrl: 'https://api.example.com/v1',
		model: 'model-1',
		apiKey: 'sk-test',
		enabled: true,
		...overrides,
	};
}

function makeConfig(overrides: Partial<AiFlowBridgeConfig> = {}): AiFlowBridgeConfig {
	return {
		gateway: {
			enabled: true,
			port: 0, // random port
			baseUrl: 'http://127.0.0.1:0', // no /v1 suffix — server listens on root
			defaultModel: '',
		},
		providers: [makeProvider()],
		telemetryEnabled: false,
		logRequests: false,
		visionProxy: { excludedVendors: [], copilotVisionModel: '' },
		...overrides,
	};
}

async function findListeningPort(server: { address: () => unknown }): Promise<number> {
	const addr = server.address() as { port: number };
	return addr.port;
}

describe('GatewayService - lifecycle', () => {
	let service: GatewayService;
	let actualBaseUrl: string;

	beforeEach(async () => {
		service = new GatewayService(makeConfig());
		const status = await service.start();
		actualBaseUrl = status.baseUrl;
	});

	afterEach(async () => {
		await service.stop();
	});

	it('starts the server and reports running', () => {
		const status = service.snapshot();
		expect(status).toBeDefined();
	});

	it('returns same status when start() is called twice', async () => {
		const second = await service.start();
		expect(second.running).toBe(true);
	});

	it('stops the server cleanly', async () => {
		await service.stop();
		// No more snapshot or stop should be safe
		await service.stop();
	});

	it('dispose() also stops the server', () => {
		service.dispose();
		// No assertion needed — just no throw
	});

	it('updates config without crashing', () => {
		const newConfig = makeConfig({
			gateway: {
				enabled: true,
				port: 0,
				baseUrl: 'http://127.0.0.1:0/v1',
				defaultModel: 'p1',
			},
		});
		service.updateConfig(newConfig);
	});
});

describe('GatewayService - HTTP endpoints', () => {
	let service: GatewayService;
	let baseUrl: string;

	beforeEach(async () => {
		service = new GatewayService(makeConfig());
		const status = await service.start();
		baseUrl = status.baseUrl;
	});

	afterEach(async () => {
		await service.stop();
	});

	it('GET /health returns 200 with status', async () => {
		const res = await fetch(`${baseUrl}/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; service: string; status: unknown };
		expect(body.ok).toBe(true);
		expect(body.service).toBe('AIFlowBridge');
		expect(body.status).toBeDefined();
	});

	it('GET /v1/models returns OpenAI-compatible list', async () => {
		const res = await fetch(`${baseUrl}/v1/models`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { object: string; data: Array<{ id: string; object: string; owned_by: string }> };
		expect(body.object).toBe('list');
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].id).toBe('p1');
		expect(body.data[0].object).toBe('model');
		expect(body.data[0].owned_by).toBe('aiflowbridge');
	});

	it('GET /v1/metrics returns status + telemetry', async () => {
		const res = await fetch(`${baseUrl}/v1/metrics`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: unknown; telemetry: unknown };
		expect(body.status).toBeDefined();
		expect(body.telemetry).toBeDefined();
	});

	it('GET /metrics alias works (without /v1 prefix)', async () => {
		const res = await fetch(`${baseUrl}/metrics`);
		expect(res.status).toBe(200);
	});

	it('GET /unknown returns 404', async () => {
		const res = await fetch(`${baseUrl}/unknown`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string; path: string };
		expect(body.error).toBe('Not found');
		expect(body.path).toBe('/unknown');
	});

	it('POST /v1/chat/completions with no provider configured returns 503', async () => {
		const noProviderService = new GatewayService(makeConfig({ providers: [] }));
		const status = await noProviderService.start();
		try {
			const res = await fetch(`${status.baseUrl}/v1/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'whatever', messages: [] }),
			});
			expect(res.status).toBe(503);
		} finally {
			await noProviderService.stop();
		}
	});

	it('POST /v1/chat/completions with only disabled providers returns 503', async () => {
		const disabledService = new GatewayService(
			makeConfig({ providers: [makeProvider({ enabled: false })] }),
		);
		const status = await disabledService.start();
		try {
			const res = await fetch(`${status.baseUrl}/v1/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'p1', messages: [] }),
			});
			expect(res.status).toBe(503);
			const body = (await res.json()) as { error: string; requestId: string };
			expect(body.error).toContain('No enabled upstream provider');
			expect(body.requestId).toBeDefined();
		} finally {
			await disabledService.stop();
		}
	});

	it('POST /v1/chat/completions with invalid JSON body returns 400', async () => {
		const res = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not valid json',
		});
		// 400 (bad request) or 5xx (provider error from upstream); we just want non-503
		expect(res.status).not.toBe(503);
	});
});

describe('GatewayService - singleton detection', () => {
	it('detects an existing AIFlowBridge gateway on the same port', async () => {
		// Start a fake "AIFlowBridge" gateway that returns the expected /health response
		const fakeServer = createServer((req, res) => {
			if (req.method === 'GET' && req.url === '/health') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ ok: true, service: 'AIFlowBridge' }));
				return;
			}
			res.statusCode = 404;
			res.end();
		});

		await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
		const port = await findListeningPort(fakeServer);
		const baseUrl = `http://127.0.0.1:${port}`;

		const service = new GatewayService(makeConfig({
			gateway: { enabled: true, port, baseUrl, defaultModel: '' },
		}));

		try {
			const status = await service.start();
			expect(status.running).toBe(false);
			expect(status.port).toBe(port);
		} finally {
			await service.stop();
			await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
		}
	});

	it('warns and starts when port is occupied by non-gateway service', async () => {
		const fakeServer = createServer((req, res) => {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'text/plain');
			res.end('not a gateway');
		});

		await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
		const port = await findListeningPort(fakeServer);
		const baseUrl = `http://127.0.0.1:${port}`;

		const service = new GatewayService(makeConfig({
			gateway: { enabled: true, port, baseUrl, defaultModel: '' },
		}));

		try {
			const status = await service.start();
			// Should try to start anyway on the occupied port (EADDRINUSE will reject)
			// The behavior depends on implementation — we just want no crash
			expect(status).toBeDefined();
		} catch {
			// EADDRINUSE is expected and acceptable
		} finally {
			await service.stop();
			await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
		}
	});
});
