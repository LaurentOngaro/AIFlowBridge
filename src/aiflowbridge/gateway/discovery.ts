/**
 * Zero-conf discovery beacon + /v1/discovery endpoint (action
 * plan item #4).
 *
 * Lets IDEs find the local AIFlowBridge gateway without
 * configuring a URL. Two layers:
 *
 * 1. **Periodic UDP broadcast** on `gateway.discovery.broadcastPort`
 *    (default 8788). Every `broadcastIntervalMs` (default 2000)
 *    the gateway emits a small JSON payload
 *    `{ host, port, version, protocol: "openai", path: "/v1" }`
 *    on the LAN. Listeners (Continue, Open WebUI, anything that
 *    reads UDP on that port) can pick the gateway up without any
 *    pre-shared URL.
 *
 * 2. **`GET /v1/discovery` HTTP endpoint** on the gateway's own
 *    TCP server (already bound to 127.0.0.1). Returns a richer
 *    JSON document with one-paste client config snippets for
 *    Continue, JetBrains AI Assistant, Kilo Code, Cursor, and
 *    Neovim CodeCompanion. The endpoint is reachable on the
 *    loopback URL the gateway is already bound to, so the same
 *    `http://127.0.0.1:8787/v1/discovery` works for any tooling
 *    that can hit HTTP (which mDNS cannot reach into without
 *    adding a `bonjour-service` dependency we don't want).
 *
 * Default off (`aiflowbridge.gateway.discovery.enabled = false`)
 * to avoid surprising users on shared machines.
 */

import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { logger } from '../../logger';

const DEFAULT_BROADCAST_PORT = 8788;
const DEFAULT_BROADCAST_INTERVAL_MS = 2_000;
/**
 * CR02 A3 / B4: bounds applied to the user-configurable
 * `broadcastPort` / `broadcastIntervalMs`. Values outside the
 * range fall back to the default with a one-shot warning. The
 * package.json schema already enforces `1024 <= broadcastPort <=
 * 65535`, but the runtime historically trusted any value (B4):
 * `broadcastPort = 0` from a hand-edited `config.json` would
 * silently send UDP to port 0 and produce OS-dependent behaviour.
 */
const MIN_BROADCAST_PORT = 1024;
const MAX_BROADCAST_PORT = 65535;
const MIN_BROADCAST_INTERVAL_MS = 500;
/**
 * Upper bound on the broadcast interval. Default 2 s; 5 min is
 * already an order of magnitude slower than anyone reasonably
 * needs and prevents an editor field typo (`broadcastIntervalMs =
 * 2` -> 30 packets/s) from melting the LAN.
 */
const MAX_BROADCAST_INTERVAL_MS = 5 * 60_000;

/**
 * One-paste client configuration snippets for the most common
 * IDEs that integrate with an OpenAI-compatible gateway. Each
 * snippet is what the user would otherwise copy-paste from the
 * README; the discovery endpoint returns the same payload so the
 * user can paste directly.
 */
export interface ClientConfigSnippet {
  id: string;
  displayName: string;
  /** Minimum-config YAML / JSON / TOML the IDE accepts. The user picks one and pastes into their IDE settings. */
  config: string;
}

export interface DiscoveryBroadcastPayload {
  /** Gateway host (loopback address; service-manager / LAN deployments can override). */
  host: string;
  /** Gateway TCP port. */
  port: number;
  /** Gateway version (matches `bundledVersion` on the running gateway). */
  version: string;
  /** Always `openai` for now. Reserved for future protocol expansion. */
  protocol: 'openai';
  /** Path the OpenAI-compatible endpoints are mounted under. Always `/v1`. */
  path: '/v1';
}

export interface DiscoveryEndpointPayload extends DiscoveryBroadcastPayload {
  /** Date / time the beacon was last emitted (ISO 8601). Surfaced for debug only. */
  lastBroadcastAt: string;
  /** True when the UDP broadcaster is currently running. */
  broadcasting: boolean;
  /** One-paste client config snippets for the most common IDEs. Always present; may be empty when no clients are configured. */
  clients: ClientConfigSnippet[];
  /** Effective broadcast port (after defaults + overrides). */
  broadcastPort: number;
  /** Effective broadcast interval (ms). */
  broadcastIntervalMs: number;
}

export interface DiscoveryBeaconOptions {
  host: string;
  port: number;
  version: string;
  broadcastPort?: number;
  broadcastIntervalMs?: number;
  /** Optional address override; defaults to `255.255.255.255` (limited broadcast). */
  broadcastAddress?: string;
}

/**
 * Lifecycle wrapper around the UDP broadcast socket. `start()`
 * begins emitting `payload` every `intervalMs`; `stop()` closes
 * the socket and clears the timer. The class is intentionally
 * tiny so the gateway's `start()` / `stop()` paths stay
 * straight-line (no extra try/catch wrapping needed).
 */
export class DiscoveryBeacon {
  private socket: UdpSocket;
  private readonly broadcastAddress: string;
  private readonly broadcastPort: number;
  private readonly intervalMs: number;
  private readonly payload: DiscoveryBroadcastPayload;
  private timer: NodeJS.Timeout | undefined;
  private bound = false;
  /**
   * `/review uncommitted` F5: `start()` schedules an async bind
   * callback and only sets `this.bound = true` inside it. If
   * `stop()` is called between `start()` returning and the bind
   * callback firing, the callback still runs and the beacon starts
   * emitting UDP after the caller believes `stop()` has torn it
   * down. This flag flips to `true` in `stop()` and is consulted
   * at the top of the bind callback to short-circuit the setup.
   */
  private stopped = false;
  /**
   * F5: a closed dgram socket cannot be re-bound; `start()` checks
   * this flag and recreates the socket if it has been torn down
   * since the last `start()`.
   */
  private socketClosed = false;
  private lastBroadcastAt = '';
  /**
   * CR02 B2: one-shot guard so the `socket.on('error')` and
   * `setBroadcast()` failure paths each log at most once per
   * beacon instance. Without this, a hostile LAN or a kernel
   * without `CAP_NET_BROADCAST` would either spam the log on
   * every tick or stay silent, leaving the user with a beacon
   * that pretends to broadcast but never actually emits anything.
   */
  private errorLogged = false;

  constructor(options: DiscoveryBeaconOptions) {
    this.broadcastAddress = options.broadcastAddress ?? '255.255.255.255';
    // CR02 B4: clamp `broadcastPort` into the valid range and
    // log a warning when the user supplied an out-of-range value
    // (the package.json schema already enforces 1024-65535, but a
    // hand-edited `~/.aiflowbridge/config.json` or the test
    // harness can still pass `0`). Falling back to the default is
    // safer than sending UDP to port 0 (OS-dependent behaviour).
    const requestedPort = options.broadcastPort ?? DEFAULT_BROADCAST_PORT;
    if (typeof requestedPort !== 'number' || !Number.isFinite(requestedPort) || requestedPort < MIN_BROADCAST_PORT || requestedPort > MAX_BROADCAST_PORT) {
      logger.warn(
        `[Discovery] broadcastPort=${JSON.stringify(requestedPort)} is out of range ` +
          `[${MIN_BROADCAST_PORT}, ${MAX_BROADCAST_PORT}]; falling back to ${DEFAULT_BROADCAST_PORT}.`
      );
      this.broadcastPort = DEFAULT_BROADCAST_PORT;
    } else {
      this.broadcastPort = requestedPort;
    }
    // CR02 A3: clamp the broadcast interval into a sane range.
    // The lower bound is enforced by `Math.max`; the upper bound
    // is new and prevents an editor typo (`2` -> 30 pkts/s)
    // from saturating the LAN. A user who really wants a 6-hour
    // interval can still set it via the env var path.
    const requestedIntervalMs = options.broadcastIntervalMs ?? DEFAULT_BROADCAST_INTERVAL_MS;
    if (typeof requestedIntervalMs !== 'number' || !Number.isFinite(requestedIntervalMs)) {
      logger.warn(
        `[Discovery] broadcastIntervalMs=${JSON.stringify(requestedIntervalMs)} is not a finite number; ` +
          `falling back to ${DEFAULT_BROADCAST_INTERVAL_MS}ms.`
      );
      this.intervalMs = Math.max(MIN_BROADCAST_INTERVAL_MS, DEFAULT_BROADCAST_INTERVAL_MS);
    } else if (requestedIntervalMs < MIN_BROADCAST_INTERVAL_MS) {
      this.intervalMs = MIN_BROADCAST_INTERVAL_MS;
    } else if (requestedIntervalMs > MAX_BROADCAST_INTERVAL_MS) {
      logger.warn(
        `[Discovery] broadcastIntervalMs=${requestedIntervalMs} exceeds the ${MAX_BROADCAST_INTERVAL_MS}ms ceiling; clamping.`
      );
      this.intervalMs = MAX_BROADCAST_INTERVAL_MS;
    } else {
      this.intervalMs = requestedIntervalMs;
    }
    this.payload = {
      host: options.host,
      port: options.port,
      version: options.version,
      protocol: 'openai',
      path: '/v1',
    };
    this.socket = createSocket('udp4');
  }

  /**
   * Best-effort start. The UDP socket may fail to bind on some
   * platforms (e.g. the user has no privilege for the broadcast
   * port); we surface the error to the caller and leave the
   * beacon inert. The HTTP /v1/discovery endpoint still works
   * even when the beacon is disabled (the user can paste the URL
   * from the dashboard).
   */
  start(): void {
    if (this.bound) return;
    // `/review uncommitted` F5: clear the `stopped` flag at the
    // start of every `start()` so a `start()` -> `stop()` -> `start()`
    // sequence works correctly. Without this, the second `start()`
    // would short-circuit at the bind callback forever.
    this.stopped = false;
    // F5: a previously closed socket cannot be re-bound. Recreate
    // it on each start() that follows a stop().
    if (this.socketClosed) {
      this.socket = createSocket('udp4');
      this.socketClosed = false;
    }
    try {
      this.socket.bind(0, () => {
        // F5: if `stop()` was called between `start()` returning
        // and the bind callback firing, refuse to bring the beacon
        // up. Close the half-bound socket synchronously.
        if (this.stopped) {
          try {
            this.socket.close();
            this.socketClosed = true;
          } catch {
            // ignore close errors
          }
          return;
        }
        // setBroadcast(true) is required on POSIX to send to the
        // limited broadcast address (255.255.255.255) without
        // ENETUNREACH. Node does the `setsockopt` for us.
        try {
          this.socket.setBroadcast(true);
        } catch (error) {
          // CR02 B2: log at least once when setBroadcast throws.
          // Without this, a Linux user without CAP_NET_BROADCAST
          // would see a beacon that pretends to work but never
          // reaches the LAN. The HTTP /v1/discovery endpoint is
          // still reachable on the loopback URL.
          this.logBeaconError('setBroadcast(true) failed', error);
        }
        this.bound = true;
        this.emit();
        this.timer = setInterval(() => this.emit(), this.intervalMs);
      });
      this.socket.on('error', (error) => {
        // CR02 B2: log at least once instead of swallowing.
        this.logBeaconError('socket error', error);
      });
    } catch (error) {
      // CR02 B2: synchronous bind failures (Windows when the
      // requested port is already held, etc.) now log once too.
      this.logBeaconError('socket bind failed', error);
    }
  }

  /**
   * CR02 B2: emit at most one warning per beacon instance per
   * distinct failure kind. `errorLogged` is intentionally a
   * single boolean (not a Set of kinds) so we surface the FIRST
   * error and stay silent afterwards; the goal is to make the
   * "beacon is inert" condition visible without spamming the
   * log every tick.
   */
  private logBeaconError(kind: string, error: unknown): void {
    if (this.errorLogged) {
      return;
    }
    this.errorLogged = true;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[Discovery] ${kind}: ${message || '<no message>'}. UDP broadcast disabled; HTTP /v1/discovery on the loopback URL still works.`);
  }

  stop(): void {
    // `/review uncommitted` F5: flip the flag first so any
    // in-flight bind callback short-circuits instead of arming
    // the timer after we have already torn things down.
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // Always tear down the socket on stop(). The next start() will
    // recreate it (F5: a closed dgram socket cannot be re-bound).
    try {
      this.socket.close();
      this.socketClosed = true;
    } catch {
      // ignore close errors (already closed)
    }
    this.bound = false;
  }

  isRunning(): boolean {
    return this.bound && this.timer !== undefined;
  }

  /**
   * Return the canonical payload for the HTTP `/v1/discovery`
   * endpoint. Includes the running state + last broadcast time +
   * client snippets the dashboard / IDE settings UI can render.
   */
  endpointPayload(options: { clients?: ClientConfigSnippet[] } = {}): DiscoveryEndpointPayload {
    return {
      ...this.payload,
      lastBroadcastAt: this.lastBroadcastAt,
      broadcasting: this.isRunning(),
      clients: options.clients ?? [],
      broadcastPort: this.broadcastPort,
      broadcastIntervalMs: this.intervalMs,
    };
  }

  private emit(): void {
    if (!this.bound) return;
    const json = JSON.stringify(this.payload);
    const buffer = Buffer.from(json, 'utf8');
    try {
      this.socket.send(buffer, 0, buffer.length, this.broadcastPort, this.broadcastAddress, (error) => {
        if (!error) {
          this.lastBroadcastAt = new Date().toISOString();
        }
      });
    } catch {
      // UDP send is fire-and-forget; if the kernel buffer is
      // saturated we just skip the next tick. The interval will
      // try again.
    }
  }
}

/**
 * Build the one-paste client config snippets returned by the
 * `/v1/discovery` endpoint. Each snippet is self-contained: the
 * user picks one, pastes it into their IDE's gateway settings,
 * and the IDE connects to the local AIFlowBridge without further
 * configuration. Snippets are built from the supplied `host` /
 * `port` so the same builder works for both loopback and LAN
 * deployments.
 */
export function buildClientConfigSnippets(host: string, port: number): ClientConfigSnippet[] {
  const baseUrl = `http://${host}:${port}/v1`;
  return [
    {
      id: 'continue',
      displayName: 'Continue (VS Code / JetBrains)',
      config:
        '{\n' +
        '  "models": [\n' +
        '    {\n' +
        '      "title": "AIFlowBridge",\n' +
        '      "provider": "openai",\n' +
        `      "apiBase": "${baseUrl}",\n` +
        '      "apiKey": "sk-aiflowbridge-local"\n' +
        '    }\n' +
        '  ]\n' +
        '}',
    },
    {
      id: 'kilocode',
      displayName: 'Kilo Code',
      config:
        '{\n' +
        '  "aiflowbridge.providers": [\n' +
        '    {\n' +
        `      "id": "aiflowbridge-local",\n` +
        `      "baseUrl": "${baseUrl}",\n` +
        '      "apiKey": "sk-aiflowbridge-local",\n' +
        '      "model": "MiniMax-M3"\n' +
        '    }\n' +
        '  ]\n' +
        '}',
    },
    {
      id: 'openai-sdk',
      displayName: 'OpenAI Python SDK',
      config:
        'from openai import OpenAI\n' +
        'client = OpenAI(\n' +
        `    base_url="${baseUrl}",\n` +
        '    api_key="sk-aiflowbridge-local",\n' +
        ')\n' +
        'response = client.chat.completions.create(\n' +
        '    model="MiniMax-M3",\n' +
        '    messages=[{"role": "user", "content": "Hello"}],\n' +
        ')',
    },
    {
      id: 'curl',
      displayName: 'curl',
      config:
        'curl -X POST "' + baseUrl + '/chat/completions" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        '  -H "Authorization: Bearer sk-aiflowbridge-local" \\\n' +
        '  -d \'{"model":"MiniMax-M3","messages":[{"role":"user","content":"Hello"}]}\'',
    },
  ];
}
