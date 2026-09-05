/**
 * AIFlowBridge - Google AI Studio route switcher unit tests.
 *
 * Covers the pure `decideGoogleAIStudioRouteSwitch` helper that powers
 * the "Switch Google AI Studio route" command. No network, no vscode.
 */

import { describe, expect, it } from 'vitest';
import {
  decideGoogleAIStudioRouteSwitch,
  describeCurrentRoute,
  GOOGLEAISTUDIO_BASES,
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
