import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { URL } from 'node:url';
import { logger } from '../../logger';
import { detectLanguageHintFromPayload, selectProviderWithLanguage } from '../context/language-routing';
import { detectWorkspaceContextFromSettings, renderWorkspaceContext, type WorkspaceLanguage } from '../context/workspace-context';
import { buildModelCatalog } from '../providers';
import type { TelemetryPersisterLike } from '../telemetry';
import { estimateCostFromProfile, estimatePromptTokensFromPayload, TelemetryStore } from '../telemetry';
import { buildPromptSummary, buildResponseSummary } from '../telemetry/summary';
import { fetchMinimaxPromptTokens } from '../token-counter';
import type {
  AiFlowBridgeConfig,
  GatewaySettings,
  GatewayStatus,
  ProviderProfile,
  ReplayResponse,
  RequestTelemetry,
  TelemetrySnapshot,
} from '../types';
import { buildClientConfigSnippets, DiscoveryBeacon } from './discovery';
import { applyOpenRouterAttributionHeaders } from './openrouter-headers';
import { compareSemver, GATEWAY_SERVICE_NAME, isPortInUse, probeServerVersion, requestPeerShutdown, waitUntilPortFree } from './probe';

interface GatewaySnapshotListener {
  (status: GatewayStatus, snapshot: TelemetrySnapshot): void;
}

export type ResolveApiKeyFn = (vendor: string) => Promise<string | undefined>;
export type TelemetryStateLoader = () => TelemetrySnapshot | undefined;
export type TelemetryStateSaver = (snapshot: TelemetrySnapshot) => void;

/**
 * Optional pluggable hook used to make the singleton/version-aware restart
 * flow testable. The default implementation shows a non-modal VS Code
 * information message; tests inject a stub instead.
 */
export interface UserPrompt {
  showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
}

/**
 * Outcome of `handleOccupiedPort()`. Used by the runtime to surface a
 * targeted user-facing error when the user asked for a restart but the
 * peer never freed the port (typical of Windows TIME_WAIT or a hung peer).
 */
export type HandleOccupiedPortResult = { kind: 'joined' } | { kind: 'proceed-bind' } | { kind: 'restart-failed'; peerPid: number };

export class GatewayService {
  private server: Server | undefined;
  /**
   * Tracks every active keep-alive socket. Used by `stop()` to drain
   * lingering connections when `server.closeAllConnections()` is not
   * available (Node < 18.2) or as a defensive fallback. `close(cb)` only
   * waits for in-flight requests; idle keep-alive sockets would otherwise
   * keep the listening port bound and cause `EADDRINUSE` on the next
   * activation.
   */
  private readonly activeSockets = new Set<Socket>();
  /**
   * Tracks which `Socket`s already have a `'close'` listener wired
   * by the request handler. Without this, every HTTP request on
   * the same long-lived HTTP/1.1 keep-alive socket would register
   * a new `socket.once('close', ...)` listener on the SAME `Socket`
   * emitter; after ~11 requests on the same connection Node
   * prints `MaxListenersExceededWarning: Possible EventEmitter
   * memory leak detected. 11 close listeners added to [Socket]`
   * Functionally benign (`Set.delete` is
   * idempotent) but noisy and correlated with the same workload
   * pattern that triggers MiniMax upstream throttling. WeakSet so
   * the `Socket` can still be GC'd when its refcount drops.
   */
  private readonly wiredSocketClosers = new WeakSet<Socket>();
  /**
   * counter of in-flight `/v1/chat/completions` requests.
   * When the value reaches `config.gateway.maxConcurrentRequests`, the
   * gateway returns 429 to any new request. Incremented at the start
   * of `forwardChatCompletion` and decremented in a `finally` so the
   * counter is exact even on error, abort, or upstream timeout. Cheap
   * to read (single integer compare-and-increment) and non-blocking.
   */
  private inFlightRequestsField = 0;
  /**
   * Set to `true` when the service could not bind the configured port
   * because an existing peer gateway was detected (and accepted as a
   * joinable peer - same/newer version, or older version with the user
   * choosing "Keep current version" / dismissing the prompt). When
   * `joined` is true, the gateway is reachable through the peer at
   * `config.gateway.baseUrl`, even though we do not own a local socket.
   * Exposed via the `running` getter so the dashboard and status bar
   * reflect that the user-facing service is up.
   */
  private joined = false;
  private config: AiFlowBridgeConfig;
  /**
   * Bundled gateway version (the extension's `package.json` version the
   * runtime passed to the constructor). Exposed via the `bundledVersion`
   * getter so the dashboard header can show which build the
   * running gateway corresponds to.
   */
  private readonly bundledVersionField: string;
  private readonly startedAt: string;
  private readonly telemetry: TelemetryStore;
  private readonly userPrompt: UserPrompt;
  private unsubscribePersist: (() => void) | undefined;
  private persistDebounce: NodeJS.Timeout | undefined;
  private static readonly PERSIST_DEBOUNCE_MS = 1000;
  private persistenceInitialized = false;
  /**
   * Per-instance random token that peers must provide in the
   * `X-AIFlowBridge-Shutdown-Token` header when calling `POST /shutdown`.
   * Generated once at construction, returned by `GET /version`, and
   * required to authenticate shutdown requests (see `01 Modifications`
   * item 1.1: a prior version of the gateway trusted any loopback peer,
   * which let any local process stop the gateway).
   */
  private readonly shutdownToken: string = randomUUID();
  /**
   * Zero-conf discovery beacon (action plan item #4). Lazy: built
   * on first `start()` only when the user opted in via
   * `aiflowbridge.gateway.discovery.enabled`, then torn down on
   * `stop()`. `null` when discovery is disabled.
   */
  private discoveryBeacon: DiscoveryBeacon | null = null;
  /**
   * Per-instance provider concurrency semaphores (hardening).
   * Each `GatewayService` keeps its own Map so
   * multiple instances in the same process (test suite, dev
   * reload, multiple standalones) do not share provider caps.
   * Previously a module-level Map, which leaked slots across
   * instances and made the per-test isolation unreliable.
   */
  private readonly providerSemaphores = new Map<string, ProviderSemaphore>();
  /**
   * active SSE subscribers. The `streamSseEvents` path
   * tracks each open response here so we can (a) refuse with HTTP
   * 429 when a new client would push us past `events.maxConnections`,
   * and (b) close every socket on `stop()` so a graceful shutdown
   * does not leave dangling subscribers. The Set is owned per
   * instance; multiple `GatewayService` instances in the same
   * process do not share counts.
   */
  private readonly activeSseConnections = new Set<ServerResponse>();

  constructor(
    config: AiFlowBridgeConfig,
    private readonly onUpdate?: GatewaySnapshotListener,
    private readonly resolveApiKey?: ResolveApiKeyFn,
    private readonly loadState?: TelemetryStateLoader,
    private readonly saveState?: TelemetryStateSaver,
    bundledVersion: string = '0.0.0',
    userPrompt?: UserPrompt,
    persister?: TelemetryPersisterLike
  ) {
    this.config = config;
    this.bundledVersionField = bundledVersion;
    this.startedAt = new Date().toISOString();
    this.userPrompt = userPrompt ?? defaultUserPrompt;
    // When a file-based persister is supplied, `TelemetryStore.record()`
    // fires the on-disk write directly (fire-and-forget). The legacy
    // `saveState` debounce path below is only used as a fallback for
    // unit tests and any caller that still relies on the globalState
    // hook. See `src/aiflowbridge/telemetry/persistence.ts`.
    this.telemetry = new TelemetryStore(persister);
    // Persistence wiring is deferred to init() so the caller has a chance
    // to set up its own state (e.g. VS Code ExtensionContext) before the
    // load/save callbacks run. Constructing the service and immediately
    // running load() from the constructor breaks when the load callback
    // closes over a field that is only assigned later by a parameter
    // property in the runtime's own constructor.
  }

  /**
   * Wire the telemetry load / save callbacks. Must be called once before
   * the gateway starts handling traffic. Idempotent: subsequent calls are
   * no-ops (the listeners are subscribed at most once).
   */
  init(): void {
    if (this.persistenceInitialized) {
      return;
    }
    this.persistenceInitialized = true;

    if (this.loadState) {
      try {
        this.telemetry.restore(this.loadState());
      } catch (error) {
        logger.warn(`[Gateway] Failed to restore persisted telemetry: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.saveState) {
      this.unsubscribePersist = this.telemetry.subscribe((snapshot) => {
        // Debounce disk writes to avoid hammering globalState on every
        // chat-completion request.
        if (this.persistDebounce) {
          clearTimeout(this.persistDebounce);
        }
        this.persistDebounce = setTimeout(() => {
          try {
            this.saveState?.(snapshot);
          } catch (error) {
            logger.warn(`[Gateway] Failed to persist telemetry: ${error instanceof Error ? error.message : String(error)}`);
          }
        }, GatewayService.PERSIST_DEBOUNCE_MS);
      });
    }
  }

  get running(): boolean {
    return Boolean(this.server) || this.joined;
  }

  /**
   * returns `true` when this `GatewayService`
   * did not bind a local socket but instead joined an existing peer
   * (the standalone gateway, or another VS Code window that owns the
   * gateway lock). The status bar uses this to surface the
   * `AIFlowBridge ↗ external` indicator (action 7 of the standalone
   * plan).
   */
  get isJoined(): boolean {
    return this.joined && !this.server;
  }

  /**
   * number of in-flight upstream `/v1/chat/completions`
   * requests. Surfaced via the status payload (see `status()`) so the
   * runtime can forward it to the dashboard and status bar without
   * having to reach into the gateway internals.
   */
  get inFlightRequests(): number {
    return this.inFlightRequestsField;
  }

  get baseUrl(): string {
    return this.config.gateway.baseUrl;
  }

  /**
   * Bundled gateway version (i.e. the extension's `package.json` version
   * the runtime passed to the constructor). Exposed for the dashboard
   * header so the user can see which build the running gateway
   * corresponds to.
   */
  get bundledVersion(): string {
    return this.bundledVersionField;
  }

  updateConfig(config: AiFlowBridgeConfig): void {
    this.config = config;
    this.emitUpdate();
  }

  snapshot(): TelemetrySnapshot {
    return this.telemetry.snapshot();
  }

  /**
   * Reset the cumulative telemetry counters. Notifies listeners (so the
   * dashboard refreshes) but does not write the cleared state to disk -
   * the caller is responsible for clearing the persisted slot if needed.
   */
  resetMetrics(): void {
    this.telemetry.reset();
  }

  /**
   * Reload the cumulative telemetry from the on-disk snapshot. Returns
   * `true` if a snapshot was loaded (i.e. the persister is configured
   * AND the file existed), `false` otherwise. Used by the dashboard
   * Refresh button on a non-leader window to pick up writes from the
   * leader window without a reload.
   */
  refreshFromDisk(): boolean {
    return this.telemetry.refreshFromDisk();
  }

  /**
   * Remove a single request entry from the cumulative state. Used by
   * the dashboard's per-row trash button. The in-memory store is
   * updated synchronously; the on-disk file is updated asynchronously
   * through the persister (under a file lock when one is configured).
   * Returns `true` if the entry was found in the in-memory store.
   */
  removeEntry(entryId: string): boolean {
    return this.telemetry.removeEntry(entryId);
  }

  /**
   * wipe the captured `promptSummary` / `responseSummary`
   * fields from every recorded entry (in-memory AND on disk),
   * without touching the cumulative counters or per-bucket maps.
   * Used by the `AIFlowBridge: Purge session log` command.
   * Distinct from `resetMetrics()` (which wipes the counters too).
   *
   * Returns the number of entries whose summaries were cleared in
   * memory; the on-disk wipe resolves to its own count.
   */
  purgeSessionLog(): { inMemory: number; onDisk: Promise<number> } {
    return this.telemetry.purgeSessionLog();
  }

  /**
   * Record a request driven by VS Code Copilot Chat (the
   * `vscode.lm.registerLanguageModelChatProvider` path). Routed to
   * the same `TelemetryStore` instance that backs the gateway HTTP
   * path so the dashboard reads Copilot Chat + gateway traffic from
   * the same source.
   *
   * Action plan item #6: closes the historical blind spot in the
   * metrics view where ~50% of usage (the Copilot Chat path) was
   * invisible because the gateway only ever saw its own traffic.
   */
  recordFromCopilotChat(options: {
    providerId: string;
    providerLabel: string;
    model: string;
    status: number;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCost?: number;
    estimated?: boolean;
    errorMessage?: string;
  }): void {
    this.telemetry.recordFromCopilotChat(options);
  }

  async start(): Promise<GatewayStatus> {
    if (this.server) {
      return this.status();
    }

    // Check if another instance already occupies the configured port
    if (await isPortInUse(this.config.gateway.port)) {
      const result = await this.handleOccupiedPort();
      if (result.kind === 'joined') {
        return this.status();
      }
      if (result.kind === 'restart-failed') {
        // Surface the peer PID to the caller (runtime) so it can show a targeted user-facing error.
        const error = new Error(
          `Peer gateway (pid ${result.peerPid}) did not free port ${this.config.gateway.port} within timeout. ` +
            `If another AIFlowBridge is binding this port, stop it manually; otherwise wait for TIME_WAIT to clear.`
        );
        (error as Error & { code?: string; peerPid?: number }).code = 'EPEERSTALLED';
        (error as Error & { code?: string; peerPid?: number }).peerPid = result.peerPid;
        throw error;
      }
      // result.kind === "proceed-bind": the port may have been freed by
      // the peer we asked to shut down. Fall through to listen().
    }
    this.server = createServer((request, response) => {
      const socket = request.socket;
      this.activeSockets.add(socket);
      // wire the `'close'` cleanup listener at most
      // once per PHYSICAL socket, not once per HTTP request. HTTP/1.1
      // keep-alive reuses one TCP socket for N sequential requests;
      // the old code accumulated N listeners on the same emitter and
      // triggered `MaxListenersExceededWarning` after the 11th
      // request. Functionally benign (Set.delete is idempotent, the
      // listeners are `once`), but loud and correlated with the same
      // workload pattern (3 agents / long-lived keep-alive) that
      // triggers the upstream throttling bug.
      if (!this.wiredSocketClosers.has(socket)) {
        this.wiredSocketClosers.add(socket);
        socket.once('close', () => {
          this.activeSockets.delete(socket);
        });
      }
      void this.handleRequest(request, response).catch((error: unknown) => {
        logger.error('[Gateway] Request handling error', error);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        response.end(JSON.stringify({ error: 'Gateway failure' }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        resolve();
        return;
      }

      const onError = (error: Error): void => {
        server.off('listening', onListening);
        // Drop the half-constructed server so `running` reports `false` and a
        // subsequent `start()` (e.g. after the peer frees the port, or via the
        // "Start local gateway" command) re-enters the bind path instead of
        // short-circuiting on a stale `this.server` reference. Without this
        // cleanup, an EACCES/EADDRINUSE leaves `this.server` truthy and the
        // runtime falsely reports the gateway as "already running" (MT05).
        this.server = undefined;
        try {
          server.close();
        } catch {
          // The server never reached 'listening'; close() is best-effort.
        }
        logger.error(`[Gateway] Failed to start on port ${this.config.gateway.port}: ${error.message}`);
        reject(error);
      };

      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.config.gateway.port, '127.0.0.1');
    });

    // After successful listen, sync config port/baseUrl to the actual bound port
    // (matters when the configured port was 0 - OS-assigned ephemeral port).
    const address = this.server?.address();
    if (address && typeof address === 'object' && 'port' in address) {
      this.config.gateway.port = address.port;
      this.config.gateway.baseUrl = `http://127.0.0.1:${address.port}`;
    }

    // Action plan item #4: start the discovery beacon now that we
    // know the actual port. Best-effort; failure leaves the HTTP
    // /v1/discovery endpoint reachable (the beacon is optional,
    // the HTTP discovery is the actual feature).
    const discovery = this.config.gateway.discovery;
    if (discovery && discovery.enabled === true) {
      this.discoveryBeacon = new DiscoveryBeacon({
        host: '127.0.0.1',
        port: this.config.gateway.port,
        version: this.bundledVersion,
        broadcastPort: discovery.broadcastPort,
        broadcastIntervalMs: discovery.broadcastIntervalMs,
      });
      this.discoveryBeacon.start();
    }

    this.emitUpdate();
    return this.status();
  }

  async stop(): Promise<void> {
    if (!this.server && !this.joined) {
      return;
    }

    this.joined = false;
    if (this.server) {
      const current = this.server;
      this.server = undefined;
      // drain keep-alive sockets before close. Without this,
      // an idle keep-alive socket keeps the listening port bound and the
      // next activation (e.g. after a window reload) hits EADDRINUSE.
      // `closeAllConnections()` (Node >= 18.2) is preferred; the manual
      // `activeSockets` loop is the defensive fallback for older Node
      // versions where the method is absent.
      try {
        current.closeAllConnections?.();
      } catch (error) {
        logger.warn(`[Gateway] closeAllConnections failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const socket of this.activeSockets) {
        try {
          socket.destroy();
        } catch {
          // Socket may already be closed by the OS; ignore.
        }
      }
      this.activeSockets.clear();
      // close every active SSE subscriber so a graceful
      // shutdown does not leave dangling listeners (the heartbeat
      // would mask this from a passive observer for up to 15 s).
      for (const res of this.activeSseConnections) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      this.activeSseConnections.clear();
      await new Promise<void>((resolve) => {
        current.close(() => resolve());
      });
    }

    // Action plan item #4: tear down the discovery beacon so we
    // stop emitting UDP packets after `stop()`. `stop()` is
    // idempotent (the `if (this.discoveryBeacon)` guards the
    // second call).
    if (this.discoveryBeacon) {
      this.discoveryBeacon.stop();
      this.discoveryBeacon = null;
    }

    this.emitUpdate();
  }

  dispose(): void {
    // `dispose()` is fire-and-forget by contract (matches
    // VS Code's `Disposable.dispose()` signature), but `stop()` is
    // idempotent via the `!this.server && !this.joined` guard above
    // so calling it again from `deactivate()` is a no-op.
    void this.stop();
  }

  private status(): GatewayStatus {
    return {
      running: this.running,
      port: this.config.gateway.port,
      baseUrl: this.config.gateway.baseUrl,
      providerCount: this.config.providers.filter((provider) => provider.enabled).length,
      inFlightRequests: this.inFlightRequests,
      maxConcurrentRequests: this.config.gateway.maxConcurrentRequests,
      maxConcurrentPerProvider: resolveMaxConcurrentPerProvider(this.config.gateway),
      upstreamIdleTimeoutMs: resolveUpstreamIdleTimeoutMs(this.config.gateway),
      streamTotalTimeoutMs: resolveStreamTotalTimeoutMs(this.config.gateway),
    };
  }

  private emitUpdate(): void {
    this.onUpdate?.(this.status(), this.telemetry.snapshot());
  }

  /**
   * Decide what to do when the configured port is already in use.
   *
   * - `joined`         - the caller should treat the gateway as joined to
   *                      the peer and return `this.status()` without
   *                      binding.
   * - `proceed-bind`   - the caller should attempt to bind. Used when the
   *                      port is occupied by a non-gateway service (the
   *                      bind will fail loudly), or when the user asked
   *                      for a restart and `waitUntilPortFree` returned
   *                      `true` (the peer has released the port).
   * - `restart-failed` - the user asked for a restart and the peer did not
   *                      free the port within the timeout (typical of
   *                      Windows TIME_WAIT or a hung peer). The caller
   *                      should surface a user-facing error that includes
   *                      the peer PID.
   *
   * All probe and shutdown requests are sent to the hard-coded loopback
   * URL (`http://127.0.0.1:<port>`), never to the user-configurable
   * `baseUrl`, to prevent SSRF via a hostile setting value.
   */
  private async handleOccupiedPort(): Promise<HandleOccupiedPortResult> {
    logger.info(`[Gateway] Port ${this.config.gateway.port} is in use, probing peer...`);

    const port = this.config.gateway.port;
    // configurable probe timeout (default 500 ms) with one
    // retry after 100 ms. The 200 ms default used in 1.7.0 was too
    // aggressive on Windows / cold-start; the new total budget is
    // 1.1 s + probeTimeoutMs which still keeps activation responsive.
    // Users on unusually slow hosts (or with a peer that is being
    // spun up by the same activation) can raise the cap via
    // `aiflowbridge.gateway.probeTimeoutMs`.
    const peer = await probeServerVersionWithRetry(port, this.config.gateway.probeTimeoutMs);

    if (peer && peer.name === GATEWAY_SERVICE_NAME) {
      if (compareSemver(peer.version, this.bundledVersion) < 0) {
        const restartLabel = `Restart with v${this.bundledVersion}`;
        const keepLabel = 'Keep current version';
        const choice = await this.userPrompt.showInformationMessage(
          `AIFlowBridge gateway v${peer.version} is running. Restart with v${this.bundledVersion}?`,
          restartLabel,
          keepLabel
        );

        if (choice === restartLabel) {
          logger.info(`[Gateway] User chose to restart peer v${peer.version} (pid=${peer.pid})`);
          await requestPeerShutdown(port, peer.shutdownToken ? { shutdownToken: peer.shutdownToken } : {});
          const freed = await waitUntilPortFree(port, { timeoutMs: 3000 });
          if (!freed) {
            logger.warn(`[Gateway] Port ${port} did not free up within timeout (peer pid=${peer.pid})`);
            return { kind: 'restart-failed', peerPid: peer.pid };
          }
          // Port is free; caller will attempt to bind.
          return { kind: 'proceed-bind' };
        }

        // Keep current version (or user dismissed the prompt): join the peer.
        logger.info(`[Gateway] Joining existing gateway v${peer.version} on 127.0.0.1:${port}`);
        this.joined = true;
        this.emitUpdate();
        return { kind: 'joined' };
      }

      // Same or newer version: join silently (legacy behaviour).
      logger.info(`[Gateway] Existing gateway v${peer.version} detected, joining on 127.0.0.1:${port}`);
      this.joined = true;
      this.emitUpdate();
      return { kind: 'joined' };
    }

    if (peer) {
      logger.warn(`[Gateway] Port ${port} is occupied by another service named "${peer.name}" (not aiflowbridge-gateway)`);
    } else {
      logger.warn(`[Gateway] Port ${port} is occupied by a non-gateway service`);
    }
    return { kind: 'proceed-bind' };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', this.config.gateway.baseUrl);
    const path = requestUrl.pathname;

    if (request.method === 'GET' && path === '/version') {
      // The server binds on 127.0.0.1 only, so this endpoint is reachable
      // only from the local machine. Used by cooperative-restart detection
      // (src/aiflowbridge/gateway/probe.ts).
      this.writeJson(response, 200, {
        name: GATEWAY_SERVICE_NAME,
        version: this.bundledVersion,
        pid: process.pid,
        startedAt: this.startedAt,
        shutdownToken: this.shutdownToken,
      });
      return;
    }

    if (request.method === 'POST' && path === '/shutdown') {
      // Loopback-only (server binds 127.0.0.1). Used by peers that detected
      // a version mismatch and want to start a fresh instance.
      // // Authentication: the peer must provide this instance's `shutdownToken`
      // (returned by GET /version) in the `X-AIFlowBridge-Shutdown-Token`
      // header. Without a valid token, we refuse with 403. Loopback binding
      // is necessary but not sufficient: any other local process (or a
      // misconfigured curl one-liner) could otherwise stop the gateway.
      // // We intentionally do NOT call process.exit(0): the gateway runs in
      // the VS Code extension host, and killing that process would also
      // kill every other extension the user has installed. Closing the
      // listening socket is enough to let the new activation bind the port.
      const providedToken = request.headers['x-aiflowbridge-shutdown-token'];
      if (typeof providedToken !== 'string' || providedToken !== this.shutdownToken) {
        logger.warn(`[Gateway] Rejected /shutdown from ${request.socket.remoteAddress ?? 'unknown'} (missing or invalid token)`);
        this.writeJson(response, 403, { error: 'Unauthorized shutdown attempt' });
        return;
      }
      logger.info(`[Gateway] Shutdown requested by peer on ${request.socket.remoteAddress ?? 'unknown'}`);
      this.writeJson(response, 200, { ok: true });
      // fix: capture the server handle locally so the deferred
      // close targets the socket that was actually serving the request,
      // not whatever `this.server` may have been reassigned to in the
      // 100 ms gap (e.g. by a concurrent `stop()` call from
      // `deactivate()`). Without this, `?.` swallowed the reassignment
      // and the socket leaked until the OS keep-alive timeout, which
      // could keep the port bound on Windows TIME_WAIT and break the
      // follow-up bind from the new activation.
      const serverToClose = this.server;
      this.server = undefined;
      setTimeout(() => {
        if (serverToClose) {
          void serverToClose.close();
        }
      }, 100);
      return;
    }

    if (request.method === 'GET' && path === '/health') {
      this.writeJson(response, 200, {
        ok: true,
        service: 'AIFlowBridge',
        status: this.status(),
      });
      return;
    }

    if (request.method === 'GET' && (path === '/metrics' || path === '/v1/metrics')) {
      this.writeJson(response, 200, {
        status: this.status(),
        telemetry: this.telemetry.snapshot(),
      });
      return;
    }

    if (request.method === 'GET' && path === '/v1/models') {
      this.writeJson(response, 200, {
        object: 'list',
        data: buildModelCatalog(this.config.providers),
      });
      return;
    }

    // Action plan item #2: `GET /v1/context` exposes the detected
    // workspace context as raw JSON. Useful for IDEs that want to
    // surface "this gateway detected Python + ruff in /home/me/proj"
    // in their settings UI without having to run the detector
    // themselves. The shape mirrors `WorkspaceContext` from
    // `src/aiflowbridge/context/workspace-context.ts` so the IDE
    // can re-use the same TypeScript types on both sides.
    // Action plan item #4: `GET /v1/discovery` returns the canonical
    // discovery payload (host, port, version, broadcasting state,
    // one-paste client config snippets for Continue / Kilo Code /
    // OpenAI SDK / curl). Gated on `gateway.discovery.enabled` so
    // a user who opted out of the LAN-wide broadcast also opts
    // out of the loopback HTTP endpoint (the same `enabled` flag
    // controls both surfaces).
    if (request.method === 'GET' && path === '/v1/discovery') {
      if (!this.config.gateway.discovery?.enabled) {
        this.writeJson(response, 200, {
          enabled: false,
          message: 'Discovery is disabled (gateway.discovery.enabled = false). Set the flag to true and restart the gateway to enable it.',
        });
        return;
      }
      // `this.discoveryBeacon` is null only when discovery is
      // enabled but the gateway has not finished `start()`. When
      // the gateway is fully running + discovery enabled, the
      // beacon was built in `start()`.
      const clients = buildClientConfigSnippets('127.0.0.1', this.config.gateway.port);
      const inner = this.discoveryBeacon
        ? this.discoveryBeacon.endpointPayload({ clients })
        : {
            host: '127.0.0.1',
            port: this.config.gateway.port,
            version: this.bundledVersion,
            protocol: 'openai' as const,
            path: '/v1' as const,
            lastBroadcastAt: '',
            broadcasting: false,
            broadcastPort: this.config.gateway.discovery.broadcastPort ?? 8788,
            broadcastIntervalMs: this.config.gateway.discovery.broadcastIntervalMs ?? 2_000,
          };
      // Add the `enabled: true` discriminator at the top so the
      // shape is symmetric with the disabled branch (the dashboard
      // can `if (body.enabled)` regardless of state).
      this.writeJson(response, 200, { enabled: true, ...inner, clients });
      return;
    }

    if (request.method === 'GET' && path === '/v1/context') {
      const ctx = this.config.gateway.workspaceContext;
      if (!ctx || ctx.enabled === false) {
        this.writeJson(response, 200, {
          enabled: false,
          message: 'Workspace context injection is disabled (gateway.workspaceContext.enabled = false).',
        });
        return;
      }
      // `/review uncommitted` F10: dashboard endpoint wants fresh
      // data on demand, so the cached variant is bypassed here.
      const detected = detectWorkspaceContextFromSettings(ctx, { cached: false, cwdSentinels: CWD_PROJECT_SENTINELS });
      if (!detected) {
        this.writeJson(response, 200, {
          enabled: true,
          message: 'No workspace root resolved (set gateway.workspaceContext.root or AIFLOWBRIDGE_WORKSPACE).',
          languages: [],
          primaryLanguage: null,
          packageManagers: [],
          linters: [],
          formatters: [],
        });
        return;
      }
      this.writeJson(response, 200, {
        enabled: true,
        root: detected.root,
        languages: detected.languages,
        primaryLanguage: detected.primaryLanguage,
        packageManagers: detected.packageManagers,
        linters: detected.linters,
        formatters: detected.formatters,
      });
      return;
    }

    if (request.method === 'POST' && path === '/v1/chat/completions') {
      await this.forwardChatCompletion(request, response);
      return;
    }

    // Action plan item #3: shared session log. `GET /v1/sessions`
    // returns the most recent recorded entries in a lightweight
    // shape (no `responseSummary`; the list view only needs the
    // truncated prompt + totals so the dashboard stays snappy).
    if (request.method === 'GET' && path === '/v1/sessions') {
      const limit = this.resolveSessionListLimit(requestUrl.searchParams);
      this.writeJson(response, 200, {
        object: 'list',
        sessions: this.telemetry.listSessions(limit),
      });
      return;
    }

    // Action plan item #3: replay endpoint. Re-hydrates the stored
    // prompt / response summaries into an OpenAI `chat.completion`-
    // shaped body. Pure read from the in-memory `TelemetryStore`;
    // no upstream re-forward, so a replay is safe to fire
    // indefinitely without cost.
    if (request.method === 'GET' && path.startsWith('/v1/replay/')) {
      const requestId = decodeURIComponent(path.slice('/v1/replay/'.length));
      if (!requestId || requestId.length > 128) {
        this.writeJson(response, 400, { error: 'Missing or invalid requestId' });
        return;
      }
      const entry = this.telemetry.getEntry(requestId);
      if (!entry) {
        this.writeJson(response, 404, { error: 'Request not found', id: requestId });
        return;
      }
      this.writeJson(response, 200, buildReplayResponse(entry));
      return;
    }

    // Action plan item #3: SSE event stream. Emits a `request.recorded`
    // event on every `TelemetryStore.record()` call (and a
    // `config.changed` event when the runtime pushes a fresh
    // config snapshot through the optional hook). The connection
    // is a long-lived HTTP response with `Content-Type:
    // text/event-stream`; clients (the dashboard, an external
    // observer) consume events through the standard `EventSource`
    // API or `curl -N`.
    if (request.method === 'GET' && path === '/v1/events') {
      await this.streamSseEvents(request, response);
      return;
    }

    this.writeJson(response, 404, {
      error: 'Not found',
      path,
    });
  }

  private async forwardChatCompletion(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    // Resolve the originating client once, up-front. The result is
    // propagated to every `recordTelemetry()` call below (streaming
    // finish, non-streaming, catch block) so all paths share the
    // same bucket key. `null` is the sentinel for "no client header
    // AND no User-Agent header"; downstream code coalesces it to the
    // literal `'unknown'` string in the by-client aggregation.
    const clientId = resolveClientId(request);
    // cheap pre-flight check. Reading the body is expensive
    // (10 MB cap, stream piping); we want to bail out with 429 before
    // burning a body-read on a request we are about to reject. The
    // counter is incremented once we commit to processing and
    // decremented in `finally` (below), so the value seen here is the
    // exact in-flight count.
    const cap = this.config.gateway.maxConcurrentRequests;
    if (this.inFlightRequestsField >= cap) {
      // 1 s is a reasonable default: at 20 concurrent requests and
      // an average upstream latency of 5 s, the queue clears in ~5
      // seconds; 1 s tells well-behaved clients to back off briefly
      // without forcing them into a tight retry loop.
      response.setHeader('Retry-After', '1');
      this.writeJson(response, 429, {
        error: 'Too Many Requests',
        requestId,
        inFlight: this.inFlightRequestsField,
        limit: cap,
      });
      return;
    }
    this.inFlightRequestsField++;

    let bodyText: string;
    let payload: Record<string, unknown> | undefined;
    try {
      bodyText = await readBody(request);
      payload = parseJson(bodyText);
    } catch (error) {
      // Body read failed (abort, socket reset, oversize): release the
      // slot before propagating.
      this.inFlightRequestsField--;
      const message = error instanceof Error ? error.message : String(error);
      this.writeJson(response, 400, {
        error: 'Failed to read request body',
        requestId,
        details: message,
      });
      return;
    }

    // Action plan item #3: capture a sanitized + truncated prompt
    // summary at the entry point so every recordTelemetry() call
    // downstream carries it. The summary is computed once here
    // (the request body does not change after the body read) and
    // re-used on the success / streaming / catch paths. When
    // `captureSessionLog` is disabled the summary is `undefined`
    // so the recordTelemetry() path stores empty fields.
    const promptSummary = this.config.captureSessionLog ? buildPromptSummary(payload) : undefined;

    const modelName = typeof payload?.model === 'string' ? payload.model : this.config.gateway.defaultModel;
    const enabledProviders = this.config.providers.filter((profile) => profile.enabled);

    if (enabledProviders.length === 0) {
      this.writeJson(response, 503, {
        error: 'No enabled upstream provider is configured',
        requestId,
      });
      return;
    }

    const provider = selectProviderWithLanguage(
      this.config.providers,
      modelName,
      this.config.gateway.defaultModel,
      resolveLanguageHint(request, payload, this.config),
      this.config.gateway.languageRouting
    );

    if (!provider) {
      const availableIds = enabledProviders.map((profile) => profile.id).join(', ');
      this.writeJson(response, 404, {
        error:
          `No gateway provider matches model "${modelName ?? ''}". Available provider ids: ${availableIds}. ` +
          `Add a provider with that id in the 'aiflowbridge.providers' setting, or use 'AIFlowBridge: Add a custom model'.`,
        requestId,
        requestedModel: modelName ?? null,
        availableProviderIds: enabledProviders.map((profile) => profile.id),
      });
      return;
    }

    const upstreamUrl = resolveUpstreamUrl(provider, 'chat/completions');

    // Resolve API key: use profile key if set, otherwise try the async resolver
    let resolvedKey = provider.apiKey;
    if (!resolvedKey && this.resolveApiKey) {
      try {
        resolvedKey = await this.resolveApiKey(provider.id);
      } catch {
        // Ignore resolve errors; request will fail if upstream requires auth
      }
    }

    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-AIFlowBridge-Request-Id': requestId,
      'X-AIFlowBridge-Provider': provider.id,
    });

    if (resolvedKey) {
      headers.set('Authorization', `Bearer ${resolvedKey}`);
    }

    // OpenRouter-specific attribution header. The OpenRouter docs
    // (https://openrouter.ai/docs/api-reference/listing) ask every
    // client to set `HTTP-Referer` so the request can be attributed
    // back to AIFlowBridge on the OpenRouter dashboard and so the
    // request is eligible for free-tier reliability. Only added when
    // the upstream URL host is openrouter.ai; other vendors are
    // untouched. The pure helper below is exported for the smoke
    // test in `tests/integration/openrouter.smoke.test.ts`.
    applyOpenRouterAttributionHeaders(headers, upstreamUrl, this.bundledVersion);

    // the same AbortController that aborts the upstream
    // `fetch()` also drives the per-provider semaphore. When the
    // local client disconnects (or the watchdog fires) while a
    // request is still queued behind the per-provider cap, the
    // waiter is removed from the FIFO queue instead of being
    // stranded. Created here so we can pass its signal into the
    // slot acquisition below.
    const abortController = new AbortController();
    const abort = (): void => abortController.abort();
    request.once('aborted', abort);
    response.once('close', abort);
    // hoisted so the `endLocalResponseAfterWatchdog`
    // helper (defined right below) and the watchdog setTimeout
    // callbacks can read the resolved config values. The actual
    // timer handles are still assigned inside the `try` block.
    let idleTimeoutMs = resolveUpstreamIdleTimeoutMs(this.config.gateway);
    let totalTimeoutMs = resolveStreamTotalTimeoutMs(this.config.gateway);
    // `abortController.abort()` only aborts the
    // upstream `fetch()`. The pipe from the upstream body to the
    // local `response` does not watch the signal, so when the
    // watchdog fires AFTER headers have arrived (the stream-idle
    // case), we must explicitly end the local response. Without
    // this, the client hangs on the open HTTP response until the
    // OS keep-alive timeout.
    //
    // The pipe may own the `response` lifecycle (`.pipe(response)`
    // drains the source Readable into the response). `response.end()`
    // alone is a no-op when the pipe is still active; we must
    // destroy the source too so the pipe sees the source as
    // terminated and yields the response back to us.
    const endLocalResponseAfterWatchdog = (): void => {
      if (response.writableEnded || response.destroyed) {
        return;
      }
      if (!response.headersSent) {
        // No headers have been sent yet (the headers-idle
        // watchdog fired before the upstream returned headers).
        // We can still write a structured 504 + JSON body.
        response.statusCode = 504;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({
            error: 'Gateway Timeout',
            requestId,
            details: 'Upstream did not respond within the configured idle or total timeout',
            idleTimeoutMs: idleTimeoutMs || undefined,
            totalTimeoutMs: totalTimeoutMs || undefined,
          })
        );
      } else {
        // Headers already streamed (mid-stream abort). We can
        // only end the body; the client will see an incomplete
        // stream. Forcibly destroy the response so the pipe
        // releases it - `response.end()` is a no-op while the
        // pipe is active.
        response.destroy();
      }
    };

    // acquire a per-provider concurrency slot before
    // opening the upstream socket. 3 agents in parallel against
    // MiniMax-M3 (reasoning_split: true) used to send 3 parallel
    // thinking-mode requests + 3 parallel pre-count POSTs against
    // the same API key, which MiniMax throttled to 100 s+ tail
    // latency. A cap of 3 queues the 4th+ parallel request behind
    // the first three instead of opening more parallel sockets.
    // `resolveMaxConcurrentPerProvider` falls back to 3 when the
    // setting is absent (backward compat with older snapshots).
    // `max = 0` disables the cap (used by local dev / tests that
    // want no queueing).
    //
    // the slot is acquired against `abortController.signal`
    // so a client disconnect (or the watchdog firing while we are
    // still queued) drops the waiter from the FIFO instead of
    // leaving it stranded until a slot frees.
    const maxPerProvider = resolveMaxConcurrentPerProvider(this.config.gateway);
    try {
      await this.acquireProviderSlot(provider.id, maxPerProvider, abortController.signal);
    } catch (err) {
      if (isAbortError(err)) {
        // Client went away (or watchdog) before we got a slot.
        // The in-flight counter was bumped above; release it and
        // end the local response cleanly. No telemetry entry:
        // we never opened an upstream socket.
        this.inFlightRequestsField--;
        if (!response.headersSent && !response.writableEnded) {
          response.statusCode = 499; // Client Closed Request (nginx convention)
          response.end();
        }
        return;
      }
      throw err;
    }
    let providerSlotHeld = true;
    // `releaseOnAbort` is called once on every exit path
    // (success, error, timeout) so the slot is never leaked. The
    // helper is a closure so the `finally` block stays symmetric
    // with the abort + finally pattern below.
    const releaseOnAbort = (): void => {
      if (!providerSlotHeld) {
        return;
      }
      providerSlotHeld = false;
      this.releaseProviderSlot(provider.id);
    };

    // Translate AIFB-specific body fields into the upstream API's expected
    // shape (e.g. Kilo Code's `reasoning: true/false` checkbox -> MiniMax's
    // `reasoning_split: true/false`). The translator strips any AIFB-specific
    // fields it consumed so the upstream never sees them.
    const translatedPayload = translatePayloadForUpstream(payload, provider);
    // when a translation actually rewrote a field, log the
    // before/after at the debug level so the user can diagnose "I sent
    // reasoning_effort=high but the model did not think" reports.
    // `translatePayloadForUpstream` is intentionally pure (no side
    // effects, exported for unit testing) - the diagnostic lives at the
    // call site instead, where we already have `logger` and `requestId`.
    if (payload) {
      const hasReasoning = 'reasoning' in payload;
      const hasEffort = 'reasoning_effort' in payload;
      if (hasReasoning || hasEffort) {
        const reasoningSplit = (translatedPayload as Record<string, unknown>).reasoning_split;
        logger.debug(
          `[Gateway] ${requestId} translated upstream payload: ` +
            `reasoning=${hasReasoning ? String(payload.reasoning) : '<absent>'} ` +
            `reasoning_effort=${hasEffort ? String(payload.reasoning_effort) : '<absent>'} ` +
            `-> reasoning_split=${String(reasoningSplit)}`
        );
      }
    }

    // optional workspace-context injection. When `aiflowbridge.gateway.workspaceContext.enabled`
    // is true AND a workspace root has been resolved, prepend a
    // short system-message describing the languages / package
    // managers / linters / formatters detected at the workspace
    // root. The injection is a no-op when context injection is
    // disabled, no workspace root is known, or detection returned
    // no language (e.g. the user opened a non-code folder). Pure
    // system-message prefix; the user's existing system message
    // (if any) is preserved on the next slot. Default to
    // `translatedPayload` so the rest of the pipeline always has a
    // payload to work with.
    //
    // `/review uncommitted` F10: the resolved-root + options-shaping
    // + cache-or-not dance lives in `detectWorkspaceContextFromSettings`.
    let injectedFinalPayload: Record<string, unknown> = translatedPayload;
    const context = detectWorkspaceContextFromSettings(this.config.gateway.workspaceContext, {
      cached: true,
      cwdSentinels: CWD_PROJECT_SENTINELS,
    });
    if (context) {
      const prefix = renderWorkspaceContext(context);
      if (prefix) {
        injectedFinalPayload = prependSystemMessage(translatedPayload, prefix);
        if (logger.debug && context.primaryLanguage) {
          logger.debug(`[Gateway] ${requestId} injected workspace context (languages=${context.languages.join(',')})`);
        }
      }
    }
    // Override the model name in the forwarded request with the provider's
    // upstream model name, so Kilo Code and other clients can use any alias.
    // We always re-serialize (never pass `bodyText` through) so the
    // translation above is guaranteed to reach the upstream.
    const finalPayload =
      provider.model && injectedFinalPayload.model !== provider.model ? { ...injectedFinalPayload, model: provider.model } : injectedFinalPayload;
    const upstreamBody = JSON.stringify(finalPayload);

    let statusCode = 502;
    let promptTokens = estimatePromptTokensFromPayload(payload);
    let completionTokens = 0;
    let totalTokens = promptTokens;
    let estimated = true;
    // / `telemetryRecorded` guards against the
    // streaming `'finish'` listener AND the catch block both trying to
    // record the same entry when an error interrupts the stream.
    let telemetryRecorded = false;
    let ttfbMs = 0;

    // gate the parallel MiniMax `/input_tokens`
    // pre-count on streaming requests. The MiniMax stream endpoint
    // emits usage on the final chunk; firing the pre-count in
    // parallel doubles the upstream load precisely when
    // thinking-mode bursts hurt the most. Default off for
    // streaming; the user can re-enable per-config via
    // `aiflowbridge.gateway.minimaxParallelTokenCount`.
    const isStreamingRequest = Boolean(payload?.stream);
    const parallelTokenCountEnabled = this.config.gateway.minimaxParallelTokenCount ?? false;
    const shouldPreCountTokens = isMinimaxProvider(provider) && (!isStreamingRequest || parallelTokenCountEnabled);
    const tokenCountPromise = shouldPreCountTokens
      ? fetchMinimaxPromptTokens({
          baseUrl: provider.baseUrl,
          apiKey: resolvedKey ?? '',
          model: provider.model,
          messages: Array.isArray(payload?.messages) ? payload.messages : [],
          // Share the same abort signal as the main upstream call
          // if the idle / total watchdog aborts the
          // upstream request, the pre-count is killed cleanly
          // instead of outliving the main request.
          signal: abortController.signal,
        })
      : Promise.resolve(undefined);

    // hoisted timer state so the `catch` and `finally`
    // blocks below can reach them. The actual timer handles and the
    // `clearTimers` closure are assigned inside the `try` block.
    // `idleTimeoutMs` and `totalTimeoutMs` are hoisted above (just
    // after the abort wiring) so the `endLocalResponseAfterWatchdog`
    // helper can read them.
    let idleTimer: NodeJS.Timeout | undefined;
    let totalTimer: NodeJS.Timeout | undefined;
    let clearTimers: () => void = () => {};

    try {
      // upstream idle + total timeouts. Without these,
      // a stalled MiniMax thinking-mode request (the upstream opens
      // the TCP socket but never sends bytes while it queues the
      // request internally) leaves the gateway waiting indefinitely
      // from the client's point of view - the agent UI sits in
      // "standby" for minutes (100+ s tail observed in the bug
      // report). The idle watchdog aborts when no bytes arrive for
      // `upstreamIdleTimeoutMs`; the total watchdog is a bounded
      // safety net for an upstream that trickles bytes forever.
      // `0` disables the corresponding timer. Both timers share
      // the same `abortController` as the client-disconnect abort,
      // so the abort path is unified.
      clearTimers = (): void => {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        if (totalTimer) {
          clearTimeout(totalTimer);
          totalTimer = undefined;
        }
      };
      if (idleTimeoutMs > 0) {
        idleTimer = setTimeout(() => {
          logger.warn(`[Gateway] ${requestId} upstream idle for ${idleTimeoutMs}ms, aborting (provider=${provider.id})`);
          abortController.abort();
          endLocalResponseAfterWatchdog();
        }, idleTimeoutMs);
      }
      if (totalTimeoutMs > 0) {
        totalTimer = setTimeout(() => {
          logger.warn(`[Gateway] ${requestId} upstream total timeout ${totalTimeoutMs}ms reached, aborting (provider=${provider.id})`);
          abortController.abort();
          endLocalResponseAfterWatchdog();
        }, totalTimeoutMs);
      }

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: upstreamBody,
        signal: abortController.signal,
      });
      // Headers arrived: the connection is healthy enough that the
      // idle watchdog no longer needs to fire. The total watchdog
      // stays armed for the lifetime of the stream / body read.
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }

      statusCode = upstreamResponse.status;
      ttfbMs = Date.now() - startedAt;
      const contentType = upstreamResponse.headers.get('content-type') ?? '';
      const isStream = Boolean(payload?.stream) || contentType.includes('text/event-stream');
      // forward any upstream backoff headers so a
      // well-behaved upstream can ask the client to slow down. We
      // propagate on every status (some upstreams use 503 + a
      // Retry-After instead of 429) and expose both `Retry-After`
      // (RFC 9110 delta-seconds / HTTP-date) and the de-facto
      // `X-RateLimit-Reset` / `X-RateLimit-Reset-After` / `X-RateLimit-Remaining`
      // trio used by some providers. The values are passed through
      // verbatim; clients that follow RFC semantics stay
      // RFC-compliant.
      const upstreamBackoffHeaders = ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-reset-after', 'x-ratelimit-remaining', 'x-ratelimit-limit'];
      for (const name of upstreamBackoffHeaders) {
        const value = upstreamResponse.headers.get(name);
        if (value !== null) {
          response.setHeader(name, value);
        }
      }
      // when the upstream returns a backoff status
      // (HTTP 429 or 503 - the typical "slow down" codes) on a
      // streaming request, do NOT pipe the upstream JSON body as
      // an SSE stream. The client requested `stream: true` and
      // would receive a JSON 429-shaped chunked response, which
      // SSE parsers (Kilo Code, Continue, OpenAI SDK, curl --no-buffer)
      // cannot consume. Detect the backoff before piping, end the
      // response cleanly with the upstream body as the JSON
      // payload (already JSON for MiniMax/OpenAI rate-limit
      // responses), surface the status + Retry-After to the
      // client, and let the `response.once('finish')` handler
      // record telemetry.
      const isBackoffStatus = statusCode === 429 || statusCode === 503;
      if (isStream && isBackoffStatus) {
        let backoffBody = '';
        try {
          backoffBody = await upstreamResponse.text();
        } catch {
          // upstream body unreadable: fall through with an empty
          // payload.
        }
        response.setHeader('Content-Type', contentType || 'application/json; charset=utf-8');
        // The chunked / SSE framing we set below would mislead
        // parsers; end without Transfer-Encoding: chunked.
        response.setHeader('Content-Length', String(Buffer.byteLength(backoffBody, 'utf8')));
        response.statusCode = statusCode;
        response.end(backoffBody);
        telemetryRecorded = true;
        const durationMs = Date.now() - startedAt;
        this.recordTelemetry(
          provider,
          modelName ?? provider.model,
          statusCode,
          durationMs,
          promptTokens,
          completionTokens,
          totalTokens,
          estimated,
          clientId,
          promptSummary,
          this.config.captureSessionLog ? buildResponseSummary(backoffBody) : undefined
        );
        if (this.config.logRequests) {
          logger.info(formatRequestLogLine(requestId, provider.id, statusCode, durationMs));
        }
        this.emitUpdate();
        // Skip the streaming pipe entirely. The `finally` block
        // below releases the per-provider slot + decrements the
        // in-flight counter via normal unwinding.
        return;
      }

      if (isStream) {
        // For streaming responses, MiniMax does not return usage in the stream.
        // Use the parallel pre-count from the /input_tokens endpoint if available.
        const upstreamPromptTokens = await tokenCountPromise;
        if (typeof upstreamPromptTokens === 'number' && upstreamPromptTokens > 0) {
          promptTokens = upstreamPromptTokens;
          totalTokens = upstreamPromptTokens;
        }

        response.statusCode = upstreamResponse.status;
        response.setHeader('Content-Type', contentType || 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Connection', 'keep-alive');

        if (upstreamResponse.body) {
          const node = Readable.fromWeb(upstreamResponse.body as unknown as globalThis.ReadableStream<Uint8Array>);
          // re-arm the idle watchdog as soon as we
          // start piping the stream body. The headers-idle timer
          // was cleared at line ~885 because headers arriving is
          // a sign of life, but the stream itself can still go
          // silent before sending any bytes (MiniMax queues the
          // thinking request internally without enqueuing any
          // tokens). Without re-arming here, the watchdog never
          // fires if no `data` event ever arrives.
          if (idleTimeoutMs > 0) {
            idleTimer = setTimeout(() => {
              logger.warn(`[Gateway] ${requestId} upstream stream idle for ${idleTimeoutMs}ms, aborting (provider=${provider.id})`);
              abortController.abort();
              endLocalResponseAfterWatchdog();
            }, idleTimeoutMs);
          }
          // explicit error handler on the pipe. Without
          // this, a mid-stream upstream socket error becomes an
          // unhandled error event; `response.once('close', abort)` is
          // the only escape and it waits on TCP keep-alive (5+ min
          // default). With this handler, any pipe-level error
          // propagates to the shared abortController, the total
          // watchdog fires if upstream is silent, and the response is
          // ended cleanly.
          node.on('error', (err: Error) => {
            logger.warn(`[Gateway] ${requestId} upstream stream error: ${err.message}`);
            abort();
          });
          // reset the idle watchdog on every chunk
          // received from the upstream. Without this, a slow but
          // trickling upstream (bytes every 60 s) would be aborted by
          // the idle timer even though it is making forward
          // progress. The total watchdog stays armed.
          if (idleTimeoutMs > 0) {
            const resetIdle = (): void => {
              if (!idleTimer) {
                return;
              }
              clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                logger.warn(`[Gateway] ${requestId} upstream stream idle for ${idleTimeoutMs}ms, aborting (provider=${provider.id})`);
                abortController.abort();
                endLocalResponseAfterWatchdog();
              }, idleTimeoutMs);
            };
            node.on('data', resetIdle);
          }
          node.pipe(response);
        } else {
          response.end();
        }
        // capture `durationMs` on the actual last-byte event for
        // streaming. The earlier implementation sampled right after
        // `pipe()`, which is essentially time-to-first-byte and
        // under-reports total latency on long streams.
        response.once('finish', () => {
          // the response finished successfully - clear
          // the total watchdog so it does not fire on a settled
          // request.
          clearTimers();
          if (telemetryRecorded) {
            return;
          }
          telemetryRecorded = true;
          const durationMs = Date.now() - startedAt;
          // Action plan item #3: the streaming finish path does
          // not buffer the upstream response body (we pipe
          // straight to the client), so there is no response
          // summary to capture here. The prompt summary is still
          // propagated for the Shared Session panel.
          this.recordTelemetry(
            provider,
            modelName ?? provider.model,
            statusCode,
            durationMs,
            promptTokens,
            completionTokens,
            totalTokens,
            estimated,
            clientId,
            promptSummary
          );
          if (this.config.logRequests) {
            logger.info(formatRequestLogLine(requestId, provider.id, statusCode, durationMs));
          }
          this.emitUpdate();
        });
      } else {
        const responseText = await upstreamResponse.text();
        const usage = extractUsage(responseText);

        if (usage) {
          promptTokens = usage.promptTokens;
          completionTokens = usage.completionTokens;
          totalTokens = usage.totalTokens;
          estimated = false;
        } else {
          const upstreamPromptTokens = await tokenCountPromise;
          if (typeof upstreamPromptTokens === 'number' && upstreamPromptTokens > 0) {
            promptTokens = upstreamPromptTokens;
          }
          const estimatedCompletion = Math.max(0, Math.ceil(responseText.length / 4));
          completionTokens = estimatedCompletion;
          totalTokens = promptTokens + completionTokens;
        }

        response.statusCode = upstreamResponse.status;
        response.setHeader('Content-Type', contentType || 'application/json; charset=utf-8');
        response.end(responseText);

        telemetryRecorded = true;
        const durationMs = Date.now() - startedAt;
        this.recordTelemetry(
          provider,
          modelName ?? provider.model,
          statusCode,
          durationMs,
          promptTokens,
          completionTokens,
          totalTokens,
          estimated,
          clientId,
          promptSummary,
          this.config.captureSessionLog ? buildResponseSummary(responseText) : undefined
        );
        if (this.config.logRequests) {
          logger.info(formatRequestLogLine(requestId, provider.id, statusCode, durationMs));
        }
      }
      // Avoid the unused-binding lint: ttfbMs is captured here purely
      // for diagnostic parity with the pre-fix logs (still logged by
      // the streaming finish handler above).
      void ttfbMs;
    } catch (error) {
      // always clear both watchdogs on the error
      // path. The catch block is reached for any non-success
      // outcome (upstream error, watchdog abort, client
      // disconnect, body read failure) and timers MUST NOT leak
      // into the next request.
      clearTimers();
      const durationMs = Date.now() - startedAt;
      if (!telemetryRecorded) {
        telemetryRecorded = true;
        // Error path: still propagate the captured prompt summary
        // so the pair can see what was asked; no response summary
        // because the upstream either errored before responding
        // or we never finished reading its body.
        this.recordTelemetry(
          provider,
          modelName ?? provider.model,
          statusCode,
          durationMs,
          promptTokens,
          completionTokens,
          totalTokens,
          true,
          clientId,
          promptSummary
        );
      }

      if (!response.headersSent) {
        // surface 504 (Gateway Timeout) when the
        // abort came from our idle / total watchdog, distinguish
        // from generic 502 (upstream error / unreachable).
        //
        // The watchdog abort case is detected by checking that
        // `abortController.signal.aborted` is true. fetch() throws
        // on abort and we never reach the `statusCode =
        // upstreamResponse.status` assignment, so `statusCode` is
        // still the default 502 sentinel. Anything else that
        // throws before `statusCode` is reassigned (e.g. upstream
        // TCP reset, DNS failure, TLS handshake failure) is treated
        // as a generic 502.
        if (abortController.signal.aborted) {
          statusCode = 504;
          response.statusCode = 504;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(
            JSON.stringify({
              error: 'Gateway Timeout',
              requestId,
              details: 'Upstream did not respond within the configured idle or total timeout',
              idleTimeoutMs,
              totalTimeoutMs,
            })
          );
        } else {
          response.statusCode = 502;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          // the upstream `fetch` error message may include the
          // full request URL, and upstream error bodies can contain
          // `Authorization` echoes. Strip both before forwarding to the
          // client so the API key never leaks through a 502 body.
          const rawMessage = error instanceof Error ? error.message : String(error);
          const sanitizedMessage = sanitizeUpstreamErrorMessage(rawMessage, upstreamUrl);
          response.end(
            JSON.stringify({
              error: 'Failed to forward request',
              requestId,
              details: sanitizedMessage,
            })
          );
        }
      }
    } finally {
      // belt-and-braces clearTimers. The success /
      // streaming paths already clear in `response.once('finish')`,
      // but the non-streaming path and the client-abort path may
      // reach here without going through that listener.
      clearTimers();
      request.off('aborted', abort);
      response.off('close', abort);
      // release the per-provider slot.
      releaseOnAbort();
      // release the slot. The decrement is unconditional
      // (we incremented at the start of the method on a non-rejected
      // path) so the counter is exact regardless of upstream outcome
      // (success, upstream error, abort, body read failure already
      // decremented earlier).
      this.inFlightRequestsField--;
      this.emitUpdate();
    }
  }

  private recordTelemetry(
    provider: ProviderProfile,
    modelName: string,
    status: number,
    durationMs: number,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    estimated: boolean,
    clientId: string | null,
    promptSummary?: string,
    responseSummary?: string
  ): void {
    if (!this.config.telemetryEnabled) {
      return;
    }

    // errored requests (status >= 400, including the catch-block
    // default of 502 when the upstream never responded) must not contribute
    // to the "Estimated cost" totals. The request is still recorded (it
    // still counts toward the error rate, the model usage, the duration
    // averages, and the per-row delete affordance) but with cost = 0.
    // Cost = fait historique: we never bill the user for a request that
    // never produced a billable completion.
    const estimatedCost = status >= 400 ? 0 : estimateCostFromProfile(provider, promptTokens, completionTokens);

    const entry: RequestTelemetry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      providerId: provider.id,
      providerLabel: provider.label,
      model: modelName || provider.model,
      status,
      durationMs,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost,
      estimated,
      // `null` keeps the snapshot schema optional (older on-disk files
      // have no `clientId` field). The store / dashboard coalesce
      // absent and null into the `'unknown'` bucket at read time.
      clientId: clientId ?? undefined,
      // Action plan item #3: pair-programming summaries. Optional
      // for backward compatibility with callers (e.g. Copilot Chat
      // path) that do not have a captured prompt / response at the
      // point of recording. Both fields are sanitized + truncated
      // at extraction time (see `telemetry/summary.ts`), so the
      // store accepts them verbatim.
      promptSummary,
      responseSummary,
    };

    this.telemetry.record(entry);
  }

  private writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(payload, null, 2));
  }

  /**
   * Action plan item #3. Resolve the `?limit=N` query parameter for
   * `GET /v1/sessions`. Clamps to `[1, 200]` so a malicious loopback
   * caller cannot ask for the entire in-memory `recent` list (10 000+
   * entries by default) and inflate the SSE payload.
   */
  private resolveSessionListLimit(searchParams: URLSearchParams): number {
    const raw = searchParams.get('limit');
    if (!raw) {
      return 20;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 20;
    }
    return Math.min(200, parsed);
  }

  /**
   * Action plan item #3. Open a long-lived SSE response and pipe
   * `request.recorded` / `config.changed` events into it. The
   * listener is detached when the client closes the connection, so
   * no leak across reconnect cycles.
   *
   * Heartbeat comment frames (`:`) are emitted every 15 s so
   * intermediaries (curl, browsers, reverse proxies) keep the
   * connection open and do not time it out.
   *
   * Hardening:
   *   - `gateway.events.maxConnections` caps the number of
   *     simultaneous subscribers (the N+1th is rejected with
   *     HTTP 429 + `Retry-After`).
   *   - `gateway.events.maxLifetimeMs` ends the response cleanly
   *     after the configured wall-clock budget so the standard
   *     `EventSource` auto-reconnect logic takes over.
   *   - `gateway.events.includeSummariesInEvents` defaults to
   *     `false`: the `request.recorded` payload drops the
   *     `promptSummary` / `responseSummary` fields so a passive
   *     SSE listener never sees prompt or response text in real
   *     time. The replay endpoint (`GET /v1/replay/{id}`) stays
   *     the explicit way to fetch the captured summaries.
   */
  private async streamSseEvents(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const events = this.config.gateway.events ?? {};
    const maxConnections = events.maxConnections ?? 16;
    if (maxConnections > 0 && this.activeSseConnections.size >= maxConnections) {
      response.setHeader('Retry-After', '5');
      this.writeJson(response, 429, {
        error: 'Too Many Requests',
        detail: `SSE connection cap reached (${this.activeSseConnections.size}/${maxConnections}). Retry after closing another subscriber.`,
      });
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    // Hint to the client that the stream is open.
    response.write(`event: ready\ndata: {"ok":true}\n\n`);
    this.activeSseConnections.add(response);

    const heartbeat = setInterval(() => {
      try {
        response.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // Ignore write errors - the close listener will fire
        // shortly and clean up.
      }
    }, 15_000);
    // Don't keep the event loop alive just for this timer (the
    // response socket keeps it alive while the connection is open).
    heartbeat.unref?.();

    const send = (eventName: string, payload: unknown): void => {
      try {
        response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // ignore
      }
    };

    // project the recorded entry down to metadata only
    // unless the operator opted into summaries. The replay
    // endpoint (`GET /v1/replay/{id}`) is the explicit way to
    // fetch the captured prompt / response text.
    const includeSummaries = events.includeSummariesInEvents === true;
    const project = (entry: RequestTelemetry): Record<string, unknown> => {
      if (includeSummaries) {
        return { ...entry };
      }
      const { promptSummary: _p, responseSummary: _r, ...rest } = entry;
      return rest;
    };

    // Subscribe to telemetry updates and emit a `request.recorded`
    // event for every recorded entry. We use the snapshot's
    // `recent[0]` so the listener does not have to re-read the
    // store. The first emission happens immediately so the client
    // sees the current state on connect.
    const snapshot = this.telemetry.snapshot();
    send('snapshot', { recentCount: snapshot.recent.length });

    const unsubscribe = this.telemetry.subscribe((next) => {
      const top = next.recent[0];
      if (top) {
        send('request.recorded', project(top));
      }
    });

    // lifetime cap. When the configured wall-clock budget
    // elapses, end the response cleanly so the client reconnects.
    // `setTimeout` keeps a strong ref until it fires; cleanup()
    // calls `clearTimeout` on every exit path so we never leak.
    const lifetimeMs = events.maxLifetimeMs ?? 30 * 60 * 1000;
    let lifetimeTimer: NodeJS.Timeout | undefined;
    let ended = false;
    if (lifetimeMs > 0) {
      lifetimeTimer = setTimeout(() => {
        if (ended) return;
        ended = true;
        cleanup();
        try {
          response.write(`event: end\ndata: {"reason":"max-lifetime-reached"}\n\n`);
          response.end();
        } catch {
          // ignore
        }
      }, lifetimeMs);
      // Don't keep the event loop alive just for this timer.
      lifetimeTimer.unref?.();
    }

    const cleanup = (): void => {
      if (lifetimeTimer) {
        clearTimeout(lifetimeTimer);
        lifetimeTimer = undefined;
      }
      clearInterval(heartbeat);
      unsubscribe();
      this.activeSseConnections.delete(response);
    };
    request.once('close', () => {
      if (ended) return;
      ended = true;
      cleanup();
    });
    request.once('aborted', () => {
      if (ended) return;
      ended = true;
      cleanup();
    });
    response.once('close', () => {
      if (ended) return;
      ended = true;
      cleanup();
    });
  }

  /**
   * Acquire a per-provider concurrency slot (hardening).
   * Per-instance Map (see `providerSemaphores`)
   * so multiple `GatewayService` instances in the same process do
   * not share caps.
   *
   * `max = 0` disables the cap (every acquirer resolves
   * immediately). Useful for local development where one process
   * is the only client.
   *
   * when `signal` is provided and aborts while the caller
   * is still queued, the promise rejects with `AbortError` (the
   * standard DOMException), the waiter entry is removed from the
   * FIFO queue, and the abort listener is detached so the signal
   * does not leak a listener.
   */
  private acquireProviderSlot(providerId: string, max: number, signal?: AbortSignal): Promise<void> {
    if (max <= 0) {
      // `max <= 0` is the disabled path; nothing to register on
      // the abort signal either.
      return Promise.resolve();
    }
    if (signal?.aborted) {
      return Promise.reject(new AbortError());
    }
    let lock = this.providerSemaphores.get(providerId);
    if (!lock) {
      lock = { active: 0, waiters: [] };
      this.providerSemaphores.set(providerId, lock);
    }
    if (lock.active < max) {
      lock.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        resolve: () => {
          // The slot is transferred to us, NOT released to the
          // pool. `releaseProviderSlot` already removed the slot
          // from the previous holder; we just claim it. `active`
          // stays at the same value across the transfer.
          detachAbort();
          resolve();
        },
        reject: (reason: Error) => {
          detachAbort();
          reject(reason);
        },
        onAbort: undefined as (() => void) | undefined,
      };
      const detachAbort = (): void => {
        if (entry.onAbort && signal) {
          signal.removeEventListener('abort', entry.onAbort);
          entry.onAbort = undefined;
        }
      };
      if (signal) {
        entry.onAbort = (): void => {
          // Remove our waiter from the FIFO queue. We splice from
          // the end because the queue is short-lived and the
          // original enqueue was at `push` time; searching for the
          // exact entry is safer because a concurrent release
          // could have shifted the queue.
          const idx = lock!.waiters.indexOf(entry);
          if (idx !== -1) {
            lock!.waiters.splice(idx, 1);
          }
          entry.reject(new AbortError());
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      lock!.waiters.push(entry);
    });
  }

  /**
   * Release a per-provider concurrency slot acquired via
   * `acquireProviderSlot`. The `max <= 0` path leaves nothing
   * tracked, so this is also a no-op (keeps the disabled path
   * allocation-free and side-effect-free).
   */
  private releaseProviderSlot(providerId: string): void {
    const lock = this.providerSemaphores.get(providerId);
    if (!lock) {
      return;
    }
    const next = lock.waiters.shift();
    if (next) {
      // The resolver detaches its abort listener; the slot is
      // transferred to the next waiter (its `resolve` callback
      // bumps `active`).
      next.resolve();
      return;
    }
    lock.active--;
    if (lock.active === 0) {
      // Free the entry so the Map does not grow unbounded with
      // distinct provider ids. Safe even if a waiter is queued
      // in the same microtask: the awaiter is in `waiters` and
      // we only free on empty queue.
      this.providerSemaphores.delete(providerId);
    }
  }
}

function resolveUpstreamUrl(provider: ProviderProfile, path: string): string {
  const baseUrl = provider.baseUrl.endsWith('/') ? provider.baseUrl : `${provider.baseUrl}/`;
  return new URL(path, baseUrl).toString();
}

/**
 * `AbortError` mirrors the DOMException used by the
 * standard `AbortSignal` API. We cannot rely on the global DOM
 * type from Node.js without paying the DOM lib cost, so we
 * define a thin sentinel error and the `isAbortError` helper
 * for the call sites.
 */
export class AbortError extends Error {
  override readonly name = 'AbortError';
  constructor(message: string = 'The operation was aborted') {
    super(message);
  }
}

export function isAbortError(err: unknown): err is AbortError {
  if (err instanceof AbortError) {
    return true;
  }
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message.toLowerCase().includes('aborted');
  }
  return false;
}

/**
 * Action plan item #2: prepend a one-paragraph system-message
 * describing the workspace context detected at the user's project
 * root. The OpenAI / Anthropic / MiniMax / Xiaomi APIs all read the
 * FIRST system message slot as the highest-priority instruction,
 * which means a short prefix here anchors the LLM on the project's
 * language / toolchain without overriding anything the user typed.
 *
 * Returns a NEW object (never mutates the input). The user's
 * existing system message (if any) is preserved on the next slot
 * verbatim - we do NOT rewrite the user's authoring. Pure function,
 * safe to call from any code path.
 *
 * Exported for unit testing - the placement of the prefix (first
 * vs. last slot) is part of the user-visible prompt contract.
 */
export function prependSystemMessage(payload: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const existing = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = [{ role: 'system', content: prefix }, ...existing];
  return {
    ...payload,
    messages,
  };
}

/**
 * `/review uncommitted` F8 (deploy safety): sentinel filenames
 * that prove a directory is a project root (not the gateway's own
 * install dir, not a random folder). Used to gate the
 * `process.cwd()` fallback in `resolveContextRoot`. Any one of
 * these being present at the directory's top level is enough.
 */
const CWD_PROJECT_SENTINELS: string[] = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  'mix.exs',
  'Package.swift',
  'composer.json',
  'meson.build',
  '.git',
];

/**
 * Action plan item #5: pick the language hint for the routing
 * layer. Resolution order:
 * 1. Explicit `X-AIFlowBridge-Language` HTTP request header
 *    (lets an IDE force the language regardless of context).
 * 2. First recognisable filename in the request body's
 *    `messages[]` (a fenced `path/to/file.py` snippet, a file
 *    path inside a user message, etc.).
 * 3. Workspace context primary language (`aiflowbridge.gateway.workspaceContext`
 *    + the workspace detector from action plan item #2). The detector
 *    itself is memoized in `detectWorkspaceContextCached()` (CR02
 *    fix B1) on the `root + options` key with a 5 s TTL + mtime
 *    invalidation, so concurrent chat-completion requests against
 *    the same workspace share a single `readdirSync` walk instead
 *    of duplicating the FS work per request.
 *
 * Returns `undefined` when none of the above resolves to a
 * recognised language. The caller then falls back to the
 * existing `selectProvider(model, defaultModel)` chain unchanged.
 */
export function resolveLanguageHint(
  request: IncomingMessage,
  payload: Record<string, unknown> | undefined,
  config: AiFlowBridgeConfig
): WorkspaceLanguage | string | undefined {
  // prefer `config.gateway.allowLanguageHeaderOverride`
  // (default `true`). When the operator has disabled it, the
  // header is silently ignored and the hint falls through to the
  // request body / workspace context. The runtime never sends the
  // header itself, so this only affects loopback clients that
  // explicitly pin a language.
  const allowHeader = config.gateway.allowLanguageHeaderOverride !== false;
  if (allowHeader) {
    const fromHeader = request.headers['x-aiflowbridge-language'];
    const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    if (typeof headerValue === 'string') {
      // `/review uncommitted` F4: cap the raw header length BEFORE
      // any string work. The CR02 B3 fix tried to do this but called
      // `headerValue.trim()` first, which walks the entire buffer
      // and allocates a fresh string before the cap rejects the
      // value. A hostile loopback peer that sends
      // `X-AIFlowBridge-Language: <whitespace> + 1 MB of trailing
      // data` would still force V8 to allocate during `trim()`. The
      // fix is to short-circuit on the raw length first; only the
      // surviving short values go through `trim()` + `toLowerCase()`.
      if (headerValue.length === 0 || headerValue.length > MAX_LANGUAGE_HINT_HEADER_LENGTH) {
        return undefined;
      }
      const trimmed = headerValue.trim();
      if (trimmed.length === 0) {
        return undefined;
      }
      const hint = trimmed.toLowerCase();
      // Debug log: record (1) the hint value the loopback
      // peer is trying to pin, and (2) that the header was honored.
      // We log only at `debug` so production output stays lean; the
      // user can opt into the verbosity with `aiflowbridge.debugMode`.
      logger.debug(`[language-routing] honor header (override allowed, hint=${hint})`);
      return hint;
    }
  }
  const fromBody = detectLanguageHintFromPayload(payload);
  if (fromBody) {
    return fromBody;
  }
  const ctx = config.gateway.workspaceContext;
  // `/review uncommitted` F10: helper owns the enabled gate, the
  // root resolution, and the cache-vs-fresh choice.
  const detected = detectWorkspaceContextFromSettings(ctx, { cached: true, cwdSentinels: CWD_PROJECT_SENTINELS });
  if (detected && detected.primaryLanguage) {
    return detected.primaryLanguage;
  }
  return undefined;
}

/**
 * Format the "request completed" log line for the gateway. The
 * standalone CLI prints this line on every `/v1/chat/completions`
 * (when `gateway.telemetry.logRequests = true`) and the line shows
 * up in the user's console without a date / time prefix today, which
 * makes the per-request tail latency hard to correlate with
 * wall-clock spikes. We prepend a local-time `YYYY-MM-DD HH:MM:SS`
 * stamp so the line is directly greppable: the `LogOutputChannel`
 * shim already adds the `[INFO]  ` level prefix (see
 * `src/standalone/vscode-shim.ts`), and the `[Gateway] ...` payload
 * stays unchanged so the existing log-grep workflows keep working.
 *
 * The timestamp is captured at the call site (not the read site) so
 * it reflects when the request finished, not when the line was
 * written to the channel.
 *
 * Exported for unit testing - the format is part of the user-facing
 * log contract (people grep on it), so a regression here is a
 * user-visible regression.
 */
export function formatRequestLogLine(requestId: string, providerId: string, status: number, durationMs: number, now: Date = new Date()): string {
  const stamp = formatLocalTimestamp(now);
  return `[${stamp}] [Gateway] ${requestId} ${providerId} ${status} ${durationMs}ms`;
}

/**
 * Format a `Date` as a fixed-width `YYYY-MM-DD HH:MM:SS` local
 * timestamp. The helper is intentionally not locale-aware
 * (no `toLocaleString`, no Intl): the line must be greppable
 * across machines, time zones, and locales, and the explicit
 * component-by-component formatting is the only way to guarantee
 * that. Seconds resolution is enough for request-correlated
 * logging (sub-second precision would be noise at 100 ms+ latency).
 *
 * Exported for unit testing.
 */
export function formatLocalTimestamp(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Resolved default for `gateway.maxConcurrentPerProvider`. The
 * `GatewaySettings` field is optional ; the gateway uses 3
 * by default. `0` means "no cap" (semaphore skipped entirely).
 */
function resolveMaxConcurrentPerProvider(gateway: GatewaySettings): number {
  return gateway.maxConcurrentPerProvider ?? 3;
}

function resolveUpstreamIdleTimeoutMs(gateway: GatewaySettings): number {
  return gateway.upstreamIdleTimeoutMs ?? 90_000;
}

function resolveStreamTotalTimeoutMs(gateway: GatewaySettings): number {
  return gateway.streamTotalTimeoutMs ?? 300_000;
}

/**
 * Per-provider concurrency semaphore.
 *
 * Bounded `Map<providerId, Semaphore>` where each `Semaphore`
 * tracks the number of in-flight upstream calls and a FIFO queue
 * of pending acquirers. `acquire` resolves immediately when
 * `active < max`, otherwise awaits the next waiter slot. `release`
 * hands the slot to the next waiter (without first decrementing)
 * or decrements `active` when the queue is empty.
 *
 * Keyed by `provider.id` (not by upstream URL) so that two
 * distinct gateway profiles that happen to point at the same
 * upstream base URL still get independent caps. The Map is
 * **per-instance** state (a property on `GatewayService`): each
 * `GatewayService` keeps an isolated semaphore pool so multiple
 * instances in the same process (tests, reloads) do not share
 * provider caps. Cleared when the `GatewayService` is garbage-collected.
 *
 * `max = 0` disables the cap (every acquirer resolves immediately
 * with `active = Infinity` effectively). Useful for local
 * development where one process is the only client.
 */
interface ProviderSemaphore {
  active: number;
  /**
   * FIFO queue of pending acquirers. Each entry is the resolver
   * pair used to (a) hand the slot to the next waiter, (b) reject
   * the promise when the optional AbortSignal fires while the
   * waiter is still queued, and (c) detach the abort listener on
   * both resolution paths so it never leaks.
   */
  waiters: Array<{
    resolve: () => void;
    reject: (reason: Error) => void;
    onAbort: (() => void) | undefined;
  }>;
}

/**
 * Best-effort normalization of a raw client identifier (from the
 * `X-AIFlowBridge-Client` header, or from the `User-Agent` header)
 * into a stable string suitable for a dashboard bucket key.
 *
 * Output shape: lowercase, hyphenated, optional `@version` suffix
 * (`kilocode@1.2.3`, `curl@8.10.1`,
 * `jetbrains-ai-assistant@2024.3`, `unknown`).
 *
 * Returns `null` when no stable identifier can be derived so the
 * caller can coalesce on `null` -> `'unknown'` at the aggregation
 * site.
 */
export function normalizeClientId(raw: string | undefined | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim().slice(0, 200);
  if (!trimmed) {
    return null;
  }

  // Preferred form: "Name/Version" at the start of the header. Matches
  // the convention used by Kilo Code, Continue, JetBrains AI Assistant,
  // curl, the OpenAI CLI, and most modern OpenAI-compatible IDE
  // integrations: `<product>/<semver-or-letters>` optionally followed by
  // parens or whitespace.
  const productMatch = /^([A-Za-z][A-Za-z0-9._+\- ]*?)\/([A-Za-z0-9_.\-+]+)(?:[ (]|$)/.exec(trimmed);
  if (productMatch) {
    const name = productMatch[1]
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_.\-]/g, '');
    const version = productMatch[2];
    if (name) {
      const id = `${name}@${version}`;
      return id.length > 128 ? id.slice(0, 128) : id;
    }
  }

  // Fallback for headers that don't follow the "Name/Version" form
  // (curl wget, raw telnet, an HTTP probe from an unknown client).
  // Lowercases, hyphenates whitespace, and strips anything outside a
  // small alphabet to prevent junk from polluting the by-client map.
  const fallback = trimmed
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_.@\-]/g, '');
  if (!fallback) {
    return null;
  }
  return fallback.length > 128 ? fallback.slice(0, 128) : fallback;
}

/**
 * Resolve the originating client identifier for a `/v1/chat/completions`
 * request. The explicit `X-AIFlowBridge-Client` header wins when set;
 * otherwise the request's `User-Agent` header is parsed. Returns
 * `null` when neither header is present (loopback probes, health
 * checks) - the caller treats `null` as the `'unknown'` bucket.
 */
export function resolveClientId(request: IncomingMessage): string | null {
  const pickFirst = (values: string | string[] | undefined): string | undefined => {
    if (Array.isArray(values)) {
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
      return undefined;
    }
    if (typeof values === 'string') {
      return values;
    }
    return undefined;
  };

  const explicit = pickFirst(request.headers['x-aiflowbridge-client']);
  if (explicit) {
    const normalized = normalizeClientId(explicit);
    if (normalized) {
      return normalized;
    }
  }

  const ua = pickFirst(request.headers['user-agent']);
  if (ua) {
    const normalized = normalizeClientId(ua);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

/**
 * probe with one retry. The first attempt uses the regular
 * timeout; on failure (timeout, refused, malformed payload) we wait 100
 * ms and try again. Two attempts cover the cold-start window of a peer
 * that was just launched by another activation.
 *
 * `timeoutMs` is a user-configurable knob (default 500 ms) exposed via
 * `aiflowbridge.gateway.probeTimeoutMs`. The retry always uses the same
 * value - the retry is there to absorb packet-level jitter, not to
 * double the budget.
 */
async function probeServerVersionWithRetry(port: number, timeoutMs: number): Promise<Awaited<ReturnType<typeof probeServerVersion>>> {
  const first = await probeServerVersion(port, { timeoutMs });
  if (first) {
    return first;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  return probeServerVersion(port, { timeoutMs });
}

/**
 * Strip any credential-bearing or auth-header mention from an upstream
 * error message before echoing it back in a 502 body.
 * `fetch()` errors frequently include the full request URL (including
 * query string with `?api_key=...` on some upstreams) and upstream
 * response bodies occasionally echo `Authorization` headers. Both are
 * redacted before the message leaves the gateway.
 */
export function sanitizeUpstreamErrorMessage(raw: string, upstreamUrl: string): string {
  let message = raw;
  // Strip the query string from any URL appearing in the message.
  try {
    const parsed = new URL(upstreamUrl);
    const bare = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    if (bare && message.includes(upstreamUrl)) {
      message = message.split(upstreamUrl).join(bare);
    }
  } catch {
    // upstreamUrl is already validated, but defensively ignore.
  }
  // Belt-and-braces: any inline `api_key=...`, `?key=...`, `token=...`
  // query params that slipped through are blanked.
  message = message
    .replace(/(api[_-]?key|access[_-]?token|authorization|bearer)\s*[:=]\s*[^\s,;"]+/gi, '$1=<redacted>')
    .replace(/([?&])(api[_-]?key|access[_-]?token|key|token)=[^&"'\s]*/gi, '$1$2=<redacted>');
  return message;
}

export const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * CR02 B3: hard cap on the `X-AIFlowBridge-Language` HTTP header.
 * 64 chars covers any reasonable BCP-47 language tag; values past
 * that point are treated as a no-op (the caller falls through to
 * the body / workspace-context resolution chain). Defends against
 * hostile loopback peers sending multi-MB headers to force an
 * allocation we would otherwise build and discard.
 */
export const MAX_LANGUAGE_HINT_HEADER_LENGTH = 64;

export function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

    // `settled` guards the Promise against the `end` / `close` race:
    // on a normal disconnect `end` fires first and we resolve with
    // whatever was buffered; `close` then fires but is a no-op. On a
    // brutal disconnect (client hangs up mid-body) `close` fires
    // before `end` and we reject. Without this guard both listeners
    // would race to settle the Promise, and the resolved-then-rejected
    // noise would warn (or worse, leak an event listener that keeps
    // the request IncomingMessage alive via its `request.socket`).
    // // we use named handlers and `removeListener` inside
    // `settle()` so that a late socket error (e.g. keep-alive connection
    // reset AFTER `'end'` has already resolved) does not keep the
    // handler closure - and its captured `error` reference - alive
    // long enough to surface as a stray `UnhandledPromiseRejection` in
    // the host. On Node >= 20 with HTTP/1.1 keep-alive the `'close'`
    // event can legitimately fire after `'end'`, and the listener
    // removal guarantees that the late event is a true no-op rather
    // than a fired-and-ignored handler.
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('close', onClose);
      fn();
    };

    const onData = (chunk: Buffer): void => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        settle(() => reject(new Error('Request body too large')));
        // Drop the socket now so the partial body stops eating buffers
        // and the `'error'` / `'close'` handlers do not pile up.
        request.destroy();
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      settle(() => resolve(Buffer.concat(chunks).toString('utf8')));
    };

    const onError = (error: Error): void => {
      settle(() => reject(error));
    };

    const onClose = (): void => {
      settle(() => reject(new Error('Client disconnected')));
    };

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('close', onClose);
  });
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function extractUsage(raw: string): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  const parsed = parseJson(raw);
  const usage = parsed?.usage;

  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const candidate = usage as Record<string, unknown>;
  const promptTokens =
    typeof candidate.prompt_tokens === 'number'
      ? candidate.prompt_tokens
      : typeof candidate.promptTokens === 'number'
        ? candidate.promptTokens
        : undefined;
  const completionTokens =
    typeof candidate.completion_tokens === 'number'
      ? candidate.completion_tokens
      : typeof candidate.completionTokens === 'number'
        ? candidate.completionTokens
        : undefined;
  const totalTokens =
    typeof candidate.total_tokens === 'number'
      ? candidate.total_tokens
      : typeof candidate.totalTokens === 'number'
        ? candidate.totalTokens
        : undefined;

  if (typeof promptTokens !== 'number' && typeof completionTokens !== 'number' && typeof totalTokens !== 'number') {
    return undefined;
  }

  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

/**
 * Action plan item #3. Build the `GET /v1/replay/{requestId}`
 * response payload. The shape mirrors the OpenAI
 * `/v1/chat/completions` non-streaming body so a pair can pipe it
 * back into their IDE without further translation. Pure function
 * exported for unit testing.
 */
export function buildReplayResponse(entry: RequestTelemetry): ReplayResponse {
  const created = Date.parse(entry.timestamp);
  const promptSummary = entry.promptSummary ?? '';
  const responseSummary = entry.responseSummary ?? '';
  return {
    id: entry.id,
    object: 'chat.completion.replay',
    created: Number.isFinite(created) ? Math.floor(created / 1000) : 0,
    model: entry.model,
    providerId: entry.providerId,
    providerLabel: entry.providerLabel,
    status: entry.status,
    durationMs: entry.durationMs,
    usage: {
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      totalTokens: entry.totalTokens,
    },
    promptSummary,
    responseSummary,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: responseSummary,
        },
        finish_reason: 'stop',
      },
    ],
  };
}

function isMinimaxProvider(provider: ProviderProfile): boolean {
  const host = provider.baseUrl.toLowerCase();
  if (host.includes('minimaxi.com') || host.includes('minimax.io')) {
    return true;
  }
  return provider.id.toLowerCase().startsWith('minimax');
}

/**
 * Translate AIFB-specific body fields sent by OpenAI-compatible clients
 * (Kilo Code, Continue,...) into the upstream provider's expected shape.
 *
 * Currently handles, for MiniMax upstreams only:
 * - Kilo Code's AiflowBridge provider `reasoning: true/false` checkbox
 *   -> MiniMax's `reasoning_split: true/false` for thinking-capable models.
 *   The `reasoning` field is stripped from the upstream body because
 *   MiniMax's OpenAI-compatible API does not recognize it.
 * - Kilo Code's `reasoning_effort: "none" | "high" | "max"` dropdown
 *   (the same field it sends for DeepSeek) -> MiniMax's
 *   `reasoning_split: true/false`. This is what makes the "Reasoning
 *   Effort" picker in the Kilo Code chat input work for MiniMax models
 *   even though MiniMax's API uses a different field name. `none` maps
 *   to `false`, `high` / `max` map to `true`. The `reasoning_effort`
 *   field is stripped from the upstream body.
 *
 * When BOTH `reasoning` and `reasoning_effort` are present, the explicit
 * `reasoning` boolean wins (it is the AIFB-specific checkbox; clients
 * that send both are using the checkbox as the override and the dropdown
 * as a fallback).
 *
 * Returns a new object (never mutates the input). Returns `{}` when the
 * input payload is undefined/empty so the caller can always safely spread
 * or JSON.stringify the result.
 *
 * Exported for unit testing - keep the function pure (no side effects, no
 * VS Code dependency) so it stays trivially testable.
 */
export function translatePayloadForUpstream(payload: Record<string, unknown> | undefined, provider: ProviderProfile): Record<string, unknown> {
  if (!payload) {
    return {};
  }
  if (!isMinimaxProvider(provider)) {
    return payload;
  }

  // Priority 1: explicit `reasoning: true/false` boolean (Kilo Code's
  // AiflowBridge provider checkbox). Always wins over `reasoning_effort`.
  // Both AIFB-specific fields are stripped from the upstream body so the
  // MiniMax API never sees an unknown parameter.
  const reasoning = payload.reasoning;
  if (typeof reasoning === 'boolean') {
    const { reasoning: _r, reasoning_effort: _e, ...rest } = payload;
    return { ...rest, reasoning_split: reasoning };
  }

  // Priority 2: Kilo Code's DeepSeek-style `reasoning_effort` dropdown.
  // MiniMax's API does not recognize this field - it uses `reasoning_split`.
  // We translate and strip the Kilo Code field so the upstream never sees
  // an unknown parameter. Mapping:
  // "none"        -> false (no reasoning tokens in the response)
  // "high"        -> true  (reasoning split into a separate field)
  // "max"         -> true  (MiniMax does not expose a higher effort;
  // treated as "on" for parity with the picker)
  // anything else -> true  (defensive: unknown values default to "on"
  // so a typo in the client does not silently
  // disable reasoning)
  const effort = payload.reasoning_effort;
  if (typeof effort === 'string') {
    const reasoningSplit = effort !== 'none';
    const { reasoning_effort: _stripped, ...rest } = payload;
    return { ...rest, reasoning_split: reasoningSplit };
  }

  // No reasoning signal in the body: pass through unchanged. The gateway
  // has no per-profile default here (the global setting
  // `aiflowbridge.providers.minimax.reasoningSplit` is consumed by the
  // direct VS Code Copilot Chat provider, not the gateway path).
  return payload;
}

const defaultUserPrompt: UserPrompt = {
  // Lazy import to avoid pulling vscode into pure unit tests.
  async showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
    const vscode = await import('vscode');
    return vscode.window.showInformationMessage(message, ...items);
  },
};

// Re-export so existing import paths (aiflowbridge/index.ts) keep working.
export { isPortInUse };
