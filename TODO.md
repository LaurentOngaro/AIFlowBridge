# TODOs

Track open bugs, improvements, and active tickets. For the detailled implementation plan, see `_Private/docs/ACTION_PLAN.md`.

## priorities

Implementation order is not strictly defined, but the general priority is:

## Project Improvements

See `_Private/docs/ACTION_PLAN.md` for implementation details, if required for some items bellow.

### Studies (last: STU02)

_None for now._

### Bugs (last: BUG20)

_None for now._

### Documentation (last: DOC04)

- [ ] DOC05: Readme and docs
  - [ ] update the screenshot in README.md
  - [ ] add new screenshot
  - [ ] add a video or/and an animated GIF for presenting the tool
  - [ ] **30-second asciinema (or animated GIF) of `curl http://127.0.0.1:8787/v1/chat/completions` with an OpenRouter id** (audit §7.3 recommendation). The current `docs/screenshots.md` gallery is dashboard-heavy; an end-to-end video of the local-gateway loop with Kilo Code in the picker side-by-side is the missing 30-second "show, don't tell" artifact for skimmers. Track under `resources/screenshots_v2.16.0/` once recorded.
  - [ ] **README "For whom" 3-column table above the fold** (audit §7.2 frictions + §7.3 recommendation): "Solo dev / Team / JetBrains shop" - 3 columns, one row, one sentence each, telling each persona why AIFlowBridge solves their specific problem. Replaces the current "Why AIFlowBridge?" bullets at `README.md:93-102` which interleave routing, workspace-context, and pair-programming concerns.
  - [ ] **Ollama-first roadmap reordering** (audit §7.2 frictions + §7.3 recommendation): `README.md:247-249` currently lists Qwen + GLM, Ollama, web dashboard, and auto-routing failover together - all desirable, but Ollama (local $0, single-key-unlocks-N-models parity with OpenRouter) is the only one that changes the cost story. Lead with Ollama in the roadmap, keep Qwen/GLM as "next vendor" bullets.

### Display (last: AFF07)

_None for now._

### Features (last: FEAT12)

- [ ] FEAT12: add Alibaba Qwen (DashScope) and ZAI GLM as leading OpenAI-compatible vendors, in the same way as DeepSeek / MiniMax / Xiaomi (dedicated picker, API key commands, preconfigured gateway profile, bundled models). See `_Private/ACTION_PLAN.md` section 1 for the detailed implementation plan.
- [ ] FEAT11: follows up for FEAT10: Follow-up tracks for the rest (not done, postponed)
  - [ ] **README.md cost tables regenerated from `resources/pricing.json`.** The action plan provided a script `_helpers/scripts/refresh-pricing-readme.py` to regenerate the prose tables of the README and `docs/cost.md` from the JSON bundle. Not implemented in this pass; can be added in a later release.
  - [ ] **Drift drift-warning emit on user-side divergence.** The action plan explicitly states: "No drift warning is emitted when the user-side refresh produces a rate that diverges from the bundled one." We respect the instructions (no warning), but a toggle opt-in (`aiflowbridge.gateway.pricing.warnOnDrift`) remains possible if a user requests it.
  - [ ] **Configurable source URL (`aiflowbridge.gateway.pricing.sourceUrl`).** The action plan deviates the subject for this iteration (OpenRouter hard-coded). To be reopened if a user goes through an OpenRouter-compatible proxy.
  - [ ] **CLI sub-command `aiflowbridge-server pricing refresh`.** The action plan dismisses the subject for this iteration (the standalone is content with bundled JSON + globalStorage override). To be reopened if necessary for headless deployments.
-

### Publish (last: PUB02)

_None for now._

### Refactoring (last: REC02)

- [ ] REC01: Decompose `src/aiflowbridge/host-config.ts` (~570 lines, 2nd-largest file in `src/` after `gateway/server.ts` post-2.15.7) into two focused modules: `src/aiflowbridge/gateway/settings.ts` (the `GatewaySettings` assembly in `loadConfigFromContext`, lines ~310-565) and `src/aiflowbridge/gateway/pricing-resolution.ts` (`resolvePricingForModel` + `toProviderPricing`, lines ~127-195). Audit §3.2 finding, §6.3 backlog. No behavior change, only file-size relief. Unblocks independent testability of the pricing precedence chain (workspace > globalStorage > bundled pricing.json > per-model models.json > family default). Tracking doc: `docs/audits/2026-08-06-audit-v2.15.5.md` §1.1 row "Decompose `host-config.ts`".
- [ ] REC02: Property-based test for `deepMergeModel` / `deepMergeVendor` in `src/aiflowbridge/modelRegistry.schema.ts:526-569`. The hand-rolled 3-tier merge is correct but subtle around `pricing` partials (an override that only sets `pricing` must keep every other field from the bundled entry). A fast-check style test would guard against a future field addition that forgets to merge (e.g. a new `capabilities` sub-field silently dropped from the override path). Audit §6.3 backlog. Out of scope for the 2.15.7 patch (deferred); ship in next minor alongside REC01.

### API (last:API01)

_None for now._

### Performance (last:)

_None for now._

### Security (last:)

_None for now._

### Roadmap / Ideas to Investigate

_The README has a public-facing version of this roadmap in the "Roadmap" section. This file tracks the same items with more implementation detail._
_The 2026-08-06 audit (`docs/audits/2026-08-06-audit-v2.15.5.md` §1.1 + §6.3 + §9.2) is the source-of-truth backlog for the items below - each entry points to the audit section that proposed it, and the §1.1 table tracks which recommendations already landed (in 2.15.7) versus which are still open._

Next up:

- [ ] Alibaba Qwen (DashScope) + ZAI GLM as first-class vendors - first-class picker entries, per-vendor `setApiKey` / `clearApiKey`, gateway profiles, bundled models (Qwen3 Coder / Qwen3 Max, GLM-4.6 / GLM-4.5). See `_Private/ACTION_PLAN.md` section 1.
- [ ] Ollama upstream - local LLMs (Llama, Mistral, Qwen, DeepSeek-R1) routed through the same gateway; no cloud cost, no data leaving the machine
- [ ] Web-based dashboard at `http://127.0.0.1:8787/dashboard` (in addition to the VS Code panel)
- [ ] Custom OpenAI-compatible upstreams (LM Studio, vLLM, llama.cpp) routed through the same gateway
- [ ] More openAI-compatible providers - add more profiles to the default `aiflowbridge.providers` (e.g. Azure, Gemini, Mistral) and test compatibility with the gateway routing
- [ ] More Agentic coding extension adapters (e.g., Claude Code)
- [ ] Auto-routing with failover - ordered provider fallback list (e.g. DeepSeek -> MiniMax -> Ollama local) for resilience
- [ ] Token-by-token streaming diff in the dashboard - first/last token of each response, not just the total

Backlog (value to confirm):

- [ ] Workspace-level metrics - break down usage by current repo / current branch
- [ ] i18n of the extension UI (only English today, by design - revisit if requests come in)

## Completed

### 2.15.2

- BUG20 dashboard metrics: values ​​in the client column must be shortened to prevent the requests list from extending beyond the section in which it is contained

### 2.15.0

- FEAT10: dynamic prices and cost estimation (see 2.15.0 CHANGELOG entry above for the full surface - bundled JSON, 4-tier merge, commands, dashboard button, release-time script, doc)
- AFF07: metric dashboard telemetry export (CSV / JSON, honors active filters) - see 2.15.0 CHANGELOG entry above

### 2.12.0

- STU01: OpenRouter upstream shipped (see `_Private/docs/ACTION_PLAN.md` section 4 + `resources/models.json` `vendors.openrouter` entry). 100+ model ids reachable through `family: "openrouter"` in `aiflowbridge.userModels` or via the bundled 7 flagships. Attribution headers (`HTTP-Referer`, `X-Title`) injected by the gateway. New smoke test in `tests/integration/openrouter.smoke.test.ts`.

### 2.11.0

- 20Command "install standalone gateway" fails with error " Failed to install standalone gateway: Cannot find module 'adm-zip'"

### 2.10.0

- FEAT10: Pair programming / multi-IDE / multi-language improvements (see `_Private/docs/ACTION_PLAN.md`)
  - Per-client IDE telemetry (multi-IDE visibility) - shipped in 2.5.0 (item 1)
  - Bridge Copilot Chat path into TelemetryStore (pair-prog visibility) - shipped in 2.6.0 (item 6)
  - Workspace context injection (multi-language quality) - shipped in 2.7.0 (item 2)
  - Language-based model routing rules (multi-language) - shipped in 2.7.0 (item 5)
  - Zero-conf discovery (mDNS or UDP broadcast) - shipped in 2.7.0 (item 4)
  - Shared session log + replay endpoint + SSE - shipped in 2.10.0 (item 3)

### 2.9.0

- AFF06: metric dashboard:
  - add the possibility to group the requests by sessions (using date/time check to group them in a session, e.g., 30 minutes of inactivity = new session)
    - each session is displayed as a collapsible section, with the session start time and the number of requests in that session
    - each session has a summary of the total tokens used, the total duration, and the total estimated cost

### 2.7.0 - `/review uncommitted` follow-ups (post-CR02 hardening)

- BUG17: [gateway agents stuck in standby for minutes when 3 agents run in parallel against MiniMax-M3 (reasoning_split: true)](https://github.com/LaurentOngaro/AIFlowBridge/issues/) - shipped in 2.5.1 (A+B+C+D scope). Fix A silences the `MaxListenersExceededWarning`; B adds upstream idle + total stream timeouts (HTTP 504 instead of indefinite standby); C removes the self-inflicted parallel pre-count on streaming MiniMax requests; D adds the per-provider concurrency semaphore. See `_Private/docs/ACTION_PLAN.md` for the full implementation summary.
  - Fix A: silence `MaxListenersExceededWarning` (one `socket.once('close', ...)` per physical socket via `WeakSet<Socket>`, not per request) at `src/aiflowbridge/gateway/server.ts:262-280`
  - Fix B: upstream idle-stream watchdog (default 90 s, `gateway.upstreamIdleTimeoutMs`) + total stream ceiling (default 300 s, `gateway.streamTotalTimeoutMs`) on the upstream `fetch()`; surfaces HTTP 504 to the client instead of indefinite standby
  - Fix C: skip the unconditional parallel `fetchMinimaxPromptTokens` pre-count on streaming MiniMax requests (opt-in via `gateway.minimaxParallelTokenCount`, default `false`); share the abort signal with the main request
  - Fix D: per-provider concurrency semaphore (`gateway.maxConcurrentPerProvider`, default 3) - queues the 4th+ parallel request for the same provider instead of opening more upstream sockets
  - Fix E: forward HTTP 429 + `Retry-After` from the upstream on streaming responses; short-circuit streaming requests that hit a backoff status (429 / 503) so the upstream JSON body is NOT streamed as SSE - shipped in 2.7.0
- AFF08: metric dashboard:
  - display preset filter in a combobox instead of a list of buttons
  - add new filters presets : last 15mn, last 30mn, last 2 days, last 3 days
  - add a filter by providers (combo box) - shipped in 2.7.0
- Multi-language quality lift + zero-conf discovery
  - FEAT2. `src/aiflowbridge/context/workspace-context.ts` scans the workspace root for language manifests (`pyproject.toml`, `Cargo.toml`, `package.json`, `pom.xml`, `*.csproj`, `mix.exs`, `CMakeLists.txt`, ...) and prepends a short system message to every `/v1/chat/completions` describing the languages / package managers / linters / formatters detected. The detector is bounded by `maxDepth` (default 2) + `maxEntries` (default 50) + an `ignoredDirs` set so a deep dependency tree cannot stall the request. Workspace root resolution order: `aiflowbridge.gateway.workspaceContext.root` -> `AIFLOWBRIDGE_WORKSPACE` env var -> `process.cwd()` -> VS Code workspace folder. New `GET /v1/context` HTTP endpoint exposes the detected `WorkspaceContext` as raw JSON.
  - FEAT5. `aiflowbridge.gateway.languageRouting` config (map of `language -> providerId`, `*` wildcard). `selectProviderWithLanguage()` tries the routing table first, then falls back to the existing `selectProvider(model, defaultModel)`. The language hint resolves in order: explicit `X-A-F-Language` HTTP header -> first recognisable filename in the request body's `messages[]` -> workspace context primary language (item #2). Match against `provider.id` / `provider.model` / `provider.label` with case-insensitive sensitivity.
  - FEAT4. Pure-Node UDP broadcast on `aiflowbridge.gateway.discovery.broadcastPort` (default 8788) every `aiflowbridge.gateway.discovery.broadcastIntervalMs` (default 2 000 ms). Payload: `{ host, port, version, protocol: "openai", path: "/v1" }` broadcast to `255.255.255.255`. New `GET /v1/discovery` HTTP endpoint on the loopback URL returns one-paste client config snippets for Continue / Kilo Code / OpenAI Python SDK / curl. Both surfaces gated on `aiflowbridge.gateway.discovery.enabled` (default `false` so the standalone CLI does not emit UDP packets on shared machines unless explicitly opted in). No new runtime dependency: no `bonjour-service`, no `mdns`, no platform-specific binary.
  - 8 new `aiflowbridge.gateway.*` settings added to `package.json` with full descriptions.
  - `tests/gateway-actions-2-4-5.test.ts` (new) - 25 tests.

### 2.6.1 (Hotfix: 2.6.0 wiped the dashboard for pre-2.5.0 users)

- BUG18 - 2.6.0 wiped the dashboard for users upgrading from a version pre-2.5.0. `isValidSnapshot()` in `src/aiflowbridge/telemetry/persistence.ts` previously required every per-bucket map to be a present object: `typeof candidate.byProvider === "object"`, `typeof candidate.byModel === "object"`, `typeof candidate.byClient === "object"`. A user upgrading from 2.4.x (where `byClient` did not exist in the on-disk shape) had the file rejected as "does not match the expected shape, ignoring", and the cumulative counters (which the user had built up over months) were silently wiped because the in-memory `TelemetryStore` started from `emptyTelemetrySnapshot()` and the very next `record()` overwrote the rejected file. Fix: the three per-bucket maps are now treated as optional in the validator (`value === undefined || typeof value === "object"`), matching the optional shape they already have in the `TelemetrySnapshot` interface. `normalizeSnapshot()` now also defaults `bySource` to `{}` so the in-memory state matches the on-disk shape after `restore()`. Two new regression tests in `tests/telemetry-persistence.test.ts` cover the pre-2.5.0 shape (no `byClient`, no `bySource`, legacy entry with no `source` field) and the post-2.5.0 pre-2.6.0 shape (`byClient: {}` present, `bySource` absent).

### 2.6.0 (Bridge Copilot Chat path into TelemetryStore + dashboard By source panel + per-request log timestamp)

- FEAT6: `UnifiedChatProvider.provideLanguageModelChatResponse` now wraps every Copilot Chat call (success and error) with a `TelemetryStore.recordFromCopilotChat()` call. A new `CopilotChatTelemetrySink` interface is wired in `lifecycle.ts` after the runtime builds its `TelemetryStore`, so Copilot Chat traffic lands in the same `byProvider` / `byModel` / `byClient` maps as gateway traffic and gains a new `bySource` split (`'gateway'` vs `'copilot-chat'`). Pure additive change to the `TelemetrySnapshot` schema (the `source` field on `RequestTelemetry` and the `bySource` field on `TelemetrySnapshot` are both optional, defaulting to `'gateway'` and `{}` respectively, so older on-disk snapshots load unchanged and the next `record()` call repopulates the new aggregation as requests come in). The wrap is best-effort: a throw inside the sink (telemetry broken) never breaks the upstream pipeline, and a missing sink (runtime not yet built, e.g. when the activation lock is held by a peer activation) is a no-op. Errors are classified into HTTP-ish status codes (e.g. a `ProviderRequestError` carrying `status: 502` from a MiniMax upstream is recorded as 502; anything else lands as 500) so the dashboard's "errors" counter and per-source status breakdown stay meaningful. New public methods: `GatewayService.recordFromCopilotChat(options)`, `AIFlowBridgeRuntime.recordFromCopilotChat(options)`, `UnifiedChatProvider.setTelemetrySink(sink)`, `TelemetryStore.recordFromCopilotChat(options)`.

### 2.4.1 (Hotfix: broken commands + dashboard sorting)

- AFF05: column sorting on the metrics dashboard. Click any column header on the Recent requests, By model, or Provider summary tables to sort ascending; click again for descending; click a third time to clear the sort. The sort state is per-panel (independent). Numeric columns compare numerically (tokens, cost, duration), text columns use locale-aware string comparison. Sort arrows (▲ / ▼) appear on the active column. 13 new dashboard tests in `tests/dashboard.test.ts`.
- BUG16: all VS Code command palette commands broken after installing 2.4.0. Static top-level imports of `adm-zip` and `tar` in `src/runtime/installStandalone.ts` failed at module load time because these runtime dependencies are not shipped in the VSIX (`.vscodeignore` excludes `node_modules/**` and there is no bundler). The failure cascaded to `src/runtime/commands.ts` (which statically imported `installStandalone.ts`), blocking ALL command registrations. Fix: (1) `tar` and `adm-zip` imports moved to dynamic `import()` inside `extractTarGz()` / `extractZip()` so they only load when the user actually triggers the install command; (2) `commands.ts` wraps the `installStandalone` import in a `try/catch` so a future dependency issue with a single command cannot break all others.

### 2.4.0 (Install Standalone Gateway)

- FEAT8: Install standalone gateway (Option 3 of the V2 distribution plan, see `_Private/docs/ACTION_PLAN.md`) - one-click command in the VS Code extension that downloads the platform-matched standalone CLI binary from the latest GitHub Release, extracts it to a user-chosen directory, makes the launcher executable (POSIX), and offers to add an autostart unit (systemd / launchd / Task Scheduler). Removes the "clone the repo, run npm ci, run npm run build:standalone" friction for the majority of users who do not have the dev toolchain installed. Idempotent (detects existing install, prompts Replace / Keep / Cancel), atomic extraction (cleanup in `finally`), redirect-following (HTTP 301-308, max 5 hops). New runtime deps: `adm-zip` (Windows), `tar` (POSIX). New file `src/runtime/installStandalone.ts` + 13 unit tests in `tests/install-standalone.test.ts`.

### 2.0.0 (Standalone Gateway)

- FEAT7: Standalone Gateway - use the endpoint independently of VS Code (1.7.0).

### 1.7.0 (Hardening) - STU02 audit items

- STU02: external audit: optimisation (see internal doc `_helpers\Docs\01 Modifications à Apporter_2026_06_05`) - **les 8 items livrés en 1.7.0 "Hardening"** (security + bugs + refactoring)

### 1.6.0

- BUG12: metrics dashboard date filters. The two `<input type="date">` controls on the Recent requests panel were wired to the `change` event, which the browser does not re-fire when the user picks the same date as the last commit (the dashboard then silently ignored the second change). Fix: the date inputs are now wired to BOTH `input` and `change` events; the `onDateChange` handler always calls `applyFilters()`, regardless of whether the value is set or cleared. Entering a date still deactivates the active preset (the two modes are mutually exclusive); clearing a date does NOT re-activate the preset. Additionally, the four top metric cards (Requests / Tokens / Duration / Estimated cost) used to show the cumulative totals from the snapshot, so changing the date filter did not change the "Estimated cost" headline. Fix: `applyFilters()` now calls a new `updateTotals()` that recomputes Requests / prompt+completion tokens / average duration / total estimated cost from the filtered entries, and a new `updateScopeNote()` explains what the cards reflect ("Showing all recorded requests (no filter active)." vs "Filtered totals (preset: 24h · search: \"minimax\")."). 4 new dashboard tests in `tests/dashboard.test.ts` (was 47, now 52).
- AFF04: pagination on the metrics dashboard. The Recent requests, By model, and Provider summary tables now expose a pagination strip underneath each one with the four navigation buttons (`<<` first, `<` prev, `>` next, `>>` last), a direct page-number `<input type="number">`, and a per-page size input (defaults: 20 for recent, 10 for by-model, 10 for provider). Page size is persisted per-panel in `localStorage` (`aiflowbridge.dashboard.pageSize.<panel>`), so the user's choice survives a dashboard refresh; page number resets to 1 on every filter change so the user always lands on a valid page. The pagination is purely client-side: the server-side render still emits ALL rows so the dashboard still shows data with JS disabled (the JS init pass + `rerender()` then slice the rows into the persisted page size for each panel). Provider summary gains a sort-by-requests-desc stable order so the first page shows the busiest vendors first. New CSS for `.pagination`, `.page-btn`, `.page-jump`. 5 new dashboard tests in `tests/dashboard.test.ts` (was 52, now 57).
- DOC04: (VS Code Marketplace listing): `displayName` now leads with the concrete model names users search for (`AIFlowBridge - DeepSeek V4, MiniMax M3 & MiMo in Copilot Chat`), and `description` is restructured around the 3-problems-3-bullets model from the plan (multi-vendor picker / free vision / local OpenAI gateway). Added `galleryBanner` (dark theme, brand color `#0f172a`). `qna` was removed from the manifest after VS Code flagged it (`Expected one of string, boolean.`) - the field accepts only a URL or boolean, not an array of {question, answer} objects. The FAQ content now lives in `docs/*.md` instead. (README hook: the first 10 lines lead with the cost-comparison story (Copilot $19 vs Cursor $20 vs Kilo+DeepSeek vs Kilo+MiMo vs Kilo+Ollama $0) instead of a feature list, with a "Migrating from Copilot alone?" callout directly under the tagline. The README has been split into 9 focused pages under `docs/` (929 lines → 108 lines + 9 subpages). `docs/cost.md` carries the cost breakdown and pricing math; `docs/providers.md` carries the providers table + hardcoded rationale + adding a model; `docs/vision-proxy.md` covers the image-to-text proxy; `docs/reasoning.md` covers MiniMax M3; `docs/gateway.md` covers the singleton + version-aware restart + Kilo Code / OpenAI clients; `docs/dashboard.md` covers the metrics panel features + screenshots; `docs/architecture.md` carries the source layout + 3-tier model registry; `docs/development.md` covers build/test/package/privacy; `docs/troubleshooting.md` covers the common errors. Each page anchors back to `../README.md`. The README itself now reads in <2 minutes.
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
- API01: gateway calls MiniMax `/v1/responses/input_tokens` in parallel for accurate prompt token counting. DeepSeek and Xiaomi continue to use the heuristic / stream-usage calibration.
- AFF01: dashboard "Recent requests" rows now show a local-time clock (HH:MM:SS) with full ISO timestamp in the cell tooltip.
- AFF02: dashboard now has a "By model" panel with the same time filters as the recent requests (All / 1h / 24h / 7d / 30d). Filters are client-side and instant.
- DOC01: README "Demo" section now includes a 3x3 screenshot grid. Screenshots copied to `resources/screenshots_v1.1.1/` (preserved at `_helpers/screenshots_v1.1.1/`).

### 1.1.1

- Documentation update only. No code changes.

### 1.1.0

- Added `aiflowbridge.userModels` setting and the `AIFlowBridge: Add a custom model` command.
