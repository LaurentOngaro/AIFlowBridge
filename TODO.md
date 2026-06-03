# TODOs

Track open bugs, improvements, and active tickets. For the detailled implementation plan, see `_helpers/PLAN_ACTIONS.md`.

## Immediate Fixes (last:)

_Placeholder section - no urgent fixes._

## Project Improvements

For implementation details, see `_helpers/PLAN_ACTIONS.md`.

### Implementation Priorities

Tickets ranked by priority (most urgent first):

- None

## Bugs (last:BUG07)

_None - last bug BUG07 was fixed in 1.2.3._

### Documentation (last:DOC02)

_None - last docs ticket DOC02 was completed in 1.2.1._

### Display (last:AFF02)

_None - last display tickets AFF01 / AFF02 were completed in 1.2.0._

### Features (last:)

### Refactoring (last:)

### API (last:API01)

_None - last API ticket API01 was completed in 1.2.0._

### Performance (last:)

### Security (last:)

### Roadmap / Ideas to Investigate (last:)

_The README has a public-facing version of this roadmap in the "Roadmap" section. This file tracks the same items with more implementation detail._

**In progress:**

- All planed items are done for now

**Next up:**

- [ ] Telemetry export - JSON / CSV export of the metrics snapshot for billing or analysis
- [ ] More Agentic coding extension adapters (e.g., Claude Code)
- [ ] More openAI-compatible providers - add more profiles to the default `aiflowbridge.providers` (e.g. Azure, Gemini, Mistral) and test compatibility with the gateway routing
- [ ] Custom OpenAI-compatible upstreams (LM Studio, vLLM, llama.cpp) routed through the same gateway
- [ ] Token-by-token streaming diff in the dashboard - first/last token of each response, not just the total

**Backlog (value to confirm):**

- [ ] Web-based dashboard at `http://127.0.0.1:8787/dashboard` (in addition to the VS Code panel)
- [ ] Workspace-level metrics - break down usage by current repo / current branch
- [ ] i18n of the extension UI (only English today, by design - revisit if requests come in)

## Completed

### 1.2.3

- BUG07: `resolveVendorApiKey` (extracted to `src/aiflowbridge/api-key-resolver.ts`) is now case-insensitive and accepts the upstream-style id aliases. The default vendor ids (`minimax`, `deepseek-flash`, `xiaomi`) still work, and user-added models with upstream-style ids (`MiniMax-M3`, `MiniMax-M2.7`, `mimo-v2.5-pro`, etc.) now correctly resolve to the right vendor API key in `SecretStorage`. Also fixed a pre-existing bug: Xiaomi user-added models (which use the `mimo-` prefix) were never matched against the `xiaomi` vendor by the old resolver - now explicitly aliased.

### 1.2.2

- BUG06: `GatewayService` no longer auto-wires persistence in its constructor. The `loadState()` and `saveState` callbacks are now set up via a separate `init()` method, which the `AIFlowBridgeRuntime` calls from its constructor body after `this.context` is assigned. Fixes the `Cannot read properties of undefined (reading 'globalState')` warning that fired on every activation in debug mode (TypeScript class field initializers run before parameter property assignment).
- Small README content changes.

### 1.2.1

- DOC02: README "What the metrics dashboard actually tracks" section under "Demo" now explains that the dashboard tracks **gateway-served requests only** (Kilo Code, Continue, Open WebUI, curl, OpenAI SDK pointed at `http://127.0.0.1:8787/v1`, etc.) and **not** prompts sent from Copilot Chat. Includes a comparison table of the two integrations (entry point, provider implementation, telemetry), the structural reason (VS Code's `vscode.lm` API is push-only, the gateway is a regular HTTP server with full request/response metadata), and a quick `curl` test for verification. The "Example workflow" was rewritten to use Kilo Code (the gateway path) rather than Copilot Chat.
- DOC03: README marketplace badges (version / installs / downloads) now use `vsmarketplacebadge.apphb.com` instead of `visualstudio-marketplace/i` / `visualstudio-marketplace/d` on shields.io (those shortcuts are not real endpoints; shields.io's VS Marketplace scraping has been unreliable since Microsoft changed their API).
- README audit: fixed several factual errors that had drifted in during the 1.2.0 cycle (tagline, Kilo Code model ids, /health response shape, native vs proxied vision in the Providers table, architecture tree, commands table, troubleshooting, settings, roadmap). Cost comparison rewritten to drop marketing fluff. "Why sponsor?" updated to use the real GitHub Sponsors tiers ($4 / $12 / $30).

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
