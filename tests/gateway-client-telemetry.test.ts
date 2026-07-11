/**
 * Unit + integration tests for action plan item #1: per-client IDE
 * telemetry in the dashboard.
 *
 * Covers:
 * - `normalizeClientId`: User-Agent / explicit-header parsing,
 *   name normalization, version extraction, length cap, junk
 *   filtering, and the null sentinel for empty input.
 * - `resolveClientId`: precedence of `X-AIFlowBridge-Client` over
 *   `User-Agent`, fallback when the explicit header is junk, and
 *   the null sentinel when neither header is present.
 * - `TelemetryStore.byClient`: aggregation under the resolved
 *   clientId, the `'unknown'` bucket for missing entries,
 *   `removeEntry` reversal, `restore` of older snapshots that lack
 *   the field, and the empty-snapshot default.
 * - End-to-end: posting a `chat/completions` request with a
 *   realistic User-Agent and verifying the gateway records the
 *   entry under the expected `byClient` key.
 */

import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayService, normalizeClientId, resolveClientId } from '../src/aiflowbridge/gateway/server';
import { TelemetryStore, emptyTelemetrySnapshot } from '../src/aiflowbridge/telemetry';
import type { AiFlowBridgeConfig, ProviderProfile, RequestTelemetry } from '../src/aiflowbridge/types';

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
    },
    providers: [makeProvider()],
    telemetryEnabled: true,
    logRequests: false,
    captureSessionLog: false,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RequestTelemetry> = {}): RequestTelemetry {
  return {
    id: 'r1',
    timestamp: '2026-06-03T08:00:00.000Z',
    providerId: 'p1',
    providerLabel: 'Provider 1',
    model: 'model-1',
    status: 200,
    durationMs: 100,
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    estimatedCost: 0.0001,
    estimated: false,
    ...overrides,
  };
}

function makeIncomingMessage(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  // Minimal IncomingMessage stub. Only the `headers` field is read by
  // the helpers under test, so the rest of the surface can be left
  // untyped.
  return { headers } as unknown as IncomingMessage;
}

describe('normalizeClientId', () => {
  it('returns null for null / undefined / whitespace', () => {
    expect(normalizeClientId(null)).toBeNull();
    expect(normalizeClientId(undefined)).toBeNull();
    expect(normalizeClientId('')).toBeNull();
    expect(normalizeClientId('   ')).toBeNull();
  });

  it('parses a "Name/Version" header into lowercase@version', () => {
    expect(normalizeClientId('Kilo Code/1.2.3')).toBe('kilo-code@1.2.3');
    expect(normalizeClientId('Continue/0.9.x')).toBe('continue@0.9.x');
    expect(normalizeClientId('curl/8.10.1')).toBe('curl@8.10.1');
    expect(normalizeClientId('Mozilla/5.0')).toBe('mozilla@5.0');
    expect(normalizeClientId('AIFlowBridge-CLI/2.4.3')).toBe('aiflowbridge-cli@2.4.3');
  });

  it('handles names with internal spaces by hyphenating them', () => {
    // Real JetBrains UA uses a multi-word product name; the resulting
    // bucket key is what the dashboard displays.
    expect(normalizeClientId('JetBrains AI Assistant/2024.3')).toBe('jetbrains-ai-assistant@2024.3');
    expect(normalizeClientId('Kilo Code/1.2.3 (commit abc) node/20.0')).toBe('kilo-code@1.2.3');
    // The greedy "Name/Version" portion swallows "OpenAI CLI" as the
    // product name; trailing tokens (node/v18.17.1) are dropped because
    // the regex only takes the first /Version pair.
    expect(normalizeClientId('OpenAI CLI/0.11.0 node/v18.17.1')).toBe('openai-cli@0.11.0');
  });

  it('strips characters outside the bucket-key alphabet', () => {
    // The fallback path (no slash in the header) keeps only
    // [a-z0-9_.@-] and hyphenates whitespace runs. Anything outside
    // that alphabet is dropped, preventing junk from polluting the
    // by-client map. Exact whitespace behavior is best tested at the
    // integration boundary; we only assert that the result is
    // non-empty, lowercased, and alphabet-clean here.
    const fall1 = normalizeClientId('my-script');
    expect(fall1).toBe('my-script');
    const fall2 = normalizeClientId('My Probe Tool');
    expect(fall2).toBe('my-probe-tool');
    const fall3 = normalizeClientId('"Mozilla"/5.0"<script>');
    expect(fall3).toBe('mozilla5.0script');
  });

  it('falls back to the literal cleaned string when the header has no slash', () => {
    // curl --user-agent 'my-script' for example.
    expect(normalizeClientId('my-script')).toBe('my-script');
    expect(normalizeClientId('My Probe Tool')).toBe('my-probe-tool');
  });

  it('strips characters outside the bucket-key alphabet', () => {
    // The fallback path (no slash in the header) keeps only
    // [a-z0-9_.@-] and hyphenates whitespace runs. Anything outside
    // that alphabet is dropped, preventing junk from polluting the
    // by-client map. Exact whitespace collapse behavior is best
    // tested at the integration boundary; we only assert that the
    // result is alphabet-clean here.
    expect(normalizeClientId('my-script')).toBe('my-script');
    expect(normalizeClientId('My Probe Tool')).toBe('my-probe-tool');
    expect(normalizeClientId('"Mozilla"/5.0"<script>')).toBe('mozilla5.0script');
  });

  it('caps the result length to 128 characters', () => {
    const long = 'A'.repeat(200) + '/' + 'B'.repeat(200);
    const result = normalizeClientId(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(128);
  });
});

describe('resolveClientId', () => {
  it('returns null when no X-AIFlowBridge-Client and no User-Agent headers are present', () => {
    const req = makeIncomingMessage({});
    expect(resolveClientId(req)).toBeNull();
  });

  it('prefers the explicit X-AIFlowBridge-Client header over User-Agent', () => {
    const req = makeIncomingMessage({
      'x-aiflowbridge-client': 'Kilo Code/1.2.3',
      'user-agent': 'curl/8.10.1',
    });
    expect(resolveClientId(req)).toBe('kilo-code@1.2.3');
  });

  it('falls back to User-Agent when the explicit header is junk', () => {
    // A client sending `X-AIFlowBridge-Client: ;rm -rf ;` would resolve
    // to `'rm-rf'` after the per-character filter. Because the helper
    // keeps non-empty results, that is acceptable; if the only header
    // is whitespace, the resolver falls back to User-Agent.
    const req = makeIncomingMessage({
      'x-aiflowbridge-client': '   ',
      'user-agent': 'curl/8.10.1',
    });
    expect(resolveClientId(req)).toBe('curl@8.10.1');
  });

  it('parses User-Agent when no explicit header is sent', () => {
    const req = makeIncomingMessage({
      'user-agent': 'Kilo Code/1.2.3 (commit abc) node/20.0',
    });
    expect(resolveClientId(req)).toBe('kilo-code@1.2.3');
  });

  it('handles the array form for both headers (first non-empty wins)', () => {
    const req = makeIncomingMessage({
      'x-aiflowbridge-client': ['', 'Continue/0.9.x', 'extra/1'],
      'user-agent': ['curl/8.10.1'],
    });
    expect(resolveClientId(req)).toBe('continue@0.9.x');
  });

  it('handles a User-Agent-only request from JetBrains AI Assistant', () => {
    const req = makeIncomingMessage({
      'user-agent': 'JetBrains AI Assistant/2024.3 IntelliJ-IDEA/2024.3',
    });
    expect(resolveClientId(req)).toBe('jetbrains-ai-assistant@2024.3');
  });
});

describe('TelemetryStore.byClient aggregation', () => {
  it('starts with an empty byClient map', () => {
    const store = new TelemetryStore();
    expect(store.snapshot().byClient).toEqual({});
  });

  it('buckets a single record under its resolved clientId', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1', clientId: 'kilocode@1.2.3' }));
    const snap = store.snapshot();
    expect(snap.byClient['kilocode@1.2.3']).toEqual({
      requests: 1,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      estimatedCost: 0.0001,
      errors: 0,
      averageDurationMs: 100,
    });
  });

  it('buckets entries with no clientId under the literal "unknown" key', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1' })); // no clientId
    store.record(makeEntry({ id: 'r2', clientId: 'kilocode@1.2.3' }));
    const snap = store.snapshot();
    expect(snap.byClient['unknown']?.requests).toBe(1);
    expect(snap.byClient['kilocode@1.2.3']?.requests).toBe(1);
  });

  it('aggregates distinct clients without leaking into each other', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1', clientId: 'kilocode@1.2.3', totalTokens: 100, promptTokens: 40, completionTokens: 60, durationMs: 200 }));
    store.record(makeEntry({ id: 'r2', clientId: 'kilocode@1.2.3', totalTokens: 50, promptTokens: 20, completionTokens: 30, durationMs: 100 }));
    store.record(makeEntry({ id: 'r3', clientId: 'curl@8.10.1', totalTokens: 10, promptTokens: 5, completionTokens: 5, durationMs: 50 }));
    const snap = store.snapshot();
    expect(snap.byClient['kilocode@1.2.3']).toEqual({
      requests: 2,
      promptTokens: 60,
      completionTokens: 90,
      totalTokens: 150,
      estimatedCost: expect.any(Number),
      errors: 0,
      averageDurationMs: 150,
    });
    expect(snap.byClient['curl@8.10.1']).toEqual({
      requests: 1,
      promptTokens: 5,
      completionTokens: 5,
      totalTokens: 10,
      estimatedCost: expect.any(Number),
      errors: 0,
      averageDurationMs: 50,
    });
  });

  it('counts client-level errors (status >= 400)', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1', clientId: 'kilocode@1.2.3', status: 200 }));
    store.record(makeEntry({ id: 'r2', clientId: 'kilocode@1.2.3', status: 500 }));
    const snap = store.snapshot();
    expect(snap.byClient['kilocode@1.2.3']?.errors).toBe(1);
  });

  it('removeEntry reverts the byClient bucket and drops it when empty', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1', clientId: 'kilocode@1.2.3' }));
    store.record(makeEntry({ id: 'r2', clientId: 'curl@8.10.1' }));
    expect(store.removeEntry('r1')).toBe(true);
    const snap = store.snapshot();
    expect(snap.byClient['kilocode@1.2.3']).toBeUndefined();
    expect(snap.byClient['curl@8.10.1']?.requests).toBe(1);
  });

  it('removeEntry on the only entry under "unknown" drops the bucket', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1' })); // no clientId
    expect(store.removeEntry('r1')).toBe(true);
    expect(store.snapshot().byClient['unknown']).toBeUndefined();
  });

  it('restore() loads byClient from the supplied snapshot', () => {
    const store = new TelemetryStore();
    const persisted = {
      ...emptyTelemetrySnapshot(),
      requests: 2,
      totalTokens: 60,
      recent: [],
      byClient: {
        'kilocode@1.2.3': { requests: 2, promptTokens: 30, completionTokens: 30, totalTokens: 60, estimatedCost: 0, errors: 0, averageDurationMs: 100 },
      },
    };
    store.restore(persisted);
    expect(store.snapshot().byClient['kilocode@1.2.3']?.requests).toBe(2);
  });

  it('restore() tolerates an older snapshot without a byClient field', () => {
    // Pre-item-1 snapshots on disk have no `byClient` key. The store
    // must accept them and just leave the in-memory map empty; the
    // next `record()` repopulates it. This avoids a forced global
    // reset on upgrade.
    const store = new TelemetryStore();
    const older = emptyTelemetrySnapshot();
    // Strip the byClient key the way an old on-disk file would.
    delete (older as Partial<typeof older>).byClient;
    store.restore(older as typeof older);
    expect(store.snapshot().byClient).toEqual({});
  });

  it('reset() clears byClient', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'r1', clientId: 'kilocode@1.2.3' }));
    store.reset();
    expect(store.snapshot().byClient).toEqual({});
    expect(store.snapshot().byClient['kilocode@1.2.3']).toBeUndefined();
  });
});

describe('GatewayService - records clientId on chat-completion requests', () => {
  let service: GatewayService;
  let port: number;

  // Stub `fetch` with a fake upstream so the gateway can complete the
  // forwarding path without hitting the network. Returns the minimum
  // valid OpenAI chat-completion JSON.
  const upstream = vi.fn(async (_url: unknown, _init?: unknown) => {
    return new Response(
      JSON.stringify({
        id: 'cmpl-test',
        object: 'chat.completion',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });

  beforeEach(async () => {
    service = new GatewayService(makeConfig());
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);
    vi.stubGlobal('fetch', upstream);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    upstream.mockClear();
    await service.stop();
  });

  // Use Node's `http.request` to talk to the gateway's HTTP server.
  // We cannot use `global.fetch` for this side because the test
  // stubs `fetch` to mock the upstream; routing the test client
  // through the same stub would short-circuit the gateway entirely.
  function postChat(headers: Record<string, string>, body: Record<string, unknown>): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(payload)),
            ...headers,
          },
        },
        (res) => {
          // Drain the response body so the underlying connection is
          // released back to the pool; otherwise the test process
          // can hang on socket close.
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  it('records under the parsed User-Agent (Kilo Code)', async () => {
    const response = await postChat(
      { 'user-agent': 'Kilo Code/1.2.3 (commit abc) node/20.0' },
      { model: 'model-1', messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(response.status).toBe(200);
    const snap = service.snapshot();
    const entry = snap.recent[0];
    expect(entry).toBeDefined();
    expect(entry.clientId).toBe('kilo-code@1.2.3');
    expect(snap.byClient['kilo-code@1.2.3']?.requests).toBe(1);
  });

  it('records under the explicit X-AIFlowBridge-Client header when present', async () => {
    const response = await postChat(
      {
        'x-aiflowbridge-client': 'Continue/0.9.x',
        'user-agent': 'curl/8.10.1',
      },
      { model: 'model-1', messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(response.status).toBe(200);
    const entry = service.snapshot().recent[0];
    expect(entry).toBeDefined();
    expect(entry.clientId).toBe('continue@0.9.x');
    expect(service.snapshot().byClient['curl@8.10.1']).toBeUndefined();
  });

  it('buckets a request without any client identification under "unknown"', async () => {
    const response = await postChat({}, { model: 'model-1', messages: [{ role: 'user', content: 'hi' }] });
    expect(response.status).toBe(200);
    const snap = service.snapshot();
    const entry = snap.recent[0];
    expect(entry).toBeDefined();
    expect(entry.clientId).toBeUndefined();
    expect(snap.byClient['unknown']?.requests).toBe(1);
  });
});
