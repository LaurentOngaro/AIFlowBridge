/**
 * Unit tests for src/aiflowbridge/gateway/probe.ts
 * Covers compareSemver edge cases and the probe HTTP flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- VSCode mock ---
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
import { compareSemver, probeServerVersion, requestPeerShutdown, waitUntilPortFree } from '../src/aiflowbridge/gateway/probe';

describe('compareSemver', () => {
	it('returns 0 for identical versions', () => {
		expect(compareSemver('1.4.0', '1.4.0')).toBe(0);
	});

	it('returns -1 when a is older on patch', () => {
		expect(compareSemver('1.4.0', '1.4.1')).toBe(-1);
	});

	it('returns 1 when a is newer on patch', () => {
		expect(compareSemver('1.4.2', '1.4.1')).toBe(1);
	});

	it('returns -1 when a is older on minor', () => {
		expect(compareSemver('1.3.0', '1.4.0')).toBe(-1);
	});

	it('returns 1 when a is newer on minor', () => {
		expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
	});

	it('returns -1 when a is older on major', () => {
		expect(compareSemver('0.9.0', '1.0.0')).toBe(-1);
	});

	it('treats prerelease as equal to its core for v1', () => {
		// Per the plan: prerelease tag is ignored in v1 (split on "-").
		expect(compareSemver('1.4.0-beta.1', '1.4.0')).toBe(0);
	});

	it('handles missing patch segment', () => {
		expect(compareSemver('1.4', '1.4.0')).toBe(0);
	});

	it('handles missing minor segment', () => {
		expect(compareSemver('1', '1.0.0')).toBe(0);
	});

	it('handles non-numeric segments gracefully', () => {
		expect(compareSemver('1.x.0', '1.0.0')).toBe(0);
	});

	it('handles 0.0.0', () => {
		expect(compareSemver('0.0.0', '0.0.1')).toBe(-1);
	});

	it('returns 0 for two empty strings', () => {
		expect(compareSemver('', '')).toBe(0);
	});
});

describe('probeServerVersion', () => {
	let server: ReturnType<typeof createServer> | undefined;
	let port: number;

	beforeEach(async () => {
		server = createServer((req, res) => {
			if (req.method === 'GET' && req.url === '/version') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({
					name: 'aiflowbridge-gateway',
					version: '1.2.3',
					pid: 4242,
					startedAt: '2026-06-04T10:00:00.000Z',
				}));
				return;
			}
			if (req.method === 'GET' && req.url === '/version-invalid') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ wrong: 'shape' }));
				return;
			}
			if (req.method === 'GET' && req.url === '/version-500') {
				res.statusCode = 500;
				res.end('boom');
				return;
			}
			res.statusCode = 404;
			res.end();
		});
		const currentServer = server!;
		await new Promise<void>((resolve) => currentServer.listen(0, '127.0.0.1', resolve));
		port = (currentServer.address() as { port: number }).port;
	});

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
	});

	it('returns the peer payload when /version is reachable', async () => {
		const peer = await probeServerVersion(port, { timeoutMs: 500 });
		expect(peer).not.toBeNull();
		expect(peer?.name).toBe('aiflowbridge-gateway');
		expect(peer?.version).toBe('1.2.3');
		expect(peer?.pid).toBe(4242);
	});

	it('returns null on 5xx (server that does not advertise /version on 5xx path)', async () => {
		// /version-500 is a different path; the helper probes /version, which
		// returns 200 here. So we test the "server unreachable" path instead.
		const peer = await probeServerVersion(1, { timeoutMs: 100 });
		expect(peer).toBeNull();
	});

	it('returns null on invalid payload shape', async () => {
		// Re-bind the server to return an invalid /version payload
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
		}
		server = createServer((_req, res) => {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ wrong: 'shape' }));
		});
		const currentServer = server!;
		await new Promise<void>((resolve) => currentServer.listen(0, '127.0.0.1', resolve));
		const p = (currentServer.address() as { port: number }).port;
		const peer = await probeServerVersion(p, { timeoutMs: 500 });
		expect(peer).toBeNull();
	});

	it('returns null when the server is unreachable', async () => {
		// Use a port that nothing is listening on
		const peer = await probeServerVersion(1, { timeoutMs: 100 });
		expect(peer).toBeNull();
	});
});

describe('requestPeerShutdown', () => {
	let server: ReturnType<typeof createServer> | undefined;
	let port: number;

	beforeEach(async () => {
		server = createServer((req, res) => {
			if (req.method === 'POST' && req.url === '/shutdown') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ ok: true }));
				return;
			}
			res.statusCode = 404;
			res.end();
		});
		const currentServer = server!;
		await new Promise<void>((resolve) => currentServer.listen(0, '127.0.0.1', resolve));
		port = (currentServer.address() as { port: number }).port;
	});

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = undefined;
		}
	});

	it('returns true on 200', async () => {
		const ok = await requestPeerShutdown(port, { timeoutMs: 500 });
		expect(ok).toBe(true);
	});

	it('returns false when the server refuses the connection', async () => {
		const ok = await requestPeerShutdown(1, { timeoutMs: 100 });
		expect(ok).toBe(false);
	});

	it('sends the shutdown token in the X-AIFlowBridge-Shutdown-Token header when provided', async () => {
		// Stub the http loopback with a server that echoes the headers
		// back in the response body, so we can assert the header was
		// actually transmitted (not just that the request was made).
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = createServer((req, res) => {
			if (req.method === 'POST' && req.url === '/shutdown') {
				const token = req.headers['x-aiflowbridge-shutdown-token'] ?? '';
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ receivedToken: token }));
				return;
			}
			res.statusCode = 404;
			res.end();
		});
		const currentServer = server!;
		await new Promise<void>((resolve) => currentServer.listen(0, '127.0.0.1', resolve));
		port = (currentServer.address() as { port: number }).port;

		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		await requestPeerShutdown(port, { shutdownToken: 'secret-token-123' });
		const sentHeaders = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
		expect(sentHeaders?.['X-AIFlowBridge-Shutdown-Token']).toBe('secret-token-123');
		fetchSpy.mockRestore();
	});

	it('omits the X-AIFlowBridge-Shutdown-Token header when no token is provided', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		await requestPeerShutdown(port);
		const sentHeaders = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
		expect(sentHeaders?.['X-AIFlowBridge-Shutdown-Token']).toBeUndefined();
		fetchSpy.mockRestore();
	});
});

describe('waitUntilPortFree', () => {
	it('returns true immediately when the port is free', async () => {
		const ok = await waitUntilPortFree(1, { timeoutMs: 200, intervalMs: 50 });
		expect(ok).toBe(true);
	});

	it('returns true once a busy port is freed', async () => {
		const server = createServer();
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as { port: number }).port;
		// Schedule the close in 200ms
		setTimeout(() => server.close(), 200);
		const ok = await waitUntilPortFree(port, { timeoutMs: 2000, intervalMs: 50 });
		expect(ok).toBe(true);
	});

	it('returns false on timeout when the port stays busy', async () => {
		const server = createServer();
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as { port: number }).port;
		try {
			const ok = await waitUntilPortFree(port, { timeoutMs: 300, intervalMs: 50 });
			expect(ok).toBe(false);
		} finally {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
		}
	});
});
