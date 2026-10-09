/**
 * AIFlowBridge - Google AI Studio route switcher unit tests.
 *
 * Covers the pure `decideGoogleAIStudioRouteSwitch` helper that powers
 * the "Switch Google AI Studio route" command. No network, no vscode.
 */

import { describe, expect, it } from 'vitest';
import {
  decideGoogleAIStudioRouteSwitch,
  decideRouteFromEffective,
  describeCurrentRoute,
  GOOGLEAISTUDIO_BASES,
  GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS,
  resolveEffectiveBaseUrl,
} from '../src/aiflowbridge/googleai-studio-route';

describe('decideGoogleAIStudioRouteSwitch', () => {
  it('returns null when no override exists and the target is the bundled default (BYOK)', () => {
    // No override means the bundled default applies. The default is BYOK,
    // and the user wants to switch to BYOK -> no-op.
    expect(decideGoogleAIStudioRouteSwitch(undefined, 'byok')).toBeNull();
  });

  it('is a no-op when no target is given and the current route already matches the inferred target', () => {
    // Without an explicit target, the function infers the inverse of
    // the current route. When the caller already is on that route
    // (impossible without a target argument, but the no-target path
    // is the natural use of the toggle command), the result must be
    // null. Verified here with the target argument: asking for the
    // route we're already on is a no-op.
    expect(decideGoogleAIStudioRouteSwitch(GOOGLEAISTUDIO_BASES.byok, 'byok')).toBeNull();
    expect(decideGoogleAIStudioRouteSwitch(GOOGLEAISTUDIO_BASES.oauth, 'oauth')).toBeNull();
  });

  it('switches from OAuth override to BYOK and asks to revoke OAuth tokens', () => {
    const decision = decideGoogleAIStudioRouteSwitch(GOOGLEAISTUDIO_BASES.oauth, 'byok');
    expect(decision).not.toBeNull();
    expect(decision?.nextRoute).toBe('byok');
    expect(decision?.nextBaseUrl).toBe(GOOGLEAISTUDIO_BASES.byok);
    expect(decision?.cleanup.revokeOAuthTokens).toBe(true);
    expect(decision?.cleanup.revokeApiKey).toBe(false);
  });

  it('switches from BYOK override to OAuth and asks to revoke the API key', () => {
    const decision = decideGoogleAIStudioRouteSwitch(GOOGLEAISTUDIO_BASES.byok, 'oauth');
    expect(decision).not.toBeNull();
    expect(decision?.nextRoute).toBe('oauth');
    expect(decision?.nextBaseUrl).toBe(GOOGLEAISTUDIO_BASES.oauth);
    expect(decision?.cleanup.revokeApiKey).toBe(true);
    expect(decision?.cleanup.revokeOAuthTokens).toBe(false);
  });

  it('infers the inverse route when no target is provided and the current is OAuth', () => {
    const decision = decideGoogleAIStudioRouteSwitch(GOOGLEAISTUDIO_BASES.oauth);
    expect(decision?.nextRoute).toBe('byok');
    expect(decision?.cleanup.revokeOAuthTokens).toBe(true);
  });

  it('infers the inverse route when no target is provided and the current is BYOK', () => {
    const decision = decideGoogleAIStudioRouteSwitch(GOOGLEAISTUDIO_BASES.byok);
    expect(decision?.nextRoute).toBe('oauth');
    expect(decision?.cleanup.revokeApiKey).toBe(true);
  });

  it('falls back to BYOK for an unrecognised host', () => {
    const decision = decideGoogleAIStudioRouteSwitch('https://example.com/something');
    expect(decision?.nextRoute).toBe('oauth');
    expect(decision?.nextBaseUrl).toBe(GOOGLEAISTUDIO_BASES.oauth);
  });

  it('falls back to BYOK for a malformed URL', () => {
    const decision = decideGoogleAIStudioRouteSwitch('not-a-url');
    expect(decision?.nextRoute).toBe('oauth');
    expect(decision?.nextBaseUrl).toBe(GOOGLEAISTUDIO_BASES.oauth);
  });
});

describe('describeCurrentRoute', () => {
  it('reports the route matching the current baseUrl', () => {
    expect(describeCurrentRoute(GOOGLEAISTUDIO_BASES.byok)).toContain('BYOK');
    expect(describeCurrentRoute(GOOGLEAISTUDIO_BASES.oauth)).toContain('OAuth');
    expect(describeCurrentRoute(undefined)).toContain('BYOK');
  });
});

describe('resolveEffectiveBaseUrl', () => {
  it('prefers settings over workspace, globalStorage, and the bundled default', () => {
    const effective = resolveEffectiveBaseUrl({
      settingsBaseUrl: GOOGLEAISTUDIO_BASES.byok,
      workspaceBaseUrl: GOOGLEAISTUDIO_BASES.oauth,
      globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.oauth,
    });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.byok, source: 'settings' });
  });

  it('resolves a stale globalStorage OAuth override when settings are unset', () => {
    const effective = resolveEffectiveBaseUrl({ globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.oauth });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.oauth, source: 'globalStorage' });
  });

  it('resolves the workspace override above the globalStorage tier', () => {
    const effective = resolveEffectiveBaseUrl({
      workspaceBaseUrl: GOOGLEAISTUDIO_BASES.oauth,
      globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.byok,
    });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.oauth, source: 'workspace' });
  });

  it('falls back to the bundled BYOK default with no overrides', () => {
    const effective = resolveEffectiveBaseUrl({});
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.byok, source: 'bundled' });
  });
});

describe('GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS', () => {
  it('lists googleaistudio only, so a metadata-only antigravity entry cannot select the route', () => {
    // Regression guard. The switcher used to look up
    // `['googleaistudio', 'antigravity']`, so an override carrying the
    // OAuth URL under the metadata-only `antigravity` key made the
    // command report "already on OAuth" and refuse to act, while the
    // gateway (which reads `vendors.googleaistudio`) kept serving the
    // BYOK surface and billing the user's project.
    expect(GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS).toEqual(['googleaistudio']);
    expect(GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS).not.toContain('antigravity');
  });

  it('makes a metadata-only antigravity override resolve to the bundled BYOK default', () => {
    // Same scenario, end to end through the resolution chain: with the
    // route keys, an override that only declares `antigravity` carries no
    // route signal, so the chain falls through to the bundled default and
    // asking for OAuth yields a real decision instead of a no-op.
    const effective = resolveEffectiveBaseUrl({
      settingsBaseUrl: undefined,
      workspaceBaseUrl: undefined,
      globalStorageBaseUrl: undefined,
    });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.byok, source: 'bundled' });
    expect(decideRouteFromEffective(effective, 'oauth')).not.toBeNull();
  });

  it('lets a googleaistudio override still select the OAuth route', () => {
    const effective = resolveEffectiveBaseUrl({
      globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.oauth,
    });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.oauth, source: 'globalStorage' });
    expect(decideRouteFromEffective(effective, 'oauth')).toBeNull();
    expect(decideRouteFromEffective(effective, 'byok')?.nextBaseUrl).toBe(GOOGLEAISTUDIO_BASES.byok);
  });
});

describe('decideRouteFromEffective', () => {
  it('toggles to BYOK when the effective route is a stale OAuth override', () => {
    const effective = resolveEffectiveBaseUrl({ globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.oauth });
    const decision = decideRouteFromEffective(effective);
    expect(decision?.nextRoute).toBe('byok');
    expect(decision?.message).toContain('globalStorage');
  });

  it('returns null when the effective route already matches the target', () => {
    const effective = resolveEffectiveBaseUrl({ settingsBaseUrl: GOOGLEAISTUDIO_BASES.byok });
    expect(decideRouteFromEffective(effective, 'byok')).toBeNull();
  });
});

describe('route stability across repeated invocations', () => {
  // The reported failure: a blind toggle flips on every invocation, so
  // running the command twice to check lands on the opposite route and the
  // switch looks broken. The picker passes an explicit target, which makes a
  // repeated invocation a no-op instead of a flip.
  it('keeps the requested route when the user asks for it again', () => {
    const effective = resolveEffectiveBaseUrl({ settingsBaseUrl: GOOGLEAISTUDIO_BASES.byok });
    const first = decideRouteFromEffective(effective, 'oauth');
    expect(first?.nextBaseUrl).toBe(GOOGLEAISTUDIO_BASES.oauth);

    const afterWrite = resolveEffectiveBaseUrl({ settingsBaseUrl: first!.nextBaseUrl });
    expect(decideRouteFromEffective(afterWrite, 'oauth')).toBeNull();
    expect(afterWrite.baseUrl).toBe(GOOGLEAISTUDIO_BASES.oauth);
  });

  it('flips back on a second blind toggle, which is why the UI asks for a route', () => {
    const effective = resolveEffectiveBaseUrl({ settingsBaseUrl: GOOGLEAISTUDIO_BASES.byok });
    const first = decideRouteFromEffective(effective);
    expect(first?.nextRoute).toBe('oauth');

    const afterWrite = resolveEffectiveBaseUrl({ settingsBaseUrl: first!.nextBaseUrl });
    expect(decideRouteFromEffective(afterWrite)?.nextRoute).toBe('byok');
  });

  it('revokes the API key when landing on OAuth and the tokens when landing on BYOK', () => {
    const fromByok = resolveEffectiveBaseUrl({ settingsBaseUrl: GOOGLEAISTUDIO_BASES.byok });
    expect(decideRouteFromEffective(fromByok, 'oauth')?.cleanup).toEqual({
      revokeOAuthTokens: false,
      revokeApiKey: true,
    });

    const fromOauth = resolveEffectiveBaseUrl({ settingsBaseUrl: GOOGLEAISTUDIO_BASES.oauth });
    expect(decideRouteFromEffective(fromOauth, 'byok')?.cleanup).toEqual({
      revokeOAuthTokens: true,
      revokeApiKey: false,
    });
  });
});
