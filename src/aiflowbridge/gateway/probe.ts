import { connect as netConnect, type Socket as NetSocket } from "node:net";
import { logger } from "../../logger";

export const GATEWAY_SERVICE_NAME = "aiflowbridge-gateway";

export interface PeerVersion {
  name: string;
  version: string;
  pid: number;
  startedAt: string;
  /**
   * Optional per-instance shutdown token, surfaced by GET /version. The
   * caller is expected to echo it back as the
   * `X-AIFlowBridge-Shutdown-Token` header when calling POST /shutdown.
   * Older gateways (pre-shutdown-auth) do not return this field; the
   * `requestPeerShutdown` caller falls back to no token in that case,
   * which the new server rejects with 403.
   */
  shutdownToken?: string;
}

export interface ProbeOptions {
  timeoutMs?: number;
}

/**
 * Build the loopback URL used for the cooperative-restart control plane
 * (probe + shutdown). Always derived from the configured port and the
 * loopback interface, never from the user-configurable `baseUrl`, to
 * prevent SSRF via a hostile `aiflowbridge.gateway.baseUrl` setting.
 */
export function peerControlUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function probeServerVersion(
  port: number,
  options: ProbeOptions = {},
): Promise<PeerVersion | null> {
  const timeoutMs = options.timeoutMs ?? 200;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${peerControlUrl(port)}/version`, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    // WARN-B04: defend against a hostile or malfunctioning peer that
    // returns a multi-megabyte body. The /version payload is small and
    // fixed-size; anything past 4 KiB is suspicious. We bail out
    // without buffering the body to keep memory bounded.
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const declared = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declared) && declared > PROBE_MAX_BODY_BYTES) {
        return null;
      }
    }
    const raw = await response.text();
    if (raw.length > PROBE_MAX_BODY_BYTES) {
      return null;
    }
    let parsed: Partial<PeerVersion>;
    try {
      parsed = JSON.parse(raw) as Partial<PeerVersion>;
    } catch {
      return null;
    }
    if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
      return null;
    }
    return {
      name: parsed.name,
      version: parsed.version,
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      shutdownToken: typeof parsed.shutdownToken === "string" ? parsed.shutdownToken : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Upper bound (bytes) on the /version response body. The real payload
 * is ~150 bytes; 4 KiB is generous headroom for future fields while
 * still rejecting accidental or hostile multi-MB replies (WARN-B04).
 */
const PROBE_MAX_BODY_BYTES = 4 * 1024;

export interface ShutdownOptions {
  timeoutMs?: number;
  /**
   * The shutdown token returned by the peer's GET /version. Must be
   * echoed in the `X-AIFlowBridge-Shutdown-Token` header for the peer
   * to accept the request. Empty string is accepted (and will fail
   * authentication against a token-bearing peer) so callers can keep
   * the existing 2-arg signature; passing the real token is the
   * supported path.
   */
  shutdownToken?: string;
}

export async function requestPeerShutdown(
  port: number,
  options: ShutdownOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 500;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {};
  if (options.shutdownToken) {
    headers["X-AIFlowBridge-Shutdown-Token"] = options.shutdownToken;
  }
  try {
    const response = await fetch(`${peerControlUrl(port)}/shutdown`, {
      method: "POST",
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    logger.warn(
      `[Gateway] Peer shutdown request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitUntilPortFree(
  port: number,
  options: WaitOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return !(await isPortInUse(port));
}

export function compareSemver(a: string, b: string): number {
  const [aCore] = a.split("-");
  const [bCore] = b.split("-");
  const aParts = aCore.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const bParts = bCore.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (inUse: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(inUse);
    };
    const socket: NetSocket = netConnect(port, "127.0.0.1", () => {
      socket.destroy();
      settle(true);
    });
    socket.on("error", () => {
      // Destroy the socket on error too: without this the fd leaks until
      // GC, and the `'timeout'` event (if it ever fires) would land on a
      // dead socket.
      socket.destroy();
      settle(false);
    });
    socket.setTimeout(500);
    // `setTimeout` on a socket only fires the `'timeout'` event; it does
    // NOT auto-destroy. If neither `'connect'` nor `'error'` fires (slow
    // handshake, hung local service), the promise would hang forever.
    socket.on("timeout", () => {
      socket.destroy();
      settle(false);
    });
    // BUG-A04: schedule a no-op `setTimeout(0)` so the Node event loop
    // gets a chance to surface a deferred `'connect'` / `'error'` from
    // the TCP stack before we ever have a chance to leak a timer (the
    // socket's own `setTimeout(500)` above is the real timeout - this
    // one just ensures the microtask drains in pathological cases).
    setTimeout(() => {
      // Nothing to do; settled flag already prevents double-resolve.
    }, 0);
  });
}
