import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { URL } from "node:url";
import { connect as netConnect, type Socket as NetSocket } from "node:net";
import { buildModelCatalog, selectProvider } from "../providers";
import { estimateCostFromProfile, estimatePromptTokensFromPayload, TelemetryStore } from "../telemetry";
import type { AiFlowBridgeConfig, GatewayStatus, ProviderProfile, RequestTelemetry, TelemetrySnapshot } from "../types";

interface GatewaySnapshotListener {
  (status: GatewayStatus, snapshot: TelemetrySnapshot): void;
}

export class GatewayService {
  private server: ReturnType<typeof createServer> | undefined;
  private config: AiFlowBridgeConfig;
  private readonly telemetry = new TelemetryStore();

  constructor(
    config: AiFlowBridgeConfig,
    private readonly onUpdate?: GatewaySnapshotListener,
  ) {
    this.config = config;
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

  async start(): Promise<GatewayStatus> {
    if (this.server) {
      return this.status();
    }

    // Check if another instance already occupies the default port
    if (await isPortInUse(this.config.gateway.port)) {
      console.log(`[AIFlowBridge] Port ${this.config.gateway.port} is in use, checking for existing gateway...`);

      // Verify the existing service is actually a reachable AIFlowBridge gateway
      if (await isGatewayReachable(this.config.gateway.baseUrl)) {
        // Another AIFlowBridge instance owns the port — reuse it
        console.log(`[AIFlowBridge] Existing gateway detected, joining on ${this.config.gateway.baseUrl}`);
        this.emitUpdate();
        return this.status();
      }

      // Port is occupied by something else — this should not happen in normal use
      console.warn(`[AIFlowBridge] Port ${this.config.gateway.port} is occupied by a non-gateway service`);
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error: unknown) => {
        console.error("[AIFlowBridge] Gateway failure", error);
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
        console.error("[AIFlowBridge] Failed to start gateway", error);
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
    const provider = selectProvider(this.config.providers, modelName, this.config.gateway.defaultModel);

    if (!provider) {
      this.writeJson(response, 503, {
        error: "No enabled upstream provider is configured",
        requestId,
      });
      return;
    }

    const upstreamUrl = resolveUpstreamUrl(provider, "chat/completions");
    const headers = new Headers({
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "X-AIFlowBridge-Request-Id": requestId,
      "X-AIFlowBridge-Provider": provider.id,
    });

    if (provider.apiKey) {
      headers.set("Authorization", `Bearer ${provider.apiKey}`);
    }

    const abortController = new AbortController();
    const abort = (): void => abortController.abort();
    request.once("aborted", abort);
    response.once("close", abort);

    let statusCode = 502;
    let promptTokens = estimatePromptTokensFromPayload(payload);
    let completionTokens = 0;
    let totalTokens = promptTokens;
    let estimated = true;

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: bodyText,
        signal: abortController.signal,
      });

      statusCode = upstreamResponse.status;
      const durationMs = Date.now() - startedAt;
      const contentType = upstreamResponse.headers.get("content-type") ?? "";
      const isStream = Boolean(payload?.stream) || contentType.includes("text/event-stream");

      if (isStream) {
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
        console.log(`[AIFlowBridge] ${requestId} ${provider.id} ${statusCode} ${durationMs}ms`);
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
