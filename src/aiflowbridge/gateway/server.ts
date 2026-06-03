import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect as netConnect, type Socket as NetSocket } from "node:net";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { logger } from "../../logger";
import { buildModelCatalog, selectProvider } from "../providers";
import { estimateCostFromProfile, estimatePromptTokensFromPayload, TelemetryStore } from "../telemetry";
import { fetchMinimaxPromptTokens } from "../token-counter";
import type { AiFlowBridgeConfig, GatewayStatus, ProviderProfile, RequestTelemetry, TelemetrySnapshot } from "../types";

interface GatewaySnapshotListener {
  (status: GatewayStatus, snapshot: TelemetrySnapshot): void;
}

export type ResolveApiKeyFn = (vendor: string) => Promise<string | undefined>;
export type TelemetryStateLoader = () => TelemetrySnapshot | undefined;
export type TelemetryStateSaver = (snapshot: TelemetrySnapshot) => void;

export class GatewayService {
  private server: ReturnType<typeof createServer> | undefined;
  private config: AiFlowBridgeConfig;
  private readonly telemetry = new TelemetryStore();
  private unsubscribePersist: (() => void) | undefined;
  private persistDebounce: NodeJS.Timeout | undefined;
  private static readonly PERSIST_DEBOUNCE_MS = 1000;

  constructor(
    config: AiFlowBridgeConfig,
    private readonly onUpdate?: GatewaySnapshotListener,
    private readonly resolveApiKey?: ResolveApiKeyFn,
    private readonly loadState?: TelemetryStateLoader,
    private readonly saveState?: TelemetryStateSaver,
  ) {
    this.config = config;
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
    return Boolean(this.server);
  }

  get baseUrl(): string {
    return this.config.gateway.baseUrl;
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

  async start(): Promise<GatewayStatus> {
    if (this.server) {
      return this.status();
    }

    // Check if another instance already occupies the default port
    if (await isPortInUse(this.config.gateway.port)) {
      logger.info(`[Gateway] Port ${this.config.gateway.port} is in use, checking for existing gateway...`);

      // Verify the existing service is actually a reachable AIFlowBridge gateway
      if (await isGatewayReachable(this.config.gateway.baseUrl)) {
        // Another AIFlowBridge instance owns the port - reuse it
        logger.info(`[Gateway] Existing gateway detected, joining on ${this.config.gateway.baseUrl}`);
        this.emitUpdate();
        return this.status();
      }

      // Port is occupied by something else - this should not happen in normal use
      logger.warn(`[Gateway] Port ${this.config.gateway.port} is occupied by a non-gateway service`);
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
    if (!this.server) {
      return;
    }

    const current = this.server;
    this.server = undefined;

    await new Promise<void>((resolve) => {
      current.close(() => resolve());
    });

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

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", this.config.gateway.baseUrl);
    const path = requestUrl.pathname;

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

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: NetSocket = netConnect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.setTimeout(500);
  });
}

export { isPortInUse };

async function isGatewayReachable(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 500);
    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return false;
    }
    const data = await response.json() as { service?: string };
    return data.service === "AIFlowBridge";
  } catch {
    return false;
  }
}

function isMinimaxProvider(provider: ProviderProfile): boolean {
  const host = provider.baseUrl.toLowerCase();
  if (host.includes("minimaxi.com") || host.includes("minimax.io")) {
    return true;
  }
  return provider.id.toLowerCase().startsWith("minimax");
}
