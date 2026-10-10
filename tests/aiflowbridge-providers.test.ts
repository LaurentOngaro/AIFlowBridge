/**
 * Unit tests for src/aiflowbridge/providers.ts
 * Tests normalizeProviderProfiles, selectProvider, buildModelCatalog.
 */

import { describe, expect, it } from 'vitest';
import {
  buildModelCatalog,
  isValidProviderBaseUrl,
  MAX_UPSTREAM_REDIRECTS,
  normalizeHost,
  normalizeProviderProfiles,
  resolveProviderRedirect,
  selectProvider,
} from '../src/aiflowbridge/providers';

describe('normalizeProviderProfiles', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeProviderProfiles(null)).toEqual([]);
    expect(normalizeProviderProfiles(undefined)).toEqual([]);
    expect(normalizeProviderProfiles('not an array')).toEqual([]);
    expect(normalizeProviderProfiles({ id: 'p1' })).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(normalizeProviderProfiles([])).toEqual([]);
  });

  it('preserves valid profiles as-is', () => {
    const input = [
      {
        id: 'p1',
        label: 'Provider 1',
        kind: 'openai-compat',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-1',
        apiKey: 'sk-123',
      },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'p1',
      label: 'Provider 1',
      kind: 'openai-compat',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-1',
      apiKey: 'sk-123',
      enabled: true,
    });
  });

  it('drops profiles with missing required fields', () => {
    const input = [
      { id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm' },
      { id: '', label: 'L2', baseUrl: 'https://x', model: 'm' },
      { id: 'p3', label: '', baseUrl: 'https://x', model: 'm' },
      { id: 'p4', label: 'L4', baseUrl: '', model: 'm' },
      { id: 'p5', label: 'L5', baseUrl: 'https://x', model: '' },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('drops non-object entries', () => {
    const input = [null, undefined, 'string', 42, true, { id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm' }];
    const result = normalizeProviderProfiles(input as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('normalizes kind to openai-compat for invalid values', () => {
    const input = [
      { id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm', kind: 'invalid-kind' },
      { id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', kind: undefined },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].kind).toBe('openai-compat');
    expect(result[1].kind).toBe('openai-compat');
  });

  it('accepts ollama as valid kind', () => {
    const input = [{ id: 'p1', label: 'L1', baseUrl: 'http://localhost:11434', model: 'llama3', kind: 'ollama' }];
    const result = normalizeProviderProfiles(input);
    expect(result[0].kind).toBe('ollama');
  });

  it('marks explicit billing plan on the normalized profile', () => {
    const input = [{ id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm', billing: 'plan' }];
    const result = normalizeProviderProfiles(input);
    expect(result[0].billing).toBe('plan');
  });

  it('leaves per-token profiles without a billing field', () => {
    const input = [{ id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm' }];
    const result = normalizeProviderProfiles(input);
    expect(result[0].billing).toBeUndefined();
  });

  it('does not infer plan billing from a Google vendor kind', () => {
    // An OAuth-flavoured transport does not prove a subscription covers
    // the usage, so nothing is inferred from the kind any more. The
    // profiles are also REFUSED at request time by the transport policy;
    // this assertion is only about the billing stamp.
    const input = [
      { id: 'g1', label: 'G1', baseUrl: 'https://cloudcode-pa.googleapis.com', model: 'gemini-3.8-flash', kind: 'googleaistudio' },
      { id: 'a1', label: 'A1', baseUrl: 'https://cloudcode-pa.googleapis.com', model: 'gemini-3.8-flash', kind: 'antigravity' },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].billing).toBeUndefined();
    expect(result[1].billing).toBeUndefined();
  });

  it('does not force plan billing for the BYOK Google AI Studio route', () => {
    // The BYOK path uses `generativelanguage.googleapis.com` (no OAuth).
    // Plan-coverage would mask a real per-token charge, so the gateway
    // must keep it per-token.
    const input = [
      { id: 'g1', label: 'G1', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash' },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].billing).toBeUndefined();
  });

  it('respects an explicit billing flag on a BYOK profile', () => {
    // Future-proofing: if the user has a MiniMax token-plan style
    // setup for a BYOK upstream, the explicit flag must be honoured.
    const input = [
      { id: 'g1', label: 'G1', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash', billing: 'plan' },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].billing).toBe('plan');
  });

  it('preserves enabled=false', () => {
    const input = [
      { id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm', enabled: false },
      { id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', enabled: true },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].enabled).toBe(false);
    expect(result[1].enabled).toBe(true);
  });

  it('defaults enabled to true when missing or invalid', () => {
    const input = [
      { id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm' },
      { id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', enabled: 'yes' },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].enabled).toBe(true);
    expect(result[1].enabled).toBe(true);
  });

  it('trims whitespace from string fields', () => {
    const input = [{ id: '  p1  ', label: '  L1  ', baseUrl: '  https://x  ', model: '  m  ', apiKey: '  sk-1  ' }];
    const result = normalizeProviderProfiles(input);
    expect(result[0]).toMatchObject({
      id: 'p1',
      label: 'L1',
      baseUrl: 'https://x',
      model: 'm',
      apiKey: 'sk-1',
    });
  });

  it('uses id as label fallback when label is missing', () => {
    const input = [{ id: 'p1', baseUrl: 'https://x', model: 'm' }];
    const result = normalizeProviderProfiles(input);
    expect(result[0].label).toBe('p1');
  });

  it('preserves pricing when valid', () => {
    const input = [
      {
        id: 'p1',
        label: 'L1',
        baseUrl: 'https://x',
        model: 'm',
        pricing: { inputPerMillion: 1.5, outputPerMillion: 2.0, currency: 'EUR' },
      },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].pricing).toEqual({
      inputPerMillion: 1.5,
      outputPerMillion: 2.0,
      currency: 'EUR',
    });
  });

  it('drops invalid pricing object', () => {
    const input = [
      { id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm', pricing: 'invalid' },
      { id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', pricing: 42 },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].pricing).toBeUndefined();
    expect(result[1].pricing).toBeUndefined();
  });

  it('defaults pricing currency to USD when missing', () => {
    const input = [
      {
        id: 'p1',
        label: 'L1',
        baseUrl: 'https://x',
        model: 'm',
        pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      },
    ];
    const result = normalizeProviderProfiles(input);
    expect(result[0].pricing?.currency).toBe('USD');
  });
});

describe('selectProvider', () => {
  const providers = [
    {
      id: 'deepseek-flash',
      label: 'DeepSeek Flash',
      kind: 'openai-compat' as const,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      enabled: true,
    },
    {
      id: 'minimax',
      label: 'MiniMax',
      kind: 'openai-compat' as const,
      baseUrl: 'https://api.minimax.io/v1',
      model: 'MiniMax-M2.7',
      enabled: true,
    },
    {
      id: 'disabled',
      label: 'Disabled',
      kind: 'openai-compat' as const,
      baseUrl: 'https://x',
      model: 'm',
      enabled: false,
    },
  ];

  it('returns undefined for empty providers', () => {
    expect(selectProvider([])).toBeUndefined();
  });

  it('returns undefined when no model is requested and no default is configured', () => {
    // Previously this returned the only enabled provider as a silent
    // fallback. The new behavior is to return undefined so the gateway
    // can surface a clear 404 to the client. (The gateway has its own
    // "no enabled providers" check that returns 503 instead.)
    const onlyOne = [providers[0]];
    expect(selectProvider(onlyOne, undefined, undefined)).toBeUndefined();
  });

  it('matches by requested model id (case-insensitive)', () => {
    expect(selectProvider(providers, 'DEEPSEEK-FLASH', undefined)).toBe(providers[0]);
  });

  it('matches by upstream model name', () => {
    expect(selectProvider(providers, 'MiniMax-M2.7', undefined)).toBe(providers[1]);
  });

  it('matches by label', () => {
    expect(selectProvider(providers, 'DeepSeek Flash', undefined)).toBe(providers[0]);
  });

  it('falls back to defaultModel when requestedModel has no match', () => {
    expect(selectProvider(providers, 'unknown', 'minimax')).toBe(providers[1]);
  });

  it('hides a profile on the retired Google product OAuth transport', () => {
    // Listing a model the gateway will deterministically refuse would
    // point the user at a picker entry that always fails.
    const providers = [
      {
        id: 'legacy',
        label: 'Legacy',
        kind: 'googleaistudio' as const,
        baseUrl: 'https://cloudcode-pa.googleapis.com',
        model: 'gemini-3.8-flash',
        enabled: true,
      },
      {
        id: 'byok',
        label: 'Gemini 3.8 Flash',
        kind: 'openai-compat' as const,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-3.8-flash',
        enabled: true,
      },
    ];
    const catalog = buildModelCatalog(providers);
    expect(catalog.map((entry) => entry.id)).toEqual(['byok']);
  });

  it('skips disabled providers', () => {
    const result = selectProvider(providers, 'disabled', undefined);
    expect(result).not.toBe(providers[2]);
    expect(result?.id).not.toBe('disabled');
  });

  it('returns undefined when nothing matches (no silent fallback to first provider)', () => {
    // Previously the gateway silently fell back to the first enabled
    // provider, which could route a request for "mimo-v2.5" to
    // DeepSeek V4 Flash. The fix is to return undefined and let the
    // gateway surface a clear 404 to the client.
    const result = selectProvider(providers, 'unknown', 'also-unknown');
    expect(result).toBeUndefined();
  });

  it('returns undefined when there are no enabled providers', () => {
    const allDisabled = providers.map((p) => ({ ...p, enabled: false }));
    const result = selectProvider(allDisabled, 'deepseek-flash', undefined);
    expect(result).toBeUndefined();
  });
});

describe('buildModelCatalog', () => {
  it('returns empty array when no enabled providers', () => {
    const providers = [
      {
        id: 'p1',
        label: 'L1',
        kind: 'openai-compat' as const,
        baseUrl: 'https://x',
        model: 'm',
        enabled: false,
      },
    ];
    expect(buildModelCatalog(providers)).toEqual([]);
  });

  it('returns OpenAI-compatible model entries for enabled providers', () => {
    const providers = [
      {
        id: 'p1',
        label: 'Provider 1',
        kind: 'openai-compat' as const,
        baseUrl: 'https://x',
        model: 'model-1',
        enabled: true,
      },
      {
        id: 'p2',
        label: 'Provider 2',
        kind: 'openai-compat' as const,
        baseUrl: 'https://x',
        model: 'model-2',
        enabled: true,
      },
    ];
    const catalog = buildModelCatalog(providers);
    expect(catalog).toHaveLength(2);
    expect(catalog[0]).toMatchObject({
      id: 'p1',
      object: 'model',
      owned_by: 'aiflowbridge',
      name: 'Provider 1 (model-1)',
    });
    expect(catalog[1].id).toBe('p2');
    expect(typeof catalog[0].created).toBe('number');
  });

  it('skips disabled providers', () => {
    const providers = [
      {
        id: 'p1',
        label: 'L1',
        kind: 'openai-compat' as const,
        baseUrl: 'https://x',
        model: 'm',
        enabled: true,
      },
      {
        id: 'p2',
        label: 'L2',
        kind: 'openai-compat' as const,
        baseUrl: 'https://x',
        model: 'm',
        enabled: false,
      },
    ];
    const catalog = buildModelCatalog(providers);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe('p1');
  });
});

describe('isValidProviderBaseUrl (SSRF protection)', () => {
  // Allow-list: legitimate provider URLs.
  it('accepts https on a public hostname', () => {
    expect(isValidProviderBaseUrl('https://api.example.com/v1')).toBe(true);
  });

  it('accepts http on a public hostname', () => {
    expect(isValidProviderBaseUrl('http://api.example.com/v1')).toBe(true);
  });

  it('accepts the OpenRouter baseUrl (public https, non-loopback, non-metadata)', () => {
    // Sanity check that the SSRF filter does not accidentally reject
    // the OpenRouter baseUrl shipped in resources/models.json.
    // Regression-tested in tests/integration/openrouter.smoke.test.ts.
    expect(isValidProviderBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
  });

  it('accepts http on loopback (Ollama use case)', () => {
    expect(isValidProviderBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isValidProviderBaseUrl('http://localhost:11434/v1')).toBe(true);
    // IPv6 loopback - Ollama and other local tools bind ::1 too.
    expect(isValidProviderBaseUrl('http://[::1]:11434/v1')).toBe(true);
  });

  // Block-list: cloud metadata endpoints.
  it('rejects AWS / GCP / Azure metadata (169.254.169.254)', () => {
    expect(isValidProviderBaseUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('rejects Alibaba Cloud metadata (100.100.100.200)', () => {
    expect(isValidProviderBaseUrl('http://100.100.100.200/latest/meta-data/')).toBe(false);
  });

  it('rejects Oracle Cloud metadata (192.0.0.192)', () => {
    expect(isValidProviderBaseUrl('http://192.0.0.192/opc/v2/instance/')).toBe(false);
  });

  it('rejects the metadata endpoints that are reachable only by name', () => {
    // An IP-literal block list can never close these: the name resolves to
    // 169.254.169.254 only after the check has already passed.
    expect(isValidProviderBaseUrl('http://metadata.google.internal/computeMetadata/v1/')).toBe(false);
    expect(isValidProviderBaseUrl('http://metadata/computeMetadata/v1/')).toBe(false);
    expect(isValidProviderBaseUrl('http://metadata.goog/computeMetadata/v1/')).toBe(false);
    expect(isValidProviderBaseUrl('http://metadata.google.internal:80/')).toBe(false);
  });

  it('still accepts a public host whose name merely starts with metadata', () => {
    expect(isValidProviderBaseUrl('https://metadata-api.example.com/v1')).toBe(true);
  });

  // Scheme whitelist.
  it('rejects non-http(s) schemes', () => {
    expect(isValidProviderBaseUrl('file:///etc/passwd')).toBe(false);
    expect(isValidProviderBaseUrl('gopher://example.com/')).toBe(false);
    expect(isValidProviderBaseUrl('javascript:alert(1)')).toBe(false);
  });

  // Parse failures.
  it('rejects unparseable URLs', () => {
    expect(isValidProviderBaseUrl('not a url')).toBe(false);
    expect(isValidProviderBaseUrl('')).toBe(false);
  });
});

describe('resolveProviderRedirect (upstream redirect guard)', () => {
  const UPSTREAM = 'https://api.example.com/v1/chat/completions';

  it('follows a same-host absolute hop', () => {
    const decision = resolveProviderRedirect(UPSTREAM, 'https://api.example.com/v2/chat/completions', 0);
    expect(decision.follow).toBe(true);
    expect(decision.url).toBe('https://api.example.com/v2/chat/completions');
  });

  it('follows a same-host relative hop and resolves it against the current URL', () => {
    const decision = resolveProviderRedirect(UPSTREAM, '/v3/chat/completions', 0);
    expect(decision.follow).toBe(true);
    expect(decision.url).toBe('https://api.example.com/v3/chat/completions');
  });

  it('follows an http to https upgrade on the same host', () => {
    const decision = resolveProviderRedirect('http://api.example.com/v1/chat/completions', 'https://api.example.com/v1/chat/completions', 0);
    expect(decision.follow).toBe(true);
  });

  it('refuses a hop to another host', () => {
    // The exact SSRF shape: an accepted baseUrl that relays to a host the
    // user never configured, which would replay the whole prompt.
    const decision = resolveProviderRedirect(UPSTREAM, 'https://attacker.test/collect', 0);
    expect(decision.follow).toBe(false);
    expect(decision.reason).toContain('leaves the upstream host');
  });

  it('refuses a hop to a cloud metadata endpoint', () => {
    expect(resolveProviderRedirect(UPSTREAM, 'http://169.254.169.254/latest/meta-data/', 0).follow).toBe(false);
    expect(resolveProviderRedirect(UPSTREAM, 'http://metadata.google.internal/', 0).follow).toBe(false);
    expect(resolveProviderRedirect(UPSTREAM, 'http://192.0.0.192/', 0).follow).toBe(false);
  });

  it('refuses a hop that only looks same-host through an IP-mapped form', () => {
    const decision = resolveProviderRedirect(UPSTREAM, 'http://[::ffff:169.254.169.254]/', 0);
    expect(decision.follow).toBe(false);
  });

  it('refuses a hop once the redirect budget is spent', () => {
    expect(resolveProviderRedirect(UPSTREAM, '/v2', MAX_UPSTREAM_REDIRECTS).follow).toBe(true);
    const decision = resolveProviderRedirect(UPSTREAM, '/v2', MAX_UPSTREAM_REDIRECTS + 1);
    expect(decision.follow).toBe(false);
    expect(decision.reason).toContain('redirect budget');
  });

  it('refuses an unparseable location', () => {
    expect(resolveProviderRedirect(UPSTREAM, 'http://[', 0).follow).toBe(false);
  });

  it('refuses non-preservational redirect statuses (301, 302, 303)', () => {
    for (const status of [301, 302, 303]) {
      const decision = resolveProviderRedirect(UPSTREAM, '/v2/chat/completions', 0, status);
      expect(decision.follow).toBe(false);
      expect(decision.reason).toContain(`HTTP status ${status} does not preserve the POST method and body`);
    }
  });

  it('refuses a hop that targets the retired Google product OAuth backend', () => {
    // An initially legitimate profile must not be able to reach the
    // retired backend through a redirect. The same-host rule already
    // refuses it today; this test pins the guarantee so relaxing that
    // rule cannot silently reopen the transport.
    const decision = resolveProviderRedirect(UPSTREAM, 'https://cloudcode-pa.googleapis.com/v1internal', 0);
    expect(decision.follow).toBe(false);
  });

  it('accepts preservational redirect statuses (307, 308)', () => {
    for (const status of [307, 308]) {
      const decision = resolveProviderRedirect(UPSTREAM, '/v2/chat/completions', 0, status);
      expect(decision.follow).toBe(true);
      expect(decision.url).toBe('https://api.example.com/v2/chat/completions');
    }
  });
});

describe('normalizeProviderProfiles - rejects blocked baseUrl', () => {
  it('drops the entry when baseUrl points to a metadata IP', () => {
    const result = normalizeProviderProfiles([
      {
        id: 'malicious',
        label: 'Malicious',
        kind: 'openai-compat',
        baseUrl: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
        model: 'm1',
      },
    ]);
    expect(result).toEqual([]);
  });

  it('keeps the entry when baseUrl is loopback (Ollama)', () => {
    const result = normalizeProviderProfiles([
      {
        id: 'ollama',
        label: 'Ollama',
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('ollama');
  });

  it('keeps the entry when baseUrl is a legitimate public host', () => {
    const result = normalizeProviderProfiles([
      {
        id: 'p1',
        label: 'P1',
        kind: 'openai-compat',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe('normalizeHost (IPv4-mapped IPv6 -> IPv4)', () => {
  it('returns decimal IPv4 as-is', () => {
    expect(normalizeHost('169.254.169.254')).toBe('169.254.169.254');
    expect(normalizeHost('127.0.0.1')).toBe('127.0.0.1');
  });

  it('strips brackets from IPv6 hostname (WHATWG URL behavior)', () => {
    // Node 20+ URL.hostname includes brackets for IPv6 addresses.
    expect(normalizeHost('[::ffff:169.254.169.254]')).toBe('169.254.169.254');
    expect(normalizeHost('[::ffff:a9fe:a9fe]')).toBe('169.254.169.254');
  });

  it('strips ::ffff: prefix in decimal form', () => {
    expect(normalizeHost('::ffff:169.254.169.254')).toBe('169.254.169.254');
    expect(normalizeHost('::ffff:127.0.0.1')).toBe('127.0.0.1');
    // Capitalisation variation.
    expect(normalizeHost('::FFFF:127.0.0.1')).toBe('127.0.0.1');
  });

  it('converts hex ::ffff: form to decimal', () => {
    // ::ffff:a9fe:a9fe = 169.254.169.254 (AWS metadata)
    expect(normalizeHost('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    // ::ffff:7f00:1 = 127.0.0.1 (loopback)
    expect(normalizeHost('::ffff:7f00:1')).toBe('127.0.0.1');
    // Mixed case
    expect(normalizeHost('::FFFF:A9FE:A9FE')).toBe('169.254.169.254');
  });

  it('leaves non-IPv4-mapped IPv6 untouched', () => {
    expect(normalizeHost('::1')).toBe('::1');
    expect(normalizeHost('[::1]')).toBe('::1');
    expect(normalizeHost('fd00:ec2::254')).toBe('fd00:ec2::254');
    expect(normalizeHost('api.example.com')).toBe('api.example.com');
  });

  it('rejects hex SSRF bypass via normalizeHost + isValidProviderBaseUrl integration', () => {
    // The decimal form is blocked by BLOCKED_HOSTS. The hex form
    // must also be blocked once normalizeHost converts it.
    expect(isValidProviderBaseUrl('http://[::ffff:a9fe:a9fe]/latest/meta-data/')).toBe(false);
    // Loopback over hex IPv4-mapped IPv6 must still be accepted.
    expect(isValidProviderBaseUrl('http://[::ffff:7f00:1]:11434/v1')).toBe(true);
  });
});
