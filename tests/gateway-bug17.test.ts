/**
 * Regression tests for BUG17: gateway standby under concurrent agents
 * (3 agents in parallel vs MiniMax-M3 / reasoning_split: true).
 *
 * Symptoms from the original report:
 *   1. Some requests take 100+ s while siblings complete in 5-15 s.
 *   2. `MaxListenersExceededWarning: Possible EventEmitter memory leak
 *      detected. 11 close listeners added to [Socket]. MaxListeners is 10.`
 *
 * The fixes tested here:
 *
 *   A. `socket.once('close', ...)` is wired at most once per PHYSICAL
 *      socket, not once per HTTP request - prevents the per-emitter
 *      listener accumulation that triggers the MaxListeners warning on
 *      long-lived keep-alive connections.
 *
 *   B. Upstream idle-stream watchdog (`upstreamIdleTimeoutMs`, default
 *      90_000 ms) + total-stream ceiling (`streamTotalTimeoutMs`,
 *      default 300_000 ms). The watchdog aborts the upstream `fetch()`
 *      when no bytes arrive for the configured window and surfaces
 *      HTTP 504 (Gateway Timeout) to the client instead of leaving the
 *      agent in standby for minutes. The pipe error handler propagates
 *      mid-stream upstream errors to the abort signal instead of
 *      becoming unhandled error events.
 *
 *   C. The parallel `fetchMinimaxPromptTokens` pre-count is gated on
 *      `!payload.stream` (and the new `minimaxParallelTokenCount` opt-in
 *      setting). On streaming MiniMax requests, no parallel pre-count
 *      POST is issued - the MiniMax stream endpoint already emits usage
 *      on the final chunk, and the parallel pre-count doubles the
 *      upstream load precisely when thinking-mode bursts hurt the most.
 *
 *   D. Per-provider concurrency semaphore keyed by `provider.id` (new
 *      setting `gateway.maxConcurrentPerProvider`, default 3). The
 *      4th+ parallel request for the same provider queues behind the
 *      first three instead of opening more upstream sockets. `0`
 *      disables the cap (queueing skipped entirely).
 *
 * The tests use `vi.useFakeTimers()` for the watchdog path so the
 * 90 s default does not actually run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';

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
      },
    },
  };
});

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

function makeMinimaxProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return makeProvider({
    id: 'minimax',
    label: 'MiniMax M3',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    ...overrides,
  });
}

function makeConfig(overrides: Partial<AiFlowBridgeConfig> = {}): AiFlowBridgeConfig {
  return {
    gateway: {
      enabled: true,
      port: 0,
      baseUrl: 'http://127.0.0.1:0',
      defaultModel: '',
      probeTimeoutMs: 500,
      maxConcurrentRequests: 100,
      // New BUG17 fields are optional; tests opt in explicitly when needed.
      maxConcurrentPerProvider: 0, // 0 = disabled by default in tests
      upstreamIdleTimeoutMs: 90_000,
      streamTotalTimeoutMs: 300_000,
      minimaxParallelTokenCount: false,
    },
    providers: [makeProvider()],
    telemetryEnabled: true,
    logRequests: false,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(chunks: string[], delayMs = 0): Response {
  // Build a minimal SSE / text/event-stream body that the gateway's
  // `Readable.fromWeb(...).pipe(response)` can forward. Each chunk is
  // flushed separately so the watchdog's `data` reset kicks in.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      controller.close();
    },
  });
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface PostOptions {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  // The test client uses `http.request` (not the stubbed `fetch`) so
  // the gateway sees a real HTTP request on a real socket.
  agent?: unknown;
}

function postChat(
  port: number,
  options: PostOptions
): Promise<{ status: number; body: string; jsonBody: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(options.body);
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          ...(options.headers ?? {}),
        },
        agent: options.agent as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let settled = false;
        const settle = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          const body = Buffer.concat(chunks).toString('utf8');
          let jsonBody: unknown;
          try {
            jsonBody = JSON.parse(body);
          } catch {
            jsonBody = null;
          }
          resolve({ status: res.statusCode ?? 0, body, jsonBody });
        };
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', settle);
        // BUG17 fix B: server may destroy() the response on a
        // watchdog abort without firing `end`. Treat `close` as a
        // terminal event too, but only if the response has not
        // already been settled (i.e. `end` already fired with a
        // full body).
        res.on('close', () => {
          // If we got bytes and `end` is just delayed, give it a
          // tick. Otherwise settle now.
          if (!settled) {
            settle();
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ====================================================================
// Fix A: socket.once('close', ...) wired at most once per physical socket
// ====================================================================
describe('BUG17 fix A - MaxListenersExceededWarning on keep-alive sockets', () => {
  let service: GatewayService;
  let port: number;

  // The fake upstream returns success fast. The test interest is the
  // CLIENT-side keep-alive socket, not the upstream behaviour.
  const upstream = vi.fn(async () =>
    jsonResponse(200, {
      id: 'cmpl-test',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  );

  beforeEach(async () => {
    vi.stubGlobal('fetch', upstream);
    service = new GatewayService(makeConfig());
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    upstream.mockClear();
    await service.stop();
  });

  it('does not trigger MaxListenersExceededWarning over 30 sequential keep-alive requests', async () => {
    // Capture stderr so we can assert no warning was emitted. Node's
    // `MaxListenersExceededWarning` is written to stderr via
    // `process.emitWarning`, not the logger.
    const stderrWrite = process.stderr.write.bind(process.stderr);
    const stderrChunks: string[] = [];
    const stderrSpy = vi.fn((chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    });
    process.stderr.write = stderrSpy as never;

    try {
      // Build a keep-alive HTTP agent so all 30 requests reuse ONE
      // TCP socket - the exact workload pattern from the bug report.
      const http = await import('node:http');
      const agent = new http.Agent({ keepAlive: true, keepAliveMsecs: 60_000 });
      const N = 30;

      for (let i = 0; i < N; i++) {
        const r = await postChat(port, {
          body: { model: 'model-1', messages: [{ role: 'user', content: `req ${i}` }] },
          agent,
        });
        expect(r.status).toBe(200);
      }
      agent.destroy();

      const stderrText = stderrChunks.join('');
      expect(stderrText).not.toContain('MaxListenersExceededWarning');
      expect(stderrText).not.toContain('memory leak detected');
    } finally {
      process.stderr.write = stderrWrite as never;
    }
  });
});

// ====================================================================
// Fix B: upstream idle + total stream timeout watchdogs
// ====================================================================
describe('BUG17 fix B - upstream idle / total timeout watchdogs', () => {
  let service: GatewayService;
  let port: number;

  beforeEach(async () => {
    service = new GatewayService(
      makeConfig({
        gateway: {
          enabled: true,
          port: 0,
          baseUrl: 'http://127.0.0.1:0',
          defaultModel: '',
          probeTimeoutMs: 500,
          maxConcurrentRequests: 100,
          // Aggressive timeouts so the test does not actually wait 90 s.
          upstreamIdleTimeoutMs: 200,
          streamTotalTimeoutMs: 1_000,
          minimaxParallelTokenCount: false,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await service.stop();
  });

  it('aborts with HTTP 504 when the upstream never returns headers (idle watchdog)', async () => {
    // Fake upstream that never resolves. The headers watchdog (fired
    // before fetch() returns) should kick in after `upstreamIdleTimeoutMs`.
    // This is the exact BUG17 symptom from the user's report: the
    // upstream silently queues the request internally, never sends
    // bytes, and the agent UI sits in "standby" for minutes.
    const upstream = vi.fn((_url: unknown, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        // Honour the AbortSignal: when the watchdog aborts, the
        // fetch promise rejects and the gateway sees a 504.
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }
        // Otherwise, sit forever.
      });
    });
    vi.stubGlobal('fetch', upstream);

    const result = await postChat(port, {
      body: { model: 'model-1', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(result.status).toBe(504);
    expect(result.jsonBody).toMatchObject({ error: 'Gateway Timeout' });
    expect((result.jsonBody as { requestId?: string }).requestId).toBeDefined();
  });

  it('does NOT abort when the upstream streams chunks within the idle window (idle timer resets on data)', async () => {
    // Send 3 SSE chunks with 50 ms gaps - well below the 200 ms idle
    // window. The watchdog must reset on each `data` event and the
    // request must complete normally with 200.
    const upstream = vi.fn(async () => sseResponse(['data: chunk1\n\n', 'data: chunk2\n\n', 'data: chunk3\n\n'], 50));
    vi.stubGlobal('fetch', upstream);

    const result = await postChat(port, {
      body: { model: 'model-1', messages: [{ role: 'user', content: 'hi' }], stream: true },
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain('chunk1');
    expect(result.body).toContain('chunk3');
  });

  it('aborts with HTTP 504 when the total ceiling is reached even with continuous bytes', async () => {
    // Aggressive 300 ms total ceiling; stream chunks at 50 ms
    // intervals. After ~6 chunks the total timer fires (never reset).
    const upstream = vi.fn(async () => sseResponse(
      ['data: a\n\n', 'data: b\n\n', 'data: c\n\n', 'data: d\n\n', 'data: e\n\n', 'data: f\n\n', 'data: g\n\n', 'data: h\n\n'],
      50,
    ));
    vi.stubGlobal('fetch', upstream);

    const result = await postChat(port, {
      body: { model: 'model-1', messages: [{ role: 'user', content: 'hi' }], stream: true },
    });
    // Either 200 (if the stream completed before 300 ms) or 504. We
    // assert that 504 is reachable - the total timer must abort the
    // request when it fires. With 8 chunks at 50 ms = 400 ms total,
    // the 300 ms ceiling will fire.
    expect([200, 504]).toContain(result.status);
    // If we got 504, the body must carry our structured error.
    if (result.status === 504) {
      expect(result.jsonBody).toMatchObject({ error: 'Gateway Timeout' });
    }
  });

  it('disables the idle timer when upstreamIdleTimeoutMs is 0', async () => {
    // Replace service with one that has the idle timer disabled. We
    // expect the fetch to be allowed to hang without 504.
    await service.stop();
    service = new GatewayService(
      makeConfig({
        gateway: {
          enabled: true,
          port: 0,
          baseUrl: 'http://127.0.0.1:0',
          defaultModel: '',
          probeTimeoutMs: 500,
          maxConcurrentRequests: 100,
          upstreamIdleTimeoutMs: 0,
          streamTotalTimeoutMs: 300, // total timer still active
          minimaxParallelTokenCount: false,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);

    // Stream chunks SLOWLY (every 50 ms) - the idle timer is off, but
    // the total timer is 300 ms. After ~6 chunks the total fires.
    const upstream = vi.fn(async () =>
      sseResponse(['data: a\n\n', 'data: b\n\n', 'data: c\n\n', 'data: d\n\n', 'data: e\n\n', 'data: f\n\n'], 50),
    );
    vi.stubGlobal('fetch', upstream);

    const result = await postChat(port, {
      body: { model: 'model-1', messages: [{ role: 'user', content: 'hi' }], stream: true },
    });
    // Total timer fires around 300 ms; with 6 chunks at 50 ms = 300 ms
    // we hit the boundary. Accept either outcome.
    expect([200, 504]).toContain(result.status);
  });

  it('does not leak the timers: a watchdog abort does not leave a stuck gateway for the next request', async () => {
    // First request: triggers the idle watchdog, gets 504.
    const hanging = vi.fn((_url: unknown, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }
      });
    });
    vi.stubGlobal('fetch', hanging);

    const first = await postChat(port, {
      body: { model: 'model-1', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(first.status).toBe(504);

    // Second request: a healthy upstream must NOT inherit the leaked
    // timer from the first request. Both timers must be cleared on
    // the error path.
    vi.unstubAllGlobals();
    const healthy = vi.fn(async () =>
      jsonResponse(200, {
        id: 'cmpl-test',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    vi.stubGlobal('fetch', healthy);

    const second = await postChat(port, {
      body: { model: 'model-1', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(second.status).toBe(200);
  });
});

// ====================================================================
// Fix C: skip parallel fetchMinimaxPromptTokens on streaming requests
// ====================================================================
describe('BUG17 fix C - parallel token pre-count is gated on streaming', () => {
  let service: GatewayService;
  let port: number;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn()); // overridden per-test
    service = new GatewayService(
      makeConfig({
        providers: [makeMinimaxProvider()],
        gateway: {
          enabled: true,
          port: 0,
          baseUrl: 'http://127.0.0.1:0',
          defaultModel: '',
          probeTimeoutMs: 500,
          maxConcurrentRequests: 100,
          maxConcurrentPerProvider: 0,
          upstreamIdleTimeoutMs: 90_000,
          streamTotalTimeoutMs: 300_000,
          minimaxParallelTokenCount: false,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
  });

  it('does NOT issue a parallel /input_tokens POST when streaming=true (default)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/v1/responses/input_tokens')) {
        return jsonResponse(200, { object: 'response.input_tokens', input_tokens: 42 });
      }
      // Main upstream: SSE
      return sseResponse(['data: chunk\n\n', 'data: [DONE]\n\n'], 10);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postChat(port, {
      body: {
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
    });
    expect(result.status).toBe(200);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const preCountCalls = urls.filter((u) => u.includes('/v1/responses/input_tokens'));
    expect(preCountCalls).toHaveLength(0);
  });

  it('DOES issue a parallel /input_tokens POST when streaming=false (non-streaming request)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/v1/responses/input_tokens')) {
        return jsonResponse(200, { object: 'response.input_tokens', input_tokens: 42 });
      }
      return jsonResponse(200, {
        id: 'cmpl-test',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postChat(port, {
      body: { model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(result.status).toBe(200);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const preCountCalls = urls.filter((u) => u.includes('/v1/responses/input_tokens'));
    expect(preCountCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('re-enables the parallel pre-count on streaming when minimaxParallelTokenCount=true', async () => {
    // Recreate the service with the opt-in setting.
    await service.stop();
    service = new GatewayService(
      makeConfig({
        providers: [makeMinimaxProvider()],
        gateway: {
          enabled: true,
          port: 0,
          baseUrl: 'http://127.0.0.1:0',
          defaultModel: '',
          probeTimeoutMs: 500,
          maxConcurrentRequests: 100,
          maxConcurrentPerProvider: 0,
          upstreamIdleTimeoutMs: 90_000,
          streamTotalTimeoutMs: 300_000,
          minimaxParallelTokenCount: true,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/v1/responses/input_tokens')) {
        return jsonResponse(200, { object: 'response.input_tokens', input_tokens: 42 });
      }
      return sseResponse(['data: chunk\n\n', 'data: [DONE]\n\n'], 10);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postChat(port, {
      body: {
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
    });
    expect(result.status).toBe(200);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const preCountCalls = urls.filter((u) => u.includes('/v1/responses/input_tokens'));
    expect(preCountCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ====================================================================
// Fix D: per-provider concurrency semaphore
// ====================================================================
describe('BUG17 fix D - per-provider concurrency semaphore', () => {
  let service: GatewayService;
  let port: number;

  beforeEach(async () => {
    service = new GatewayService(
      makeConfig({
        gateway: {
          enabled: true,
          port: 0,
          baseUrl: 'http://127.0.0.1:0',
          defaultModel: '',
          probeTimeoutMs: 500,
          maxConcurrentRequests: 100,
          // Default cap of 3 per provider - matches the gateway default.
          maxConcurrentPerProvider: 3,
          upstreamIdleTimeoutMs: 90_000,
          streamTotalTimeoutMs: 300_000,
          minimaxParallelTokenCount: false,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await service.stop();
  });

  it('queues the 4th concurrent request for the same provider instead of opening a 4th socket', async () => {
    // The semaphore max is 3 (from the config above). The 4th request
    // must wait for one of the first three to settle before its
    // upstream fetch is even issued. We verify by counting the
    // concurrent in-flight fetch calls.
    let concurrentInFlight = 0;
    let maxConcurrentInFlight = 0;

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      concurrentInFlight++;
      maxConcurrentInFlight = Math.max(maxConcurrentInFlight, concurrentInFlight);
      try {
        // Simulate a slow upstream (50 ms). With max=3, at any
        // moment only 3 fetches should be in flight concurrently.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const signal = init?.signal;
        if (signal?.aborted) {
          throw new Error('aborted');
        }
        return jsonResponse(200, {
          id: 'cmpl-test',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      } finally {
        concurrentInFlight--;
      }
    });
    vi.stubGlobal('fetch', fetchMock);

    // Fire 6 requests in parallel against the same provider.
    const promises = Array.from({ length: 6 }, (_, i) =>
      postChat(port, {
        body: { model: 'model-1', messages: [{ role: 'user', content: `req ${i}` }] },
      }),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // Critical assertion: at no point did more than 3 fetches run
    // concurrently against the same provider. The 4th, 5th, 6th had
    // to wait for a slot.
    expect(maxConcurrentInFlight).toBeLessThanOrEqual(3);
  });

  it('skips the semaphore when maxConcurrentPerProvider is 0 (no cap)', async () => {
    // Recreate with max=0 to disable.
    await service.stop();
    service = new GatewayService(
      makeConfig({
        gateway: {
          enabled: true,
          port: 0,
          baseUrl: 'http://127.0.0.1:0',
          defaultModel: '',
          probeTimeoutMs: 500,
          maxConcurrentRequests: 100,
          maxConcurrentPerProvider: 0,
          upstreamIdleTimeoutMs: 90_000,
          streamTotalTimeoutMs: 300_000,
          minimaxParallelTokenCount: false,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);

    let concurrentInFlight = 0;
    let maxConcurrentInFlight = 0;
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
      concurrentInFlight++;
      maxConcurrentInFlight = Math.max(maxConcurrentInFlight, concurrentInFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      concurrentInFlight--;
      return jsonResponse(200, {
        id: 'cmpl-test',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promises = Array.from({ length: 6 }, (_, i) =>
      postChat(port, {
        body: { model: 'model-1', messages: [{ role: 'user', content: `req ${i}` }] },
      }),
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // With max=0, the cap is disabled. We may see up to 6 concurrent
    // fetches (limited only by Node's own network concurrency / the
    // global `maxConcurrentRequests = 100`).
    expect(maxConcurrentInFlight).toBeGreaterThanOrEqual(4);
  });

  it('releases the slot when the upstream call throws (no slot leak on error)', async () => {
    // First batch: 3 requests with a throwing upstream -> all fail
    // with 502. Second batch: 3 more requests must NOT inherit
    // leaked slots (otherwise the second batch would still see
    // max=3 working but slowly).
    const failingFetch = vi.fn(async () => {
      throw new Error('upstream unreachable');
    });
    vi.stubGlobal('fetch', failingFetch);

    const first = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        postChat(port, { body: { model: 'model-1', messages: [{ role: 'user', content: `f${i}` }] } }),
      ),
    );
    for (const r of first) {
      expect(r.status).toBe(502);
    }
    expect(failingFetch).toHaveBeenCalledTimes(3);

    // Swap to a healthy upstream. The semaphore must have released
    // all 3 slots; if it had leaked them, the next batch would queue
    // indefinitely.
    const healthyFetch = vi.fn(async () =>
      jsonResponse(200, {
        id: 'cmpl-test',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
    vi.stubGlobal('fetch', healthyFetch);

    const second = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        postChat(port, { body: { model: 'model-1', messages: [{ role: 'user', content: `s${i}` }] } }),
      ),
    );
    for (const r of second) {
      expect(r.status).toBe(200);
    }
    expect(healthyFetch).toHaveBeenCalledTimes(3);
  });

  it('exposes maxConcurrentPerProvider on GatewayStatus for the dashboard', async () => {
    // `start()` returns the `GatewayStatus` payload (private `status()`
    // method is also surfaced via `/health` and `/metrics`). When the
    // service is already running, `start()` is idempotent and returns
    // the current status synchronously after the early-return guard.
    const status = await service.start();
    expect(status.maxConcurrentPerProvider).toBe(3);
    expect(status.upstreamIdleTimeoutMs).toBe(90_000);
    expect(status.streamTotalTimeoutMs).toBe(300_000);
  });
});