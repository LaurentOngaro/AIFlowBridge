/**
 * AIFlowBridge - Google AI Studio route resolution.
 *
 * Resolves the effective `baseUrl` for the `googleaistudio` provider
 * family and, historically, toggled between two routes: the BYOK public
 * Gemini surface (`generativelanguage.googleapis.com/v1beta`) and the
 * Antigravity product OAuth surface (`cloudcode-pa.googleapis.com`).
 *
 * The OAuth route has been RETIRED (see
 * `src/aiflowbridge/google-transport-policy.ts`). This module no longer
 * offers it: the only destination is the Gemini API. What remains is the
 * resolution chain, kept because the migration stub needs to report which
 * tier still carries a retired `baseUrl` so the user knows which file to
 * fix.
 *
 * Pure module - no network calls, no vscode imports. Tested in
 * isolation by `tests/runtime-switch-route.test.ts`.
 */

export const GOOGLEAISTUDIO_BASES = {
  /** Native Gemini public API surface (`/v1beta/models/{model}:generateContent`). */
  byok: 'https://generativelanguage.googleapis.com/v1beta',
  /**
   * Retired product OAuth surface. Kept ONLY so a legacy configuration
   * can be detected and named in an error message. Nothing writes this
   * value any more.
   */
  oauth: 'https://cloudcode-pa.googleapis.com',
} as const;

/**
 * The only route AIFlowBridge can serve for this family. The `'oauth'`
 * member of `GoogleAIStudioRoute` remains for detection of a legacy
 * configuration; it is never a destination.
 */
export type GoogleAIStudioRoute = 'byok' | 'oauth';

/**
 * Vendor keys that can carry the Google AI Studio baseUrl in a registry
 * override, in lookup order.
 *
 * `antigravity` is deliberately absent. The bundled registry documents
 * that entry as metadata-only: it pins the retired upstream URL and the
 * external URLs, and no bundled model uses the `antigravity` family. The
 * effective route is resolved from `vendors.googleaistudio` (or the
 * `providers.googleaistudio.baseUrl` setting, which takes precedence),
 * so treating `antigravity` as a route signal made the switcher report
 * "already on OAuth" from an override that has no effect on routing.
 */
export const GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS: readonly string[] = ['googleaistudio'];

/** Where the effective baseUrl was resolved from. */
export type RouteBaseUrlSource = 'settings' | 'workspace' | 'globalStorage' | 'bundled';

export interface EffectiveRouteInput {
  /** Settings override (`aiflowbridge.providers.googleaistudio.baseUrl`). */
  settingsBaseUrl?: string;
  /** Workspace registry override (`vendors.googleaistudio.baseUrl`). */
  workspaceBaseUrl?: string;
  /** globalStorage registry override (`vendors.googleaistudio.baseUrl`). */
  globalStorageBaseUrl?: string;
}

/**
 * Which route the settings currently point at. Exported so the runtime
 * can label the current state before acting. A URL that is neither the
 * public Gemini host nor the retired host is reported as `'byok'`
 * (the safe default): the transport policy is what actually decides
 * whether a request is served.
 */
export function hostnameRoute(baseUrl: string | undefined): GoogleAIStudioRoute {
  if (!baseUrl) return 'byok';
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'cloudcode-pa.googleapis.com') return 'oauth';
  } catch {
    // fall through: malformed URLs default to BYOK.
  }
  return 'byok';
}

/**
 * Helper for the runtime: return the user-readable label of the
 * currently-effective route. The retired route is labelled as retired
 * rather than as a usable alternative.
 */
export function describeCurrentRoute(currentBaseUrl: string | undefined): string {
  return hostnameRoute(currentBaseUrl) === 'byok' ? 'BYOK (Gemini API)' : 'retired Antigravity OAuth (unsupported)';
}

/**
 * Resolve the effective baseUrl from the 4-tier precedence chain:
 * settings override first, then workspace registry override, then
 * globalStorage registry override, then the bundled default (BYOK).
 * Pure function - the caller reads the override files and passes the
 * extracted `vendors.googleaistudio.baseUrl` values in.
 */
export function resolveEffectiveBaseUrl(input: EffectiveRouteInput): { baseUrl: string; source: RouteBaseUrlSource } {
  if (input.settingsBaseUrl && input.settingsBaseUrl.trim().length > 0) {
    return { baseUrl: input.settingsBaseUrl, source: 'settings' };
  }
  if (input.workspaceBaseUrl && input.workspaceBaseUrl.trim().length > 0) {
    return { baseUrl: input.workspaceBaseUrl, source: 'workspace' };
  }
  if (input.globalStorageBaseUrl && input.globalStorageBaseUrl.trim().length > 0) {
    return { baseUrl: input.globalStorageBaseUrl, source: 'globalStorage' };
  }
  return { baseUrl: GOOGLEAISTUDIO_BASES.byok, source: 'bundled' };
}