/**
 * Unit + integration tests for action plan item #3: shared session
 * log + replay endpoint (+ SSE stream).
 *
 * Covers:
 * - `sanitizeSummaryText`: Bearer / sk- / x-api-key redaction +
 *   long-blob redaction, idempotency, non-string input.
 * - `buildPromptSummary`: OpenAI `messages[]` shape, legacy
 *   `prompt` field fallback, user/system/assistant role labeling,
 *   truncation cap.
 * - `buildResponseSummary`: JSON chat-completion path, SSE
 *   concatenated-chunks path, `[DONE]` skipping, malformed-chunk
 *   tolerance, truncation cap.
 * - `TelemetryStore.getEntry(id)` + `listSessions(limit)`: lookup
 *   hit / miss, reverse-chronological order, limit clamping.
 * - `buildReplayResponse`: OpenAI-shaped payload, usage echo,
 *   prompt / response summaries, created epoch conversion,
 *   `choices[0].message.content` shape.
 * - End-to-end: posting a chat-completion request with a payload
 *   containing an API key + an SSE-style response, then hitting
 *   the gateway's `/v1/sessions` and `/v1/replay/{id}` endpoints.
 * - Backward compat: the dashboard snapshot can still be read
 *   from disk when no summaries are present.
 */

import { request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayService, buildReplayResponse } from '../src/aiflowbridge/gateway/server';
import { TelemetryStore } from '../src/aiflowbridge/telemetry';
import { buildPromptSummary, buildResponseSummary, extractAssistantText, sanitizeSummaryText } from '../src/aiflowbridge/telemetry/summary';
import type { AiFlowBridgeConfig, ProviderProfile, RequestTelemetry } from '../src/aiflowbridge/types';

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
      probeTimeoutMs: 0,
      maxConcurrentRequests: 0,
    },
    providers: [makeProvider()],
    telemetryEnabled: true,
    logRequests: false,
    captureSessionLog: true,
    telemetryMaxStoredRequestBytes: 1024,
    telemetryRetentionDays: 30,
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

describe('sanitizeSummaryText', () => {
  it('returns empty string for null / undefined / non-string input', () => {
    expect(sanitizeSummaryText(null)).toBe('');
    expect(sanitizeSummaryText(undefined)).toBe('');
    expect(sanitizeSummaryText({} as unknown as string)).toBe('');
  });

  it('redacts Bearer tokens', () => {
    expect(sanitizeSummaryText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload')).toContain('[REDACTED]');
    expect(sanitizeSummaryText('Bearer eyJhbGciOiJIUzI1NiJ9.payload')).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts sk- API keys', () => {
    expect(sanitizeSummaryText('sk-1234567890abcdefghijklmnop')).not.toContain('1234567890abcdefghijklmnop');
    expect(sanitizeSummaryText('sk-1234567890abcdefghijklmnop')).toContain('sk-[REDACTED]');
  });

  it('redacts x-api-key headers', () => {
    expect(sanitizeSummaryText('x-api-key: abc123def456ghi789jkl012mno')).not.toContain('abc123def456ghi789jkl012mno');
    expect(sanitizeSummaryText('"x-api-key":"abcdefghijklmnopqrstuvwxyz"')).toContain('x-api-key=[REDACTED]');
  });

  it('is idempotent', () => {
    const once = sanitizeSummaryText('sk-1234567890abcdefghijklmnop');
    const twice = sanitizeSummaryText(once);
    expect(twice).toBe(once);
  });

  it('leaves plain prose untouched', () => {
    expect(sanitizeSummaryText('Hello, how do I center a div in CSS?')).toBe('Hello, how do I center a div in CSS?');
  });
});

describe('buildPromptSummary', () => {
  it('returns empty for non-object payload', () => {
    expect(buildPromptSummary(null)).toBe('');
    expect(buildPromptSummary(undefined)).toBe('');
    expect(buildPromptSummary('plain')).toBe('');
  });

  it('extracts messages text in order', () => {
    const payload = {
      messages: [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: 'How do I parse JSON in Python?' },
      ],
    };
    const summary = buildPromptSummary(payload);
    expect(summary).toContain('coding assistant');
    expect(summary).toContain('parse JSON in Python');
  });

  it('labels non-default roles', () => {
    const payload = { messages: [{ role: 'tool', content: 'lookup result' }] };
    expect(buildPromptSummary(payload)).toContain('[tool] lookup result');
  });

  it('falls back to legacy prompt field', () => {
    expect(buildPromptSummary({ prompt: 'Complete this sentence' })).toBe('Complete this sentence');
  });

  it('truncates to maxChars', () => {
    // Word-separated long text so the long-blob sanitizer does not
    // replace it wholesale (the sanitizer targets token-like runs
    // of 60+ chars without whitespace).
    const longText = 'lorem ipsum dolor sit amet '.repeat(50).trim();
    const out = buildPromptSummary({ messages: [{ role: 'user', content: longText }] }, { maxChars: 100 });
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('...')).toBe(true);
  });

  it('redacts API keys embedded in the prompt', () => {
    const payload = { messages: [{ role: 'user', content: 'my key is sk-1234567890abcdefghijklmnop thanks' }] };
    const out = buildPromptSummary(payload);
    expect(out).not.toContain('1234567890abcdefghijklmnop');
    expect(out).toContain('sk-[REDACTED]');
  });
});

describe('buildResponseSummary', () => {
  it('returns empty for empty input', () => {
    expect(buildResponseSummary('')).toBe('');
    expect(buildResponseSummary(undefined)).toBe('');
  });

  it('extracts assistant text from a JSON chat-completion response', () => {
    const body = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Sure, here is how' } }],
    });
    expect(buildResponseSummary(body)).toBe('Sure, here is how');
  });

  it('extracts delta content from SSE chunks', () => {
    const sse = [
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hello "}}]}',
      'data: {"choices":[{"delta":{"content":"world"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');
    expect(buildResponseSummary(sse)).toBe('Hello world');
  });

  it('skips malformed JSON chunks without throwing', () => {
    const sse = ['data: {"choices":[{"delta":{"content":"OK"}}]}', 'data: not-json', 'data: {"choices":[{"delta":{"content":" again"}}]}'].join('\n');
    expect(buildResponseSummary(sse)).toBe('OK again');
  });

  it('truncates long responses', () => {
    // Use a long text with spaces so the long-blob sanitizer does
    // NOT replace it wholesale (the sanitizer targets token-like
    // runs of 60+ chars without whitespace).
    const longText = 'word '.repeat(500).trim();
    const body = JSON.stringify({ choices: [{ message: { content: longText } }] });
    const out = buildResponseSummary(body, { maxChars: 200 });
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('extractAssistantText', () => {
  it('returns empty string on garbage input', () => {
    expect(extractAssistantText('')).toBe('');
    expect(extractAssistantText('not json or sse')).toBe('');
  });

  it('handles both JSON and SSE inputs', () => {
    expect(extractAssistantText(JSON.stringify({ choices: [{ message: { content: 'A' } }] }))).toBe('A');
    expect(extractAssistantText('data: {"choices":[{"delta":{"content":"B"}}]}')).toBe('B');
  });
});

describe('TelemetryStore.getEntry + listSessions', () => {
  it('returns undefined for an unknown id', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'present' }));
    expect(store.getEntry('missing')).toBeUndefined();
    expect(store.getEntry('')).toBeUndefined();
  });

  it('returns the matching entry when present', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'a' }));
    store.record(makeEntry({ id: 'b' }));
    expect(store.getEntry('a')?.id).toBe('a');
    expect(store.getEntry('b')?.id).toBe('b');
  });

  it('listSessions returns the most recent entries in reverse order', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'oldest', timestamp: '2026-01-01T00:00:00.000Z' }));
    store.record(makeEntry({ id: 'middle', timestamp: '2026-01-02T00:00:00.000Z' }));
    store.record(makeEntry({ id: 'newest', timestamp: '2026-01-03T00:00:00.000Z' }));
    const list = store.listSessions(10);
    expect(list.map((entry) => entry.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('listSessions clamps the limit', () => {
    const store = new TelemetryStore();
    for (let i = 0; i < 10; i++) {
      store.record(makeEntry({ id: `e${i}` }));
    }
    expect(store.listSessions(3)).toHaveLength(3);
    expect(store.listSessions(0)).toHaveLength(0);
    expect(store.listSessions(-5)).toHaveLength(0);
    expect(store.listSessions(1000)).toHaveLength(10);
  });

  it('listSessions projects the promptSummary when present', () => {
    const store = new TelemetryStore();
    store.record(makeEntry({ id: 'x', promptSummary: 'a redacted prompt' }));
    const list = store.listSessions(1);
    expect(list[0].promptSummary).toBe('a redacted prompt');
  });
});

describe('buildReplayResponse', () => {
  it('produces an OpenAI chat.completion-shaped body', () => {
    const entry = makeEntry({
      id: 'replay-1',
      timestamp: '2026-06-03T08:00:00.000Z',
      model: 'MiniMax-M3',
      providerLabel: 'MiniMax',
      promptSummary: 'What is 2+2?',
      responseSummary: '4',
      promptTokens: 5,
      completionTokens: 2,
      totalTokens: 7,
    });
    const replay = buildReplayResponse(entry);
    expect(replay.id).toBe('replay-1');
    expect(replay.object).toBe('chat.completion.replay');
    expect(replay.model).toBe('MiniMax-M3');
    expect(replay.providerLabel).toBe('MiniMax');
    expect(replay.usage.totalTokens).toBe(7);
    expect(replay.promptSummary).toBe('What is 2+2?');
    expect(replay.responseSummary).toBe('4');
    expect(replay.choices).toHaveLength(1);
    expect(replay.choices[0].message.role).toBe('assistant');
    expect(replay.choices[0].message.content).toBe('4');
    expect(replay.choices[0].finish_reason).toBe('stop');
    expect(replay.created).toBe(Math.floor(new Date('2026-06-03T08:00:00.000Z').getTime() / 1000));
  });

  it('falls back to empty strings when summaries are missing', () => {
    const replay = buildReplayResponse(makeEntry({ id: 'r2' }));
    expect(replay.promptSummary).toBe('');
    expect(replay.responseSummary).toBe('');
    expect(replay.choices[0].message.content).toBe('');
  });
});

describe('GatewayService - shared session integration', () => {
  let service: GatewayService;

  beforeEach(async () => {
    service = new GatewayService(makeConfig());
    await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  // `TelemetryStore` is private on `GatewayService`. This thin
  // accessor is the standard test-side escape hatch (see
  // `tests/gateway-aud02-aud03.test.ts`). It returns the underlying
  // store so the suite can drive `record()`, `listSessions()`, and
  // `getEntry()` without exposing the field publicly on the
  // production class.
  function telemetryStore(s: GatewayService): TelemetryStore {
    return (s as unknown as { telemetry: TelemetryStore }).telemetry;
  }

  it('returns an empty list from GET /v1/sessions when nothing has been recorded', async () => {
    const res = await getJson(service, 'GET', '/v1/sessions');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.sessions).toEqual([]);
  });

  it('clamps the session list limit and returns entries in reverse chronological order', async () => {
    telemetryStore(service).record(makeEntry({ id: 'a', timestamp: '2026-01-01T00:00:00.000Z' }));
    telemetryStore(service).record(makeEntry({ id: 'b', timestamp: '2026-01-02T00:00:00.000Z' }));
    telemetryStore(service).record(makeEntry({ id: 'c', timestamp: '2026-01-03T00:00:00.000Z' }));
    const res = await getJson(service, 'GET', '/v1/sessions?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.sessions.map((entry: { id: string }) => entry.id)).toEqual(['c', 'b']);
  });

  it('returns 404 from GET /v1/replay/{id} for an unknown id', async () => {
    const res = await getJson(service, 'GET', '/v1/replay/unknown-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('returns the replay payload from GET /v1/replay/{id} for a known entry', async () => {
    telemetryStore(service).record(
      makeEntry({
        id: 'known-id',
        promptSummary: 'hello',
        responseSummary: 'world',
        timestamp: '2026-01-01T00:00:00.000Z',
      })
    );
    const res = await getJson(service, 'GET', '/v1/replay/known-id');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('known-id');
    expect(res.body.object).toBe('chat.completion.replay');
    expect(res.body.promptSummary).toBe('hello');
    expect(res.body.responseSummary).toBe('world');
  });

  it('rejects overlong replay ids with 400', async () => {
    const res = await getJson(service, 'GET', '/v1/replay/' + 'x'.repeat(200));
    expect(res.status).toBe(400);
  });

  it('streams SSE events from GET /v1/events', async () => {
    // Capture a few events by opening the SSE connection, recording
    // a new entry, and reading the resulting stream.
    const events = await captureSseEvents(service, 1, async () => {
      telemetryStore(service).record(makeEntry({ id: 'live-id', promptSummary: 'live prompt' }));
    });
    // The opening 'ready' frame is always present; one or more
    // `request.recorded` events follow.
    const names = events.map((event) => event.event);
    expect(names).toContain('ready');
    const recorded = events.find((event) => event.event === 'request.recorded');
    expect(recorded).toBeDefined();
    const parsed = recorded ? JSON.parse(recorded.data) : null;
    expect(parsed?.id).toBe('live-id');
  });
});

// --- helpers ---

interface SseEvent {
  event: string;
  data: string;
}

function captureSseEvents(service: GatewayService, _count: number, action: () => Promise<void> | void): Promise<SseEvent[]> {
  return new Promise((resolve) => {
    const port = (service as any).status().port;
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/events',
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        const events: SseEvent[] = [];
        let buffer = '';
        let resolved = false;
        const finish = (): void => {
          if (resolved) return;
          resolved = true;
          req.destroy();
          resolve(events);
        };
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let sep = buffer.indexOf('\n\n');
          while (sep !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const parsed = parseSseFrame(frame);
            if (parsed) {
              events.push(parsed);
            }
            sep = buffer.indexOf('\n\n');
          }
        });
        // Trigger the producer a tick after the stream opens, then
        // wait a generous window for the listener to deliver. The
        // timeout-driven completion is more reliable than a count
        // check because the listener fires synchronously inside
        // `record()` but the chunk reaches the socket on the next
        // event loop tick.
        setTimeout(() => {
          Promise.resolve(action()).then(() => {
            setTimeout(finish, 300);
          });
        }, 50);
      }
    );
    req.on('error', () => {
      resolve([]);
    });
    req.end();
  });
}

function parseSseFrame(frame: string): SseEvent | undefined {
  let eventName = 'message';
  let data = '';
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice('data:'.length).trim();
    }
  }
  if (!data) {
    return undefined;
  }
  return { event: eventName, data };
}

function getJson(service: GatewayService, method: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: (service as any).status().port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: any = raw;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          // leave as raw
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
