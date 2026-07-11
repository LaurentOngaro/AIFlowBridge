/**
 * Unit tests for the version-aware cooperative restart flow in
 * src/aiflowbridge/gateway/server.ts.
 *
 * The tests use the real GatewayService on a random port and inject a
 * fake peer (an HTTP server) plus a stubbed user prompt.
 */

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

import { createServer } from 'node:http';
import { GatewayService, type UserPrompt } from '../src/aiflowbridge/gateway/server';
import type { AiFlowBridgeConfig, ProviderProfile } from '../src/aiflowbridge/types';

function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
	return {
		id: 'p1',
		label: 'Provider 1',
		kind: 'openai-compat',
		baseUrl: 'https://api.example.com/v1',
		model: 'model-1',
		apiKey: 'sk-test',
		enabled: true,...overrides,
	};
}

function makeConfig(port: number, baseUrl: string): AiFlowBridgeConfig {
	return {
		gateway: { enabled: true, port, baseUrl, defaultModel: '' },
		providers: [makeProvider()],
		telemetryEnabled: false,
		logRequests: false,
    captureSessionLog: false,
		visionProxy: { excludedVendors: [], copilotVisionModel: '' },
	};
}

function makeUserPrompt(choice: string | undefined = undefined): UserPrompt & {
	showInformationMessage: ReturnType<typeof vi.fn>;
} {
	return {
		showInformationMessage: vi.fn().mockResolvedValue(choice),
	};
}

interface FakePeer {
	server: ReturnType<typeof createServer>;
	port: number;
	baseUrl: string;
	shutdownCalls: number;
	closed: boolean;
}

async function startFakePeer(peerVersion: string, peerName = 'aiflowbridge-gateway'): Promise<FakePeer> {
	const peer: FakePeer = {
		server: undefined as unknown as ReturnType<typeof createServer>,
		port: 0,
		baseUrl: '',
		shutdownCalls: 0,
		closed: false,
	};
	const server = createServer((req, res) => {
		if (req.method === 'GET' && req.url === '/version') {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({
				name: peerName,
				version: peerVersion,
				pid: process.pid,
				startedAt: '2026-06-04T00:00:00.000Z',
			}));
			return;
		}
		if (req.method === 'POST' && req.url === '/shutdown') {
			peer.shutdownCalls += 1;
			res.statusCode = 200;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ ok: true }));
			// Close the server on the next tick to mimic real shutdown
			setTimeout(() => {
				peer.closed = true;
				server.close();
			}, 10);
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	peer.server = server;
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	peer.port = (server.address() as { port: number }).port;
	peer.baseUrl = `http://127.0.0.1:${peer.port}`;
	return peer;
}

async function stopFakePeer(peer: FakePeer): Promise<void> {
	if (!peer.closed) {
		await new Promise<void>((resolve) => peer.server.close(() => resolve()));
	}
}

describe('GatewayService - version-aware restart', () => {
	let peer: FakePeer | undefined;

	afterEach(async () => {
		if (peer) {
			await stopFakePeer(peer);
			peer = undefined;
		}
	});

	it('joins a same-version peer silently (no prompt)', async () => {
		peer = await startFakePeer('1.4.0');
		const prompt = makeUserPrompt();
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			const status = await service.start();
			expect(status.running).toBe(true);
			expect(status.port).toBe(peer.port);
			expect(prompt.showInformationMessage).not.toHaveBeenCalled();
			expect(peer.shutdownCalls).toBe(0);
		} finally {
			await service.stop();
		}
	});

	it('joins a newer peer silently (no prompt, no restart)', async () => {
		peer = await startFakePeer('2.0.0');
		const prompt = makeUserPrompt();
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			const status = await service.start();
			expect(status.running).toBe(true);
			expect(prompt.showInformationMessage).not.toHaveBeenCalled();
			expect(peer.shutdownCalls).toBe(0);
		} finally {
			await service.stop();
		}
	});

	it('prompts on older peer and joins when user chooses "Keep current version"', async () => {
		peer = await startFakePeer('1.3.0');
		const prompt = makeUserPrompt('Keep current version');
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			const status = await service.start();
			expect(status.running).toBe(true);
			expect(prompt.showInformationMessage).toHaveBeenCalledOnce();
			expect(peer.shutdownCalls).toBe(0);
		} finally {
			await service.stop();
		}
	});

	it('prompts on older peer and joins when user dismisses the prompt (no choice)', async () => {
		peer = await startFakePeer('1.3.0');
		const prompt = makeUserPrompt(undefined);
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			const status = await service.start();
			expect(status.running).toBe(true);
			expect(prompt.showInformationMessage).toHaveBeenCalledOnce();
			expect(peer.shutdownCalls).toBe(0);
		} finally {
			await service.stop();
		}
	});

	it('prompts on older peer and binds a fresh instance when user chooses "Restart"', async () => {
		peer = await startFakePeer('1.3.0');
		const prompt = makeUserPrompt(`Restart with v1.4.0`);
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			const status = await service.start();
			expect(status.running).toBe(true);
			expect(prompt.showInformationMessage).toHaveBeenCalledOnce();
			// Wait a beat for the fake peer's shutdown side-effect
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(peer.shutdownCalls).toBe(1);
		} finally {
			await service.stop();
		}
	});

	it('throws EPEERSTALLED with peer PID when restart succeeds in shutdown but port never frees', async () => {
		// A peer that responds to /shutdown with 200 but never actually
		// closes its server (simulates a hung peer or Windows TIME_WAIT).
		const state: FakePeer = {
			server: undefined as unknown as ReturnType<typeof createServer>,
			port: 0,
			baseUrl: '',
			shutdownCalls: 0,
			closed: false,
		};
		const server = createServer((req, res) => {
			if (req.method === 'GET' && req.url === '/version') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({
					name: 'aiflowbridge-gateway',
					version: '1.3.0',
					pid: 9999,
					startedAt: '2026-06-04T00:00:00.000Z',
				}));
				return;
			}
			if (req.method === 'POST' && req.url === '/shutdown') {
				state.shutdownCalls += 1;
				res.statusCode = 200;
				res.end(JSON.stringify({ ok: true }));
				// Do NOT close the server - simulate a hung peer
				return;
			}
			res.statusCode = 404;
			res.end();
		});
		state.server = server;
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		state.port = (server.address() as { port: number }).port;
		state.baseUrl = `http://127.0.0.1:${state.port}`;
		peer = state;

		const prompt = makeUserPrompt('Restart with v1.4.0');
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			await expect(service.start()).rejects.toMatchObject({
				code: 'EPEERSTALLED',
				peerPid: 9999,
			});
		} finally {
			await service.stop();
			// Manually close the peer server (simulate cleanup)
			await new Promise<void>((resolve) => peer!.server.close(() => resolve()));
		}
	});

	it('does not prompt when the port is occupied by a foreign service', async () => {
		// Foreign service: returns no /version at all
		const foreign = createServer((_req, res) => {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'text/plain');
			res.end('not a gateway');
		});
		await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', resolve));
		const port = (foreign.address() as { port: number }).port;
		const baseUrl = `http://127.0.0.1:${port}`;
		const prompt = makeUserPrompt();
		const service = new GatewayService(
			makeConfig(port, baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			// The port is taken by the foreign service, so listen() will fail.
			// We just need to confirm the prompt was never shown.
			await expect(service.start()).rejects.toBeDefined();
			expect(prompt.showInformationMessage).not.toHaveBeenCalled();
		} finally {
			await service.stop();
			await new Promise<void>((resolve) => foreign.close(() => resolve()));
		}
	});

	it('does not prompt when the peer is named something else (another app on 8787)', async () => {
		peer = await startFakePeer('1.0.0', 'some-other-app');
		const prompt = makeUserPrompt();
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		try {
			// The port is taken by another app, listen() will fail, no prompt.
			await expect(service.start()).rejects.toBeDefined();
			expect(prompt.showInformationMessage).not.toHaveBeenCalled();
		} finally {
			await service.stop();
		}
	});

	it('reports running=true while joined to a peer, and reverts to running=false after stop()', async () => {
		// Regression: the dashboard showed "Gateway stopped" while the log
		// said the gateway had "joined" an existing peer. The fix tracks
		// the joined state so the running flag is true for the lifetime of
		// the join, and goes back to false after stop().
		peer = await startFakePeer('1.4.0');
		const prompt = makeUserPrompt();
		const service = new GatewayService(
			makeConfig(peer.port, peer.baseUrl),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.0',
			prompt,
		);
		const status = await service.start();
		expect(status.running).toBe(true);
		expect(service.running).toBe(true);
		await service.stop();
		expect(service.running).toBe(false);
	});
});

describe('GatewayService - /version endpoint', () => {
	let service: GatewayService;
	let baseUrl: string;

	beforeEach(async () => {
		service = new GatewayService(
			makeConfig(0, 'http://127.0.0.1:0'),
			undefined,
			undefined,
			undefined,
			undefined,
			'1.4.2',
		);
		const status = await service.start();
		baseUrl = status.baseUrl;
	});

	afterEach(async () => {
		await service.stop();
	});

	it('GET /version returns the bundled version, name, pid and startedAt', async () => {
		const res = await fetch(`${baseUrl}/version`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			name: string;
			version: string;
			pid: number;
			startedAt: string;
			shutdownToken: string;
		};
		expect(body.name).toBe('aiflowbridge-gateway');
		expect(body.version).toBe('1.4.2');
		expect(body.pid).toBe(process.pid);
		expect(typeof body.startedAt).toBe('string');
		expect(body.startedAt.length).toBeGreaterThan(0);
		// Per-instance shutdown token: a UUID generated at construction.
		// Returned to peers so they can authenticate POST /shutdown.
		expect(typeof body.shutdownToken).toBe('string');
		expect(body.shutdownToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
	});
});

describe('GatewayService - /shutdown authentication', () => {
	let service: GatewayService;
	let baseUrl: string;
	let shutdownToken: string;

	beforeEach(async () => {
		service = new GatewayService(
			makeConfig(0, 'http://127.0.0.1:0'),
		);
		const status = await service.start();
		baseUrl = status.baseUrl;
		// Capture the per-instance token returned by /version so each
		// test exercises the correct credential.
		const res = await fetch(`${baseUrl}/version`);
		const body = (await res.json()) as { shutdownToken: string };
		shutdownToken = body.shutdownToken;
	});

	afterEach(async () => {
		await service.stop();
	});

	it('POST /shutdown without a token returns 403', async () => {
		const res = await fetch(`${baseUrl}/shutdown`, { method: 'POST' });
		expect(res.status).toBe(403);
	});

	it('POST /shutdown with a wrong token returns 403', async () => {
		const res = await fetch(`${baseUrl}/shutdown`, {
			method: 'POST',
			headers: { 'X-AIFlowBridge-Shutdown-Token': 'not-the-real-token' },
		});
		expect(res.status).toBe(403);
	});

	it('POST /shutdown with the correct token returns 200', async () => {
		const res = await fetch(`${baseUrl}/shutdown`, {
			method: 'POST',
			headers: { 'X-AIFlowBridge-Shutdown-Token': shutdownToken },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});

	it('two instances get distinct shutdown tokens', async () => {
		// Concurrent instances must not be able to shut each other down
		// by replaying a peer's token. The UUID guarantees uniqueness
		// across processes for the lifetime of the OS.
		const other = new GatewayService(makeConfig(0, 'http://127.0.0.1:0'));
		try {
			const otherStatus = await other.start();
			const otherRes = await fetch(`${otherStatus.baseUrl}/version`);
			const otherBody = (await otherRes.json()) as { shutdownToken: string };
			expect(otherBody.shutdownToken).not.toBe(shutdownToken);
			// Cross-instance: using instance A's token against instance B
			// must be rejected with 403.
			const crossRes = await fetch(`${otherStatus.baseUrl}/shutdown`, {
				method: 'POST',
				headers: { 'X-AIFlowBridge-Shutdown-Token': shutdownToken },
			});
			expect(crossRes.status).toBe(403);
		} finally {
			await other.stop();
		}
	});
});
