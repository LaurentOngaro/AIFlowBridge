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
import type { AiFlowBridgeConfig, TelemetrySnapshot } from '../src/aiflowbridge/types';
import { buildDashboardHtml, buildPricingMaps, formatCostCell } from '../src/aiflowbridge/ui/dashboard';

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
  };
}

function baseConfig(): AiFlowBridgeConfig {
  return {
    gateway: { enabled: true, port: 8787, baseUrl: 'http://127.0.0.1:8787/v1', defaultModel: '' },
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
    // the .spinning class even if the page is not reloaded by the
    // extension.
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    expect(html).toContain('refreshButton.classList.add("spinning")');
    expect(html).toContain('refreshButton.classList.remove("spinning")');
    expect(html).toContain('window.setTimeout');
  });

  it('renders all four time filter buttons on both the recent and by-model panels', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    const ranges = ['data-range="all"', 'data-range="1h"', 'data-range="24h"', 'data-range="7d"', 'data-range="30d"'];
    for (const range of ranges) {
      const matches = html.match(new RegExp(range, 'g')) ?? [];
      // Should appear twice: once for recent, once for by-model
      expect(matches.length).toBe(2);
    }
    expect(html).toContain('id="recent-filters"');
    expect(html).toContain('id="model-filters"');
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
    // The header is rendered three times (recent / by-model / provider).
    expect(html.match(/<th>Est\. cost<\/th>/g)?.length).toBe(3);
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
      byProvider: { unpriced: { requests: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0, errors: 0, averageDurationMs: 100 } },
      byModel: { 'unpriced-model': { requests: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0, errors: 0, averageDurationMs: 100 } },
    };
    const html = buildDashboardHtml(config, snapshot, true);
    // The dash placeholder must appear in all three table bodies.
    const dashCount = html.match(/<span class="muted">-<\/span>/g)?.length ?? 0;
    expect(dashCount).toBeGreaterThanOrEqual(3);
  });

  it('expands the colspan of the empty-state row in the recent table to 8 columns', () => {
    const html = buildDashboardHtml(baseConfig(), emptySnapshot(), true);
    // The empty-state message in the recent table is rendered with colspan="8"
    // when filtered client-side (all-time on an empty snapshot also shows the
    // "No request recorded yet" copy, but we re-render with colspan when
    // filtering selects a range). Verify the filter path: the script block
    // uses the new colspan.
    expect(html).toContain('colspan="8"');
  });

  it('serializes estimatedCost into the recent array used by the client-side filter', () => {
    const html = buildDashboardHtml(baseConfig(), snapshotWithData(), true);
    // The JSON payload injected into the script block must include the
    // per-request estimatedCost so the filter (1h/24h/...) can rebuild the
    // Est. cost cell.
    expect(html).toMatch(/"estimatedCost":0?\.0002/);
  });
});

describe('buildPricingMaps', () => {
  it('indexes enabled providers by id and by upstream model', () => {
    const maps = buildPricingMaps(baseConfig().providers);
    expect(maps.byProviderId['minimax']).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
    expect(maps.byModel['MiniMax-M2.7']).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
  });

  it('skips profiles without pricing', () => {
    const maps = buildPricingMaps([
      { id: 'no-price', label: 'NP', kind: 'openai-compat', baseUrl: 'https://x', model: 'np', enabled: true },
    ]);
    expect(maps.byProviderId).toEqual({});
    expect(maps.byModel).toEqual({});
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
