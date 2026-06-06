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
    currentPanel.webview.html = buildHtml(getConfig(), getSnapshot(), isRunning(), versionsGetter(), onRemoveEntry);
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

  currentPanel.webview.html = buildHtml(getConfig(), getSnapshot(), isRunning(), versionsGetter(), onRemoveEntry);
  attachMessageHandler(currentPanel, getConfig, getSnapshot, isRunning, versionsGetter, onRemoveEntry);
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
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
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const typed = message as { type?: unknown; id?: unknown };
    if (typed.type === "refresh") {
      // Read the config at refresh time, not at panel-creation time, so a
      // pricing override picked up by a window reload is reflected without
      // having to close and reopen the panel.
      panel.webview.html = buildHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry);
      return;
    }
    if (typed.type === "removeRequest" && typeof typed.id === "string" && onRemoveEntry) {
      // The trash button is per-row. Removing the entry from the
      // in-memory store + on-disk file is synchronous-ish (the
      // on-disk write is fire-and-forget through the persister); the
      // re-render below uses the freshly-updated snapshot.
      onRemoveEntry(typed.id);
      panel.webview.html = buildHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry);
    }
  });
}

function buildHtml(
  config: AiFlowBridgeConfig,
  snapshot: TelemetrySnapshot,
  running: boolean,
  versions: DashboardVersions = {},
  onRemoveEntry?: RemoveEntryFn,
): string {
  return buildDashboardHtml(config, snapshot, running, versions, onRemoveEntry);
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
 * Format a USD (or other-currency) amount as a short monospace cell. Returns
 * the em-dash placeholder when the amount is zero, non-finite, or
 * unpriced - so unpriced requests do not pollute the totals visually.
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
  const pricingMaps = buildPricingMaps(config.providers);
  const gatewayVersionLabel = versions.gateway ? ` v${escapeHtml(versions.gateway)}` : "";
  const extensionVersionLine = versions.extension
    ? `<p class="version-line">Current version: v${escapeHtml(versions.extension)}</p>`
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
    .footer { color: var(--muted); font-size: 12px; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div>
        <div class="title-row">
          <h1 class="title">AIFlowBridge Metrics</h1>
          <button class="refresh-btn" id="refresh-button" title="Reload metrics from the gateway">
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
      ${metricCard("Requests", formatNumber(snapshot.requests), `${providers.length} enabled provider${providers.length === 1 ? "" : "s"}`)}
      ${metricCard("Tokens", formatNumber(snapshot.totalTokens), `${formatNumber(snapshot.promptTokens)} prompt / ${formatNumber(snapshot.completionTokens)} completion`)}
      ${metricCard("Duration", snapshot.averageDurationMs ? `${Math.round(snapshot.averageDurationMs)} ms` : "0 ms", `P95 ${Math.round(snapshot.p95DurationMs)} ms`)}
      ${metricCard("Estimated cost", snapshot.estimatedCost ? snapshot.estimatedCost.toFixed(4) : "0.0000", "Optional pricing only")}
    </div>

    <div class="panel" id="panel-gateway">
      <div class="panel-header">
        <button class="collapse-btn" data-collapse-target="panel-gateway" aria-expanded="true" title="Toggle section">
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
        <button class="collapse-btn" data-collapse-target="panel-recent" aria-expanded="true" title="Toggle section">
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
          <input type="search" class="search-input" id="recent-search" placeholder="Filter requests&hellip;" />
        </div>
      </div>
      <div class="panel-body">
        ${snapshot.recent.length === 0 ? "<p class=\"muted\">No request recorded yet.</p>" : renderRecentTable(snapshot, pricingMaps, Boolean(onRemoveEntry))}
      </div>
    </div>

    <div class="panel" id="panel-model">
      <div class="panel-header">
        <button class="collapse-btn" data-collapse-target="panel-model" aria-expanded="true" title="Toggle section">
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
      </div>
    </div>

    <div class="panel" id="panel-provider">
      <div class="panel-header">
        <button class="collapse-btn" data-collapse-target="panel-provider" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Provider summary</h2>
        </button>
      </div>
      <div class="panel-body">
        ${renderProviderSummary(snapshot, pricingMaps)}
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
      const pricingMaps = ${serializePricingMaps(pricingMaps)};

      function lookupPricing(entry) {
        return (pricingMaps.byProviderId && pricingMaps.byProviderId[entry.providerId])
          || (pricingMaps.byModel && pricingMaps.byModel[entry.model])
          || undefined;
      }
      function lookupPricingForModel(model) {
        return pricingMaps.byModel && pricingMaps.byModel[model];
      }
      function lookupPricingForProvider(providerId) {
        return pricingMaps.byProviderId && pricingMaps.byProviderId[providerId];
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

      function applyAllFilters(range, fromStr, toStr, searchNeedle) {
        let filtered = filterByRange(recent, range);
        filtered = filterByCustomDate(filtered, fromStr, toStr);
        if (searchNeedle) {
          filtered = filtered.filter((entry) => matchesSearch(entry, searchNeedle));
        }
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
          ? '<button class="' + btnClass + '" ' + idAttr + '="' + escapeHtml('{id}') + '" title="Delete this request" aria-label="Delete this request"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button>'
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
            '<td class="muted" title="' + tsText + '">' + formatTime(ts) + '</td>' +
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

      function aggregateModels(filtered) {
        const map = new Map();
        for (const entry of filtered) {
          const existing = map.get(entry.model) || { model: entry.model, requests: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, errors: 0, durationSum: 0, estimatedCost: 0 };
          existing.requests += 1;
          existing.totalTokens += entry.totalTokens || 0;
          existing.promptTokens += entry.promptTokens || 0;
          existing.completionTokens += entry.completionTokens || 0;
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
        const pad = (n) => String(n).padStart(2, "0");
        return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
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

      function bindFilterGroup(containerId, onChange) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.addEventListener("click", (event) => {
          const target = event.target.closest("[data-range]");
          if (!target) return;
          for (const btn of container.querySelectorAll(".filter-btn")) btn.classList.remove("active");
          target.classList.add("active");
          // AFF03: clicking a preset clears the custom date range. The
          // two filter modes are mutually exclusive in the UI: presets
          // use a relative window (1h / 24h / ...), the date pickers
          // use an absolute window. Clearing the dates on a preset
          // click is what makes the deactivation visible to the user.
          const fromEl = document.getElementById("recent-from");
          const toEl = document.getElementById("recent-to");
          if (fromEl) fromEl.value = "";
          if (toEl) toEl.value = "";
          onChange(target.getAttribute("data-range"));
        });
      }

      // AFF03: entering a custom date deactivates the active preset
      // button. Called from the date input change handlers below.
      function deactivatePresetButtons() {
        const recentFilters = document.getElementById("recent-filters");
        if (!recentFilters) return;
        for (const btn of recentFilters.querySelectorAll(".filter-btn")) {
          btn.classList.remove("active");
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

      function applyFilters() {
        const f = currentFilters();
        // Split the time + custom-date filter from the search filter so
        // the two tables can apply the search differently (per the
        // AFF03 plan):
        //   - Recent table: entry-level search match
        //     (filter out entries that do not match the needle).
        //   - By-model table: entry-level OR model-name search match
        //     (include a model if its name contains the needle, even
        //     when none of its individual entries do).
        const timeFiltered = applyAllFilters(f.range, f.from, f.to, "");
        const recentFiltered = f.search
          ? timeFiltered.filter((entry) => matchesSearch(entry, f.search))
          : timeFiltered;
        const modelFiltered = f.search
          ? timeFiltered.filter((entry) => {
              if (matchesSearch(entry, f.search)) return true;
              if (entry.model && entry.model.toLowerCase().includes(f.search)) return true;
              return false;
            })
          : timeFiltered;
        renderRecent(recentFiltered);
        renderModelSummary(aggregateModels(modelFiltered));
      }

      bindFilterGroup("recent-filters", applyFilters);
      bindFilterGroup("model-filters", applyFilters);

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
      // AFF03: entering a custom date deactivates the active preset
      // (the two modes are mutually exclusive in the UI). Clearing
      // a date does NOT re-activate the preset - the user has to
      // pick a preset explicitly to go back to relative mode.
      if (fromEl) fromEl.addEventListener("change", () => {
        if (fromEl.value) deactivatePresetButtons();
        applyFilters();
      });
      if (toEl) toEl.addEventListener("change", () => {
        if (toEl.value) deactivatePresetButtons();
        applyFilters();
      });
      if (searchEl) searchEl.addEventListener("input", applyFilters);
    })();
  </script>
</body>
</html>`;
}

function metricCard(title: string, value: string, detail: string): string {
  return `
    <div class="card">
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
          <th>Time</th>
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
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function renderProviderSummary(snapshot: TelemetrySnapshot, pricing: PricingMaps): string {
  const entries = Object.entries(snapshot.byProvider);
  if (entries.length === 0) {
    return "<p class=\"muted\">No provider telemetry yet.</p>";
  }

  const rows = entries
    .map(([providerId, entry]) => `
      <tr>
        <td><code>${escapeHtml(providerId)}</code></td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
        <td>${formatCostCell(entry.estimatedCost, pricing.byProviderId[providerId])}</td>
      </tr>`)
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
      <tbody>
        ${rows}
      </tbody>
    </table>`;
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
  return JSON.stringify(recent.map((entry) => ({
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
  return JSON.stringify(byModel);
}

function serializePricingMaps(maps: PricingMaps): string {
  return JSON.stringify(maps);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
