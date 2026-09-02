import { describe, expect, it } from 'vitest';
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
} from '../src/aiflowbridge/antigravity/pkce';

describe('antigravity pkce', () => {
  it('generates a base64url verifier of 86 chars for the default 64 bytes', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(86);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects out-of-range verifier lengths (RFC 7636 §4.1)', () => {
    expect(() => generateCodeVerifier(10)).toThrow(RangeError);
    expect(() => generateCodeVerifier(97)).toThrow(RangeError);
  });

  it('matches the RFC 7636 appendix B test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(generateCodeChallenge(verifier)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('rejects a verifier outside 43..128 chars on challenge', () => {
    expect(() => generateCodeChallenge('too-short')).toThrow(RangeError);
  });

  it('generates distinct states on successive calls', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});
