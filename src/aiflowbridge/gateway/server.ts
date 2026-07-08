import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { logger } from "../../logger";
import { buildModelCatalog, selectProvider } from "../providers";
import type { TelemetryPersisterLike } from "../telemetry";
import { estimateCostFromProfile, estimatePromptTokensFromPayload, TelemetryStore } from "../telemetry";
import { fetchMinimaxPromptTokens } from "../token-counter";
import type { AiFlowBridgeConfig, GatewayStatus, ProviderProfile, RequestTelemetry, TelemetrySnapshot } from "../types";
import {
  compareSemver,
  GATEWAY_SERVICE_NAME,
  isPortInUse,
  probeServerVersion,
  requestPeerShutdown,
  waitUntilPortFree,
} from "./probe";

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
export type HandleOccupiedPortResult =
  | { kind: "joined" }
  | { kind: "proceed-bind" }
  | { kind: "restart-failed"; peerPid: number };

export class GatewayService {
  private server: Server | undefined;
  /**
   * Tracks every active keep-alive socket. Used by `stop()` to drain
   * lingering connections when `server.closeAllConnections()` is not
   * available (Node < 18.2) or as a defensive fallback. `close(cb)` only
   * waits for in-flight requests; idle keep-alive sockets would otherwise
   * keep the listening port bound and cause `EADDRINUSE` on the next
   * activation (BUG-A05).
   */
  private readonly activeSockets = new Set<Socket>();
  /**
   * IMPROV-C04: counter of in-flight `/v1/chat/completions` requests.
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
   * getter so the dashboard header (AFF03) can show which build the
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

  constructor(
    config: AiFlowBridgeConfig,
    private readonly onUpdate?: GatewaySnapshotListener,
    private readonly resolveApiKey?: ResolveApiKeyFn,
    private readonly loadState?: TelemetryStateLoader,
    private readonly saveState?: TelemetryStateSaver,
    bundledVersion: string = "0.0.0",
    userPrompt?: UserPrompt,
    persister?: TelemetryPersisterLike,
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
   * FEAT7: returns `true` when this `GatewayService`
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
   * IMPROV-C04: number of in-flight upstream `/v1/chat/completions`
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
   * header (AFF03) so the user can see which build the running gateway
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

  async start(): Promise<GatewayStatus> {
    if (this.server) {
      return this.status();
    }

    // Check if another instance already occupies the configured port
    if (await isPortInUse(this.config.gateway.port)) {
      const result = await this.handleOccupiedPort();
      if (result.kind === "joined") {
        return this.status();
      }
      if (result.kind === "restart-failed") {
        // Surface the peer PID to the caller (runtime) so it can show a
        // targeted user-facing error. Per ACTION PLAN: "Si timeout atteint
        // -> erreur claire a l'utilisateur avec le PID de l'ancienne
        // instance."
        const error = new Error(
          `Peer gateway (pid ${result.peerPid}) did not free port ${this.config.gateway.port} within timeout. ` +
            `If another AIFlowBridge is binding this port, stop it manually; otherwise wait for TIME_WAIT to clear.`,
        );
        (error as Error & { code?: string; peerPid?: number }).code = "EPEERSTALLED";
        (error as Error & { code?: string; peerPid?: number }).peerPid = result.peerPid;
        throw error;
      }
      // result.kind === "proceed-bind": the port may have been freed by
      // the peer we asked to shut down. Fall through to listen().
    }
    this.server = createServer((request, response) => {
      const socket = request.socket;
      this.activeSockets.add(socket);
      socket.once("close", () => {
        this.activeSockets.delete(socket);
      });
      void this.handleRequest(request, response).catch((error: unknown) => {
        logger.error("[Gateway] Request handling error", error);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        response.end(JSON.stringify({ error: "Gateway failure" }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        resolve();
        return;
      }

      const onError = (error: Error): void => {
        server.off("listening", onListening);
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
        server.off("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.config.gateway.port, "127.0.0.1");
    });

    // After successful listen, sync config port/baseUrl to the actual bound port
    // (matters when the configured port was 0 - OS-assigned ephemeral port).
    const address = this.server?.address();
    if (address && typeof address === "object" && "port" in address) {
      this.config.gateway.port = address.port;
      this.config.gateway.baseUrl = `http://127.0.0.1:${address.port}`;
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
      // BUG-A05: drain keep-alive sockets before close. Without this,
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
      await new Promise<void>((resolve) => {
        current.close(() => resolve());
      });
    }

    this.emitUpdate();
  }

  dispose(): void {
    // WARN-B07: `dispose()` is fire-and-forget by contract (matches
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
    // IMPROV-C05: configurable probe timeout (default 500 ms) with one
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
        const keepLabel = "Keep current version";
        const choice = await this.userPrompt.showInformationMessage(
          `AIFlowBridge gateway v${peer.version} is running. Restart with v${this.bundledVersion}?`,
          restartLabel,
          keepLabel,
        );

        if (choice === restartLabel) {
          logger.info(`[Gateway] User chose to restart peer v${peer.version} (pid=${peer.pid})`);
          await requestPeerShutdown(port, peer.shutdownToken ? { shutdownToken: peer.shutdownToken } : {});
          const freed = await waitUntilPortFree(port, { timeoutMs: 3000 });
          if (!freed) {
            logger.warn(`[Gateway] Port ${port} did not free up within timeout (peer pid=${peer.pid})`);
            return { kind: "restart-failed", peerPid: peer.pid };
          }
          // Port is free; caller will attempt to bind.
          return { kind: "proceed-bind" };
        }

        // Keep current version (or user dismissed the prompt): join the peer.
        logger.info(`[Gateway] Joining existing gateway v${peer.version} on 127.0.0.1:${port}`);
        this.joined = true;
        this.emitUpdate();
        return { kind: "joined" };
      }

      // Same or newer version: join silently (legacy behaviour).
      logger.info(`[Gateway] Existing gateway v${peer.version} detected, joining on 127.0.0.1:${port}`);
      this.joined = true;
      this.emitUpdate();
      return { kind: "joined" };
    }

    if (peer) {
      logger.warn(
        `[Gateway] Port ${port} is occupied by another service named "${peer.name}" (not aiflowbridge-gateway)`,
      );
    } else {
      logger.warn(`[Gateway] Port ${port} is occupied by a non-gateway service`);
    }
    return { kind: "proceed-bind" };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", this.config.gateway.baseUrl);
    const path = requestUrl.pathname;

    if (request.method === "GET" && path === "/version") {
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

    if (request.method === "POST" && path === "/shutdown") {
      // Loopback-only (server binds 127.0.0.1). Used by peers that detected
      // a version mismatch and want to start a fresh instance.
      //
      // Authentication: the peer must provide this instance's `shutdownToken`
      // (returned by GET /version) in the `X-AIFlowBridge-Shutdown-Token`
      // header. Without a valid token, we refuse with 403. Loopback binding
      // is necessary but not sufficient: any other local process (or a
      // misconfigured curl one-liner) could otherwise stop the gateway.
      //
      // We intentionally do NOT call process.exit(0): the gateway runs in
      // the VS Code extension host, and killing that process would also
      // kill every other extension the user has installed. Closing the
      // listening socket is enough to let the new activation bind the port.
      const providedToken = request.headers["x-aiflowbridge-shutdown-token"];
      if (typeof providedToken !== "string" || providedToken !== this.shutdownToken) {
        logger.warn(
          `[Gateway] Rejected /shutdown from ${request.socket.remoteAddress ?? "unknown"} (missing or invalid token)`,
        );
        this.writeJson(response, 403, { error: "Unauthorized shutdown attempt" });
        return;
      }
      logger.info(
        `[Gateway] Shutdown requested by peer on ${request.socket.remoteAddress ?? "unknown"}`,
      );
      this.writeJson(response, 200, { ok: true });
      setTimeout(() => {
        void this.server?.close();
      }, 100);
      return;
    }

    if (request.method === "GET" && path === "/health") {
      this.writeJson(response, 200, {
        ok: true,
        service: "AIFlowBridge",
        status: this.status(),
      });
      return;
    }

    if (request.method === "GET" && (path === "/metrics" || path === "/v1/metrics")) {
      this.writeJson(response, 200, {
        status: this.status(),
        telemetry: this.telemetry.snapshot(),
      });
      return;
    }

    if (request.method === "GET" && path === "/v1/models") {
      this.writeJson(response, 200, {
        object: "list",
        data: buildModelCatalog(this.config.providers),
      });
      return;
    }

    if (request.method === "POST" && path === "/v1/chat/completions") {
      await this.forwardChatCompletion(request, response);
      return;
    }

    this.writeJson(response, 404, {
      error: "Not found",
      path,
    });
  }

  private async forwardChatCompletion(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    // IMPROV-C04: cheap pre-flight check. Reading the body is expensive
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
      response.setHeader("Retry-After", "1");
      this.writeJson(response, 429, {
        error: "Too Many Requests",
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
        error: "Failed to read request body",
        requestId,
        details: message,
      });
      return;
    }

    const modelName = typeof payload?.model === "string" ? payload.model : this.config.gateway.defaultModel;
    const enabledProviders = this.config.providers.filter((profile) => profile.enabled);

    if (enabledProviders.length === 0) {
      this.writeJson(response, 503, {
        error: "No enabled upstream provider is configured",
        requestId,
      });
      return;
    }

    const provider = selectProvider(this.config.providers, modelName, this.config.gateway.defaultModel);

    if (!provider) {
      const availableIds = enabledProviders.map((profile) => profile.id).join(", ");
      this.writeJson(response, 404, {
        error: `No gateway provider matches model "${modelName ?? ""}". Available provider ids: ${availableIds}. ` +
          `Add a provider with that id in the 'aiflowbridge.providers' setting, or use 'AIFlowBridge: Add a custom model'.`,
        requestId,
        requestedModel: modelName ?? null,
        availableProviderIds: enabledProviders.map((profile) => profile.id),
      });
      return;
    }

    const upstreamUrl = resolveUpstreamUrl(provider, "chat/completions");

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
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "X-AIFlowBridge-Request-Id": requestId,
      "X-AIFlowBridge-Provider": provider.id,
    });

    if (resolvedKey) {
      headers.set("Authorization", `Bearer ${resolvedKey}`);
    }

    const abortController = new AbortController();
    const abort = (): void => abortController.abort();
    request.once("aborted", abort);
    response.once("close", abort);

    // Translate AIFB-specific body fields into the upstream API's expected
    // shape (e.g. Kilo Code's `reasoning: true/false` checkbox -> MiniMax's
    // `reasoning_split: true/false`). The translator strips any AIFB-specific
    // fields it consumed so the upstream never sees them.
    const translatedPayload = translatePayloadForUpstream(payload, provider);
    // WARN-B05: when a translation actually rewrote a field, log the
    // before/after at the debug level so the user can diagnose "I sent
    // reasoning_effort=high but the model did not think" reports.
    // `translatePayloadForUpstream` is intentionally pure (no side
    // effects, exported for unit testing) - the diagnostic lives at the
    // call site instead, where we already have `logger` and `requestId`.
    if (payload) {
      const hasReasoning = "reasoning" in payload;
      const hasEffort = "reasoning_effort" in payload;
      if (hasReasoning || hasEffort) {
        const reasoningSplit = (translatedPayload as Record<string, unknown>).reasoning_split;
        logger.debug(
          `[Gateway] ${requestId} translated upstream payload: ` +
            `reasoning=${hasReasoning ? String(payload.reasoning) : "<absent>"} ` +
            `reasoning_effort=${hasEffort ? String(payload.reasoning_effort) : "<absent>"} ` +
            `-> reasoning_split=${String(reasoningSplit)}`,
        );
      }
    }
    // Override the model name in the forwarded request with the provider's
    // upstream model name, so Kilo Code and other clients can use any alias.
    // We always re-serialize (never pass `bodyText` through) so the
    // translation above is guaranteed to reach the upstream.
    const finalPayload = provider.model && translatedPayload.model !== provider.model
      ? { ...translatedPayload, model: provider.model }
      : translatedPayload;
    const upstreamBody = JSON.stringify(finalPayload);

    let statusCode = 502;
    let promptTokens = estimatePromptTokensFromPayload(payload);
    let completionTokens = 0;
    let totalTokens = promptTokens;
    let estimated = true;
    // BUG-A02 / WARN-B02: `telemetryRecorded` guards against the
    // streaming `'finish'` listener AND the catch block both trying to
    // record the same entry when an error interrupts the stream.
    let telemetryRecorded = false;
    let ttfbMs = 0;

    // MiniMax exposes /v1/responses/input_tokens: kick off a parallel count
    // when applicable so the heuristic can be replaced with the real number
    // before telemetry is recorded. Never blocks the request.
    const tokenCountPromise = isMinimaxProvider(provider)
      ? fetchMinimaxPromptTokens({
          baseUrl: provider.baseUrl,
          apiKey: resolvedKey ?? "",
          model: provider.model,
          messages: Array.isArray(payload?.messages) ? payload.messages : [],
        })
      : Promise.resolve(undefined);

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: upstreamBody,
        signal: abortController.signal,
      });

      statusCode = upstreamResponse.status;
      ttfbMs = Date.now() - startedAt;
      const contentType = upstreamResponse.headers.get("content-type") ?? "";
      const isStream = Boolean(payload?.stream) || contentType.includes("text/event-stream");

      if (isStream) {
        // For streaming responses, MiniMax does not return usage in the stream.
        // Use the parallel pre-count from the /input_tokens endpoint if available.
        const upstreamPromptTokens = await tokenCountPromise;
        if (typeof upstreamPromptTokens === "number" && upstreamPromptTokens > 0) {
          promptTokens = upstreamPromptTokens;
          totalTokens = promptTokens;
        }

        response.statusCode = upstreamResponse.status;
        response.setHeader("Content-Type", contentType || "text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");

        if (upstreamResponse.body) {
          Readable.fromWeb(upstreamResponse.body as unknown as globalThis.ReadableStream<Uint8Array>).pipe(response);
        } else {
          response.end();
        }
        // BUG-A02: capture `durationMs` on the actual last-byte event for
        // streaming. The earlier implementation sampled right after
        // `pipe()`, which is essentially time-to-first-byte and
        // under-reports total latency on long streams.
        response.once("finish", () => {
          if (telemetryRecorded) {
            return;
          }
          telemetryRecorded = true;
          const durationMs = Date.now() - startedAt;
          this.recordTelemetry(provider, modelName ?? provider.model, statusCode, durationMs, promptTokens, completionTokens, totalTokens, estimated);
          if (this.config.logRequests) {
            logger.info(`[Gateway] ${requestId} ${provider.id} ${statusCode} ${durationMs}ms`);
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
          if (typeof upstreamPromptTokens === "number" && upstreamPromptTokens > 0) {
            promptTokens = upstreamPromptTokens;
          }
          const estimatedCompletion = Math.max(0, Math.ceil(responseText.length / 4));
          completionTokens = estimatedCompletion;
          totalTokens = promptTokens + completionTokens;
        }

        response.statusCode = upstreamResponse.status;
        response.setHeader("Content-Type", contentType || "application/json; charset=utf-8");
        response.end(responseText);

        telemetryRecorded = true;
        const durationMs = Date.now() - startedAt;
        this.recordTelemetry(provider, modelName ?? provider.model, statusCode, durationMs, promptTokens, completionTokens, totalTokens, estimated);
        if (this.config.logRequests) {
          logger.info(`[Gateway] ${requestId} ${provider.id} ${statusCode} ${durationMs}ms`);
        }
      }
      // Avoid the unused-binding lint: ttfbMs is captured here purely
      // for diagnostic parity with the pre-fix logs (still logged by
      // the streaming finish handler above).
      void ttfbMs;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (!telemetryRecorded) {
        telemetryRecorded = true;
        this.recordTelemetry(provider, modelName ?? provider.model, statusCode, durationMs, promptTokens, completionTokens, totalTokens, true);
      }

      if (!response.headersSent) {
        response.statusCode = 502;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
      }

      // WARN-B02: the upstream `fetch` error message may include the
      // full request URL, and upstream error bodies can contain
      // `Authorization` echoes. Strip both before forwarding to the
      // client so the API key never leaks through a 502 body.
      const rawMessage = error instanceof Error ? error.message : String(error);
      const sanitizedMessage = sanitizeUpstreamErrorMessage(rawMessage, upstreamUrl);
      response.end(JSON.stringify({
        error: "Failed to forward request",
        requestId,
        details: sanitizedMessage,
      }));
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
      // IMPROV-C04: release the slot. The decrement is unconditional
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
  ): void {
    if (!this.config.telemetryEnabled) {
      return;
    }

    // BUG11: errored requests (status >= 400, including the catch-block
    // default of 502 when the upstream never responded) must not contribute
    // to the "Estimated cost" totals. The request is still recorded (it
    // still counts toward the error rate, the model usage, the duration
    // averages, and the per-row delete affordance) but with cost = 0.
    // Cost = fait historique: we never bill the user for a request that
    // never produced a billable completion.
    const estimatedCost = status >= 400
      ? 0
      : estimateCostFromProfile(provider, promptTokens, completionTokens);

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
    };

    this.telemetry.record(entry);
  }

  private writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload, null, 2));
  }

}

function resolveUpstreamUrl(provider: ProviderProfile, path: string): string {
  const baseUrl = provider.baseUrl.endsWith("/") ? provider.baseUrl : `${provider.baseUrl}/`;
  return new URL(path, baseUrl).toString();
}

/**
 * IMPROV-C05: probe with one retry. The first attempt uses the regular
 * timeout; on failure (timeout, refused, malformed payload) we wait 100
 * ms and try again. Two attempts cover the cold-start window of a peer
 * that was just launched by another activation.
 *
 * `timeoutMs` is a user-configurable knob (default 500 ms) exposed via
 * `aiflowbridge.gateway.probeTimeoutMs`. The retry always uses the same
 * value - the retry is there to absorb packet-level jitter, not to
 * double the budget.
 */
async function probeServerVersionWithRetry(
  port: number,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof probeServerVersion>>> {
  const first = await probeServerVersion(port, { timeoutMs });
  if (first) {
    return first;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  return probeServerVersion(port, { timeoutMs });
}

/**
 * Strip any credential-bearing or auth-header mention from an upstream
 * error message before echoing it back in a 502 body (WARN-B02).
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
    .replace(/(api[_-]?key|access[_-]?token|authorization|bearer)\s*[:=]\s*[^\s,;"]+/gi, "$1=<redacted>")
    .replace(/([?&])(api[_-]?key|access[_-]?token|key|token)=[^&"'\s]*/gi, "$1$2=<redacted>");
  return message;
}

export const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

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
    //
    // BUG-A03: we use named handlers and `removeListener` inside
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
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("close", onClose);
      fn();
    };

    const onData = (chunk: Buffer): void => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        settle(() => reject(new Error("Request body too large")));
        // Drop the socket now so the partial body stops eating buffers
        // and the `'error'` / `'close'` handlers do not pile up.
        request.destroy();
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      settle(() => resolve(Buffer.concat(chunks).toString("utf8")));
    };

    const onError = (error: Error): void => {
      settle(() => reject(error));
    };

    const onClose = (): void => {
      settle(() => reject(new Error("Client disconnected")));
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("close", onClose);
  });
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  if (!raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function extractUsage(raw: string): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  const parsed = parseJson(raw);
  const usage = parsed?.usage;

  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const candidate = usage as Record<string, unknown>;
  const promptTokens = typeof candidate.prompt_tokens === "number" ? candidate.prompt_tokens : typeof candidate.promptTokens === "number" ? candidate.promptTokens : undefined;
  const completionTokens = typeof candidate.completion_tokens === "number" ? candidate.completion_tokens : typeof candidate.completionTokens === "number" ? candidate.completionTokens : undefined;
  const totalTokens = typeof candidate.total_tokens === "number" ? candidate.total_tokens : typeof candidate.totalTokens === "number" ? candidate.totalTokens : undefined;

  if (typeof promptTokens !== "number" && typeof completionTokens !== "number" && typeof totalTokens !== "number") {
    return undefined;
  }

  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
  };
}

function isMinimaxProvider(provider: ProviderProfile): boolean {
  const host = provider.baseUrl.toLowerCase();
  if (host.includes("minimaxi.com") || host.includes("minimax.io")) {
    return true;
  }
  return provider.id.toLowerCase().startsWith("minimax");
}

/**
 * Translate AIFB-specific body fields sent by OpenAI-compatible clients
 * (Kilo Code, Continue, ...) into the upstream provider's expected shape.
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
export function translatePayloadForUpstream(
  payload: Record<string, unknown> | undefined,
  provider: ProviderProfile,
): Record<string, unknown> {
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
  if (typeof reasoning === "boolean") {
    const { reasoning: _r, reasoning_effort: _e, ...rest } = payload;
    return { ...rest, reasoning_split: reasoning };
  }

  // Priority 2: Kilo Code's DeepSeek-style `reasoning_effort` dropdown.
  // MiniMax's API does not recognize this field - it uses `reasoning_split`.
  // We translate and strip the Kilo Code field so the upstream never sees
  // an unknown parameter. Mapping:
  //   "none"        -> false (no reasoning tokens in the response)
  //   "high"        -> true  (reasoning split into a separate field)
  //   "max"         -> true  (MiniMax does not expose a higher effort;
  //                          treated as "on" for parity with the picker)
  //   anything else -> true  (defensive: unknown values default to "on"
  //                          so a typo in the client does not silently
  //                          disable reasoning)
  const effort = payload.reasoning_effort;
  if (typeof effort === "string") {
    const reasoningSplit = effort !== "none";
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
    const vscode = await import("vscode");
    return vscode.window.showInformationMessage(message, ...items);
  },
};

// Re-export so existing import paths (aiflowbridge/index.ts) keep working.
export { isPortInUse };
