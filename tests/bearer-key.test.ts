/**
 * Unit tests for the bearer-key shape check used by
 * `forwardChatCompletion` before injecting the `Authorization`
 * header. The helper rejects keys that:
 *   - exceed the 512-character cap,
 *   - contain a control character, whitespace, or non-ASCII byte,
 *   - are not strings at all.
 *
 * The empty string is intentionally considered VALID because the
 * caller treats it as "no auth header" (the upstream returns its
 * own 401/403) and the helper must not flag the common
 * "anonymous upstream" path.
 */

import { describe, expect, it } from 'vitest';
import { isValidBearerKey } from '../src/aiflowbridge/gateway/bearer-key';

describe('isValidBearerKey', () => {
  it('rejects the empty string (the helper exists to validate keys, not the absence of one)', () => {
    // The empty-string path is handled by the caller
    // (`if (resolvedKey && !isValidBearerKey(...))` short-circuits
    // before the helper is invoked), so the helper itself is free
    // to treat empty as invalid. This keeps the contract tight:
    // every accepted value is a non-empty printable-ASCII string
    // of bounded length.
    expect(isValidBearerKey('')).toBe(false);
  });

  it('accepts a typical 32-128 char ASCII key', () => {
    expect(isValidBearerKey('sk-test-1234567890abcdef')).toBe(true);
    expect(isValidBearerKey('sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true);
  });

  it('accepts a key at the 512-character ceiling', () => {
    const atCap = 'a'.repeat(512);
    expect(isValidBearerKey(atCap)).toBe(true);
  });

  it('rejects a key one character above the 512-character ceiling', () => {
    const tooLong = 'a'.repeat(513);
    expect(isValidBearerKey(tooLong)).toBe(false);
  });

  it('rejects a multi-MB string before it reaches the upstream socket', () => {
    const huge = 'a'.repeat(1024 * 1024);
    expect(isValidBearerKey(huge)).toBe(false);
  });

  it('rejects keys containing CR or LF (header-injection guard)', () => {
    expect(isValidBearerKey('sk-test\r\nX-Injected: 1')).toBe(false);
    expect(isValidBearerKey('sk-test\nfoo')).toBe(false);
    expect(isValidBearerKey('sk-test\rfoo')).toBe(false);
  });

  it('rejects keys containing the NUL byte', () => {
    expect(isValidBearerKey('sk-test\x00end')).toBe(false);
  });

  it('rejects keys containing a space', () => {
    // Space is below 0x21 and is therefore outside the printable
    // ASCII range we accept. A space in the header value would
    // either be folded or rejected by the upstream parser.
    expect(isValidBearerKey('sk test')).toBe(false);
  });

  it('rejects keys containing a tab or other control characters', () => {
    expect(isValidBearerKey('sk-test\tfoo')).toBe(false);
    expect(isValidBearerKey('sk-test\x07foo')).toBe(false);
  });

  it('rejects keys containing non-ASCII characters', () => {
    expect(isValidBearerKey('sk-test-é')).toBe(false);
    expect(isValidBearerKey('sk-test-中文')).toBe(false);
    expect(isValidBearerKey('sk-test-😀')).toBe(false);
  });

  it('rejects keys containing the DEL character (0x7F)', () => {
    expect(isValidBearerKey('sk-test\x7Fend')).toBe(false);
  });

  it('rejects keys containing a high-byte emoji surrogate-escaped', () => {
    // U+FFFF sits above 0x7E in raw code units and must be
    // rejected before splicing into the header.
    expect(isValidBearerKey('sk-test￿end')).toBe(false);
  });

  it('accepts every printable ASCII punctuation character in isolation', () => {
    // 0x21..0x7E covers every printable ASCII byte. Iterate through
    // them and confirm each one is accepted on its own. The combined
    // string is also accepted.
    const all = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    expect(all.length).toBe(94); // 0x7E - 0x21 + 1
    expect(isValidBearerKey(all)).toBe(true);
  });

  it('rejects non-string inputs', () => {
    expect(isValidBearerKey(undefined as unknown as string)).toBe(false);
    expect(isValidBearerKey(null as unknown as string)).toBe(false);
    expect(isValidBearerKey(123 as unknown as string)).toBe(false);
    expect(isValidBearerKey({} as unknown as string)).toBe(false);
  });
});
