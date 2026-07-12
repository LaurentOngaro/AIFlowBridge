/**
 * Tests for action plan item #6: bridge the Copilot Chat path into
 * `TelemetryStore` so the dashboard can see traffic that arrives
 * through `vscode.lm.registerLanguageModelChatProvider` (not just
 * through the OpenAI-compatible gateway).
 *
 * Covers:
 * - `RequestTelemetry.source` field (optional, default-implied
 *   `'gateway'`).
 * - `TelemetrySnapshot.bySource` aggregation (new field, optional
 *   in the schema for backward compat with older on-disk snapshots).
 * - `TelemetryStore.recordFromCopilotChat()` helper (builds a
 *   fully-formed entry with `source: 'copilot-chat'` and routes it
 *   through the regular `record()` path).
 * - `UnifiedChatProvider.provideLanguageModelChatResponse` records
 *   on success AND on error, never on a missing sink (the
 *   runtime wire is best-effort).
 * - `removeEntry` / `restore` / `clear` propagate correctly through
 *   the new `bySource` map.
 * - Backward compatibility: entries recorded before the `source`
 *   field was introduced (no `source` set) coalesce to the
 *   `'gateway'` bucket on read so the dashboard never shows an
 *   empty `By source` panel after upgrade.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- VSCode mock (UnifiedChatProvider + the per-vendor providers
// transitively reach vscode.workspace / vscode.window). ---
vi.mock('vscode', () => {
  return {
    default: {
      EventEmitter: class MockEventEmitter<T> {
        private listeners: Array<(value: T) => void> = [];
        readonly event = (listener: (value: T) => void): { dispose: () => void } => {
          this.listeners.push(listener);
          return { dispose: () => {} };
        };
        fire(value: T): void {
          for (const l of this.listeners) l(value);
        }
        dispose(): void {
          this.listeners = [];
        }
      },
      window: {
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn(),
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
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn((_key: string, fallback?: unknown) => fallback),
          update: vi.fn(async () => undefined),
        })),
        onDidChangeConfiguration: vi.fn(() => ({ dispose: () => undefined })),
      },
      Uri: {
        file: (path: string) => ({ fsPath: path, toString: () => path, scheme: 'file' }),
      },
      CancellationTokenSource: class MockCancellationTokenSource {
        readonly token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) };
        cancel(): void {
          (this.token as { isCancellationRequested: boolean }).isCancellationRequested = true;
        }
        dispose(): void {}
      },
    },
  };
});

import { TelemetryStore, emptyTelemetrySnapshot } from '../src/aiflowbridge/telemetry';
import type { RequestTelemetry, TelemetrySnapshot } from '../src/aiflowbridge/types';
import { setLoadedRegistry } from '../src/aiflowbridge/modelRegistry';
import { UnifiedChatProvider, type CopilotChatTelemetrySink } from '../src/provider/unified';
import type { ModelDefinition } from '../src/types';

// A minimal `vscode.LanguageModelChatInformation` shim. The unified
// provider only reads `modelInfo.id`, so we keep the rest
// permissive.
function makeModelInfo(id: string): import('vscode').LanguageModelChatInformation {
  return { id } as unknown as import('vscode').LanguageModelChatInformation;
}

function makeProgress(): import('vscode').Progress<import('vscode').LanguageModelResponsePart> {
  return {
    report: vi.fn(),
  } as unknown as import('vscode').Progress<import('vscode').LanguageModelResponsePart>;
}

function makeToken(): import('vscode').CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  } as unknown as import('vscode').CancellationToken;
}

// Minimal stub that satisfies the `AnyProvider` contract (the three
// methods touched by `UnifiedChatProvider`). The stub never throws
// by default; tests can override `respond` to throw and assert the
// error-propagation path.
function makeStubProvider(overrides: { respond?: (modelInfo: import('vscode').LanguageModelChatInformation) => Promise<void>; vendor?: string } = {}) {
  return {
    family: overrides.vendor ?? 'minimax',
    vendor: overrides.vendor ?? 'minimax',
    onDidChangeLanguageModelChatInformation: () => ({ dispose: () => undefined }),
    provideLanguageModelChatResponse: vi.fn(async (modelInfo: import('vscode').LanguageModelChatInformation) => {
      if (overrides.respond) {
        await overrides.respond(modelInfo);
      }
    }),
    provideLanguageModelChatInformation: vi.fn(async () => []),
    provideTokenCount: vi.fn(async () => 1),
    prepareForDeactivate: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  // The model registry is read by `getModelsForProvider` (called
  // once in the constructor). The stub providers have a known
  // `family` so a single registry entry per vendor is enough.
  const stubModels: ModelDefinition[] = [
    { id: 'm-minimax', name: 'M', family: 'minimax', version: '', detail: '', requiresThinkingParam: false, capabilities: { toolCalling: false, imageInput: false, thinking: false }, maxInputTokens: 8192, maxOutputTokens: 4096 } as ModelDefinition,
    { id: 'm-deepseek', name: 'D', family: 'deepseek', version: '', detail: '', requiresThinkingParam: false, capabilities: { toolCalling: false, imageInput: false, thinking: false }, maxInputTokens: 8192, maxOutputTokens: 4096 },
    { id: 'm-xiaomi', name: 'X', family: 'xiaomi', version: '', detail: '', requiresThinkingParam: false, capabilities: { toolCalling: false, imageInput: false, thinking: false }, maxInputTokens: 8192, maxOutputTokens: 4096 },
  ];
  setLoadedRegistry({
    version: 1,
    vendors: { minimax: { baseUrl: '' }, deepseek: { baseUrl: '' }, xiaomi: { baseUrl: '' } },
    models: stubModels,
    sources: { bundled: { exists: true, path: '' }, globalStorage: { exists: false, path: '' }, workspace: { exists: false, path: '' } },
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =====================================================================
// TelemetryStore: bySource aggregation + recordFromCopilotChat
// =====================================================================
describe('TelemetryStore - bySource aggregation (item #6)', () => {
  it('aggregates a recorded copilot-chat entry under bySource["copilot-chat"]', () => {
    const store = new TelemetryStore();
    store.recordFromCopilotChat({
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 1234,
    });
    const snap = store.snapshot();
    expect(snap.bySource).toBeDefined();
    expect(snap.bySource!['copilot-chat']).toBeDefined();
    expect(snap.bySource!['copilot-chat']!.requests).toBe(1);
    expect(snap.bySource!['copilot-chat']!.averageDurationMs).toBe(1234);
    // The gateway bucket is empty (no gateway entry was recorded).
    expect(snap.bySource!['gateway']).toBeUndefined();
    // The byProvider / byModel maps still get the entry (it joins
    // the same shared aggregation).
    expect(snap.byProvider['minimax']?.requests).toBe(1);
    expect(snap.byModel['MiniMax-M3']?.requests).toBe(1);
  });

  it('coalesces pre-this-feature entries (no source field) to the "gateway" bucket', () => {
    const store = new TelemetryStore();
    // Build an entry exactly like the gateway would have built it
    // before the `source` field was introduced.
    const legacyEntry: RequestTelemetry = {
      id: 'legacy-1',
      timestamp: '2026-07-01T00:00:00.000Z',
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 500,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      estimatedCost: 0.001,
      estimated: false,
      // NO `source` field
    };
    store.record(legacyEntry);
    const snap = store.snapshot();
    expect(snap.bySource!['gateway']?.requests).toBe(1);
    expect(snap.bySource!['copilot-chat']).toBeUndefined();
  });

  it('splits mixed traffic across the two buckets (gateway + copilot-chat in the same session)', () => {
    const store = new TelemetryStore();
    // 2 gateway entries
    store.record({
      id: 'g1',
      timestamp: '2026-07-01T00:00:00.000Z',
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 100,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      estimatedCost: 0,
      estimated: true,
      source: 'gateway',
    });
    store.record({
      id: 'g2',
      timestamp: '2026-07-01T00:00:01.000Z',
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 200,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      estimatedCost: 0,
      estimated: true,
      source: 'gateway',
    });
    // 1 copilot-chat entry
    store.recordFromCopilotChat({
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 300,
    });
    const snap = store.snapshot();
    expect(snap.bySource!['gateway']?.requests).toBe(2);
    expect(snap.bySource!['gateway']?.averageDurationMs).toBe(150);
    expect(snap.bySource!['copilot-chat']?.requests).toBe(1);
    expect(snap.bySource!['copilot-chat']?.averageDurationMs).toBe(300);
    // byProvider / byModel sum the two buckets (3 total).
    expect(snap.byProvider['minimax']?.requests).toBe(3);
    expect(snap.byModel['MiniMax-M3']?.requests).toBe(3);
  });

  it('removeEntry reverses the bySource aggregation', () => {
    const store = new TelemetryStore();
    store.recordFromCopilotChat({
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 100,
    });
    const entryId = store.snapshot().recent[0]!.id;
    const removed = store.removeEntry(entryId);
    expect(removed).toBe(true);
    const snap = store.snapshot();
    // Bucket was deleted when its count dropped to 0 (same as
    // byProvider / byClient).
    expect(snap.bySource!['copilot-chat']).toBeUndefined();
  });

  it('restore() reads the bySource field when present (backward compat: absent => empty map)', () => {
    const store = new TelemetryStore();
    // Older on-disk snapshot: no `bySource` field.
    const legacy: TelemetrySnapshot = {
      ...emptyTelemetrySnapshot(),
      requests: 1,
      bySource: undefined,
    };
    store.restore(legacy);
    expect(store.snapshot().bySource).toEqual({});
  });

  it('restore() reads the bySource field when present (new-format snapshot)', () => {
    const store = new TelemetryStore();
    const newer: TelemetrySnapshot = {
      ...emptyTelemetrySnapshot(),
      requests: 2,
      bySource: {
        gateway: { requests: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, errors: 0, averageDurationMs: 100 },
        'copilot-chat': { requests: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, errors: 0, averageDurationMs: 200 },
      },
    };
    store.restore(newer);
    const snap = store.snapshot();
    expect(snap.bySource!['gateway']?.requests).toBe(1);
    expect(snap.bySource!['copilot-chat']?.requests).toBe(1);
  });

  it('reset() clears bySource along with the other maps', () => {
    const store = new TelemetryStore();
    store.recordFromCopilotChat({
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 100,
    });
    store.reset();
    expect(store.snapshot().bySource).toEqual({});
  });

  it('recordFromCopilotChat stamps source: "copilot-chat" on the recorded entry', () => {
    const store = new TelemetryStore();
    store.recordFromCopilotChat({
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 100,
    });
    const recent = store.snapshot().recent;
    expect(recent[0]!.source).toBe('copilot-chat');
  });

  it('recordFromCopilotChat generates a fresh entry id and ISO timestamp per call', () => {
    const store = new TelemetryStore();
    store.recordFromCopilotChat({ providerId: 'minimax', providerLabel: 'MiniMax', model: 'm', status: 200, durationMs: 1 });
    store.recordFromCopilotChat({ providerId: 'minimax', providerLabel: 'MiniMax', model: 'm', status: 200, durationMs: 1 });
    const ids = store.snapshot().recent.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });
});

// =====================================================================
// UnifiedChatProvider: telemetry on success AND on error
// =====================================================================
describe('UnifiedChatProvider - Copilot Chat telemetry (item #6)', () => {
  it('records a copilot-chat entry on success with the resolved vendor as providerId', async () => {
    const stub = makeStubProvider({ vendor: 'minimax' });
    const unified = new UnifiedChatProvider([stub as never]);
    const sink = makeFakeSink();
    unified.setTelemetrySink(sink.sink);

    await unified.provideLanguageModelChatResponse(
      makeModelInfo('m-minimax'),
      [],
      { tools: [], modelOptions: {} } as never,
      makeProgress(),
      makeToken(),
    );

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0]!;
    expect(record.providerId).toBe('minimax');
    expect(record.model).toBe('m-minimax');
    expect(record.status).toBe(200);
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.estimated).toBe(false);
  });

  it('records a copilot-chat entry on error and re-throws the original error', async () => {
    const upstreamError = new Error('MiniMax upstream 502') as Error & { status?: number };
    upstreamError.status = 502;
    const stub = makeStubProvider({ vendor: 'minimax', respond: async () => { throw upstreamError; } });
    const unified = new UnifiedChatProvider([stub as never]);
    const sink = makeFakeSink();
    unified.setTelemetrySink(sink.sink);

    await expect(
      unified.provideLanguageModelChatResponse(
        makeModelInfo('m-minimax'),
        [],
        { tools: [], modelOptions: {} } as never,
        makeProgress(),
        makeToken(),
      ),
    ).rejects.toBe(upstreamError);

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0]!;
    expect(record.status).toBe(502);
    expect(record.errorMessage).toContain('502');
  });

  it('classifies unknown errors as status 500', async () => {
    const stub = makeStubProvider({ vendor: 'minimax', respond: async () => { throw new Error('boom'); } });
    const unified = new UnifiedChatProvider([stub as never]);
    const sink = makeFakeSink();
    unified.setTelemetrySink(sink.sink);

    await expect(
      unified.provideLanguageModelChatResponse(
        makeModelInfo('m-minimax'),
        [],
        { tools: [], modelOptions: {} } as never,
        makeProgress(),
        makeToken(),
      ),
    ).rejects.toThrow('boom');

    expect(sink.records[0]!.status).toBe(500);
  });

  it('records nothing when no sink is wired (runtime did not build a TelemetryStore yet)', async () => {
    const stub = makeStubProvider({ vendor: 'minimax' });
    const unified = new UnifiedChatProvider([stub as never]);
    // No setTelemetrySink call.
    await unified.provideLanguageModelChatResponse(
      makeModelInfo('m-minimax'),
      [],
      { tools: [], modelOptions: {} } as never,
      makeProgress(),
      makeToken(),
    );
    // No way to inspect the sink directly (none was wired), but the
    // promise resolved without throwing and the test reached this
    // point. The actual storage is in the real TelemetryStore.
    expect(stub.provideLanguageModelChatResponse).toHaveBeenCalledOnce();
  });

  it('telemetry failure inside the sink does not break the upstream pipeline', async () => {
    const stub = makeStubProvider({ vendor: 'minimax' });
    const unified = new UnifiedChatProvider([stub as never]);
    const throwingSink: CopilotChatTelemetrySink = {
      recordFromCopilotChat: () => { throw new Error('telemetry broken'); },
    };
    unified.setTelemetrySink(throwingSink);

    // The provider MUST still complete normally. The test would
    // fail with "telemetry broken" if the unified provider did not
    // catch sink exceptions.
    await expect(
      unified.provideLanguageModelChatResponse(
        makeModelInfo('m-minimax'),
        [],
        { tools: [], modelOptions: {} } as never,
        makeProgress(),
        makeToken(),
      ),
    ).resolves.toBeUndefined();
  });

  it('records the right providerId for each sub-provider (deepseek, xiaomi, minimax)', async () => {
    const deepseekStub = makeStubProvider({ vendor: 'deepseek' });
    const xiaomiStub = makeStubProvider({ vendor: 'xiaomi' });
    const minimaxStub = makeStubProvider({ vendor: 'minimax' });
    const unified = new UnifiedChatProvider([deepseekStub as never, xiaomiStub as never, minimaxStub as never]);
    const sink = makeFakeSink();
    unified.setTelemetrySink(sink.sink);

    await unified.provideLanguageModelChatResponse(makeModelInfo('m-deepseek'), [], { tools: [], modelOptions: {} } as never, makeProgress(), makeToken());
    await unified.provideLanguageModelChatResponse(makeModelInfo('m-xiaomi'), [], { tools: [], modelOptions: {} } as never, makeProgress(), makeToken());
    await unified.provideLanguageModelChatResponse(makeModelInfo('m-minimax'), [], { tools: [], modelOptions: {} } as never, makeProgress(), makeToken());

    expect(sink.records.map((r) => r.providerId)).toEqual(['deepseek', 'xiaomi', 'minimax']);
  });
});

// =====================================================================
// End-to-end: TelemetryStore.snapshot reflects both sources
// =====================================================================
describe('TelemetryStore - end-to-end gateway + copilot-chat merge (item #6)', () => {
  it('end-to-end: gateway record + copilot-chat record appear together in the same snapshot', () => {
    const store = new TelemetryStore();
    // Simulate a gateway record
    store.record({
      id: 'g1',
      timestamp: '2026-07-01T00:00:00.000Z',
      providerId: 'kilocode',
      providerLabel: 'Kilo Code',
      model: 'm-1',
      status: 200,
      durationMs: 100,
      promptTokens: 5,
      completionTokens: 5,
      totalTokens: 10,
      estimatedCost: 0,
      estimated: true,
      source: 'gateway',
    });
    // Simulate a copilot-chat record through the helper
    store.recordFromCopilotChat({
      providerId: 'minimax',
      providerLabel: 'MiniMax',
      model: 'MiniMax-M3',
      status: 200,
      durationMs: 200,
    });
    const snap = store.snapshot();
    expect(snap.requests).toBe(2);
    expect(snap.bySource!['gateway']?.requests).toBe(1);
    expect(snap.bySource!['copilot-chat']?.requests).toBe(1);
    // The two entries use different provider ids and different
    // model ids, so byProvider / byModel are NOT coalesced.
    expect(snap.byProvider['kilocode']?.requests).toBe(1);
    expect(snap.byProvider['minimax']?.requests).toBe(1);
    expect(snap.byModel['m-1']?.requests).toBe(1);
    expect(snap.byModel['MiniMax-M3']?.requests).toBe(1);
  });
});

// ---- helpers --------------------------------------------------------

function makeFakeSink(): {
  sink: CopilotChatTelemetrySink;
  records: Array<{
    providerId: string;
    providerLabel: string;
    model: string;
    status: number;
    durationMs: number;
    errorMessage?: string;
    estimated?: boolean;
  }>;
} {
  const records: Array<{
    providerId: string;
    providerLabel: string;
    model: string;
    status: number;
    durationMs: number;
    errorMessage?: string;
    estimated?: boolean;
  }> = [];
  return {
    records,
    sink: {
      recordFromCopilotChat: (options) => {
        records.push({
          providerId: options.providerId,
          providerLabel: options.providerLabel,
          model: options.model,
          status: options.status,
          durationMs: options.durationMs,
          errorMessage: options.errorMessage,
          estimated: options.estimated,
        });
      },
    },
  };
}
