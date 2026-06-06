import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { logger } from "../../logger";
import { buildModelCatalog, selectProvider } from "../providers";
import { estimateCostFromProfile, estimatePromptTokensFromPayload, TelemetryStore } from "../telemetry";
import type { TelemetryPersisterLike } from "../telemetry";
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
  private server: ReturnType<typeof createServer> | undefined;
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
      await new Promise<void>((resolve) => {
        current.close(() => resolve());
      });
    }

    this.emitUpdate();
  }

  dispose(): void {
    void this.stop();
  }

  private status(): GatewayStatus {
    return {
      running: this.running,
      port: this.config.gateway.port,
      baseUrl: this.config.gateway.baseUrl,
      providerCount: this.config.providers.filter((provider) => provider.enabled).length,
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
    const peer = await probeServerVersion(port, { timeoutMs: 200 });

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
          await requestPeerShutdown(port);
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
      });
      return;
    }

    if (request.method === "POST" && path === "/shutdown") {
      // Loopback-only (server binds 127.0.0.1). Used by peers that detected
      // a version mismatch and want to start a fresh instance.
      //
      // We intentionally do NOT call process.exit(0) here: the gateway
      // runs inside the VS Code extension host, and killing that process
      // would also kill every other extension the user has installed.
      // Closing the listening socket is enough to let the new activation
      // bind the port; the extension host itself stays alive.
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
    const bodyText = await readBody(request);
    const payload = parseJson(bodyText);

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

    // Override the model name in the forwarded request with the provider's
    // upstream model name, so Kilo Code and other clients can use any alias.
    const upstreamBody = provider.model && payload?.model !== provider.model
      ? JSON.stringify({ ...payload, model: provider.model })
      : bodyText;

    let statusCode = 502;
    let promptTokens = estimatePromptTokensFromPayload(payload);
    let completionTokens = 0;
    let totalTokens = promptTokens;
    let estimated = true;

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
      const durationMs = Date.now() - startedAt;
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
      }

      this.recordTelemetry(provider, modelName ?? provider.model, statusCode, durationMs, promptTokens, completionTokens, totalTokens, estimated);
      if (this.config.logRequests) {
        logger.info(`[Gateway] ${requestId} ${provider.id} ${statusCode} ${durationMs}ms`);
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.recordTelemetry(provider, modelName ?? provider.model, statusCode, durationMs, promptTokens, completionTokens, totalTokens, true);

      if (!response.headersSent) {
        response.statusCode = 502;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
      }

      response.end(JSON.stringify({
        error: "Failed to forward request",
        requestId,
        details: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
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
      estimatedCost: estimateCostFromProfile(provider, promptTokens, completionTokens),
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

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    request.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", (error) => reject(error));
    request.on("close", () => reject(new Error("Client disconnected")));
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

const defaultUserPrompt: UserPrompt = {
  // Lazy import to avoid pulling vscode into pure unit tests.
  async showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
    const vscode = await import("vscode");
    return vscode.window.showInformationMessage(message, ...items);
  },
};

// Re-export so existing import paths (aiflowbridge/index.ts) keep working.
export { isPortInUse };
