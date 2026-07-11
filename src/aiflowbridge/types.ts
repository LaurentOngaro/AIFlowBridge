export type BridgeMode = 'proxy' | 'vision' | 'proxy+vision';
export type ProviderKind = 'openai-compat' | 'ollama';
export type OutputMode = 'clipboard' | 'insert' | 'copilot';

export interface ProviderPricing {
  inputPerMillion?: number;
  outputPerMillion?: number;
  currency?: string;
}

/**
 * Minimal disposable contract. Mirrors VS Code's `Disposable` shape so the
 * runtime can stay agnostic of the host (VS Code extension, standalone
 * CLI,...). Returned by `IGatewayContext.registerCommand` and by
 * `IGatewayContext.onConfigChange` so the caller can unsubscribe.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Minimal subset of the VS Code SecretStorage API used by the gateway to
 * resolve per-vendor API keys. The standalone adapter implements this
 * via env vars + a JSON file (see `src/standalone/context.ts`).
 */
export interface SecretStorageLike {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Minimal subset of `vscode.WorkspaceConfiguration` used by the gateway
 * config synthesis. `get` returns the value or the fallback. Used by both
 * the VS Code adapter (`vscode.workspace.getConfiguration("aiflowbridge")`)
 * and the standalone config loader (parsed JSON file at
 * `~/.aiflowbridge/config.json`).
 */
export interface ConfigReader {
  get<T>(key: string, fallback?: T): T;
}

/**
 * File abstraction used by the model registry loader. Defaults to
 * `vscode.workspace.fs` in the extension; the standalone adapter wraps
 * `node:fs/promises`.
 */
export interface FileSystemLike {
  readFile(uri: UriLike): Promise<Uint8Array>;
}

export interface UriLike {
  fsPath: string;
  toString(): string;
}

/**
 * Minimal subset of VS Code's `Memento` (specifically `globalState`) used
 * to back the one-shot legacy migration from in-VS-Code state to the
 * file-based telemetry store (B-01, see `src/aiflowbridge/index.ts`
 * `loadPersistedTelemetry`). The standalone adapter returns `undefined`
 * for `get` and no-ops on `set`, so the migration is a no-op in CLI mode.
 */
export interface GlobalStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

/**
 * Runtime-agnostic gateway context.
 *
 * Implemented by:
 *   - `createVSCodeContext()` in `src/aiflowbridge/vscode-context-adapter.ts`
 *     (wraps `vscode.ExtensionContext`)
 *   - `createStandaloneContext()` in `src/standalone/context.ts`
 *     (env vars + `~/.aiflowbridge/` + `fs.watch` for hot config reload)
 *
 * The optional UI hooks (`registerCommand`, `showInformation`,
 * `showWarning`) are only populated by the VS Code adapter; the
 * standalone CLI ignores them. The optional filesystem hooks (`fs`,
 * `extensionUri`, `workspaceFolder`) are needed by the model registry
 * loader to read the bundled / workspace tiers.
 */
export interface IGatewayContext {
  /** Resolution of API keys by vendor id (matches VS Code's SecretStorage shape). */
  secrets: SecretStorageLike;
  /** Absolute path to the persistent storage directory (VS Code `globalStorageUri.fsPath`,
   *  or `~/.aiflowbridge/` in standalone mode). */
  globalStorageDir: string;
  /** Version of the extension / binary. */
  extensionVersion: string;
  /** Disposable bag the host keeps alive for the lifetime of the process. The runtime
   *  pushes every disposable it creates (status bar, gateway, listeners) into this array
   *  so the host can clean them up on deactivation. */
  subscriptions: Disposable[];
  /** Subscribe to configuration changes. The callback fires when the `aiflowbridge` section
   *  changes. The optional `event.affectsGateway` flag lets the runtime decide whether
   *  the change requires a full gateway restart or just a hot config update
   *. The VS Code adapter derives it from
   *  `e.affectsConfiguration("aiflowbridge.gateway")`; the standalone adapter
   *  passes `undefined` (the standalone config is a single file, every change
   *  is treated as a gateway-relevant change). Optional in standalone mode
   *  (where hot-reload is handled by an `fs.watch` on the JSON config file). */
  onConfigChange?(cb: (event?: { affectsGateway: boolean }) => void): Disposable;
  /** Read the raw configuration. Called from `loadConfig()` and on every config reload. */
  getConfiguration(): ConfigReader;
  /** Register a command. Optional - only the VS Code adapter implements it. The standalone
   *  CLI has no command palette. */
  registerCommand?(command: string, callback: (...args: unknown[]) => unknown): Disposable;
  /** Show an information message in the host UI. Optional. */
  showInformation?(message: string): void;
  /** Show a warning message in the host UI. Optional. */
  showWarning?(message: string): void;
  /** Filesystem used by the model registry loader (3-tier read). Optional in standalone
   *  mode if the bundled tier is the only one desired. */
  fs?: FileSystemLike;
  /** Extension / binary root URI used to resolve `resources/models.json`. Optional in
   *  standalone mode (the standalone binary bundles the registry next to the executable). */
  extensionUri?: UriLike;
  /** First workspace folder for the workspace-tier override. `undefined` when the host
   *  has no open workspace (or the standalone has no project context). */
  workspaceFolder?: UriLike | undefined;
  /** Cross-window persistent state slot, VS Code only. Used by the one-shot
   *  legacy migration in `loadPersistedTelemetry` (B-01). Standalone adapter
   *  returns `undefined` from `get` and no-ops on `set`. */
  globalState?: GlobalStateLike;
  /** Show a modal confirmation dialog. Resolves to the chosen button label,
   *  or `undefined` if the dialog was dismissed. Optional - the VS Code
   *  adapter implements it with `vscode.window.showWarningMessage` +
   *  `{ modal: true }`; standalone returns `undefined` (no UI). */
  confirm?(message: string, ...buttons: string[]): Promise<string | undefined>;
  /** Write text to the host clipboard. Optional - the VS Code adapter
   *  delegates to `vscode.env.clipboard.writeText`; standalone falls
   *  back to writing the text to `process.stdout`. */
  clipboardWrite?(text: string): void;
  /** Open the host settings UI scoped to the supplied query (e.g.
   *  `"aiflowbridge"`). Optional - the VS Code adapter delegates to
   *  `workbench.action.openSettings`; standalone has no settings UI and
   *  leaves this undefined. */
  openSettings?(query?: string): void;
  /** Run an arbitrary host command. Optional - the VS Code adapter
   *  delegates to `vscode.commands.executeCommand`; standalone has no
   *  command palette and leaves this undefined. */
  executeCommand?(command: string, ...args: unknown[]): Promise<unknown>;
}

export interface ProviderProfile {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  enabled: boolean;
  pricing?: ProviderPricing;
}

export interface VisionProxySettings {
  excludedVendors: string[];
  copilotVisionModel: string;
}

export interface GatewaySettings {
  enabled: boolean;
  port: number;
  baseUrl: string;
  defaultModel: string;
  /**
   * per-call timeout (ms) for probing a peer gateway's
   * `/version` endpoint when the configured port is already bound.
   * Higher values tolerate slower peer startups; lower values fail fast
   * on a foreign service. Defaults to 500 ms. Mirrors the
   * `aiflowbridge.gateway.probeTimeoutMs` package.json setting.
   */
  probeTimeoutMs: number;
  /**
   * hard cap on the number of concurrent upstream
   * `/v1/chat/completions` requests the gateway will relay. New
   * requests above the cap return HTTP 429 with a `Retry-After`
   * header. Protects the upstream from a runaway local client (e.g.
   * a test script firing thousands of requests per second). Defaults
   * to 20 concurrent requests. Mirrors the
   * `aiflowbridge.gateway.maxConcurrentRequests` package.json setting.
   */
  maxConcurrentRequests: number;
  /**
   * Per-upstream-provider cap on concurrent in-flight requests. The
   * gateway queues any further request for the same provider behind
   * this cap instead of opening more parallel sockets to the same
   * upstream. Key fix for BUG17: 3 agents in parallel against
   * MiniMax-M3 (`reasoning_split: true`) used to send 3 parallel
   * thinking-mode requests + 3 parallel `/input_tokens` pre-counts
   * to the same API key, which MiniMax throttled to 100 s+ tail
   * latency. A cap of 3 (the default) means a 4th parallel request
   * queues behind the first three, never opens a 4th upstream
   * socket. Set to 0 to disable (no cap). Mirrors
   * `aiflowbridge.gateway.maxConcurrentPerProvider`. Optional for
   * backward compatibility with older snapshots / test fixtures that
   * do not yet populate the field; the gateway defaults to 3 at use.
   */
  maxConcurrentPerProvider?: number;
  /**
   * Idle timeout (ms) for the upstream `fetch()` call. If no bytes
   * have arrived from the upstream for this many ms, the watchdog
   * aborts the request and surfaces HTTP 504 to the client. Caps the
   * "agent in standby for minutes" symptom reported in BUG17 when
   * MiniMax queues thinking-mode requests without sending any bytes.
   * Defaults to 90 000 ms (90 s). Set to 0 to disable. Mirrors
   * `aiflowbridge.gateway.upstreamIdleTimeoutMs`. Optional for
   * backward compatibility.
   */
  upstreamIdleTimeoutMs?: number;
  /**
   * Hard ceiling (ms) on the total upstream call duration. Even if
   * bytes keep flowing, the watchdog aborts and returns HTTP 504 to
   * the client after this many ms. Bounded safety net for the
   * idle-watchdog (which would otherwise wait indefinitely on a
   * slowly-trickling upstream). Defaults to 300 000 ms (5 min).
   * Set to 0 to disable. Mirrors
   * `aiflowbridge.gateway.streamTotalTimeoutMs`. Optional for
   * backward compatibility.
   */
  streamTotalTimeoutMs?: number;
/**
   * Whether to fire the parallel `fetchMinimaxPromptTokens` POST on
   * every MiniMax request. When `false` (default), the parallel
   * pre-count is only fired for non-streaming requests, because the
   * MiniMax stream endpoint already emits usage on the final chunk
   * and the parallel pre-count doubles the upstream load precisely
   * when thinking-mode bursts hurt the most (BUG17). Mirrors
   * `aiflowbridge.gateway.minimaxParallelTokenCount`. Optional for
   * backward compatibility.
   */
  minimaxParallelTokenCount?: boolean;
  /**
   * Action plan item #2. Settings for the workspace-context
   * detector / system-message injector. The detector scans the
   * workspace root for language manifests (`pyproject.toml`,
   * `Cargo.toml`, `package.json`, etc.) and prepends a one-paragraph
   * system message describing the languages / package managers /
   * linters / formatters it found. Defaults: enabled (opt-out by
   * setting `enabled` to `false` for non-code workspaces), max depth
   * 2, ignored dirs default set (node_modules, target, build, dist,
   * .git, .venv, .gradle, ...). The root is sourced from the VS Code
   * workspace folder (extension mode) or from the `aiflowbridge.gateway.workspaceContext.root`
   * setting (standalone mode), with the env var
   * `AIFLOWBRIDGE_WORKSPACE` as an override for service-manager
   * launches. Optional for backward compatibility (older
   * `GatewaySettings` without this field default to `enabled=true`,
   * `root=""`).
   */
  workspaceContext?: GatewayWorkspaceContextSettings;
  /**
   * Optional per-language provider routing rules (action plan item
   * #5). Sourced from `aiflowbridge.gateway.languageRouting`.
   * Optional for backward compatibility.
   */
  languageRouting?: Record<string, string>;
  /**
   * Action plan item #4. Settings for the zero-conf discovery
   * beacon + `/v1/discovery` HTTP endpoint. Default off so the
   * standalone CLI does not emit UDP packets on shared machines
   * unless explicitly opted in. Optional for backward
   * compatibility with older `GatewaySettings` that pre-date
   * the feature.
   */
  discovery?: GatewayDiscoverySettings;
}

export interface GatewayDiscoverySettings {
  /** Master switch. `false` (default) skips the UDP broadcast entirely; the HTTP `/v1/discovery` endpoint is also gated on this flag. */
  enabled?: boolean;
  /**
   * UDP destination port for the beacon. Default 8788. Clients
   * listening on the same network pick the gateway up on this
   * port without any pre-shared URL.
   */
  broadcastPort?: number;
  /**
   * Beacon emission interval (ms). Default 2 000 (every 2
   * seconds). The UDP payload is tiny (~80 bytes) so the
   * bandwidth impact is negligible; the interval is just
   * bounded so a hostile sniffer cannot reconstruct more than
   * one frame per interval.
   */
  broadcastIntervalMs?: number;
}

export interface GatewayWorkspaceContextSettings {
  /** Master switch. `true` (default) injects the context on every request; `false` is a no-op. */
  enabled?: boolean;
  /** Explicit root directory. Falls back to `process.env.AIFLOWBRIDGE_WORKSPACE`, then to the VS Code workspace folder if any. */
  root?: string;
  /** Max directory depth to walk. Default 2. */
  maxDepth?: number;
  /** Directory names to skip entirely (no recursion, no listing). */
  ignoredDirs?: string[];
}

/**
 * Source of a recorded request. `'gateway'` covers every request
 * served by `GatewayService` (Kilo Code, Continue, curl, Open WebUI,
 * etc. hitting `http://127.0.0.1:8787/v1/chat/completions`).
 * `'copilot-chat'` covers every request driven by VS Code Copilot
 * Chat through the `vscode.lm.registerLanguageModelChatProvider`
 * path. The split closes the historical blind spot in the metrics
 * view where ~50% of usage (the Copilot Chat path) was invisible
 * because the gateway only ever saw its own traffic.
 */
export type TelemetrySource = 'gateway' | 'copilot-chat';

export interface AiFlowBridgeConfig {
  gateway: GatewaySettings;
  providers: ProviderProfile[];
  telemetryEnabled: boolean;
  logRequests: boolean;
  visionProxy: VisionProxySettings;
}

export interface GatewayStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  providerCount: number;
  /**
   * current number of in-flight upstream
   * `/v1/chat/completions` requests being relayed by the gateway.
   * Surfaced in the status payload so the dashboard can show
   * "X / cap" when the cap is being hit.
   */
  inFlightRequests: number;
  /**
   * hard cap mirrored from `GatewaySettings.maxConcurrentRequests`.
   * Surfaced alongside `inFlightRequests` so the dashboard can render
   * `X / max` without re-reading the full config.
   */
  maxConcurrentRequests: number;
  /**
   * Per-upstream-provider cap mirrored from
   * `GatewaySettings.maxConcurrentPerProvider`. Surfaced on the
   * status payload so the dashboard can show the configured cap
   * alongside the per-provider in-flight count.
   */
  maxConcurrentPerProvider?: number;
  /**
   * Upstream idle-stream timeout (ms) mirrored from
   * `GatewaySettings.upstreamIdleTimeoutMs`. Surfaced on the status
   * payload for diagnostics (helps correlate dashboard "in
   * standby" reports with the configured idle cap).
   */
  upstreamIdleTimeoutMs?: number;
  /**
   * Total upstream-stream ceiling (ms) mirrored from
   * `GatewaySettings.streamTotalTimeoutMs`. Surfaced on the status
   * payload for diagnostics.
   */
  streamTotalTimeoutMs?: number;
}

export interface RequestTelemetry {
  id: string;
  timestamp: string;
  providerId: string;
  providerLabel: string;
  model: string;
  status: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  estimated: boolean;
  /**
   * Stable identifier of the originating client (e.g.
   * `kilocode@1.2.3`, `continue@0.9.x`, `curl@8.10.1`,
   * `jetbrains-ai-assistant@2024.3`, `unknown`). Resolved from the
   * `X-AIFlowBridge-Client` header when present, otherwise parsed
   * from the request's `User-Agent` header, otherwise the literal
   * string `'unknown'`. Optional for backward compatibility: older
   * snapshots (recorded before this field was introduced) leave it
   * `undefined`, and aggregations treat undefined as `'unknown'`.
   */
  clientId?: string;
  /**
   * Origin of the request inside the AIFlowBridge process. `'gateway'`
   * is the default for any entry that arrived through the local
   * OpenAI-compatible gateway (`POST /v1/chat/completions`).
   * `'copilot-chat'` is set by `UnifiedChatProvider` when the entry
   * was driven by VS Code Copilot Chat (the `vscode.lm` API path),
   * which used to be invisible in the dashboard - it now records
   * via `TelemetryStore.recordFromCopilotChat()`. Optional for
   * backward compatibility: older snapshots (recorded before this
   * field was introduced) leave it `undefined`; the dashboard
   * coalesces absent to `'gateway'` for display.
   */
  source?: TelemetrySource;
}

/**
 * Source of a recorded request. `'gateway'` covers every request
 * served by `GatewayService` (Kilo Code, Continue, curl, Open WebUI,
 * etc. hitting `http://127.0.0.1:8787/v1/chat/completions`).
 * `'copilot-chat'` covers every request driven by VS Code Copilot
 * Chat through the `vscode.lm.registerLanguageModelChatProvider`
 * path. The split closes the historical blind spot in the metrics
 * view where ~50% of usage (the Copilot Chat path) was invisible
 * because the gateway only ever saw its own traffic.
 */

export interface ProviderSnapshot {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errors: number;
  averageDurationMs: number;
}

export interface TelemetrySnapshot {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errors: number;
  averageDurationMs: number;
  p95DurationMs: number;
  recent: RequestTelemetry[];
  byProvider: Record<string, ProviderSnapshot>;
  byModel: Record<string, ProviderSnapshot>;
  /**
   * Per-originating-client aggregates (same shape as `byProvider` /
   * `byModel`). The key is the resolved `clientId` (`kilocode@1.2.3`,
   * `curl@8.x`, `unknown`, ...). Always present on a snapshot
   * returned by `TelemetryStore.snapshot()`; older on-disk snapshots
   * (recorded before this field was introduced) get an empty object
   * on load. Surfaced on the dashboard as a "By client" summary
   * panel so the user can spot whether their traffic comes from
   * Continue, Kilo Code, JetBrains AI Assistant, a curl script, or
   * the VS Code Copilot Chat path.
   */
  byClient: Record<string, ProviderSnapshot>;
  /**
   * Per-origin aggregates (same shape as `byProvider` / `byModel`).
   * The key is the `source` field on the recorded entry
   * (`'gateway'`, `'copilot-chat'`, or `'unknown'` for older
   * snapshots). Optional for backward compatibility: older
   * on-disk snapshots (recorded before this field was introduced)
   * leave the field `undefined`; the dashboard coalesces absent
   * to `{}` for display. Surfaced on the dashboard as a "By
   * source" summary panel so the user can split gateway traffic
   * from Copilot Chat traffic at a glance.
   */
  bySource?: Record<string, ProviderSnapshot>;
}
