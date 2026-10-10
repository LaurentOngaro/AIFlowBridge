/**
 * Google AI Studio route resolution unit tests.
 *
 * The route switcher used to toggle between the BYOK Gemini API and the
 * Antigravity / Cloud Code Assist product OAuth route. That second route
 * has been retired, so only the resolution chain remains: it tells the
 * migration stub WHICH tier still carries a retired `baseUrl`.
 *
 * No network, no vscode.
 */

import { describe, expect, it } from 'vitest';
import {
  describeCurrentRoute,
  GOOGLEAISTUDIO_BASES,
  GOOGLEAISTUDIO_ROUTE_VENDOR_KEYS,
  hostnameRoute,
  resolveEffectiveBaseUrl,
} from '../src/aiflowbridge/googleai-studio-route';
import { classifyGoogleTransport } from '../src/aiflowbridge/google-transport-policy';

describe('hostnameRoute', () => {
  it('reports the retired product OAuth host as the oauth route', () => {
    expect(hostnameRoute(GOOGLEAISTUDIO_BASES.oauth)).toBe('oauth');
    expect(classifyGoogleTransport({ baseUrl: GOOGLEAISTUDIO_BASES.oauth })).toBe('retired-product-oauth');
  });

  it('reports the public Gemini API as the BYOK route', () => {
    expect(hostnameRoute(GOOGLEAISTUDIO_BASES.byok)).toBe('byok');
    expect(classifyGoogleTransport({ baseUrl: GOOGLEAISTUDIO_BASES.byok })).toBe('supported-public-api');
  });

  it('falls back to BYOK for an unrecognised host and for a malformed URL', () => {
    expect(hostnameRoute('https://proxy.internal/v1')).toBe('byok');
    expect(hostnameRoute('not a url')).toBe('byok');
    expect(hostnameRoute(undefined)).toBe('byok');
  });

  it('does not mistake a lookalike host for the retired one', () => {
    expect(hostnameRoute('https://cloudcode-pa.googleapis.com.example.org')).toBe('byok');
  });
});

describe('describeCurrentRoute', () => {
  it('labels the retired route as retired rather than as a usable alternative', () => {
    expect(describeCurrentRoute(GOOGLEAISTUDIO_BASES.oauth)).toContain('retired');
    expect(describeCurrentRoute(GOOGLEAISTUDIO_BASES.byok)).toBe('BYOK (Gemini API)');
  });
});

describe('resolveEffectiveBaseUrl', () => {
  it('resolves the settings override first', () => {
    const effective = resolveEffectiveBaseUrl({
      settingsBaseUrl: GOOGLEAISTUDIO_BASES.oauth,
      workspaceBaseUrl: GOOGLEAISTUDIO_BASES.byok,
      globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.byok,
    });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.oauth, source: 'settings' });
  });

  it('resolves the workspace override above the globalStorage tier', () => {
    const effective = resolveEffectiveBaseUrl({
      workspaceBaseUrl: GOOGLEAISTUDIO_BASES.oauth,
      globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.byok,
    });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.oauth, source: 'workspace' });
  });

  it('falls back to the bundled BYOK default with no overrides', () => {
    expect(resolveEffectiveBaseUrl({})).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.byok, source: 'bundled' });
  });

  it('ignores blank override values instead of treating them as configured', () => {
    const effective = resolveEffectiveBaseUrl({ settingsBaseUrl: '   ', globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.oauth });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.oauth, source: 'globalStorage' });
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
    const effective = resolveEffectiveBaseUrl({});
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.byok, source: 'bundled' });
    expect(classifyGoogleTransport({ baseUrl: effective.baseUrl })).toBe('supported-public-api');
  });

  it('still detects a googleaistudio override that points at the retired route', () => {
    // The override is NOT rewritten: the transport policy refuses it at
    // request time with an explicit error instead of silently changing
    // the user's effective configuration (and therefore their billing).
    const effective = resolveEffectiveBaseUrl({ globalStorageBaseUrl: GOOGLEAISTUDIO_BASES.oauth });
    expect(effective).toEqual({ baseUrl: GOOGLEAISTUDIO_BASES.oauth, source: 'globalStorage' });
    expect(classifyGoogleTransport({ baseUrl: effective.baseUrl })).toBe('retired-product-oauth');
  });
});