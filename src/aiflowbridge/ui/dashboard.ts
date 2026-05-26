import * as vscode from "vscode";
import type { AiFlowBridgeConfig, TelemetrySnapshot } from "../types.js";

let currentPanel: vscode.WebviewPanel | undefined;

export function showMetricsDashboard(
  config: AiFlowBridgeConfig,
  snapshot: TelemetrySnapshot,
  running: boolean,
): void {
  if (currentPanel) {
    currentPanel.webview.html = buildHtml(config, snapshot, running);
    currentPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    "aiflowbridgeMetrics",
    "AIFlowBridge Metrics",
    vscode.ViewColumn.One,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    },
  );

  currentPanel.webview.html = buildHtml(config, snapshot, running);
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });
}

function buildHtml(config: AiFlowBridgeConfig, snapshot: TelemetrySnapshot, running: boolean): string {
  const providers = config.providers.filter((provider) => provider.enabled);
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
        <h1 class="title">AIFlowBridge Metrics</h1>
        <p class="subtitle">Multi-provider AI coding assistant with transparent vision proxy and usage metrics.</p>
      </div>
      <div class="badge">${running ? "Gateway running" : "Gateway stopped"} · ${escapeHtml(config.gateway.baseUrl)}</div>
    </div>

    <div class="grid">
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
      <h2>Recent requests</h2>
      ${snapshot.recent.length === 0 ? "<p class=\"muted\">No request recorded yet.</p>" : renderRecentTable(snapshot)}
    </div>

    <div class="panel">
      <h2>Provider summary</h2>
      ${renderProviderSummary(snapshot)}
    </div>

    <div class="footer">Refresh the dashboard after a few calls to see request patterns, latency, and estimated usage.</div>
  </div>
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
  const rows = snapshot.recent
    .map((entry) => `
      <tr>
        <td><span class="pill ${entry.status >= 400 ? "warn" : "ok"}">${entry.status}</span></td>
        <td>${escapeHtml(entry.providerLabel)}</td>
        <td><code>${escapeHtml(entry.model)}</code></td>
        <td>${formatNumber(entry.durationMs)} ms</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${entry.estimated ? "estimated" : "usage"}</td>
      </tr>`)
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Provider</th>
          <th>Model</th>
          <th>Duration</th>
          <th>Tokens</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
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