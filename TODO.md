# TODOs

Track open bugs, improvements, and active tickets. For the detailled implementation plan, see `_helpers/PLAN_ACTIONS.md`.

## Immediate Fixes (last:)

_Placeholder section - no urgent fixes._

## Project Improvements

For implementation details, see `_helpers/PLAN_ACTIONS.md`.

### Implementation Priorities

Tickets ranked by priority (most urgent first):

- None

## Bugs (last:BUG04)

_None - last bug BUG03 was fixed in 1.2.0._

### Documentation (last:DOC02)

- [DOC02] update readme to reflect that the metrics are for kilo code ONLY and add some technical explanations for that (for reassurance)

### Display (last:AFF02)

_None - last display tickets AFF01 / AFF02 were completed in 1.2.0._

### Features (last:)

### Refactoring (last:)

### API (last:API01)

_None - last API ticket API01 was completed in 1.2.0._

### Performance (last:)

### Security (last:)

### Roadmap / Ideas to Investigate (last:)

## Completed

### 1.2.0

- BUG03: `AIFlowBridge: Add a custom model` now writes to Workspace settings as a fallback when User settings is not yet initialized (resolves "is not a registered configuration").
- BUG04: user-declared models (from `aiflowbridge.userModels`) are now synthesized as virtual gateway providers. They appear in `GET /v1/models` and are routable by `selectProvider`, so Kilo Code / Continue / any OpenAI-compatible client can see and use them. Duplicates with existing gateway profiles are skipped.
- BUG05: `selectProvider` no longer silently falls back to the first enabled provider when the requested model does not match any alias. The gateway now returns 404 with a list of available provider ids, so the user is no longer tricked into thinking they called MiMo when the upstream was DeepSeek. The "no providers configured" 503 path is preserved as a separate case.
- Persistent metrics: `TelemetryStore` now persists the snapshot in `globalState` (`aiflowbridge.telemetry.v1`). Cumulative counters survive extension reloads, VS Code restarts, and debug sessions. New `AIFlowBridge: Reset metrics` command clears the state.
- API01: gateway calls MiniMax `/v1/responses/input_tokens` in parallel for accurate prompt token counting. DeepSeek and Xiaomi continue to use the heuristic / stream-usage calibration.
- AFF01: dashboard "Recent requests" rows now show a local-time clock (HH:MM:SS) with full ISO timestamp in the cell tooltip.
- AFF02: dashboard now has a "By model" panel with the same time filters as the recent requests (All / 1h / 24h / 7d / 30d). Filters are client-side and instant.
- DOC01: README "Demo" section now includes a 3x3 screenshot grid. Screenshots copied to `resources/screenshots_v1.1.1/` (preserved at `_helpers/screenshots_v1.1.1/`).
- Dashboard refresh button: the dashboard now has a "Refresh" button (to the right of the title) that re-reads the latest gateway snapshot. `showMetricsDashboard` accepts getter functions for live refresh.

### 1.1.1

- Documentation update only. No code changes.

### 1.1.0

- Added `aiflowbridge.userModels` setting and the `AIFlowBridge: Add a custom model` command.
