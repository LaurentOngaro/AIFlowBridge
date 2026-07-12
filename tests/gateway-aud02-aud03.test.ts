/**
 * regression tests:
 *
 *   - SSE event stream safety:
 *     - maxConnections cap refuses N+1th connection with HTTP 429.
 *     - maxLifetimeMs closes the connection after the wall-clock budget.
 *     - includeSummariesInEvents default (false) strips
 *       promptSummary / responseSummary from request.recorded events.
 *
 *   - per-provider semaphore AbortSignal support:
 *     - Acquire is synchronous when slots are free.
 *     - Acquire queues FIFO when the cap is reached.
 *     - AbortSignal rejects the queued waiter with AbortError and
 *       removes it from the queue (so the next waiter is the one
 *       that gets the slot when one frees).
 *     - Aborting before the first acquire rejects synchronously.
 *     - maxConcurrentPerProvider = 0 is the disabled path (no
 *       semaphore side-effects).
 *     - releaseProviderSlot pops the FIFO and bumps active.
 *     - releaseProviderSlot with empty waiters decrements and
 *       cleans up the map entry when active reaches zero.
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
        })),
      },
    },
  };
});

import { AbortError, GatewayService, isAbortError } from '../src/aiflowbridge/gateway/server';

// ---------------------------------------------------------------------------
//  per-provider semaphore AbortSignal
// ---------------------------------------------------------------------------

describe('provider semaphore AbortSignal support', () => {
  let gateway: GatewayService;

  beforeEach(async () => {
    const started = await startGateway({
      port: 0,
      maxConcurrentPerProvider: 2,
    });
    gateway = started.gateway;
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('resolves synchronously when a slot is free', async () => {
    const start = Date.now();
    await (
      gateway as unknown as {
        acquireProviderSlot: (id: string, max: number, signal?: AbortSignal) => Promise<void>;
      }
    ).acquireProviderSlot('p1', 2);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('FIFO ordering: 3rd acquirer waits behind the first 2', async () => {
    const sem = gateway as unknown as {
      acquireProviderSlot: (id: string, max: number, signal?: AbortSignal) => Promise<void>;
      releaseProviderSlot: (id: string) => void;
    };
    await sem.acquireProviderSlot('p1', 2);
    await sem.acquireProviderSlot('p1', 2);
    let thirdResolved = false;
    const third = sem.acquireProviderSlot('p1', 2).then(() => {
      thirdResolved = true;
    });
    // Give the microtask queue a chance.
    await new Promise((r) => setImmediate(r));
    expect(thirdResolved).toBe(false);
    // Release one slot -> third should now resolve.
    sem.releaseProviderSlot('p1');
    await third;
    expect(thirdResolved).toBe(true);
    // Cleanup.
    sem.releaseProviderSlot('p1');
    sem.releaseProviderSlot('p1');
  });

  it('AbortSignal rejects a queued waiter with AbortError and removes it from the FIFO', async () => {
    const sem = gateway as unknown as {
      acquireProviderSlot: (id: string, max: number, signal?: AbortSignal) => Promise<void>;
      releaseProviderSlot: (id: string) => void;
      providerSemaphores: Map<string, { active: number; waiters: unknown[] }>;
    };
    // Use max=2 so the first two acquires resolve immediately
    // (active=2). The third (with abort signal) queues. After
    // the third aborts, a fourth (`next`) takes its queue slot
    // and waits for a release.
    await sem.acquireProviderSlot('p1', 2);
    await sem.acquireProviderSlot('p1', 2);
    const controller = new AbortController();
    const queuedPromise = sem.acquireProviderSlot('p1', 2, controller.signal);
    await new Promise((r) => setImmediate(r));
    expect(sem.providerSemaphores.get('p1')?.waiters.length).toBe(1);
    controller.abort();
    await expect(queuedPromise).rejects.toBeInstanceOf(AbortError);
    // The waiter was removed from the FIFO.
    expect(sem.providerSemaphores.get('p1')?.waiters.length).toBe(0);
    // #4 (next) joins the queue. Waiters = [#4], active = 2.
    const next = sem.acquireProviderSlot('p1', 2);
    await new Promise((r) => setImmediate(r));
    expect(sem.providerSemaphores.get('p1')?.waiters.length).toBe(1);
    // Release one slot -> #4 takes it. `next` resolves.
    sem.releaseProviderSlot('p1');
    await Promise.race([next, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('next did not resolve within 2s')), 2_000))]);
    // Release one more slot -> no waiters, active-- to 1.
    sem.releaseProviderSlot('p1');
    // Release the last slot -> active-- to 0, map entry cleared.
    sem.releaseProviderSlot('p1');
    expect(sem.providerSemaphores.has('p1')).toBe(false);
  });

  it('signal.aborted = true rejects synchronously without entering the queue', async () => {
    const sem = gateway as unknown as {
      acquireProviderSlot: (id: string, max: number, signal?: AbortSignal) => Promise<void>;
    };
    const controller = new AbortController();
    controller.abort();
    await expect(sem.acquireProviderSlot('p1', 2, controller.signal)).rejects.toBeInstanceOf(AbortError);
  });

  it('max = 0 disables the semaphore (every acquire resolves immediately)', async () => {
    const sem = gateway as unknown as {
      acquireProviderSlot: (id: string, max: number, signal?: AbortSignal) => Promise<void>;
    };
    await sem.acquireProviderSlot('p1', 0);
    await sem.acquireProviderSlot('p1', 0);
    await sem.acquireProviderSlot('p1', 0);
    // No map entry should be created when the cap is disabled.
    const map = (
      gateway as unknown as {
        providerSemaphores: Map<string, unknown>;
      }
    ).providerSemaphores;
    expect(map.has('p1')).toBe(false);
  });

  it('releaseProviderSlot with no waiters decrements active and cleans up the map entry', async () => {
    const sem = gateway as unknown as {
      acquireProviderSlot: (id: string, max: number, signal?: AbortSignal) => Promise<void>;
      releaseProviderSlot: (id: string) => void;
      providerSemaphores: Map<string, { active: number; waiters: unknown[] }>;
    };
    await sem.acquireProviderSlot('p1', 2);
    await sem.acquireProviderSlot('p1', 2);
    sem.releaseProviderSlot('p1');
    expect(sem.providerSemaphores.get('p1')?.active).toBe(1);
    sem.releaseProviderSlot('p1');
    expect(sem.providerSemaphores.has('p1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
//  SSE event stream safety
// ---------------------------------------------------------------------------

describe('SSE event stream safety', () => {
  it('refuses with HTTP 429 when more than maxConnections connections are open', async () => {
    const { gateway, port } = await startGateway({
      port: 0,
      maxConcurrentPerProvider: 1,
      events: {
        maxConnections: 1,
        maxLifetimeMs: 60_000,
        includeSummariesInEvents: false,
      },
    });
    try {
      const first = await openSseClient(port, '/v1/events');
      const second = await openSseClient(port, '/v1/events');
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(second.retryAfter).toBeTruthy();
      first.response.destroy();
    } finally {
      await gateway.stop();
    }
  });

  it('drops promptSummary / responseSummary from request.recorded by default', async () => {
    const { gateway, port } = await startGateway({
      port: 0,
      maxConcurrentPerProvider: 1,
      events: {
        maxConnections: 4,
        maxLifetimeMs: 60_000,
        includeSummariesInEvents: false,
      },
    });
    try {
      const client = await openSseClient(port, '/v1/events');
      const buf = attachSseBuffer(client.response);
      // Push a synthetic recorded entry through the store.
      const store = (
        gateway as unknown as {
          telemetry: { record: (entry: unknown) => void };
        }
      ).telemetry;
      store.record({
        id: 'aifb-aud02-test-1',
        timestamp: new Date().toISOString(),
        providerId: 'p1',
        providerLabel: 'Provider 1',
        model: 'm1',
        status: 200,
        durationMs: 12,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        estimatedCost: 0,
        estimated: false,
        promptSummary: 'SECRET prompt',
        responseSummary: 'SECRET response',
      });
      // Wait for the SSE event to arrive.
      const line = await waitForSseLine(buf, /event: request\.recorded/);
      const dataLine = await waitForSseLine(buf, /^data: /);
      const payload = JSON.parse(dataLine.replace(/^data: /, '')) as Record<string, unknown>;
      expect(line).toContain('request.recorded');
      expect(payload).not.toHaveProperty('promptSummary');
      expect(payload).not.toHaveProperty('responseSummary');
      expect(payload.id).toBe('aifb-aud02-test-1');
      client.response.destroy();
    } finally {
      await gateway.stop();
    }
  });

  it('keeps promptSummary / responseSummary when includeSummariesInEvents is true', async () => {
    const { gateway, port } = await startGateway({
      port: 0,
      maxConcurrentPerProvider: 1,
      events: {
        maxConnections: 4,
        maxLifetimeMs: 60_000,
        includeSummariesInEvents: true,
      },
    });
    try {
      const client = await openSseClient(port, '/v1/events');
      const buf = attachSseBuffer(client.response);
      const store = (
        gateway as unknown as {
          telemetry: { record: (entry: unknown) => void };
        }
      ).telemetry;
      store.record({
        id: 'aifb-aud02-test-2',
        timestamp: new Date().toISOString(),
        providerId: 'p1',
        providerLabel: 'Provider 1',
        model: 'm1',
        status: 200,
        durationMs: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        estimated: false,
        promptSummary: 'visible',
        responseSummary: 'visible-response',
      });
      await waitForSseLine(buf, /event: request\.recorded/);
      const dataLine = await waitForSseLine(buf, /^data: /);
      const payload = JSON.parse(dataLine.replace(/^data: /, '')) as Record<string, unknown>;
      expect(payload.promptSummary).toBe('visible');
      expect(payload.responseSummary).toBe('visible-response');
      client.response.destroy();
    } finally {
      await gateway.stop();
    }
  });

  it('ends the connection cleanly after maxLifetimeMs', async () => {
    const { gateway, port } = await startGateway({
      port: 0,
      maxConcurrentPerProvider: 1,
      events: {
        maxConnections: 4,
        maxLifetimeMs: 250,
        includeSummariesInEvents: false,
      },
    });
    try {
      const client = await openSseClient(port, '/v1/events');
      const buf = attachSseBuffer(client.response);
      // The gateway emits `event: end\ndata: {"reason":"max-lifetime-reached"}` then closes.
      const endHeader = await waitForSseLine(buf, /event: end/, 2_000);
      expect(endHeader).toBe('event: end');
      const dataLine = await waitForSseLine(buf, /^data: /, 1_000);
      const payload = JSON.parse(dataLine.replace(/^data: /, '')) as Record<string, unknown>;
      expect(payload.reason).toBe('max-lifetime-reached');
      // Connection must close after the end event.
      await new Promise<void>((resolve) => {
        client.response.once('close', () => resolve());
        // Hard timeout safety net.
        setTimeout(() => resolve(), 1_500);
      });
    } finally {
      await gateway.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface MinimalConfig {
  port: number;
  maxConcurrentPerProvider: number;
  events?: {
    maxConnections?: number;
    maxLifetimeMs?: number;
    includeSummariesInEvents?: boolean;
  };
}

async function startGateway(overrides: MinimalConfig): Promise<{ gateway: GatewayService; port: number }> {
  const gateway = new GatewayService({
    gateway: {
      enabled: true,
      port: overrides.port,
      baseUrl: `http://127.0.0.1:${overrides.port}/v1`,
      defaultModel: '',
      probeTimeoutMs: 500,
      maxConcurrentRequests: 16,
      maxConcurrentPerProvider: overrides.maxConcurrentPerProvider,
      allowLanguageHeaderOverride: true,
      events: {
        maxConnections: overrides.events?.maxConnections ?? 16,
        maxLifetimeMs: overrides.events?.maxLifetimeMs ?? 30 * 60 * 1000,
        includeSummariesInEvents: overrides.events?.includeSummariesInEvents ?? false,
      },
    } as never,
    providers: [],
    telemetryEnabled: false,
    logRequests: false,
    captureSessionLog: false,
    telemetryMaxStoredRequestBytes: 8192,
    telemetryRetentionDays: 90,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
  } as never);
  const status = await gateway.start();
  return { gateway, port: status.port };
}

interface SseClient {
  status: number;
  retryAfter: string | undefined;
  response: import('node:http').IncomingMessage;
}

async function openSseClient(port: number, path: string): Promise<SseClient> {
  const http = await import('node:http');
  return new Promise<SseClient>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          retryAfter: (res.headers['retry-after'] as string | undefined) ?? undefined,
          response: res,
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

interface SseBuffer {
  lines: string[];
  cursor: number;
  closed: boolean;
}

function attachSseBuffer(stream: import('node:http').IncomingMessage): SseBuffer {
  const buf: SseBuffer = { lines: [], cursor: 0, closed: false };
  let buffer = '';
  stream.on('data', (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      buf.lines.push(line);
    }
  });
  stream.once('close', () => {
    if (buffer.length > 0) {
      buf.lines.push(buffer);
      buffer = '';
    }
    buf.closed = true;
  });
  stream.once('end', () => {
    if (buffer.length > 0) {
      buf.lines.push(buffer);
      buffer = '';
    }
    buf.closed = true;
  });
  return buf;
}

async function waitForSseLine(buf: SseBuffer, pattern: RegExp, timeoutMs: number = 2_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const check = (): boolean => {
      for (let i = buf.cursor; i < buf.lines.length; i++) {
        const line = buf.lines[i];
        if (line !== undefined && pattern.test(line)) {
          buf.cursor = i + 1;
          clearInterval(poll);
          clearTimeout(timer);
          resolve(line);
          return true;
        }
      }
      if (buf.closed) {
        clearInterval(poll);
        clearTimeout(timer);
        reject(new Error(`stream closed before pattern /${pattern.source}/ matched. Lines: ${JSON.stringify(buf.lines)}`));
        return true;
      }
      return false;
    };
    const poll = setInterval(check, 10);
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`timed out waiting for /${pattern.source}/ in SSE stream. Lines so far: ${JSON.stringify(buf.lines)}`));
    }, timeoutMs);
    check();
  });
}

describe('isAbortError helper', () => {
  it('recognizes AbortError instances', () => {
    expect(isAbortError(new AbortError())).toBe(true);
  });

  it('recognizes errors whose name is "AbortError"', () => {
    const e = new Error('cancelled');
    e.name = 'AbortError';
    expect(isAbortError(e)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isAbortError(new Error('something else'))).toBe(false);
    expect(isAbortError('abort')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
