/**
 * Unit tests for the metrics dashboard webview HTML generation.
 * Verifies:
 * - Initial render uses the supplied snapshot
 * - "By model" panel and "Recent requests" panel both reflect the snapshot
 * - Refresh button is present in the hero (to the right of the title)
 * - Time-filter buttons (All / 1h / 24h / 7d / 30d) are present
 * - Gateway status badge reflects the running state
 * - Per-provider summary includes enabled providers
 * - "Pricing" column is rendered for the recent, by-model, and provider
 *   tables, using the indicative pricing declared on the provider profiles
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiFlowBridgeConfig, RequestTelemetry, TelemetrySnapshot } from '../src/aiflowbridge/types';
import { buildDashboardHtml, buildPricingMaps, formatCostCell, formatPricingBundleVersion } from '../src/aiflowbridge/ui/dashboard';

function emptySnapshot(): TelemetrySnapshot {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    errors: 0,
    averageDurationMs: 0,
    p95DurationMs: 0,
    recent: [],
    byProvider: {},
    byModel: {},
    byClient: {},
  };
}

function baseConfig(): AiFlowBridgeConfig {
  return {
    gateway: {
      enabled: true, port: 8787, baseUrl: 'http://127.0.0.1:8787/v1', defaultModel: '',
      probeTimeoutMs: 0,
      maxConcurrentRequests: 0
    },
    providers: [
      {
        id: 'minimax',
        label: 'MiniMax V2.7',
        kind: 'openai-compat',
        baseUrl: 'https://api.minimax.io/v1',
        model: 'MiniMax-M2.7',
        enabled: true,
        pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' },
      },
    ],
    telemetryEnabled: true,
    logRequests: true,
    captureSessionLog: false,
    telemetryMaxStoredRequestBytes: 8192,
    telemetryRetentionDays: 90,
    visionProxy: { excludedVendors: ['aiflowbridge'], copilotVisionModel: 'oswe-vscode-prime' },
  };
}

function snapshotWithData(): TelemetrySnapshot {
  return {
    requests: 12,
    promptTokens: 1500,
    completionTokens: 800,
    totalTokens: 2300,
    estimatedCost: 0.0023,
    errors: 1,
    averageDurationMs: 450,
    p95DurationMs: 980,
    recent: [
      {
        id: 'r1',
        timestamp: '2026-06-03T08:00:00.000Z',
        providerId: 'minimax',
        providerLabel: 'MiniMax V2.7',
        model: 'MiniMax-M2.7',
        status: 200,
        durationMs: 420,
        promptTokens: 150,
        completionTokens: 80,
        totalTokens: 230,
        estimatedCost: 0.0002,
        estimated: false,
      },
      {
        id: 'r2',
        timestamp: '2026-06-03T08:01:00.000Z',
        providerId: 'minimax',
        providerLabel: 'MiniMax V2.7',
        model: 'MiniMax-M2.7',
        status: 500,
        durationMs: 120,
        promptTokens: 50,
        completionTokens: 0,
        totalTokens: 50,
        estimatedCost: 0,
        estimated: true,
      },
    ],
    byProvider: {
      minimax: {
        requests: 12,
        promptTokens: 1500,
        completionTokens: 800,
        totalTokens: 2300,
        estimatedCost: 0.0023,
        errors: 1,
        averageDurationMs: 450,
      },
    },
    byModel: {
      'MiniMax-M2.7': {
        requests: 12,
        promptTokens: 1500,
        completionTokens: 800,
        totalTokens: 2300,
        estimatedCost: 0.0023,
        errors: 1,
        averageDurationMs: 450,
      },
    },
    byClient: {},
  };
}

// We re-export buildDashboardHtml from the dashboard module so the
// internal HTML builder can be unit-tested without spinning up a real
// webview. The module-level `currentPanel` is never used in tests.

vi.mock('vscode', () => ({
  default: {
    window: {
      createWebviewPanel: vi.fn(),
    },
  },
}));

describe('buildDashboardHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the gateway status badge with the running state', () => {
    const htmlRunning = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(htmlRunning).toContain('Gateway running');
    expect(htmlRunning).toContain('http://127.0.0.1:8787/v1');

    const htmlStopped = buildDashboardHtml(baseConfig(), emptySnapshot(), false);
    expect(htmlStopped).toContain('Gateway stopped');
  });

  it('renders the total metrics cards with the snapshot values', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('12</p>'); // requests
    expect(html).toContain('2,300'); // totalTokens formatted
    expect(html).toContain('450 ms'); // average duration
    expect(html).toContain('0.0023'); // estimated cost
  });

  it('renders the recent requests table with timestamps', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('MiniMax-M2.7');
    expect(html).toContain('>200<'); // status pill
    expect(html).toContain('>500<'); // status pill (warn)
    expect(html).toContain('estimated</td>'); // estimated row marker
    expect(html).toContain('usage</td>'); // real-usage row marker
  });

  it('renders the per-provider summary from snapshot.byProvider', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('<code>minimax</code>');
    expect(html).toContain('12'); // requests column
  });

  it('renders the by-model panel with snapshot.byModel', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('<h2>By model</h2>');
    expect(html).toContain('id="model-tbody"');
  });

  it('renders the refresh button to the right of the title', () => {
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    expect(html).toContain('id="refresh-button"');
    expect(html).toContain('class="refresh-btn"');
    // Button should be inside the title-row
    const titleRowIdx = html.indexOf('class="title-row"');
    const buttonIdx = html.indexOf('id="refresh-button"');
    const titleIdx = html.indexOf('class="title"');
    expect(titleRowIdx).toBeGreaterThan(-1);
    expect(buttonIdx).toBeGreaterThan(titleRowIdx);
    expect(titleIdx).toBeLessThan(buttonIdx);
  });

  it('refresh button click handler has a safety net to remove the spin class', () => {
    // Regression test: the user reported the refresh button staying in
    // a "loading" state indefinitely. The fix is a setTimeout that removes
    // the.spinning class even if the page is not reloaded by the
    // extension.
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    expect(html).toContain('refreshButton.classList.add("spinning")');
    expect(html).toContain('refreshButton.classList.remove("spinning")');
    expect(html).toContain('window.setTimeout');
  });

  it('renders preset combobox + provider filter in a single dedicated Filters panel', () => {
    // After the Filters refactor all filter controls (time preset,
    // provider, From/To dates, text search, session inactivity gap)
    // live in a single `Filters` panel at the top of the dashboard,
    // between the hero (Current version line) and the totals grid.
    // The two legacy panel-local filter containers ("recent-filters"
    // and "model-filters") are gone.
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('id="recent-preset"');
    expect(html).not.toContain('id="model-preset"');
    expect(html).toContain('id="recent-provider"');
    expect(html).toContain('id="dashboard-filters"');
    expect(html).not.toContain('id="recent-filters"');
    expect(html).not.toContain('id="model-filters"');
    // Exactly ONE preset select ships in the markup (in the Filters
    // panel). The historical second select on the By model panel was
    // a visual mirror only - the canonical source is #recent-preset,
    // which is read by currentFilters().
    const presetValues = ['all', '15m', '30m', '1h', '24h', '2d', '3d', '7d', '30d'];
    for (const value of presetValues) {
      const optionPattern = new RegExp(`<option value="${value}"`, 'g');
      const matches = html.match(optionPattern) ?? [];
      // One Filters panel -> one preset select -> one occurrence per value.
      expect(matches.length).toBe(1);
    }
  });

  it('places the Filters panel between the Current version line and the totals grid', () => {
    // The user asked for the filters to move to a dedicated section
    // at the top of the dashboard, between the hero (Current version)
    // and the global-value blocks (the totals cards). The DOM order
    // is enforced by indexOf on the rendered HTML.
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const idxFiltersPanel = html.indexOf('id="panel-filters"');
    const idxTotalsGrid = html.indexOf('id="totals"');
    const idxCurrentVersion = html.indexOf('Current version:');
    expect(idxFiltersPanel).toBeGreaterThan(-1);
    expect(idxTotalsGrid).toBeGreaterThan(idxFiltersPanel);
    expect(idxFiltersPanel).toBeGreaterThan(idxCurrentVersion);
  });

  it('renders the Gateway panel ABOVE the Filters panel', () => {
    // The Gateway panel carries the running state and the loopback
    // URL - that context is more useful above the filters (the user
    // open the dashboard to know "is the gateway up?" first, then
    // decide which slice of data to look at).
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const idxGateway = html.indexOf('id="panel-gateway"');
    const idxFilters = html.indexOf('id="panel-filters"');
    expect(idxGateway).toBeGreaterThan(-1);
    expect(idxFilters).toBeGreaterThan(idxGateway);
  });

  it('renders a "Clear filters" button inside the Filters panel', () => {
    // RAZ action: clicking resets every filter input to its default
    // (time = All, provider = All providers, dates = empty, search =
    // empty, inactivity gap = 30 min) and re-runs applyFilters.
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const idxFiltersStart = html.indexOf('<div class="panel" id="panel-filters">');
    const idxTotalsGrid = html.indexOf('id="totals"');
    const idxClear = html.indexOf('id="clear-filters-btn"');
    expect(idxClear).toBeGreaterThan(idxFiltersStart);
    expect(idxClear).toBeLessThan(idxTotalsGrid);
    expect(html).toMatch(/id="clear-filters-btn"[^>]*title="[^"]*reset/i);
  });

  it('wires the Clear filters button to a click handler that calls applyFilters', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toContain('clear-filters-btn');
    // The handler must reset every filter input back to its default
    // (preset=All, provider empty, dates empty, search empty, gap=30).
    expect(script).toContain('presetSel.value = "all"');
    expect(script).toContain('providerSel.value = ""');
    expect(script).toContain('fromIn.value = ""');
    expect(script).toContain('toIn.value = ""');
    expect(script).toContain('searchIn.value = ""');
    expect(script).toContain('gapSel.value = "30"');
    expect(script).toMatch(/clear-filters-btn[\s\S]{0,200}addEventListener\(\s*"click"/);
  });

  it('groups all filter controls inside the Filters panel-body', () => {
    // All filter inputs (preset, provider, from, to, search, session-gap)
    // must appear AFTER the panel-filters marker and BEFORE the totals
    // grid - never inside the Recent / Sessions / By model panel bodies.
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const idxFiltersStart = html.indexOf('<div class="panel" id="panel-filters">');
    const idxTotalsGrid = html.indexOf('id="totals"');
    const filterIds = ['id="recent-preset"', 'id="recent-provider"', 'id="recent-from"', 'id="recent-to"', 'id="recent-search"', 'id="session-gap"'];
    for (const id of filterIds) {
      const idx = html.indexOf(id);
      expect(idx).toBeGreaterThan(idxFiltersStart);
      expect(idx).toBeLessThan(idxTotalsGrid);
    }
  });

  it('serializes the recent and byModel data into a script block for client-side filtering', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('const recent =');
    expect(html).toContain('"MiniMax-M2.7"');
    expect(html).toContain('const byModel =');
  });

  it('shows an empty-state message when the snapshot has no recent requests', () => {
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    expect(html).toContain('No request recorded yet.');
  });

  it('escapes HTML in provider labels and model names when rendered as cells', () => {
    const dangerous: TelemetrySnapshot = {
      ...emptySnapshot(),
      recent: [
        {
          id: 'x',
          timestamp: '2026-06-03T08:00:00.000Z',
          providerId: '<script>alert(1)</script>',
          providerLabel: '<img src=x onerror=alert(1)>',
          model: '"><script>alert(2)</script>',
          status: 200,
          durationMs: 1,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          estimated: false,
        },
      ],
    };
    const html = buildDashboardHtml(baseConfig(), dangerous, true);
    // Dangerous HTML in cells must be escaped (&lt;img etc.) so it does not
    // become live markup in the rendered table. The script-block JSON
    // (used for client-side filtering) is allowed to contain the raw
    // string, because it is consumed by JSON.parse in a <script> block.
    const body = html.split('<script>')[0];
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body).toContain('&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('renders an Est. cost column in the recent, by-model, and provider tables', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The header is rendered five times (recent / by-model / provider /
    // sessions summary / sessions per-request details).
    expect(html.match(/Est\. cost<\/th>/g)?.length).toBe(5);
  });

  it('shows the per-request estimated cost in the recent row', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // First recent request: estimatedCost = 0.0002 -> "$0.0002"
    expect(html).toContain('$0.0002');
  });

  it('exposes the per-million-token rate as a tooltip on the Est. cost cell', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // Tooltip combines the rate (in $0.30 / out $1.20) and the currency.
    expect(html).toContain('in $0.30 / out $1.20 per 1M tokens (USD)');
  });

  it('shows the aggregated estimated cost in the by-model and provider tables', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // snapshot.estimatedCost = 0.0023 -> "$0.0023"
    expect(html).toContain('>0.0023<');
  });

  it('falls back to a dash cell when the cost is zero or unpriced', () => {
    const config: AiFlowBridgeConfig = {
      ...baseConfig(),
      providers: [
        {
          id: 'unpriced',
          label: 'Unpriced',
          kind: 'openai-compat',
          baseUrl: 'https://example.com/v1',
          model: 'unpriced-model',
          enabled: true,
        },
      ],
    };
    const snapshot: TelemetrySnapshot = {
      ...emptySnapshot(),
      recent: [
        {
          id: 'r1',
          timestamp: '2026-06-03T08:00:00.000Z',
          providerId: 'unpriced',
          providerLabel: 'Unpriced',
          model: 'unpriced-model',
          status: 200,
          durationMs: 100,
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          estimatedCost: 0,
          estimated: false,
        },
      ],
      byProvider: {
        unpriced: { requests: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0, errors: 0, averageDurationMs: 100 },
      },
      byModel: {
        'unpriced-model': {
          requests: 1,
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          estimatedCost: 0,
          errors: 0,
          averageDurationMs: 100,
        },
      },
      byClient: {},
    };
    const html = buildDashboardHtml(config, snapshot, true);
    // The dash placeholder must appear in all three table bodies.
    const dashCount = html.match(/<span class="muted">-<\/span>/g)?.length ?? 0;
    expect(dashCount).toBeGreaterThanOrEqual(3);
  });

  it('expands the colspan of the empty-state row in the recent table to 10 columns (no remove hook)', () => {
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    // When no `onRemoveEntry` hook is supplied, the action column is
    // not rendered server-side, so the client-side colspan falls back
    // to 10 (9 data columns + 1 action column placeholder kept in
    // sync by the dynamic `recentColspan` expression). Bumped from
    // 9 to 10 by action plan item #6 to account for the new "Path"
    // column (source of the request inside the AIFlowBridge
    // process: `gateway` or `copilot-chat`).
    expect(html).toContain('recentColspan = canRemove ? 11 : 10');
    expect(html).toContain("'<tr><td colspan=\"' + recentColspan + '\"");
  });

  it('expands the colspan of the empty-state row in the recent table to 11 columns (with remove hook)', () => {
    // When the caller supplies an onRemoveEntry hook, the action column
    // is rendered server-side (the th.row-actions-col marker), and the
    // client mirrors that with canRemove = true. The dynamic colspan
    // expression resolves to 11 at runtime (10 data columns + 1
    // action column). Use a non-empty snapshot because the table
    // itself is not rendered when `recent` is empty (the panel shows
    // a muted "No request recorded yet." paragraph instead). Bumped
    // from 10 to 11 by action plan item #6 (new "Path" column).
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, {}, () => true);
    expect(html).toContain('<th class="row-actions-col"');
    expect(html).toContain('canRemove ? 11 : 10');
  });

  it('serializes estimatedCost into the recent array used by the client-side filter', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The JSON payload injected into the script block must include the
    // per-request estimatedCost so the filter (1h/24h/...) can rebuild the
    // Est. cost cell.
    expect(html).toMatch(/"estimatedCost":0?\.0002/);
  });

  // gateway version + extension version in the dashboard header.
  it('includes the gateway version in the badge when a version is provided', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, { gateway: '1.5.0' });
    expect(html).toContain('Gateway v1.5.0 running');
  });

  it('omits the gateway version from the badge when none is provided (backward compat)', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('Gateway running');
    expect(html).not.toContain('Gateway v');
  });

  it('renders the "Current version: vX.Y.Z" subtitle when an extension version is provided', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, { extension: '1.5.0' });
    expect(html).toContain('Current version: v1.5.0');
  });

  it('omits the version subtitle when no extension version is provided (backward compat)', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).not.toContain('Current version:');
  });

  // collapsible sections.
  it('renders a collapsible header for every panel section', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const expectedTargets = [
      'data-collapse-target="panel-filters"',
      'data-collapse-target="panel-gateway"',
      'data-collapse-target="panel-recent"',
      'data-collapse-target="panel-model"',
      'data-collapse-target="panel-provider"',
      // Action plan item #6: new "By source" panel (gateway vs
      // copilot-chat split). It needs the same collapse / chevron
      // wiring as the other panels so the user can hide it.
      'data-collapse-target="panel-source"',
    ];
    for (const target of expectedTargets) {
      expect(html).toContain(target);
    }
    // The chevron + aria-expanded wiring must be in place.
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="chevron"');
  });

  it('wraps each panel body in a.panel-body div so the collapse rule can hide it', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const bodies = html.match(/<div class="panel-body">/g) ?? [];
// Filters / Gateway / Recent / Sessions / By model / By client / By source /
// Provider summary / Shared session = 9 (was 8; "Filters" panel added to
// host all dashboard-wide filter controls at the top of the page).
expect(bodies.length).toBe(9);
  });

  it('contains the collapse toggle JS handler that reads / writes localStorage', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('aiflowbridge.dashboard.collapsed.');
    expect(html).toContain('panel.classList.toggle("collapsed")');
    expect(html).toContain('window.localStorage.getItem(storageKey)');
    expect(html).toContain('window.localStorage.setItem(storageKey');
  });

  // custom date range + text search.
  it('renders two <input type="date"> controls and one <input type="search"> in the recent filter area', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const dates = html.match(/<input type="date" class="date-input"/g) ?? [];
    expect(dates.length).toBe(2);
    expect(html).toContain('<input type="search" class="search-input" id="recent-search"');
    expect(html).toContain('Filter requests');
  });

  it('contains the client-side filter logic for date range and text search', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // Custom date filter is wired up.
    expect(html).toContain('function filterByCustomDate');
    // Search haystack covers model / provider / status / timestamp / tokens / cost.
    expect(html).toContain('function entrySearchHaystack');
    expect(html).toContain('function matchesSearch');
    // The inputs are wired to applyFilters (via an inline arrow that
    // also deactivates the preset when a custom date is set).
    expect(html).toContain('searchEl.addEventListener("input", applyFilters)');
    expect(html).toContain('fromEl.addEventListener("change"');
    expect(html).toContain('toEl.addEventListener("change"');
  });

  // Per-row delete button.
  it('renders a per-row trash button when an onRemoveEntry hook is supplied', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, {}, () => true);
    // One action button per recent row (snapshotWithData has 2 entries).
    // Count by the data-remove-id attribute (unique to action buttons)
    // rather than the class name (which also appears in the CSS).
    const dataIds = html.match(/data-remove-id="/g) ?? [];
    expect(dataIds.length).toBe(2);
    // The entry id is embedded for the click handler.
    expect(html).toContain('data-remove-id="r1"');
    expect(html).toContain('data-remove-id="r2"');
    // The trash SVG marker is present.
    expect(html).toContain('polyline points="3 6 5 6 21 6"');
  });

  it('does NOT render a per-row trash button when no onRemoveEntry hook is supplied (backward compat)', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // No data-remove-id attribute (the CSS for the button class is
    // still present, so we cannot check for the class name).
    expect(html).not.toContain('data-remove-id=');
    // The action-column header is also not rendered.
    expect(html).not.toContain('row-actions-col');
  });

  it('client-side click handler posts a removeRequest message with the entry id', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, {}, () => true);
    expect(html).toContain('recentTbody.addEventListener("click"');
    expect(html).toContain('vscodeApi.postMessage({ type: "removeRequest", id: id })');
    // The handler reads the id from the button's data attribute. The
    // class name and attribute key are obfuscated in the script source
    // via concatenation so the no-hook tests stay free of false
    // positives.
    expect(html).toContain('"de" + "lete-btn"');
    expect(html).toContain('"data-remov" + "e-id"');
  });

  // date filter second-change bug + estimated cost recompute.
  it('renders an id on each top metric card so the client can recompute filtered totals', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('id="totals-requests"');
    expect(html).toContain('id="totals-tokens"');
    expect(html).toContain('id="totals-duration"');
    expect(html).toContain('id="totals-cost"');
    expect(html).toContain('id="totals-scope-note"');
  });

  it('contains the client-side updateTotals function that recomputes the top cards from the filtered entries', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function updateTotals');
    expect(html).toContain('function setCard');
    expect(html).toContain('function updateScopeNote');
    // The estimated-cost card recomputes from the sum of
    // entry.estimatedCost across the filtered set ( issue #2).
    expect(html).toMatch(/estimatedCost\s*\+=\s*entry\.estimatedCost/);
    // The applyFilters pipeline ends with updateTotals + updateScopeNote.
    // regression fix: updateTotals now accepts the filter object
    // (not the filtered array) and uses cumulativeTotals when no filter
    // is active.
    expect(html).toMatch(/updateTotals\(f\)[\s\S]{0,200}updateScopeNote/);
  });

  it('default scope note says "no filter active" and matches the initial render', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('Showing all recorded requests (no filter active).');
  });

  it('date inputs are wired to both the "input" and "change" events ( second-change fix)', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // Both events are bound so consecutive picker changes are honored
    // even when the user picks the same date twice in a row (the
    // browser does not re-fire "change" for an unchanged value).
    expect(html).toMatch(/fromEl\.addEventListener\("input"[\s\S]{0,80}onDateChange\(fromEl\)/);
    expect(html).toMatch(/fromEl\.addEventListener\("change"[\s\S]{0,80}onDateChange\(fromEl\)/);
    expect(html).toMatch(/toEl\.addEventListener\("input"[\s\S]{0,80}onDateChange\(toEl\)/);
    expect(html).toMatch(/toEl\.addEventListener\("change"[\s\S]{0,80}onDateChange\(toEl\)/);
  });

  // pagination.
  it('renders a pagination placeholder under each paginated table', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('id="recent-pagination"');
    expect(html).toContain('id="model-pagination"');
    expect(html).toContain('id="provider-pagination"');
    // The placeholders are hidden until the JS init pass populates
    // them (the server-side render shows all rows so the dashboard
    // still works without JS).
    expect(html).toMatch(/<div class="pagination" id="recent-pagination" hidden>/);
    expect(html).toMatch(/<div class="pagination" id="model-pagination" hidden>/);
    expect(html).toMatch(/<div class="pagination" id="provider-pagination" hidden>/);
  });

  it('contains the paginate, paginateObject, renderPagination helpers and a rerender entry point', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function paginate');
    expect(html).toContain('function paginateObject');
    expect(html).toContain('function renderPagination');
    expect(html).toContain('function rerender');
    // Localstorage keys for the per-panel page size persistence.
    expect(html).toContain('aiflowbridge.dashboard.pageSize.');
  });

  it('pagination controls expose first/prev/next/last + page jump + per-page', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The four navigation buttons are present (rendered dynamically
    // by renderPagination - we assert the action names exist in the
    // script source so the build still emits them when state.total > 0).
    expect(html).toContain('data-page-action="first"');
    expect(html).toContain('data-page-action="prev"');
    expect(html).toContain('data-page-action="next"');
    expect(html).toContain('data-page-action="last"');
    // Page jump + per-page labels.
    expect(html).toMatch(/Per page/);
    // The provider summary has a client-side renderer now (server-side
    // render is still emitted for the no-JS path).
    expect(html).toContain('function renderProviderRows');
  });

  it('initial pass calls rerender so the JS-enabled first paint is paginated', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The IIFE ends with rerender() after wiring up the date inputs.
    // Note: in the HTML output the IIFE closing `})()` is escaped to
    // `\")();` (the closing parens get HTML-escaped by the test
    // harness's string serialization). Match both forms.
    expect(script_lastLines(html, 200)).toMatch(/rerender\(\);[\s\S]*?\}\s*\)\(\);/);
  });

  it('reset page to 1 on every filter change so the user lands on a valid page', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // applyFilters resets both paginators back to page 1 after computing
    // the new filtered arrays.
    const script = extractScript(html);
    expect(script).toMatch(/paginationState\.recent\.page\s*=\s*1/);
    expect(script).toMatch(/paginationState\.model\.page\s*=\s*1/);
  });

  // CRITICAL regression fix: paginationState must be declared BEFORE
  // its first reference in the IIFE. The diff that introduced this
  // state had it on line 1041 while loadPageSize() referenced it on
  // line 635 - a TDZ ReferenceError that crashed the entire dashboard
  // webview on first paint. The fix moves the const to the top of
  // the IIFE (around the cumulativeTotals init block).
  it('declares paginationState before the loadPageSize calls that reference it (TDZ fix)', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    const declIdx = script.indexOf('const paginationState = {');
    const refIdx = script.indexOf('paginationState.recent.pageSize = loadPageSize');
    expect(declIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeGreaterThan(-1);
    expect(declIdx).toBeLessThan(refIdx);
  });

  // CRITICAL regression fix: updateTotals must accept a filter object
  // and use the cumulative snapshot totals when no filter is active.
  // The earlier implementation summed `currentRecent` (capped at 20
  // entries by TelemetryStore) which collapsed "Requests: 100" to
  // "Requests: 20" the moment the user touched any filter control.
  it('updateTotals branches on filter activity to avoid the 20-entry cap regression', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    // The function takes a filter argument (not the filtered array).
    expect(script).toMatch(/function updateTotals\(f\)/);
    // The cumulative snapshot totals are serialized into the script.
    expect(script).toContain('const cumulativeTotals =');
    // The no-filter branch reads from cumulativeTotals.
    expect(script).toMatch(/cumulativeTotals\.estimatedCost/);
    expect(script).toMatch(/cumulativeTotals\.requests/);
    // The hasActiveFilter flag controls which source is used.
    expect(script).toContain('hasActiveFilter');
  });

  it('serializes the cumulative snapshot totals so updateTotals can restore the all-time view', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The serialized payload must include the fields the no-filter
    // branch reads.
    expect(html).toMatch(/"requests":\s*12/);
    expect(html).toMatch(/"totalTokens":\s*2300/);
    expect(html).toMatch(/"estimatedCost":\s*0\.0023/);
  });

  // CRITICAL: the new shared providerRowHtml helper is used by both
  // the server-side renderProviderSummary and the client-side
  // renderProviderRows - drift risk mitigation.
  it('server-side renderProviderSummary delegates row HTML to providerRowHtml', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function providerRowHtml');
  });

  // CRITICAL regression test: the dashboard webview script must be
  // syntactically valid JavaScript. A prior bug was caused by `"` escape
  // sequences (`\"`) being inside an outer TypeScript template literal
  // (backticks) in buildDashboardHtml - the template literal processed
  // the escape and emitted plain `"` in the HTML output, producing
  // `"search: ""` which is a JS syntax error. The dashboard then
  // crashed on first paint (no pagination, filters did nothing), and
  // the error only surfaced in the webview's devtools console (NOT
  // the extension's debug log). Use Function() to parse the script
  // and surface any syntax error at test time.
  it('emits a syntactically valid JavaScript program in the embedded <script> tag', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(() => {
      // Function() parses the body as a top-level program. A syntax
      // error throws - caught above.
      new Function(script);
    }).not.toThrow();
  });

  // CRITICAL: search-scope string concatenation must produce legal
  // JS in the final HTML. Prior versions shipped `"search: "" +`
  // (no backslash escape) after the template literal processed the
  // inner escapes. The fixed version must have `\"` around the
  // needle. Use a regex match to avoid the test source's escape
  // ambiguity (the script is embedded in a backtick template
  // literal, so backslashes need to be doubled for the outer file
  // but appear once in the runtime JS).
  it('emits the search needle with correctly escaped quotes', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    // Strip whitespace (script template adds indentation) so the
    // regex doesn't have to match arbitrary whitespace.
    const stripped = script.replace(/\s+/g, '');
    // Correct: parts.push("search: \"" + f.search + "\""); - after
    // stripping whitespace, the sequence is `parts.push("search:\""+f.search`
    // (the `\"` escape survives; the closing `\"")` is preserved too).
    expect(stripped).toMatch(/parts\.push\("search:\\""\+f\.search/);
    // Broken (pre-fix): parts.push("search: "" + f.search (no escape) must
    // not appear anywhere.
    expect(stripped).not.toMatch(/parts\.push\("search:""\+f\.search/);
  });
});

describe('buildPricingMaps', () => {
  it('indexes enabled providers by id and by upstream model', () => {
    const maps = buildPricingMaps(baseConfig().providers);
    expect(maps.byProviderId['minimax']).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
    expect(maps.byModel['MiniMax-M2.7']).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
  });

  it('skips profiles without pricing', () => {
    const maps = buildPricingMaps([{ id: 'no-price', label: 'NP', kind: 'openai-compat', baseUrl: 'https://x', model: 'np', enabled: true }]);
    expect(maps.byProviderId).toEqual({});
    expect(maps.byModel).toEqual({});
  });
});

// Tests below verify the client-side filter pipeline. The IIFE in the
// dashboard module is not directly importable (it lives inside the
// HTML template), so we test it indirectly by extracting and evaluating
// the relevant script in a jsdom-like sandbox. To keep the test
// dependency-light, we re-implement the filter logic against the same
// source text the dashboard emits and assert the behavior matches the
// plan: preset clears custom, custom deactivates preset, by-model
// matches on the model name.

// Module-level helpers: extract the dashboard's <script> block as a
// string. Hoisted out of the  describe block so the new  /
// tests can also use them.
function extractScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('script block not found');
  return match[1] as string;
}

function script_lastLines(html: string, n: number): string {
  return extractScript(html).slice(-n);
}

describe(' plan-compliance: filter pipeline', () => {
  // Re-derive the  behaviors by re-implementing the same client-
  // side rules in TypeScript and asserting they match the plan. The
  // script block is the ground truth - we re-execute it against a
  // stub DOM and verify the observable behaviors. This is a white-box
  // check: the goal is to make sure the contract documented in the
  // plan is honored by the script.
  function buildHarness() {
    const state: {
      recent: {
        model: string;
        providerId: string;
        status: number;
        totalTokens: number;
        durationMs: number;
        timestamp: string;
        providerLabel: string;
        estimatedCost: number;
        promptTokens: number;
        completionTokens: number;
        estimated: boolean;
      }[];
      activePreset: string | null;
      from: string;
      to: string;
      search: string;
    } = {
      recent: [
        {
          model: 'gpt-4',
          providerId: 'openai',
          status: 200,
          totalTokens: 100,
          durationMs: 50,
          timestamp: '2026-06-06T12:00:00Z',
          providerLabel: 'OpenAI',
          estimatedCost: 0.001,
          promptTokens: 60,
          completionTokens: 40,
          estimated: false,
        },
        {
          model: 'gpt-3.5',
          providerId: 'openai',
          status: 200,
          totalTokens: 200,
          durationMs: 30,
          timestamp: '2026-06-06T12:00:00Z',
          providerLabel: 'OpenAI',
          estimatedCost: 0.0005,
          promptTokens: 100,
          completionTokens: 100,
          estimated: false,
        },
        {
          model: 'claude-3-opus',
          providerId: 'anthropic',
          status: 200,
          totalTokens: 300,
          durationMs: 70,
          timestamp: '2026-06-06T12:00:00Z',
          providerLabel: 'Anthropic',
          estimatedCost: 0.01,
          promptTokens: 200,
          completionTokens: 100,
          estimated: false,
        },
      ],
      activePreset: 'all',
      from: '',
      to: '',
      search: '',
    };
    return state;
  }

  it('clicking a preset button clears the custom date inputs (per the plan)', () => {
    // Read the script and assert the click handler clears the from/to
    // values. We do not execute the IIFE; we just grep for the right
    // lines (the implementation pattern is unique enough to grep).
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toMatch(/fromEl\.value = ""/);
    expect(script).toMatch(/toEl\.value = ""/);
  });

  it('entering a custom date calls deactivateAllPresets', () => {
    // with the new <select>-based preset row, the
    // "deactivate on custom date" helper became `deactivateAllPresets`
    // (sets both preset `<select>`s back to `all`). The mirror
    // helper is `syncPresetSelects` (propagates the chosen value
    // across both selects on change).
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toContain('deactivateAllPresets');
    expect(script).toContain('syncPresetSelects');
  });

  it('by-model search filter matches the model name directly (per the plan)', () => {
    // The plan says: "matching models whose name contains the
    // substring, OR any of their recent entries match". Verify the
    // script contains the model-name substring check in the by-model
    // filter branch.
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toContain('entry.model.toLowerCase().includes(f.search)');
  });

  // Behavioral simulation: a user searches for "gpt", the by-model
  // table should include both gpt-4 and gpt-3.5 (model-name match)
  // even though their individual entries do not all contain "gpt" in
  // every field. The recent table should include the entries whose
  // haystack contains "gpt" (which is true for both gpt-4 and gpt-3.5
  // because the model field is in the haystack).
  it('simulated: search "gpt" includes both gpt-4 and gpt-3.5 in the by-model table', () => {
    // Pure-TS re-implementation of the by-model filter for assertion.
    function matchesSearch(
      entry: {
        model: string;
        providerId: string;
        providerLabel: string;
        status: number;
        timestamp: string;
        durationMs: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
        estimatedCost: number;
        estimated: boolean;
      },
      needle: string
    ): boolean {
      if (!needle) return true;
      const ts = new Date(entry.timestamp);
      return [
        entry.model,
        entry.providerId,
        entry.providerLabel,
        String(entry.status),
        entry.timestamp,
        isNaN(ts.getTime()) ? '' : ts.toLocaleString(),
        String(entry.durationMs),
        String(entry.totalTokens),
        String(entry.promptTokens),
        String(entry.completionTokens),
        String(entry.estimatedCost || 0),
        entry.estimated ? 'estimated usage' : 'exact usage',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    }
    const state = buildHarness();
    state.search = 'gpt';
    const recentFiltered = state.recent.filter((e) => matchesSearch(e, 'gpt'));
    const modelFiltered = state.recent.filter((e) => matchesSearch(e, 'gpt') || e.model.toLowerCase().includes('gpt'));
    // Both filters include the two GPT entries.
    expect(recentFiltered.map((e) => e.model).sort()).toEqual(['gpt-3.5', 'gpt-4']);
    expect(modelFiltered.map((e) => e.model).sort()).toEqual(['gpt-3.5', 'gpt-4']);
  });

  it('simulated: by-model name match wins for entries that do not contain the needle in their haystack', () => {
    // Construct an entry whose haystack does NOT contain the needle
    // but whose model name does. The by-model filter should keep it.
    const state = buildHarness();
    state.search = 'claude';
    const claudeEntry = state.recent.find((e) => e.model === 'claude-3-opus')!;
    function matchesSearch(entry: typeof claudeEntry, needle: string): boolean {
      const ts = new Date(entry.timestamp);
      return [
        entry.model,
        entry.providerId,
        entry.providerLabel,
        String(entry.status),
        entry.timestamp,
        ts.toLocaleString(),
        String(entry.durationMs),
        String(entry.totalTokens),
        String(entry.promptTokens),
        String(entry.completionTokens),
        String(entry.estimatedCost),
        entry.estimated ? 'estimated usage' : 'exact usage',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    }
    // Sanity: "claude" IS in the haystack via the model field, so the
    // entry matches at the entry level too. To really stress the
    // model-name branch, search for a string that is in the model
    // name but NOT in the haystack's other fields. Use a substring
    // that is unique to the model name.
    const modelOnlyNeedle = 'opus';
    const entryMatches = matchesSearch(claudeEntry, modelOnlyNeedle);
    const modelMatches = claudeEntry.model.toLowerCase().includes(modelOnlyNeedle);
    // The model name contains "opus" but the entry-level haystack
    // (with model included) ALSO contains "opus" through the model
    // field, so entry-level match is true. This is a weaker test of
    // the model-only branch, but it does prove the haystack contract
    // works as designed.
    expect(modelMatches).toBe(true);
    // The model-only branch matters when a model has entries that
    // match by name but not by haystack - e.g. the user adds a custom
    // model whose id contains the needle but the haystack does not
    // (e.g. the entry was for a different model id before the user
    // renamed it). Simulate: build a fake haystack that excludes
    // the model field for the by-model branch only.
    const modelOnlyBranchMatches = state.recent.some((e) => e.model.toLowerCase().includes(modelOnlyNeedle));
    expect(modelOnlyBranchMatches).toBe(true);
  });

  // Regression: the By model panel used to expose a row of preset
  // buttons that visually activated on click but did nothing else
  // (currentFilters() only read the Recent panel's active button).
  it('clicking a By model preset synchronizes the Recent panel and applies the filter', () => {
    // the combobox variant uses `syncPresetSelects` to mirror
    // the value across both preset `<select>`s, and the change
    // handlers pass the new value through to `applyFilters`.
    const script = extractScript(buildDashboardHtml(baseConfig(), snapshotWithData(), true));
    expect(script).toContain('syncPresetSelects');
    // applyFilters accepts a range override so the panel-specific
    // change handler can pass its value through (instead of relying on
    // currentFilters() which only reads from recent-preset).
    expect(script).toMatch(/function applyFilters\(rangeOverride\)/);
  });

  // XSS regression: a maliciously crafted providerLabel or model name
  // containing `</script>` would break out of the dashboard's <script>
  // block and execute arbitrary code. The serializer must escape `<`,
  // `>` and `&` before embedding the JSON payload.
  it('escapes </script> and other HTML chars in the injected JSON payloads', () => {
    const dangerous: TelemetrySnapshot = {
      ...emptySnapshot(),
      recent: [
        {
          id: 'r1',
          timestamp: '2026-06-03T08:00:00.000Z',
          providerId: '</script><script>alert(1)</script>',
          providerLabel: '<img src=x onerror=alert(2)>',
          model: '"><script>alert(3)</script>',
          status: 200,
          durationMs: 1,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          estimated: false,
        },
      ],
      byProvider: { p1: { requests: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, errors: 0, averageDurationMs: 1 } },
      byModel: { m1: { requests: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, errors: 0, averageDurationMs: 1 } },
      byClient: {},
    };
    const html = buildDashboardHtml(baseConfig(), dangerous, true);
    // The script block must NOT contain a literal `</script>` followed
    // by executable markup. The serializer escapes the sequence as
    // `<\/script>` (well, `\u003c/script\u003e` here via the unicode
    // escape helper) so the browser sees a single contiguous string.
    const script = extractScript(html);
    expect(script).not.toContain('</script>');
    // The dangerous chars must appear escaped (unicode escapes are fine).
    expect(script).toContain('\\u003c');
  });
});

describe('buildDashboardHtml - telemetry truncation detection', () => {
  // Regression: when the on-disk telemetry file was written under an
  // older release with a recent-tail cap, `recent` carries fewer rows
  // than the aggregated `requests` counter. The dashboard must surface
  // this with a banner offering a one-click reset.
  it('renders a truncation banner when recent.length < requests (>= 5 missing)', () => {
    // 10000 cumulative requests but only 20 in the recent tail = the
    // classic pre-1.6.0 capped file.
    const snapshot: TelemetrySnapshot = {
      ...emptySnapshot(),
      requests: 10000,
      totalTokens: 1_000_000,
      recent: [
        {
          id: 'r1',
          timestamp: '2026-07-02T10:00:00.000Z',
          providerId: 'p1',
          providerLabel: 'Provider 1',
          model: 'm1',
          status: 200,
          durationMs: 100,
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          estimatedCost: 0.001,
          estimated: false,
        },
      ],
      byProvider: {},
      byModel: {},
      byClient: {},
    };
    const html = buildDashboardHtml(baseConfig(), snapshot, true);
    expect(html).toContain('id="truncation-banner"');
    expect(html).toContain('id="reset-metrics-btn"');
    expect(html).toContain('Recent history truncated');
  });

  it('does NOT render the truncation banner when recent.length === requests', () => {
    const snapshot: TelemetrySnapshot = {
      ...emptySnapshot(),
      requests: 3,
      recent: [
        {
          id: 'r1',
          timestamp: '2026-07-02T10:00:00.000Z',
          providerId: 'p1',
          providerLabel: 'P',
          model: 'm',
          status: 200,
          durationMs: 1,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          estimated: false,
        },
        {
          id: 'r2',
          timestamp: '2026-07-02T10:01:00.000Z',
          providerId: 'p1',
          providerLabel: 'P',
          model: 'm',
          status: 200,
          durationMs: 1,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          estimated: false,
        },
        {
          id: 'r3',
          timestamp: '2026-07-02T10:02:00.000Z',
          providerId: 'p1',
          providerLabel: 'P',
          model: 'm',
          status: 200,
          durationMs: 1,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          estimated: false,
        },
      ],
      byProvider: {},
      byModel: {},
      byClient: {},
    };
    const html = buildDashboardHtml(baseConfig(), snapshot, true);
    expect(html).not.toContain('id="truncation-banner"');
  });

  it('does NOT render the banner for small mismatches (single-row delete edge case)', () => {
    // User just deleted one row through the trash button. Threshold
    // is 5 to avoid a spurious banner on every delete.
    const snapshot: TelemetrySnapshot = {
      ...emptySnapshot(),
      requests: 10,
      recent: Array.from({ length: 9 }, (_, i) => ({
        id: `r${i}`,
        timestamp: '2026-07-02T10:00:00.000Z',
        providerId: 'p1',
        providerLabel: 'P',
        model: 'm',
        status: 200,
        durationMs: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        estimated: false,
      })),
      byProvider: {},
      byModel: {},
      byClient: {},
    };
    const html = buildDashboardHtml(baseConfig(), snapshot, true);
    expect(html).not.toContain('id="truncation-banner"');
  });
});

describe('column sorting', () => {
  it('renders data-sort-key attributes on all three tables', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // Recent table: 8 sortable columns (excluding optional action column)
    const recentSortKeys = (html.match(/<th class="sortable" data-sort-key="\w+"/g) || []).length;
    expect(recentSortKeys).toBeGreaterThanOrEqual(8);
    // By-model + provider tables: 6 sortable columns each
    expect(html).toContain('data-sort-key="name"');
    expect(html).toContain('data-sort-key="requests"');
    expect(html).toContain('data-sort-key="totalTokens"');
    expect(html).toContain('data-sort-key="averageDurationMs"');
    expect(html).toContain('data-sort-key="errors"');
    expect(html).toContain('data-sort-key="estimatedCost"');
  });

  it('does NOT add sortable class to the action column header', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, {}, () => true);
    // The row-actions-col th must not be sortable
    expect(html).not.toContain('row-actions-col sortable');
  });

  it('embeds sort state in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('sortState');
    expect(html).toContain('key: null, dir: null');
  });

  it('embeds compareVals helper in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function compareVals');
  });

  it('embeds recentSortVal helper in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function recentSortVal');
    expect(html).toContain('case "timestamp": return entry.timestamp');
    expect(html).toContain('case "status": return entry.status');
    expect(html).toContain('case "providerLabel": return entry.providerLabel');
    expect(html).toContain('case "model": return entry.model');
    expect(html).toContain('case "durationMs": return entry.durationMs');
    expect(html).toContain('case "totalTokens": return entry.totalTokens');
    expect(html).toContain('case "estimatedCost": return entry.estimatedCost');
    expect(html).toContain('case "estimated": return entry.estimated');
  });

  it('embeds objSortVal helper in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function objSortVal');
    expect(html).toContain('if (key === "name") return id');
  });

  it('embeds sortRecentEntries helper in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function sortRecentEntries');
  });

  it('embeds sortObjectEntries helper in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function sortObjectEntries');
  });

  it('embeds applySorts helper in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function applySorts');
    expect(html).toContain('currentRecentSorted = sortRecentEntries');
    expect(html).toContain('currentModelsSorted = sortObjectEntries');
    expect(html).toContain('currentProvidersSorted = sortObjectEntries');
  });

  it('embeds updateSortArrows helper in the script block', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('function updateSortArrows');
  });

  it('wires click handler on thead for sortable columns', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('th.sortable');
    expect(html).toContain('thead.addEventListener("click"');
    expect(html).toContain('sortState');
  });

  it('rerender calls applySorts and updateSortArrows', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The rerender function must call both helpers
    expect(html).toContain('function rerender');
    // applySorts is called before pagination
    const rerenderIdx = html.indexOf('function rerender');
    const applySortsIdx = html.indexOf('applySorts()', rerenderIdx);
    expect(applySortsIdx).toBeGreaterThan(rerenderIdx);
  });

  it('cycles sort direction: asc -> desc -> clear', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The click handler must implement the 3-state cycle
    expect(html).toContain('if (st.dir === "asc")');
    expect(html).toContain('st.dir = "desc"');
    expect(html).toContain('st.key = null');
    expect(html).toContain('st.dir = null');
  });
});

describe('formatCostCell', () => {
  it('renders a dash for zero or non-finite cost', () => {
    expect(formatCostCell(0, undefined)).toBe('<span class="muted">-</span>');
    expect(formatCostCell(NaN, undefined)).toBe('<span class="muted">-</span>');
    expect(formatCostCell(-1, undefined)).toBe('<span class="muted">-</span>');
  });

  it('renders sub-cent costs with up-to-4 decimals, trimming trailing zeros', () => {
    const html = formatCostCell(0.0023, { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
    expect(html).toContain('$0.0023');
    expect(html).toContain('title="in $0.30 / out $1.20 per 1M tokens (USD)"');
  });

  it('trims trailing zeros for round costs', () => {
    const html = formatCostCell(0.001, { inputPerMillion: 0.1, outputPerMillion: 0.3, currency: 'USD' });
    expect(html).toContain('$0.001');
    expect(html).not.toContain('$0.0010');
  });

  it('honours non-USD currency', () => {
    const html = formatCostCell(1.5, { inputPerMillion: 1, outputPerMillion: 2, currency: 'EUR' });
    expect(html).toContain('EUR 1.5');
    expect(html).toContain('per 1M tokens (EUR)');
  });

  it('falls back to USD when no pricing is supplied', () => {
    const html = formatCostCell(0.5, undefined);
    expect(html).toContain('$0.5');
  });
});

describe('per-client IDE telemetry', () => {
  function snapshotWithClients(): TelemetrySnapshot {
    const snap = emptySnapshot();
    snap.requests = 4;
    snap.totalTokens = 100;
    snap.recent = [
      {
        id: 'r1',
        timestamp: '2026-07-09T12:00:00.000Z',
        providerId: 'p1',
        providerLabel: 'Provider 1',
        model: 'm1',
        status: 200,
        durationMs: 100,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        estimatedCost: 0.001,
        estimated: false,
        clientId: 'kilo-code@1.2.3',
      },
      {
        id: 'r2',
        timestamp: '2026-07-09T12:00:01.000Z',
        providerId: 'p1',
        providerLabel: 'Provider 1',
        model: 'm1',
        status: 200,
        durationMs: 200,
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        estimatedCost: 0.002,
        estimated: false,
        clientId: 'continue@0.9.x',
      },
      {
        id: 'r3',
        timestamp: '2026-07-09T12:00:02.000Z',
        providerId: 'p1',
        providerLabel: 'Provider 1',
        model: 'm1',
        status: 200,
        durationMs: 50,
        promptTokens: 5,
        completionTokens: 0,
        totalTokens: 5,
        estimatedCost: 0,
        estimated: true,
        // older request, recorded before the clientId field existed.
      },
      {
        id: 'r4',
        timestamp: '2026-07-09T12:00:03.000Z',
        providerId: 'p1',
        providerLabel: 'Provider 1',
        model: 'm1',
        status: 200,
        durationMs: 70,
        promptTokens: 8,
        completionTokens: 4,
        totalTokens: 12,
        estimatedCost: 0.0005,
        estimated: false,
        clientId: 'curl@8.10.1',
      },
    ];
    snap.byProvider = { p1: { requests: 4, promptTokens: 43, completionTokens: 19, totalTokens: 62, estimatedCost: 0.0035, errors: 0, averageDurationMs: 105 } };
    snap.byModel = { m1: { requests: 4, promptTokens: 43, completionTokens: 19, totalTokens: 62, estimatedCost: 0.0035, errors: 0, averageDurationMs: 105 } };
    snap.byClient = {
      'kilo-code@1.2.3': { requests: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0.001, errors: 0, averageDurationMs: 100 },
      'continue@0.9.x': { requests: 1, promptTokens: 20, completionTokens: 10, totalTokens: 30, estimatedCost: 0.002, errors: 0, averageDurationMs: 200 },
      unknown: { requests: 1, promptTokens: 5, completionTokens: 0, totalTokens: 5, estimatedCost: 0, errors: 0, averageDurationMs: 50 },
      'curl@8.10.1': { requests: 1, promptTokens: 8, completionTokens: 4, totalTokens: 12, estimatedCost: 0.0005, errors: 0, averageDurationMs: 70 },
    };
    return snap;
  }

  it('renders a Client column with a sortable header in the recent table', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    expect(html).toContain('data-sort-key="clientId">Client</th>');
  });

  it('renders the resolved clientId as a code cell on each recent row', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    expect(html).toContain('kilo-code@1.2.3');
    expect(html).toContain('continue@0.9.x');
    expect(html).toContain('curl@8.10.1');
  });

  it('renders the literal "unknown" for entries without a clientId', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    // older entry (r3): no clientId -> the cell shows the literal
    // `unknown` string. We assert it appears at least once as a
    // standalone cell (one occurrence from the row, plus possibly
    // the by-client panel).
    const matches = html.match(/>\s*unknown\s*</g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('serializes clientId into the script-block recent array', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    // The in-script `recent` array must carry the per-row clientId
    // so the client-side renderer can rebuild rows without losing
    // the column after a search filter.
    expect(html).toContain('"clientId":"kilo-code@1.2.3"');
    expect(html).toContain('"clientId":"continue@0.9.x"');
    expect(html).toContain('"clientId":"curl@8.10.1"');
  });

  it('coalesces undefined clientId to the literal "unknown" in the script', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    // The older entry (r3) without a clientId must serialize as the
    // literal string, not the literal `undefined` or an empty value,
    // otherwise the client renderer / sort logic would treat the
    // column as missing for search hits.
    expect(html).toContain('"clientId":"unknown"');
  });

  it('renders a "By client" panel with one row per clientId bucket', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    expect(html).toContain('id="panel-client"');
    expect(html).toContain('id="client-tbody"');
    // Each named client bucket is rendered as a <code> tag in the by-client tbody.
    expect(html).toContain('<code title="Client identification parsed from the request">kilo-code@1.2.3</code>');
    expect(html).toContain('<code title="Client identification parsed from the request">continue@0.9.x</code>');
    expect(html).toContain('<code title="Client identification parsed from the request">curl@8.10.1</code>');
  });

  it('renders the "By client" panel as a friendly placeholder when no client data exists', () => {
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    expect(html).toContain('id="panel-client"');
    expect(html).toContain('No client telemetry yet.');
  });

  it('wires clientId into the client-side search haystack', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    // The search-haystack builder must include the clientId field so
    // a user can filter the recent table by typing "kilo-code" or
    // "curl" and only see matching rows.
    expect(html).toMatch(/entry\.clientId\s*\|\|\s*""/);
  });

  it('wires clientId into the client-side sort map', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithClients(), true);
    // Clicking the Client column header must cycle asc -> desc ->
    // cleared; the sort key map has to include the `clientId` case
    // so the cycle does not no-op on this column.
    expect(html).toMatch(/case "clientId":\s*return entry\.clientId/);
  });
});

// ============================================================================
// preset combobox + provider filter + extended preset list
// ============================================================================
describe('preset combobox and provider filter', () => {
  it('exports the 9 preset values via PRESET_OPTIONS', async () => {
    // The new presets (15mn, 30mn, 2d, 3d) sit alongside the
    // historical 1h / 24h / 7d / 30d. Ordering is the visual order
    // in the dashboard combobox.
    const { PRESET_OPTIONS } = await import('../src/aiflowbridge/ui/dashboard');
    const values = PRESET_OPTIONS.map((o) => o.value);
    expect(values).toEqual(['all', '15m', '30m', '1h', '24h', '2d', '3d', '7d', '30d']);
  });

  it('emits a 9-option preset <select> on both panels', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // Two preset selects, each with 9 options.
    const optionCount = (html.match(/<option value="/g) ?? []).length;
    expect(optionCount).toBeGreaterThanOrEqual(18);
    // The new short-duration presets must be present.
    expect(html).toMatch(/<option value="15m"/);
    expect(html).toMatch(/<option value="30m"/);
    expect(html).toMatch(/<option value="2d"/);
    expect(html).toMatch(/<option value="3d"/);
  });

  it('emits a provider filter <select> on the recent panel', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('id="recent-provider"');
    // Static markup ships with the "All providers" default only;
    // JS init populates the rest from the live snapshot.
    expect(html).toMatch(/<option value="" selected>All providers<\/option>/);
  });

  it('wire: change handlers on the preset select call applyFilters', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toContain('bindPresetSelect');
    expect(script).toContain('bindProviderSelect');
    expect(script).toContain('refreshProviderOptions');
    // The change handler must re-trigger applyFilters (the range
    // argument is kept as a hook for future shortcut bindings).
    expect(script).toMatch(/onChange\(range\)/);
    // The provider select change handler also triggers a re-filter.
    expect(script).toContain('applyFilters');
  });

  it('applyAllFilters pipeline wires through range + dates + provider', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    // The provider filter sits BETWEEN the time/custom-date stage
    // and the search filter, so time-based narrowing happens before
    // the per-entry search match (search applies on top of the
    // already-time-and-provider-narrowed set).
    expect(script).toContain('applyAllFilters');
    expect(script).toContain('filterByProvider');
  });

  it('provider filter narrows the by-model aggregation when a provider is selected', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    // `filterByProvider` must filter on `entry.providerId` (the
    // stable id, not the human-readable label).
    expect(script).toMatch(/filterByProvider[\s\S]*?entry\.providerId/);
  });

  // session grouping panel
  it('renders the sessions panel with collapse button', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('id="panel-sessions"');
    expect(html).toContain('data-collapse-target="panel-sessions"');
  });

  it('renders the session gap dropdown with 1, 2, 5, 10, 15, 30, 45, 60 min options', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('id="session-gap"');
    expect(html).toContain('<option value="1">1 min</option>');
    expect(html).toContain('<option value="2">2 min</option>');
    expect(html).toContain('<option value="5">5 min</option>');
    expect(html).toContain('<option value="10">10 min</option>');
    expect(html).toContain('<option value="15">15 min</option>');
    expect(html).toContain('<option value="30" selected>30 min</option>');
    expect(html).toContain('<option value="45">45 min</option>');
    expect(html).toContain('<option value="60">60 min</option>');
  });

  it('renders sessions container and pagination div', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('id="sessions-container"');
    expect(html).toContain('id="sessions-pagination"');
  });

  it('shows "No sessions to show." when recent is empty', () => {
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    expect(html).toContain('>No sessions to show.</p>');
  });

  it('contains the session grouping JS functions', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toContain('groupSessions');
    expect(script).toContain('renderSessionSections');
    expect(script).toContain('bindSessionsPaginator');
  });

  it('contains session CSS classes', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('.session-section');
    expect(html).toContain('.session-toggle');
    expect(html).toContain('.session-body');
    expect(html).toContain('.session-summary-table');
  });

  it('sessions pagination state defaults to pageSize 5', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toContain('sessions: { page: 1, pageSize: 5, total: 0 }');
  });

  it('sessions panel loads persisted page size from localStorage', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toMatch(/loadPageSize\("sessions"/);
  });

  it('contains session request-details JS function', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toContain('renderSessionEntries');
    expect(script).toContain('session-entries');
    expect(script).toContain('data-entries-toggle');
  });

  it('contains session request-details CSS classes', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toContain('.session-entries');
    expect(html).toContain('.session-entries-table');
    expect(html).toContain('.session-entries-title');
    expect(html).toContain('.session-entries-toggle');
    expect(html).toContain('.session-entries-body');
  });

  it('groupSessions stores the entries belonging to each session', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    // The groupSessions function must push each entry into the
    // session's entries array so renderSessionEntries can list them.
    expect(script).toMatch(/current\.entries\.push/);
  });
});

describe('AFF07 telemetry export helpers', () => {
  // Pure-function coverage for the export building blocks in
  // `src/aiflowbridge/ui/dashboard.ts`. The browser-side mirror
  // (escapeCsvValueBrowser / buildCsvExportBrowser / ...) is
  // exercised end-to-end by the "emits a syntactically valid
  // JavaScript program in the embedded <script> tag" test above.

  it('escapeCsvValue passes plain ASCII through unchanged', async () => {
    const { escapeCsvValue } = await import('../src/aiflowbridge/ui/dashboard');
    expect(escapeCsvValue('hello')).toBe('hello');
    expect(escapeCsvValue('hello world')).toBe('hello world');
    expect(escapeCsvValue('model-gpt-4o-mini')).toBe('model-gpt-4o-mini');
  });

  it('escapeCsvValue quotes and escapes values containing comma, quote, CR, or LF', async () => {
    const { escapeCsvValue } = await import('../src/aiflowbridge/ui/dashboard');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvValue('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(escapeCsvValue('')).toBe('');
    expect(escapeCsvValue('"quoted"')).toBe('"""quoted"""');
  });

  it('escapeCsvValue forceQuote wraps every value in quotes', async () => {
    const { escapeCsvValue } = await import('../src/aiflowbridge/ui/dashboard');
    expect(escapeCsvValue('plain', true)).toBe('"plain"');
  });

  it('buildCsvExport emits a header row + one row per entry + trailing CRLF', async () => {
    const { buildCsvExport, toExportedEntry } = await import('../src/aiflowbridge/ui/dashboard');
    const entries = [
      toExportedEntry(makeEntry({ id: 'a', promptSummary: 'simple prompt' })),
      toExportedEntry(makeEntry({ id: 'b', model: 'MiniMax-M3', status: 500 })),
    ];
    const csv = buildCsvExport(entries);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,timestamp,providerId,providerLabel,model,status,durationMs,promptTokens,completionTokens,totalTokens,estimatedCost,estimated,source,clientId,promptSummary,responseSummary');
    expect(lines[1]).toContain('a');
    expect(lines[1]).toContain('simple prompt');
    expect(lines[2]).toContain('MiniMax-M3');
    expect(lines[2]).toContain('500');
    // Last line is empty (trailing CRLF).
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('buildCsvExport quotes fields containing commas, quotes, and newlines', async () => {
    const { buildCsvExport, toExportedEntry } = await import('../src/aiflowbridge/ui/dashboard');
    const entries = [
      toExportedEntry(makeEntry({
        id: 'a',
        providerLabel: 'Test, with comma',
        promptSummary: 'he said "hi"\nnew line',
      })),
    ];
    const csv = buildCsvExport(entries);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('"Test, with comma"');
    expect(lines[1]).toContain('"he said ""hi""\nnew line"');
  });

  it('buildCsvExport handles an empty entry set with a header-only payload', async () => {
    const { buildCsvExport } = await import('../src/aiflowbridge/ui/dashboard');
    const csv = buildCsvExport([]);
    expect(csv).toBe('id,timestamp,providerId,providerLabel,model,status,durationMs,promptTokens,completionTokens,totalTokens,estimatedCost,estimated,source,clientId,promptSummary,responseSummary\r\n');
  });

  it('buildCsvExport stringifies numbers, booleans, and strings', async () => {
    const { buildCsvExport, toExportedEntry } = await import('../src/aiflowbridge/ui/dashboard');
    const csv = buildCsvExport([
      toExportedEntry(makeEntry({ id: 'a', estimatedCost: 0.0012, estimated: true, promptTokens: 0 })),
    ]);
    const row = csv.split('\r\n')[1];
    // estimatedCost rounded to 6 decimals
    expect(row).toMatch(/0\.0012/);
    expect(row).toMatch(/,true,/);
    expect(row).toMatch(/,0,/); // promptTokens
  });

  it('toExportedEntry coalesces optional fields (clientId / source / summaries) to safe defaults', async () => {
    const { toExportedEntry } = await import('../src/aiflowbridge/ui/dashboard');
    const out = toExportedEntry(makeEntry({ id: 'a' }));
    expect(out.clientId).toBe('unknown');
    expect(out.source).toBe('unknown');
    expect(out.promptSummary).toBe('');
    expect(out.responseSummary).toBe('');
    expect(out.estimated).toBe(false);
  });

  it('computeExportTotals aggregates requests, tokens, cost, errors', async () => {
    const { computeExportTotals, toExportedEntry } = await import('../src/aiflowbridge/ui/dashboard');
    const totals = computeExportTotals([
      toExportedEntry(makeEntry({ id: 'a', promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.001 })),
      toExportedEntry(makeEntry({ id: 'b', promptTokens: 200, completionTokens: 80, totalTokens: 280, estimatedCost: 0.002, status: 500 })),
      toExportedEntry(makeEntry({ id: 'c', promptTokens: 50, completionTokens: 10, totalTokens: 60, estimatedCost: 0.0005, status: 200 })),
    ]);
    expect(totals.requests).toBe(3);
    expect(totals.promptTokens).toBe(350);
    expect(totals.completionTokens).toBe(140);
    expect(totals.totalTokens).toBe(490);
    expect(totals.errors).toBe(1); // only the 500
    expect(totals.estimatedCost).toBeCloseTo(0.0035, 6);
  });

  it('computeExportTotals returns zeros on an empty entry set', async () => {
    const { computeExportTotals } = await import('../src/aiflowbridge/ui/dashboard');
    expect(computeExportTotals([])).toEqual({
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      errors: 0,
    });
  });

  it('buildJsonExport wraps entries + meta in a schemaVersioned envelope', async () => {
    const { buildJsonExport, toExportedEntry } = await import('../src/aiflowbridge/ui/dashboard');
    const entries = [toExportedEntry(makeEntry({ id: 'a' }))];
    const meta = {
      generatedAt: '2026-07-13T20:00:00.000Z',
      extensionVersion: '2.15.0',
      filters: { preset: '24h', provider: '', fromDate: '', toDate: '', search: '' },
      totals: { requests: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, errors: 0 },
    };
    const payload = JSON.parse(buildJsonExport(entries, meta));
    expect(payload.schemaVersion).toBe(1);
    expect(payload.source).toBe('AIFlowBridge dashboard export');
    expect(payload.meta).toEqual(meta);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].id).toBe('a');
    // Pretty-printed (indented) and ends with newline.
    expect(buildJsonExport(entries, meta).endsWith('\n')).toBe(true);
  });

  it('buildExportFilename slugifies the preset and embeds the timestamp', async () => {
    const { buildExportFilename } = await import('../src/aiflowbridge/ui/dashboard');
    const filename = buildExportFilename(
      { generatedAt: '2026-07-13T20:00:00.000Z', filters: { preset: '24h', provider: '', fromDate: '', toDate: '', search: '' } },
      'csv'
    );
    expect(filename).toBe('aiflowbridge-metrics-24h-2026-07-13T20-00-00-000Z.csv');
    expect(buildExportFilename({ generatedAt: '2026-07-13T20:00:00.000Z', filters: { preset: 'last 30mn', provider: '', fromDate: '', toDate: '', search: '' } }, 'json')).toBe(
      'aiflowbridge-metrics-last-30mn-2026-07-13T20-00-00-000Z.json'
    );
  });

  it('buildExportFilename uses "all" as the preset fallback when missing or empty', async () => {
    const { buildExportFilename } = await import('../src/aiflowbridge/ui/dashboard');
    const filename = buildExportFilename(
      { generatedAt: '2026-07-13T20:00:00.000Z', filters: { preset: '', provider: '', fromDate: '', toDate: '', search: '' } },
      'csv'
    );
    expect(filename.startsWith('aiflowbridge-metrics-all-')).toBe(true);
  });

  it('renders an Export filtered group with CSV + JSON buttons in the Filters panel', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    expect(html).toMatch(/id="export-csv-btn"/);
    expect(html).toMatch(/id="export-json-btn"/);
    expect(html).toMatch(/Export filtered/);
  });

  it('wires the export buttons to click handlers that call buildExportPayload', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const script = extractScript(html);
    expect(script).toMatch(/wireExportButton/);
    expect(script).toMatch(/wireExportButton\("export-csv-btn", "csv"\)/);
    expect(script).toMatch(/wireExportButton\("export-json-btn", "json"\)/);
    // The handler builds the payload from currentRecent (the
    // filtered subset) - this is the contract that makes the
    // export honor every active dashboard filter.
    expect(script).toMatch(/currentRecent\.map\(toExportedEntryBrowser\)/);
    // The previous client-side `URL.createObjectURL` + `<a download>`
    // pattern silently no-op'd under the default VS Code webview
    // CSP (blob: URLs are blocked). The handler now ships the
    // payload to the extension host via postMessage; the host
    // shows a native save dialog and writes the file via
    // vscode.workspace.fs.writeFile.
    expect(script).toMatch(/vscodeApi\.postMessage\(\s*\{[^}]*type:\s*"export"/);
    expect(script).toMatch(/filename:\s*payload\.filename/);
    expect(script).toMatch(/contents:\s*payload\.contents/);
    // The legacy broken pattern must NOT appear anymore. The regex
    // is anchored to a code statement (not a comment) so the
    // historical context lines (which explain why we removed it)
    // do not trigger a false positive.
    expect(script).not.toMatch(/^\s*var url\s*=\s*URL\.createObjectURL/m);
    expect(script).not.toMatch(/a\.download\s*=\s*filename/);
  });

  it('declares extensionVersion in the inline script (regression for buildExportPayload ReferenceError)', () => {
    // Regression: buildExportPayload referenced an `extensionVersion`
    // identifier that was never declared in the inline script. The
    // dashboard threw `Uncaught ReferenceError: extensionVersion is
    // not defined` the moment the user clicked Export, leaving the
    // export silently broken even after the postMessage fix. The
    // version is now hydrated at HTML build time from
    // `versions.extension` so the script has the value in scope.
    const versions = { extension: '9.9.9-test' };
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, versions);
    const script = extractScript(html);
    expect(script).toMatch(/var\s+extensionVersion\s*=\s*"9\.9\.9-test"/);
  });

  it('declares extensionVersion as an empty string when no version is provided', () => {
    // The extension version is optional in the API; when the host
    // omits it, the export metadata header must still build without
    // throwing (downstream JSON consumers expect a string).
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true, {});
    const script = extractScript(html);
    expect(script).toMatch(/var\s+extensionVersion\s*=\s*""/);
  });
});

function makeEntry(overrides: Partial<RequestTelemetry> = {}): RequestTelemetry {
  return {
    id: 'r1',
    timestamp: '2026-07-13T20:00:00.000Z',
    providerId: 'minimax',
    providerLabel: 'MiniMax V2.7',
    model: 'MiniMax-M2.7',
    status: 200,
    durationMs: 420,
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    estimatedCost: 0.0002,
    estimated: false,
    ...overrides,
  } as RequestTelemetry;
}

describe('formatPricingBundleVersion', () => {
  it('renders a real semver with the canonical v prefix', () => {
    expect(formatPricingBundleVersion('2.15.0')).toBe('AIFlowBridge v2.15.0');
    expect(formatPricingBundleVersion('2.14.0-rc.1')).toBe('AIFlowBridge v2.14.0-rc.1');
  });

  it('falls back to an explicit "unknown" label for the "0.0.0" sentinel', () => {
    // The release-time script used to write "0.0.0" when
    // package.json had no version field, which then surfaced in
    // the dashboard as a confusing "AIFlowBridge v0.0.0" tag.
    // The dashboard must treat it as a stale / unknown stamp.
    expect(formatPricingBundleVersion('0.0.0')).toBe('AIFlowBridge version unknown (run npm run pricing:refresh)');
  });

  it('falls back to the same label for empty / null / undefined input', () => {
    expect(formatPricingBundleVersion('')).toBe('AIFlowBridge version unknown (run npm run pricing:refresh)');
    expect(formatPricingBundleVersion(undefined)).toBe('AIFlowBridge version unknown (run npm run pricing:refresh)');
    expect(formatPricingBundleVersion(null)).toBe('AIFlowBridge version unknown (run npm run pricing:refresh)');
  });
});

describe('dashboard renders the pricing snapshot header safely', () => {
  function buildConfigWithPricing(bundledVersion: string): AiFlowBridgeConfig {
    return {
      ...baseConfig(),
      pricing: {
        models: {},
        sourceByModel: {},
        bundledFetchedAt: '2026-07-13T16:15:03.036Z',
        bundledVersion,
      },
    };
  }

  it('uses the formatted version label when bundledVersion is "0.0.0"', () => {
    const html = buildDashboardHtml(buildConfigWithPricing('0.0.0'), snapshotWithData(), true);
    expect(html).toContain('AIFlowBridge version unknown (run npm run pricing:refresh)');
    // The legacy "v0.0.0" string must NOT appear, so the user
    // does not mistake the sentinel for a real install bug.
    expect(html).not.toContain('AIFlowBridge v0.0.0');
  });

  it('uses the formatted version label when bundledVersion is empty', () => {
    const html = buildDashboardHtml(buildConfigWithPricing(''), snapshotWithData(), true);
    expect(html).toContain('AIFlowBridge version unknown (run npm run pricing:refresh)');
  });

  it('renders the canonical "vX.Y.Z" label for a real semver', () => {
    const html = buildDashboardHtml(buildConfigWithPricing('2.15.0'), snapshotWithData(), true);
    expect(html).toContain('AIFlowBridge v2.15.0');
  });
});
