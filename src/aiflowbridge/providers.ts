import type { ProviderProfile } from './types';

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Hostnames that must never appear in a provider `baseUrl` - they
 * resolve to cloud-instance metadata services, which would leak
 * credentials to a hostile extension or a malicious settings.json edit
 * (SSRF). Loopback (`127.x.x.x`, `::1`) is intentionally NOT blocked
 * because Ollama and other local servers need it.
 *
 * The unspecified addresses `0.0.0.0` (IPv4) and `::` (IPv6) are also
 * left open on purpose. They bind-all on the upstream host (the
 * operator's machine, not the gateway's loopback listener) and are the
 * conventional way to expose an Ollama / vLLM / llama.cpp server bound
 * to every interface when running under Docker `--net=host` or a
 * reverse-proxy chain. They are NOT metadata endpoints, so they do not
 * match the SSRF threat model the block list exists to defend. If a
 * future contributor is tempted to add them "to be safe", remember that
 * blocking them breaks the legitimate Docker `--net=host` workflow.
 *
 * Matched against the hostname (lower-case, IPv4-mapped IPv6
 * normalised), NOT the raw string, so `https://169.254.169.254/` and
 * `https://[0xa9fe:a9fe]/` are both rejected.
 */
const BLOCKED_HOSTS: RegExp[] = [
  /^169\.254\./, // AWS / GCP / Azure / OpenStack metadata
  /^100\.100\.100\.200$/, // Alibaba Cloud metadata
  /^fd00:ec2::254$/i, // AWS IMDS over IPv6
];

/**
 * Normalize IPv4-mapped IPv6 addresses back to plain IPv4 so the
 * blocked-host regexes always operate on the canonical decimal form.
 *
 * Two forms exist:
 *   1. Decimal:  `::ffff:169.254.169.254` -> `169.254.169.254`
 *   2. Hex:      `::ffff:a9fe:a9fe`      -> `169.254.169.254`
 *
 * The hex form is the SSRF bypass: a hostile `settings.json` can use
 * `http://[::ffff:a9fe:a9fe]/` and `new URL(...).hostname` will return
 * `::ffff:a9fe:a9fe`, which the decimal-only regex misses.
 *
 * Loopback (`::1`) and native IPv6 (`fd00:ec2::254`) are left
 * untouched - they are matched directly by the BLOCKED_HOSTS patterns.
 */
export function normalizeHost(host: string): string {
  // WHATWG URL.hostname includes brackets for IPv6 addresses
  // (`[::ffff:a9fe:a9fe]`). Strip them unconditionally so the
  // IPv4-mapped patterns below operate on the bare address.
  let bare = host;
  if (bare.startsWith('[') && bare.endsWith(']')) {
    bare = bare.slice(1, -1);
  }

  // Decimal form: ::ffff:1.2.3.4
  const decimal = bare.match(/^::ffff:((?:[0-9]{1,3}\.){3}[0-9]{1,3})$/i);
  if (decimal) return decimal[1];

  // Hex form: ::ffff:x:x, ::ffff:xxxx:xxxx, etc.
  const hex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  return bare;
}

/**
 * Strict provider baseUrl validator. Rejects:
 * - non-HTTP(S) schemes (`file:`, `gopher:`,...)
 * - unparseable URLs
 * - cloud metadata hostnames (`169.254.x.x`, `100.100.100.200`)
 *
 * Allows loopback (`127.x.x.x`, `::1`) on purpose, for Ollama. Exported
 * so the unit tests can assert the matrix without going through the
 * full `normalizeProviderProfiles` shape.
 */
export function isValidProviderBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  const host = normalizeHost(url.hostname.toLowerCase());
  return !BLOCKED_HOSTS.some((pattern) => pattern.test(host));
}

/**
 * return a deep copy of `provider` with the `apiKey` field
 * replaced by a fixed redaction marker (`"***"`) and an explicit
 * `apiKeyPresent` boolean so log readers can tell at a glance whether
 * a key was configured. The original object is left untouched.
 *
 * Use this helper anywhere a `ProviderProfile` (or an array of them)
 * is about to be sent to a logger, JSON-serialized for diagnostics,
 * or attached to a webview message. The runtime currently only
 * stringifies the gateway config, so there is no active leak - this
 * is defense in depth for the inevitable "I added a verbose dump
 * here" future commit.
 *
 * Exported for unit testing (see `tests/aiflowbridge-providers.test.ts`).
 */
export function redactProviderForLog<T extends { apiKey?: string }>(provider: T): T & { apiKeyPresent: boolean } {
  const { apiKey: _apiKey, ...rest } = provider;
  void _apiKey;
  const out = { ...rest } as T & { apiKeyPresent: boolean };
  out.apiKeyPresent = typeof provider.apiKey === 'string' && provider.apiKey.length > 0;
  return out;
}

/**
 * convenience wrapper over `redactProviderForLog` for the
 * most common case - redacting a list of providers. Returns a new
 * array; the input is left untouched.
 */
export function redactProvidersForLog<T extends { apiKey?: string }>(providers: readonly T[]): Array<T & { apiKeyPresent: boolean }> {
  return providers.map((provider) => redactProviderForLog(provider));
}

export function normalizeProviderProfiles(rawProfiles: unknown): ProviderProfile[] {
  if (!Array.isArray(rawProfiles)) {
    return [];
  }

  return rawProfiles
    .map((entry): ProviderProfile | undefined => {
      if (!entry || typeof entry !== 'object') {
        return undefined;
      }

      const candidate = entry as Record<string, unknown>;
      const id = toString(candidate.id);
      const label = toString(candidate.label, id);
      const kind = candidate.kind === 'ollama' ? 'ollama' : 'openai-compat';
      const baseUrl = toString(candidate.baseUrl);
      const model = toString(candidate.model);

      // Strict baseUrl validation: refuse metadata IPs, non-HTTP(S)
      // schemes, and unparseable URLs (see isValidProviderBaseUrl).
      // Each rejected entry is dropped silently (the existing filter
      // drops undefineds) - this matches the policy for malformed
      // provider rows elsewhere in the loader.
      if (!id || !label || !baseUrl || !model || !isValidProviderBaseUrl(baseUrl)) {
        return undefined;
      }

      const pricing = candidate.pricing && typeof candidate.pricing === 'object' ? (candidate.pricing as Record<string, unknown>) : undefined;
      const inputPerMillion = toNumber(pricing?.inputPerMillion, 0);
      const outputPerMillion = toNumber(pricing?.outputPerMillion, 0);

      return {
        id,
        label,
        kind,
        baseUrl,
        model,
        apiKey: toString(candidate.apiKey),
        enabled: toBoolean(candidate.enabled, true),
        // `|| undefined` was removed from inputPerMillion / outputPerMillion:
        // the old expression `toNumber(x, 0) || undefined` collapsed an
        // explicit `0` ("free tokens") into `undefined` ("no pricing"),
        // which silently dropped the pricing block. 0 is now kept as-is;
        // downstream consumers (`formatCostCell`, `estimateCostFromProfile`)
        // already handle 0 correctly (zero-cost display + zero-cost math).
        pricing: pricing
          ? {
              inputPerMillion,
              outputPerMillion,
              currency: toString(pricing.currency, 'USD') || 'USD',
            }
          : undefined,
      };
    })
    .filter((profile): profile is ProviderProfile => Boolean(profile));
}

export function selectProvider(providers: ProviderProfile[], requestedModel?: string, defaultModel?: string): ProviderProfile | undefined {
  const normalizedRequestedModel = requestedModel?.trim();
  const normalizedDefaultModel = defaultModel?.trim();
  const enabledProviders = providers.filter((profile) => profile.enabled);

  // Try the requested model first, then the configured default. If neither
  // matches any provider's id/model/label aliases, return undefined: the
  // gateway should surface a 503 rather than silently route to the first
  // enabled provider (which would lead to calling the wrong upstream API
  // while reporting the wrong model name in the dashboard).
  // use `localeCompare` with `sensitivity: 'base'` so the match
  // is case-insensitive AND accent-insensitive (covers Unicode aliases
  // like "MiniMax-M2.7" vs "minimax-m2.7" AND any future accented
  // identifiers without breaking the ASCII fast path).
  const candidates = [normalizedRequestedModel, normalizedDefaultModel].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const match = enabledProviders.find((profile) => {
      const aliases = [profile.id, profile.model, profile.label];
      return aliases.some((alias) => alias.localeCompare(candidate, undefined, { sensitivity: 'base' }) === 0);
    });
    if (match) {
      return match;
    }
  }

  return undefined;
}

export function buildModelCatalog(providers: ProviderProfile[]): Array<{
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  name: string;
}> {
  // use a stable constant rather than `Date.now()`. The
  // OpenAI `/v1/models` `created` field is meant to be a release
  // timestamp; making it advance on every gateway restart would defeat
  // client-side caching. `0` keeps the field present without
  // misrepresenting creation time. The bundle ships a real
  // per-model `created` via the registry; this is the fallback when
  // synthesizing catalog entries from a `ProviderProfile` that does
  // not have its own `created` field.
  const created = 0;

  return providers
    .filter((profile) => profile.enabled)
    .map((profile) => ({
      id: profile.id,
      object: 'model' as const,
      created,
      owned_by: 'aiflowbridge',
      name: `${profile.label} (${profile.model})`,
    }));
}
