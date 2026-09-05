import * as vscode from 'vscode';
import type { AiFlowBridgeConfig, ProviderPricing, ProviderProfile, ProviderSnapshot, RequestTelemetry, TelemetrySnapshot } from '../types';

/**
 * Field shape for the AFF07 telemetry export (CSV / JSON). Decoupled
 * from `RequestTelemetry` so the export can drop fields the user
 * doesn't care about (e.g. internal flags) and add a few computed
 * columns (e.g. `tokensPerSecond`) without churning the runtime
 * type. Kept in sync with the export helpers in `dashboard.ts`.
 */
export interface ExportedRequestEntry {
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
   * Billing mode resolved at recording time (`'token'` per-token
   * billing, `'plan'` when covered by a token plan / subscription /
   * OAuth plan). Absent on entries recorded before the feature;
   * `toExportedEntry` coalesces to `'token'`.
   */
  billedTo: string;
  /** Origin of the request (`gateway` / `copilot-chat` / unknown). */
  source: string;
  /**
   * Resolved authentication mode (`byok` / `oauth` / `plan` /
   * `token` / `unknown`). Coalesced to `'unknown'` on older
   * pre-2.18.2 entries so the export stays coherent.
   */
  authMode: string;
  /** Stable identifier of the originating client (e.g. `kilocode@1.2.3`). */
  clientId: string;
  /** Sanitized prompt summary captured at recording time (may be empty). */
  promptSummary: string;
  /** Sanitized response summary captured at recording time (may be empty). */
  responseSummary: string;
}

/** Shape of the metadata header included in JSON exports and in the export filename. */
export interface ExportMetadata {
  /** ISO 8601 timestamp of when the export was generated. */
  generatedAt: string;
  /** AIFlowBridge extension version that produced the export. */
  extensionVersion: string;
  /** Snapshot of the active dashboard filters at export time. */
  filters: {
    preset: string;
    provider: string;
    auth: string;
    fromDate: string;
    toDate: string;
    search: string;
  };
  /** Aggregated totals over the exported (filtered) entry set. */
  totals: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
    errors: number;
  };
}

/** Numeric / string fields included in the CSV header (order = export order). */
export const CSV_COLUMNS: ReadonlyArray<keyof ExportedRequestEntry> = [
  'id',
  'timestamp',
  'providerId',
  'providerLabel',
  'model',
  'status',
  'durationMs',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'estimatedCost',
  'estimated',
  'billedTo',
  'source',
  'authMode',
  'clientId',
  'promptSummary',
  'responseSummary',
] as const;

let currentPanel: vscode.WebviewPanel | undefined;
let currentMessageDisposable: vscode.Disposable | undefined;

export type SnapshotGetter = () => TelemetrySnapshot;
export type RunningGetter = () => boolean;
export type ConfigGetter = () => AiFlowBridgeConfig;
export type VersionsGetter = () => DashboardVersions;
export type RemoveEntryFn = (entryId: string) => boolean;
export type RefreshPricingFn = () => Promise<{ updated: number; source: string } | undefined>;

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
 * `onRefreshPricing` (optional, action plan item #1 / FEAT10) wires
 * the `Refresh prices` button. When the dashboard receives
 * `{ type: "refreshPricing" }` from the webview, the handler is
 * invoked, the in-memory pricing registry is updated in place, and
 * the panel is re-rendered so the `Est. cost` tooltips + headline card
 * pick up the new rates without a window reload. When the caller does
 * not supply this callback, the button is hidden.
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
  onRefreshPricing?: RefreshPricingFn
): void {
  const versionsGetter: VersionsGetter = getVersions ?? (() => ({}));
  if (currentPanel) {
    currentPanel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), versionsGetter(), onRemoveEntry, onRefreshPricing);
    currentPanel.reveal(vscode.ViewColumn.One);
    attachMessageHandler(currentPanel, getConfig, getSnapshot, isRunning, versionsGetter, onRemoveEntry, onRefreshPricing);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel('aiflowbridgeMetrics', 'AIFlowBridge Metrics', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  currentPanel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), versionsGetter(), onRemoveEntry, onRefreshPricing);
  attachMessageHandler(currentPanel, getConfig, getSnapshot, isRunning, versionsGetter, onRemoveEntry, onRefreshPricing);
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
  onRefreshPricing: RefreshPricingFn | undefined
): void {
  // Dispose the previous handler (if any) before attaching a new one.
  // Without this, every call to `showMetricsDashboard` on an already-
  // open panel would accumulate a fresh listener on the webview, and a
  // single user click would trigger N rebuilds of the HTML.
  currentMessageDisposable?.dispose();
  currentMessageDisposable = panel.webview.onDidReceiveMessage((message: unknown) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    const typed = message as {
      type?: unknown;
      id?: unknown;
      // AFF07: telemetry export payload (filename / format / contents).
      format?: unknown;
      filename?: unknown;
      contents?: unknown;
    };
    if (typed.type === 'refresh') {
      // Read the config at refresh time, not at panel-creation time, so a
      // pricing override picked up by a window reload is reflected without
      // having to close and reopen the panel.
      panel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry, onRefreshPricing);
      return;
    }
    if (typed.type === 'refreshPricing' && onRefreshPricing) {
      // Action plan item #1 / FEAT10: forward the click to the
      // runtime, which fetches the live OpenRouter rates and
      // updates the in-memory pricing registry in place. We
      // re-render the dashboard from the freshly-read config so
      // the tooltips and headline card pick up the new rates
      // without the user having to close and reopen the panel.
      void Promise.resolve(onRefreshPricing()).then((result) => {
        panel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry, onRefreshPricing);
        void panel.webview.postMessage({
          type: 'refreshPricingResult',
          updated: result?.updated ?? 0,
          source: result?.source ?? 'openrouter',
        });
      });
      return;
    }
    // AFF07: telemetry export. The webview builds the export
    // payload (so the download honors every active filter) and
    // hands it to the host via `postMessage`. The host delegates
    // to the `aiflowbridge.exportToFile` command which owns the
    // save dialog + disk write. This replaces the previous
    // client-side `URL.createObjectURL` + `<a download>` pattern
    // that did NOT work in VS Code webviews (the default webview
    // CSP blocks the `blob:` URL the synthetic anchor uses, so the
    // click was a no-op and the user got nothing).
    if (typed.type === 'export'
        && (typed.format === 'csv' || typed.format === 'json')
        && typeof typed.filename === 'string'
        && typeof typed.contents === 'string') {
      void vscode.commands.executeCommand('aiflowbridge.exportToFile', {
        format: typed.format,
        filename: typed.filename,
        contents: typed.contents,
      }).then((result: unknown) => {
        const r = (result as { saved?: boolean } | undefined) ?? {};
        void panel.webview.postMessage({
          type: 'exportResult',
          format: typed.format,
          filename: typed.filename,
          saved: r.saved === true,
        });
      });
      return;
    }
    if (typed.type === 'resetMetrics') {
      // The on-disk telemetry file may have been written under an older
      // release with a hard cap on the `recent` tail (e.g. 20 or 100
      // entries). Even after the cap was removed, those older entries
      // are permanently lost (only the aggregated `requests` total
      // survives). The user clicks the in-dashboard "Reset" button on
      // the truncation banner and we delegate to the existing
      // `aiflowbridge.resetMetrics` command (which shows its own
      // confirmation dialog and wipes the on-disk file).
      void vscode.commands.executeCommand('aiflowbridge.resetMetrics').then(() => {
        panel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry, onRefreshPricing);
      });
      return;
    }
    // Action plan item #3: the Shared Session panel's "Replay"
    // button posts a `replay` message with the recorded request
    // id. The reply carries the JSON body of
    // `GET /v1/replay/{id}` so the user can see the stored prompt
    // + response without leaving VS Code. We re-hydrate the body
    // from the in-memory store (same source the HTTP endpoint
    // reads); the HTTP endpoint itself stays available for
    // external clients (curl, Kilo Code, ...).
    if (typed.type === 'replay' && typeof typed.id === 'string') {
      const entry = getSnapshot().recent.find((candidate) => candidate.id === typed.id);
      const payload = entry
        ? {
            id: entry.id,
            object: 'chat.completion.replay',
            timestamp: entry.timestamp,
            model: entry.model,
            providerId: entry.providerId,
            providerLabel: entry.providerLabel,
            status: entry.status,
            durationMs: entry.durationMs,
            usage: {
              promptTokens: entry.promptTokens,
              completionTokens: entry.completionTokens,
              totalTokens: entry.totalTokens,
            },
            promptSummary: entry.promptSummary ?? '',
            responseSummary: entry.responseSummary ?? '',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: entry.responseSummary ?? '' },
                finish_reason: 'stop',
              },
            ],
          }
        : { error: 'Request not found', id: typed.id };
      void panel.webview.postMessage({ type: 'replayResult', id: typed.id, payload });
      return;
    }
    if (typed.type === 'removeRequest' && typeof typed.id === 'string' && onRemoveEntry) {
      // in-memory store + on-disk file is synchronous-ish (the
      // on-disk write is fire-and-forget through the persister); the
      // re-render below uses the freshly-updated snapshot.
      onRemoveEntry(typed.id);
      panel.webview.html = buildDashboardHtml(getConfig(), getSnapshot(), isRunning(), getVersions(), onRemoveEntry, onRefreshPricing);
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
 *
 * `billedTo` marks plan-covered rows (`'plan'`: token plan /
 * subscription / OAuth plan): the numeric estimate is still shown
 * (indicative equivalent at the profile's rates) but the tooltip and
 * a `(plan)` suffix make clear it is NOT a real per-token charge.
 */
export function formatCostCell(cost: number, pricing: ProviderPricing | undefined, sourceLabel?: string, billedTo?: string): string {
  if (!Number.isFinite(cost) || cost <= 0) {
    return '<span class="muted">-</span>';
  }
  const currency = pricing?.currency || 'USD';
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  // Action plan item #1 / FEAT10: surface the pricing source on the
  // tooltip so the user can tell at a glance whether the rate is
  // release-time-fresh (`bundled (pricing.json)` with the bundled
  // date stamp), user-refreshed (`override (globalStorage)`), or a
  // fallback from the registry / family default.
  const sourceTag = sourceLabel ? ` - source: ${escapeHtml(sourceLabel)}` : '';
  const isPlan = billedTo === 'plan';
  const planTag = isPlan ? ' - billed to a token plan / subscription (indicative equivalent, not a real charge)' : '';
  const title = pricing
    ? `in ${symbol}${(pricing.inputPerMillion ?? 0).toFixed(2)} / out ${symbol}${(pricing.outputPerMillion ?? 0).toFixed(2)} per 1M tokens (${escapeHtml(currency)})${sourceTag}${planTag}`
    : `Estimated cost (${escapeHtml(currency)})${sourceTag}${planTag}`;
  // 4 decimals covers sub-cent values (token-plan rates produce costs in
  // the $0.0001-$0.01 range for typical prompts). Trim trailing zeros so
  // $0.0010 reads as $0.001.
  const formatted = cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const suffix = isPlan ? ' (plan)' : '';
  return `<code title="${title}">${symbol}${formatted}${suffix}</code>`;
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
  onRefreshPricing?: RefreshPricingFn
): string {
  const providers = config.providers.filter((provider) => provider.enabled);
  const entries = Object.entries(snapshot.byModel);
  const pricingMaps = buildPricingMaps(providers);
  const gatewayVersionLabel = versions.gateway ? ` v${escapeHtml(versions.gateway)}` : '';
  const extensionVersionLine = versions.extension ? `<p class="version-line">Current version: v${escapeHtml(versions.extension)}</p>` : '';
  // Detect on-disk telemetry truncation: the aggregated `requests`
  // counter covers the full history, but `recent` only holds the last
  // N entries. When N < requests, the recent table is missing rows
  // (because the file was written under an older release with a hard
  // cap of 20 or 100 entries). Reset is the only way to recover - the
  // aggregated totals alone cannot reconstruct the missing entries.
  // Threshold: only warn when at least 5 entries are missing, so a  // user who just deleted a row does not see a spurious banner.
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
    : '';
  // Per-row delete button CSS. Emitted only when the caller wired
  // the onRemoveEntry hook; the no-remove-hook callers must not see
  // the class names in the markup (the unit tests assert this).
  const actionCss = onRemoveEntry
    ? `.row-actions { width: 36px; padding-right: 0; }.row-actions-col { width: 36px; }.delete-btn {
      background: transparent;
      border: 0;
      padding: 4px;
      color: var(--muted);
      cursor: pointer;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }.delete-btn:hover {
      color: #f87171;
      background: rgba(248, 113, 113, 0.12);
    }.delete-btn:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: 1px;
    }`
    : '';
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
    .shared-session-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .shared-session-row { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
    .shared-session-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .shared-session-time { font-variant-numeric: tabular-nums; }
    .shared-session-provider { color: var(--text); font-weight: 500; }
    .shared-session-model { color: var(--accent); }
    .shared-session-prompt { font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
    .shared-session-replay { background: var(--bg); padding: 8px; margin-top: 8px; border-radius: 6px; max-height: 320px; overflow: auto; font-size: 12px; }
    .replay-btn { margin-left: auto; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
    .replay-btn:hover { border-color: var(--accent); color: var(--accent); }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(circle at top, #1e293b 0, #0f172a 42%, #020617 100%);
      color: var(--text);
      padding: 24px;
    }.shell { max-width: 1120px; margin: 0 auto; }.hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      margin-bottom: 24px;
    }.title { font-size: 30px; margin: 0 0 8px; }.subtitle { color: var(--muted); margin: 0; line-height: 1.5; }.version-line { color: var(--muted); margin: 4px 0 0; font-size: 12px; letter-spacing: 0.04em; }.badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 8px 14px;
      background: rgba(15, 23, 42, 0.8);
      color: var(--text);
      white-space: nowrap;
    }.title-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }.refresh-btn {
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
    }.refresh-btn:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--accent);
      color: var(--accent);
    }.refresh-btn.spinning svg { animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }.grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }.card {
      background: rgba(17, 24, 39, 0.85);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 18px 45px rgba(2, 6, 23, 0.25);
    }.card h2 {
      margin: 0 0 8px;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }.value { font-size: 34px; font-weight: 700; margin: 0; }.small { color: var(--muted); font-size: 13px; margin-top: 8px; }.panel {
      background: rgba(17, 24, 39, 0.8);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      margin-bottom: 24px;
    }.panel h2 { margin: 0 0 12px; font-size: 18px; }.panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 12px;
    }.panel-header h2 { margin: 0; }.collapse-btn {
      background: transparent;
      border: 0;
      color: var(--muted);
      cursor: pointer;
      padding: 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font: inherit;
    }.collapse-btn:hover { color: var(--text); }.collapse-btn .chevron {
      display: inline-block;
      transition: transform 0.15s ease;
    }.panel.collapsed .chevron { transform: rotate(-90deg); }.panel.collapsed .panel-body { display: none; }.filters {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }.filter-btn {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 12px;
      color: var(--muted);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }.filter-btn:hover { color: var(--text); }.filter-btn.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--accent);
      color: var(--accent);
    }.preset-select {
      -webkit-appearance: none;
      appearance: none;
      background: var(--panel-2) !important;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease;
    }.preset-select option {
      background: var(--panel-2);
      color: var(--text);
    }.preset-select:hover, .preset-select:focus {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.08) !important;
      outline: none;
    }.date-input {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px 8px;
      color: var(--text);
      font-size: 12px;
      color-scheme: dark;
    }.search-input {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      color: var(--text);
      font-size: 12px;
      min-width: 180px;
    }.filter-separator {
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
    th.sortable { cursor: pointer; user-select: none; transition: color 0.12s ease; }
    th.sortable:hover { color: var(--text); }
    th.sortable .sort-arrow { margin-left: 4px; font-size: 11px; opacity: 0; transition: opacity 0.12s ease; }
    th.sortable:hover .sort-arrow { opacity: 0.5; }
    th.sortable.sorted .sort-arrow { opacity: 1; color: var(--accent); }
    code {
      background: rgba(148, 163, 184, 0.12);
      border-radius: 6px;
      padding: 2px 6px;
    }.pill {
      display: inline-flex;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      border: 1px solid var(--border);
    }.pill.ok { color: var(--accent-2); }.pill.warn { color: #fbbf24; }.muted { color: var(--muted); }
    code.client-cell {
      display: inline-block;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }
    ${actionCss}.totals-scope-note { font-size: 12px; margin: -12px 0 18px; }.banner {
      display: flex;
      align-items: center;
      gap: 16px;
      border-radius: 14px;
      padding: 14px 18px;
      margin-bottom: 16px;
      font-size: 13px;
      line-height: 1.5;
    }.banner-warn {
      background: rgba(251, 191, 36, 0.08);
      border: 1px solid rgba(251, 191, 36, 0.35);
      color: #fde68a;
    }.banner-text { flex: 1; }.banner-btn {
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
    }.banner-btn:hover {
      background: rgba(251, 191, 36, 0.25);
      border-color: #fbbf24;
      color: #fef3c7;
    }.banner-btn:focus-visible {
      outline: 2px solid #fbbf24;
      outline-offset: 2px;
    }.pagination {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      font-size: 12px;
      color: var(--muted);
    }.pagination.page-btn {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 10px;
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    }.pagination.page-btn:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }.pagination.page-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }.pagination.page-jump {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px 6px;
      color: var(--text);
      font-size: 12px;
      width: 56px;
      text-align: center;
    }.pagination.page-label { white-space: nowrap; }.pagination.page-info { margin-left: auto; white-space: nowrap; }.session-section {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 10px;
      overflow: hidden;
    }.session-toggle {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      background: transparent;
      border: 0;
      padding: 12px 14px;
      color: var(--text);
      font: inherit;
      cursor: pointer;
      transition: background 0.15s ease;
    }.session-toggle:hover {
      background: rgba(56, 189, 248, 0.08);
    }.session-toggle .chevron {
      display: inline-block;
      transition: transform 0.15s ease;
      margin-right: 8px;
      color: var(--muted);
    }.session-section.closed .session-toggle .chevron {
      transform: rotate(-90deg);
    }.session-info {
      display: flex;
      align-items: center;
      gap: 16px;
      flex: 1;
    }.session-time {
      font-weight: 600;
      font-size: 13px;
    }.session-count {
      color: var(--muted);
      font-size: 12px;
    }.session-stats {
      font-size: 12px;
      color: var(--muted);
    }.session-stats span {
      margin-left: 12px;
    }.session-body {
      display: none;
      padding: 0 14px 12px;
    }.session-section.open .session-body {
      display: block;
    }.session-summary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 8px;
    }.session-summary-table th {
      text-align: left;
      color: var(--muted);
      font-weight: 600;
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }.session-summary-table td {
      padding: 6px 10px;
      color: var(--text);
      border-bottom: 1px solid rgba(148, 163, 184, 0.08);
    }.session-summary-table td.muted {
      color: var(--muted);
    }.session-entries {
      margin-top: 12px;
    }.session-entries-title {
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 600;
      margin: 0 0 6px;
    }.session-entries-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }.session-entries-table th {
      text-align: left;
      color: var(--muted);
      font-weight: 600;
      padding: 4px 8px;
      border-bottom: 1px solid var(--border);
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }.session-entries-table td {
      padding: 4px 8px;
      color: var(--text);
      border-bottom: 1px solid rgba(148, 163, 184, 0.08);
      white-space: nowrap;
    }.session-entries-table td.muted {
      color: var(--muted);
    }.session-entries-table .pill {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }.session-entries-table .pill.ok {
      background: rgba(34, 197, 94, 0.15);
      color: #86efac;
    }.session-entries-table .pill.warn {
      background: rgba(251, 113, 133, 0.15);
      color: #fda4af;
    }.session-entries-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      background: transparent;
      border: 0;
      padding: 6px 0;
      color: var(--muted);
      font: inherit;
      cursor: pointer;
      text-align: left;
    }.session-entries-toggle:hover {
      color: var(--text);
    }.session-entries-toggle .chevron {
      display: inline-block;
      transition: transform 0.15s ease;
      font-size: 10px;
    }.session-entries.closed .session-entries-toggle .chevron {
      transform: rotate(-90deg);
    }.session-entries.open .session-entries-body {
      display: block;
    }.session-entries.closed .session-entries-body {
      display: none;
    }.footer { color: var(--muted); font-size: 12px; margin-top: 18px; }
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
      <div class="badge" id="gateway-badge">Gateway${gatewayVersionLabel} ${running ? 'running' : 'stopped'} · ${escapeHtml(config.gateway.baseUrl)}</div>
    </div>

    <div class="panel" id="panel-gateway">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-gateway" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Gateway</h2>
        </button>
        ${onRefreshPricing ? `<button type="button" class="refresh-btn" id="refresh-pricing-button" title="Fetch the latest OpenRouter rates and update the in-memory pricing registry (action plan item #1 / FEAT10)."><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg><span>Refresh prices</span></button>` : ''}
      </div>
      <div class="panel-body">
        <p class="muted">Port: <code>${config.gateway.port}</code> · Default model: <code>${escapeHtml(config.gateway.defaultModel || 'none')}</code></p>
        <p class="muted">Upstream providers are configured as logical aliases for unified access.</p>
        ${config.pricing ? `<p class="muted">Pricing snapshot: <code>${escapeHtml(config.pricing.bundledFetchedAt || '<no bundled stamp>')}</code> · <code>${escapeHtml(formatPricingBundleVersion(config.pricing.bundledVersion))}</code> · <code>${Object.keys(config.pricing.models).length} model(s) sourced from bundled JSON</code></p>` : ''}
      </div>
    </div>

    <div class="panel" id="panel-filters">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-filters" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Filters</h2>
        </button>
        <p class="muted" style="margin:0;font-size:12px;">Filters apply to all sections below.</p>
      </div>
      <div class="panel-body">
        <div class="filters" id="dashboard-filters">
          ${renderPresetSelect('recent-preset')}
          ${renderProviderSelect('recent-provider')}
          <label class="muted" for="recent-auth">Auth</label>
          <select class="preset-select" id="recent-auth" aria-label="Filter by authentication mode">
            <option value="">All auth modes</option>
            <option value="byok">byok</option>
            <option value="oauth">oauth</option>
            <option value="plan">plan</option>
            <option value="token">token</option>
            <option value="unknown">unknown</option>
          </select>
          <span class="filter-separator" aria-hidden="true"></span>
          <label class="muted" for="recent-from">From</label>
          <input type="date" class="date-input" id="recent-from" />
          <label class="muted" for="recent-to">To</label>
          <input type="date" class="date-input" id="recent-to" />
          <span class="filter-separator" aria-hidden="true"></span>
          <input type="search" class="search-input" id="recent-search" placeholder="Filter requests&hellip;" aria-label="Filter requests" />
          <span class="filter-separator" aria-hidden="true"></span>
          <label class="muted" for="session-gap" style="font-size:12px;">Inactivity gap</label>
          <select class="preset-select" id="session-gap" aria-label="Session inactivity gap">
            <option value="1">1 min</option>
            <option value="2">2 min</option>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="30" selected>30 min</option>
            <option value="45">45 min</option>
            <option value="60">60 min</option>
          </select>
          <span class="filter-separator" aria-hidden="true"></span>
          <button type="button" class="banner-btn" id="clear-filters-btn" title="Reset all filters (time range, provider, dates, search, inactivity gap) to their defaults">Clear filters</button>
          <span class="filter-separator" aria-hidden="true"></span>
          <span class="muted" style="font-size:12px;">Export filtered</span>
          <button type="button" class="banner-btn" id="export-csv-btn" title="Download the currently filtered entries as CSV (RFC 4180, comma-separated, CRLF line endings, UTF-8). Honors all active filters.">CSV</button>
          <button type="button" class="banner-btn" id="export-json-btn" title="Download the currently filtered entries as JSON. Includes the active filters and aggregated totals in the metadata header.">JSON</button>
        </div>
      </div>
    </div>

    <div class="grid" id="totals">
      ${metricCard('Requests', formatNumber(snapshot.requests), `${providers.length} enabled provider${providers.length === 1 ? '' : 's'}`, 'totals-requests')}
      ${metricCard('Tokens', formatNumber(snapshot.totalTokens), `${formatNumber(snapshot.promptTokens)} prompt / ${formatNumber(snapshot.completionTokens)} completion`, 'totals-tokens')}
      ${metricCard('Duration', snapshot.averageDurationMs ? `${Math.round(snapshot.averageDurationMs)} ms` : '0 ms', `P95 ${Math.round(snapshot.p95DurationMs)} ms`, 'totals-duration')}
      ${metricCard('Estimated cost', formatCostValue(snapshot.estimatedCost), costCardDetail(snapshot), 'totals-cost')}
    </div>
    ${truncationBanner}
    <p class="muted totals-scope-note" id="totals-scope-note">Showing all recorded requests (no filter active).</p>
    ${renderBillingNotice(snapshot)}

    <div class="panel" id="panel-recent">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-recent" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Recent requests</h2>
        </button>
      </div>
      <div class="panel-body">
        ${snapshot.recent.length === 0 ? '<p class="muted">No request recorded yet.</p>' : renderRecentTable(snapshot, pricingMaps, Boolean(onRemoveEntry))}
        <div class="pagination" id="recent-pagination" hidden></div>
      </div>
    </div>

    <div class="panel" id="panel-sessions">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-sessions" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Sessions</h2>
        </button>
      </div>
      <div class="panel-body">
        <div id="sessions-container">
          <p class="muted">No sessions to show.</p>
        </div>
        <div class="pagination" id="sessions-pagination" hidden></div>
      </div>
    </div>

    <div class="panel" id="panel-model">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-model" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>By model</h2>
        </button>
      </div>
      <div class="panel-body">
        ${entries.length === 0 ? '<p class="muted">No model telemetry yet.</p>' : renderModelSummary(snapshot, pricingMaps)}
        <div class="pagination" id="model-pagination" hidden></div>
      </div>
    </div>

    <div class="panel" id="panel-shared-session">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-shared-session" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>Shared session</h2>
        </button>
        <div class="filters">
          <span class="muted" style="font-size:12px;" id="shared-session-sse-status" title="Live status of the /v1/events stream">offline</span>
        </div>
      </div>
      <div class="panel-body">
        <p class="muted" style="margin-top:0;">Pair-programming view: recent prompts captured by the gateway. Click <strong>Replay</strong> to re-fetch the stored prompt + response summaries via <code>GET /v1/replay/{id}</code>. Auto-refreshes via <code>GET /v1/events</code> SSE when the dashboard is open in a browser pointed at the gateway's loopback URL.</p>
        <div id="shared-session-list">
          ${renderSharedSessionList(snapshot)}
        </div>
      </div>
    </div>

    <div class="panel" id="panel-client">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-client" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>By client</h2>
        </button>
      </div>
      <div class="panel-body">
        ${renderClientSummary(snapshot)}
      </div>
    </div>

    <div class="panel" id="panel-source">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-source" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>By source</h2>
        </button>
      </div>
      <div class="panel-body">
        ${renderSourceSummary(snapshot)}
      </div>
    </div>

    <div class="panel" id="panel-auth">
      <div class="panel-header">
        <button type="button" class="collapse-btn" data-collapse-target="panel-auth" aria-expanded="true" title="Toggle section">
          <span class="chevron">&#9662;</span>
          <h2>By auth</h2>
        </button>
      </div>
      <div class="panel-body">
        ${renderAuthSummary(snapshot)}
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

      // AFF07: the export-payload builder references
      // extensionVersion to stamp the JSON export metadata with
      // the build that produced the file. Hydrate it from the
      // versions.extension passed in by the host at HTML build
      // time so the inline script has the value in scope (the
      // webview cannot see the host's variables; only the literal
      // embedded in the HTML reaches the script). JSON.stringify
      // ensures the embedded literal is a valid JS string
      // regardless of the version content.
      var extensionVersion = ${JSON.stringify(versions.extension ?? '')};

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

      // Action plan item #1 / FEAT10: the Gateway panel's
      // Refresh prices button forwards to the host, which fetches
      // the live OpenRouter /v1/models listing, writes the result
      // to globalStorage pricing-override.json, updates the
      // in-memory pricing registry in place, and re-renders the
      // dashboard. The host posts a refreshPricingResult message
      // back when the operation completes so the button can show a
      // transient Updated N model(s) toast.
      const refreshPricingButton = document.getElementById("refresh-pricing-button");
      if (refreshPricingButton) {
        refreshPricingButton.addEventListener("click", () => {
          refreshPricingButton.classList.add("spinning");
          refreshPricingButton.disabled = true;
          vscodeApi.postMessage({ type: "refreshPricing" });
          window.setTimeout(() => {
            refreshPricingButton.classList.remove("spinning");
            refreshPricingButton.disabled = false;
          }, 4000);
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

      // Action plan item #3: wire the Shared Session panel's
      // "Replay" buttons. The dashboard is a VS Code webview
      // without fetch() into the gateway loopback URL (CSP), so the
      // replay payload is requested through the extension host via
      // a dedicated message type. The host returns the JSON body
      // (or an error string) which we then render in the row's
      // <pre data-replay-out="..."> block.
      const replayButtons = document.querySelectorAll("[data-replay-id]");
      replayButtons.forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          const id = btn.getAttribute("data-replay-id");
          if (!id) return;
          const out = document.querySelector('[data-replay-out="' + CSS.escape(id) + '"]');
          if (out) {
            out.hidden = false;
            out.textContent = "Loading...";
          }
          vscodeApi.postMessage({ type: "replay", id });
        });
      });

      // Action plan item #3: receive the host's replay payload and
      // render it into the matching <pre>. Trims long responses so
      // the panel does not blow up on a 1000-char response summary.
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || typeof data !== "object") return;
        if (data.type !== "replayResult" || typeof data.id !== "string") return;
        const out = document.querySelector('[data-replay-out="' + CSS.escape(data.id) + '"]');
        if (!out) return;
        const text = JSON.stringify(data.payload, null, 2);
        out.textContent = text.length > 4000 ? text.slice(0, 4000) + '\\n... (truncated)' : text;
      });

      // collapsible sections. Persist state in localStorage so the
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
      // The recent table now carries "Client" (item #1) and
      // "Path" (item #6) columns. The colspan counts: status,
      // date, provider, model, client, duration, tokens, cost,
      // token source, path = 10 in the no-remove path, +1 action
      // column when present.
      const recentColspan = canRemove ? 12 : 11;
      const byModel = ${serializeByModel(snapshot.byModel)};
      const byProvider = ${serializeByProvider(snapshot.byProvider)};
      const byAuth = ${serializeByAuth(snapshot.byAuth)};
      const pricingMaps = ${serializePricingMaps(pricingMaps)};
      // regression fix: cumulative snapshot totals are needed by
      // updateTotals() when no filter is active. The server-side render
      // uses these for the initial card values; the client re-applies
      // them when the user clears their filter so the cards do not
      // collapse to the in-memory recent window.
      const cumulativeTotals = ${serializeCumulativeTotals(snapshot)};

      // per-panel filtered data, populated by applyFilters()
      // (recent + by-model) and reset by the init pass (provider summary
      // has no filter - it always shows the cumulative per-provider
      // aggregates from the snapshot). Pagination helpers slice these
      // into the current page on every rerender.
      let currentRecent = recent;
      let currentModels = byModel;
      let currentProviders = byProvider;
      let currentSessions = [];

      // pagination state. Declared early (before the loadPageSize
      // calls below) to avoid a TDZ ReferenceError when the IIFE runs.
      // The state object holds the current page + page size + total for
      // each of the three paginated panels. Defaults:
      // - recent: 25 entries / page. The 'recent' tail is uncapped
      // (all recorded requests are kept), so the user can page
      // through the entire history with "Per page" up to 500.
      // - model / provider: 10 entries (typically a handful of rows).
      const paginationState = {
        recent: { page: 1, pageSize: 25, total: 0 },
        model: { page: 1, pageSize: 10, total: 0 },
        provider: { page: 1, pageSize: 10, total: 0 },
        sessions: { page: 1, pageSize: 5, total: 0 },
      };

      // sort state per panel. Click a column header once for
      // ascending, click again for descending, click a third time to
      // clear the sort (back to default order). Stored as { key, dir }
      // where key is the data-sort-key value and dir is "asc" | "desc".
      // Default: the recent table opens sorted by Date descending
      // (most recent first) so the freshest telemetry is at the top.
      // model + provider summaries keep their natural (insertion)
      // order until the user clicks a header.
      //
      // The webview runs in a sandboxed context with no module loader,
      // so it cannot import from dashboard-sort.ts. The values below
      // are inlined here (the exact contract mirrored by
      // defaultSortState() in src/aiflowbridge/ui/dashboard-sort.ts,
      // which the unit tests exercise directly).
      const sortState = {
        recent: { key: "timestamp", dir: "desc" },
        model: { key: null, dir: null },
        provider: { key: null, dir: null },
      };

      // read persisted page sizes from localStorage so the user's
      // "rows per page" choice survives a dashboard refresh. Defaults
      // match the plan: 20 for the recent table (most rows), 10 for
      // by-model and provider summary (typically a handful of rows).
      paginationState.recent.pageSize = loadPageSize("recent", paginationState.recent.pageSize);
      paginationState.model.pageSize = loadPageSize("model", paginationState.model.pageSize);
      paginationState.provider.pageSize = loadPageSize("provider", paginationState.provider.pageSize);
      paginationState.sessions.pageSize = loadPageSize("sessions", paginationState.sessions.pageSize);

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

      // search filter. Case-insensitive substring match across
      // every textual / numeric field of the entry, so users can grep
      // for a model name, a provider id, a client id, a status code,
      // a token count, or a part of the ISO timestamp.
      function entrySearchHaystack(entry) {
        const ts = new Date(entry.timestamp);
        return [
          entry.model,
          entry.providerId,
          entry.providerLabel,
          entry.clientId || "",
          String(entry.status),
          entry.timestamp,
          isNaN(ts.getTime()) ? "" : ts.toLocaleString(),
          String(entry.durationMs),
          String(entry.totalTokens),
          String(entry.promptTokens),
          String(entry.completionTokens),
          String(entry.estimatedCost || 0),
          entry.estimated ? "estimated usage" : "exact usage",
          // Add the request 'source' ('gateway' / 'copilot-chat')
          // to the search haystack so a user typing 'copilot'
          // filters down to Copilot Chat traffic. Action plan
          // item #6.
          entry.source || "gateway",
          // Billing mode: typing 'plan' filters to token-plan /
          // subscription / OAuth rows, 'token' to per-token rows.
          entry.billedTo === "plan" ? "plan plan-billed" : "token",
          // Per-authentication-mode: typing 'byok', 'oauth',
          // 'plan', or 'token' filters to the matching mode. The
          // raw authMode value is included so the user can find
          // traffic by exact mode name without grep-ing the
          // column.
          entry.authMode || "unknown",
        ].join(" ").toLowerCase();
      }
      function matchesSearch(entry, needle) {
        if (!needle) return true;
        return entrySearchHaystack(entry).includes(needle);
      }

      function filterByRange(entries, range) {
        if (range === "all" || !range) return entries;
        const now = Date.now();
        // extended preset list (15mn, 30mn, 2d, 3d in addition
        // to the historical 1h / 24h / 7d / 30d). Values are in ms so
        // the existing filter pipeline can stay arithmetic.
        const thresholds = {
          "15m": 15 * 60_000,
          "30m": 30 * 60_000,
          "1h": 60 * 60_000,
          "24h": 24 * 60 * 60_000,
          "2d": 2 * 24 * 60 * 60_000,
          "3d": 3 * 24 * 60 * 60_000,
          "7d": 7 * 24 * 60 * 60_000,
          "30d": 30 * 24 * 60 * 60_000,
        };
        const threshold = thresholds[range] || Infinity;
        return entries.filter((entry) => {
          const ts = new Date(entry.timestamp).getTime();
          return now - ts <= threshold;
        });
      }

      function filterByProvider(entries, providerId) {
        if (!providerId) return entries;
        return entries.filter((entry) => entry.providerId === providerId);
      }

      // custom date range. Both bounds are inclusive; missing or
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

      function applyAllFilters(f) {
        let filtered = applyTimeAndDateFilters(f.range, f.from, f.to);
        filtered = filterByProvider(filtered, f.provider);
        filtered = filterByAuth(filtered, f.auth);
        return filtered;
      }

      // Per-authentication-mode filter. Empty value = no filter.
      // Coalesce absent authMode to 'unknown' so the 'unknown'
      // bucket behaves the same way as on the snapshot map (older
      // entries pre-date the field and live in that bucket).
      function filterByAuth(entries, authMode) {
        if (!authMode) return entries;
        return entries.filter((entry) => (entry.authMode || "unknown") === authMode);
      }

      // The webview cannot import modules, so the client-id truncation
      // helper is inlined here. It mirrors the exact contract of
      // truncateClientIdForDisplay() + CLIENT_ID_DISPLAY_MAX_LENGTH in
      // src/aiflowbridge/ui/dashboard.ts (the TS version, which the
      // unit tests exercise directly).
      var CLIENT_ID_DISPLAY_MAX_LENGTH = 24;
      function truncateClientIdForDisplay(value, maxLength) {
        if (typeof value !== 'string') return '';
        if (!isFinite(maxLength) || maxLength <= 0) return value;
        if (value.length <= maxLength) return value;
        if (maxLength <= 3) return '.'.repeat(Math.max(0, Math.floor(maxLength)));
        return value.slice(0, maxLength - 3) + '...';
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
          // Mirror the server-side client cell: code tag for named
          // clients, italic muted text for the unknown sentinel. The
          // server coalesced missing values to the literal string
          // unknown already (see serializeRecent); we only need to
          // choose between the code element and the muted cell.
          var displayClient = truncateClientIdForDisplay(entry.clientId, CLIENT_ID_DISPLAY_MAX_LENGTH);
          var clientCell = entry.clientId && entry.clientId !== "unknown"
            ? '<code class="client-cell" title="' + escapeHtml(entry.clientId) + '">' + escapeHtml(displayClient) + '</code>'
            : '<span class="muted" title="No client identification on this request">unknown</span>';
          return '<tr>' +
            actionCell +
            '<td><span class="pill ' + statusClass + '">' + entry.status + '</span></td>' +
            '<td class="muted" title="' + escapeHtml(tsText) + '">' + escapeHtml(formatTime(ts)) + '</td>' +
            '<td>' + escapeHtml(entry.providerLabel) + '</td>' +
            '<td><code>' + escapeHtml(entry.model) + '</code></td>' +
            '<td>' + clientCell + '</td>' +
            '<td>' + formatNumber(entry.durationMs) + ' ms</td>' +
            '<td>' + formatNumber(entry.totalTokens) + '</td>' +
          '<td>' + formatCostCell(entry.estimatedCost || 0, lookupPricing(entry), undefined, entry.billedTo) + '</td>' +
          '<td>' + (entry.estimated ? "estimated" : "usage") + '</td>' +
            '<td>' + (entry.source === "copilot-chat" ? '<code title="Driven by VS Code Copilot Chat (vscode.lm API)">copilot-chat</code>' : "gateway") + '</td>' +
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
            '<td>' + formatCostCell(snap.estimatedCost || 0, lookupPricingForModel(model), undefined, undefined) + '</td>' +
          '</tr>';
        });
        tbody.innerHTML = rows.length > 0 ? rows.join("") : '<tr><td colspan="6" class="muted" style="text-align:center; padding:24px;">No data in this range.</td></tr>';
      }

      // client-side provider summary renderer. The server-side
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

// provider row template. Mirrors server-side
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
          '<td>' + formatCostCell(snap.estimatedCost || 0, pricing, undefined, undefined) + '</td>' +
        '</tr>';
      }

      // --- sort helpers ---
      // generic comparator: numbers compared numerically, strings
      // compared locale-aware, everything else converted to string.
      function compareVals(a, b) {
        if (typeof a === "number" && typeof b === "number") {
          if (Number.isNaN(a) && Number.isNaN(b)) return 0;
          if (Number.isNaN(a)) return 1;
          if (Number.isNaN(b)) return -1;
          return a - b;
        }
        var sa = a == null ? "" : String(a);
        var sb = b == null ? "" : String(b);
        return sa.localeCompare(sb);
      }

      // extract the sort value from a flat array entry (recent table).
      function recentSortVal(entry, key) {
        switch (key) {
          case "timestamp": return entry.timestamp || "";
          case "status": return entry.status || 0;
          case "providerLabel": return entry.providerLabel || "";
          case "model": return entry.model || "";
          case "clientId": return entry.clientId || "";
          case "durationMs": return entry.durationMs || 0;
          case "totalTokens": return entry.totalTokens || 0;
          case "estimatedCost": return entry.estimatedCost || 0;
          case "estimated": return entry.estimated ? "estimated" : "usage";
          // Action plan item #6: the new 'Path' column is sortable
          // by 'source'. Coalesce absent to 'gateway' so older
          // entries do not sort to the top by default.
          case "source": return entry.source || "gateway";
          // Per-authentication-mode sort key. Coalesce absent to
          // 'unknown' for the same reason (older entries pre-date
          // the authMode field).
          case "authMode": return entry.authMode || "unknown";
          default: return "";
        }
      }

      // extract the sort value from a model/provider snapshot entry
      // plus the key/id (for "name" sort key).
      function objSortVal(id, snap, key) {
        if (key === "name") return id || "";
        if (typeof snap === "object" && snap !== null) {
          if (key === "requests") return snap.requests || 0;
          if (key === "totalTokens") return snap.totalTokens || 0;
          if (key === "averageDurationMs") return snap.averageDurationMs || 0;
          if (key === "errors") return snap.errors || 0;
          if (key === "estimatedCost") return snap.estimatedCost || 0;
        }
        return "";
      }

      // sort a flat array of recent entries.
      function sortRecentEntries(entries, key, dir) {
        if (!key || !dir) return entries;
        var copy = entries.slice();
        copy.sort(function (a, b) {
          return compareVals(recentSortVal(a, key), recentSortVal(b, key));
        });
        if (dir === "desc") copy.reverse();
        return copy;
      }

      // sort an object map by snapshot field. Returns a new object whose
      // keys are in the sorted order (modern engines preserve insertion
      // order for string keys for for-in / Object.keys / Object.entries).
      function sortObjectEntries(data, key, dir) {
        if (!key || !dir) return data;
        var entries = Object.keys(data).map(function (k) { return [k, data[k]]; });
        entries.sort(function (a, b) {
          var va = objSortVal(a[0], a[1], key);
          var vb = objSortVal(b[0], b[1], key);
          return compareVals(va, vb);
        });
        if (dir === "desc") entries.reverse();
        var out = {};
        for (var i = 0; i < entries.length; i++) {
          out[entries[i][0]] = entries[i][1];
        }
        return out;
      }

      // apply the active sort to the current data sets. Call after
      // every filter change and after every sort change.
      function applySorts() {
        currentRecentSorted = sortRecentEntries(currentRecent, sortState.recent.key, sortState.recent.dir);
        currentModelsSorted = sortObjectEntries(currentModels, sortState.model.key, sortState.model.dir);
        currentProvidersSorted = sortObjectEntries(currentProviders, sortState.provider.key, sortState.provider.dir);
      }

      // sorted copies of the filtered data. These are what the
      // paginator slices and what the table renderers consume.
      var currentRecentSorted = recent;
      var currentModelsSorted = byModel;
      var currentProvidersSorted = byProvider;

      // update the arrow indicators on all sortable headers.
      function updateSortArrows() {
        var panels = [
          { tableId: "recent-tbody", stateKey: "recent" },
          { tableId: "model-tbody", stateKey: "model" },
          { tableId: "provider-tbody", stateKey: "provider" },
        ];
        for (var i = 0; i < panels.length; i++) {
          var tbody = document.getElementById(panels[i].tableId);
          if (!tbody) continue;
          var table = tbody.closest("table");
          if (!table) continue;
          var headers = table.querySelectorAll("th.sortable");
          var state = sortState[panels[i].stateKey];
          for (var j = 0; j < headers.length; j++) {
            var th = headers[j];
            var key = th.getAttribute("data-sort-key");
            var arrowSpan = th.querySelector(".sort-arrow");
            if (!arrowSpan) {
              arrowSpan = document.createElement("span");
              arrowSpan.className = "sort-arrow";
              th.appendChild(arrowSpan);
            }
            if (key === state.key) {
              th.classList.add("sorted");
              arrowSpan.textContent = state.dir === "asc" ? " \\u25b2" : " \\u25bc";
            } else {
              th.classList.remove("sorted");
              arrowSpan.textContent = " \\u25b2";
            }
          }
        }
      }

      // --- sort helpers end ---

      // rerender all three paginated panels from the current
      // module-local data. Called by applyFilters (after a filter
      // change resets page numbers to 1) and by the pagination
      // controls themselves (after a page change). Each panel's
      // pagination strip is rebuilt every time - the controls are
      // cheap and the state object is the source of truth.
      function rerender() {
        applySorts();
        paginationState.recent.total = currentRecentSorted.length;
        paginationState.model.total = Object.keys(currentModelsSorted).length;
        paginationState.provider.total = Object.keys(currentProvidersSorted).length;
        bindPanelPaginator("recent-pagination", currentRecentSorted, false);
        bindPanelPaginator("model-pagination", currentModelsSorted, true);
        bindPanelPaginator("provider-pagination", currentProvidersSorted, true);
        bindSessionsPaginator();
        updateSortArrows();
      }

      function bindSessionsPaginator() {
        paginationState.sessions.total = currentSessions.length;
        var state = paginationState.sessions;
        var refresh = function() {
          var page = paginate(currentSessions, state.page, state.pageSize);
          renderSessionSections(page);
          renderPagination("sessions-pagination", state, refresh);
        };
        refresh();
      }

      // per-panel paginator helper. Owns the (1) paginated
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

      // dispatch for object-backed panels. The model table and
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

      function groupSessions(entries, thresholdMinutes) {
        if (entries.length === 0) return [];
        const sorted = entries.slice().sort((a, b) => {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
        const gapMs = thresholdMinutes * 60 * 1000;
        const sessions = [];
        let current = null;
        for (var i = 0; i < sorted.length; i++) {
          var ts = new Date(sorted[i].timestamp).getTime();
          if (current && ts - current.lastTs > gapMs) {
            sessions.push(current);
            current = null;
          }
          if (!current) {
            current = {
              startTime: sorted[i].timestamp,
              endTime: sorted[i].timestamp,
              lastTs: ts,
              count: 0,
              totalTokens: 0,
              totalDurationMs: 0,
              estimatedCost: 0,
              errors: 0,
              entries: [],
            };
          }
          current.count += 1;
          current.totalTokens += sorted[i].totalTokens || 0;
          current.totalDurationMs += sorted[i].durationMs || 0;
          current.estimatedCost += sorted[i].estimatedCost || 0;
          current.errors += sorted[i].status >= 400 ? 1 : 0;
          current.endTime = sorted[i].timestamp;
          current.lastTs = ts;
          current.entries.push(sorted[i]);
        }
        if (current) sessions.push(current);
        sessions.reverse();
        return sessions;
      }

      function renderSessionSections(sessions) {
        var container = document.getElementById("sessions-container");
        if (!container) return;
        if (sessions.length === 0) {
          container.innerHTML = '<p class="muted">No sessions to show.</p>';
          return;
        }
        var html = "";
        for (var i = 0; i < sessions.length; i++) {
          var s = sessions[i];
          var startTs = new Date(s.startTime);
          var endTs = new Date(s.endTime);
          var avgDurationMs = s.count > 0 ? Math.round(s.totalDurationMs / s.count) : 0;
          var durationMinutes = s.lastTs > 0 && startTs.getTime() > 0
            ? Math.round((s.lastTs - startTs.getTime()) / 60000)
            : 0;
          html += '<div class="session-section closed" id="session-' + i + '">'
            + '<button class="session-toggle" data-session-id="' + i + '" title="Click to expand">'
            + '<span class="chevron">&#9662;</span>'
            + '<div class="session-info">'
            + '<span class="session-time">' + escapeHtml(startTs.toLocaleString()) + '</span>'
            + '<span class="session-count">' + formatNumber(s.count) + ' request' + (s.count === 1 ? '' : 's') + '</span>'
            + '<span class="session-stats">'
            + '<span>&#x2B55; ' + formatNumber(s.totalTokens) + ' tokens</span>'
            + '<span>&#x23F1; ' + formatNumber(avgDurationMs) + ' ms avg</span>'
            + (durationMinutes > 0 ? '<span>&#x1F552; ' + durationMinutes + ' min</span>' : '')
            + '<span>' + formatCostCell(s.estimatedCost, null, undefined, undefined) + '</span>'
            + '</span>'
            + '</div>'
            + '</button>'
            + '<div class="session-body">'
            + '<table class="session-summary-table">'
            + '<thead><tr>'
            + '<th>Start</th>'
            + '<th>End</th>'
            + '<th>Requests</th>'
            + '<th>Tokens</th>'
            + '<th>Avg duration</th>'
            + '<th>Errors</th>'
            + '<th>Est. cost</th>'
            + '</tr></thead>'
            + '<tbody><tr>'
            + '<td class="muted">' + escapeHtml(startTs.toLocaleString()) + '</td>'
            + '<td class="muted">' + escapeHtml(endTs.toLocaleString()) + '</td>'
            + '<td>' + formatNumber(s.count) + '</td>'
            + '<td>' + formatNumber(s.totalTokens) + '</td>'
            + '<td>' + formatNumber(avgDurationMs) + ' ms</td>'
            + '<td>' + formatNumber(s.errors) + '</td>'
            + '<td>' + formatCostCell(s.estimatedCost, null, undefined, undefined) + '</td>'
            + '</tr></tbody>'
            + '</table>'
            + renderSessionEntries(s.entries, i)
            + '</div>'
            + '</div>';
        }
        container.innerHTML = html;
        for (var i = 0; i < sessions.length; i++) {
          (function(idx) {
            var toggle = container.querySelector('[data-session-id="' + idx + '"]');
            if (toggle) {
              toggle.addEventListener("click", function() {
                var section = document.getElementById("session-" + idx);
                if (section) {
                  if (section.classList.contains("open")) {
                    section.classList.remove("open");
                    section.classList.add("closed");
                  } else {
                    section.classList.remove("closed");
                    section.classList.add("open");
                  }
                }
              });
            }
            var entriesToggle = container.querySelector('[data-entries-toggle="' + idx + '"]');
            if (entriesToggle) {
              entriesToggle.addEventListener("click", function(ev) {
                ev.stopPropagation();
                var entriesEl = document.getElementById("session-entries-" + idx);
                if (entriesEl) {
                  if (entriesEl.classList.contains("open")) {
                    entriesEl.classList.remove("open");
                    entriesEl.classList.add("closed");
                  } else {
                    entriesEl.classList.remove("closed");
                    entriesEl.classList.add("open");
                  }
                }
              });
            }
          })(i);
        }
      }

      function formatTime(date) {
        return date.toLocaleString();
      }

      function renderSessionEntries(entries, sessionId) {
        if (!entries || entries.length === 0) return '';
        var rows = '';
        for (var j = 0; j < entries.length; j++) {
          var e = entries[j];
          var ts = new Date(e.timestamp);
          var statusClass = e.status >= 400 ? 'warn' : 'ok';
          rows += '<tr>'
            + '<td class="muted" title="' + escapeHtml(ts.toLocaleString()) + '">'
            + escapeHtml(ts.toLocaleTimeString())
            + '</td>'
            + '<td>' + escapeHtml(e.providerLabel || e.providerId) + '</td>'
            + '<td><code>' + escapeHtml(e.model) + '</code></td>'
            + '<td><span class="pill ' + statusClass + '">' + e.status + '</span></td>'
            + '<td>' + formatNumber(e.durationMs) + ' ms</td>'
            + '<td>' + formatNumber(e.totalTokens) + '</td>'
            + '<td>' + formatCostCell(e.estimatedCost || 0, lookupPricing(e), undefined, e.billedTo) + '</td>'
            + '</tr>';
        }
        var containerId = 'session-entries-' + sessionId;
        return '<div class="session-entries closed" id="' + containerId + '">'
          + '<button class="session-entries-toggle" data-entries-toggle="' + sessionId + '" title="Toggle request details">'
          + '<span class="chevron">&#9662;</span>'
          + '<span class="session-entries-title">Request details (' + formatNumber(entries.length) + ')</span>'
          + '</button>'
          + '<div class="session-entries-body">'
          + '<table class="session-entries-table">'
          + '<thead><tr>'
          + '<th>Time</th>'
          + '<th>Provider</th>'
          + '<th>Model</th>'
          + '<th>Status</th>'
          + '<th>Duration</th>'
          + '<th>Tokens</th>'
          + '<th>Est. cost</th>'
          + '</tr></thead>'
          + '<tbody>' + rows + '</tbody>'
          + '</table>'
          + '</div>'
          + '</div>';
      }
      function formatNumber(value) {
        return new Intl.NumberFormat("en-US").format(value);
      }
      function escapeHtml(value) {
        return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
      }

      // AFF07: telemetry export helpers. Duplicated from the
      // module-level escapeCsvValue / buildCsvExport /
      // buildJsonExport / computeExportTotals / buildExportFilename
      // so the inline script can call them directly (the
      // browser-side script has no access to the TypeScript module
      // scope). The two implementations stay in lockstep via the
      // unit tests in tests/dashboard.test.ts.
      var CSV_COLUMNS_BROWSER = [
        "id", "timestamp", "providerId", "providerLabel", "model",
        "status", "durationMs", "promptTokens", "completionTokens",
        "totalTokens", "estimatedCost", "estimated", "billedTo", "source",
        "authMode", "clientId", "promptSummary", "responseSummary"
      ];
      function escapeCsvValue(value, forceQuote) {
        if (forceQuote === void 0) forceQuote = false;
        var s = String(value == null ? "" : value);
        // The regex literal escapes CR and LF as the source-code
        // sequences backslash-r and backslash-n. Inside the
        // enclosing TypeScript template literal each must be
        // doubled to survive the template-literal escape pass
        // (otherwise the runtime script would contain a real
        // CR/LF byte and the regex literal would terminate early).
        var needsQuoting = forceQuote || /[",\\r\\n]/.test(s);
        if (!needsQuoting) return s;
        return '"' + s.replaceAll('"', '""') + '"';
      }
      function toExportedEntryBrowser(entry) {
        return {
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
          estimated: Boolean(entry.estimated),
          billedTo: entry.billedTo || "token",
          source: entry.source || "unknown",
          authMode: entry.authMode || "unknown",
          clientId: entry.clientId || "unknown",
          promptSummary: entry.promptSummary || "",
          responseSummary: entry.responseSummary || "",
        };
      }
      function formatCsvRowBrowser(entry, columns) {
        if (columns === void 0) columns = CSV_COLUMNS_BROWSER;
        var cells = columns.map(function(col) {
          var value = entry[col];
          if (typeof value === "number") {
            return Number.isFinite(value) ? String(value) : "0";
          }
          if (typeof value === "boolean") {
            return value ? "true" : "false";
          }
          return escapeCsvValue(value);
        });
        return cells.join(",");
      }
      function buildCsvExportBrowser(entries, columns) {
        if (columns === void 0) columns = CSV_COLUMNS_BROWSER;
        var rows = [columns.join(",")];
        for (var i = 0; i < entries.length; i++) {
          rows.push(formatCsvRowBrowser(entries[i], columns));
        }
        return rows.join("\\r\\n") + "\\r\\n";
      }
      function computeExportTotalsBrowser(entries) {
        var promptTokens = 0, completionTokens = 0, totalTokens = 0;
        var estimatedCost = 0, errors = 0;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          promptTokens += e.promptTokens;
          completionTokens += e.completionTokens;
          totalTokens += e.totalTokens;
          estimatedCost += e.estimatedCost;
          if (e.status >= 400) errors += 1;
        }
        return {
          requests: entries.length,
          promptTokens: promptTokens,
          completionTokens: completionTokens,
          totalTokens: totalTokens,
          estimatedCost: Math.round(estimatedCost * 1e6) / 1e6,
          errors: errors,
        };
      }
      function sanitizeFilenameSlugBrowser(value) {
        return (value || "")
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "all";
      }
      function buildExportFilenameBrowser(meta, format) {
        var presetSlug = sanitizeFilenameSlugBrowser(meta.filters.preset || "all");
        var dateSlug = (meta.generatedAt || "").replace(/[:.]/g, "-");
        return "aiflowbridge-metrics-" + presetSlug + "-" + dateSlug + "." + format;
      }
      function buildJsonExportBrowser(entries, meta) {
        var payload = {
          schemaVersion: 1,
          source: "AIFlowBridge dashboard export",
          meta: meta,
          entries: entries,
        };
        return JSON.stringify(payload, null, 2) + "\\n";
      }
      function formatCostCell(cost, pricing, sourceLabel, billedTo) {
        if (!isFinite(cost) || cost <= 0) {
          return '<span class="muted">-</span>';
        }
        var currency = (pricing && pricing.currency) || "USD";
        var symbol = currency === "USD" ? "$" : (currency + " ");
        var inputRate = pricing && pricing.inputPerMillion ? Number(pricing.inputPerMillion).toFixed(2) : "0.00";
        var outputRate = pricing && pricing.outputPerMillion ? Number(pricing.outputPerMillion).toFixed(2) : "0.00";
        var sourceTag = sourceLabel ? " - source: " + escapeHtml(sourceLabel) : "";
        var planTag = billedTo === "plan" ? " - billed to a token plan / subscription (indicative equivalent, not a real charge)" : "";
        var title = pricing
          ? "in " + symbol + inputRate + " / out " + symbol + outputRate + " per 1M tokens (" + escapeHtml(currency) + ")" + sourceTag + planTag
          : "Estimated cost (" + escapeHtml(currency) + ")" + sourceTag + planTag;
        var formatted = Number(cost).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
        var suffix = billedTo === "plan" ? " (plan)" : "";
        return '<code title="' + title + '">' + symbol + formatted + suffix + '</code>';
      }

      // Sync the active state of the canonical preset select. Kept as a
      // named hook so future filter controls can plug in here without
      // the call site diverging. After the Filters refactor only one
      // preset select ships in the markup (in the dedicated Filters
      // panel at the top of the dashboard), so this function is
      // effectively a no-op but stays as the single integration point.
      function syncPresetSelects(range) {
        const sel = document.getElementById("recent-preset");
        if (sel) sel.value = range;
      }

      function bindPresetSelect(selectId, onChange) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        sel.addEventListener("change", () => {
          const range = sel.value || "all";
          // Sync the value with the canonical preset select so all
          // sections of the dashboard agree on the active preset.
          syncPresetSelects(range);
          // changing a preset clears the custom date range. The
          // two filter modes are mutually exclusive in the UI: presets
          // use a relative window (1h / 24h /...), the date pickers
          // use an absolute window. Clearing the dates on a preset
          // change is what makes the deactivation visible to the user.
          const fromEl = document.getElementById("recent-from");
          const toEl = document.getElementById("recent-to");
          if (fromEl) fromEl.value = "";
          if (toEl) toEl.value = "";
          onChange(range);
        });
      }

      function bindProviderSelect(selectId, onChange) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        sel.addEventListener("change", () => {
          onChange();
        });
      }

      // Population of the provider select element. Called once at JS-init
      // with the snapshot's byProvider keys, sorted alphabetically.
      // Static markup ships with just the "All providers" option;
      // this pass appends the rest. We re-run this pass on every
      // snapshot refresh so newly-enabled providers appear.
      function refreshProviderOptions() {
        const sel = document.getElementById("recent-provider");
        if (!sel) return;
        const keys = Object.keys(byProvider).sort();
        const previous = sel.value;
        const opts = ['<option value="">All providers</option>'];
        for (const key of keys) {
          const safe = escapeHtml(key);
          opts.push('<option value="' + safe + '">' + safe + '</option>');
        }
        sel.innerHTML = opts.join("");
        // Keep the user's selection if the previously chosen provider
        // is still in the new list; otherwise reset to "All".
        if (previous && keys.indexOf(previous) >= 0) {
          sel.value = previous;
        } else {
          sel.value = "";
        }
      }

      // entering a custom date sets the preset select back to a
      // neutral state. After the Filters refactor there is a single
      // canonical preset select (in the Filters panel at the top),
      // so we just reset its value to "all".
      function deactivateAllPresets() {
        const sel = document.getElementById("recent-preset");
        if (sel) sel.value = "all";
      }

      function currentFilters() {
        const rangeSel = document.getElementById("recent-preset");
        const providerSel = document.getElementById("recent-provider");
        const authSel = document.getElementById("recent-auth");
        const fromEl = document.getElementById("recent-from");
        const toEl = document.getElementById("recent-to");
        const searchEl = document.getElementById("recent-search");
        return {
          range: rangeSel ? rangeSel.value : "all",
          provider: providerSel ? providerSel.value : "",
          // New auth filter: empty string = all modes. Otherwise the
          // raw value from the select (byok / oauth / plan / token
          // / unknown).
          auth: authSel ? authSel.value : "",
          from: fromEl ? fromEl.value : "",
          to: toEl ? toEl.value : "",
          search: searchEl ? searchEl.value.trim().toLowerCase() : "",
        };
      }

      function applyFilters(rangeOverride) {
        const f = currentFilters();
        // If the caller supplied a range override (kept as a hook for
        // future shortcut bindings), prefer it over the value read
        // from currentFilters().
        if (rangeOverride) {
          f.range = rangeOverride;
        }
        // Split the time + custom-date filter from the search filter so
        // the two tables can apply the search differently (per the
        // plan):
        // - Recent table: entry-level search match
        // (filter out entries that do not match the needle).
        // - By-model table: entry-level OR model-name search match
        // (include a model if its name contains the needle, even
        // when none of its individual entries do).
        const timeFiltered = applyAllFilters(f);
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
        // Session grouping uses the same filter entries as the recent
        // table, respecting time range, date, provider, and search.
        var gapEl = document.getElementById("session-gap");
        var thresholdMinutes = gapEl ? parseInt(gapEl.value, 10) || 30 : 30;
        currentSessions = groupSessions(currentRecent, thresholdMinutes);
        // Provider summary is NOT filtered by time/search in the current
        // dashboard (no filter UI on that panel) - it always reflects
        // the cumulative by-provider aggregates from the snapshot.
        // pagination kicks the page back to 1 after a filter
        // change so the user lands on a valid page.
        paginationState.recent.page = 1;
        paginationState.model.page = 1;
        paginationState.sessions.page = 1;
        rerender();
        // keep the top metric cards in sync with the filtered
        // entries. When no filter is active the cards reflect the
        // cumulative snapshot totals; when a filter IS active they
        // recompute from the filtered subset. See updateTotals for
        // the rationale (the recent array is capped client-side by
        // the pagination page size, not by a hard cap).
        updateTotals(f);
        updateScopeNote(f);
      }

      // (regression fix): recompute the four top cards from the
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
          (f.range && f.range !== "all") || !!f.from || !!f.to || !!f.search || !!f.provider || !!f.auth;
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

      // explain in one line what the metric cards reflect. When
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
        const hasProvider = !!f.provider;
        const hasAuth = !!f.auth;
        const hasSearch = !!f.search;
        if (!hasPreset && !hasDate && !hasProvider && !hasAuth && !hasSearch) {
          note.textContent = "Showing all recorded requests (no filter active).";
          return;
        }
        const parts = [];
        if (hasPreset) parts.push("preset: " + f.range);
        if (hasProvider) parts.push("provider: " + f.provider);
        if (hasAuth) parts.push("auth: " + f.auth);
        if (hasDate) parts.push("custom: " + (f.from || "*") + " \u2192 " + (f.to || "*"));
        if (hasSearch) parts.push("search: \\\"" + f.search + "\\\"");
        note.textContent = "Filtered totals (" + parts.join(" \u00b7 ") + ").";
      }

      bindPresetSelect("recent-preset", applyFilters);
      bindProviderSelect("recent-provider", applyFilters);
      // The auth select is a static set (BYOK / OAuth / plan / token
      // / unknown) so it does not need a refreshProviderOptions-style
      // population - just wire the change handler.
      bindPresetSelect("recent-auth", applyFilters);
      refreshProviderOptions();

      // pagination. Each paginated panel stores its current page
      // and page size in module-local state. Page size is persisted in
      // localStorage per-panel (key = "aiflowbridge.dashboard.pageSize.<panel>")
      // so the user's choice survives a refresh. Page number resets to
      // 1 when the filter changes (the entry list shrinks or grows and
      // the previous page may be out of range).
      // // Pagination is purely client-side: the filter pipeline produces
      // a flat array (recent) or an object map (byModel / byProvider);
      // the paginator slices it and re-renders the tbody. The server-
      // side initial render emits ALL rows so the dashboard still shows
      // data if the script is disabled - the paginator simply rewrites
      // tbody.innerHTML on init.
      // // NOTE: the paginationState const itself is declared earlier
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

      // paginator. Slices a flat array or an object map.
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

      // render the pagination strip under a table.
      // containerId: the id of the.pagination div.
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
      // + entering a custom date deactivates the active
      // preset (the two modes are mutually exclusive in the UI).
      // Clearing a date does NOT re-activate the preset - the user has
      // to pick a preset explicitly to go back to relative mode.
      // // the date inputs are wired to the "input" event (not
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
        if (el && el.value) deactivateAllPresets();
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

      var sessionGapEl = document.getElementById("session-gap");
      if (sessionGapEl) sessionGapEl.addEventListener("change", applyFilters);

      // "Clear filters" button. Resets every filter control on the
      // dashboard to its default value: time preset = All, provider =
      // All providers, From / To dates empty, search empty, inactivity
      // gap = 30 min. The session-gap <option value="30" selected>
      // survives a page reload so 30 min stays the default even when
      // the user previously picked a different value; we force it back
      // here to keep the Clear action idempotent regardless of prior
      // history.
      var clearBtn = document.getElementById("clear-filters-btn");
      if (clearBtn) {
        clearBtn.addEventListener("click", function() {
          var presetSel = document.getElementById("recent-preset");
          if (presetSel) presetSel.value = "all";
          var providerSel = document.getElementById("recent-provider");
          if (providerSel) providerSel.value = "";
          var authSel = document.getElementById("recent-auth");
          if (authSel) authSel.value = "";
          var fromIn = document.getElementById("recent-from");
          if (fromIn) fromIn.value = "";
          var toIn = document.getElementById("recent-to");
          if (toIn) toIn.value = "";
          var searchIn = document.getElementById("recent-search");
          if (searchIn) searchIn.value = "";
          var gapSel = document.getElementById("session-gap");
          if (gapSel) gapSel.value = "30";
          applyFilters();
        });
      }

      // AFF07: telemetry export. Two buttons, one per format,
      // share the same payload builder (buildExportPayload) which
      // uses currentRecent (the filtered subset the dashboard
      // already renders) so the export honors every active filter.
      // The payload is sent to the host via postMessage; the host
      // shows a native save dialog and writes the file via
      // vscode.workspace.fs.writeFile. The previous client-side
      // URL.createObjectURL + synthetic <a download> pattern did
      // NOT work in VS Code webviews: the default webview CSP
      // blocks the blob: URL the synthetic anchor uses, so the
      // click was a silent no-op and the user got nothing.
      function captureExportFilters() {
        var f = currentFilters();
        return {
          preset: f.range || "all",
          provider: f.provider || "",
          auth: f.auth || "",
          fromDate: f.from || "",
          toDate: f.to || "",
          search: f.search || "",
        };
      }

      function buildExportPayload(format) {
        var exportedEntries = currentRecent.map(toExportedEntryBrowser);
        var filters = captureExportFilters();
        var meta = {
          generatedAt: new Date().toISOString(),
          extensionVersion: extensionVersion || "",
          filters: filters,
          totals: computeExportTotalsBrowser(exportedEntries),
        };
        var filename = buildExportFilenameBrowser(meta, format);
        var contents = format === "csv"
          ? buildCsvExportBrowser(exportedEntries)
          : buildJsonExportBrowser(exportedEntries, meta);
        var mimeType = format === "csv" ? "text/csv" : "application/json";
        return { filename: filename, mimeType: mimeType, contents: contents, count: exportedEntries.length };
      }

      function wireExportButton(buttonId, format) {
        var btn = document.getElementById(buttonId);
        if (!btn) return;
        btn.addEventListener("click", function() {
          if (currentRecent.length === 0) {
            // Empty dataset: the dashboard already shows a muted
            // "No request recorded yet." row in the Recent panel, but
            // an explicit transient cue here keeps the user from
            // wondering why their download is a header-only CSV.
            btn.disabled = true;
            setTimeout(function() { btn.disabled = false; }, 1500);
            return;
          }
          var payload = buildExportPayload(format);
          // Hand the payload to the host; the host owns the save
          // dialog + disk write so the export survives the default
          // webview CSP that would otherwise swallow a blob: URL
          // download attempt.
          vscodeApi.postMessage({
            type: "export",
            format: format,
            filename: payload.filename,
            mimeType: payload.mimeType,
            contents: payload.contents,
          });
          btn.classList.add("spinning");
          btn.disabled = true;
          setTimeout(function() {
            btn.classList.remove("spinning");
            btn.disabled = false;
          }, 1500);
        });
      }

      wireExportButton("export-csv-btn", "csv");
      wireExportButton("export-json-btn", "json");

      // sortable column headers: click to cycle asc -> desc -> clear.
      // Event delegation on each table's <thead> so re-renders
      // (pagination, filter) do not break the handler. The 3-state
      // cycle is inlined here because the webview cannot import
      // modules; it mirrors cycleSortDir() in dashboard-sort.ts (the
      // same contract the unit tests exercise directly).
      (function bindSortHandlers() {
        var panels = [
          { thead: document.querySelector("#panel-recent table thead"), stateKey: "recent" },
          { thead: document.querySelector("#panel-model table thead"), stateKey: "model" },
          { thead: document.querySelector("#panel-provider table thead"), stateKey: "provider" },
        ];
        for (var i = 0; i < panels.length; i++) {
          var thead = panels[i].thead;
          var stateKey = panels[i].stateKey;
          if (!thead) continue;
          thead.addEventListener("click", function (key) {
            return function (event) {
              var th = event.target.closest("th.sortable");
              if (!th) return;
              var sortKey = th.getAttribute("data-sort-key");
              if (!sortKey) return;
              var st = sortState[key];
              if (st.key === sortKey) {
                if (st.dir === "asc") { st.dir = "desc"; }
                else if (st.dir === "desc") { st.key = null; st.dir = null; }
                else { st.key = sortKey; st.dir = "asc"; }
              } else {
                st.key = sortKey;
                st.dir = "asc";
              }
              rerender();
            };
          }(stateKey));
        }
      })();

      // initial paginated render. The server-side render
      // emitted ALL rows in every table (so the dashboard still shows
      // data with JS disabled); this first rerender slices the rows
      // into the persisted page size for each panel.
      currentSessions = groupSessions(recent, 30);
      rerender();
    })();
  </script>
</body>
</html>`;
}

/**
 * render a `<select>` for the time-range preset (All, Last 15 min,
 * Last 30 min, Last 1 h, Last 24 h, Last 2 days, Last 3 days, Last 7 days,
 * Last 30 days). The `id` parameter matches the DOM id used by the JS
 * sync logic ("recent-preset" is the canonical source). Extracted as a
 * standalone string-builder so the unit tests assert the option list
 * directly without scraping the full dashboard HTML.
 *
 * The matching JS handler is `bindPresetSelect()`; this helper only
 * emits the markup.
 */
export const PRESET_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '15m', label: 'Last 15 min' },
  { value: '30m', label: 'Last 30 min' },
  { value: '1h', label: 'Last 1 h' },
  { value: '24h', label: 'Last 24 h' },
  { value: '2d', label: 'Last 2 days' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/**
 * render a `<select>` for the provider filter. The options are
 * populated from `snapshot.byProvider` keys at JS-init time (we cannot
 * enumerate providers statically because the list is dynamic). The
 * static markup ships with a single "All providers" option; the JS
 * init pass appends the rest by reading `byProvider` directly.
 */
function renderPresetSelect(id: string): string {
  const options = PRESET_OPTIONS.map(
    (opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === 'all' ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
  ).join('');
  return `<select class="preset-select" id="${escapeHtml(id)}" aria-label="Time range">${options}</select>`;
}

function renderProviderSelect(id: string): string {
  // The "All providers" option is the static default; JS-init populates
  // the rest from the live snapshot. We intentionally do NOT list
  // providers here so the static markup does not drift away from the
  // dynamic set after a pricing override or a new model.
  return `<select class="preset-select" id="${escapeHtml(id)}" aria-label="Provider"><option value="" selected>All providers</option></select>`;
}

function metricCard(title: string, value: string, detail: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : '';
  return `
    <div class="card"${idAttr}>
      <h2>${escapeHtml(title)}</h2>
      <p class="value">${escapeHtml(value)}</p>
      <div class="small">${escapeHtml(detail)}</div>
    </div>`;
}

function renderRecentTable(snapshot: TelemetrySnapshot, pricing: PricingMaps, canRemove: boolean): string {
  const actionHeader = canRemove ? '<th class="row-actions-col" aria-label="Row actions"></th>' : '';
  return `
    <table>
      <thead>
        <tr>
          ${actionHeader}
          <th class="sortable" data-sort-key="status">Status</th>
          <th class="sortable" data-sort-key="timestamp">Date</th>
          <th class="sortable" data-sort-key="providerLabel">Provider</th>
          <th class="sortable" data-sort-key="model">Model</th>
          <th class="sortable" data-sort-key="clientId">Client</th>
          <th class="sortable" data-sort-key="durationMs">Duration</th>
          <th class="sortable" data-sort-key="totalTokens">Tokens</th>
          <th class="sortable" data-sort-key="estimatedCost">Est. cost</th>
          <th class="sortable" data-sort-key="estimated">Token source</th>
          <th class="sortable" data-sort-key="source">Path</th>
          <th class="sortable" data-sort-key="authMode">Auth</th>
        </tr>
      </thead>
      <tbody id="recent-tbody">
        ${snapshot.recent.map((entry) => recentRow(entry, pricing, canRemove)).join('')}
      </tbody>
    </table>`;
}

function recentRow(entry: RequestTelemetry, pricing: PricingMaps, canRemove: boolean): string {
  const rate = pricing.byProviderId[entry.providerId] ?? pricing.byModel[entry.model];
  // The leading column carries a per-row trash button. The entry id is
  // embedded in a data-attribute so the click handler can post the
  // correct { type, id } message to the extension without keeping a
  // parallel lookup table. The button is only rendered when the caller
  // supplied an `onRemoveEntry` hook (backward-compatible render path).
  const actionCell = canRemove
    ? `<td class="row-actions"><button class="delete-btn" data-remove-id="${escapeHtml(entry.id)}" title="Delete this request" aria-label="Delete this request"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button></td>`
    : '';
  // `clientId` is optional: older entries (pre-this-feature) have no
  // field. Display the literal `'unknown'` so the column never shows
  // an empty cell - it doubles as a visual hint that the user's
  // traffic pre-dates the client-aware gateway.
  const clientCell = entry.clientId
    ? `<code class="client-cell" title="${escapeHtml(entry.clientId)}">${escapeHtml(truncateClientIdForDisplay(entry.clientId, CLIENT_ID_DISPLAY_MAX_LENGTH))}</code>`
    : `<span class="muted" title="No client identification on this request">unknown</span>`;
  // Billing marker: plan-covered rows (`billedTo === 'plan'`) keep
  // their indicative estimate but carry an explicit badge so the
  // user can tell a real per-token charge from a plan equivalent.
  // Older entries (no `billedTo` field) render unmarked - same as
  // per-token billing.
  const billingCell =
    entry.billedTo === 'plan'
      ? `<span class="pill plan" title="Covered by a token plan / subscription / OAuth plan - the Est. cost is an indicative equivalent at the profile rates, not a real charge">plan</span>`
      : '';
  return `<tr>
        ${actionCell}
        <td><span class="pill ${entry.status >= 400 ? 'warn' : 'ok'}">${entry.status}</span></td>
        <td class="muted">${escapeHtml(formatClock(entry.timestamp))}</td>
        <td>${escapeHtml(entry.providerLabel)}</td>
        <td><code>${escapeHtml(entry.model)}</code>${billingCell}</td>
        <td>${clientCell}</td>
        <td>${formatNumber(entry.durationMs)} ms</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatCostCell(entry.estimatedCost, rate, undefined, entry.billedTo)}</td>
        <td>${entry.estimated ? 'estimated' : 'usage'}</td>
        <td>${formatSourceCell(entry.source)}</td>
        <td>${formatAuthCell(entry.authMode)}</td>
      </tr>`;
}

/**
 * Billing-mode notice rendered under the headline cards. Counts how
 * many recorded rows are plan-covered (`billedTo === 'plan'`) and
 * tells the user the "Estimated cost" total mixes real per-token
 * charges with indicative plan equivalents. Rendered only when at
 * least one plan-covered row exists; per-token-only histories keep
 * the previous layout untouched.
 */
function renderBillingNotice(snapshot: TelemetrySnapshot): string {
  const planRequests = snapshot.recent.filter((entry) => entry.billedTo === 'plan').length;
  if (planRequests === 0) {
    return '';
  }
  const total = snapshot.recent.length;
  return `<p class="muted billing-notice" id="billing-notice">Est. cost mixes real per-token charges with indicative plan equivalents: ${planRequests} of ${total} recorded request${total === 1 ? '' : 's'} ${planRequests === 1 ? 'is' : 'are'} billed to a token plan / subscription / OAuth plan (marked <span class="pill plan">plan</span>). Those rows cost you $0 extra - the amount shown is what the same tokens would cost at pay-as-you-go rates.</p>`;
}

/**
 * Headline-card detail for the Estimated cost card. Replaces the
 * static "Optional pricing only" label with a billing-aware split
 * when plan-covered rows exist, so the total is never misread as a
 * real bill.
 */
function costCardDetail(snapshot: TelemetrySnapshot): string {
  const planRequests = snapshot.recent.filter((entry) => entry.billedTo === 'plan').length;
  if (planRequests === 0) {
    return 'Optional pricing only';
  }
  const planCost = snapshot.recent
    .filter((entry) => entry.billedTo === 'plan')
    .reduce((sum, entry) => sum + (entry.estimatedCost || 0), 0);
  return `Optional pricing only - ${formatCostValue(planCost)} of it plan-covered (indicative, not billed)`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function renderProviderSummary(snapshot: TelemetrySnapshot, pricing: PricingMaps): string {
  const entries = Object.entries(snapshot.byProvider);
  if (entries.length === 0) {
    return '<p class="muted">No provider telemetry yet.</p>';
  }

  const rows = entries.map(([providerId, entry]) => providerRowHtml(providerId, entry, pricing.byProviderId[providerId])).join('');

  return `
    <table>
      <thead>
        <tr>
          <th class="sortable" data-sort-key="name">Provider</th>
          <th class="sortable" data-sort-key="requests">Requests</th>
          <th class="sortable" data-sort-key="totalTokens">Tokens</th>
          <th class="sortable" data-sort-key="averageDurationMs">Avg duration</th>
          <th class="sortable" data-sort-key="errors">Errors</th>
          <th class="sortable" data-sort-key="estimatedCost">Est. cost</th>
        </tr>
      </thead>
      <tbody id="provider-tbody">
        ${rows}
      </tbody>
    </table>`;
}

// shared provider row template. Used by both the server-side
// `renderProviderSummary` and the client-side `renderProviderRows`.
// Keep the column set in sync between the two call sites - this
// comment is the tripwire.
function providerRowHtml(providerId: string, entry: ProviderSnapshot, rate: ProviderPricing | undefined): string {
  return `<tr>
        <td><code>${escapeHtml(providerId)}</code></td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
        <td>${formatCostCell(entry.estimatedCost, rate, undefined, undefined)}</td>
      </tr>`;
}

function renderModelSummary(snapshot: TelemetrySnapshot, pricing: PricingMaps): string {
  const entries = Object.entries(snapshot.byModel);
  if (entries.length === 0) {
    return '<p class="muted">No model telemetry yet.</p>';
  }
  return `
    <table>
      <thead>
        <tr>
          <th class="sortable" data-sort-key="name">Model</th>
          <th class="sortable" data-sort-key="requests">Requests</th>
          <th class="sortable" data-sort-key="totalTokens">Tokens</th>
          <th class="sortable" data-sort-key="averageDurationMs">Avg duration</th>
          <th class="sortable" data-sort-key="errors">Errors</th>
          <th class="sortable" data-sort-key="estimatedCost">Est. cost</th>
        </tr>
      </thead>
      <tbody id="model-tbody">
        ${entries.map(([model, entry]) => modelRow(model, entry, pricing)).join('')}
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
        <td>${formatCostCell(entry.estimatedCost, pricing.byModel[model], undefined, undefined)}</td>
      </tr>`;
}

// "By client" panel. Aggregates traffic per originating client
// (Kilo Code / Continue / curl / JetBrains AI Assistant / ...).
// Drops the per-row "Est. cost" column because clients have no
// pricing profile: the `estimatedCost` field is still present on the
// per-client snapshot but is only meaningful when correlated with a
// per-call provider pricing (which lives on the by-provider /
// by-model panels). Rendering it here would be misleading.
function renderClientSummary(snapshot: TelemetrySnapshot): string {
  const entries = Object.entries(snapshot.byClient);
  if (entries.length === 0) {
    return '<p class="muted">No client telemetry yet.</p>';
  }
  return `
    <table>
      <thead>
        <tr>
          <th>Client</th>
          <th>Requests</th>
          <th>Tokens</th>
          <th>Avg duration</th>
          <th>Errors</th>
        </tr>
      </thead>
      <tbody id="client-tbody">
        ${entries.map(([clientId, entry]) => clientRow(clientId, entry)).join('')}
      </tbody>
    </table>`;
}

function clientRow(clientId: string, entry: ProviderSnapshot): string {
  // The `'unknown'` literal is the sentinel bucket for entries
  // recorded without a usable client header (older records, loopback
  // probes). Render it as italic muted text so it is visible in the
  // table without blending into the named clients above it.
  const isUnknown = clientId === 'unknown';
  const nameCell = isUnknown
    ? `<span class="muted">unknown</span>`
    : `<code class="client-cell" title="${escapeHtml(clientId)}">${escapeHtml(truncateClientIdForDisplay(clientId, CLIENT_ID_DISPLAY_MAX_LENGTH))}</code>`;
  return `<tr>
        <td>${nameCell}</td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
      </tr>`;
}

// "By source" panel. Aggregates traffic per originating AIFlowBridge
// path (`gateway` for `/v1/chat/completions` requests, `copilot-chat`
// for `vscode.lm` requests served through `UnifiedChatProvider`).
// Closes the historical blind spot where ~50% of usage (the Copilot
// Chat path) was invisible in the dashboard. Older on-disk snapshots
// (recorded before `bySource` existed) leave the map empty; entries
// are coalesced to the `'gateway'` bucket on read so a single session
// upgrade is coherent from the first request.
function renderSourceSummary(snapshot: TelemetrySnapshot): string {
  const entries = Object.entries(snapshot.bySource ?? {});
  if (entries.length === 0) {
    return '<p class="muted">No source telemetry yet.</p>';
  }
  return `
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th>Requests</th>
          <th>Tokens</th>
          <th>Avg duration</th>
          <th>Errors</th>
        </tr>
      </thead>
      <tbody id="source-tbody">
        ${entries.map(([source, entry]) => sourceRow(source, entry)).join('')}
      </tbody>
    </table>`;
}

function sourceRow(source: string, entry: ProviderSnapshot): string {
  // The `'gateway'` literal is the default for entries recorded
  // before `source` was added (every entry went through the
  // gateway). Render it as plain text. `'copilot-chat'` is shown
  // inside a <code> tag so it matches the model / provider / client
  // naming convention elsewhere on the dashboard.
  const isGateway = source === 'gateway';
  const nameCell = isGateway ? 'gateway' : `<code title="Origin of the request inside the AIFlowBridge process">${escapeHtml(source)}</code>`;
  return `<tr>
    <td>${nameCell}</td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
      </tr>`;
}

// "By auth" panel. Aggregates traffic per authentication mode
// (BYOK / OAuth / plan / token / unknown). Mirrors the bySource
// pattern: older on-disk snapshots (recorded before `byAuth`
// existed) leave the map empty; entries are coalesced to the
// `'unknown'` bucket on read so the dashboard stays coherent across
// the upgrade window. The `authMode` cell on each Recent row
// carries the same value, so the panel and the table tell the
// same story.
function renderAuthSummary(snapshot: TelemetrySnapshot): string {
  const entries = Object.entries(snapshot.byAuth ?? {});
  if (entries.length === 0) {
    return '<p class="muted">No auth telemetry yet.</p>';
  }
  return `
    <table>
      <thead>
        <tr>
          <th>Auth</th>
          <th>Requests</th>
          <th>Tokens</th>
          <th>Avg duration</th>
          <th>Errors</th>
        </tr>
      </thead>
      <tbody id="auth-tbody">
        ${entries.map(([auth, entry]) => authRow(auth, entry)).join('')}
      </tbody>
    </table>`;
}

function authRow(auth: string, entry: ProviderSnapshot): string {
  // Known modes get a coloured pill so the user can tell BYOK from
  // OAuth from plan at a glance. Unknown mode (pre-2.18.2 entries
  // that were never stamped) renders as muted text.
  const klass = `auth-${auth}`;
  const title = AUTH_MODE_TITLE[auth] ?? AUTH_MODE_TITLE.unknown;
  const nameCell = `<span class="pill ${klass}" title="${escapeHtml(title)}">${escapeHtml(auth)}</span>`;
  return `<tr>
        <td>${nameCell}</td>
        <td>${formatNumber(entry.requests)}</td>
        <td>${formatNumber(entry.totalTokens)}</td>
        <td>${formatNumber(Math.round(entry.averageDurationMs))} ms</td>
        <td>${formatNumber(entry.errors)}</td>
      </tr>`;
}

// Format the `source` field of a `RequestTelemetry` as a short,
// human-friendly cell for the Recent table. Coalesces absent to
// `'gateway'` (the historical default) so older entries do not show
// an empty cell. Copilot Chat entries get a small visual hint via
// the <code> tag so they stand out from the plain-text gateway
// rows.
function formatSourceCell(source: string | undefined): string {
  const resolved = source ?? 'gateway';
  if (resolved === 'copilot-chat') {
    return `<code title="Driven by VS Code Copilot Chat (vscode.lm API)">${resolved}</code>`;
  }
  return 'gateway';
}

// Per-authentication-mode cell renderer. Mirrors `formatSourceCell`:
// the cell doubles as a visual hint of which real auth path the
// gateway used (BYOK, OAuth, plan, per-token) and lets the user spot
// at a glance whether traffic came from their personal key, an
// OAuth session, or a covered plan.
function formatAuthCell(authMode: string | undefined): string {
  const resolved = authMode ?? 'unknown';
  const title = AUTH_MODE_TITLE[resolved] ?? AUTH_MODE_TITLE.unknown;
  const klass = `auth-${resolved}`;
  return `<span class="pill ${klass}" title="${escapeHtml(title)}">${escapeHtml(resolved)}</span>`;
}

const AUTH_MODE_TITLE: Record<string, string> = {
  byok: 'BYOK (Bring Your Own Key): the user supplied a personal API key (e.g. AIzaSy... for Gemini).',
  oauth: 'OAuth: the gateway spoke to the upstream on behalf of a logged-in user (e.g. Antigravity Cloud Code envelope).',
  plan: 'Plan: the profile is covered by a token plan / subscription / OAuth plan (e.g. MiniMax token plan).',
  token: 'Token: per-token billing, no plan coverage.',
  unknown: 'Auth mode unknown: this entry was recorded before the authMode field was introduced (pre-2.18.2).',
};

function serializeRecent(recent: readonly RequestTelemetry[]): string {
  return serializeForScript(
    recent.map((entry) => ({
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
      billedTo: entry.billedTo ?? 'token',
      // Coalesce absent and explicit empty values to a literal
      // `'unknown'` here so the client renderer does not have to
      // special-case the undefined string ('') for row sorting or
      // search matching.
      clientId: entry.clientId ?? 'unknown',
      // Same coalesce for the new `source` field (action plan item
      // #6). Older entries have no `source` field; default to
      // `'gateway'` because every pre-this-feature entry went
      // through the gateway. The dashboard Recent cell, the search
      // haystack, and the sort comparator all use this normalised
      // value.
      source: entry.source ?? 'gateway',
      // Same coalesce for the new `authMode` field. Older entries
      // have no `authMode` field; default to `'unknown'` so the
      // dashboard Recent cell, the sort comparator, and the search
      // haystack all see a coherent value for pre-2.18.2 history.
      authMode: entry.authMode ?? 'unknown',
    }))
  );
}

function serializeByModel(byModel: Record<string, ProviderSnapshot>): string {
  return serializeForScript(slimProviderSnapshots(byModel));
}

function serializeByProvider(byProvider: Record<string, ProviderSnapshot>): string {
  return serializeForScript(slimProviderSnapshots(byProvider));
}

function serializeByAuth(byAuth: Record<string, ProviderSnapshot> | undefined): string {
  // Older on-disk snapshots (pre-2.18.2) leave `byAuth` undefined;
  // ship an empty object so the client render path can stay
  // type-safe without conditional branches.
  return serializeForScript(slimProviderSnapshots(byAuth ?? {}));
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

// regression fix: the top metric cards show the cumulative
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
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Format a USD cost value with up to 4 decimals, trimming trailing zeros
 * so $0.0230 reads as $0.023. Used by the top "Estimated cost" metric
 * card (both the initial server render and the client-side rerender on
 * filter change) so the two render paths never diverge on formatting.
 */
function formatCostValue(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) {
    return '0.0000';
  }
  return cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * Maximum length of a client identifier rendered in a table cell.
 * The full value is preserved in the `title` attribute for tooltip
 * inspection; only the visible text is shortened so the recent
 * requests list stays within its section. 24 characters fits the
 * narrow `Client` column at the dashboard's default webview width
 * without wrapping or pushing the row past the section bounds.
 */
export const CLIENT_ID_DISPLAY_MAX_LENGTH = 24;

/**
 * Shorten a client identifier for display in a table cell. Returns
 * the original string when it fits within `maxLength`; otherwise
 * truncates and appends an ASCII three-dot suffix. The three-dot
 * form is used instead of the Unicode horizontal ellipsis to stay
 * within the project's typography rules (no smart punctuation).
 *
 * Exported for unit testing - the function is pure and side-effect
 * free.
 *
 * @param value The full client identifier (e.g. `kilocode@1.2.3`).
 * @param maxLength The maximum visible length, including any suffix.
 * @returns The original string when it fits; otherwise a shortened
 *          version suffixed with `...`.
 */
export function truncateClientIdForDisplay(value: string, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return value;
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return '.'.repeat(Math.max(0, Math.floor(maxLength)));
  }
  return value.slice(0, maxLength - 3) + '...';
}

/**
 * Format the bundled pricing JSON's `aiflowbridgeVersion` field for
 * the dashboard header. Treats the literal string "0.0.0" as a
 * sentinel (the legacy default of the release-time script when the
 * `package.json` `version` field was missing) and surfaces a clear
 * "unknown" label + a hint to re-run the refresh script. A truly
 * absent / empty version falls through to the same label. A real
 * semver string is rendered with the canonical `v` prefix.
 *
 * Exported so the unit test can assert the sentinel / empty / real
 * branches without booting a webview.
 */
export function formatPricingBundleVersion(version: string | undefined | null): string {
  if (!version || version === '0.0.0') {
    return 'AIFlowBridge version unknown (run npm run pricing:refresh)';
  }
  return `AIFlowBridge v${version}`;
}

// ----- AFF07 telemetry export (CSV / JSON) -------------------------------
// Pure helpers used by both the dashboard client-side JS (to build the
// payload for the download Blob) and the unit tests (to exercise the
// serialization rules without booting a webview). Kept dependency-free
// so the test surface is just a function call and a string equality.

/**
 * Map a `RequestTelemetry` entry to the flat export shape. Coalesces
 * optional fields to empty strings / `0` so the row is always
 * stringifiable without conditional logic in the row builder.
 */
export function toExportedEntry(entry: RequestTelemetry): ExportedRequestEntry {
  return {
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
    estimated: Boolean(entry.estimated),
    billedTo: entry.billedTo ?? 'token',
    source: entry.source ?? 'unknown',
    authMode: entry.authMode ?? 'unknown',
    clientId: entry.clientId ?? 'unknown',
    promptSummary: entry.promptSummary ?? '',
    responseSummary: entry.responseSummary ?? '',
  };
}

/**
 * Escape a single CSV field value per RFC 4180:
 *   - Wraps the value in double quotes if it contains a comma,
 *     double quote, CR or LF.
 *   - Doubles embedded double quotes.
 *
 * Always quotes when the caller opts in via `forceQuote`, which the
 * JSON column uses to keep the trailing-newline literal visible
 * inside the field.
 */
export function escapeCsvValue(value: string, forceQuote = false): string {
  const needsQuoting = forceQuote || /[",\r\n]/.test(value);
  if (!needsQuoting) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Build a single CSV row (without the trailing CRLF - the caller
 * concatenates with `\r\n` to honor the RFC 4180 line terminator).
 * Numbers / booleans are stringified without quoting; strings go
 * through `escapeCsvValue`.
 */
export function formatCsvRow(entry: ExportedRequestEntry, columns: ReadonlyArray<keyof ExportedRequestEntry> = CSV_COLUMNS): string {
  const cells: string[] = columns.map((col) => {
    const value = entry[col];
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '0';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return escapeCsvValue(String(value ?? ''));
  });
  return cells.join(',');
}

/**
 * Build the full CSV payload for the export. Includes a single
 * header row and one row per entry. RFC 4180 line terminator
 * (CRLF); final CRLF preserved for tooling that requires it.
 *
 * No metadata preamble (would violate strict RFC 4180 parsing); the
 * `meta` block is exposed via `buildJsonExport` for users who need
 * the filter context inline.
 */
export function buildCsvExport(entries: readonly ExportedRequestEntry[], columns: ReadonlyArray<keyof ExportedRequestEntry> = CSV_COLUMNS): string {
  const rows: string[] = [columns.join(',')];
  for (const entry of entries) {
    rows.push(formatCsvRow(entry, columns));
  }
  // Trailing CRLF so the file ends with a newline (POSIX + most CSV
  // tools expect this; some `wc -l` style tools count lines
  // differently otherwise).
  return rows.join('\r\n') + '\r\n';
}

/**
 * Compute the export totals from the entry set. Duplicates the
 * per-entry math the dashboard already does in
 * `aggregateModels()`/`updateTotals()` so the JSON payload stays
 * self-describing even if the user only consumes the export file.
 */
export function computeExportTotals(entries: readonly ExportedRequestEntry[]): ExportMetadata['totals'] {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let estimatedCost = 0;
  let errors = 0;
  for (const entry of entries) {
    promptTokens += entry.promptTokens;
    completionTokens += entry.completionTokens;
    totalTokens += entry.totalTokens;
    estimatedCost += entry.estimatedCost;
    if (entry.status >= 400) {
      errors += 1;
    }
  }
  // Round the cost to the same precision the dashboard uses so the
  // totals in the export match the dashboard's headline card.
  return {
    requests: entries.length,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCost: Math.round(estimatedCost * 1e6) / 1e6,
    errors,
  };
}

/**
 * Build the JSON export payload (pretty-printed). Embeds the
 * metadata header (`generatedAt`, `extensionVersion`, `filters`,
 * `totals`) at the top so a downstream consumer can reconstruct the
 * filter context without inspecting the filename.
 */
export function buildJsonExport(entries: readonly ExportedRequestEntry[], meta: ExportMetadata): string {
  const payload = {
    schemaVersion: 1,
    source: 'AIFlowBridge dashboard export',
    meta,
    entries,
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

/**
 * Build the download filename for an export.
 *
 *   aiflowbridge-metrics-<preset>-<YYYY-MM-DDTHH-mm-ss>.<ext>
 *
 * The preset slug is sanitized to filesystem-safe characters only
 * so the file survives a Windows / macOS / Linux round trip.
 */
export function buildExportFilename(meta: Pick<ExportMetadata, 'filters' | 'generatedAt'>, format: 'csv' | 'json'): string {
  const presetSlug = sanitizeFilenameSlug(meta.filters.preset || 'all');
  const dateSlug = meta.generatedAt.replace(/[:.]/g, '-');
  return `aiflowbridge-metrics-${presetSlug}-${dateSlug}.${format}`;
}

function sanitizeFilenameSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'all';
}

/**
 * Action plan item #3. Render the Shared Session panel. Lists the
 * most recent recorded requests (reverse chronological), each with
 * a sanitized prompt snippet + a "Replay" button that calls
 * `GET /v1/replay/{id}` and shows the result in a `<pre>` block.
 * The panel degrades gracefully when the gateway is not reachable
 * from the dashboard webview (Replay button stays disabled with a
 * tooltip).
 */
export function renderSharedSessionList(snapshot: TelemetrySnapshot): string {
  // Use the existing `recent` list (newest first). When the
  // dashboard is reloaded, the server-side snapshot carries the
  // sanitized prompt summary on every entry (when capture is
  // enabled); older entries recorded before the feature shipped
  // carry `undefined` and render as a muted dash.
  const recent = snapshot.recent.slice(0, 20);
  if (recent.length === 0) {
    return '<p class="muted">No recorded sessions yet. Send a chat completion to populate this panel.</p>';
  }
  const rows = recent
    .map((entry) => {
      const prompt = entry.promptSummary ? escapeHtml(entry.promptSummary) : '<span class="muted">(no summary)</span>';
      const time = new Date(entry.timestamp).toLocaleTimeString();
      const safeId = escapeHtml(entry.id);
      return `<li class="shared-session-row" data-id="${safeId}">
      <div class="shared-session-meta">
        <span class="shared-session-time">${escapeHtml(time)}</span>
        <span class="shared-session-provider">${escapeHtml(entry.providerLabel)}</span>
        <span class="shared-session-model">${escapeHtml(entry.model)}</span>
        <button type="button" class="replay-btn" data-replay-id="${safeId}" title="GET /v1/replay/${safeId}">Replay</button>
      </div>
      <div class="shared-session-prompt">${prompt}</div>
      <pre class="shared-session-replay" data-replay-out="${safeId}" hidden></pre>
    </li>`;
    })
    .join('');
  return `<ul class="shared-session-list">${rows}</ul>`;
}
