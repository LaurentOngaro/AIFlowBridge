/**
 * AIFlowBridge - resolveAuthMode helper.
 *
 * Single source of truth for translating a provider profile + branch
 * flag into the dashboard `AuthMode` value. Pure function, no
 * `vscode` import, unit-testable under vitest.
 */

import type { AuthMode, ProviderProfile } from './types';

export interface ResolveAuthModeInput {
  /** Provider profile resolved by the gateway router. */
  provider: Pick<ProviderProfile, 'kind' | 'billing' | 'id'>;
  /**
   * True when the gateway is about to speak the OAuth Antigravity
   * surface (Cloud Code envelope). Passed separately from `provider`
   * because the AGY branch only fires when the resolved baseUrl
   * points at `cloudcode-pa.googleapis.com`, regardless of
   * `provider.kind` (a `googleaistudio` profile with an OAuth base
   * is still OAuth). Mirrors the `isAntigravityBranch` flag in
   * `gateway/server.ts`.
   */
  isAntigravityOAuth: boolean;
}

/**
 * Resolve the auth mode for a gateway request. See `AuthMode` JSDoc
 * in `./types.ts` for the full taxonomy.
 */
export function resolveAuthMode(input: ResolveAuthModeInput): AuthMode {
  if (input.isAntigravityOAuth) {
    return 'oauth';
  }
  if (input.provider.billing === 'plan') {
    return 'plan';
  }
  // The Antigravity / Google AI Studio OAuth path always uses OAuth,
  // so any non-AGY request that resolves an API key is BYOK.
  const kind = input.provider.kind;
  if (kind === 'antigravity' || kind === 'googleaistudio') {
    return 'oauth';
  }
  return 'byok';
}

/**
 * Read the auth mode recorded on an entry, coalescing absent (older
 * snapshots) to `'unknown'`. Mirrors the existing coalesce pattern
 * used by `byClient` and `bySource` so the dashboard never has to
 * handle `undefined` itself.
 */
export function readAuthMode(entry: { authMode?: AuthMode } | undefined): AuthMode {
  return entry?.authMode ?? 'unknown';
}
