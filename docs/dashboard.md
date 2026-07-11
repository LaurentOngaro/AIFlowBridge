# Metrics dashboard

> Part of the [AIFlowBridge documentation](../README.md).

The metrics dashboard is one keyboard shortcut away: press **`Ctrl+Alt+M`** (or `Cmd+Alt+M` on macOS), or run `AIFlowBridge: Show metrics dashboard` from the Command Palette.

## What the dashboard shows

- **Top cards** - Total requests, prompt/completion tokens, average duration, and total **Estimated cost**. With no filter active the cards show **cumulative** totals since you started using the gateway; with a filter active they recompute from the filtered subset.
- **Gateway panel** - Running state (or stopped / error), port, default model.
- **Recent requests table** - Timestamp, model, tokens, latency, status (200/4xx/5xx as a colored pill), **Est. cost** (with the per-rate tooltip), and per-row delete button.
- **Sessions panel** - Recorded requests grouped into sessions by an inactivity gap (default 30 min, options 1 / 2 / 5 / 10 / 15 / 30 / 45 / 60 min). Each session is rendered as a collapsible card showing the start time, request count, and a header summary (total tokens, average duration, total estimated cost, session span in minutes); expanding reveals per-request details.
- **By model panel** - Same metrics aggregated per model ID, with the same time/date/search filters.
- **By client / By source panels** - Per-`clientId` (kilocode@1.2.3, curl@8.x, ...) and per-origin (gateway vs copilot-chat) splits.
- **Shared session panel** - Pair-programming view: the 20 most recent recorded requests with their sanitized prompt snippets. Click **Replay** to re-fetch the stored prompt + response summaries via `GET /v1/replay/{id}` without re-running the upstream call. Auto-refreshes when the loopback `GET /v1/events` SSE stream is reachable (the dashboard subscribes on first render).
- **Provider summary** - Per provider (DeepSeek / MiniMax / Xiaomi) totals.

## Header badge

The badge in the hero shows the running gateway state and version:

```
Gateway running · http://127.0.0.1:8787/v1
```

A "Current version: v1.6.0" subtitle displays the installed extension version.

## Collapsible panels

Each of the eight panel sections (Gateway / Recent / Sessions / By model / By client / By source / Shared session / Provider) can be collapsed by clicking the chevron in its header. The collapsed state is persisted per-panel in `localStorage`.

## Time filters

Nine presets are available on both the Recent and By model panels, exposed as a single `<select>` per panel: **All / Last 15 min / Last 30 min / Last 1 h / Last 24 h / Last 2 days / Last 3 days / Last 7 days / Last 30 days**. The two selects stay synchronised: changing one reflects on the other (mirroring the previous button behaviour where the Recent and By model panels shared a single active preset).

## Provider filter

A second `<select>` on the Recent requests panel, alongside the time preset, lets the user narrow the recent table + by-model aggregation to a single provider. The options are **All providers** + one entry per provider id seen in the snapshot's `byProvider` map; the list refreshes on every dashboard snapshot reload so newly-enabled providers appear automatically.

## Custom date range

Two `<input type="date">` controls (From / To) on the Recent requests panel filter by absolute dates on top of the preset. Entering a date resets the preset selects back to **All**; changing the preset clears the From / To inputs. Changing the date a second time in a row works as expected (`input` + `change` events are both wired).

## Text search

A single search box ("Filter requests…") on the Recent panel matches case-insensitively across **model / provider / status / timestamp / duration / tokens / estimated cost**. The By model panel additionally matches the **model name itself** (a model whose name contains the needle is included even if no individual entry matches).

## Pagination

Each panel paginates its results locally:

- **First / Prev / Next / Last** buttons (`<<` `<` `>` `>>`)
- **Direct page jump** (`Page X of Y` input)
- **Per-page size** (defaults: 25 entries for Recent, 10 for By model, 10 for Provider summary). Page size is persisted per-panel in `localStorage`.
- **Total scope note** under the top cards reflects what they cover: "Showing all recorded requests" when nothing is filtered, or "Filtered totals (preset: 24h · provider: deepseek-flash · search: \"minimax\")." otherwise. The provider is included in the note only when the provider filter is set.

When the filtered set is empty, the pagination strip is hidden.

## Per-row delete

Each row in the "Recent requests" table has a leading trash-icon column. Clicking it:

1. Removes the entry from the in-memory `TelemetryStore` (totals, recent list, per-provider / per-model maps, durations array) and from the on-disk `<globalStorageUri>/telemetry.json` file under the same file lock as `appendDelta` (see [Cross-window shared metrics](#cross-window-shared-metrics) below).
2. Recomputes p95 from the now-shrunk durations array.
3. Re-renders the panel with the updated cumulative counters and the updated recent list.

The action column is only rendered when the dashboard is opened from the extension host (which wires an `onRemoveEntry` hook). Backward-compat callers that pass no hook see neither the action column nor the trash button. `AIFlowBridge: Refresh metrics` in any window picks up the deletion because the persister writes through to the on-disk file, which is the source of truth.

## Shared session panel (pair programming)

The "Shared session" panel (added in 2.10.0) lists the 20 most recent recorded requests in reverse chronological order. Each row carries the local time, provider, model, and a sanitized `promptSummary` snippet (max 500 chars). Clicking **Replay** posts a message to the extension host, which re-hydrates the matching entry from the in-memory `TelemetryStore` (same source the HTTP `/v1/replay/{id}` endpoint reads) and renders the body inline in a `<pre>` block. The replay is a pure read - no upstream re-forward, safe to fire as many times as needed.

The sanitization is non-negotiable: Bearer tokens, `sk-...` keys, `x-api-key` headers, and any 60+-char token-like blob without whitespace are redacted to `[REDACTED]` before the snippet ever reaches the dashboard HTML. A developer pasting a `curl` one-liner that includes their upstream key will not see it in the dashboard or via `GET /v1/replay/{id}`.

The panel degrades gracefully on entries recorded before the feature shipped (pre-2.10.0 snapshots have no `promptSummary` - the row renders as a muted `(no summary)` placeholder and the Replay button is hidden for that entry). The button stays functional even when the gateway is unreachable from the webview (the host process brokers the read).

Set `aiflowbridge.telemetry.captureSessionLog = false` to keep the on-disk telemetry file lean - the panel still appears but shows `(no summary)` placeholders for entries recorded after the flag was flipped.

## Cross-window shared metrics

Metrics live in `<globalStorageUri>/telemetry.json` (a sibling `<globalStorageUri>/telemetry.lock` serializes writers across processes). The data is shared across all VS Code windows: every `record()` goes through a file lock, the in-process write chain guarantees sequential file access, and a `Refresh metrics` in any window reloads from disk. This means the totals you see in a non-leader window are the same as the ones the leader just wrote, without needing a window reload.

The file is plain JSON. The Output channel (`AIFlowBridge: Show logs`) prints the path under `[Telemetry]` debug lines, which is the easiest way to find it on Windows / macOS / Linux.

## What the dashboard tracks and what it doesn't

> **TL;DR** - the dashboard counts requests that go through AIFlowBridge's **local gateway** (Kilo Code, Continue, Open WebUI, curl, OpenAI SDK pointed at `http://127.0.0.1:8787/v1`, etc.). It does **not** count prompts sent directly from Copilot Chat. This is by design, not a bug.

AIFlowBridge ships two complementary integrations. They share models and API keys but have **different telemetry** paths:

|                             | Copilot Chat                                      | Local gateway                                    |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Entry point**             | `vscode.lm` API in VS Code                        | `POST http://127.0.0.1:8787/v1/chat/completions` |
| **Provider implementation** | `src/provider/*.ts` (DeepSeek / MiniMax / Xiaomi) | `src/aiflowbridge/gateway/server.ts`             |
| **Upstream call**           | Direct `fetch` to the vendor                      | Direct `fetch` to the vendor                     |
| **Telemetry recorded?**     | No                                                | Yes (gateway's `TelemetryStore`)                 |

The reason is structural: VS Code's language model API is a push-only interface - the extension returns a stream of tokens, but the framework owns the request lifecycle. AIFlowBridge does not see a "request started / request ended" event it can hook into. The gateway, in contrast, is a regular HTTP server, so it has full request/response metadata (status, duration, prompt/completion token counts from the upstream `usage` field) at the right granularity for per-request metrics.

**Practical implication** - if you want to populate the dashboard, point an OpenAI-compatible client at the gateway. The [gateway.md](gateway.md) section has the full config. Sending a single `curl` is enough to verify the pipeline:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "deepseek-v4-flash", "messages": [{"role": "user", "content": "ping"}]}'
```

The status bar reflects the same source: it shows the gateway state, not Copilot Chat activity. The "requests" counter in the status bar increments only when the gateway handles a request.

## Example workflow

1. Pick a model in Copilot Chat - the gateway stays empty until you exercise it (see the note above).
2. Switch to Kilo Code (or Continue / any OpenAI-compatible client) and point it at `http://127.0.0.1:8787/v1`.
3. Send a prompt through that client - the dashboard increments in real time.
4. Press `Ctrl+Alt+M` to open the dashboard and inspect token usage, latency, and estimated cost.
5. Run `AIFlowBridge: Show logs` to inspect any errors in detail.

## Screenshots

| Dashboard                                                                       | Copilot picker                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ![Dashboard](resources/screenshots_v1.1.1/01_AIFB_dashboard_after_a_prompt.png) | ![Copilot picker](resources/screenshots_v1.1.1/03_AIFB_copilot%20LLM%20picker.png) |

| Kilo Code picker                                                                      | Gateway metrics                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| ![Kilo Code picker](resources/screenshots_v1.1.1/02_AIFB_kiloCode%20LLM%20picker.png) | ![Gateway metrics](resources/screenshots_v1.4.0/06a_AIFB_API_metrics_1.png) |

The screenshots are captured against the v1.1.1 / v1.4.0 dashboard (preset buttons, no provider filter). New screenshots should land in `resources/screenshots_v2.7.0/` once captured; drop them into this table to refresh the visual references for the AFF08 combobox + provider filter.
