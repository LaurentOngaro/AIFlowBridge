/**
 * Google transport policy unit tests.
 *
 * Covers the pure `classifyGoogleTransport` helper that decides whether a
 * profile may be served or must be refused before any upstream call. No
 * network, no vscode.
 *
 * The two properties pinned here are precision (exact hostname match, no
 * `includes()`) and scope (the `googleaistudio` family is not itself a
 * refusal signal, because the supported BYOK route lives in it).
 */

import { describe, expect, it } from 'vitest';
import {
  buildGoogleProductOAuthError,
  classifyGoogleTransport,
  GOOGLE_PRODUCT_OAUTH_ERROR_CODE,
  GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE,
  isRetiredGoogleProductTransport,
  isRetiredGoogleProductUrl,
  normalizeGoogleHostname,
  RETIRED_GOOGLE_PRODUCT_HOSTS,
} from '../src/aiflowbridge/google-transport-policy';

const RETIRED_HOST = RETIRED_GOOGLE_PRODUCT_HOSTS[0];

describe('classifyGoogleTransport', () => {
  it('allows the public Gemini API route', () => {
    expect(
      classifyGoogleTransport({ kind: 'googleaistudio', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' })
    ).toBe('supported-public-api');
  });

  it('allows a generic openai-compat profile on the public Gemini API', () => {
    // The BYOK route is synthesized as `openai-compat`, so a family-based
    // or kind-based rule would break it.
    expect(classifyGoogleTransport({ kind: 'openai-compat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' })).toBe(
      'supported-public-api'
    );
  });

  it('retires the product OAuth host regardless of the declared kind', () => {
    expect(classifyGoogleTransport({ baseUrl: `https://${RETIRED_HOST}` })).toBe('retired-product-oauth');
    expect(classifyGoogleTransport({ kind: 'openai-compat', baseUrl: `https://${RETIRED_HOST}` })).toBe('retired-product-oauth');
    expect(classifyGoogleTransport({ kind: 'googleaistudio', baseUrl: `https://${RETIRED_HOST}` })).toBe('retired-product-oauth');
  });

  it('retires a legacy antigravity kind even when the baseUrl looks supported', () => {
    // `kind: 'antigravity'` only ever selected the removed branch, so it
    // is a transport marker on its own.
    expect(
      classifyGoogleTransport({ kind: 'antigravity', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' })
    ).toBe('retired-product-oauth');
  });

  it('does not retire a host that merely CONTAINS the Google hostname', () => {
    // `includes()` would refuse this host, which is fully controlled by
    // whoever owns that DNS name.
    expect(isRetiredGoogleProductUrl(`https://${RETIRED_HOST}.example.org`)).toBe(false);
    expect(isRetiredGoogleProductUrl('https://evil-cloudcode-pa.googleapis.com.attacker.net')).toBe(false);
  });

  it('is case-insensitive and tolerates the DNS root dot and a port', () => {
    expect(isRetiredGoogleProductUrl(`https://${RETIRED_HOST.toUpperCase()}/`)).toBe(true);
    expect(isRetiredGoogleProductUrl(`https://${RETIRED_HOST}./`)).toBe(true);
    expect(isRetiredGoogleProductUrl(`https://${RETIRED_HOST}:443/v1internal`)).toBe(true);
  });

  it('does not retire a non-Google provider', () => {
    expect(classifyGoogleTransport({ kind: 'openai-compat', baseUrl: 'https://api.deepseek.com/v1' })).toBe('not-applicable');
    expect(classifyGoogleTransport({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' })).toBe('not-applicable');
  });

  it('is not fooled by the word antigravity in a label or id', () => {
    // The metadata-only `vendors.antigravity` registry entry pins the
    // retired URL but selects no transport; a family or label match
    // would refuse an unrelated, legitimate configuration.
    expect(
      isRetiredGoogleProductTransport({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'antigravity-preview' })
    ).toBe(false);
  });

  it('does not retire an unparseable URL', () => {
    // The SSRF guard rejects unparseable baseUrls separately; the
    // transport policy must not guess.
    expect(classifyGoogleTransport({ baseUrl: 'not a url' })).toBe('not-applicable');
    expect(isRetiredGoogleProductUrl(undefined)).toBe(false);
  });

  it('exposes the wrapper as a direct boolean', () => {
    expect(isRetiredGoogleProductTransport({ baseUrl: `https://${RETIRED_HOST}` })).toBe(true);
    expect(isRetiredGoogleProductTransport({ baseUrl: 'https://api.deepseek.com/v1' })).toBe(false);
  });
});

describe('normalizeGoogleHostname', () => {
  it('lower-cases, strips brackets and drops the trailing dot', () => {
    expect(normalizeGoogleHostname('CLOUDCODE-PA.GOOGLEAPIS.COM.')).toBe(RETIRED_HOST);
    expect(normalizeGoogleHostname('[::1]')).toBe('::1');
  });

  it('returns undefined for missing or blank input', () => {
    expect(normalizeGoogleHostname(undefined)).toBeUndefined();
    expect(normalizeGoogleHostname('   ')).toBeUndefined();
  });
});

describe('the refusal payload', () => {
  it('carries the stable code and an OpenAI-shaped envelope', () => {
    const payload = buildGoogleProductOAuthError();
    expect(payload.error.code).toBe(GOOGLE_PRODUCT_OAUTH_ERROR_CODE);
    expect(payload.error.type).toBe('service_unavailable_error');
    expect(payload.error.message).toBe(GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE);
  });

  it('states that nothing was sent and does not promise a GCP-project remedy', () => {
    expect(GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE).toContain('No upstream request was sent');
    expect(GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE).toContain('may incur API charges');
    // The message must not resurrect the "attach your project to the
    // programme" advice that the retirement removed.
    expect(GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE).not.toMatch(/whitelist/i);
    expect(GOOGLE_PRODUCT_OAUTH_ERROR_MESSAGE).not.toMatch(/cloud code assist programme/i);
  });
});