/**
 * PKCE (RFC 7636) helpers for the Antigravity OAuth flow.
 *
 * Pure module: no network, no filesystem. Covered by
 * tests/antigravity-pkce.test.ts including the RFC 7636 appendix B vector.
 */

import { createHash, randomBytes } from 'node:crypto';

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate a code verifier. `byteLength` controls entropy: 32..96 bytes map
 * to 43..128 base64url characters, the range mandated by RFC 7636 §4.1.
 */
export function generateCodeVerifier(byteLength = 64): string {
  if (!Number.isInteger(byteLength) || byteLength < 32 || byteLength > 96) {
    throw new RangeError(
      `code verifier byteLength must be an integer in [32, 96], got ${byteLength}`,
    );
  }
  return base64UrlEncode(randomBytes(byteLength));
}

/** S256 code challenge for a verifier. */
export function generateCodeChallenge(verifier: string): string {
  if (verifier.length < 43 || verifier.length > 128) {
    throw new RangeError(
      `code verifier must be 43..128 characters, got ${verifier.length}`,
    );
  }
  return base64UrlEncode(createHash('sha256').update(verifier, 'ascii').digest());
}

/** Anti-CSRF state parameter for the authorization round-trip. */
export function generateOAuthState(byteLength = 32): string {
  return base64UrlEncode(randomBytes(byteLength));
}
