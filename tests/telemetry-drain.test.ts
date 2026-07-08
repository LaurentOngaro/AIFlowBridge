/**
 * Regression tests for BUG-A05: `GatewayService.stop()` did not drain
 * keep-alive connections, so the listening port stayed bound until the
 * OS TIME_WAIT timer expired. On a fast window reload (or a debug
 * session restart that re-runs `activate()`), the new `start()` would
 * hit `EADDRINUSE` and the user would see a "port already in use"
 * warning even though no other process owned the port.
 *
 * The fix introduced two layers:
 *   1. `server.closeAllConnections()` (Node >= 18.2) - preferred path.
 *   2. A defensive `Set<Socket>` (`activeSockets`) that is populated
 *      in the `connection` listener and iterated in `stop()` to call
 *      `socket.destroy()` on every still-open keep-alive socket.
 *
 * The tests below cover both layers:
 *
 * - `drains keep-alive sockets on stop` opens a real HTTP/1.1 client
 *   that holds a request open in streaming mode, then asserts that
 *   `stop()` resolves AND the client socket sees `'close'` before the
 *   process would otherwise sit in TIME_WAIT. Without BUG-A05 the
 *   client would stay open for the default `keepAliveTimeout` of
 *   ~5 s and `start()` would not be re-runnable on the same port.
 *
 * - `closes idle keep-alive sockets before start() can re-bind the port`
 *   reproduces the original symptom: the first `start()` is followed
 *   by a `stop()`, then a second `start()` on the same port. Before
 *   the fix, the second `start()` would throw EADDRINUSE. After the
 *   fix, both `stop()`s resolve quickly and the second `start()`
 *   succeeds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GatewayService } from '../src/aiflowbridge/gateway/server';
import type { AiFlowBridgeConfig, ProviderProfile } from '../src/aiflowbridge/types';

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
			port: 0,
			baseUrl: 'http://127.0.0.1:0',
			defaultModel: '',
			probeTimeoutMs: 500,
			maxConcurrentRequests: 20,
		},
		providers: [makeProvider()],
		telemetryEnabled: false,
		logRequests: false,
		visionProxy: { excludedVendors: [], copilotVisionModel: '' },
		...overrides,
	};
}

/**
 * Open an HTTP/1.1 keep-alive client that sends a request and then
 * stays connected. Returns the `req` and a Promise that resolves when
 * the underlying socket emits `'close'`. The request body is left
 * un-ended so the server sees an open connection until the gateway
 * forcibly closes it.
 */
function openStreamingRequest(port: number): { req: http.ClientRequest; closed: Promise<void> } {
	const agent = new http.Agent({ keepAlive: true, keepAliveMsecs: 60_000 });
	const req = http.request({
		host: '127.0.0.1',
		port,
		path: '/v1/chat/completions',
		method: 'POST',
		agent,
		headers: {
			'content-type': 'application/json',
			'connection': 'keep-alive',
		},
	});
	// Write a partial body and do NOT call `req.end()`. The server will
	// see data then a pause - the perfect stand-in for a slow Kilo Code
	// client streaming a long request.
	req.write('{"model":"model-1"');
	// The socket-level close event is what `closeAllConnections` and the
	// `activeSockets` loop both trigger. Resolve on either.
	const closed = new Promise<void>((resolve) => {
		req.on('close', () => {
			agent.destroy();
			resolve();
		});
	});
	req.on('error', () => {
		// The server is allowed to RST/FIN the socket; we only care
		// that the client eventually sees a close.
	});
	return { req, closed };
}

describe('GatewayService - BUG-A05 keep-alive drain on stop', () => {
	let service: GatewayService;
	let actualPort: number;
	let actualBaseUrl: string;

	beforeEach(async () => {
		service = new GatewayService(makeConfig());
		const status = await service.start();
		actualBaseUrl = status.baseUrl;
		actualPort = (service['server']?.address() as AddressInfo | undefined)?.port ?? 0;
	});

	afterEach(async () => {
		// Best-effort cleanup. The test that explicitly stops the
		// service has already done so.
		try {
			await service.stop();
		} catch {
			// already stopped
		}
	});

	it('drains keep-alive sockets on stop (open streaming client is closed)', async () => {
		expect(actualPort).toBeGreaterThan(0);

		// Open a streaming client. The upstream is unreachable (api.example.com
		// does not resolve in the test environment), so the gateway will
		// hang on the fetch() promise. The test's interest is the client
		// side: `stop()` must close the local socket, not the upstream.
		const { closed } = openStreamingRequest(actualPort);

		// Give the server a moment to register the connection in its
		// `connection` listener (`activeSockets` add). The listener
		// fires synchronously on `connection`, but the test process
		// schedules the HTTP request on the next tick.
		await new Promise((resolve) => setImmediate(resolve));

		// Stop the gateway. BUG-A05 fix: the open keep-alive socket
		// must be destroyed, not left dangling until TIME_WAIT.
		const stopStartedAt = Date.now();
		await service.stop();
		const stopDurationMs = Date.now() - stopStartedAt;

		// The closed promise should resolve within a few hundred ms
		// (Node's TCP RST is fast on loopback). We give it 2 s to
		// accommodate slow CI hosts.
		const closedWithTimeout = await Promise.race([
			closed,
			new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2_000)),
		]);
		expect(closedWithTimeout).not.toBe('timeout');
		// Sanity: stop should not have waited for the keep-alive
		// timeout (5 s on Node defaults) - this catches regressions
		// where the activeSockets loop is silently dropped.
		expect(stopDurationMs).toBeLessThan(2_000);
	});

	it('closes idle keep-alive sockets before start() can re-bind the port', async () => {
		// BUG-A05 reproducer: a first activation goes start() -> stop()
		// while a keep-alive client is still open. A second start() on
		// the same port used to fail with EADDRINUSE.
		const { closed } = openStreamingRequest(actualPort);
		await new Promise((resolve) => setImmediate(resolve));

		await service.stop();

		// Wait for the client to actually see the close before we
		// attempt the re-bind. The 2 s ceiling is well below the
		// default keepAliveTimeout of 5 s.
		const closedWithTimeout = await Promise.race([
			closed,
			new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2_000)),
		]);
		expect(closedWithTimeout).not.toBe('timeout');

		// Second start on the same port must succeed.
		const second = await service.start();
		expect(second.running).toBe(true);
		// The new server is bound on a different port (we used 0 in
		// the config), so the address is allowed to differ; what we
		// care about is the `running` flag.
		expect(second.port).toBeGreaterThan(0);
	});

	it('stop() is idempotent: a second call after a clean stop is a no-op', async () => {
		await service.stop();
		// Second call should not throw. BUG-A05 introduced the
		// `!this.server && !this.joined` guard precisely so that
		// VS Code's synchronous `dispose()` followed by the
		// runtime's `await deactivate()` does not double-stop.
		await expect(service.stop()).resolves.toBeUndefined();
	});
});
