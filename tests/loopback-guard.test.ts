/**
 * Loopback guard unit tests.
 *
 * The gateway binds to 127.0.0.1, which is necessary but not
 * sufficient: a browser on the same machine can still reach it. These
 * tests pin the two headers that close that gap, plus the content-type
 * rule that turns every cross-origin attempt into a preflight.
 */

import { describe, expect, it } from 'vitest';
import {
  inspectLoopbackRequest,
  isTrustedHostHeader,
  isTrustedOrigin,
} from '../src/aiflowbridge/gateway/loopback-guard';

const PORT = 8787;

describe('loopback guard - Host header', () => {
  it('accepts every loopback spelling of the bound port', () => {
    expect(isTrustedHostHeader(`127.0.0.1:${PORT}`, PORT)).toBe(true);
    expect(isTrustedHostHeader(`localhost:${PORT}`, PORT)).toBe(true);
    expect(isTrustedHostHeader(`[::1]:${PORT}`, PORT)).toBe(true);
  });

  it('accepts the whole 127.0.0.0/8 range, not only 127.0.0.1', () => {
    expect(isTrustedHostHeader(`127.0.0.2:${PORT}`, PORT)).toBe(true);
    expect(isTrustedHostHeader(`127.1.2.3:${PORT}`, PORT)).toBe(true);
  });

  it('rejects a rebound host name even though its IP is loopback', () => {
    // This is the DNS rebinding shape: the page keeps its own name in
    // Host, and the browser then treats the reply as same-origin.
    expect(isTrustedHostHeader(`evil.test:${PORT}`, PORT)).toBe(false);
    expect(isTrustedHostHeader(`aiflowbridge.attacker.io:${PORT}`, PORT)).toBe(false);
  });

  it('rejects a non-loopback address', () => {
    expect(isTrustedHostHeader(`0.0.0.0:${PORT}`, PORT)).toBe(false);
    expect(isTrustedHostHeader(`192.168.1.10:${PORT}`, PORT)).toBe(false);
  });

  it('rejects a loopback host carrying a different port', () => {
    expect(isTrustedHostHeader(`127.0.0.1:${PORT + 1}`, PORT)).toBe(false);
  });

  it('rejects an unparsable or empty host header', () => {
    expect(isTrustedHostHeader('', PORT)).toBe(false);
    expect(isTrustedHostHeader('   ', PORT)).toBe(false);
    expect(isTrustedHostHeader('not a host', PORT)).toBe(false);
  });

  it('accepts a missing host header, which no browser can forge', () => {
    // HTTP/1.0 clients and raw sockets omit it and are not reachable
    // from a page, so refusing them would buy nothing.
    expect(isTrustedHostHeader(undefined, PORT)).toBe(true);
  });
});

describe('loopback guard - Origin header', () => {
  it('accepts an absent origin, the normal case for local clients', () => {
    expect(isTrustedOrigin(undefined, PORT)).toBe(true);
  });

  it('accepts a loopback page served on the bound port', () => {
    expect(isTrustedOrigin(`http://127.0.0.1:${PORT}`, PORT)).toBe(true);
    expect(isTrustedOrigin(`http://localhost:${PORT}`, PORT)).toBe(true);
    expect(isTrustedOrigin(`http://[::1]:${PORT}`, PORT)).toBe(true);
  });

  it('rejects a page served from any other origin', () => {
    expect(isTrustedOrigin('https://evil.test', PORT)).toBe(false);
    expect(isTrustedOrigin('http://localhost.evil.test', PORT)).toBe(false);
  });

  it('rejects an opaque origin and a non-http scheme', () => {
    // `null` is what a sandboxed iframe and a data: document send.
    expect(isTrustedOrigin('null', PORT)).toBe(false);
    expect(isTrustedOrigin('file://', PORT)).toBe(false);
    expect(isTrustedOrigin('chrome-extension://abc', PORT)).toBe(false);
  });

  it('rejects a loopback origin on another port', () => {
    expect(isTrustedOrigin(`http://127.0.0.1:${PORT + 1}`, PORT)).toBe(false);
  });
});

describe('loopback guard - combined verdict', () => {
  it('reports the host header as the reason when it is the untrusted one', () => {
    expect(inspectLoopbackRequest({ host: 'evil.test:8787', origin: 'http://evil.test' }, PORT)).toEqual({
      trusted: false,
      reason: 'host',
    });
  });

  it('reports the origin header when the host is fine but the origin is not', () => {
    expect(inspectLoopbackRequest({ host: `127.0.0.1:${PORT}`, origin: 'https://evil.test' }, PORT)).toEqual({
      trusted: false,
      reason: 'origin',
    });
  });

  it('trusts a plain local client', () => {
    expect(inspectLoopbackRequest({ host: `127.0.0.1:${PORT}` }, PORT)).toEqual({ trusted: true });
    expect(inspectLoopbackRequest({}, PORT)).toEqual({ trusted: true });
  });
});
