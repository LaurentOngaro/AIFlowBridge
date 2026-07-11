# Telemetry

> Part of the [agent instructions](../AGENTS.md).

## Overview

The gateway records every request with token counts, latency, status, and estimated cost. Telemetry is persisted in a real file (`<globalStorageUri>/telemetry.json` on VS Code, `~/.aiflowbridge/telemetry.json` on standalone), shared across all VS Code windows and the standalone CLI via a file lock.

## Architecture

- `src/aiflowbridge/telemetry.ts` - `TelemetryStore` (in-memory store + snapshot / restore / reset).
- `src/aiflowbridge/telemetry/persistence.ts` - `TelemetryPersister` (file-based, cross-process lock, atomic writes).
- `src/aiflowbridge/gateway/server.ts` - `GatewayService.recordTelemetry()` - the call site after every upstream response.
- `src/aiflowbridge/ui/dashboard.ts` - `buildDashboardHtml()` + `showMetricsDashboard()` - the metrics panel UI.

## TelemetryPersister

The persister uses a sibling `<file>.lock` to serialize writers across processes (stale mtime reaper at 30s, symlink refusal, mkdir-recursive, atomic `write-tmp` + `rename`).

API:

- `loadSync()` - read the on-disk snapshot synchronously.
- `appendDelta(entry)` - apply a single request delta under the cross-process lock.
- `saveFull(snapshot)` - overwrite the on-disk snapshot (used by `reset()`).
- `removeEntry(id)` - reverse-delta an entry (used by the per-row delete button on the dashboard).
- `clear()` - empty the snapshot.

The on-disk file is always written atomically: a crash mid-write leaves the previous snapshot intact, and a read observed during a write returns the old or new content, never a truncated JSON. Concurrent writers are tested with 50 parallel `appendDelta` calls: zero lost updates.

## TelemetryStore

In-memory store. Public API:

- `record(entry)` - add a request, schedules `persister.appendDelta`.
- `recordFromCopilotChat(options)` - build a `RequestTelemetry` with `source: 'copilot-chat'` and route through `record()` (action plan item #6).
- `snapshot()` - read the current in-memory snapshot (totals + `recent` + per-provider / per-model / per-client / per-source maps).
- `restore(snapshot?)` - load from a snapshot or from the persister.
- `reset()` - clear in-memory + on-disk.
- `removeEntry(id)` - reverse-delta.
- `refreshFromDisk()` - reload from the persister (used by `AIFlowBridge: Refresh metrics`).
- `subscribe(listener)` - notify on every mutation (powers the `/v1/events` SSE stream).
- `getEntry(id)` - lookup a recorded entry by id (powers `GET /v1/replay/{id}` and the dashboard Shared Session panel).
- `listSessions(limit)` - lightweight projection for the session list view, reverse chronological, limit clamped to `[1, 200]`.

`TelemetryStore.MAX_RECENT` cap was removed in 1.6.0; every recorded request is appended with no eviction. The configurable `memoryCap` (default 10000) caps the in-memory `recent` array to bound memory under high throughput; the on-disk persister still receives every entry.

### Session log sanitization (action plan item #3, 2.10.0+)

`RequestTelemetry` carries optional `promptSummary` (max 500 chars) and `responseSummary` (max 1000 chars), captured at recording time by the gateway (`src/aiflowbridge/telemetry/summary.ts`). Both are sanitized at extraction time:

- `Bearer <token>` strings (12+ chars after the prefix) become `Bearer [REDACTED]`.
- `sk-<token>` strings (20+ chars after the prefix) become `sk-[REDACTED]`.
- `x-api-key=<token>` / `x-api-key: <token>` strings (16+ chars) become `x-api-key=[REDACTED]`.
- Any 60+-char run of `A-Za-z0-9+/=_-` without whitespace becomes `[REDACTED]` (catches base64-looking blobs and unquoted API keys).

The sanitization is idempotent (running it twice on the same input returns the same output) and happens **before** the truncation cap, so a redacted credential that survives the cap is no longer reachable. The whole pipeline is gated on `aiflowbridge.telemetry.captureSessionLog` (default `true`).

The `RequestTelemetry.promptSummary` / `responseSummary` fields are **optional** in the schema, so older on-disk snapshots load unchanged and the next `record()` call repopulates the new fields as requests come in. No migration is required.

## Cost estimation

Per-request `estimatedCost` is computed at request time using the matched `ProviderProfile.pricing`. Historical costs are frozen (a fait historique) - they are never recomputed when a pricing override changes. To start over with a new rate, use `AIFlowBridge: Reset metrics`.

Errored requests (`status >= 400`) record `estimatedCost = 0` - the user is never billed for a request that never produced a billable completion. The request is still recorded (error count, per-provider / per-model usage, duration averages, per-row delete affordance) - it just does not contribute to the "Estimated cost" totals.

## Migration

On first activation after upgrading from a pre-1.5.0 install, if the legacy `aiflowbridge.telemetry.v1` globalState slot has data and the new file does not, the snapshot is moved over and the legacy slot is cleared (logged at INFO with the request/token counts). One-shot, idempotent.

## Dashboard

`src/aiflowbridge/ui/dashboard.ts` builds a self-contained HTML page with eight panels:

1. **Gateway** - status, version, port, base URL.
2. **Recent requests** - per-row table with timestamp / model / status / duration / tokens / cost. Filters: time preset `<select>` (All / Last 15 min / Last 30 min / Last 1 h / Last 24 h / Last 2 days / Last 3 days / Last 7 days / Last 30 days), provider `<select>` (`All providers` + dynamic per-`byProvider` key list), custom date range (`<input type="date">` x 2), and free-text search. Pagination (per-panel, persisted in `localStorage`). Per-row delete button (when `onRemoveEntry` is wired).
3. **Sessions** - recorded requests grouped into sessions by an inactivity gap (default 30 min, options 1 / 2 / 5 / 10 / 15 / 30 / 45 / 60 min via the `Inactivity gap` dropdown). Each session is rendered as a collapsible card with a header summary (total tokens, average duration, total estimated cost, span in minutes) and a collapsible per-request details list.
4. **By model** - aggregated per-model counters with the same filter chain (the time preset is shared across both panels via `syncPresetSelects()`), plus a model-name substring match (entry-level OR model-name). The provider filter applies here too.
5. **By client** - aggregated per `clientId` (kilocode@1.2.3, curl@8.x, ...).
6. **By source** - aggregated per origin (`gateway` vs `copilot-chat`).
7. **Shared session** (2.10.0+, action plan item #3) - pair-programming view: the 20 most recent recorded requests with their sanitized `promptSummary`. Each row carries a **Replay** button that posts a `replay` message to the extension host; the host re-hydrates the entry from the in-memory `TelemetryStore.getEntry(id)` and posts back a `replayResult` rendered in a `<pre>` block. The replay is a pure read - no upstream re-forward.
8. **Provider summary** - aggregated per-provider counters.

The page renders server-side first (works without JS), then a JS init pass + `rerender()` slice the rows into the persisted page size for each panel.

## Commands

| Command                                | Description                                               |
| -------------------------------------- | --------------------------------------------------------- |
| `AIFlowBridge: Show metrics dashboard` | Open the dashboard webview (`Ctrl+Alt+M`)                 |
| `AIFlowBridge: Refresh metrics`        | Reload from disk (use after a peer window wrote new data) |
| `AIFlowBridge: Reset metrics`          | Clear in-memory + on-disk (modal confirmation)            |
