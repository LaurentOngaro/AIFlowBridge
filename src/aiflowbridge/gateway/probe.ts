import { connect as netConnect, type Socket as NetSocket } from "node:net";
import { logger } from "../../logger";

export const GATEWAY_SERVICE_NAME = "aiflowbridge-gateway";

export interface PeerVersion {
  name: string;
  version: string;
  pid: number;
  startedAt: string;
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
    const data = await response.json() as Partial<PeerVersion>;
    if (typeof data.name !== "string" || typeof data.version !== "string") {
      return null;
    }
    return {
      name: data.name,
      version: data.version,
      pid: typeof data.pid === "number" ? data.pid : 0,
      startedAt: typeof data.startedAt === "string" ? data.startedAt : "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ShutdownOptions {
  timeoutMs?: number;
}

export async function requestPeerShutdown(
  port: number,
  options: ShutdownOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 500;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${peerControlUrl(port)}/shutdown`, {
      method: "POST",
      signal: controller.signal,
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
    const socket: NetSocket = netConnect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      // Destroy the socket on error too: without this the fd leaks until
      // GC, and the `'timeout'` event (if it ever fires) would land on a
      // dead socket.
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500);
    // `setTimeout` on a socket only fires the `'timeout'` event; it does
    // NOT auto-destroy. If neither `'connect'` nor `'error'` fires (slow
    // handshake, hung local service), the promise would hang forever.
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
