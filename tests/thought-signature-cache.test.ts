/**
 * AIFlowBridge - thought_signature cache unit tests.
 *
 * Covers the server-side gap-filler that re-injects the opaque
 * `thought_signature` when an OpenAI-compatible client (Kilo Code CLI
 * `openai-chat` protocol included) replays a tool turn without the
 * `extra_signature` field. The cache is in-memory only, bounded, and
 * TTL-expired - a stale signature is worse than a missing one, so
 * expiry errs on the short side.
 */

import { describe, expect, it } from 'vitest';
import { createThoughtSignatureCache, MAX_SIGNATURE_CACHE_ENTRIES, SIGNATURE_CACHE_TTL_MS } from '../src/aiflowbridge/antigravity/thought-signature-cache';

describe('createThoughtSignatureCache', () => {
  it('stores and looks up a signature by tool-call id', () => {
    const cache = createThoughtSignatureCache();
    cache.store('sig-1', 'call_1');
    expect(cache.lookup('call_1')).toBe('sig-1');
    expect(cache.lookup('call_unknown')).toBeUndefined();
  });

  it('exposes the TTL and capacity constants for the docs', () => {
    expect(SIGNATURE_CACHE_TTL_MS).toBe(30 * 60 * 1000);
    expect(MAX_SIGNATURE_CACHE_ENTRIES).toBe(500);
  });

  it('ignores empty signatures and empty ids', () => {
    const cache = createThoughtSignatureCache();
    cache.store('', 'call_1');
    cache.store('sig-1', '');
    expect(cache.size()).toBe(0);
  });

  it('expires entries past the TTL', () => {
    let now = 1_000_000;
    const cache = createThoughtSignatureCache(() => now);
    cache.store('sig-1', 'call_1');
    expect(cache.lookup('call_1')).toBe('sig-1');
    now += SIGNATURE_CACHE_TTL_MS + 1;
    expect(cache.lookup('call_1')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('evicts the oldest entry when the capacity is reached', () => {
    const cache = createThoughtSignatureCache();
    for (let i = 0; i < MAX_SIGNATURE_CACHE_ENTRIES; i += 1) {
      cache.store(`sig-${i}`, `call_${i}`);
    }
    expect(cache.size()).toBe(MAX_SIGNATURE_CACHE_ENTRIES);
    cache.store('sig-new', 'call_new');
    expect(cache.size()).toBe(MAX_SIGNATURE_CACHE_ENTRIES);
    expect(cache.lookup('call_0')).toBeUndefined();
    expect(cache.lookup('call_new')).toBe('sig-new');
  });
});
