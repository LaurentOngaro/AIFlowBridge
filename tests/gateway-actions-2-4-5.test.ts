/**
 * Tests for the 3 action-plan items shipped together (items #2,
 * #4, #5): workspace context detection / injection, language-
 * based routing rules, zero-conf discovery beacon.
 *
 * The tests are split into three independent describe blocks so a
 * regression in one feature does not mask the others.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
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
}));

// Workspace context tests use a real temp directory on disk;
// import lazily so the mock above is in place when the
// workspace-context module is first evaluated (it transitively
// imports `../logger` which reaches for `vscode.window`).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectWorkspaceContext,
  detectWorkspaceContextCached,
  clearWorkspaceContextCache,
  resolveContextRoot,
  renderWorkspaceContext,
} from '../src/aiflowbridge/context/workspace-context';
import {
  detectLanguageHintFromPayload,
  selectProviderByLanguage,
  selectProviderWithLanguage,
} from '../src/aiflowbridge/context/language-routing';
import type { ProviderProfile } from '../src/aiflowbridge/types';
import { GatewayService, MAX_LANGUAGE_HINT_HEADER_LENGTH, prependSystemMessage, resolveLanguageHint } from '../src/aiflowbridge/gateway/server';
import { buildClientConfigSnippets, DiscoveryBeacon } from '../src/aiflowbridge/gateway/discovery';

// ============================================================================
// Item #2: workspace context detection
// ============================================================================
describe('detectWorkspaceContext', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiflowbridge-wctx-'));
  });
  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects Python via pyproject.toml', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    const ctx = detectWorkspaceContext(dir);
    expect(ctx.languages).toContain('python');
    expect(ctx.primaryLanguage).toBe('python');
    expect(ctx.packageManagers).toContain('poetry / uv / pdm');
  });

  it('detects Rust via Cargo.toml', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    const ctx = detectWorkspaceContext(dir);
    expect(ctx.languages).toContain('rust');
    expect(ctx.primaryLanguage).toBe('rust');
    expect(ctx.packageManagers).toContain('cargo');
    expect(ctx.linters).toContain('clippy');
    expect(ctx.formatters).toContain('rustfmt');
  });

  it('detects multiple languages (polyglot monorepo)', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    mkdirSync(join(dir, 'web'));
    writeFileSync(join(dir, 'web', 'package.json'), '{"name": "web"}');
    const ctx = detectWorkspaceContext(dir);
    expect(ctx.languages).toContain('rust');
    expect(ctx.languages).toContain('javascript');
    expect(ctx.languages.length).toBe(2);
  });

  it('skips ignored directories (node_modules)', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    mkdirSync(join(dir, 'node_modules'));
    // A package.json in node_modules would normally suggest
    // JavaScript; the detector must skip it entirely.
    writeFileSync(join(dir, 'node_modules', 'package.json'), '{"name": "fake"}');
    const ctx = detectWorkspaceContext(dir);
    expect(ctx.languages).toEqual(['python']);
  });

  it('returns an empty context for a non-code folder', () => {
    writeFileSync(join(dir, 'README.md'), '# hello');
    const ctx = detectWorkspaceContext(dir);
    expect(ctx.languages).toEqual([]);
    expect(ctx.primaryLanguage).toBeNull();
  });

  it('matches glob patterns (*.csproj)', () => {
    writeFileSync(join(dir, 'Demo.csproj'), '<Project />');
    const ctx = detectWorkspaceContext(dir);
    expect(ctx.languages).toContain('csharp');
  });

  it('renders a multi-line context for a Rust project', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\n');
    const ctx = detectWorkspaceContext(dir);
    const prefix = renderWorkspaceContext(ctx);
    expect(prefix).not.toBeNull();
    expect(prefix).toMatch(/Detected language\(s\): rust/);
    expect(prefix).toMatch(/Package manager\(s\): cargo/);
    expect(prefix).toMatch(/Linter\(s\): clippy/);
    expect(prefix).toMatch(/Formatter\(s\): rustfmt/);
  });

  it('renderWorkspaceContext returns null when no language was detected', () => {
    writeFileSync(join(dir, 'README.md'), '# x');
    const ctx = detectWorkspaceContext(dir);
    expect(renderWorkspaceContext(ctx)).toBeNull();
  });
});

// ============================================================================
// Item #5: language-based routing rules
// ============================================================================
function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: overrides.id ?? 'p1',
    label: overrides.label ?? 'Provider 1',
    kind: 'openai-compat',
    baseUrl: overrides.baseUrl ?? 'https://api.example.com/v1',
    model: overrides.model ?? 'model-1',
    apiKey: 'sk-test',
    enabled: overrides.enabled ?? true,
    ...overrides,
  };
}

describe('language-based routing rules', () => {
  it('honors explicit language mapping over the model picker', () => {
    const providers: ProviderProfile[] = [
      makeProvider({ id: 'a', model: 'model-a' }),
      makeProvider({ id: 'b', model: 'model-b' }),
    ];
    const match = selectProviderByLanguage(providers, 'rust', { rust: 'b' });
    expect(match?.id).toBe('b');
  });

  it('falls back to "*" when the language has no explicit rule', () => {
    const providers: ProviderProfile[] = [
      makeProvider({ id: 'a', model: 'model-a' }),
      makeProvider({ id: 'fallback', model: 'fallback-model' }),
    ];
    const match = selectProviderByLanguage(providers, 'typescript', {
      rust: 'a',
      '*': 'fallback',
    });
    expect(match?.id).toBe('fallback');
  });

  it('matches provider.model and provider.label as aliases (not just provider.id)', () => {
    const providers: ProviderProfile[] = [
      makeProvider({ id: 'a', model: 'miniMax-M2.7', label: 'MiniMax V2.7' }),
      makeProvider({ id: 'b', model: 'model-b' }),
    ];
    const match = selectProviderByLanguage(providers, 'python', { python: 'MiniMax-M2.7' });
    expect(match?.id).toBe('a');
  });

  it('returns undefined when no rule matches', () => {
    const providers: ProviderProfile[] = [makeProvider({ id: 'a' })];
    expect(selectProviderByLanguage(providers, 'python', { rust: 'a' })).toBeUndefined();
    expect(selectProviderByLanguage(providers, undefined, { rust: 'a' })).toBeUndefined();
    expect(selectProviderByLanguage(providers, 'python', undefined)).toBeUndefined();
  });

  it('falls back to selectProvider() when no language match is found', () => {
    const providers: ProviderProfile[] = [
      makeProvider({ id: 'a', model: 'model-a' }),
      makeProvider({ id: 'b', model: 'model-b' }),
    ];
    const match = selectProviderWithLanguage(providers, 'model-a', undefined, 'rust', { rust: 'no-such-id' });
    expect(match?.id).toBe('a');
  });

  it('language-routed provider wins over the model-picker when both could match', () => {
    const providers: ProviderProfile[] = [
      makeProvider({ id: 'a', model: 'model-a' }),
      makeProvider({ id: 'b', model: 'model-b' }),
    ];
    const match = selectProviderWithLanguage(providers, 'model-a', undefined, 'python', { python: 'b' });
    expect(match?.id).toBe('b');
  });

  it('skips disabled providers in the language-routed match', () => {
    const providers: ProviderProfile[] = [
      makeProvider({ id: 'a' }),
      makeProvider({ id: 'b', enabled: false }),
    ];
    const match = selectProviderByLanguage(providers, 'rust', { rust: 'b' });
    expect(match).toBeUndefined();
  });
});

describe('detectLanguageHintFromPayload (request body filename scan)', () => {
  it('detects python from a fenced ```python path/to/file.py``` snippet', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Fix this bug:\n```python\n# /home/me/proj/src/foo.py\nimport x\n```' },
      ],
    };
    expect(detectLanguageHintFromPayload(payload)).toBe('python');
  });

  it('detects rust from a `path/to/file.rs` reference in plain text', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Look at src/main.rs and tell me why this fails.' },
      ],
    };
    expect(detectLanguageHintFromPayload(payload)).toBe('rust');
  });

  it('returns undefined when no recognisable filename appears', () => {
    const payload = {
      messages: [{ role: 'user', content: 'Hello, no code here.' }],
    };
    expect(detectLanguageHintFromPayload(payload)).toBeUndefined();
  });

  it('returns undefined for an empty / non-object body', () => {
    expect(detectLanguageHintFromPayload(undefined)).toBeUndefined();
    expect(detectLanguageHintFromPayload(null)).toBeUndefined();
    expect(detectLanguageHintFromPayload('not an object')).toBeUndefined();
  });

  it('scans at most the first 20 messages for safety', () => {
    // Pad 25 messages with no filenames; the helper must not
    // process all of them.
    const messages = Array.from({ length: 25 }, () => ({
      role: 'user' as const,
      content: 'no code',
    }));
    expect(detectLanguageHintFromPayload({ messages })).toBeUndefined();
  });
});

// ============================================================================
// Item #4: zero-conf discovery beacon
// ============================================================================
describe('buildClientConfigSnippets', () => {
  it('produces snippets for Continue, Kilo Code, OpenAI SDK, and curl', () => {
    const snippets = buildClientConfigSnippets('127.0.0.1', 8787);
    const ids = snippets.map((s) => s.id);
    expect(ids).toContain('continue');
    expect(ids).toContain('kilocode');
    expect(ids).toContain('openai-sdk');
    expect(ids).toContain('curl');
  });

  it('every snippet points at the supplied host:port', () => {
    const snippets = buildClientConfigSnippets('127.0.0.1', 9000);
    for (const snippet of snippets) {
      expect(snippet.config).toContain('127.0.0.1:9000/v1');
    }
  });

  it('custom port flows through every snippet', () => {
    const snippets = buildClientConfigSnippets('10.0.0.5', 9999);
    for (const snippet of snippets) {
      expect(snippet.config).toContain('10.0.0.5:9999/v1');
    }
  });
});

describe('GatewayService - /v1/discovery endpoint', () => {
  let service: GatewayService;
  let port: number;

  beforeEach(async () => {
    service = new GatewayService(
      makeBaseConfig({
        discovery: {
          enabled: true,
          // CR02 B4: out-of-range ports are now clamped + warned at
          // runtime. Use a high, valid port so the test exercises the
          // happy path without colliding with anything else on the
          // host. 60 s interval keeps the broadcast quiet during
          // the test run.
          broadcastPort: 18_787,
          broadcastIntervalMs: 60_000,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    port = Number(parsed.port);
  });

  afterEach(async () => {
    await service.stop();
  });

  it('serves a discovery payload on /v1/discovery when enabled', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/discovery`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { enabled: boolean; broadcasting: boolean; port: number; clients: Array<{ id: string }> };
    expect(body.enabled).toBe(true);
    expect(body.port).toBeGreaterThan(0);
    expect(Array.isArray(body.clients)).toBe(true);
    expect(body.clients.length).toBeGreaterThan(0);
  });

  it('does NOT advertise clients when /v1/discovery is disabled', async () => {
    await service.stop();
    service = new GatewayService(
      makeBaseConfig({
        discovery: {
          enabled: false,
          broadcastPort: 18_787,
          broadcastIntervalMs: 60_000,
        },
      }),
    );
    const status = await service.start();
    const parsed = new URL(status.baseUrl);
    const disabledPort = Number(parsed.port);
    const response = await fetch(`http://127.0.0.1:${disabledPort}/v1/discovery`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { enabled: boolean; message?: string };
    expect(body.enabled).toBe(false);
    expect(body.message).toMatch(/disabled/);
  });
});

// helpers ----------------------------------------------------------

function makeBaseConfig(overrides: { discovery?: { enabled: boolean; broadcastPort: number; broadcastIntervalMs: number } } = {}): import('../src/aiflowbridge/types').AiFlowBridgeConfig {
  return {
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
      workspaceContext: {
        enabled: false,
        root: '',
        maxDepth: 2,
        ignoredDirs: [],
      },
      languageRouting: {},
      discovery: {
        enabled: false,
        broadcastPort: 18_787,
        broadcastIntervalMs: 2_000,
      },
      ...overrides,
    },
    providers: [
      {
        id: 'p1',
        label: 'Provider 1',
        kind: 'openai-compat',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-1',
        apiKey: 'sk-test',
        enabled: true,
      },
    ],
    telemetryEnabled: false,
    logRequests: false,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
  };
}

// ============================================================================
// CR02 A2: prependSystemMessage helper (placement is part of the
// user-visible prompt contract).
// ============================================================================
describe('prependSystemMessage', () => {
  it('inserts the prefix as the first system message', () => {
    const out = prependSystemMessage({ messages: [{ role: 'system', content: 'USER' }] }, 'CTX');
    expect(out.messages).toEqual([
      { role: 'system', content: 'CTX' },
      { role: 'system', content: 'USER' },
    ]);
  });

  it('does not mutate the input payload', () => {
    const input = { messages: [{ role: 'user', content: 'hi' }] };
    const snapshot = JSON.parse(JSON.stringify(input));
    prependSystemMessage(input, 'CTX');
    expect(input).toEqual(snapshot);
  });

  it('treats a non-array messages field as an empty array', () => {
    const out = prependSystemMessage({ messages: 'not-an-array' as unknown as never }, 'CTX');
    expect(out.messages).toEqual([{ role: 'system', content: 'CTX' }]);
  });

  it('preserves array-typed content on existing messages', () => {
    const out = prependSystemMessage(
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'multi' }] }] },
      'CTX'
    );
    expect(out.messages[0]).toEqual({ role: 'system', content: 'CTX' });
    expect(out.messages[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'multi' }] });
  });
});

// ============================================================================
// CR02 B1 + `/review uncommitted` F1: detectWorkspaceContextCached
// is now TTL-only (no per-hit statSync). The cache returns the
// same instance until the 5 s TTL expires or `clearWorkspaceContextCache`
// is called. Mtime changes do NOT invalidate the cache by themselves
// (the original F1 review flagged the unconditional statSync on
// every cache hit as defeating the cache's purpose on Windows).
// ============================================================================
describe('detectWorkspaceContextCached (CR02 B1 + review F1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiflowbridge-wctx-cache-'));
    clearWorkspaceContextCache();
  });
  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    clearWorkspaceContextCache();
  });

  it('returns the same context across calls within the TTL window', () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    const first = detectWorkspaceContextCached(dir);
    const second = detectWorkspaceContextCached(dir);
    expect(second).toBe(first);
  });

  it('does NOT re-walk on every cache hit (no per-hit statSync)', () => {
    // `/review uncommitted` F1: the previous implementation called
    // rootMtimeMs() on every cache hit. Verify the cache hit does
    // not require a fresh walk even when files change under the root.
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    const first = detectWorkspaceContextCached(dir);
    // Add a new manifest file - the cache should still serve the
    // original context (no TTL expiry yet).
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "y"\n');
    const second = detectWorkspaceContextCached(dir);
    expect(second).toBe(first);
  });

  it('clearWorkspaceContextCache drops every cached entry', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    const first = detectWorkspaceContextCached(dir);
    clearWorkspaceContextCache();
    const second = detectWorkspaceContextCached(dir);
    expect(second).not.toBe(first);
  });
});

// ============================================================================
// CR02 B3: resolveLanguageHint caps the X-AIFlowBridge-Language
// header to MAX_LANGUAGE_HINT_HEADER_LENGTH chars.
// ============================================================================
describe('resolveLanguageHint (CR02 B3 header cap)', () => {
  function fakeRequest(headerValue: string | string[] | undefined): { headers: Record<string, string | string[]> } {
    const headers: Record<string, string | string[]> = {};
    if (headerValue !== undefined) {
      headers['x-aiflowbridge-language'] = headerValue;
    }
    return { headers };
  }

  const baseConfig = {
    gateway: {
      enabled: true,
      port: 0,
      baseUrl: 'http://127.0.0.1:0',
      defaultModel: '',
      probeTimeoutMs: 500,
      maxConcurrentRequests: 1,
      languageRouting: {},
    },
    providers: [],
    telemetryEnabled: false,
    logRequests: false,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
  } as unknown as Parameters<typeof resolveLanguageHint>[2];

  it('accepts a short, well-formed language tag', () => {
    expect(resolveLanguageHint(fakeRequest('python') as never, undefined, baseConfig)).toBe('python');
  });

  it('rejects an empty header', () => {
    expect(resolveLanguageHint(fakeRequest('   ') as never, undefined, baseConfig)).toBeUndefined();
  });

  it('rejects a header past MAX_LANGUAGE_HINT_HEADER_LENGTH chars', () => {
    const longHeader = 'a'.repeat(MAX_LANGUAGE_HINT_HEADER_LENGTH + 1);
    expect(resolveLanguageHint(fakeRequest(longHeader) as never, undefined, baseConfig)).toBeUndefined();
  });

  it('accepts a header at exactly MAX_LANGUAGE_HINT_HEADER_LENGTH chars', () => {
    const exactHeader = 'a'.repeat(MAX_LANGUAGE_HINT_HEADER_LENGTH);
    const result = resolveLanguageHint(fakeRequest(exactHeader) as never, undefined, baseConfig);
    expect(result).toBe(exactHeader);
  });
});

// ============================================================================
// CR02 A3 / B4: DiscoveryBeacon clamps broadcastPort +
// broadcastIntervalMs into valid ranges.
// ============================================================================
describe('DiscoveryBeacon runtime validation (CR02 A3 / B4)', () => {
  it('falls back to the default port when broadcastPort is out of range', () => {
    const beacon = new DiscoveryBeacon({
      host: '127.0.0.1',
      port: 8787,
      version: '2.7.0',
      broadcastPort: 0,
    });
    expect(beacon.endpointPayload().broadcastPort).toBe(8788);
    beacon.stop();
  });

  it('clamps a too-low broadcastIntervalMs to the minimum', () => {
    const beacon = new DiscoveryBeacon({
      host: '127.0.0.1',
      port: 8787,
      version: '2.7.0',
      broadcastPort: 18_787,
      broadcastIntervalMs: 10,
    });
    expect(beacon.endpointPayload().broadcastIntervalMs).toBe(500);
    beacon.stop();
  });

  it('clamps a too-high broadcastIntervalMs to the ceiling', () => {
    const beacon = new DiscoveryBeacon({
      host: '127.0.0.1',
      port: 8787,
      version: '2.7.0',
      broadcastPort: 18_787,
      broadcastIntervalMs: 24 * 60 * 60_000,
    });
    expect(beacon.endpointPayload().broadcastIntervalMs).toBe(5 * 60_000);
    beacon.stop();
  });

  it('accepts a valid configuration unchanged', () => {
    const beacon = new DiscoveryBeacon({
      host: '127.0.0.1',
      port: 8787,
      version: '2.7.0',
      broadcastPort: 18_787,
      broadcastIntervalMs: 3_000,
    });
    const payload = beacon.endpointPayload();
    expect(payload.broadcastPort).toBe(18_787);
    expect(payload.broadcastIntervalMs).toBe(3_000);
    beacon.stop();
  });
});

// ============================================================================
// `/review uncommitted` F4: X-AIFlowBridge-Language header cap is
// applied on the raw length, BEFORE trim(). The previous fix called
// trim() first, which would walk a multi-MB hostile header before
// the cap rejected it.
// ============================================================================
describe('resolveLanguageHint header cap is applied before trim (review F4)', () => {
  function fakeRequest(headerValue: string | string[] | undefined): { headers: Record<string, string | string[]> } {
    const headers: Record<string, string | string[]> = {};
    if (headerValue !== undefined) {
      headers['x-aiflowbridge-language'] = headerValue;
    }
    return { headers };
  }

  const baseConfig = {
    gateway: {
      enabled: true,
      port: 0,
      baseUrl: 'http://127.0.0.1:0',
      defaultModel: '',
      probeTimeoutMs: 500,
      maxConcurrentRequests: 1,
      languageRouting: {},
    },
    providers: [],
    telemetryEnabled: false,
    logRequests: false,
    visionProxy: { excludedVendors: [], copilotVisionModel: '' },
  } as unknown as Parameters<typeof resolveLanguageHint>[2];

  it('rejects a header with raw length > MAX even when trim would shorten it', () => {
    // 1 MB of trailing whitespace. trim() would walk the buffer and
    // allocate a 1-char string; the cap must short-circuit on the
    // raw length first.
    const longHeader = 'a' + ' '.repeat(MAX_LANGUAGE_HINT_HEADER_LENGTH + 100);
    expect(resolveLanguageHint(fakeRequest(longHeader) as never, undefined, baseConfig)).toBeUndefined();
  });
});

// ============================================================================
// `/review uncommitted` F6: FILENAME_PATTERN must NOT match URLs
// (the documented `(?!\.\.)` lookahead was missing from the regex).
// ============================================================================
describe('detectLanguageHintFromPayload excludes URLs (review F6)', () => {
  it('does not match a .py path inside a URL', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'See https://docs.example.com/api/foo.py for details.' },
      ],
    };
    expect(detectLanguageHintFromPayload(payload)).toBeUndefined();
  });

  it('does not match a path-traversal reference', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Look at ../foo.py for the previous version.' },
      ],
    };
    expect(detectLanguageHintFromPayload(payload)).toBeUndefined();
  });

  it('still matches a bare filename in plain prose', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Look at src/main.rs and tell me why this fails.' },
      ],
    };
    expect(detectLanguageHintFromPayload(payload)).toBe('rust');
  });
});

// ============================================================================
// `/review uncommitted` F8 (deploy safety): cwd fallback in
// resolveContextRoot must require a project sentinel and refuse
// to inject when the cwd equals the gateway's install path.
// ============================================================================
describe('resolveContextRoot cwd sentinel + install-dir guard (review F8)', () => {
  const baseSettings = { enabled: true, root: '', maxDepth: 2, ignoredDirs: [] };

  it('returns undefined when cwd has no project sentinel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiflowbridge-empty-cwd-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(dir);
      // F8: cwd fallback requires a project sentinel; an empty
      // tmp dir does not qualify.
      expect(resolveContextRoot(baseSettings, ['package.json', 'pyproject.toml', '.git'])).toBeUndefined();
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the cwd when it has a project sentinel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiflowbridge-proj-cwd-'));
    writeFileSync(join(dir, 'package.json'), '{"name": "demo"}');
    const previousCwd = process.cwd();
    try {
      process.chdir(dir);
      expect(resolveContextRoot(baseSettings, ['package.json'])).toBe(dir);
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when cwd has no project sentinel AND no explicit root', () => {
    // F8: an empty temp dir (no project sentinel) cannot be used
    // as a workspace via the cwd fallback. With no explicit root
    // and no env var, the helper returns undefined.
    const previousCwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'aiflowbridge-empty-cwd-'));
    try {
      process.chdir(dir);
      expect(
        resolveContextRoot(baseSettings, ['package.json', 'pyproject.toml', '.git']),
      ).toBeUndefined();
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to cwd when the explicit root is a non-directory file (review F7)', () => {
    // F7: the explicit-root failure path now falls back to the
    // cwd when the cwd carries a project sentinel. The warning
    // is logged once (we do not assert on the log line in this
    // test - it would need a logger spy).
    const previousCwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), 'aiflowbridge-warn-'));
    const filePath = join(tmp, 'not-a-dir.txt');
    writeFileSync(filePath, 'hello');
    try {
      // AIFlowBridge repo root is the cwd and carries
      // package.json, so the cwd fallback is allowed.
      process.chdir(previousCwd);
      const result = resolveContextRoot(
        { ...baseSettings, root: filePath },
        ['package.json'],
      );
      // The explicit root was rejected; the cwd fallback kicked in
      // and (because the cwd carries package.json) returned the cwd.
      expect(result).toBe(previousCwd);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// `/review uncommitted` F5: DiscoveryBeacon must not start
// broadcasting after `stop()` was called, even if the bind
// callback has not yet fired.
// ============================================================================
describe('DiscoveryBeacon start/stop race (review F5)', () => {
  it('does not start broadcasting when stop() runs before bind callback fires', async () => {
    const beacon = new DiscoveryBeacon({
      host: '127.0.0.1',
      port: 8787,
      version: '2.7.0',
      broadcastPort: 18_787,
      broadcastIntervalMs: 60_000,
    });
    beacon.start();
    // Synchronously stop before the async bind callback has a
    // chance to schedule the timer.
    beacon.stop();
    // Wait a few event-loop ticks to let any pending bind callback
    // run if it were going to.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(beacon.isRunning()).toBe(false);
  });

  it('a second start() after stop() works correctly', async () => {
    const beacon = new DiscoveryBeacon({
      host: '127.0.0.1',
      port: 8787,
      version: '2.7.0',
      broadcastPort: 18_787,
      broadcastIntervalMs: 60_000,
    });
    beacon.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    beacon.stop();
    beacon.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(beacon.isRunning()).toBe(true);
    beacon.stop();
  });
});
