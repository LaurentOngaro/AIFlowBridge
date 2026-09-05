/**
 * AIFlowBridge - PKCE (Proof Key for Code Exchange) generation.
 *
 * Implements RFC 7636 S256 code challenge generation using node:crypto.
 * Pure cryptographic module, no network calls, fully unit-testable.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { PkcePair } from './types';

/**
 * Generates a high-entropy PKCE code_verifier (base64url) and its SHA-256
 * code_challenge (S256 method).
 *
 * @param byteLength Number of random bytes for the verifier (default 32, yielding 43 chars).
 */
export function generatePkce(byteLength = 32): PkcePair {
  const safeLength = Math.max(32, Math.min(byteLength, 96));
  const verifier = randomBytes(safeLength)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { verifier, challenge };
}

/**
 * Generates a cryptographically random state token for CSRF protection during OAuth flows.
 */
export function generateOAuthState(): string {
  return randomBytes(16).toString('hex');
}
