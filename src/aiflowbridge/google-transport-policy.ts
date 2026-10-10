/**
 * AIFlowBridge - Google transport policy.
 *
 * The Antigravity / Cloud Code Assist product OAuth transport was retired:
 * Google does not document an authorized third-party integration surface
 * for it, and a consumer Google AI Pro/Ultra entitlement is not a token
 * budget AIFlowBridge may spend on the user's behalf. Rather than
 * removing the code path (which user or workspace overrides can
 * reintroduce), every entry point asks this pure module before it opens a
 * browser, refreshes a token, resolves a credential, or sends an upstream
 * request.
 *
 * Two properties matter and are enforced by the unit tests:
 *
 *   1. **Precision.** The classification is keyed on the normalized
 *      `URL.hostname` (exact match, after lower-casing and dropping a
 *      trailing dot), never on `includes()`. A host such as
 *      `cloudcode-pa.googleapis.com.example.org` is NOT the Google
 *      backend and must stay usable.
 *   2. **Scope.** `family: googleaistudio` covers BOTH the supported
 *      BYOK Gemini API and the retired product OAuth, so the family alone
 *      is never a refusal signal. The metadata-only `vendors.antigravity`
 *      registry entry and the mere word "antigravity" in a label are not
 *      signals either: they select no transport.
 *
 * Pure module: no network, no `vscode` import, no filesystem access.
 */

/**
 * Hostnames of the retired product backend, inventoried from the code
 * that used to call it. Exact hostnames only - never a suffix, because a
 * suffix rule would also refuse `...googleapis.com.example.org`, which is
 * a host the user (or an attacker with a DNS record) fully controls.
 */
export const RETIRED_GOOGLE_PRODUCT_HOSTS: readonly string[] = Object.freeze([
  'cloudcode-pa.googleapis.com',
]);

/** Provider kinds that existed only to select the retired transport. */
export const RETIRED_GOOGLE_PRODUCT_KINDS: readonly string[] = Object.freeze(['antigravity']);

/**
 * Outcome of the transport classification.
 *
 *   - `supported-public-api`: the public Gemini API (BYOK). Allowed.
 *   - `retired-product-oauth`: the removed product OAuth transport.
 *     Refused locally, before any upstream call.
 *   - `not-applicable`: no Google-specific transport involved (every
 *     other vendor). Allowed.
 */
export type GoogleTransportPolicy = 'supported-public-api' | 'retired-product-oauth' | 'not-applicable';

/** Public Gemini API host, kept here so the two Google hosts live together. */
const PUBLIC_GEMINI_HOSTS: readonly string[] = Object.freeze(['generativelanguage.googleapis.com']);

/** Inputs: the effective provider profile fields that decide the transport. */
export interface GoogleTransportInput {
  /** `ProviderProfile.kind` as parsed from settings (may be legacy). */
  readonly kind?: string;
  /** Effective `baseUrl` after registry merge and user overrides. */
  readonly baseUrl?: string;
  /** Requested model id, used only for diagnostics. */
  readonly model?: string;
}

/**
 * Normalize a hostname for exact comparison: lower-case, IPv6 brackets
 * removed, trailing root dot removed. Returns `undefined` for a
 * missing or unparseable input, so callers fall through to "not the
 * retired host" rather than guessing.
 */
export function normalizeGoogleHostname(host: string | undefined): string | undefined {
  if (!host) {
    return undefined;
  }
  const trimmed = host.trim().toLowerCase();
  if (trimmed === '') {
    return undefined;
  }
  // `URL.hostname` keeps the brackets on IPv6 literals
  // (`[::1]`). Strip them so a bracketed and a bare form classify the
  // same way. The provider-level `normalizeHost` does more (IPv4-mapped
  // IPv6 unwrapping), which the SSRF guard already applies upstream of
  // every call site that reaches this module; duplicating it here would
  // make this module depend on `providers.ts` and create an import cycle.
  const withoutBrackets =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  // A fully-qualified name may carry the DNS root dot. `new URL()`
  // keeps it in some inputs, and `example.com.` must classify the same as
  // `example.com`.
  return withoutBrackets.endsWith('.') ? withoutBrackets.slice(0, -1) : withoutBrackets;
}

/**
 * True when the URL points at the retired Antigravity / Cloud Code Assist
 * backend, whatever the provider `kind` says. A generic `openai-compat`
 * profile hand-written by a user is refused exactly like the legacy
 * synthesized one.
 *
 * Unparseable URLs are not a match here; they are rejected earlier by the
 * SSRF guard in `isValidProviderBaseUrl`.
 */
export function isRetiredGoogleProductUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) {
    return false;
  }
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    return false;
  }
  const normalized = normalizeGoogleHostname(host);
  return normalized !== undefined && RETIRED_GOOGLE_PRODUCT_HOSTS.includes(normalized);
}

/**
 * Single decision point for the Google transport policy.
 *
 * Call this before resolving credentials, before building an upstream
 * request, and before each redirect hop.
 */
export function classifyGoogleTransport(input: GoogleTransportInput): GoogleTransportPolicy {
  // A legacy `kind: 'antigravity'` is a transport marker that only ever
  // selected the retired branch, so it is refused whatever the baseUrl
  // says. `kind: 'googleaistudio'` is NOT a marker: BYOK lives in that
  // family and must stay allowed.
  if (input.kind && RETIRED_GOOGLE_PRODUCT_KINDS.includes(input.kind)) {
    return 'retired-product-oauth';
  }
  if (isRetiredGoogleProductUrl(input.baseUrl)) {
    return 'retired-product-oauth';
  }
  const host = normalizeGoogleHostname(safeHostname(input.baseUrl));
  if (host && PUBLIC_GEMINI_HOSTS.includes(host)) {
    return 'supported-public-api';
  }
  return 'not-applicable';
}

/** Convenience wrapper: the profile points at the retired transport. */
export function isRetiredGoogleProductTransport(input: GoogleTransportInput): boolean {
  return classifyGoogleTransport(input) === 'retired-product-oauth';
}

function safeHostname(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Stable machine-readable code for the refusal. Clients and tests branch
 * on this, never on the (localizable) message.
 */
export const GOOGLE_PRODUCT_OAUTH_ERROR_CODE = 'google_product_oauth_unsupported';

/**
 * User-facing refusal. It states three things and nothing else: the
 * transport is gone, no request was sent, and moving to the Gemini API is
 * a separate explicit action that may incur charges. It never promises
 * that attaching a GCP project fixes anything.
 */
export const GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE =
  'Google product OAuth is not supported by AIFlowBridge. Google AI Pro/Ultra entitlements cannot be used through this retired transport. ' +
  'No upstream request was sent. Switching to the Gemini API is a separate, explicit action and may incur API charges.';

/**
 * Build the OpenAI-shaped error envelope returned to clients. The gateway
 * adds its own `requestId` / `providerId` fields next to it; this helper
 * only owns the stable `code` and the message so the standalone CLI and
 * the gateway cannot drift apart.
 */
export function buildGoogleProductOAuthError(): {
  error: { message: string; type: string; code: string };
} {
  return {
    error: {
      message: GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE,
      type: 'service_unavailable_error',
      code: GOOGLE_PRODUCT_OAUTH_ERROR_CODE,
    },
  };
}

/**
 * One-line operator message for the logs. Names the host so a legacy
 * override is identifiable, but never echoes the full URL (a user URL
 * can carry a query string).
 */
export function describeRetiredGoogleTransport(input: GoogleTransportInput): string {
  const host = normalizeGoogleHostname(safeHostname(input.baseUrl)) ?? '<unresolved host>';
  return `Google product OAuth transport refused (host=${host}). ${GOOGLE_PRODUCT_OAUTH_ERROR_CODE}.`;
}