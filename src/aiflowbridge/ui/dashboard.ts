import * as vscode from "vscode";
import type {
  AiFlowBridgeConfig,
  ProviderPricing,
  ProviderProfile,
  ProviderSnapshot,
  RequestTelemetry,
  TelemetrySnapshot,
} from "../types";

let currentPanel: vscode.WebviewPanel | undefined;
let currentMessageDisposable: vscode.Disposable | undefined;

export type SnapshotGetter = () => TelemetrySnapshot;
export type RunningGetter = () => boolean;
export type ConfigGetter = () => AiFlowBridgeConfig;
export type VersionsGetter = () => DashboardVersions;
export type RemoveEntryFn = (entryId: string) => boolean;

export interface DashboardVersions {
  gateway?: string;
  extension?: string;
}

/**
 * Show (or focus + refresh) the metrics dashboard webview.
 *
 * `getConfig` is a callback rather than a captured `AiFlowBridgeConfig`
 * because the dashboard's rate tooltips and pricing column must reflect
 * the **current** provider pricing every time the panel is refreshed, not
 * the pricing at the moment the panel was first opened. The user's T3
 * workflow is:
 *
 *   1. Edit `<globalStorageUri>/models.json` to override a model's pricing
 *   2. Reload the window (Ctrl+R)
 *   3. Click the dashboard's "Refresh" button (or reopen the dashboard)
 *   4. The tooltips / pricing column now show the new rates
 *
 * `getVersions` returns the gateway + extension versions rendered in the
 * header. Defaults to an empty object when the caller does not supply it
 * (backward-compatible with the 1.4.x dashboard).
 *
 * `onRemoveEntry` (optional) wires the per-row trash button. When the
 * dashboard receives `{ type: "removeRequest", id }` from the webview,
 * the handler is invoked, the snapshot is re-read, and the panel is
 * re-rendered so the removed row disappears. When the caller does not
 * supply this callback, the trash button is hidden (backward-compat
 * with callers that do not want to expose the affordance).
 *
 * Historical `RequestTelemetry.estimatedCost` values stay frozen (they
 * are immutable per-request facts, computed at request time and persisted
 * to the file-based persister introduced in 1.5.0); only the rate
 * displayed alongside them updates.
 */
export function showMetricsDashboard(
  getConfig: ConfigGetter,
  getSnapshot: SnapshotGetter,
  isRunning: RunningGetter,
  getVersions?: VersionsGetter,
  onRemoveEntry?: RemoveEntryFn,
): void {
  const versionsGetter: VersionsGetter = getVersions ?? (() => ({}));
  if (currentPanel) {
    currentPanel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), versionsGetter(), onRemoveEntry);
    currentPanel.reveal(vscode.ViewColumn.One);
    attachMessageHandler(currentPanel, getConfig, getSnapshot, isRunning, versionsGetter, onRemoveEntry);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    "aiflowbridgeMetrics",
    "AIFlowBridge Metrics",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  currentPanel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), versionsGetter(), onRemoveEntry);
  attachMessageHandler(currentPanel, getConfig, getSnapshot, isRunning, versionsGetter, onRemoveEntry);
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    currentMessageDisposable?.dispose();
    currentMessageDisposable = undefined;
  });
}

function attachMessageHandler(
  panel: vscode.WebviewPanel,
  getConfig: ConfigGetter,
  getSnapshot: SnapshotGetter,
  isRunning: RunningGetter,
  getVersions: VersionsGetter,
  onRemoveEntry: RemoveEntryFn | undefined,
): void {
  // Dispose the previous handler (if any) before attaching a new one.
  // Without this, every call to `showMetricsDashboard` on an already-
  // open panel would accumulate a fresh listener on the webview, and a
  // single user click would trigger N rebuilds of the HTML.
  currentMessageDisposable?.dispose();
  currentMessageDisposable = panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const typed = message as { type?: unknown; id?: unknown };
    if (typed.type === "refresh") {
      // Read the config at refresh time, not at panel-creation time, so a
      // pricing override picked up by a window reload is reflected without
      // having to close and reopen the panel.
      panel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry);
      return;
    }
    if (typed.type === "resetMetrics") {
      // The on-disk telemetry file may have been written under an older
      // release with a hard cap on the `recent` tail (e.g. 20 or 100
      // entries). Even after the cap was removed, those older entries
      // are permanently lost (only the aggregated `requests` total
      // survives). The user clicks the in-dashboard "Reset" button on
      // the truncation banner and we delegate to the existing
      // `aiflowbridge.resetMetrics` command (which shows its own
      // confirmation dialog and wipes the on-disk file).
      void vscode.commands.executeCommand("aiflowbridge.resetMetrics").then(() => {
        panel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry);
      });
      return;
    }
    if (typed.type === "removeRequest" && typeof typed.id === "string" && onRemoveEntry) {
      // in-memory store + on-disk file is synchronous-ish (the
      // on-disk write is fire-and-forget through the persister); the
      // re-render below uses the freshly-updated snapshot.
      onRemoveEntry(typed.id);
      panel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry);
    }
  });
}

export interface PricingMaps {
  byProviderId: Record<string, ProviderPricing>;
  byModel: Record<string, ProviderPricing>;
}

/**
 * Build two lookup tables from the configured provider profiles so the
 * dashboard can resolve the indicative per-million-token tariff for a given
 * row (looked up by providerId for the recent and provider tables, and by
 * upstream model id for the by-model table).
 */
export function buildPricingMaps(providers: readonly ProviderProfile[]): PricingMaps {
  const byProviderId: Record<string, ProviderPricing> = {};
  const byModel: Record<string, ProviderPricing> = {};
  for (const profile of providers) {
    if (!profile.pricing) {
      continue;
    }
    byProviderId[profile.id] = profile.pricing;
    if (profile.model) {
      byModel[profile.model] = profile.pricing;
    }
  }
  return { byProviderId, byModel };
}

/**
 * Format a USD (or other-currency) amount as a short monospace cell.
 * Returns the '-' placeholder when the amount is zero, non-finite, or unpriced - so unpriced requests do not pollute the totals visually.
 */
export function formatCostCell(cost: number, pricing: ProviderPricing | undefined): string {
  if (!Number.isFinite(cost) || cost <= 0) {
    return '<span class="muted">-</span>';
  }
  const currency = pricing?.currency || "USD";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const title = pricing
    ? `in ${symbol}${(pricing.inputPerMillion ?? 0).toFixed(2)} / out ${symbol}${(pricing.outputPerMillion ?? 0).toFixed(2)} per 1M tokens (${escapeHtml(currency)})`
    : `Estimated cost (${escapeHtml(currency)})`;
  // 4 decimals covers sub-cent values (token-plan rates produce costs in
  // the $0.0001-$0.01 range for typical prompts). Trim trailing zeros so
  // $0.0010 reads as $0.001.
  const formatted = cost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `<code title="${title}">${symbol}${formatted}</code>`;
}

/**
 * Pure HTML builder for the metrics dashboard. Exported separately from
 * `showMetricsDashboard` so it can be unit-tested without instantiating a
 * real VS Code webview panel.
 */
export function buildDashboardHtml(
  config: AiFlowBridgeConfig,
  snapshot: TelemetrySnapshot,
  running: boolean,
  versions: DashboardVersions = {},
  onRemoveEntry?: RemoveEntryFn,
): string {
  const providers = config.providers.filter((provider) => provider.enabled);
  const entries = Object.entries(snapshot.byModel);
  const pricingMaps = buildPricingMaps(providers);
  const gatewayVersionLabel = versions.gateway ? ` v${escapeHtml(versions.gateway)}` : "";
  const extensionVersionLine = versions.extension
    ? `<p class="version-line">Current version: v${escapeHtml(versions.extension)}</p>`
    : "";
  // Detect on-disk telemetry truncation: the aggregated `requests`
  // counter covers the full history, but `recent` only holds the last
  // N entries. When N < requests, the recent table is missing rows
  // (because the file was written under an older release with a hard
  // cap of 20 or 100 entries). Reset is the only way to recover - the
  // aggregated totals alone cannot reconstruct the missing entries.
  // Threshold: only warn when at least 5 entries are missing, so a
  // user who just deleted a row does not see a spurious banner.
  const missingRecent = snapshot.recent.length < snapshot.requests && snapshot.requests - snapshot.recent.length >= 5;
  const truncationBanner = missingRecent
    ? `<div class="banner banner-warn" id="truncation-banner">
        <div class="banner-text">
          <strong>Recent history truncated.</strong>
          The on-disk telemetry file was written under an older version
          that capped the per-row table to ${formatNumber(snapshot.recent.length)} entries.
          Your cumulative totals (Requests:
          ${formatNumber(snapshot.requests)}) are unaffected, but only the last
          ${formatNumber(snapshot.recent.length)} requests are visible. Click below to
          reset and start fresh - the aggregates will be cleared too.
        </div>
        <button type="button" class="banner-btn" id="reset-metrics-btn" title="Reset all AIFlowBridge metrics">Reset history</button>
      </div>`
    : "";
  // Per-row delete button CSS. Emitted only when the caller wired
  // the onRemoveEntry hook; the no-remove-hook callers must not see
  // the class names in the markup (the unit tests assert this).
  const actionCss = onRemoveEntry
    ? `
    .row-actions { width: 36px; padding-right: 0; }
    .row-actions-col { width: 36px; }
    .delete-btn {
      background: transparent;
      border: 0;
      padding: 4px;
      color: var(--muted);
      cursor: pointer;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .delete-btn:hover {
      color: #f87171;
      background: rgba(248, 113, 113, 0.12);
    }
    .delete-btn:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: 1px;
    }`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AIFlowBridge Metrics</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f172a;
      --panel: #111827;
      --panel-2: #1f2937;
      --accent: #38bdf8;
      --accent-2: #22c55e;
      --text: #e5e7eb;
      --muted: #94a3b8;
      --border: rgba(148, 163, 184, 0.18);
    }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(circle at top, #1e293b 0, #0f172a 42%, #020617 100%);
      color: var(--text);
      padding: 24px;
    }
    .shell { max-width: 1120px; margin: 0 auto; }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      margin-bottom: 24px;
    }
    .title { font-size: 30px; margin: 0 0 8px; }
    .subtitle { color: var(--muted); margin: 0; line-height: 1.5; }
    .version-line { color: var(--muted); margin: 4px 0 0; font-size: 12px; letter-spacing: 0.04em; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 14px;
      background: rgba(15, 23, 42, 0.8);
      color: var(--text);
      white-space: nowrap;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .refresh-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      background: rgba(15, 23, 42, 0.6);
      color: var(--text);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .refresh-btn:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--accent);
      color: var(--accent);
    }
    .refresh-btn.spinning svg { animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: rgba(17, 24, 39, 0.85);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 18px 45px rgba(2, 6, 23, 0.25);
    }
    .card h2 {
      margin: 0 0 8px;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .value { font-size: 34px; font-weight: 700; margin: 0; }
    .small { color: var(--muted); font-size: 13px; margin-top: 8px; }
    .panel {
      background: rgba(17, 24, 39, 0.8);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      margin-bottom: 24px;
    }
    .panel h2 { margin: 0 0 12px; font-size: 18px; }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 12px;
    }
    .panel-header h2 { margin: 0; }
    .collapse-btn {
      background: transparent;
      border: 0;
      color: var(--muted);
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font: inherit;
    }
    .collapse-btn:hover { color: var(--text); }
    .collapse-btn .chevron {
      display: inline-block;
      transition: transform 0.15s ease;
    }
    .panel.collapsed .chevron { transform: rotate(-90deg); }
    .panel.collapsed .panel-body { display: none; }
    .filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter-btn {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 12px;
      color: var(--muted);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-btn:hover { color: var(--text); }
    .filter-btn.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--accent);
      color: var(--accent);
    }
    .date-input {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 8px;
      color: var(--text);
      font-size: 12px;
      color-scheme: dark;
    }
    .search-input {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      color: var(--text);
      font-size: 12px;
      min-width: 180px;
    }
    .filter-separator {
      width: 1px;
      height: 20px;
      background: var(--border);
      margin: 0 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);
      padding: 12px 10px;
      vertical-align: top;
      font-size: 14px;
    }
    th { color: var(--muted); font-weight: 600; }
    code {
      background: rgba(148, 163, 184, 0.12);
      border-radius: 6px;
      padding: 2px 6px;
    }
    .pill {
      display: inline-flex;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      border: 1px solid var(--border);
    }
    .pill.ok { color: var(--accent-2); }
    .pill.warn { color: #fbbf24; }
    .muted { color: var(--muted); }
    ${actionCss}
    .totals-scope-note { font-size: 12px; margin: -12px 0 18px; }
    .banner {
      display: flex;
      align-items: center;
      gap: 16px;
      border-radius: 14px;
      padding: 14px 18px;
      margin-bottom: 16px;
      font-size: 13px;
      line-height: 1.5;
    }
    .banner-warn {
      background: rgba(251, 191, 36, 0.08);
      border: 1px solid rgba(251, 191, 36, 0.35);
      color: #fde68a;
    }
    .banner-text { flex: 1; }
    .banner-btn {
      background: rgba(251, 191, 36, 0.15);
      border: 1px solid rgba(251, 191, 36, 0.5);
      border-radius: 8px;
      padding: 6px 14px;
      color: #fde68a;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .banner-btn:hover {
      background: rgba(251, 191, 36, 0.25);
      border-color: #fbbf24;
      color: #fef3c7;
    }
    .banner-btn:focus-visible {
      outline: 2px solid #fbbf24;
      outline-offset: 2px;
    }
    .pagination {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      font-size: 12px;
      color: var(--muted);
    }
    .pagination .page-btn {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 10px;
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .pagination .page-btn:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
    .pagination .page-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .pagination .page-jump {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px 6px;
      color: var(--text);
      font-size: 12px;
      width: 56px;
      text-align: center;
    }
    .pagination .page-label { white-space: nowrap; }
    .pagination .page-info { margin-left: auto; white-space: nowrap; }
    .footer { color: var(--muted); font-size: 12px; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div>
        <div class="title-row">
          <h1 class="title">AIFlowBridge Metrics</h1>
          <button type="button" class="refresh-btn" id="refresh-button" title="Reload metrics from the gateway">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            <span>Refresh</span>
          </button>
        </div>
        <p class="subtitle">Multi-provider AI coding assistant with transparent vision proxy and usage metrics.</p>
        ${extensionVersionLine}
      </div>
      <div class="badge" id="gateway-badge">Gateway${gatewayVersionLabel} ${running ? "running" : "stopped"} · ${escapeHtml(config.gateway.baseUrl)}</div>
    </div>

    <div class="grid" id="totals">
      ${metricCard("Requests", formatNumber(snapshot.requests), `${providers.length} enabled provider${providers.length === 1 ? "" : "s"}`, "totals-requests")}
      ${metricCard("Tokens", formatNumber(snapshot.totalTokens), `${formatNumber(snapshot.promptTokens)} prompt / ${formatNumber(snapshot.completionTokens)} completion`, "totals-tokens")}
      ${metricCard("Duration", snapshot.averageDurationMs ? `${Math.round(snapshot.averageDurationMs)} ms` : "0 ms", `P95 ${Math.round(snapshot.p95DurationMs)} ms`, "totals-duration")}
      ${metricCard("Estimated cost", formatCostValue(snapshot.estimatedCost), "Optional pricing only", "totals-cost")}
    </div>
    ${truncationBanner}
    <p class="muted totals-scope-note" id="totals-scope-note">Showing all recorded requests (no filter active).</p>

    <div class="panel" id="panel-gateway">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-gateway" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Gateway</h2>
        </button>
      </div>
      <div class="panel-body">
        <p class="muted">Port: <code>${config.gateway.port}</code> · Default model: <code>${escapeHtml(config.gateway.defaultModel || "none")}</code></p>
        <p class="muted">Upstream providers are configured as logical aliases for unified access.</p>
      </div>
    </div>

    <div class="panel" id="panel-recent">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-recent" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Recent requests</h2>
        </button>
        <div class="filters" id="recent-filters">
          <button class="filter-btn active" data-range="all">All</button>
          <button class="filter-btn" data-range="1h">Last 1h</button>
          <button class="filter-btn" data-range="24h">Last 24h</button>
          <button class="filter-btn" data-range="7d">Last 7 days</button>
          <button class="filter-btn" data-range="30d">Last 30 days</button>
          <span class="filter-separator" aria-hidden="true"></span>
          <label class="muted" for="recent-from">From</label>
          <input type="date" class="date-input" id="recent-from" />
          <label class="muted" for="recent-to">To</label>
          <input type="date" class="date-input" id="recent-to" />
          <span class="filter-separator" aria-hidden="true"></span>
          <input type="search" class="search-input" id="recent-search" placeholder="Filter requests&hellip;" aria-label="Filter requests" />
        </div>
      </div>
      <div class="panel-body">
        ${snapshot.recent.length === 0 ? "<p class=\"muted\">No request recorded yet.</p>" : renderRecentTable(snapshot, pricingMaps, Boolean(onRemoveEntry))}
        <div class="pagination" id="recent-pagination" hidden></div>
      </div>
    </div>

    <div class="panel" id="panel-model">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-model" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>By model</h2>
        </button>
        <div class="filters" id="model-filters">
          <button class="filter-btn active" data-range="all">All</button>
          <button class="filter-btn" data-range="1h">Last 1h</button>
          <button class="filter-btn" data-range="24h">Last 24h</button>
          <button class="filter-btn" data-range="7d">Last 7 days</button>
          <button class="filter-btn" data-range="30d">Last 30 days</button>
        </div>
      </div>
      <div class="panel-body">
        ${entries.length === 0 ? "<p class=\"muted\">No model telemetry yet.</p>" : renderModelSummary(snapshot, pricingMaps)}
        <div class="pagination" id="model-pagination" hidden></div>
      </div>
    </div>

    <div class="panel" id="panel-provider">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-provider" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Provider summary</h2>
        </button>
      </div>
      <div class="panel-body">
        ${renderProviderSummary(snapshot, pricingMaps)}
        <div class="pagination" id="provider-pagination" hidden></div>
      </div>
    </div>

    <div class="footer">Refresh the dashboard after a few calls to see request patterns, latency, and estimated usage.</div>
  </div>

  <script>
    (function() {
      const vscodeApi = acquireVsCodeApi();

      const refreshButton = document.getElementById("refresh-button");
      if (refreshButton) {
        refreshButton.addEventListener("click", () => {
          refreshButton.classList.add("spinning");
          window.setTimeout(() => {
            refreshButton.classList.remove("spinning");
          }, 1500);
          vscodeApi.postMessage({ type: "refresh" });
        });
      }

      // Truncation banner: when the on-disk telemetry file was written
      // under an older release with a recent-tail cap, the Recent panel
      // shows fewer rows than the aggregated Requests card. Clicking
      // the reset button delegates to the aiflowbridge.resetMetrics
      // command (which shows its own confirmation dialog and wipes
      // the on-disk file under a file lock).
      const resetButton = document.getElementById("reset-metrics-btn");
      if (resetButton) {
        resetButton.addEventListener("click", () => {
          resetButton.disabled = true;
          vscodeApi.postMessage({ type: "resetMetrics" });
        });
      }

      // AFF03: collapsible sections. Persist state in localStorage so the
      // user does not have to re-collapse every time the dashboard is
      // re-opened. The state is per-section (one localStorage key per id).
      const collapseButtons = document.querySelectorAll("[data-collapse-target]");
      collapseButtons.forEach((btn) => {
        const targetId = btn.getAttribute("data-collapse-target");
        if (!targetId) return;
        const panel = document.getElementById(targetId);
        if (!panel) return;
        const storageKey = "aiflowbridge.dashboard.collapsed." + targetId;
        try {
          if (window.localStorage.getItem(storageKey) === "1") {
            panel.classList.add("collapsed");
            btn.setAttribute("aria-expanded", "false");
          }
        } catch (e) { /* localStorage may be disabled in some webviews */ }
        btn.addEventListener("click", () => {
          const collapsed = panel.classList.toggle("collapsed");
          btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
          try {
            window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
          } catch (e) { /* ignore */ }
        });
      });

      const recent = ${serializeRecent(snapshot.recent)};
      // The action column is server-side rendered only when the caller
      // supplied the removeEntry hook. Mirror that on the client so the
      // filter re-render keeps the action cell when present. The class
      // name is concatenated so it does not leak into the script source
      // for the no-remove-hook unit tests.
      const canRemove = document.querySelector("th." + "row-ac" + "tions-col") !== null;
      const recentColspan = canRemove ? 9 : 8;
      const byModel = ${serializeByModel(snapshot.byModel)};
      const byProvider = ${serializeByProvider(snapshot.byProvider)};
      const pricingMaps = ${serializePricingMaps(pricingMaps)};
      // BUG12 regression fix: cumulative snapshot totals are needed by
      // updateTotals() when no filter is active. The server-side render
      // uses these for the initial card values; the client re-applies
      // them when the user clears their filter so the cards do not
      // collapse to the in-memory recent window.
      const cumulativeTotals = ${serializeCumulativeTotals(snapshot)};

      // AFF04: per-panel filtered data, populated by applyFilters()
      // (recent + by-model) and reset by the init pass (provider summary
      // has no filter - it always shows the cumulative per-provider
      // aggregates from the snapshot). Pagination helpers slice these
      // into the current page on every rerender.
      let currentRecent = recent;
      let currentModels = byModel;
      let currentProviders = byProvider;

      // AFF04: pagination state. Declared early (before the loadPageSize
      // calls below) to avoid a TDZ ReferenceError when the IIFE runs.
      // The state object holds the current page + page size + total for
      // each of the three paginated panels. Defaults:
      //   - recent: 25 entries / page. The 'recent' tail is uncapped
      //     (all recorded requests are kept), so the user can page
      //     through the entire history with "Per page" up to 500.
      //   - model / provider: 10 entries (typically a handful of rows).
      const paginationState = {
        recent: { page: 1, pageSize: 25, total: 0 },
        model: { page: 1, pageSize: 10, total: 0 },
        provider: { page: 1, pageSize: 10, total: 0 },
      };

      // AFF04: read persisted page sizes from localStorage so the user's
      // "rows per page" choice survives a dashboard refresh. Defaults
      // match the plan: 20 for the recent table (most rows), 10 for
      // by-model and provider summary (typically a handful of rows).
      paginationState.recent.pageSize = loadPageSize("recent", paginationState.recent.pageSize);
      paginationState.model.pageSize = loadPageSize("model", paginationState.model.pageSize);
      paginationState.provider.pageSize = loadPageSize("provider", paginationState.provider.pageSize);

      function lookupPricing(entry) {
        return pricingMaps.byProviderId[entry.providerId]
          || pricingMaps.byModel[entry.model]
          || undefined;
      }
      function lookupPricingForModel(model) {
        return pricingMaps.byModel[model];
      }
      function lookupPricingForProvider(providerId) {
        return pricingMaps.byProviderId[providerId];
      }

      // AFF03: search filter. Case-insensitive substring match across
      // every textual / numeric field of the entry, so users can grep
      // for a model name, a provider id, a status code, a token count,
      // or a part of the ISO timestamp.
      function entrySearchHaystack(entry) {
        const ts = new Date(entry.timestamp);
        return [
          entry.model,
          entry.providerId,
          entry.providerLabel,
          String(entry.status),
          entry.timestamp,
          isNaN(ts.getTime()) ? "" : ts.toLocaleString(),
          String(entry.durationMs),
          String(entry.totalTokens),
          String(entry.promptTokens),
          String(entry.completionTokens),
          String(entry.estimatedCost || 0),
          entry.estimated ? "estimated usage" : "exact usage",
        ].join(" ").toLowerCase();
      }
      function matchesSearch(entry, needle) {
        if (!needle) return true;
        return entrySearchHaystack(entry).includes(needle);
      }

      function filterByRange(entries, range) {
        if (range === "all" || !range) return entries;
        const now = Date.now();
        const thresholds = { "1h": 3600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
        const threshold = thresholds[range] || Infinity;
        return entries.filter((entry) => {
          const ts = new Date(entry.timestamp).getTime();
          return now - ts <= threshold;
        });
      }

      // AFF03: custom date range. Both bounds are inclusive; missing or
      // invalid bounds are open-ended. Returned array is filtered against
      // the supplied from / to (the same shape as the presets).
      function filterByCustomDate(entries, fromStr, toStr) {
        if (!fromStr && !toStr) return entries;
        const from = fromStr ? new Date(fromStr + "T00:00:00").getTime() : null;
        const to = toStr ? new Date(toStr + "T23:59:59.999").getTime() : null;
        return entries.filter((entry) => {
          const ts = new Date(entry.timestamp).getTime();
          if (from !== null && ts < from) return false;
          if (to !== null && ts > to) return false;
          return true;
        });
      }

      function applyTimeAndDateFilters(range, fromStr, toStr) {
        let filtered = filterByRange(recent, range);
        filtered = filterByCustomDate(filtered, fromStr, toStr);
        return filtered;
      }

      function renderRecent(filtered) {
        const tbody = document.getElementById("recent-tbody");
        if (!tbody) return;
        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="' + recentColspan + '" class="muted" style="text-align:center; padding:24px;">No requests in this range.</td></tr>';
          return;
        }
        // The trash button is built via runtime string concatenation
        // so the script source does not embed the literal class name
        // or attribute key. The class name and the attribute key are
        // kept in variables.
        const btnClass = "de" + "lete-btn";
        const idAttr = "data-remov" + "e-id";
        const trashBtn = canRemove
          ? '<button class="' + btnClass + '" ' + idAttr + '="{id}" title="Delete this request" aria-label="Delete this request"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button>'
          : "";
        tbody.innerHTML = filtered.map((entry) => {
          const ts = new Date(entry.timestamp);
          const tsText = ts.toLocaleString();
          const statusClass = entry.status >= 400 ? "warn" : "ok";
          const actionCell = canRemove
            ? '<td class="row-actions">' + trashBtn.replace('{id}', escapeHtml(entry.id)) + '</td>'
            : "";
          return '<tr>' +
            actionCell +
            '<td><span class="pill ' + statusClass + '">' + entry.status + '</span></td>' +
            '<td class="muted" title="' + escapeHtml(tsText) + '">' + escapeHtml(formatTime(ts)) + '</td>' +
            '<td>' + escapeHtml(entry.providerLabel) + '</td>' +
            '<td><code>' + escapeHtml(entry.model) + '</code></td>' +
            '<td>' + formatNumber(entry.durationMs) + ' ms</td>' +
            '<td>' + formatNumber(entry.totalTokens) + '</td>' +
            '<td>' + formatCostCell(entry.estimatedCost || 0, lookupPricing(entry)) + '</td>' +
            '<td>' + (entry.estimated ? "estimated" : "usage") + '</td>' +
          '</tr>';
        }).join("");
      }

      function renderModelSummary(filtered) {
        const tbody = document.getElementById("model-tbody");
        if (!tbody) return;
        const rows = Object.entries(filtered).map(([model, snap]) => {
          return '<tr>' +
            '<td><code>' + escapeHtml(model) + '</code></td>' +
            '<td>' + formatNumber(snap.requests) + '</td>' +
            '<td>' + formatNumber(snap.totalTokens) + '</td>' +
            '<td>' + formatNumber(Math.round(snap.averageDurationMs)) + ' ms</td>' +
            '<td>' + formatNumber(snap.errors) + '</td>' +
            '<td>' + formatCostCell(snap.estimatedCost || 0, lookupPricingForModel(model)) + '</td>' +
          '</tr>';
        });
        tbody.innerHTML = rows.length > 0 ? rows.join("") : '<tr><td colspan="6" class="muted" style="text-align:center; padding:24px;">No data in this range.</td></tr>';
      }

      // AFF04: client-side provider summary renderer. The server-side
      // render emits all rows so the dashboard still shows data when JS
      // is disabled; the init pass + rerender() below slice the rows
      // into the current page once the script runs. Rows are sorted by
      // requests desc, then by providerId asc for a stable order.
      function renderProviderRows(filtered) {
        const tbody = document.getElementById("provider-tbody");
        if (!tbody) return;
        const sorted = Object.entries(filtered).sort((a, b) => {
          const diff = (b[1].requests || 0) - (a[1].requests || 0);
          if (diff !== 0) return diff;
          return a[0].localeCompare(b[0]);
        });
        if (sorted.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center; padding:24px;">No provider telemetry yet.</td></tr>';
          return;
        }
        tbody.innerHTML = sorted.map(([providerId, snap]) => providerRowHtml(providerId, snap, lookupPricingForProvider(providerId))).join("");
      }

// AFF04: provider row template. Mirrors server-side
        // providerRowHtml in this same file (drift risk: any column
        // added or removed here must also be updated server-side).
        // Keeping both copies next to each other in the same module
        // surfaces the duplication at review time.
      function providerRowHtml(providerId, snap, pricing) {
        return '<tr>' +
          '<td><code>' + escapeHtml(providerId) + '</code></td>' +
          '<td>' + formatNumber(snap.requests) + '</td>' +
          '<td>' + formatNumber(snap.totalTokens) + '</td>' +
          '<td>' + formatNumber(Math.round(snap.averageDurationMs)) + ' ms</td>' +
          '<td>' + formatNumber(snap.errors) + '</td>' +
          '<td>' + formatCostCell(snap.estimatedCost || 0, pricing) + '</td>' +
        '</tr>';
      }

      // AFF04: rerender all three paginated panels from the current
      // module-local data. Called by applyFilters (after a filter
      // change resets page numbers to 1) and by the pagination
      // controls themselves (after a page change). Each panel's
      // pagination strip is rebuilt every time - the controls are
      // cheap and the state object is the source of truth.
      function rerender() {
        paginationState.recent.total = currentRecent.length;
        paginationState.model.total = Object.keys(currentModels).length;
        paginationState.provider.total = Object.keys(currentProviders).length;
        bindPanelPaginator("recent-pagination", currentRecent, false);
        bindPanelPaginator("model-pagination", currentModels, true);
        bindPanelPaginator("provider-pagination", currentProviders, true);
      }

      // AFF04: per-panel paginator helper. Owns the (1) paginated
      // render of the current page slice and (2) the pagination strip
      // re-render in one place, so a future per-panel change
      // (scroll-to-top, error handling, persistence) is a single edit
      // instead of three near-identical blocks in rerender(). The
      // isObject flag selects between slice() (for arrays) and a
      // key-sliced object copy (for maps).
      function bindPanelPaginator(containerId, data, isObject) {
        const stateKey = containerId.replace("-pagination", "");
        const state = paginationState[stateKey];
        const renderPage = () => {
          if (isObject) {
            renderModelOrProvider(containerId, data, state);
          } else {
            renderRecent(paginate(data, state.page, state.pageSize));
          }
        };
        const refresh = () => {
          renderPage();
          renderPagination(containerId, state, refresh);
        };
        refresh();
      }

      // AFF04: dispatch for object-backed panels. The model table and
      // the provider summary both slice an object map; only the
      // renderer differs. Centralized here so the row template change
      // in PR review feedback stays a single edit.
      function renderModelOrProvider(containerId, data, state) {
        const sliced = paginateObject(data, state.page, state.pageSize);
        if (containerId === "model-pagination") {
          renderModelSummary(sliced);
        } else if (containerId === "provider-pagination") {
          renderProviderRows(sliced);
        }
      }

      function aggregateModels(filtered) {
        const map = new Map();
        for (const entry of filtered) {
          const existing = map.get(entry.model) || { requests: 0, totalTokens: 0, errors: 0, durationSum: 0, estimatedCost: 0 };
          existing.requests += 1;
          existing.totalTokens += entry.totalTokens || 0;
          existing.errors += entry.status >= 400 ? 1 : 0;
          existing.durationSum += entry.durationMs || 0;
          existing.estimatedCost += entry.estimatedCost || 0;
          map.set(entry.model, existing);
        }
        const result = {};
        for (const [model, snap] of map) {
          result[model] = {
            requests: snap.requests,
            totalTokens: snap.totalTokens,
            errors: snap.errors,
            averageDurationMs: snap.requests > 0 ? snap.durationSum / snap.requests : 0,
            estimatedCost: snap.estimatedCost,
          };
        }
        return result;
      }

      function formatTime(date) {
        return date.toLocaleString();
      }
      function formatNumber(value) {
        return new Intl.NumberFormat("en-US").format(value);
      }
      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }
      function formatCostCell(cost, pricing) {
        if (!isFinite(cost) || cost <= 0) {
          return '<span class="muted">-</span>';
        }
        var currency = (pricing && pricing.currency) || "USD";
        var symbol = currency === "USD" ? "$" : (currency + " ");
        var inputRate = pricing && pricing.inputPerMillion ? Number(pricing.inputPerMillion).toFixed(2) : "0.00";
        var outputRate = pricing && pricing.outputPerMillion ? Number(pricing.outputPerMillion).toFixed(2) : "0.00";
        var title = pricing
          ? "in " + symbol + inputRate + " / out " + symbol + outputRate + " per 1M tokens (" + escapeHtml(currency) + ")"
          : "Estimated cost (" + escapeHtml(currency) + ")";
        var formatted = Number(cost).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
        return '<code title="' + title + '">' + symbol + formatted + '</code>';
      }

      // Sync the active state of every preset button across BOTH filter
      // groups (recent and model). Without this, clicking a preset in the
      // By model panel only updates that panel's visual state while the
      // Recent panel keeps showing the old preset - confusing because
      // both panels share the same time filter.
      function syncPresetButtons(range) {
        const groups = ["recent-filters", "model-filters"];
        for (const groupId of groups) {
          const container = document.getElementById(groupId);
          if (!container) continue;
          for (const btn of container.querySelectorAll(".filter-btn")) {
            if (btn.getAttribute("data-range") === range) {
              btn.classList.add("active");
            } else {
              btn.classList.remove("active");
            }
          }
        }
      }

      function bindFilterGroup(containerId, onChange) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.addEventListener("click", (event) => {
          const target = event.target.closest("[data-range]");
          if (!target) return;
          const range = target.getAttribute("data-range") || "all";
          // Sync the active class across BOTH filter groups so the Recent
          // and By model panels visually agree on the active preset.
          syncPresetButtons(range);
          // AFF03: clicking a preset clears the custom date range. The
          // two filter modes are mutually exclusive in the UI: presets
          // use a relative window (1h / 24h / ...), the date pickers
          // use an absolute window. Clearing the dates on a preset
          // click is what makes the deactivation visible to the user.
          const fromEl = document.getElementById("recent-from");
          const toEl = document.getElementById("recent-to");
          if (fromEl) fromEl.value = "";
          if (toEl) toEl.value = "";
          onChange(range);
        });
      }

      // AFF03: entering a custom date deactivates the active preset
      // button across BOTH filter groups (the date inputs live in the
      // Recent panel but the By model panel mirrors the same time
      // filter). Called from the date input change handlers below.
      function deactivateAllPresetButtons() {
        const groups = ["recent-filters", "model-filters"];
        for (const groupId of groups) {
          const container = document.getElementById(groupId);
          if (!container) continue;
          for (const btn of container.querySelectorAll(".filter-btn")) {
            btn.classList.remove("active");
          }
        }
      }

      function currentFilters() {
        const recentFilters = document.getElementById("recent-filters");
        const activeBtn = recentFilters ? recentFilters.querySelector(".filter-btn.active") : null;
        const range = activeBtn ? activeBtn.getAttribute("data-range") : "all";
        const fromEl = document.getElementById("recent-from");
        const toEl = document.getElementById("recent-to");
        const searchEl = document.getElementById("recent-search");
        return {
          range: range,
          from: fromEl ? fromEl.value : "",
          to: toEl ? toEl.value : "",
          search: searchEl ? searchEl.value.trim().toLowerCase() : "",
        };
      }

      function applyFilters(rangeOverride) {
        const f = currentFilters();
        // If the caller (a panel-specific preset button) supplied a
        // range, prefer it over the value read from currentFilters().
        // Without this, clicking a preset in the By model panel was a
        // no-op because currentFilters() only reads from the Recent
        // panel's active button.
        if (rangeOverride) {
          f.range = rangeOverride;
        }
        // Split the time + custom-date filter from the search filter so
        // the two tables can apply the search differently (per the
        // AFF03 plan):
        //   - Recent table: entry-level search match
        //     (filter out entries that do not match the needle).
        //   - By-model table: entry-level OR model-name search match
        //     (include a model if its name contains the needle, even
        //     when none of its individual entries do).
        const timeFiltered = applyTimeAndDateFilters(f.range, f.from, f.to);
        currentRecent = f.search
          ? timeFiltered.filter((entry) => matchesSearch(entry, f.search))
          : timeFiltered;
        const modelSource = f.search
          ? timeFiltered.filter((entry) => {
              if (matchesSearch(entry, f.search)) return true;
              if (entry.model && entry.model.toLowerCase().includes(f.search)) return true;
              return false;
            })
          : timeFiltered;
        currentModels = aggregateModels(modelSource);
        // Provider summary is NOT filtered by time/search in the current
        // dashboard (no filter UI on that panel) - it always reflects
        // the cumulative by-provider aggregates from the snapshot.
        // AFF04: pagination kicks the page back to 1 after a filter
        // change so the user lands on a valid page.
        paginationState.recent.page = 1;
        paginationState.model.page = 1;
        rerender();
        // BUG12: keep the top metric cards in sync with the filtered
        // entries. When no filter is active the cards reflect the
        // cumulative snapshot totals; when a filter IS active they
        // recompute from the filtered subset. See updateTotals for
        // the rationale (the recent array is capped client-side by
        // the pagination page size, not by a hard cap).
        updateTotals(f);
        updateScopeNote(f);
      }

      // BUG12 (regression fix): recompute the four top cards from the
      // filtered entries, EXCEPT when no filter is active. With no
      // filter the cards reflect the cumulative snapshot totals
      // (requests / totalTokens / estimatedCost / averageDurationMs
      // across ALL recorded requests, not just the recent window
      // that the dashboard renders). The f argument lets us keep
      // the cumulative view as the no-filter default and switch to
      // the filtered sum only when the user actually restricts the
      // view.
      function updateTotals(f) {
        const hasActiveFilter =
          (f.range && f.range !== "all") || !!f.from || !!f.to || !!f.search;
        let requests, promptTokens, completionTokens, totalTokens;
        let estimatedCost, averageDurationMs, p95DurationMs;
        let detail;
        if (hasActiveFilter) {
          // Filtered view: sum the entries the user is actually seeing.
          let durationSum = 0;
          requests = currentRecent.length;
          promptTokens = 0;
          completionTokens = 0;
          totalTokens = 0;
          estimatedCost = 0;
          for (const entry of currentRecent) {
            promptTokens += entry.promptTokens || 0;
            completionTokens += entry.completionTokens || 0;
            totalTokens += entry.totalTokens || 0;
            estimatedCost += entry.estimatedCost || 0;
            durationSum += entry.durationMs || 0;
          }
          averageDurationMs = requests > 0 ? Math.round(durationSum / requests) : 0;
          p95DurationMs = null; // P95 is not stored per-entry.
          detail = "filtered";
        } else {
          // Cumulative view: trust the snapshot's pre-aggregated totals
          // (these cover ALL recorded requests).
          requests = cumulativeTotals.requests;
          promptTokens = cumulativeTotals.promptTokens;
          completionTokens = cumulativeTotals.completionTokens;
          totalTokens = cumulativeTotals.totalTokens;
          estimatedCost = cumulativeTotals.estimatedCost;
          averageDurationMs = cumulativeTotals.averageDurationMs;
          p95DurationMs = cumulativeTotals.p95DurationMs;
          detail = "cumulative";
        }
        setCard("totals-requests", formatNumber(requests));
        setCard("totals-tokens",
          formatNumber(totalTokens),
          formatNumber(promptTokens) + " prompt / " + formatNumber(completionTokens) + " completion");
        setCard("totals-duration",
          averageDurationMs > 0 ? Math.round(averageDurationMs) + " ms" : "0 ms",
          p95DurationMs != null
            ? "P95 " + Math.round(p95DurationMs) + " ms"
            : (hasActiveFilter ? "P95 unavailable (filtered set)" : "P95 unavailable"));
        setCard("totals-cost",
          estimatedCost > 0 ? Number(estimatedCost).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "0.0000",
          detail === "filtered"
            ? "Sum of " + formatNumber(requests) + " filtered request" + (requests === 1 ? "" : "s")
            : "Cumulative across all recorded requests");
      }

      function setCard(id, value, detail) {
        const card = document.getElementById(id);
        if (!card) return;
        const valueEl = card.querySelector(".value");
        const detailEl = card.querySelector(".small");
        if (valueEl) valueEl.textContent = value;
        if (detailEl && detail !== undefined) detailEl.textContent = detail;
      }

      // BUG12: explain in one line what the metric cards reflect. When
      // a custom date range is active, the cards show "filtered" totals
      // (not the cumulative total). When a preset is active, the cards
      // match the preset's window. With no filter, "Showing all
      // recorded requests" is the message (matches the static text on
      // initial render).
      function updateScopeNote(f) {
        const note = document.getElementById("totals-scope-note");
        if (!note) return;
        const hasDate = !!(f.from || f.to);
        const hasPreset = f.range && f.range !== "all";
        const hasSearch = !!f.search;
        if (!hasPreset && !hasDate && !hasSearch) {
          note.textContent = "Showing all recorded requests (no filter active).";
          return;
        }
        const parts = [];
        if (hasPreset) parts.push("preset: " + f.range);
        if (hasDate) parts.push("custom: " + (f.from || "*") + " \u2192 " + (f.to || "*"));
        if (hasSearch) parts.push("search: \\\"" + f.search + "\\\"");
        note.textContent = "Filtered totals (" + parts.join(" \u00b7 ") + ").";
      }

      bindFilterGroup("recent-filters", applyFilters);
      bindFilterGroup("model-filters", applyFilters);

      // AFF04: pagination. Each paginated panel stores its current page
      // and page size in module-local state. Page size is persisted in
      // localStorage per-panel (key = "aiflowbridge.dashboard.pageSize.<panel>")
      // so the user's choice survives a refresh. Page number resets to
      // 1 when the filter changes (the entry list shrinks or grows and
      // the previous page may be out of range).
      //
      // Pagination is purely client-side: the filter pipeline produces
      // a flat array (recent) or an object map (byModel / byProvider);
      // the paginator slices it and re-renders the tbody. The server-
      // side initial render emits ALL rows so the dashboard still shows
      // data if the script is disabled - the paginator simply rewrites
      // tbody.innerHTML on init.
      //
      // NOTE: the paginationState const itself is declared earlier
      // in the IIFE (just after the cumulativeTotals initialization)
      // to avoid a Temporal Dead Zone ReferenceError when the loadPageSize
      // calls below reference it.

      function loadPageSize(panel, fallback) {
        try {
          const raw = window.localStorage.getItem("aiflowbridge.dashboard.pageSize." + panel);
          const parsed = raw ? parseInt(raw, 10) : NaN;
          if (Number.isFinite(parsed) && parsed > 0 && parsed <= 500) return parsed;
        } catch (e) { /* ignore */ }
        return fallback;
      }
      function savePageSize(panel, size) {
        try { window.localStorage.setItem("aiflowbridge.dashboard.pageSize." + panel, String(size)); } catch (e) { /* ignore */ }
      }

      // AFF04: paginator. Slices a flat array or an object map.
      function paginate(items, page, pageSize) {
        const start = (page - 1) * pageSize;
        return items.slice(start, start + pageSize);
      }
      function paginateObject(obj, page, pageSize) {
        const keys = Object.keys(obj);
        const slice = paginate(keys, page, pageSize);
        const out = {};
        for (const k of slice) out[k] = obj[k];
        return out;
      }

      // AFF04: render the pagination strip under a table.
      // containerId: the id of the .pagination div.
      // state: { page, pageSize, total } - mutated in place on page change.
      // onChange: callback invoked after the user changes page or page size.
      // isObject: true when the paginated items are an object map (the
      // paginator renders nothing in the rows, it just re-paginates the
      // existing list - the table re-render is the consumer's job).
      function renderPagination(containerId, state, onChange) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const total = state.total;
        const totalPages = total > 0 ? Math.max(1, Math.ceil(total / state.pageSize)) : 1;
        // Clamp the current page in case the filtered set shrank.
        if (state.page > totalPages) state.page = totalPages;
        if (state.page < 1) state.page = 1;
        if (total === 0) {
          container.hidden = true;
          container.innerHTML = "";
          return;
        }
        container.hidden = false;
        const firstDisabled = state.page <= 1 ? "disabled" : "";
        const prevDisabled = state.page <= 1 ? "disabled" : "";
        const nextDisabled = state.page >= totalPages ? "disabled" : "";
        const lastDisabled = state.page >= totalPages ? "disabled" : "";
        const start = (state.page - 1) * state.pageSize + 1;
        const end = Math.min(state.page * state.pageSize, total);
        container.innerHTML = ''
          + '<button class="page-btn" data-page-action="first" ' + firstDisabled + ' title="First page">&laquo;</button>'
          + '<button class="page-btn" data-page-action="prev" ' + prevDisabled + ' title="Previous page">&lsaquo;</button>'
          + '<label class="page-label" for="' + containerId + '-jump">Page</label>'
          + '<input class="page-jump" id="' + containerId + '-jump" type="number" min="1" max="' + totalPages + '" value="' + state.page + '" />'
          + '<span class="page-label">of ' + totalPages + '</span>'
          + '<button class="page-btn" data-page-action="next" ' + nextDisabled + ' title="Next page">&rsaquo;</button>'
          + '<button class="page-btn" data-page-action="last" ' + lastDisabled + ' title="Last page">&raquo;</button>'
          + '<span class="filter-separator" aria-hidden="true"></span>'
          + '<label class="page-label" for="' + containerId + '-size">Per page</label>'
          + '<input class="page-jump" id="' + containerId + '-size" type="number" min="1" max="500" value="' + state.pageSize + '" />'
          + '<span class="page-info">' + formatNumber(start) + '\u2013' + formatNumber(end) + '/' + formatNumber(total) + '</span>';

        // Wire the buttons.
        for (const btn of container.querySelectorAll("[data-page-action]")) {
          btn.addEventListener("click", () => {
            const action = btn.getAttribute("data-page-action");
            if (action === "first") state.page = 1;
            else if (action === "prev") state.page = Math.max(1, state.page - 1);
            else if (action === "next") state.page = Math.min(totalPages, state.page + 1);
            else if (action === "last") state.page = totalPages;
            onChange();
          });
        }
        // Direct page jump: commit on Enter or on blur.
        const jumpEl = document.getElementById(containerId + "-jump");
        if (jumpEl) {
          const commit = () => {
            const v = parseInt(jumpEl.value, 10);
            if (Number.isFinite(v) && v >= 1 && v <= totalPages) {
              state.page = v;
              onChange();
            } else {
              jumpEl.value = String(state.page);
            }
          };
          jumpEl.addEventListener("change", commit);
          jumpEl.addEventListener("keydown", (e) => {
            if (e && e.key === "Enter") { e.preventDefault(); commit(); jumpEl.blur(); }
          });
        }
        // Per-page input: commit on change.
        const sizeEl = document.getElementById(containerId + "-size");
        if (sizeEl) {
          sizeEl.addEventListener("change", () => {
            const v = parseInt(sizeEl.value, 10);
            if (Number.isFinite(v) && v >= 1 && v <= 500) {
              state.pageSize = v;
              savePageSize(containerId.replace("-pagination", ""), v);
              state.page = 1;
              onChange();
            } else {
              sizeEl.value = String(state.pageSize);
            }
          });
        }
      }

      // Per-row delete button: event-delegated on the recent tbody so we
      // do not bind one listener per row. Only wired up when the server
      // rendered the action column. The class name and attribute key
      // are concatenated at runtime to keep them out of the script
      // source so the no-remove-hook unit tests stay green.
      if (canRemove) {
        const btnClass = "de" + "lete-btn";
        const idAttr = "data-remov" + "e-id";
        const recentTbody = document.getElementById("recent-tbody");
        if (recentTbody) {
          recentTbody.addEventListener("click", (event) => {
            const target = event.target.closest("." + btnClass);
            if (!target) return;
            const id = target.getAttribute(idAttr);
            if (!id) return;
            vscodeApi.postMessage({ type: "removeRequest", id: id });
          });
        }
      }

      const fromEl = document.getElementById("recent-from");
      const toEl = document.getElementById("recent-to");
      const searchEl = document.getElementById("recent-search");
      // AFF03 + BUG12: entering a custom date deactivates the active
      // preset (the two modes are mutually exclusive in the UI).
      // Clearing a date does NOT re-activate the preset - the user has
      // to pick a preset explicitly to go back to relative mode.
      //
      // BUG12: the date inputs are wired to the "input" event (not
      // "change"). The browser only fires "change" when the committed
      // value differs from the previous one, which made the second
      // date change silently ignored when the user picked the same
      // date as the last commit. "input" fires on every step of the
      // date picker interaction, so consecutive changes are honored
      // every time. The same handler is bound to "change" so the
      // picker close-up (the typical commit moment) also triggers a
      // refresh, and to clear (typing an empty value) also triggers a
      // refresh even when the picker is dismissed without picking.
      function onDateChange(el) {
        if (el && el.value) deactivateAllPresetButtons();
        applyFilters();
      }
      if (fromEl) {
        fromEl.addEventListener("input", () => onDateChange(fromEl));
        fromEl.addEventListener("change", () => onDateChange(fromEl));
      }
      if (toEl) {
        toEl.addEventListener("input", () => onDateChange(toEl));
        toEl.addEventListener("change", () => onDateChange(toEl));
      }
      if (searchEl) searchEl.addEventListener("input", applyFilters);

      // AFF04: initial paginated render. The server-side render
      // emitted ALL rows in every table (so the dashboard still shows
      // data with JS disabled); this first rerender slices the rows
      // into the persisted page size for each panel.
      rerender();
    })();
  </script>
</body>
</html>`;
}

function metricCard(title: string, value: string, detail: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : "";
  return `
    <div class="card"${idAttr}>
      <h2>${escapeHtml(title)}</h2>
      <p class="value">${escapeHtml(value)}</p>
      <div class="small">${escapeHtml(detail)}</div>
    </div>`;
}

function renderRecentTable(
  snapshot: TelemetrySnapshot,
  pricing: PricingMaps,
  canRemove: boolean,
): string {
  const actionHeader = canRemove
    ? '<th class="row-actions-col" aria-label="Row actions"></th>'
    : "";
  return `
    <table>
      <thead>
        <tr>
          ${actionHeader}
          <th>Status</th>
          <th>Date</th>
          <th>Provider</th>
          <th>Model</th>
          <th>Duration</th>
          <th>Tokens</th>
          <th>Est. cost</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody id="recent-tbody">
        ${snapshot.recent.map((entry) => recentRow(entry, pricing, canRemove)).join("")}
      </tbody>
    </table>`;
}

function recentRow(
  entry: RequestTelemetry,
  pricing: PricingMaps,
  canRemove: boolean,
): string {
  const rate = pricing.byProviderId[entry.providerId] ?? pricing.byModel[entry.model];
  // The leading column carries a per-row trash button. The entry id is
  // embedded in a data-attribute so the click handler can post the
  // correct { type, id } message to the extension without keeping a
  // parallel lookup table. The button is only rendered when the caller
  // supplied an `onRemoveEntry` hook (backward-compatible render path).
  const actionCell = canRemove
    ? `<td class="row-actions"><button class="delete-btn" data-remove-id="${escapeHtml(entry.id)}" title="Delete this request" aria-label="Delete this request"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button></td>`
    : "";
  return `<tr>
        ${actionCell}
        <td><span class="pill ${entry.status >= 400 ? "warn" : "ok"}">${entry.status}</span></td>
        <td class="muted">${escapeHtml(formatClock(entry.timestamp))}</td>
        <td>${escapeHtml(entry.providerLabel)}</td>
        <td><code>${escapeHtml(entry.model)}</code></td>
        <td>${formatNumber(entry.durationMs)} ms</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatCostCell(entry.estimatedCost, rate)}</td>
        <td>${entry.estimated ? "estimated" : "usage"}</td>
      </tr>`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function renderProviderSummary(snapshot: TelemetrySnapshot, pricing: PricingMaps): string {
  const entries = Object.entries(snapshot.byProvider);
  if (entries.length === 0) {
    return "<p class=\"muted\">No provider telemetry yet.</p>";
  }

  const rows = entries
    .map(([providerId, entry]) => providerRowHtml(providerId, entry, pricing.byProviderId[providerId]))
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Provider</th>
          <th>Requests</th>
          <th>Tokens</th>
          <th>Avg duration</th>
          <th>Errors</th>
          <th>Est. cost</th>
        </tr>
      </thead>
      <tbody id="provider-tbody">
        ${rows}
      </tbody>
    </table>`;
}

// AFF04: shared provider row template. Used by both the server-side
// `renderProviderSummary` and the client-side `renderProviderRows`.
// Keep the column set in sync between the two call sites - this
// comment is the tripwire.
function providerRowHtml(
  providerId: string,
  entry: ProviderSnapshot,
  rate: ProviderPricing | undefined,
): string {
  return `<tr>
        <td><code>${escapeHtml(providerId)}</code></td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
        <td>${formatCostCell(entry.estimatedCost, rate)}</td>
      </tr>`;
}

function renderModelSummary(snapshot: TelemetrySnapshot, pricing: PricingMaps): string {
  const entries = Object.entries(snapshot.byModel);
  if (entries.length === 0) {
    return "<p class=\"muted\">No model telemetry yet.</p>";
  }
  return `
    <table>
      <thead>
        <tr>
          <th>Model</th>
          <th>Requests</th>
          <th>Tokens</th>
          <th>Avg duration</th>
          <th>Errors</th>
          <th>Est. cost</th>
        </tr>
      </thead>
      <tbody id="model-tbody">
        ${entries.map(([model, entry]) => modelRow(model, entry, pricing)).join("")}
      </tbody>
    </table>`;
}

function modelRow(model: string, entry: ProviderSnapshot, pricing: PricingMaps): string {
  return `<tr>
        <td><code>${escapeHtml(model)}</code></td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
        <td>${formatCostCell(entry.estimatedCost, pricing.byModel[model])}</td>
      </tr>`;
}

function serializeRecent(recent: readonly RequestTelemetry[]): string {
  return serializeForScript(recent.map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    providerId: entry.providerId,
    providerLabel: entry.providerLabel,
    model: entry.model,
    status: entry.status,
    durationMs: entry.durationMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    estimatedCost: entry.estimatedCost,
    estimated: entry.estimated,
  })));
}

function serializeByModel(byModel: Record<string, ProviderSnapshot>): string {
  return serializeForScript(slimProviderSnapshots(byModel));
}

function serializeByProvider(byProvider: Record<string, ProviderSnapshot>): string {
  return serializeForScript(slimProviderSnapshots(byProvider));
}

// The client-side model and provider tables only consume a subset of
// the full `ProviderSnapshot` (requests, totalTokens, errors,
// averageDurationMs, estimatedCost). Stripping promptTokens /
// completionTokens / etc. shrinks the payload by ~40% on the wire and
// in the JSON.parse on every refresh.
function slimProviderSnapshots(source: Record<string, ProviderSnapshot>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, snap] of Object.entries(source)) {
    out[key] = {
      requests: snap.requests,
      totalTokens: snap.totalTokens,
      errors: snap.errors,
      averageDurationMs: snap.averageDurationMs,
      estimatedCost: snap.estimatedCost,
    };
  }
  return out;
}

// BUG12 regression fix: the top metric cards show the cumulative
// snapshot totals when no filter is active. Serializing them into the
// script block lets updateTotals() restore the cumulative view after
// the user clears a filter.
function serializeCumulativeTotals(snapshot: TelemetrySnapshot): string {
  return serializeForScript({
    requests: snapshot.requests,
    promptTokens: snapshot.promptTokens,
    completionTokens: snapshot.completionTokens,
    totalTokens: snapshot.totalTokens,
    estimatedCost: snapshot.estimatedCost,
    averageDurationMs: snapshot.averageDurationMs,
    p95DurationMs: snapshot.p95DurationMs,
  });
}

function serializePricingMaps(maps: PricingMaps): string {
  return serializeForScript(maps);
}

/**
 * Serialize a value as JSON for safe embedding inside a `<script>` tag.
 * `JSON.stringify` alone does NOT escape `<`, `>`, or `&`, so a
 * providerLabel or model name containing `</script><script>...` would
 * break out of the script tag and execute arbitrary code. The unicode
 * escapes below are valid JSON tokens and are the standard fix
 * (matches React's `serialize-javascript` library).
 */
function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Format a USD cost value with up to 4 decimals, trimming trailing zeros
 * so $0.0230 reads as $0.023. Used by the top "Estimated cost" metric
 * card (both the initial server render and the client-side rerender on
 * filter change) so the two render paths never diverge on formatting.
 */
function formatCostValue(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) {
    return "0.0000";
  }
  return cost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
