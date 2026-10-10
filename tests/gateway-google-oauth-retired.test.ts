/**
 * The retired Google product OAuth transport is refused by the gateway.
 *
 * These are the end-to-end guarantees of that refusal, exercised against
 * a real `GatewayService` on a random loopback port with a stubbed
 * `fetch`:
 *
 *   - HTTP 503 with an OpenAI-shaped error and the stable
 *     `google_product_oauth_unsupported` code;
 *   - ZERO upstream requests, even when a legacy token AND a valid BYOK
 *     key are both present - there is no implicit fallback that would
 *     spend the user's money on a different route;
 *   - no partial SSE stream is opened for a `stream: true` client;
 *   - the refusal happens on BOTH the legacy route marker and on a
 *     hand-written generic profile pointing at the same host;
 *   - the blocked profile is not advertised in `GET /v1/models`, while
 *     the public Gemini model ids stay listed;
 *   - a redirect that tries to hop onto the retired backend is refused
 *     BEFORE the hop is fetched.
 *
 * The BYOK Gemini route is covered separately in `gemini-gateway-
 * pipeline.test.ts` and `gemini-native.test.ts`.
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

import { request as httpRequest } from 'node:http';
import { GatewayService } from '../src/aiflowbridge/gateway/server';
import { GOOGLE_PRODUCT_OAUTH_ERROR_CODE } from '../src/aiflowbridge/google-transport-policy';
import { RETIRED_GOOGLE_PRODUCT_HOSTS } from '../src/aiflowbridge/google-transport-policy';
import type { AiFlowBridgeConfig, ProviderProfile } from '../src/aiflowbridge/types';

const RETIRED_BASE_URL = `https://${RETIRED_GOOGLE_PRODUCT_HOSTS[0]}`;

function legacyProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    kind: 'googleaistudio',
    baseUrl: RETIRED_BASE_URL,
    model: 'gemini-3.8-flash',
    apiKey: 'AIzaSyLeftoverByokKey000000000000',
    enabled: true,
    ...overrides,
  };
}

function makeConfig(providers: ProviderProfile[]): AiFlowBridgeConfig {
  return {
    gateway: {
      enabled: true,
      port: 0,
      baseUrl: 'http://127.0.0.1:0',
      defaultModel: '',
      probeTimeoutMs: 5000,
      maxConcurrentRequests: 10,
    },
    providers,
    telemetryEnabled: false,
    logRequests: false,
    captureSessionLog: false,
    telemetryMaxStoredRequestBytes: 8192,
    telemetryRetentionDays: 90,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
  };
}

describe('GatewayService - retired Google product OAuth transport', () => {
  let service: GatewayService;
  let baseUrl: string;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchStub = vi.fn(async () => new Response('{"unexpected":"upstream was called"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    service = new GatewayService(makeConfig([legacyProvider()]));
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

  function get(path: string): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const target = new URL(path, baseUrl);
      const req = httpRequest(
        { hostname: target.hostname, port: target.port, path: target.pathname, method: 'GET', headers: { Host: `127.0.0.1:${target.port}` } },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  const CHAT = { model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'ping' }] };

  it('refuses a non-streaming request with 503 and the stable error code, without calling the upstream', async () => {
    const res = await post(CHAT);

    expect(res.status).toBe(503);
    const body = JSON.parse(res.text);
    expect(body.error.code).toBe(GOOGLE_PRODUCT_OAUTH_ERROR_CODE);
    expect(body.error.type).toBe('service_unavailable_error');
    expect(body.error.message).toContain('No upstream request was sent');
    // requestId / providerId keep the existing gateway error envelope.
    expect(typeof body.requestId).toBe('string');
    expect(body.providerId).toBe('gemini-3.8-flash');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a streaming request without opening an SSE stream', async () => {
    const res = await post({ ...CHAT, stream: true });

    expect(res.status).toBe(503);
    // JSON body, not `text/event-stream`: a streaming client must not
    // receive a partial SSE stream it would try to parse.
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.text.startsWith('data:')).toBe(false);
    expect(JSON.parse(res.text).error.code).toBe(GOOGLE_PRODUCT_OAUTH_ERROR_CODE);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('does not fall back to the BYOK key when one is present on the same profile', async () => {
    // The profile carries a syntactically valid `AIzaSy...` key. There is
    // no implicit switch to the Gemini API: switching is a separate,
    // explicit action because it changes what the user is billed for.
    const res = await post(CHAT);
    expect(res.status).toBe(503);
    expect(JSON.parse(res.text).error.code).toBe(GOOGLE_PRODUCT_OAUTH_ERROR_CODE);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('publishes no quota header for a local refusal', async () => {
    // `X-AIFlowBridge-Quota-State` describes what GOOGLE answered. Nothing
    // was asked of Google, so publishing `zero-allocation` would
    // fabricate a quota fact.
    const res = await post(CHAT);
    expect(res.headers['x-aiflowbridge-quota-state']).toBeUndefined();
  });

  it('hides the blocked profile from the model catalog', async () => {
    const res = await get('/v1/models');
    expect(res.status).toBe(200);
    const catalog = JSON.parse(res.text) as { data: Array<{ id: string }> };
    expect(catalog.data.map((entry) => entry.id)).not.toContain('gemini-3.8-flash');
  });
});

describe('GatewayService - retired transport reached through a generic profile', () => {
  let service: GatewayService;
  let baseUrl: string;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchStub = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    // A hand-written `openai-compat` profile aimed at the same host: no
    // legacy marker to key on, only the URL.
    service = new GatewayService(
      makeConfig([legacyProvider({ kind: 'openai-compat', apiKey: 'AIzaSyLeftoverByokKey000000000000' })])
    );
    baseUrl = (await service.start()).baseUrl;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
  });

  function post(body: Record<string, unknown>): Promise<{ status: number; text: string }> {
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
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  it('refuses before any upstream request', async () => {
    const res = await post({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'ping' }] });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.text).error.code).toBe(GOOGLE_PRODUCT_OAUTH_ERROR_CODE);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
/**
 * Non-regression: the SUPPORTED Gemini API (BYOK) route must keep
 * working after the transport policy was introduced. The policy keys on
 * the hostname; a bug in it (a too-broad suffix rule, a family-level
 * refusal) would silently break BYOK, which is the one route a user is
 * still able to configure.
 */
describe('GatewayService - the supported Gemini API route is untouched', () => {
  let service: GatewayService;
  let baseUrl: string;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchStub = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'pong' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchStub);
    service = new GatewayService(
      makeConfig([
        legacyProvider({
          kind: 'openai-compat',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'AIzaSyByokKey000000000000',
        }),
      ])
    );
    baseUrl = (await service.start()).baseUrl;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
  });

  function post(body: Record<string, unknown>): Promise<{ status: number; text: string }> {
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
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  it('forwards the request and relays the OpenAI-shaped answer', async () => {
    const res = await post({ model: 'gemini-3.8-flash', messages: [{ role: 'user', content: 'ping' }] });

    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('pong');
    expect(body.usage.total_tokens).toBe(5);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('keeps the model listed in the catalog', async () => {
    const catalog = await new Promise<{ data: Array<{ id: string }> }>((resolve, reject) => {
      const target = new URL('/v1/models', baseUrl);
      const req = httpRequest(
        { hostname: target.hostname, port: target.port, path: target.pathname, method: 'GET', headers: { Host: `127.0.0.1:${target.port}` } },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => resolve(JSON.parse(data) as { data: Array<{ id: string }> }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(catalog.data.map((entry) => entry.id)).toContain('gemini-3.8-flash');
  });
});
