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
- `snapshot()` - read the current in-memory snapshot (totals + `recent` + per-provider / per-model maps).
- `restore(snapshot?)` - load from a snapshot or from the persister.
- `reset()` - clear in-memory + on-disk.
- `removeEntry(id)` - reverse-delta.
- `refreshFromDisk()` - reload from the persister (used by `AIFlowBridge: Refresh metrics`).
- `subscribe(listener)` - notify on every mutation.

`TelemetryStore.MAX_RECENT` cap was removed in 1.6.0; every recorded request is appended with no eviction. The configurable `memoryCap` (default 10000) caps the in-memory `recent` array to bound memory under high throughput; the on-disk persister still receives every entry.

## Cost estimation

Per-request `estimatedCost` is computed at request time using the matched `ProviderProfile.pricing`. Historical costs are frozen (a fait historique) - they are never recomputed when a pricing override changes. To start over with a new rate, use `AIFlowBridge: Reset metrics`.

Errored requests (`status >= 400`) record `estimatedCost = 0` - the user is never billed for a request that never produced a billable completion. The request is still recorded (error count, per-provider / per-model usage, duration averages, per-row delete affordance) - it just does not contribute to the "Estimated cost" totals.

## Migration

On first activation after upgrading from a pre-1.5.0 install, if the legacy `aiflowbridge.telemetry.v1` globalState slot has data and the new file does not, the snapshot is moved over and the legacy slot is cleared (logged at INFO with the request/token counts). One-shot, idempotent.

## Dashboard

`src/aiflowbridge/ui/dashboard.ts` builds a self-contained HTML page with four panels:

1. **Gateway** - status, version, port, base URL.
2. **Recent requests** - per-row table with timestamp / model / status / duration / tokens / cost. Filters: time preset `<select>` (All / Last 15 min / Last 30 min / Last 1 h / Last 24 h / Last 2 days / Last 3 days / Last 7 days / Last 30 days), provider `<select>` (`All providers` + dynamic per-`byProvider` key list), custom date range (`<input type="date">` x 2), and free-text search. Pagination (per-panel, persisted in `localStorage`). Per-row delete button (when `onRemoveEntry` is wired).
3. **By model** - aggregated per-model counters with the same filter chain (the time preset is shared across both panels via `syncPresetSelects()`), plus a model-name substring match (entry-level OR model-name). The provider filter applies here too.
4. **Provider summary** - aggregated per-provider counters.

The page renders server-side first (works without JS), then a JS init pass + `rerender()` slice the rows into the persisted page size for each panel.

## Commands

| Command                                | Description                                               |
| -------------------------------------- | --------------------------------------------------------- |
| `AIFlowBridge: Show metrics dashboard` | Open the dashboard webview (`Ctrl+Alt+M`)                 |
| `AIFlowBridge: Refresh metrics`        | Reload from disk (use after a peer window wrote new data) |
| `AIFlowBridge: Reset metrics`          | Clear in-memory + on-disk (modal confirmation)            |
