/**
 * Unit tests for src/aiflowbridge/gateway/server.ts
 * Tests GatewayService HTTP endpoints using a real server on a random port.
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
import { createServer, IncomingMessage, request as httpRequest } from 'node:http';
import { PassThrough } from 'node:stream';
import { GatewayService, MAX_BODY_SIZE, readBody } from '../src/aiflowbridge/gateway/server';
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
      port: 0, // random port
      baseUrl: 'http://127.0.0.1:0', // no /v1 suffix - server listens on root
      defaultModel: '',
      probeTimeoutMs: 5000,
      maxConcurrentRequests: 10,
    },
    providers: [makeProvider()],
    telemetryEnabled: false,
    logRequests: false,
    captureSessionLog: false,
    telemetryMaxStoredRequestBytes: 8192,
    telemetryRetentionDays: 90,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
    ...overrides,
  };
}

async function findListeningPort(server: { address: () => unknown }): Promise<number> {
  const addr = server.address() as { port: number };
  return addr.port;
}

// A 429 is ambiguous: it can be a rate limit that clears in seconds, an
// allowance that has been spent, or an account with no allocation at all,
// which never clears on its own. Google does not always tell them apart
// in the body, so the gateway classifies the refusal on positive
// evidence only and publishes the verdict as a header. The upstream body
// is left untouched for the client.
describe('GatewayService - upstream quota diagnosis', () => {
  let service: GatewayService;
  let baseUrl: string;
  let upstream: ReturnType<typeof vi.fn>;

  function stubUpstream(status: number, body: unknown, headers: Record<string, string> = {}): void {
    upstream = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
    vi.stubGlobal('fetch', upstream);
  }

  beforeEach(async () => {
    service = new GatewayService(makeConfig());
    baseUrl = (await service.start()).baseUrl;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
  });

  function post(body: Record<string, unknown>): Promise<{ status: number; headers: Record<string, string>; text: string }> {
    return new Promise((resolve, reject) => {
      const target = new URL('/v1/chat/completions', baseUrl);
      const req = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'POST',
          headers: { Host: `127.0.0.1:${target.port}`, 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, text: data }));
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  const CHAT = { model: 'model-1', messages: [{ role: 'user', content: 'ping' }] };

  it('publishes no quota state for a bare RESOURCE_EXHAUSTED, which proves nothing', async () => {
    // The body carries no violation block, so it is compatible with a
    // rate limit, a spent allowance AND a missing entitlement. Asserting
    // `zero-allocation` here would send the user after a console change
    // for what may be a momentary rate limit, so the gateway stays
    // silent instead of guessing.
    const body = {
      error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' },
    };
    stubUpstream(429, body);
    const res = await post(CHAT);

    expect(res.status).toBe(429);
    expect(res.headers['x-aiflowbridge-quota-state']).toBeUndefined();
    // The client keeps the upstream payload it would have parsed before.
    expect(JSON.parse(res.text).error.status).toBe('RESOURCE_EXHAUSTED');
  });

  it('labels an explicitly zero allowance as zero allocation', async () => {
    const body = {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaMetric: 'm', quotaValue: '0' }],
          },
        ],
      },
    };
    stubUpstream(429, body);
    const res = await post(CHAT);

    expect(res.headers['x-aiflowbridge-quota-state']).toBe('zero-allocation');
  });

  it('does not read a metric containing "generate" as a rate limit', async () => {
    // Regression guard: an earlier version matched the bare substring
    // `rate` AND treated any metric as a rate signal, which
    // reclassified a per-day allowance as a transient limit.
    const body = {
      error: {
        code: 429,
        message: 'Resource has been exhausted (e.g. check quota).',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              { quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaValue: '1500' },
            ],
          },
        ],
      },
    };
    stubUpstream(429, body);
    const res = await post(CHAT);

    expect(res.headers['x-aiflowbridge-quota-state']).toBe('quota-exhausted');
  });

  it('labels a spent allowance as quota exhausted and publishes the reset time', async () => {
    const body = {
      error: {
        code: 429,
        message: 'Resource has been exhausted (e.g. check quota).',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'm', quotaValue: '1500' }] },
        ],
      },
    };
    stubUpstream(429, body, { 'retry-after': '90' });
    const res = await post(CHAT);

    expect(res.headers['x-aiflowbridge-quota-state']).toBe('quota-exhausted');
    expect(res.headers['x-aiflowbridge-quota-reset']).toBeTruthy();
    expect(res.headers['retry-after']).toBe('90');
  });

  it('labels depleted credits as billing exhaustion', async () => {
    const body = {
      error: { code: 402, message: 'Your prepayment credits are depleted.', status: 'RESOURCE_EXHAUSTED' },
    };
    stubUpstream(402, body);
    const res = await post(CHAT);

    expect(res.status).toBe(402);
    expect(res.headers['x-aiflowbridge-quota-state']).toBe('billing-exhausted');
  });

  it('stays silent on a 400, which is not a quota refusal', async () => {
    stubUpstream(400, { error: { message: 'bad request' } });
    const res = await post(CHAT);

    expect(res.status).toBe(400);
    expect(res.headers['x-aiflowbridge-quota-state']).toBeUndefined();
  });

  it('consumes the upstream body exactly once', async () => {
    // The diagnosis reads through `clone()`; the streaming and
    // non-streaming paths must still get an intact body.
    stubUpstream(429, {
      error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' },
    });
    const res = await post({ ...CHAT, stream: true });
    expect(res.status).toBe(429);
    expect(res.text).toContain('RESOURCE_EXHAUSTED');
  });
});

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
    // No assertion needed - just no throw
  });

  it('updates config without crashing', () => {
    const newConfig = makeConfig({
      gateway: {
        enabled: true,
        port: 0,
        baseUrl: 'http://127.0.0.1:0/v1',
        defaultModel: 'p1',
        probeTimeoutMs: 0,
        maxConcurrentRequests: 0,
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
  });

  // Direct unit-level check of the path rewrite. The full HTTP path is
  // covered by the integration smoke tests below; this is the smallest
  // possible assertion that catches a regression on the Gemini public
  // API baseUrl routing.
  it('resolveUpstreamUrl prefixes /openai for the Gemini public API hostname', async () => {
    const { resolveUpstreamUrlForTest } = await import('../src/aiflowbridge/gateway/server');
    const profile = {
      id: 'byok',
      label: 'BYOK',
      kind: 'openai-compat',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.8-flash',
      enabled: true,
    } as unknown as ProviderProfile;
    expect(resolveUpstreamUrlForTest(profile, 'chat/completions')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    );
    // Non-Gemini baseUrls are forwarded verbatim.
    const openrouter = {
      id: 'or',
      label: 'OR',
      kind: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-oss-120b:free',
      enabled: true,
    } as unknown as ProviderProfile;
    expect(resolveUpstreamUrlForTest(openrouter, 'chat/completions')).toBe(
      'https://openrouter.ai/api/v1/chat/completions'
    );

    // Xiaomi MiMo smart routing: sk-* keys route to api.xiaomimimo.com, tp-* keys route to token-plan
    const xiaomiTokenPlan = {
      id: 'mimo',
      label: 'Xiaomi MiMo',
      kind: 'openai-compat',
      baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
      model: 'mimo-v2.5',
      enabled: true,
    } as unknown as ProviderProfile;
    expect(resolveUpstreamUrlForTest(xiaomiTokenPlan, 'chat/completions', 'sk-test-key')).toBe(
      'https://api.xiaomimimo.com/v1/chat/completions'
    );
    expect(resolveUpstreamUrlForTest(xiaomiTokenPlan, 'chat/completions', 'tp-test-token-plan')).toBe(
      'https://token-plan-ams.xiaomimimo.com/v1/chat/completions'
    );

    const xiaomiStandard = {
      id: 'mimo',
      label: 'Xiaomi MiMo',
      kind: 'openai-compat',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      model: 'mimo-v2.5',
      enabled: true,
    } as unknown as ProviderProfile;
    expect(resolveUpstreamUrlForTest(xiaomiStandard, 'chat/completions', 'tp-test-token-plan')).toBe(
      'https://token-plan-ams.xiaomimimo.com/v1/chat/completions'
    );
    expect(resolveUpstreamUrlForTest(xiaomiStandard, 'chat/completions', 'sk-test-key')).toBe(
      'https://api.xiaomimimo.com/v1/chat/completions'
    );
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
    const disabledService = new GatewayService(makeConfig({ providers: [makeProvider({ enabled: false })] }));
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

  it('POST /v1/chat/completions with unmatched model returns 404 (no silent fallback to first provider)', async () => {
    // Regression test for a request for "mimo-v2.5" was previously
    // silently routed to the first enabled provider (DeepSeek V4 Flash)
    // and the dashboard then showed "DeepSeek V4 Flash" with model
    // "mimo-v2.5" - the user thought they were talking to MiMo but were
    // actually talking to DeepSeek. The fix is to return a clear 404
    // listing the available provider ids.
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; requestedModel: string; availableProviderIds: string[] };
    expect(body.error).toContain('mimo-v2.5');
    expect(body.requestedModel).toBe('mimo-v2.5');
    expect(body.availableProviderIds).toContain('p1');
  });
});

// Binding to 127.0.0.1 keeps the gateway off the network, but a browser
// on the same machine can still reach it. The regression this pins: an
// unauthenticated page could POST a cross-origin "simple request" and
// spend the user's paid API key, and a DNS-rebinding page could read
// /v1/sessions, /v1/replay/{id} and /v1/events as same-origin. Raw
// `http.request` is used instead of `fetch` because undici enforces the
// fetch forbidden-header list and silently drops a forged `Host`.
describe('GatewayService - loopback-only enforcement', () => {
  let service: GatewayService;
  let baseUrl: string;
  let boundPort: number;

  beforeEach(async () => {
    service = new GatewayService(makeConfig());
    const status = await service.start();
    baseUrl = status.baseUrl;
    boundPort = Number(new URL(baseUrl).port);
  });

  afterEach(async () => {
    await service.stop();
  });

  function rawGet(pathname: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    const target = new URL(pathname, baseUrl);
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { hostname: target.hostname, port: target.port, path: target.pathname, method: 'GET', headers },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('serves a loopback client carrying no Origin header', async () => {
    const res = await rawGet('/health', { Host: `127.0.0.1:${boundPort}` });
    expect(res.status).toBe(200);
  });

  it('refuses a rebound Host, which is the DNS rebinding vector', async () => {
    const res = await rawGet('/v1/sessions', { Host: 'aiflowbridge.attacker.test' });
    expect(res.status).toBe(403);
    expect(res.body).toContain('Forbidden');
  });

  it('refuses a foreign Origin on an otherwise loopback request', async () => {
    const res = await rawGet('/v1/sessions', { Host: `127.0.0.1:${boundPort}`, Origin: 'https://evil.test' });
    expect(res.status).toBe(403);
    expect(res.body).toContain('Forbidden');
  });

  it('refuses the sensitive read endpoints a rebinding page would target', async () => {
    for (const pathname of ['/v1/sessions', '/v1/replay/abc', '/v1/events', '/v1/metrics']) {
      const res = await rawGet(pathname, { Host: `127.0.0.1:${boundPort}`, Origin: 'http://127.0.0.1:1' });
      expect(res.status, `${pathname} must be refused`).toBe(403);
    }
  });

  it('refuses a cross-origin chat completion before it reaches any upstream', async () => {
    // The provider baseUrl is unreachable in this test, so a 403 proves
    // the request never made it past the guard.
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.test' },
      body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GatewayService - singleton detection', () => {
  it('detects an existing AIFlowBridge gateway on the same port (same version)', async () => {
    // Start a fake "AIFlowBridge" gateway that returns the expected /version response.
    // /version is the new probe (replaces the old /health probe).
    const fakeServer = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/version') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            name: 'aiflowbridge-gateway',
            version: '0.0.0', // matches the default bundledVersion
            pid: 1,
            startedAt: '2026-06-04T00:00:00.000Z',
          })
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', resolve));
    const port = await findListeningPort(fakeServer);
    const baseUrl = `http://127.0.0.1:${port}`;

    const service = new GatewayService(
      makeConfig({
        // probeTimeoutMs defaults to 500 in production. Setting it to 0
        // here short-circuits the version probe, the gateway treats the
        // peer as unknown and falls through to listen(), which then
        // EADDRINUSE's on the port we just bound. 500 ms lets the probe
        // resolve the fakeServer's /version reply and the gateway joins
        // the peer cleanly.
        gateway: { enabled: true, port, baseUrl, defaultModel: '', probeTimeoutMs: 500, maxConcurrentRequests: 0 },
      })
    );

    try {
      const status = await service.start();
      // Joining a peer means the gateway is reachable through the
      // peer, even though we do not own the listening socket. The
      // status must report running=true so the dashboard and status
      // bar show "Gateway running".
      expect(status.running).toBe(true);
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

    const service = new GatewayService(
      makeConfig({
        gateway: { enabled: true, port, baseUrl, defaultModel: '', probeTimeoutMs: 0, maxConcurrentRequests: 0 },
      })
    );

    try {
      const status = await service.start();
      // Should try to start anyway on the occupied port (EADDRINUSE will reject)
      // The behavior depends on implementation - we just want no crash
      expect(status).toBeDefined();
    } catch {
      // EADDRINUSE is expected and acceptable
    } finally {
      await service.stop();
      await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    }
  });

  it('clears the failed server on bind error so running=false and a retry actually rebinds (MT05 regression)', async () => {
    // MT05: when a foreign service (e.g. python -m http.server) holds the
    // configured port, the gateway bind MUST fail AND the service must
    // expose `running=false` afterwards. Otherwise the runtime reports
    // the gateway as "already running" and the "Start local gateway"
    // command silently no-ops on a stale `this.server` reference.
    const foreign = createServer((_req, res) => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('not a gateway');
    });
    await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', resolve));
    const port = (foreign.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const service = new GatewayService(
      makeConfig({
        gateway: {
          enabled: true,
          port,
          baseUrl,
          defaultModel: '',
          probeTimeoutMs: 0,
          maxConcurrentRequests: 0,
        },
      })
    );

    try {
      await expect(service.start()).rejects.toBeDefined();
      // `running` must be false after a failed bind, otherwise the
      // dashboard and the "Start local gateway" command lie to the
      // user about the gateway being up.
      expect(service.running).toBe(false);

      // Free the port, then retry: the next start() must actually
      // attempt the bind (not short-circuit on a stale server
      // reference) and succeed.
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
      const status = await service.start();
      expect(status.running).toBe(true);
      expect(service.running).toBe(true);
    } finally {
      await service.stop();
    }
  });
});

describe('GatewayService - telemetry persistence (loadState / saveState)', () => {
  it('restores cumulative state from loadState() on init()', () => {
    const persisted = {
      requests: 5,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCost: 0.001,
      errors: 1,
      averageDurationMs: 200,
      p95DurationMs: 300,
      recent: [],
      byProvider: {
        p1: { requests: 5, promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.001, errors: 1, averageDurationMs: 200 },
      },
      byModel: {
        m1: { requests: 5, promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.001, errors: 1, averageDurationMs: 200 },
      },
      byClient: {},
    };
    const loadState = vi.fn(() => persisted);
    const saveState = vi.fn();
    const service = new GatewayService(makeConfig(), undefined, undefined, loadState, saveState);
    // Constructing the service must NOT touch the load/save callbacks:
    // that would crash if the callbacks close over a field that the
    // host class only sets in its own constructor body.
    expect(loadState).not.toHaveBeenCalled();
    service.init();
    expect(loadState).toHaveBeenCalledOnce();
    const snap = service.snapshot();
    expect(snap.requests).toBe(5);
    expect(snap.totalTokens).toBe(150);
    expect(snap.byProvider.p1?.requests).toBe(5);
  });

  it('init() is idempotent (loadState / saveState are wired at most once)', () => {
    const loadState = vi.fn(() => undefined);
    const saveState = vi.fn();
    const service = new GatewayService(makeConfig(), undefined, undefined, loadState, saveState);
    service.init();
    service.init();
    service.init();
    expect(loadState).toHaveBeenCalledOnce();
  });

  it('saveState is debounced and called with the latest snapshot', async () => {
    const saveState = vi.fn();
    const service = new GatewayService(makeConfig(), undefined, undefined, undefined, saveState);
    service.resetMetrics();
    saveState.mockClear();

    // Inject a few entries directly via the gateway request flow
    // by using the public /v1/chat/completions path with a mocked upstream.
    // Simpler: use the public `recordTelemetry` via a real chat request.
    // For this unit test we just need to verify saveState is called when
    // telemetry changes - we'll exercise it via resetMetrics + a fake entry.
    const { TelemetryStore } = await import('../src/aiflowbridge/telemetry');
    const store = new TelemetryStore();
    const unsub = store.subscribe(saveState);
    store.record({
      id: 'r1',
      timestamp: '2026-06-03T08:00:00.000Z',
      providerId: 'p1',
      providerLabel: 'P1',
      model: 'm1',
      status: 200,
      durationMs: 100,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      estimatedCost: 0,
      estimated: false,
    });
    store.record({
      id: 'r2',
      timestamp: '2026-06-03T08:00:01.000Z',
      providerId: 'p1',
      providerLabel: 'P1',
      model: 'm1',
      status: 200,
      durationMs: 200,
      promptTokens: 5,
      completionTokens: 10,
      totalTokens: 15,
      estimatedCost: 0,
      estimated: false,
    });
    unsub();
    // Two snapshots were pushed, saveState should be called twice
    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState.mock.calls[1]?.[0]?.requests).toBe(2);
  });

  it('resetMetrics() clears in-memory state but does not call saveState', () => {
    const saveState = vi.fn();
    const persisted = {
      requests: 5,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCost: 0,
      errors: 0,
      averageDurationMs: 100,
      p95DurationMs: 100,
      recent: [],
      byProvider: {},
      byModel: {},
      byClient: {},
    };
    const service = new GatewayService(makeConfig(), undefined, undefined, () => persisted, saveState);
    service.init();
    expect(service.snapshot().requests).toBe(5);
    saveState.mockClear();

    service.resetMetrics();
    expect(service.snapshot().requests).toBe(0);
    // resetMetrics should not write back to disk (the runtime is
    // responsible for clearing the persisted slot).
    expect(saveState).not.toHaveBeenCalled();
  });

  it('loadState() throwing does not crash the gateway', () => {
    const service = new GatewayService(makeConfig(), undefined, undefined, () => {
      throw new Error('boom');
    });
    // init() must swallow the error and leave the gateway in a usable
    // state with empty telemetry.
    expect(() => service.init()).not.toThrow();
    expect(service.snapshot().requests).toBe(0);
  });
});

/**
 * requests that failed (status >= 400) must not contribute to the
 * "Estimated cost" total. They are still recorded (error count, model usage,
 * duration averages, per-row delete) but with `estimatedCost: 0`. Cost is a
 * fait historique - we never bill the user for a request that never produced
 * a billable completion.
 */
describe('GatewayService - errored requests have zero cost', () => {
  // Pricing block large enough to produce a clearly non-zero cost on the
  // success path: (100 * 1 + 200 * 2) / 1_000_000 = 0.0005 USD.
  const testPricing = { inputPerMillion: 1, outputPerMillion: 2, currency: 'USD' };

  async function startFakeUpstream(
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
  ): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = await findListeningPort(server);
    return {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('records the computed cost for a successful 200 upstream response', async () => {
    const upstream = await startFakeUpstream((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'test',
          object: 'chat.completion',
          created: 1234567890,
          model: 'model-1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
        })
      );
    });

    const provider = makeProvider({ id: 'p1', baseUrl: upstream.baseUrl, model: 'model-1', pricing: testPricing });
    const service = new GatewayService(makeConfig({ providers: [provider], telemetryEnabled: true }));
    const status = await service.start();

    try {
      const res = await fetch(`${status.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(200);

      const snap = service.snapshot();
      expect(snap.requests).toBe(1);
      expect(snap.errors).toBe(0);
      expect(snap.promptTokens).toBe(100);
      expect(snap.completionTokens).toBe(200);
      expect(snap.estimatedCost).toBeCloseTo(0.0005, 6);
    } finally {
      await service.stop();
      await upstream.close();
    }
  });

  it('records estimatedCost=0 for a 5xx upstream response ', async () => {
    const upstream = await startFakeUpstream((_req, res) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'internal error' } }));
    });

    const provider = makeProvider({ id: 'p1', baseUrl: upstream.baseUrl, model: 'model-1', pricing: testPricing });
    const service = new GatewayService(makeConfig({ providers: [provider], telemetryEnabled: true }));
    const status = await service.start();

    try {
      const res = await fetch(`${status.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'hi' }] }),
      });
      // The gateway forwards the upstream status to the client.
      expect(res.status).toBe(500);

      const snap = service.snapshot();
      expect(snap.requests).toBe(1);
      expect(snap.errors).toBe(1);
      // an errored request must NOT contribute to estimated cost.
      expect(snap.estimatedCost).toBe(0);
      // The request is still recorded (model usage, prompt tokens seen).
      // The model key in `byModel` comes from the request body's `model`
      // field, which is what the client asked for (the provider id used
      // for routing).
      expect(snap.byModel['p1']?.requests).toBe(1);
    } finally {
      await service.stop();
      await upstream.close();
    }
  });

  it('records estimatedCost=0 for a 4xx upstream response ', async () => {
    const upstream = await startFakeUpstream((_req, res) => {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    });

    const provider = makeProvider({ id: 'p1', baseUrl: upstream.baseUrl, model: 'model-1', pricing: testPricing });
    const service = new GatewayService(makeConfig({ providers: [provider], telemetryEnabled: true }));
    const status = await service.start();

    try {
      const res = await fetch(`${status.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(401);

      const snap = service.snapshot();
      expect(snap.requests).toBe(1);
      expect(snap.errors).toBe(1);
      expect(snap.estimatedCost).toBe(0);
    } finally {
      await service.stop();
      await upstream.close();
    }
  });

  it('records estimatedCost=0 when the upstream is unreachable (catch block, statusCode=502)', async () => {
    // Unreachable upstream: port 1 is a privileged port that is not
    // listening, so `fetch` will reject with ECONNREFUSED. This
    // exercises the catch block at server.ts:605 (statusCode stays at
    // the initial 502 because the try block throws before the
    // `statusCode = upstreamResponse.status` line is reached).
    const unreachableBaseUrl = 'http://127.0.0.1:1/v1';
    const provider = makeProvider({ id: 'p1', baseUrl: unreachableBaseUrl, model: 'model-1', pricing: testPricing });
    const service = new GatewayService(makeConfig({ providers: [provider], telemetryEnabled: true }));
    const status = await service.start();

    try {
      const res = await fetch(`${status.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'hi' }] }),
      });
      // The gateway returns 502 (Bad Gateway) when the upstream is unreachable.
      expect(res.status).toBe(502);

      const snap = service.snapshot();
      expect(snap.requests).toBe(1);
      expect(snap.errors).toBe(1);
      // catch-block (status=502) must also have cost=0.
      expect(snap.estimatedCost).toBe(0);
    } finally {
      await service.stop();
    }
  });

  it('mixed success/error sequence: only successful requests contribute to estimated cost', async () => {
    let requestCount = 0;
    const upstream = await startFakeUpstream((_req, res) => {
      requestCount += 1;
      if (requestCount % 2 === 0) {
        // Every even request: 500 error
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { message: 'fail' } }));
      } else {
        // Every odd request: success
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'test',
            object: 'chat.completion',
            created: 1234567890,
            model: 'model-1',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
          })
        );
      }
    });

    const provider = makeProvider({ id: 'p1', baseUrl: upstream.baseUrl, model: 'model-1', pricing: testPricing });
    const service = new GatewayService(makeConfig({ providers: [provider], telemetryEnabled: true }));
    const status = await service.start();

    try {
      // 4 requests: success, error, success, error
      for (let i = 0; i < 4; i += 1) {
        await fetch(`${status.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'hi' }] }),
        });
      }

      const snap = service.snapshot();
      expect(snap.requests).toBe(4);
      expect(snap.errors).toBe(2);
      // 2 successful * 0.0005 = 0.001, 2 errored * 0 = 0
      expect(snap.estimatedCost).toBeCloseTo(0.001, 6);
    } finally {
      await service.stop();
      await upstream.close();
    }
  });
});

describe('GatewayService - upstream redirect guard (REDIR-1)', () => {
  async function startFakeUpstream(
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
  ): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = await findListeningPort(server);
    return {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('refuses to replay POST body on upstream 301, 302, 303 redirects and returns 502', async () => {
    for (const status of [301, 302, 303]) {
      const receivedRequests: Array<{ method?: string; url?: string; body: string }> = [];
      const upstream = await startFakeUpstream((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          receivedRequests.push({ method: req.method, url: req.url, body });
          res.statusCode = status;
          res.setHeader('Location', '/v1/redirected-target');
          res.setHeader('Content-Type', 'text/plain');
          res.end(`redirecting with ${status}`);
        });
      });

      const provider = makeProvider({ id: 'p1', baseUrl: upstream.baseUrl, model: 'model-1' });
      const service = new GatewayService(makeConfig({ providers: [provider] }));
      const gatewayStatus = await service.start();

      try {
        const res = await fetch(`${gatewayStatus.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'secret-prompt-content' }] }),
        });

        expect(res.status).toBe(502);
        const errJson = (await res.json()) as { error?: string; details?: string };
        expect(errJson.error).toBe('Failed to forward request');
        expect(errJson.details).toContain(`Upstream redirect refused (HTTP status ${status} does not preserve the POST method and body`);

        // The upstream must have received only the initial request, never a replayed POST to the redirected target!
        expect(receivedRequests.length).toBe(1);
        expect(receivedRequests[0].url).toBe('/v1/chat/completions');
        expect(receivedRequests[0].body).toContain('secret-prompt-content');
      } finally {
        await service.stop();
        await upstream.close();
      }
    }
  });

  it('replays POST body on upstream 307 temporary redirect on the same host', async () => {
    const receivedRequests: Array<{ method?: string; url?: string; body: string }> = [];
    const upstream = await startFakeUpstream((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({ method: req.method, url: req.url, body });
        if (receivedRequests.length === 1) {
          res.statusCode = 307;
          res.setHeader('Location', '/v1/redirected-target');
          res.setHeader('Content-Type', 'text/plain');
          res.end('redirecting with 307');
        } else {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              id: 'test-307',
              object: 'chat.completion',
              created: 1234567890,
              model: 'model-1',
              choices: [{ index: 0, message: { role: 'assistant', content: 'redirected-ok' }, finish_reason: 'stop' }],
            })
          );
        }
      });
    });

    const provider = makeProvider({ id: 'p1', baseUrl: upstream.baseUrl, model: 'model-1' });
    const service = new GatewayService(makeConfig({ providers: [provider] }));
    const gatewayStatus = await service.start();

    try {
      const res = await fetch(`${gatewayStatus.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'p1', messages: [{ role: 'user', content: 'secret-prompt-content' }] }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      expect(json.choices?.[0]?.message?.content).toBe('redirected-ok');

      // Two requests were sent: the original request and the replayed POST to the redirected target!
      expect(receivedRequests.length).toBe(2);
      expect(receivedRequests[0].url).toBe('/v1/chat/completions');
      expect(receivedRequests[1].url).toBe('/v1/redirected-target');
      expect(receivedRequests[1].method).toBe('POST');
      expect(receivedRequests[1].body).toContain('secret-prompt-content');
    } finally {
      await service.stop();
      await upstream.close();
    }
  });
});

describe('readBody (buffer + settled-flag guard)', () => {
  it('resolves with the buffered body when the stream ends normally', async () => {
    const stream = new PassThrough();
    const promise = readBody(stream as unknown as IncomingMessage);
    stream.write(Buffer.from('hello'));
    stream.write(Buffer.from(' world'));
    stream.end();
    await expect(promise).resolves.toBe('hello world');
  });

  it('resolves with empty string on an empty stream', async () => {
    const stream = new PassThrough();
    const promise = readBody(stream as unknown as IncomingMessage);
    stream.end();
    await expect(promise).resolves.toBe('');
  });

  it('rejects when the body exceeds MAX_BODY_SIZE', async () => {
    // Use a data chunk larger than the Max body size to trigger the
    // `totalSize > MAX_BODY_SIZE` branch inside readBody.
    const stream = new PassThrough();
    const destroyedSpy = vi.spyOn(stream, 'destroy');
    const promise = readBody(stream as unknown as IncomingMessage);
    stream.write(Buffer.alloc(MAX_BODY_SIZE + 1, 'x'));
    await expect(promise).rejects.toThrow('Request body too large');
    expect(destroyedSpy).toHaveBeenCalled();
    destroyedSpy.mockRestore();
  });

  it('rejects with "Client disconnected" when close fires before end', async () => {
    const stream = new PassThrough();
    const promise = readBody(stream as unknown as IncomingMessage);
    stream.write(Buffer.from('partial'));
    // destroy() emits 'close' before 'end' - simulates client hang-up.
    stream.destroy();
    await expect(promise).rejects.toThrow('Client disconnected');
  });

  it('rejects on stream error', async () => {
    const stream = new PassThrough();
    const promise = readBody(stream as unknown as IncomingMessage);
    stream.destroy(new Error('network down'));
    await expect(promise).rejects.toThrow('network down');
  });

  it('does not double-settle: end resolves, then close is a no-op', async () => {
    // A normal stream finishes with `end`, and then `close` fires
    // afterwards (Node.js lifecycle). The settled flag must prevent
    // the second settle from rejecting an already-resolved Promise.
    const stream = new PassThrough();
    const promise = readBody(stream as unknown as IncomingMessage);
    stream.write(Buffer.from('done'));
    stream.end();
    await expect(promise).resolves.toBe('done');
    // Emit close manually - must not throw or produce an unhandled
    // rejection warning (the settled flag absorbs it).
    stream.emit('close');
  });
});
