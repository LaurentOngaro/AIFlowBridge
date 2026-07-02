# TODOs

Track open bugs, improvements, and active tickets. For the detailled implementation plan, see `_helpers/ACTION PLAN.md`.

## priorities

Implementation order is not strictly defined, but the general priority is:

## Project Improvements

See `_helpers/ACTION PLAN.md` for implementation details, if required for some items bellow.

### Studies (last: STU02)

- [ ] STU01: external audit: commercial and marketshare (see internal doc `_helpers\Docs\03_Synthese_Strategique_2026_06_09.md`) - actions #1, #2, #3 livrées (1.5.3 / 1.6.0); actions #4-#13 restantes (OpenRouter, Ollama, export CSV/JSON, sponsors, failover, vidéos, contact Kilo/Continue, awesome-lists, articles, posts Reddit)
  -3/13 actions livrées

### Bugs (last: BUG12)

### Documentation (last: DOC04)

### Display (last: AFF04)

### Features (last: FEAT5)

### Publish (last: PUB02)

### Refactoring (last:)

_None for now._

### API (last:API01)

_None for now._

### Performance (last:)

_None for now._

### Security (last:)

_None for now._

### Roadmap / Ideas to Investigate

_The README has a public-facing version of this roadmap in the "Roadmap" section. This file tracks the same items with more implementation detail._

Next up:

- [ ] More Agentic coding extension adapters (e.g., Claude Code)
- [ ] More openAI-compatible providers - add more profiles to the default `aiflowbridge.providers` (e.g. Azure, Gemini, Mistral) and test compatibility with the gateway routing
- [ ] OpenRouter upstream - 100+ models (GPT, Claude, Gemini, Llama, Mistral) through a single API key, synthesized into the gateway catalog like the existing 3 vendors
- [ ] Ollama upstream - local LLMs (Llama, Mistral, Qwen, DeepSeek-R1) routed through the same gateway; no cloud cost, no data leaving the machine
- [ ] Auto-routing with failover - ordered provider fallback list (e.g. DeepSeek -> MiniMax -> Ollama local) for resilience
- [ ] Custom OpenAI-compatible upstreams (LM Studio, vLLM, llama.cpp) routed through the same gateway
- [ ] Token-by-token streaming diff in the dashboard - first/last token of each response, not just the total

Backlog (value to confirm):

- [ ] Web-based dashboard at `http://127.0.0.1:8787/dashboard` (in addition to the VS Code panel)
- [ ] Workspace-level metrics - break down usage by current repo / current branch
- [ ] i18n of the extension UI (only English today, by design - revisit if requests come in)

## Completed

### 1.7.0 (Hardening) — STU02 audit items

- STU02: external audit: optimisation (see internal doc `_helpers\Docs\01 Modifications à Apporter_2026_06_05`) - **les 8 items livrés en 1.7.0 "Hardening"** (security + bugs + refactoring)
- **SEC01 (audit 1.1)**: `POST /shutdown` now requires a per-instance random token returned by `GET /version` and echoed in the `X-AIFlowBridge-Shutdown-Token` header. The token is a `randomUUID()` generated at `GatewayService` construction. Requests without the header or with a wrong token get a 403. `PeerVersion.shutdownToken` is optional in `probe.ts` for backward compat with pre-hardening peers; `requestPeerShutdown(port, { shutdownToken })` adds the header. Backward-compat note: a process that does not have a peer's token (e.g. an older pre-hardening peer) will see a 403, the same behavior as any unauthorised local process.
- **SEC02 (audit 1.2)**: `isValidProviderBaseUrl()` helper added to `src/aiflowbridge/providers.ts`. Rejects: non-http(s) schemes (`file:`, `gopher:`, `javascript:`, ...), unparseable URLs, and metadata endpoints (AWS/GCP/Azure `169.254.x.x`, Alibaba `100.100.100.200`, AWS IMDS-over-IPv6 `fd00:ec2::254`, IPv4-mapped `::ffff:169.254.x.x` and `::ffff:100.100.100.200`). Loopback is intentionally allowed (Ollama use case). `normalizeProviderProfiles` drops entries that fail the check. Exported so the unit tests cover the matrix.
- **BUG13 (audit 2.1)**: `gatewaySnapshot()` (`src/aiflowbridge/index.ts`) no longer falls back to `telemetryFallback.snapshot()` whenever the live snapshot has `requests === 0`. The fallback now only applies when the gateway is NOT running AND has not processed any request - i.e. only the genuine "showing the dashboard immediately after activation" case. Before the fix, a freshly-started gateway would display persisted data as if it were live.
- **BUG14 (audit 2.2)**: `readBody()` (`src/aiflowbridge/gateway/server.ts`) now uses a `settled` flag to guard against the `end` / `close` race. On a normal disconnect `end` resolves with the buffered body and `close` becomes a no-op; on a brutal disconnect `close` rejects. The previous version could both resolve AND reject (no-op in Promise spec) and leak listeners via the dangling `request.socket`. On `MAX_BODY_SIZE` overflow, the socket is now `destroy()`'d to stop further buffer accumulation.
- **BUG15 (audit 2.3)**: `reloadConfiguration()` (`src/aiflowbridge/index.ts`) wraps `gateway.start()` in `try/catch` and shows a targeted warning message when `EPEERSTALLED` is thrown (peer did not free the port within the timeout). The user now sees the peer PID and a clear actionable message, mirroring the `activate()` flow.
- **REF01 (audit 3.1)**: `synthesizeProvidersFromUserModels` and `synthesizeProvidersFromBuiltInModels` now share a private `synthesizeProvidersFromModels()` helper. The public signatures are unchanged; the 22 existing tests in `tests/aiflowbridge-config.test.ts` pass without modification.
- **REF02 (audit 3.2)**: `isPortLikelyOccupied()` removed from `src/aiflowbridge/index.ts`. The single call site now uses `isPortInUse()` directly. The wrapper added no value.
- **REF03 (audit 3.3)**: `getApiModelId(vscodeModelId)` (the hardcoded `'deepseek'` alias) removed from `src/config.ts`. The single call site in `src/provider/request.ts` now uses `getProviderApiModelId('deepseek', modelInfo.id)`. Verified by `grep -rn "getApiModelId\b" src/ tests/` - zero remaining call sites.
- **Tests**: 551/551 passing (was 535 in 1.6.0, +16). New regression tests in `tests/gateway-version.test.ts` (+2), `tests/gateway-restart.test.ts` (+5), `tests/aiflowbridge-providers.test.ts` (+9).
- **Quality gates**: `npm run compile` (0 errors), `npm test` (551/551). The internal audit document (`_helpers/docs/01 Modifications à Apporter_2026_06_05.md`) has been moved to `_helpers/archives/` with a DONE banner.

### 1.6.0

- BUG12: metrics dashboard date filters. The two `<input type="date">` controls on the Recent requests panel were wired to the `change` event, which the browser does not re-fire when the user picks the same date as the last commit (the dashboard then silently ignored the second change). Fix: the date inputs are now wired to BOTH `input` and `change` events; the `onDateChange` handler always calls `applyFilters()`, regardless of whether the value is set or cleared. Entering a date still deactivates the active preset (the two modes are mutually exclusive); clearing a date does NOT re-activate the preset. Additionally, the four top metric cards (Requests / Tokens / Duration / Estimated cost) used to show the cumulative totals from the snapshot, so changing the date filter did not change the "Estimated cost" headline. Fix: `applyFilters()` now calls a new `updateTotals()` that recomputes Requests / prompt+completion tokens / average duration / total estimated cost from the filtered entries, and a new `updateScopeNote()` explains what the cards reflect ("Showing all recorded requests (no filter active)." vs "Filtered totals (preset: 24h · search: "minimax")."). 4 new dashboard tests in `tests/dashboard.test.ts` (was 47, now 52).
- AFF04: pagination on the metrics dashboard. The Recent requests, By model, and Provider summary tables now expose a pagination strip underneath each one with the four navigation buttons (`<<` first, `<` prev, `>` next, `>>` last), a direct page-number `<input type="number">`, and a per-page size input (defaults: 20 for recent, 10 for by-model, 10 for provider). Page size is persisted per-panel in `localStorage` (`aiflowbridge.dashboard.pageSize.<panel>`), so the user's choice survives a dashboard refresh; page number resets to 1 on every filter change so the user always lands on a valid page. The pagination is purely client-side: the server-side render still emits ALL rows so the dashboard still shows data with JS disabled (the JS init pass + `rerender()` then slice the rows into the persisted page size for each panel). Provider summary gains a sort-by-requests-desc stable order so the first page shows the busiest vendors first. New CSS for `.pagination`, `.page-btn`, `.page-jump`. 5 new dashboard tests in `tests/dashboard.test.ts` (was 52, now 57).
- DOC04: Action #2 (VS Code Marketplace listing): `displayName` now leads with the concrete model names users search for (`AIFlowBridge - DeepSeek V4, MiniMax M3 & MiMo in Copilot Chat`), and `description` is restructured around the 3-problems-3-bullets model from the plan (multi-vendor picker / free vision / local OpenAI gateway). Added `galleryBanner` (dark theme, brand color `#0f172a`). `qna` was removed from the manifest after VS Code flagged it (`Expected one of string, boolean.`) - the field accepts only a URL or boolean, not an array of {question, answer} objects. The FAQ content now lives in `docs/*.md` instead. Action #3 (README hook): the first 10 lines lead with the cost-comparison story (Copilot $19 vs Cursor $20 vs Kilo+DeepSeek vs Kilo+MiMo vs Kilo+Ollama $0) instead of a feature list, with a "Migrating from Copilot alone?" callout directly under the tagline. Action #3 follow-up (SEO + readability): the README has been split into 9 focused pages under `docs/` (929 lines → 108 lines + 9 subpages). `docs/cost.md` carries the cost breakdown and pricing math; `docs/providers.md` carries the providers table + hardcoded rationale + adding a model; `docs/vision-proxy.md` covers the image-to-text proxy; `docs/reasoning.md` covers MiniMax M3; `docs/gateway.md` covers the singleton + version-aware restart + Kilo Code / OpenAI clients; `docs/dashboard.md` covers the metrics panel features + screenshots; `docs/architecture.md` carries the source layout + 3-tier model registry; `docs/development.md` covers build/test/package/privacy; `docs/troubleshooting.md` covers the common errors. Each page anchors back to `../README.md`. The README itself now reads in <2 minutes.
- PUB02: VS Code Marketplace listing refactor. `keywords` array (28 entries, grouped: chat / vision / providers / agents / cost / openai-compatible) surfaces the listing in searches for "deepseek-v4", "minimax-m3", "copilot-alternative", "openai-compatible", "kilocode", "continue", "ollama", "agent-mode", "cost", "token-tracking". `qna` was simplified to a string pointing at GitHub Discussions after the manifest validator rejected the array-of-objects shape. The screenshots at `resources/screenshots_v1.4.0/` and `resources/screenshots_v1.1.1/` are referenced from `docs/dashboard.md` (which owns the Demo section in the new layout). When new v1.6.0 screenshots are captured (pagination strip, BUG12-filtered totals), they should be dropped into `resources/screenshots_v1.6.0/` and `docs/dashboard.md` updated to point at them.
- BUG (1.6.0 follow-up): the in-memory `recent` list was capped at 20 entries (`src/aiflowbridge/telemetry.ts`), then raised to 100 (`TelemetryStore.MAX_RECENT`). The cap was still hiding entries from the dashboard pagination: clicking "All" on a user with 10 000 recorded requests showed `1-25/100` while the "Requests" card correctly displayed 10 000. The cap is now removed entirely from both the in-memory `TelemetryStore` and the on-disk `TelemetryPersister` - every recorded request is kept in `recent`, and the dashboard paginates the full history (`Per page` up to 500). Tests in `tests/telemetry-store.test.ts` and `tests/telemetry-persistence.test.ts` now assert that 250 entries all survive. Existing on-disk files written under the old cap only contain the last N entries; from this fix forward, every new request is appended with no eviction.

## Unversioned

- PUB01: Publish on Open VSX Registry (reach Cursor / Windsurf / VSCodium / code-server users)
- FEAT5: reasoning picker for MiniMax M3 (see issue on [kilocode](https://github.com/Kilo-Org/kilocode/issues/11116)) - fixed by kilo team

### 1.5.2

- BUG11: [metric dashboard: requests in error have an estimated cost](https://github.com/LaurentOngaro/AIFlowBridge/issues/5) - `GatewayService.recordTelemetry()` now sets `estimatedCost = 0` whenever the recorded `status` is `>= 400` (4xx / 5xx upstream response, or the catch-block default of 502 when the upstream never responded). The request is still recorded (error count, per-provider / per-model usage, duration averages, per-row delete affordance) - it just no longer contributes to the "Estimated cost" totals. Cost = fait historique: we never bill the user for a request that never produced a billable completion. The fix naturally propagates to the cumulative `TelemetryStore.snapshot()` (`applyEntryToSnapshot` / `applyEntryInMemory` just add `entry.estimatedCost` to the totals, so a zero-cost entry contributes nothing), to the on-disk file (the persister applies the same delta), and to the per-row delete path (`removeEntry` decrements under `Math.max(0, ...)` guards). 5 new regression tests in `tests/gateway.test.ts` (new "BUG11: errored requests have zero cost" describe block) cover: successful 200 (cost computed normally), 5xx upstream response (cost=0, errors=1, model usage still recorded), 4xx upstream response (cost=0, errors=1), unreachable upstream / catch block (statusCode=502, cost=0), and a mixed success/error sequence (only successful requests contribute to the total). 507 tests / 27 fichiers (était 502 / 27).

### 1.5.0

- FEAT1: cross-window shared metrics with concurrent access management. Telemetry is now stored in a real file at `<globalStorageUri>/telemetry.json` (no longer in VS Code's internal `globalState`). A sibling `<globalStorageUri>/telemetry.lock` file serializes writers across VS Code windows. The lock follows the same pattern as the existing gateway lock (stale mtime reaper at 30s, symlink refusal, mkdir-recursive, atomic write via `write-tmp` + `rename`). `TelemetryStore.record()` now fires an async `persister.appendDelta()` per call (with an idempotency check on `entry.id` to defend against a debounce fire-twice). The in-process write chain (`this.writeChain.then(fn, fn)`) guarantees the cross-process lock is acquired and released in the right order even when N parallel record() calls land in the same microtask. Concurrent writers are tested with 50 parallel `appendDelta` calls: zero lost updates. The `AIFlowBridge: Refresh metrics` command now calls `gateway.refreshFromDisk()` + `telemetryFallback.refreshFromDisk()` so a non-leader window picks up the leader's writes without a reload. A one-time migration runs on first activation after the upgrade: if the legacy `globalState` slot has data and the new file does not, the snapshot is moved over and the legacy slot is cleared (logged at INFO with the request/token counts). New file `src/aiflowbridge/telemetry/persistence.ts`; new file `tests/telemetry-persistence.test.ts` (24 tests covering the lock, atomic write, concurrent writers, idempotency, corruption recovery, and the TelemetryStore integration). 453 tests / 26 files (was 420 / 25).
- AFF03: metrics dashboard UI improvements. The header now shows the running gateway version (`Gateway vX.Y.Z running/stopped`) and the installed extension version under the title (`Current version: vX.Y.Z`). All four panel sections (Gateway / Recent requests / By model / Provider summary) are now collapsible via a chevron in their header, with the collapsed state persisted in `localStorage` per-section. The Recent requests panel gains two `<input type="date">` controls (From / To) and one `<input type="search">` ("Filter requests…"). The text search is case-insensitive and matches across `model`, `providerId`, `providerLabel`, `status`, `timestamp` (ISO + locale-formatted), `durationMs`, `totalTokens`, `promptTokens`, `completionTokens`, `estimatedCost`, and the `estimated`/`usage` source tag. The custom date range and the text search apply on top of the existing preset time filter (intersection, not replacement). The `buildDashboardHtml` signature gains an optional 4th `versions` parameter (`{ gateway?, extension? }`) so the 1.4.x callers that do not pass versions keep working unchanged. `GatewayService` exposes a `bundledVersion` getter for the header. 9 new dashboard tests in `tests/dashboard.test.ts` (was 25, now 34).

### 1.4.1

- BUG08: [image not analysed](https://github.com/LaurentOngaro/AIFlowBridge/issues/1)
- BUG10: [prices are not updated on metrics](https://github.com/LaurentOngaro/AIFlowBridge/issues/3) - 3 corrections indépendantes étaient nécessaires pour que l'override de pricing remonte jusqu'au dashboard : (1) `synthesizeProviderForModel` (`src/aiflowbridge/config.ts`) acceptait `model.pricing` en option et l'utilisait avant le fallback family-level ; `buildDefaultGatewayProfiles` fait `entry.pricing ?? toProviderPricing(registryEntry?.pricing)`. (2) `validateModelEntry` (`src/aiflowbridge/modelRegistry.schema.ts`) accepte un `mode: 'strict' | 'partial'` ; les tiers globalStorage et workspace chargent en `'partial'`, donc un override `{ "id": "MiniMax-M3", "pricing": { ... } }` (sans `name`/`family`/etc.) n'est plus silencieusement droppé. (3) `showMetricsDashboard` (`src/aiflowbridge/ui/dashboard.ts`) accepte un `ConfigGetter` au lieu d'une `AiFlowBridgeConfig` capturée, donc le bouton Refresh du dashboard re-lit `this.config` (re-evalué par `loadConfig()` à chaque activation) et les tooltips reflètent le pricing actuel sans rouvrir le panel. Diagnostic logging ajouté dans `loadModelRegistry` et `loadConfig` (chemin du fichier, `exists=true/false`, pricing par modèle, source de la synthèse) pour repérer d'un coup d'œil les `aiflowbridge.providers` qui court-circuitent le registry. 420 tests / 25 fichiers (était 407 / 25). Note : les `RequestTelemetry.estimatedCost` historiques restent figés (coût = fait historique), seule la rate affichée dans le tooltip / la nouvelle requête utilisent le pricing actuel - pour repartir à zéro avec le nouveau tarif, `AIFlowBridge: Reset metrics`.

### 1.4.0

- BUG09: ["Edit model registry" fails](https://github.com/LaurentOngaro/AIFlowBridge/issues/2)
- FEAT3: Version-aware cooperative gateway restart (`src/aiflowbridge/gateway/probe.ts` + `lock.ts` + `/version` + `/shutdown` endpoints on `server.ts`). The new activation probes the peer on `http://127.0.0.1:<port>` (hard-coded loopback, not the user-configurable `baseUrl` - see Security note below) and:

### 1.3.0

- FEAT2: - External model registry (`resources/models.json` + 3-tier merge: workspace `.vscode/aiflowbridge.models.json` > `globalStorage` > bundled). Adds `AIFlowBridge: Edit model registry` and `AIFlowBridge: Reset model registry to bundled defaults` commands. `src/consts.ts` trimmed from 202 to ~50 lines (`MODELS`, `DEFAULT_PROVIDER_URLS`, `EXTERNAL_URLS` are gone, data now lives in the registry and is read at activation via `loadModelRegistry(context)`). 50 new tests across `tests/modelRegistry.schema.test.ts` (39) + `tests/modelRegistry.test.ts` (11). Per-model `pricing` blocks in the registry are the new source of truth for the dashboard "Est. cost" column.

### 1.2.3

- BUG07: `resolveVendorApiKey` (extracted to `src/aiflowbridge/api-key-resolver.ts`) is now case-insensitive and accepts the upstream-style id aliases. The default vendor ids (`minimax`, `deepseek-flash`, `xiaomi`) still work, and user-added models with upstream-style ids (`MiniMax-M3`, `MiniMax-M2.7`, `mimo-v2.5-pro`, etc.) now correctly resolve to the right vendor API key in `SecretStorage`. Also fixed a pre-existing bug: Xiaomi user-added models (which use the `mimo-` prefix) were never matched against the `xiaomi` vendor by the old resolver - now explicitly aliased.

### 1.2.2

- BUG06: `GatewayService` no longer auto-wires persistence in its constructor. The `loadState()` and `saveState` callbacks are now set up via a separate `init()` method, which the `AIFlowBridgeRuntime` calls from its constructor body after `this.context` is assigned. Fixes the `Cannot read properties of undefined (reading 'globalState')` warning that fired on every activation in debug mode (TypeScript class field initializers run before parameter property assignment).
- Small README content changes.

### 1.2.1

- DOC02: README "What the metrics dashboard actually tracks" section under "Demo" now explains that the dashboard tracks gateway-served requests only (Kilo Code, Continue, Open WebUI, curl, OpenAI SDK pointed at `http://127.0.0.1:8787/v1`, etc.) and not prompts sent from Copilot Chat. Includes a comparison table of the two integrations (entry point, provider implementation, telemetry), the structural reason (VS Code's `vscode.lm` API is push-only, the gateway is a regular HTTP server with full request/response metadata), and a quick `curl` test for verification. The "Example workflow" was rewritten to use Kilo Code (the gateway path) rather than Copilot Chat.
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
