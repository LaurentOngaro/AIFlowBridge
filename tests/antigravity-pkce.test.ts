import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateOAuthState, generatePkce } from '../src/aiflowbridge/antigravity/pkce';

describe('generatePkce', () => {
  it('generates a valid verifier and matching S256 challenge', () => {
    const { verifier, challenge } = generatePkce();

    expect(verifier).toBeDefined();
    expect(challenge).toBeDefined();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

    const expectedChallenge = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(challenge).toBe(expectedChallenge);
  });

  it('generates distinct pairs across consecutive invocations', () => {
    const pair1 = generatePkce();
    const pair2 = generatePkce();
    expect(pair1.verifier).not.toBe(pair2.verifier);
    expect(pair1.challenge).not.toBe(pair2.challenge);
  });
});

describe('generateOAuthState', () => {
  it('generates a 32-character hex state token', () => {
    const state = generateOAuthState();
    expect(state).toHaveLength(32);
    expect(state).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique state tokens', () => {
    const state1 = generateOAuthState();
    const state2 = generateOAuthState();
    expect(state1).not.toBe(state2);
  });
});
