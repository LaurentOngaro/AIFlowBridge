/**
 * AIFlowBridge - Google AI Studio route switcher.
 *
 * Resolves the two valid `baseUrl` values for the
 * `googleaistudio` provider family and exposes a pure helper to toggle
 * between the BYOK (native surface, `generativelanguage.googleapis.com/v1beta`)
 * and the Antigravity OAuth routes (`cloudcode-pa.googleapis.com`). The
 * switcher returns the next baseUrl plus the cleanup side-effects that
 * the caller should apply (revoke OAuth tokens when leaving AGY, clear
 * the API key when leaving BYOK) so stale credentials from the inactive
 * route never answer a request.
 *
 * Pure module - no network calls, no vscode imports. Tested in
 * isolation by `tests/runtime-switch-route.test.ts`.
 */

export const GOOGLEAISTUDIO_BASES = {
  /** Native Gemini public API surface (`/v1beta/models/{model}:generateContent`). */
  byok: 'https://generativelanguage.googleapis.com/v1beta',
  /** Cloud Code Assist OAuth surface (`/v1internal:*`). Requires a whitelisted tenant. */
  oauth: 'https://cloudcode-pa.googleapis.com',
} as const;

export type GoogleAIStudioRoute = 'byok' | 'oauth';

/** Where the effective baseUrl was resolved from. */
export type RouteBaseUrlSource = 'settings' | 'workspace' | 'globalStorage' | 'bundled';

export interface EffectiveRouteInput {
  /** Settings override (`aiflowbridge.providers.googleaistudio.baseUrl`). */
  settingsBaseUrl?: string;
  /** Workspace registry override (`vendors.googleaistudio/antigravity.baseUrl`). */
  workspaceBaseUrl?: string;
  /** globalStorage registry override (`vendors.googleaistudio/antigravity.baseUrl`). */
  globalStorageBaseUrl?: string;
}

export interface SwitchRouteDecision {
  nextRoute: GoogleAIStudioRoute;
  nextBaseUrl: string;
  /**
   * Cleanup to apply after writing the new baseUrl. The caller is
   * responsible for running each side-effect (no I/O here).
   */
  cleanup: {
    /** The OAuth route was just left -> clear the stored OAuth tokens. */
    revokeOAuthTokens: boolean;
    /** The BYOK route was just left -> clear the stored API key. */
    revokeApiKey: boolean;
  };
  /** Stable message describing the toggle for the Command Palette toast. */
  message: string;
}

/**
 * Resolve the new baseUrl + cleanup actions for the toggle. Pass the
 * current user-configured baseUrl (may be undefined when the user never
 * overrode it - falls back to the bundled default). Returns null when
 * no override exists yet AND the bundled default is already on the
 * target route (no toggle needed).
 *
 * @param currentBaseUrl The `aiflowbridge.providers.googleaistudio.baseUrl`
 *   value from `vscode.workspace.getConfiguration`, or undefined if
 *   the user never set it.
 * @param targetRoute The route the user wants to switch to. Defaults to
 *   the inverse of the current effective route.
 */
export function decideGoogleAIStudioRouteSwitch(
  currentBaseUrl: string | undefined,
  targetRoute?: GoogleAIStudioRoute
): SwitchRouteDecision | null {
  const currentEffective: GoogleAIStudioRoute = hostnameRoute(currentBaseUrl);
  // `requestedTarget` is the route the caller wants to converge on.
  // When the user invokes the toggle command without specifying a
  // target, we infer the inverse of the current route. When the
  // current route already matches the target, no toggle is needed.
  const requestedTarget: GoogleAIStudioRoute = targetRoute ?? (currentEffective === 'byok' ? 'oauth' : 'byok');
  const next = requestedTarget;
  if (currentEffective === next) {
    return null;
  }

  const nextBaseUrl = next === 'byok' ? GOOGLEAISTUDIO_BASES.byok : GOOGLEAISTUDIO_BASES.oauth;
  const wasOauth = currentEffective === 'oauth';
  const wasByok = currentEffective === 'byok';

  return {
    nextRoute: next,
    nextBaseUrl,
    cleanup: {
      revokeOAuthTokens: wasOauth,
      revokeApiKey: wasByok,
    },
    message:
      next === 'byok'
        ? 'Google AI Studio: switched to BYOK (native Gemini surface). OAuth tokens revoked.'
        : 'Google AI Studio: switched to Antigravity OAuth. API key cleared.',
  };
}

function hostnameRoute(baseUrl: string | undefined): GoogleAIStudioRoute {
  if (!baseUrl) return 'byok';
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'cloudcode-pa.googleapis.com') return 'oauth';
    if (host === 'generativelanguage.googleapis.com') return 'byok';
  } catch {
    // fall through: malformed URLs default to BYOK.
  }
  return 'byok';
}

/**
 * Helper for the runtime: return the user-readable label of the
 * currently-effective route, suitable for the Command Palette title.
 */
export function describeCurrentRoute(currentBaseUrl: string | undefined): string {
  return hostnameRoute(currentBaseUrl) === 'byok' ? 'BYOK (native Gemini surface)' : 'Antigravity OAuth';
}

/**
 * Resolve the effective baseUrl from the 4-tier precedence chain:
 * settings override first, then workspace registry override, then
 * globalStorage registry override, then the bundled default (BYOK).
 * Pure function - the caller reads the override files and passes the
 * extracted `vendors.googleaistudio/antigravity.baseUrl` values in.
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

/**
 * Route-switch decision on top of the resolved effective baseUrl.
 * Same toggle semantics as `decideGoogleAIStudioRouteSwitch` but the
 * caller resolves the effective URL first (settings, workspace,
 * globalStorage, bundled), so a stale registry override cannot point
 * the decision the wrong way. The toast message names the source tier
 * the decision was based on.
 */
export function decideRouteFromEffective(
  effective: { baseUrl: string; source: RouteBaseUrlSource },
  targetRoute?: GoogleAIStudioRoute
): SwitchRouteDecision | null {
  const decision = decideGoogleAIStudioRouteSwitch(effective.baseUrl, targetRoute);
  if (!decision) {
    return null;
  }
  return {
    ...decision,
    message: `${decision.message} (effective route resolved from ${effective.source}).`,
  };
}
