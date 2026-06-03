import * as vscode from "vscode";
import type { AiFlowBridgeConfig, ProviderSnapshot, RequestTelemetry, TelemetrySnapshot } from "../types";

let currentPanel: vscode.WebviewPanel | undefined;

export type SnapshotGetter = () => TelemetrySnapshot;
export type RunningGetter = () => boolean;

export function showMetricsDashboard(
  config: AiFlowBridgeConfig,
  getSnapshot: SnapshotGetter,
  isRunning: RunningGetter,
): void {
  if (currentPanel) {
    currentPanel.webview.html = buildHtml(config, getSnapshot(), isRunning());
    currentPanel.reveal(vscode.ViewColumn.One);
    attachMessageHandler(currentPanel, config, getSnapshot, isRunning);
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

  currentPanel.webview.html = buildHtml(config, getSnapshot(), isRunning());
  attachMessageHandler(currentPanel, config, getSnapshot, isRunning);
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });
}

function attachMessageHandler(
  panel: vscode.WebviewPanel,
  config: AiFlowBridgeConfig,
  getSnapshot: SnapshotGetter,
  isRunning: RunningGetter,
): void {
  panel.webview.onDidReceiveMessage((message: unknown) => {
    if (message && typeof message === "object" && (message as { type?: unknown }).type === "refresh") {
      panel.webview.html = buildHtml(config, getSnapshot(), isRunning());
    }
  });
}

function buildHtml(config: AiFlowBridgeConfig, snapshot: TelemetrySnapshot, running: boolean): string {
  return buildDashboardHtml(config, snapshot, running);
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
): string {
  const providers = config.providers.filter((provider) => provider.enabled);
  const entries = Object.entries(snapshot.byModel);
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
    .filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
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
      </div>
      <div class="badge" id="gateway-badge">${running ? "Gateway running" : "Gateway stopped"} · ${escapeHtml(config.gateway.baseUrl)}</div>
    </div>

    <div class="grid" id="totals">
      ${metricCard("Requests", formatNumber(snapshot.requests), `${providers.length} enabled provider${providers.length === 1 ? "" : "s"}`)}
      ${metricCard("Tokens", formatNumber(snapshot.totalTokens), `${formatNumber(snapshot.promptTokens)} prompt / ${formatNumber(snapshot.completionTokens)} completion`)}
      ${metricCard("Duration", snapshot.averageDurationMs ? `${Math.round(snapshot.averageDurationMs)} ms` : "0 ms", `P95 ${Math.round(snapshot.p95DurationMs)} ms`)}
      ${metricCard("Estimated cost", snapshot.estimatedCost ? snapshot.estimatedCost.toFixed(4) : "0.0000", "Optional pricing only")}
    </div>

    <div class="panel">
      <h2>Gateway</h2>
      <p class="muted">Port: <code>${config.gateway.port}</code> · Default model: <code>${escapeHtml(config.gateway.defaultModel || "none")}</code></p>
      <p class="muted">Upstream providers are configured as logical aliases for unified access.</p>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Recent requests</h2>
        <div class="filters" id="recent-filters">
          <button class="filter-btn active" data-range="all">All</button>
          <button class="filter-btn" data-range="1h">Last 1h</button>
          <button class="filter-btn" data-range="24h">Last 24h</button>
          <button class="filter-btn" data-range="7d">Last 7 days</button>
          <button class="filter-btn" data-range="30d">Last 30 days</button>
        </div>
      </div>
      ${snapshot.recent.length === 0 ? "<p class=\"muted\">No request recorded yet.</p>" : renderRecentTable(snapshot)}
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>By model</h2>
        <div class="filters" id="model-filters">
          <button class="filter-btn active" data-range="all">All</button>
          <button class="filter-btn" data-range="1h">Last 1h</button>
          <button class="filter-btn" data-range="24h">Last 24h</button>
          <button class="filter-btn" data-range="7d">Last 7 days</button>
          <button class="filter-btn" data-range="30d">Last 30 days</button>
        </div>
      </div>
      ${entries.length === 0 ? "<p class=\"muted\">No model telemetry yet.</p>" : renderModelSummary(snapshot)}
    </div>

    <div class="panel">
      <h2>Provider summary</h2>
      ${renderProviderSummary(snapshot)}
    </div>

    <div class="footer">Refresh the dashboard after a few calls to see request patterns, latency, and estimated usage.</div>
  </div>

  <script>
    (function() {
      const vscodeApi = acquireVsCodeApi();

      const refreshButton = document.getElementById("refresh-button");
      if (refreshButton) {
        refreshButton.addEventListener("click", () => {
          // Brief visual feedback: the page will be replaced almost
          // immediately by the new HTML from the extension. A safety
          // timeout removes the spin class in case the message handler
          // is delayed or the page does not reload for any reason.
          refreshButton.classList.add("spinning");
          window.setTimeout(() => {
            refreshButton.classList.remove("spinning");
          }, 1500);
          vscodeApi.postMessage({ type: "refresh" });
        });
      }

      const recent = ${serializeRecent(snapshot.recent)};
      const byModel = ${serializeByModel(snapshot.byModel)};

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

      function renderRecent(filtered) {
        const tbody = document.getElementById("recent-tbody");
        if (!tbody) return;
        if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center; padding:24px;">No requests in this range.</td></tr>';
          return;
        }
        tbody.innerHTML = filtered.map((entry) => {
          const ts = new Date(entry.timestamp);
          const tsText = ts.toLocaleString();
          const statusClass = entry.status >= 400 ? "warn" : "ok";
          return '<tr>' +
            '<td><span class="pill ' + statusClass + '">' + entry.status + '</span></td>' +
            '<td class="muted" title="' + tsText + '">' + formatTime(ts) + '</td>' +
            '<td>' + escapeHtml(entry.providerLabel) + '</td>' +
            '<td><code>' + escapeHtml(entry.model) + '</code></td>' +
            '<td>' + formatNumber(entry.durationMs) + ' ms</td>' +
            '<td>' + formatNumber(entry.totalTokens) + '</td>' +
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
          '</tr>';
        });
        tbody.innerHTML = rows.length > 0 ? rows.join("") : '<tr><td colspan="5" class="muted" style="text-align:center; padding:24px;">No data in this range.</td></tr>';
      }

      function aggregateModels(filtered) {
        const map = new Map();
        for (const entry of filtered) {
          const existing = map.get(entry.model) || { model: entry.model, requests: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, errors: 0, durationSum: 0 };
          existing.requests += 1;
          existing.totalTokens += entry.totalTokens || 0;
          existing.promptTokens += entry.promptTokens || 0;
          existing.completionTokens += entry.completionTokens || 0;
          existing.errors += entry.status >= 400 ? 1 : 0;
          existing.durationSum += entry.durationMs || 0;
          map.set(entry.model, existing);
        }
        const result = {};
        for (const [model, snap] of map) {
          result[model] = {
            requests: snap.requests,
            totalTokens: snap.totalTokens,
            errors: snap.errors,
            averageDurationMs: snap.requests > 0 ? snap.durationSum / snap.requests : 0,
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

      function bindFilterGroup(containerId, onChange) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.addEventListener("click", (event) => {
          const target = event.target.closest("[data-range]");
          if (!target) return;
          for (const btn of container.querySelectorAll(".filter-btn")) btn.classList.remove("active");
          target.classList.add("active");
          onChange(target.getAttribute("data-range"));
        });
      }

      function applyFilters(range) {
        const filtered = filterByRange(recent, range);
        renderRecent(filtered);
        renderModelSummary(aggregateModels(filtered));
      }

      bindFilterGroup("recent-filters", applyFilters);
      bindFilterGroup("model-filters", applyFilters);
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

function renderRecentTable(snapshot: TelemetrySnapshot): string {
  return `
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Time</th>
          <th>Provider</th>
          <th>Model</th>
          <th>Duration</th>
          <th>Tokens</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody id="recent-tbody">
        ${snapshot.recent.map((entry) => recentRow(entry)).join("")}
      </tbody>
    </table>`;
}

function recentRow(entry: RequestTelemetry): string {
  return `<tr>
        <td><span class="pill ${entry.status >= 400 ? "warn" : "ok"}">${entry.status}</span></td>
        <td class="muted">${escapeHtml(formatClock(entry.timestamp))}</td>
        <td>${escapeHtml(entry.providerLabel)}</td>
        <td><code>${escapeHtml(entry.model)}</code></td>
        <td>${formatNumber(entry.durationMs)} ms</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${entry.estimated ? "estimated" : "usage"}</td>
      </tr>`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function renderProviderSummary(snapshot: TelemetrySnapshot): string {
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
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
}

function renderModelSummary(snapshot: TelemetrySnapshot): string {
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
        </tr>
      </thead>
      <tbody id="model-tbody">
        ${entries.map(([model, entry]) => modelRow(model, entry)).join("")}
      </tbody>
    </table>`;
}

function modelRow(model: string, entry: ProviderSnapshot): string {
  return `<tr>
        <td><code>${escapeHtml(model)}</code></td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
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
    estimated: entry.estimated,
  })));
}

function serializeByModel(byModel: Record<string, ProviderSnapshot>): string {
  return JSON.stringify(byModel);
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
