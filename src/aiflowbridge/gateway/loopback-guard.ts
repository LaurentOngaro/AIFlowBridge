/**
 * Loopback-only request guard for the bundled gateway.
 *
 * The gateway binds to `127.0.0.1`, which keeps it off the network but
 * does NOT keep a browser on the same machine away from it. Two attacks
 * need an explicit check:
 *
 *   - Cross-site request forgery. A page on any origin can POST with
 *     `Content-Type: text/plain`, which is a CORS "simple request" and
 *     triggers no preflight. Without an `Origin` check the gateway
 *     spends the user's paid API key on the attacker's behalf.
 *   - DNS rebinding. The attacker page keeps its own origin but points
 *     its DNS at `127.0.0.1`, so the browser sends `Host: evil.test`.
 *     The response is then same-origin as far as the page is concerned
 *     and it can read `/v1/sessions`, `/v1/replay/{id}` and
 *     `/v1/events`, i.e. the recorded prompts and responses.
 *
 * The `Host` check is what actually stops rebinding; the `Origin` check
 * is the belt-and-braces layer for the plain CSRF case. Non-browser
 * clients (Kilo Code, Continue, curl, the standalone CLI, VS Code
 * itself) send neither a foreign `Origin` nor a foreign `Host`, so they
 * pass untouched.
 *
 * Deliberately absent: a `Content-Type` requirement. It looks like it
 * belongs here, because `text/plain` is the classic CORS simple-request
 * vector, but a page cannot forge `Origin`, so the header above already
 * blocks every browser CSRF. Enforcing JSON would only reject real
 * clients, since `fetch(url, { body: JSON.stringify(x) })` without an
 * explicit header sends `text/plain`.
 *
 * VS-Code-free on purpose: the module is a pure function of the request
 * headers, so it is unit-testable without a host.
 */

/** Hostnames that legitimately reach a loopback-bound listener. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Why a request was refused, for the 403 body and the log line. */
export type LoopbackRejection = 'host' | 'origin';

/** Outcome of {@link inspectLoopbackRequest}. */
export interface LoopbackVerdict {
  readonly trusted: boolean;
  readonly reason?: LoopbackRejection;
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * True when `hostname` is a loopback name. The whole `127.0.0.0/8` range
 * counts, not just `127.0.0.1`, because a client may legitimately reach
 * the listener through any of them.
 */
function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (isLoopbackHostname(lower)) {
    return true;
  }
  const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (!dotted) {
    return false;
  }
  const octets = dotted.slice(1).map(Number);
  if (octets.some((o) => o > 255)) {
    return false;
  }
  return octets[0] === 127;
}

/**
 * Parse `http://<host header>` and require a loopback hostname whose
 * port, when present, is the port the gateway actually bound to. A
 * rebinding page sends its own name in `Host`, so it fails the hostname
 * test even though its IP is loopback.
 */
function hostnameAndPort(rawUrl: string): { hostname: string; port: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  return { hostname: parsed.hostname, port: parsed.port };
}

/**
 * Validate the `Host` header against the bound port.
 *
 * A missing header is accepted: HTTP/1.0 clients and raw sockets do not
 * send one, and they cannot be steered by a browser, so there is nothing
 * to spoof.
 */
export function isTrustedHostHeader(host: string | undefined, boundPort: number): boolean {
  if (host === undefined) {
    return true;
  }
  const trimmed = host.trim();
  if (trimmed === '') {
    return false;
  }
  const parsed = hostnameAndPort(`http://${trimmed}`);
  if (!parsed || !isLoopbackHost(parsed.hostname)) {
    return false;
  }
  return parsed.port === '' || parsed.port === String(boundPort);
}

/**
 * Validate the `Origin` header. Absent means a non-browser client, which
 * is allowed. Present means the request came from a page, so it must be
 * a loopback page served on the bound port.
 */
export function isTrustedOrigin(origin: string | undefined, boundPort: number): boolean {
  if (origin === undefined) {
    return true;
  }
  const trimmed = origin.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null') {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  if (!isLoopbackHost(parsed.hostname)) {
    return false;
  }
  return parsed.port === '' || parsed.port === String(boundPort);
}

/**
 * Combine both header checks into the verdict {@link handleRequest} acts
 * on. The `Host` check wins because it is the one that stops DNS
 * rebinding, which is the more severe of the two.
 */
export function inspectLoopbackRequest(
  headers: { host?: string; origin?: string },
  boundPort: number
): LoopbackVerdict {
  if (!isTrustedHostHeader(headers.host, boundPort)) {
    return { trusted: false, reason: 'host' };
  }
  if (!isTrustedOrigin(headers.origin, boundPort)) {
    return { trusted: false, reason: 'origin' };
  }
  return { trusted: true };
}