/**
 * AIFlowBridge - resolveAuthMode helper.
 *
 * Single source of truth for translating a provider profile into the
 * dashboard `AuthMode` value. Pure function, no `vscode` import,
 * unit-testable under vitest.
 *
 * The Antigravity / Cloud Code Assist product OAuth transport was retired
 * (see `src/aiflowbridge/google-transport-policy.ts`), so this module no
 * longer has an OAuth branch: no request can be sent over OAuth any more.
 * The `'oauth'` value stays in the `AuthMode` taxonomy because historical
 * on-disk snapshots contain it, and the store / dashboard keep coalescing
 * those entries to `'oauth'` rather than rewriting history.
 */

import type { AuthMode, ProviderProfile } from './types';

export interface ResolveAuthModeInput {
  /** Provider profile resolved by the gateway router. */
  provider: Pick<ProviderProfile, 'kind' | 'billing' | 'id'>;
}

/**
 * Resolve the auth mode for a gateway request. See `AuthMode` JSDoc
 * in `./types.ts` for the full taxonomy.
 *
 * The description is about the TRANSPORT a request was actually sent
 * over, not about a licence the user holds: an `oauth` verdict used to be
 * derived from the presence of an OAuth branch, and a `plan` verdict
 * still comes from the profile's explicit `billing: 'plan'` marker
 * (MiniMax token plan). The retired Google profile kinds are no longer
 * special-cased - a leftover `kind: 'antigravity'` is refused before it
 * ever reaches telemetry.
 */
export function resolveAuthMode(input: ResolveAuthModeInput): AuthMode {
  if (input.provider.billing === 'plan') {
    return 'plan';
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