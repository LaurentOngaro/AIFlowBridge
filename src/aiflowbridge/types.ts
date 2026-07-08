export type BridgeMode = "proxy" | "vision" | "proxy+vision";
export type ProviderKind = "openai-compat" | "ollama";
export type OutputMode = "clipboard" | "insert" | "copilot";

export interface ProviderPricing {
  inputPerMillion?: number;
  outputPerMillion?: number;
  currency?: string;
}

/**
 * Minimal disposable contract. Mirrors VS Code's `Disposable` shape so the
 * runtime can stay agnostic of the host (VS Code extension, standalone
 * CLI, ...). Returned by `IGatewayContext.registerCommand` and by
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
 * Runtime-agnostic gateway context (FEAT7).
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
   *  (IMPROV-C06). The VS Code adapter derives it from
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
   * IMPROV-C05: per-call timeout (ms) for probing a peer gateway's
   * `/version` endpoint when the configured port is already bound.
   * Higher values tolerate slower peer startups; lower values fail fast
   * on a foreign service. Defaults to 500 ms. Mirrors the
   * `aiflowbridge.gateway.probeTimeoutMs` package.json setting.
   */
  probeTimeoutMs: number;
  /**
   * IMPROV-C04: hard cap on the number of concurrent upstream
   * `/v1/chat/completions` requests the gateway will relay. New
   * requests above the cap return HTTP 429 with a `Retry-After`
   * header. Protects the upstream from a runaway local client (e.g.
   * a test script firing thousands of requests per second). Defaults
   * to 20 concurrent requests. Mirrors the
   * `aiflowbridge.gateway.maxConcurrentRequests` package.json setting.
   */
  maxConcurrentRequests: number;
}

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
   * IMPROV-C04: current number of in-flight upstream
   * `/v1/chat/completions` requests being relayed by the gateway.
   * Surfaced in the status payload so the dashboard can show
   * "X / cap" when the cap is being hit.
   */
  inFlightRequests: number;
  /**
   * IMPROV-C04: hard cap mirrored from `GatewaySettings.maxConcurrentRequests`.
   * Surfaced alongside `inFlightRequests` so the dashboard can render
   * `X / max` without re-reading the full config.
   */
  maxConcurrentRequests: number;
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
}

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
}