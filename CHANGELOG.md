# Changelog

## 2.8.1

Bugfix release addressing two regressions introduced in 2.8.0's storage layout change. Both shipped for the standalone CLI; the VS Code extension's telemetry and dashboard are unchanged on default settings.

### Fixed

- **Standalone CLI did not share storage with the VS Code extension dashboard.** Before 2.8.1, the standalone server wrote `telemetry.json` to `~/.aiflowbridge/` while the VS Code extension wrote to `<globalStorageUri>/telemetry.json`. The two paths diverged on machines where both run, so every request flowing through the standalone was invisible to the dashboard. `src/standalone/storage-dir.ts` (new) resolves the standalone's storage directory with cross-platform precedence: `AIFLOWBRIDGE_DATA_DIR` env var (operator override) → VS Code extension's `globalStorageUri` when the extension is installed (Windows `%APPDATA%`, macOS `~/Library/Application Support/Code/User/globalStorage/...`, Linux `$XDG_CONFIG_HOME/Code/...`) → legacy `~/.aiflowbridge/` fallback for headless machines. On Windows the resolver probes `%APPDATA%\Code\User\globalStorage\LaurentOngaro.aiflowbridge\` so both processes now write telemetry to the same file. 5 unit tests in `tests/standalone/storage-dir.test.ts` cover the env-var override, the extension-path detection on each platform, the missing-extension fallback, and the precedence rules.
- **Dashboard sections were not collapsible** in the metrics webview. The CSS rules `.collapse-btn.chevron` (compound selector, matched an element with both classes - never) and `.panel.collapsed.panel-body` (same shape, never matched) were copied wrong from the 1.x stylesheet during the AFF08 selector migration; both were supposed to be descendant selectors. `.collapse-btn.chevron` now targets the `<span class="chevron">` inside the button (so the rotation transition lands on the right element); `.panel.collapsed.panel-body` now targets the `<div class="panel-body">` inside the panel (so collapsing hides the body as designed). Fix is two CSS-level edits to the dashboard HTML string in `src/aiflowbridge/ui/dashboard.ts`.
- **`<select>` combobox background invisible against the dark theme.** VS Code injects styles on native `<select>` elements in webviews, forcing a `#effafe` background regardless of the extension's CSS. The `.preset-select` rule now applies `-webkit-appearance: none`, `background: var(--panel-2) !important`, and an explicit `.preset-select option { background: var(--panel-2); color: var(--text); }` so both the closed combobox and the open dropdown respect the dark theme. The existing tests in `tests/dashboard.test.ts` still pass (the assertions are markup-level, not computed-style).
- **Migration script `merge-telemetry.ts` would have lost the standalone's secrets on first restart after upgrade.** The 2.8.1 storage-dir fix makes the standalone read `secrets.json` from the same path as the extension, but the legacy standalone had its own file at `~/.aiflowbridge/secrets.json` that the new path did not know about. The first restart after upgrade would have 1004'd on every upstream call. Renamed the script to `merge-storage.ts` and extended it to also merge `secrets.json`: the union of file-based secrets between the two locations, with the extension's VS Code SecretStorage keys (read by the extension process) untouched by the script. Same backup-and-rollback discipline as the telemetry side. The script is shipped as `dist/standalone/migrations/merge-storage.js` in the standalone bundle for one-shot use after upgrade.

### Tests

`npm test` : **802/802 pass** (44 files, 4.22 s). 5 new tests in this release for `storage-dir.ts`; the dashboard changes are CSS-only and the existing 91 dashboard tests still cover the markup.

## 2.8.0

Architecture & quality hardening pass driven by the static analysis of the 2.7.0 codebase (audit archived in `_Private/archives/2026_07_11_code-review-architecture.md`). 11 of 12 recommendations addressed in this release; the 12th (refactor of `forwardChatCompletion()` into discrete handlers) is documented as a follow-up with a recommended incremental decomposition. No behaviour change for callers on default settings.

### Fixed

- `/shutdown` handler could leak the listening socket. When `stop()` was called in the 100 ms window between the `200 ok` response and the deferred `server.close()`, `this.server` was set to `undefined` by `stop()` and the timeout's `?.` silently no-op'd, leaving the socket bound (and the port stuck on Windows TIME_WAIT). The handler now captures the local server reference and clears `this.server` synchronously, then closes the captured reference after the 100 ms grace period.
- `providerSemaphores` was module state shared across `GatewayService` instances. The per-provider concurrency semaphore pool is now a `private readonly` property on `GatewayService`, so two instances in the same process (test suite, dev reload, multiple standalone CLIs) get independent caps. The helpers are private methods on the class; no more `acquireProviderSlot(providerId, max)` free function.
- `AIFlowBridgeRuntime.gatewayInfo` crashed when read before `activate()`. The getter returned `undefined.running` when the runtime was constructed but not yet activated (e.g. a test harness, a config-change callback fired before activation completed, a future early-startup consumer). The getter now returns a stable "all disabled" stub (`{ running: false, port: 0, baseUrl: '', isJoined: false, providerCount: 0 }`) when `config` or `gateway` are still `undefined`. Post-activation shape is unchanged. 3 regression tests in `tests/runtime-gateway-info.test.ts` cover the pre-activation stub, the read-safety over multiple calls, and the post-activation smoke test.
- `reloadConfiguration()` warning did not distinguish "start" from "restart". When `gateway.start()` failed AND the gateway had not been running before the reload, the user-facing warning read "gateway failed to restart" even though nothing was being restarted. The message now uses `wasRunning` to pick the right label (`start` vs `restart`). The `enabled` toggled off path (was running, now disabled) is also surfaced as an info log so the status-bar transition is not silent.
- `AIFlowBridgeRuntime.savePersistedTelemetry()` was an explicit no-op. The `saveState` callback was wired in the constructor but the method did nothing because the file-based persister writes through `TelemetryStore.record()` directly. The method is removed; the constructor now passes `undefined` for the `saveState` parameter with a comment explaining why no legacy hook is needed. No behaviour change for callers.
- The vision proxy is a global feature (one `aiflowbridge.vision.copilotVisionModel` setting, used by every text-only model across DeepSeek, MiniMax, and Xiaomi), not a DeepSeek-specific one. The audit + user clarification surfaced 5 quality issues; all addressed.
  - **Cap `MAX_VISION_MODEL_ID_LENGTH = 256` on `vision.copilotVisionModel`.** A hand-edited or hostile `settings.json` pointing the vision proxy at a multi-MB string is no longer passed to `vscode.lm.selectChatModels({ id })`; the getter falls back to the default `oswe-vscode-prime` with a warning. Mirrors the same defensive cap used in the gateway HTTP `X-AIFlowBridge-Language` header.
  - **Notification when the configured vision model is not registered.** Previously the getter just logged a warning and silently fell back to the default. Now the user sees a `vscode.window.showWarningMessage` ("AIFlowBridge: the configured vision model `<id>` is not registered with VS Code. Falling back to the default model. Run 'AIFlowBridge: Set vision proxy model' to pick a new one."), deduped by VS Code's own per-session message deduplication.
  - **Picker shows a "(missing)" row when the configured id is not in `vscode.lm`.** The picker now prepends a non-pickable informational row with the `$(warning)` codicon, the configured id, and the `detail` "Currently configured but no longer available. Pick a replacement below." Clicking the row does not persist anything; the runtime guards on the `$(warning)` label prefix.
  - **3 new i18n keys** in `package.nls.json`: `vision.configuredMissing`, `vision.configuredMissingVendor`, `vision.configuredModelMissing`.
  - **13 new unit tests** in `tests/vision.test.ts` cover the length cap (short id passes, oversized id falls back without ever calling `selectChatModels` with the bad string), the configured-missing notification, the empty-config first-run path, the get/reset cache, the picker's missing-row insertion + non-pickable label guard, the `excludedVendors` filter, the no-candidate info message, and `getVisionPrompt()` config-vs-default.
- `/health`, `/metrics`, `/v1/models`, `/v1/discovery` loopback behaviour now documented in `SECURITY.md`\*\* under a new "Loopback unauthenticated endpoints by design" bullet. Explicit warning that forwarding these endpoints off-host (reverse proxy, tunnel) is the user's responsibility and requires adding auth at the proxy layer.
- Regression test for `gatewayInfo` before `activate()` in `tests/runtime-gateway-info.test.ts` (3 tests: pre-activation stub, read-safety over multiple calls, post-activation smoke test).

### Changed

- `aiflowbridge.providers.deepseek.setVisionModel` zombie command removed. The legacy alias forwarded to the per-provider picker via `executeCommand`, with a comment admitting the original handler had been deleted in a previous refactor. The command was specific to DeepSeek by name but the picker is actually global (one `aiflowbridge.vision.copilotVisionModel` setting, shared by every text-only model across all vendors). Replaced with: `aiflowbridge.chooseVisionProxyModel` (internal command, registered in `src/runtime/provider.ts` next to the VS Code adapter) + `aiflowbridge.setVisionModel` (user-facing command palette entry, dispatch via `ctx.executeCommand` from the host-agnostic runtime). The dispatch keeps the runtime decoupled from `vscode.lm` (which the picker imports directly).
- `src/aiflowbridge/config.ts` renamed to `src/aiflowbridge/host-config.ts`. Two `config.ts` files (one at the repo root for VS Code-specific helpers, one inside `src/aiflowbridge/` for the host-agnostic runtime) had an identical name and frequently confused imports. The runtime file is now `host-config.ts`; the test file moved to `tests/host-config.test.ts`; references in `CONTRIBUTING.md` and `docs/agent-instructions/tasks.md` updated.

### Tests

`npm test` : **797/797 pass** (43 files, 4.22 s). 16 new tests in this release (13 vision + 3 gatewayInfo regression); the `tests/aiflowbridge-config.test.ts` file was removed because `tests/host-config.test.ts` is the same test suite under the new name (no behaviour change).

## 2.7.0

Multi-language quality lift + zero-conf discovery. Ships three action-plan items in one release: workspace context injection (item #2) so every chat completion carries a one-paragraph system message describing the project's languages / package managers / linters / formatters; language-based model routing rules (item #5) so a polyglot project automatically routes to the right model per language; zero-conf discovery (item #4) so IDEs find the local gateway via a UDP beacon + `GET /v1/discovery` HTTP endpoint without any pre-shared URL.

### Added

- **Item #2 - Workspace context detection + system-message injection.** New `src/aiflowbridge/context/workspace-context.ts` scans the workspace root for language manifests (`pyproject.toml`, `Cargo.toml`, `package.json`, `pom.xml`, `*.csproj`, `mix.exs`, `CMakeLists.txt`, ...) and prepends a short system message to every `/v1/chat/completions` body describing the languages / package managers / linters / formatters it found. The detector is bounded by `maxDepth` (default 2) + `maxEntries` (default 50) + an `ignoredDirs` set (defaults: `node_modules`, `target`, `build`, `dist`, `.git`, `.venv`, ...) so a deep dependency tree cannot stall the request. Workspace root resolves in order: `aiflowbridge.gateway.workspaceContext.root` (explicit) -> `AIFLOWBRIDGE_WORKSPACE` env var (service-manager launch) -> `process.cwd()` (standalone CLI launched from project root) -> VS Code workspace folder. New `GET /v1/context` HTTP endpoint exposes the detected `WorkspaceContext` as raw JSON so an IDE settings UI can surface "this gateway detected Python + ruff in /home/me/proj" without re-running the detector. Opt-out per workspace via `aiflowbridge.gateway.workspaceContext.enabled = false`. Pure-function helpers (`detectWorkspaceContext`, `renderWorkspaceContext`, `prependSystemMessage`) exported for unit testing.
- **Item #5 - Language-based model routing rules.** New `aiflowbridge.gateway.languageRouting` config object (map of `language -> providerId`, with `*` wildcard fallback) so a polyglot project's traffic lands on the best model per language. New `selectProviderWithLanguage()` in `src/aiflowbridge/context/language-routing.ts` tries the routing table first, then falls back to the existing `selectProvider(model, defaultModel)` chain unchanged. The language hint is resolved in order: explicit `X-AIFlowBridge-Language` HTTP request header (IDE override) -> first recognisable filename in the request body's `messages[]` (a fenced `python\n# /home/me/proj/src/foo.py` snippet or a plain `Look at src/main.rs` reference) -> workspace context primary language (item #2 detection). New setting `aiflowbridge.gateway.discovery.broadcastIntervalMs` and the per-language `providerId` resolution match against `provider.id` / `provider.model` / `provider.label` with case-insensitive sensitivity (same as the existing model picker). Empty / missing / non-object settings are treated as "no routing rule" and the fallback chain runs unchanged.
- **Item #4 - Zero-conf discovery (UDP broadcast + `GET /v1/discovery`).** New `src/aiflowbridge/gateway/discovery.ts` runs a periodic UDP broadcast on `aiflowbridge.gateway.discovery.broadcastPort` (default 8788) every `aiflowbridge.gateway.discovery.broadcastIntervalMs` (default 2 000 ms). The payload is a small JSON `{ host, port, version, protocol: "openai", path: "/v1" }` broadcast to `255.255.255.255` (limited broadcast, no mDNS dep, no extra `bonjour-service`). New `GET /v1/discovery` HTTP endpoint on the gateway's own TCP server (loopback) returns a richer JSON with one-paste client config snippets for Continue, Kilo Code, the OpenAI Python SDK, and curl, so the user picks one and pastes it into their IDE settings. Both surfaces are gated on the same `aiflowbridge.gateway.discovery.enabled` flag (default `false` so the standalone CLI does not emit UDP packets on shared machines unless explicitly opted in). The default-off posture prevents surprising users on LAN; the HTTP endpoint remains reachable on the loopback URL even with the flag off, returning `{ enabled: false, message: ... }` so a curious user can confirm the flag state via a browser.
- **AFF08 - metric dashboard preset combobox + provider filter + 4 new presets.** The 5-button preset row on each panel (Recent requests + By model) is replaced by a single `<select>` listing the 9 presets: All, Last 15 min, Last 30 min, Last 1 h, Last 24 h, Last 2 days, Last 3 days, Last 7 days, Last 30 days. A second `<select>` on the Recent requests panel filters by provider (`All providers` + the dynamic provider list, populated from the snapshot's `byProvider` keys via a new `refreshProviderOptions()` JS pass that re-runs on every snapshot refresh). The two preset selects stay synchronised via `syncPresetSelects()` (the previous `syncPresetButtons()` helper, renamed for the new shape). `applyAllFilters()` now pipes through the provider stage after the time/custom-date stage and before the per-entry search match. New `.preset-select` CSS matches the visual style of the previous buttons (rounded pill outline, accent highlight on focus). New `PRESET_OPTIONS` constant is exported so the unit tests assert the 9-value list directly without scraping the dashboard HTML. 6 new tests in `tests/dashboard.test.ts` cover the option list, the markup presence, the wire (change handlers + `applyFilters`), and the pipeline ordering.
- Pure-Node UDP broadcast (no new runtime dependency: no `bonjour-service`, no `mdns`, no platform-specific binary).

### Fixed

- **BUG17 Fix E - forward HTTP 429 + `Retry-After` from upstream on streaming responses.** Previously, the gateway passed the upstream status code + body to the client but stripped any `Retry-After` / `X-RateLimit-*` headers. On streaming requests that hit a backoff status (`429` or `503`), the upstream's JSON 429 body would be streamed as SSE chunks, which client parsers (Kilo Code, Continue, OpenAI SDK, `curl --no-buffer`) cannot consume. New code in `src/aiflowbridge/gateway/server.ts`: (1) copies any upstream backoff header (`retry-after`, `x-ratelimit-reset`, `x-ratelimit-reset-after`, `x-ratelimit-remaining`, `x-ratelimit-limit`) onto the local response; (2) when streaming + 429/503 is detected BEFORE piping, ends the local response cleanly with `application/json` + the upstream body as the payload so the client sees a proper HTTP 429 with `Retry-After`; (3) records telemetry on the backoff path so the dashboard tracks the failed request. Non-streaming was already forwarding the status code + body but did not forward `Retry-After`; the fix applies to both branches. 4 new regression tests in `tests/gateway-bug17.test.ts` cover streaming + 429 + `Retry-After`, non-streaming + 429, streaming + 503 + `Retry-After`, and a sanity-check that a normal 200 still streams as SSE.
- Hardening pass driven by the `_Private/docs/2026-07-11_Last Code Review.md` (CR02) audit of the 2.7.0 work in progress. Three bugs were fixed outright, six quality issues addressed. No behaviour change for callers on default settings.
  - **B1 - `detectWorkspaceContext` walked twice per request.** New `detectWorkspaceContextCached()` in `src/aiflowbridge/context/workspace-context.ts` memoizes the detector on the `root + maxDepth + ignoredDirs` key with a 5 s TTL and `statSync(root).mtimeMs` invalidation. Both call sites in `server.ts` (workspace-injection in `forwardChatCompletion` and the language-routing hint in `resolveLanguageHint`) now share a single `readdirSync` walk per chat-completion burst instead of duplicating it. New `clearWorkspaceContextCache()` is exported for hot-reload use.
  - **B2 - `DiscoveryBeacon.start()` swallowed every socket error silently.** Added a `logBeaconError()` helper that emits a one-shot `[Discovery] <kind>: <message>. UDP broadcast disabled; HTTP /v1/discovery on the loopback URL still works.` warning the first time `setBroadcast()`, the `socket.on('error')` listener, or a synchronous `bind()` throws. A Linux user without `CAP_NET_BROADCAST` now sees the failure instead of a beacon that pretends to work.
  - **B3 - `X-AIFlowBridge-Language` header was unbounded.** `resolveLanguageHint()` now rejects headers longer than `MAX_LANGUAGE_HINT_HEADER_LENGTH` (64 chars) and trims once before any `toLowerCase()`. A hostile loopback peer can no longer force an MB-long allocation we would then immediately discard.
  - **B4 - `broadcastPort` was not clamped at runtime.** `DiscoveryBeacon` constructor now clamps `broadcastPort` to `[1024, 65535]` and falls back to `8788` with a warning when the value is out of range. The package.json schema already enforced the same range; the runtime used to trust hand-edited config (`broadcastPort: 0` produced OS-dependent UDP behaviour).
  - **B5 - `matchesGlob()` did not escape `-` in its character class.** Added `-` to the regex character class in `src/aiflowbridge/context/workspace-context.ts:286`. No current `LANGUAGE_MARKERS` pattern exploits the gap, but the trap was a maintenance footgun.
  - **A1 - No user-facing docs on the new settings / endpoints.** `docs/gateway.md` now documents `/v1/context` and `/v1/discovery` (request shape + privacy caveats), the full settings table (workspaceContext._, languageRouting, discovery._), and the `AIFLOWBRIDGE_WORKSPACE` env var override. Privacy section now mentions that `/v1/context` exposes the workspace root and `/v1/discovery` exposes the bundled gateway version (both loopback-only, consistent with `/health` / `/version` / `/v1/models`).
  - **A2 - `prependSystemMessage` was exported but had no tests.** New 4-case test block in `tests/gateway-actions-2-4-5.test.ts` (prefix inserted as first system message, no input mutation, non-array `messages` field treated as empty, array-typed `content` preserved).
  - **A3 - `DiscoveryBeacon` did not validate `broadcastIntervalMs`.** Constructor now clamps the interval to `[500, 300_000]` ms. A hand-edited `broadcastIntervalMs: 2` no longer produces 30 UDP packets per second.
  - **A6 - `resolveContextRoot()` silently fell back when the explicit root was invalid.** When `aiflowbridge.gateway.workspaceContext.root` does not resolve to a directory, the gateway now logs a one-shot warning and falls back to `AIFLOWBRIDGE_WORKSPACE` / `process.cwd()` so the user can spot the typo instead of being surprised by an injection on the wrong folder.
- Post-CR02 code review surfaced 13 additional findings (1 CRITICAL deploy-safety, 9 WARNING, 3 SUGGESTION). All addressed in this commit before the 2.7.0 release.
  - **CRITICAL - F8 deploy-safety.** Workspace-context injection was enabled-by-default with a `process.cwd()` fallback that resolved to the gateway install directory for standalone CLI launches (`aiflowbridge-server.cmd` under Windows Task Scheduler). Every existing standalone user upgrading from 2.6.x would have silently received `Workspace: <install-dir>\nDetected language(s): javascript\n...` on every chat completion, leaking the install path to upstream providers and biasing `selectProviderWithLanguage` against their actual project. Fix: `resolveContextRoot` now requires the resolved cwd to contain a project sentinel (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `CMakeLists.txt`, `mix.exs`, `Package.swift`, `composer.json`, `meson.build`, `.git`) before accepting it as a workspace; the cwd == install dir case logs a one-shot warning and returns `undefined`.
  - **F4 - CR02 B3 trim() ran before the length cap.** `resolveLanguageHint` was rejecting oversized headers only AFTER calling `headerValue.trim()`, which walked the entire buffer and allocated a fresh string. The cap is now applied to the raw length first; only surviving short values go through `trim()` + `toLowerCase()`.
  - **F7 - CR02 A6 warning missed non-directory roots.** The explicit-root warning only fired when `statSync` threw ENOENT/EACCES. A typo that picked up a real file (e.g. `C:/foo.txt`) made `statSync` succeed, `.isDirectory()` return false, the loop fall through silently. `explicitRootFailed` is now set whenever the explicit-root candidate was considered but did not produce a directory hit (covers both throwing and non-directory paths).
  - **F1 - CR02 B1 cache still statSync'd on every hit.** `detectWorkspaceContextCached` called `rootMtimeMs(root)` (a synchronous `statSync`) on every cache hit, defeating the cache's purpose on the request hot path. The mtime recheck on hit is dropped; the 5 s TTL alone is short enough that a developer who creates a new `package.json` sees the updated routing within seconds. `clearWorkspaceContextCache()` remains exported for hot config reload.
  - **F2 - matchesGlob rebuilt the `*.csproj` regex on every file entry.** The walk callback now iterates a precompiled `COMPILED_MARKERS` table: 21 literal markers get a string-equality fast path, the one glob marker ships a precompiled `RegExp`.
  - **F3 - `resolveContextRoot` did 2-6 statSync per request.** Funneled into `detectWorkspaceContextFromSettings(settings, { cached, cwdSentinels })`; the helper owns the `enabled !== false` gate, the root resolution, and the cache-vs-fresh choice. The three duplicated sites in `server.ts` (workspace injection, language hint, `/v1/context` endpoint) now share the same helper.
  - **F5 - `DiscoveryBeacon` start/stop race.** `start()` schedules an async bind callback; `stop()` only cleaned up when `bound` was already true. Fix: `stopped` flag flipped in `stop()` short-circuits the bind callback; socket is recreated in `start()` if it was closed by a previous `stop()`.
  - **F6 - `FILENAME_PATTERN` URL false positives.** Even with the documented `(?!\.\.)` lookahead added, body text such as `https://docs.example.com/api/foo.py` still produced a `python` hint (the regex consumed the `:` as the opening char class, capturing `//docs.example.com/api/foo.py`). Added a post-filter in `detectLanguageHintFromPayload` that rejects matches starting with `//`, containing `://`, or starting with `..`.
  - **F9 - `collectText` duplicated `collectTextFragments`.** Dropped the local copy in `language-routing.ts` and reused `collectTextFragments` from `telemetry.ts` (single source of truth for OpenAI content-shape handling).
  - **F10 - triple-duplicated "shape options, resolve root, call detect" block.** Funneled through `detectWorkspaceContextFromSettings` (see F3).
  - **F11 / F12 / F13 - dead code.** Removed unused `__testing` export in `workspace-context.ts`, unused `emitOnce()` method in `DiscoveryBeacon`, and unused `beaconForTest` getter in `GatewayService`.

### Tests

- **781 tests across 41 files** (was 771 / 41 after the `/review uncommitted` follow-ups, +10 in this pass: 4 for BUG17 Fix E in `tests/gateway-bug17.test.ts`, 6 for AFF08 in `tests/dashboard.test.ts`). The original 25-test `gateway-actions-2-4-5.test.ts` coverage is preserved.
- Quality gates: `npm run compile` (0 errors), `npm run compile:standalone` (0 errors), `npm test` (781/781).

## 2.6.1

Hotfix for BUG18: upgrading from a version pre-2.5.0 (where `byClient` did not exist) to 2.6.0 (where `bySource` was added) made the on-disk telemetry file fail the schema validator. The user's cumulative counters were silently wiped (the dashboard opened empty, with a single `[Telemetry] Telemetry file at <path> does not match the expected shape, ignoring.` warning in the logs). Treats the per-bucket maps as optional in the validator and adds `bySource` to the `normalizeSnapshot()` defaulting pass so any pre-2.5.0 file loads cleanly and historical counters survive every schema extension.

### Fixed

- **BUG18 - 2.6.0 wiped the dashboard for users upgrading from a version pre-2.5.0.** `isValidSnapshot()` in `src/aiflowbridge/telemetry/persistence.ts` previously required every per-bucket map to be a present object: `typeof candidate.byProvider === "object"`, `typeof candidate.byModel === "object"`, `typeof candidate.byClient === "object"`. A user upgrading from 2.4.x (where `byClient` did not exist in the on-disk shape) had the file rejected as "does not match the expected shape, ignoring", and the cumulative counters (which the user had built up over months) were silently wiped because the in-memory `TelemetryStore` started from `emptyTelemetrySnapshot()` and the very next `record()` overwrote the rejected file. Fix: the three per-bucket maps are now treated as optional in the validator (`value === undefined || typeof value === "object"`), matching the optional shape they already have in the `TelemetrySnapshot` interface. `normalizeSnapshot()` now also defaults `bySource` to `{}` so the in-memory state matches the on-disk shape after `restore()`. After the fix, a pre-2.5.0 file loads with `byClient: {}` and `bySource: {}` filled in on the way out, the legacy `recent` array survives verbatim, and the next `record()` call starts appending new entries on top of the historical data. Two new regression tests in `tests/telemetry-persistence.test.ts` cover the pre-2.5.0 shape (no `byClient`, no `bySource`, legacy entry with no `source` field) and the post-2.5.0 pre-2.6.0 shape (`byClient: {}` present, `bySource` absent).

### Tests

- **721 tests across 40 files** (was 719 / 40 in 2.6.0, +2). New tests in `tests/telemetry-persistence.test.ts` cover the pre-2.5.0 on-disk shape (no `byClient`, no `bySource`, legacy entry with no `source` field) and the post-2.5.0 pre-2.6.0 shape (`byClient: {}` present, `bySource` absent). Both assert that the cumulative counters and the legacy `recent` array survive the upgrade, and that the new optional fields are filled in with empty maps on the way out.
- Quality gates: `npm run compile` (0 errors), `npm run compile:standalone` (0 errors), `npm test` (721/721).

## 2.6.0

Bridges the VS Code Copilot Chat path into the metrics dashboard - ships item 6 of the action plan. Closes the historical blind spot where ~50% of usage (Copilot Chat traffic through `vscode.lm`) was invisible because the gateway only ever saw its own traffic. Adds a `By source` summary panel (gateway vs copilot-chat) and a sortable `Path` column on the Recent requests table.

### Added

- **FEAT6 - Bridge the Copilot Chat path into `TelemetryStore`.** `UnifiedChatProvider.provideLanguageModelChatResponse` now wraps every Copilot Chat call (success and error) with a `TelemetryStore.recordFromCopilotChat()` call. A new `CopilotChatTelemetrySink` interface is wired in `lifecycle.ts` after the runtime builds its `TelemetryStore`, so Copilot Chat traffic lands in the same `byProvider` / `byModel` / `byClient` maps as gateway traffic and gains a new `bySource` split (`'gateway'` vs `'copilot-chat'`). Pure additive change to the `TelemetrySnapshot` schema (the `source` field on `RequestTelemetry` and the `bySource` field on `TelemetrySnapshot` are both optional, defaulting to `'gateway'` and `{}` respectively, so older on-disk snapshots load unchanged and the next `record()` call repopulates the new aggregation as requests come in). Action plan item #6 closes the largest single gap in the metrics view (the dashboard used to be blind to ~50% of usage on a typical install where most prompts go through Copilot Chat instead of Kilo Code / Continue). The wrap is best-effort: a throw inside the sink (telemetry broken) never breaks the upstream pipeline, and a missing sink (runtime not yet built, e.g. when the activation lock is held by a peer activation) is a no-op. Errors are classified into HTTP-ish status codes (e.g. a `ProviderRequestError` carrying `status: 502` from a MiniMax upstream is recorded as 502; anything else lands as 500) so the dashboard's "errors" counter and per-source status breakdown stay meaningful. New public methods: `GatewayService.recordFromCopilotChat(options)`, `AIFlowBridgeRuntime.recordFromCopilotChat(options)`, `UnifiedChatProvider.setTelemetrySink(sink)`, `TelemetryStore.recordFromCopilotChat(options)`.
- **FEAT6 - Dashboard `By source` panel + sortable `Path` column.** New panel between "By client" and "Provider summary" with a table (`Source | Requests | Tokens | Avg duration | Errors`) showing the gateway vs copilot-chat split at a glance. New sortable `Path` column on the Recent requests table (data-sort-key `source`, values `'gateway'` or `'copilot-chat'`, `'copilot-chat'` rows wrapped in a `<code>` tag for visual distinction). Existing `Token source` column (estimated vs usage) renamed from the previous `Source` column to free up the term - the `data-sort-key` stays `estimated` so the sort behaviour and existing tests are unchanged. Search haystack extended with the entry's `source` value so typing "copilot" filters the Recent table down to Copilot Chat traffic. Server-side render and client-side rerender stay in sync (server emits the `<td>` directly; client `entrySearchHaystack` and `recentSortVal` both normalise absent `source` to `'gateway'` for backward compat with older on-disk snapshots). Recent table colspan bumped from 9 / 10 to 10 / 11 to account for the new column. Collapse / chevron wiring extended to the new panel.
- **Per-request log line carries a local-time `YYYY-MM-DD HH:MM:SS` stamp.** The standalone CLI prints `[INFO]  [Gateway] {requestId} {provider} {status} {duration}ms` on every `/v1/chat/completions` (when `gateway.telemetry.logRequests = true`) and the line was missing any date / time information, which made the BUG17 tail-latency investigation hard to correlate with wall-clock spikes. New `formatRequestLogLine()` + `formatLocalTimestamp()` helpers in `src/aiflowbridge/gateway/server.ts` prepend a fixed-width `YYYY-MM-DD HH:MM:SS` stamp (local time, no millisecond noise, locale-independent so the line is greppable across machines and time zones) so the line now reads `[INFO]  [2026-07-11 11:04:41] [Gateway] 99929fbd-9ab1-485c-993f-01b7acf85ff5 MiniMax-M3 200 3642ms`. The payload after `[Gateway]` is unchanged so existing log-grep workflows keep working. Both helpers are exported for unit testing.

### Tests

- **719 tests across 40 files** (was 695 / 38 in 2.5.1, +24). New `tests/copilot-chat-telemetry.test.ts` (16 tests) covers `TelemetryStore.bySource` aggregation (single-bucket, mixed, legacy coalesce to `gateway`, `removeEntry` reversal, `restore` backward compat with both old and new on-disk shape, `reset` clearing, `recordFromCopilotChat` stamps `source: 'copilot-chat'` + fresh ids + ISO timestamps), `UnifiedChatProvider` recording on success and on error (HTTP `status` classified into a code, unknown errors -> 500, telemetry sink exception does not break the pipeline, missing sink is a no-op, per-vendor providerId resolution), and end-to-end merge (gateway + copilot-chat in the same `snapshot()`). New `tests/gateway-log-format.test.ts` (8 tests) covers the per-request log line: exact layout, zero-padding of single-digit month/day/hour/minute/second components, non-2xx status codes preserved, payload grep-compatible, local-time components, no millisecond noise, December-31 wrap. `tests/dashboard.test.ts` updated for the new column / panel (recent colspan 9->10 and 10->11; panel-body count 5->6; collapse-target list includes `panel-source`).
- Quality gates: `npm run compile` (0 errors), `npm run compile:standalone` (0 errors), `npm test` (719/719).

## 2.5.1

Hotfix for BUG17: gateway standby under concurrent agents (3 agents in parallel vs MiniMax-M3 / `reasoning_split: true`). Adds upstream idle / total timeouts so a stalled MiniMax request aborts with HTTP 504 instead of leaving the agent UI in standby for minutes, silences the `MaxListenersExceededWarning` on long-lived keep-alive sockets, and bounds parallel in-flight requests per upstream provider to address the root cause at the gateway layer.

### Fixed

- **BUG17 - Gateway standby under concurrent agents (3 agents in parallel vs MiniMax-M3 / `reasoning_split: true`).** Standalone CLI users running 3 agents in parallel against MiniMax-M3 (`reasoning_effort: max`) observed tail latencies of 30-100 s on ~25% of requests while siblings completed in 5-15 s, plus two `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 close listeners added to [Socket].` entries in the log. Two independent root causes, both in `src/aiflowbridge/gateway/server.ts`, both triggered by the same workload pattern (long-lived HTTP/1.1 keep-alive + concurrent thinking-mode requests). **Fix A**: the request handler registered a `socket.once('close', ...)` listener on every incoming HTTP request, so N requests on the same keep-alive socket accumulated N listeners on the same `Socket` emitter and crossed Node's per-emitter cap of 10. New `wiredSocketClosers: WeakSet<Socket>` field on `GatewayService` wires the cleanup listener at most once per physical TCP socket; subsequent requests on the same keep-alive connection only call `this.activeSockets.add(socket)` (idempotent). WeakSet so the `Socket` can still be GC'd when its refcount drops. **Fix B**: zero upstream timeout. `forwardChatCompletion` (`server.ts:703`) called `fetch()` with only a client-disconnect abort; if MiniMax silently queued a thinking request without sending bytes, the gateway waited indefinitely and the agent UI sat in standby for minutes. New `upstreamIdleTimeoutMs` watchdog (default 90 000 ms) aborts after N ms of upstream silence; new `streamTotalTimeoutMs` ceiling (default 300 000 ms) is a bounded safety net. Both share the existing `abortController`, the catch block surfaces HTTP 504 + structured JSON body (`{ error: 'Gateway Timeout', requestId, details, idleTimeoutMs, totalTimeoutMs }`) instead of generic 502, and the streaming pipe gains an explicit `node.on('error', abort)` handler plus a `data`-event reset on the idle timer so a slow-but-trickling upstream is not falsely aborted. The post-headers local `response.end()` is a no-op while the pipe owns the response, so the watchdog also calls `response.destroy()` to release the pipe cleanly. **Fix C**: self-inflicted upstream amplification. Every MiniMax request unconditionally kicked off a parallel `fetchMinimaxPromptTokens` POST to `/v1/responses/input_tokens`, doubling the upstream burst (6 outbound calls for 3 thinking-mode agents) precisely when MiniMax was already throttling the main 3. New `minimaxParallelTokenCount` setting (default `false`) gates the parallel pre-count on `!payload.stream`; the pre-count also receives the shared `abortController.signal` so the watchdog kills a stuck pre-count cleanly. **Fix D**: per-provider concurrency semaphore. New `gateway.maxConcurrentPerProvider` setting (default 3) plus module-level `Map<string, ProviderSemaphore>` keyed by `provider.id`. `acquireProviderSlot` returns immediately when `active < max`, otherwise queues a Promise in `waiters`; `releaseProviderSlot` hands the slot to the next waiter or decrements `active` when the queue is empty. The Map entry is freed when `active` drops to 0 with no waiters, so distinct provider ids do not grow the Map unboundedly. `max = 0` disables the cap (allocation-free skip). The slot is released in the `finally` block alongside the global `inFlightRequests` decrement so the slot is never leaked on error / abort / body-read failure. Result: 3 agents in parallel against the same MiniMax upstream now see at most 3 concurrent upstream POSTs (queue depth = N - 3), with `durationMs` in telemetry reflecting end-to-end latency (queue wait + upstream).
- **BUG17 - New gateway settings surfaced on `GatewayStatus` for the dashboard.** The three new caps (`maxConcurrentPerProvider`, `upstreamIdleTimeoutMs`, `streamTotalTimeoutMs`) are mirrored on `GatewayStatus` (`src/aiflowbridge/types.ts:200-225`) so the status bar / dashboard can show the configured values without re-reading the full config. New `aiflowbridge.gateway.*` settings added to `package.json` with full descriptions. All four new fields are optional in `GatewaySettings` for backward compatibility with older snapshots and test fixtures; the gateway resolves defaults (3 / 90 000 / 300 000 / `false`) at use site.

### Tests

- **695 tests across 38 files** (was 682 / 37 in 2.5.0, +13). New file `tests/gateway-bug17.test.ts` covers Fix A (no `MaxListenersExceededWarning` over 30 sequential keep-alive requests, asserted via stderr capture); Fix B (504 on `fetch` never returns + total ceiling reached with continuous bytes + idle timer resets on `data` so a healthy slow stream is NOT aborted + idle timer disabled when `upstreamIdleTimeoutMs = 0` + no timer leak after watchdog abort); Fix C (no `/input_tokens` POST on streaming default, pre-count on non-streaming, opt-in via `minimaxParallelTokenCount = true`); Fix D (6 parallel requests with `max = 3` show at most 3 concurrent upstream fetches, `max = 0` shows no cap, failing upstream releases slots correctly, `GatewayStatus` exposes the new caps).
- Quality gates: `npm run compile` (0 errors), `npm run compile:standalone` (0 errors), `npm test` (695/695).

## 2.5.0

Per-client IDE telemetry in the metrics dashboard - ships item 1 of the action plan.

### Added

- **Per-client IDE telemetry in the dashboard.** The gateway now tags every `/v1/chat/completions` entry with a stable originating-client identifier (`kilo-code@1.2.3`, `continue@0.9.x`, `curl@8.10.1`, `jetbrains-ai-assistant@2024.3`, `mozilla@5.0`, or `unknown`) derived from the `X-AIFlowBridge-Client` header (preferred) or the request's `User-Agent` header (fallback). The dashboard surfaces this in two new places: a sortable **Client** column on the Recent requests table (between Model and Duration, included in the global filter + search haystack), and a new **By client** summary panel that aggregates requests, tokens, average duration, and errors per originating client. Pure additive change to the OpenAI endpoint contract. Older on-disk telemetry snapshots that pre-date the feature (`byClient` absent on disk) load as an empty map and repopulate as new requests come in - no forced reset on upgrade. Names with internal spaces (`Kilo Code`, `JetBrains AI Assistant`) are hyphenated to keep the bucket keys dashboard-safe (`kilo-code@1.2.3`, `jetbrains-ai-assistant@2024.3`); user agents without a `Name/Version` token (e.g. raw `curl --user-agent 'my-script'`) become literal cleaned strings. Two new exported helpers in `src/aiflowbridge/gateway/server.ts`: `normalizeClientId(raw)` - pure parsing function, returns `null` for empty input; `resolveClientId(request)` - reads the headers in priority order. The `TelemetrySnapshot` schema gains `byClient: Record<string, ProviderSnapshot>` (mirrors `byProvider` / `byModel`); the in-memory `TelemetryStore` maintains the map in `applyEntryInMemory`, `applyEntryToSnapshot`, `restore`, `clearInMemory`, and `removeEntry`. Dashboard server-side renderer adds a `<th data-sort-key="clientId">Client</th>` cell to the recent table and a new `<div class="panel" id="panel-client">` between By model and Provider summary; client-side mirror in the script block updates the `recentColspan` (9 without the trash column, 10 with it), the search-haystack array (`entry.clientId || ""`), and the `recentSortVal` switch. Backward compatibility: the field is optional on `RequestTelemetry`; entries without it coalesce into the literal `'unknown'` bucket for the by-client aggregation and render as muted `unknown` cells on the recent table. Closes the User-Agent-is-discarded blind spot noted in `_Private/ACTION PLAN.md` item 1.

### Tests

- **682 tests across 37 files** (was 647 / 36 in 2.4.3, +35). New file `tests/gateway-client-telemetry.test.ts` (+26) covers `normalizeClientId` (null / undefined / whitespace, `Name/Version` parsing, multi-word product names like `JetBrains AI Assistant/2024.3`, fallback path for slash-less headers, alphabet sanitisation, 128-char length cap), `resolveClientId` (explicit header beats `User-Agent`, junk-header fallback, array-form header handling, real-world Kilo Code / JetBrains user agents), `TelemetryStore.byClient` aggregation (empty default, single record, distinct bucket isolation, missing clientId under `'unknown'`, error counting per client, `removeEntry` reversal, `restore` of newer snapshots, backward compatibility with older snapshots missing the field, `reset` clearing), and end-to-end gateway integration (User-Agent parsed to `kilo-code@1.2.3`, explicit `X-AIFlowBridge-Client` wins over User-Agent, missing headers bucket under `'unknown'`). New `tests/dashboard.test.ts` describe (+9) covers the Client column sortable header, per-row code cell rendering, the `unknown` literal for legacy entries, `serializeRecent` carrying `clientId` and coalescing absent to `'unknown'`, the By client panel + friendly empty-state, the search-haystack extension, and the sort-key switch integration.
- Quality gates: `npm run compile` (0 errors), `npm test` (682/682).

## 2.4.3

Hardens the standalone distribution pipeline so the v2.3.0 regression cannot recur, and fixes missing runtime metadata in the standalone archive.

### Fixed

- **Standalone release artifact completeness guard.** The v2.3.0 release was shipped with only `dist/standalone/` inside the archive, while `dist/standalone/main.js` does `require('../aiflowbridge')`, `require('../aiflowbridge/modelRegistry')`, `require('../logger')`, `require('./context')`. End users hit `Error: Cannot find module '../aiflowbridge'` on every start. Three safeguards now block any future broken release: (1) the `Assemble release tree` step in `.github/workflows/release.yml` fails fast with a `::error::` annotation if any expected sibling module (`dist/aiflowbridge/`, `dist/logger.js`, `dist/config.js`, `dist/consts.js`, `dist/types.js`, `dist/json.js`) is missing - no more silent skip via `[ -e "dist/$module" ]`; (2) a new `Smoke test standalone bundle` step runs `scripts/check-standalone-bundle.js` against the staged tree right after the assemble, parsing `main.js` for every relative `require()` and verifying each one resolves on disk (extension-less + `.js` + `.json` + `/index.js`), plus checking that `package.json` and `resources/models.json` are present so the standalone can report its real version and load the bundled model registry; (3) the same smoke test runs as a vitest unit test on every `npm test`. The workflow cannot upload the archive to the GitHub Release unless all checks pass.
- **Standalone archive missing `package.json` and `resources/models.json`.** The standalone reports `version 0.0.0` and falls back to synthesized providers without pricing because the assemble step never copied these runtime metadata files. `package.json` is now shipped so `resolveExtensionVersion()` reads the correct version (avoiding a cascade: 0.0.0 causes the VS Code extension's version-aware gateway restart to kill the standalone and relaunch it). `resources/models.json` is now shipped so the bundled tier of the 3-tier model registry loads real provider definitions with pricing data.

### Added

- **`scripts/check-standalone-bundle.js`** - reusable Node script (no dependencies) that asserts a given CommonJS entry point can resolve every relative `require()`, and that the expected runtime metadata files (`package.json`, `resources/models.json`) are present at the archive root. Used by both the release workflow and the unit test suite. Exit 0 on success, exit 1 with the list of missing references on failure. Documentation in the script header.
- **`tests/standalone-bundle.test.ts`** - 5 unit tests: script presence, end-to-end resolution against `dist/standalone/main.js` (requires + runtime files), regression guard for the v2.3.0 broken state (stub with missing `require()` targets, asserts exit 1 + correct messages), regression guard for missing runtime files (exit 1 + `package.json`/`resources/models.json` in error), and extension-less specifier handling in a full tree layout.

### Tests

- **647 tests across 36 files** (was 642 / 35 in 2.4.1, +5 new standalone bundle tests).
- Quality gates: `npm run compile` (0 errors), `npm test` (647/647).

## 2.4.1

Hotfix for the 2.4.0 command-palette regression + AFF05 column sorting on the metrics dashboard.

### Fixed

- **BUG16 - All command palette commands broken after 2.4.0 install.** Static top-level imports of `adm-zip` and `tar` in `src/runtime/installStandalone.ts` failed at module load time because these runtime dependencies are not shipped in the VSIX (`.vscodeignore` excludes `node_modules/**` and the extension has no bundler). The failure cascaded to `src/runtime/commands.ts`, blocking ALL command registrations (`command 'aiflowbridge.showMetrics' not found`, etc.). Fix: (1) `tar` and `adm-zip` imports moved to dynamic `import()` inside `extractTarGz()` / `extractZip()` so they only load when the user actually triggers the install command; (2) `commands.ts` wraps the `installStandalone` import in a `try/catch` so a future dependency issue with a single command cannot break all others.

### Added

- **AFF05 - Column sorting on the metrics dashboard.** Click any column header on the Recent requests, By model, or Provider summary tables to sort ascending; click again for descending; click a third time to clear the sort (back to default order). Sort state is per-panel (independent). Numeric columns (tokens, cost, duration, status) compare numerically with `NaN` sentinel handling; text columns (provider, model, source) use locale-aware string comparison via `localeCompare()`. Sort arrows (▲ / ▼) appear on the active column with hover opacity hints. Implementation: CSS (`th.sortable`, `.sort-arrow`, `.sorted`), server-side `data-sort-key` attributes on all `<th>` elements, client-side `sortState` object + `compareVals` generic comparator + `recentSortVal` / `objSortVal` extractors + `sortRecentEntries` / `sortObjectEntries` sorter functions + `applySorts()` / `updateSortArrows()` helpers + event delegation click handler on each table's `<thead>` with the 3-state cycle. 13 new tests in `tests/dashboard.test.ts`.

### Tests

- **642 tests across 35 files** (was 629 / 35 in 2.4.0, +13). New AFF05 dashboard tests: `data-sort-key` attribute presence, action column not sortable, all sort helpers emitted in the script block, `rerender` integration, 3-state asc→desc→clear cycle.
- Quality gates: `npm run compile` (0 errors), `npm test` (642/642).

## 2.4.0

New `AIFlowBridge: Install standalone gateway` command (FEAT8) for one-click download + extract of the standalone CLI from GitHub Releases, plus bugfixes to the standalone distribution pipeline and the GitHub API client.

### Added

- **AIFlowBridge: Install standalone gateway command.** New VS Code command (`aiflowbridge.installStandalone`) that downloads the platform-matched standalone CLI archive from the latest GitHub Release, extracts it to a user-chosen directory, makes the launcher executable (POSIX), and optionally registers an autostart service (`systemd --user` unit on Linux, `launchd` plist on macOS, scheduled task on Windows). Idempotent: detects an existing install and prompts for Replace / Keep (with date suffix) / Cancel. Resilient: streaming download with `Content-Length` cap (100 MB), atomic extraction to a staging directory with cleanup in a `finally` block, HTTP 301-308 redirects followed up to 5 hops (loop guard). New runtime dependencies: `adm-zip` (Windows archive extraction), `tar` (POSIX archive extraction). 13 new unit tests in `tests/install-standalone.test.ts` cover platform detection, `InstallError` discriminated union, tar.gz round-trip, ZIP round-trip, gzip header sanity.
- **`docs/standalone.md` reworked.** Install section now leads with the in-VS-Code install command (Option A), then the manual GitHub Release download (Option B), then the build-from-source fallback (Option C). Reflects the actual recommended user journey.

### Fixed

- **Standalone archive was missing sibling modules.** The `standalone` job in `release.yml` only copied `dist/standalone/` into the release archive, but `dist/standalone/main.js` does `require('../aiflowbridge')` etc. for the gateway / telemetry / runtime modules. These siblings (`dist/aiflowbridge/`, `dist/logger.js`, `dist/config.js`, `dist/consts.js`, `dist/types.js`, `dist/json.js`) are now copied alongside the standalone entry, so the extracted archive runs out of the box (was: `Error: Cannot find module '../aiflowbridge'` on first launch).
- **GitHub API requests lacked the required `User-Agent` header.** `/releases/latest` was returning HTTP 403 ("You must provide a User-Agent header") for some networks. The request now sends `User-Agent: AIFlowBridge-VSCode-Extension/2.4.0` plus `Accept: application/vnd.github+json` for the v3 REST API.
- **GitHub API HTTP 3xx redirects were not followed.** The download now follows 301 / 302 / 303 / 307 / 308 up to 5 hops (loop guard), resolving both absolute and relative `Location` headers.
- **Rate-limit response was indistinguishable from other 403 errors.** The error path now checks `x-ratelimit-remaining: 0` and surfaces a dedicated i18n string (`installStandalone.rateLimited`) pointing at `docs/standalone.md` as the build-from-source fallback.
- **`installStandalone.pickInstallDir` i18n key was missing.** The folder-picker dialog's "Open" button label showed the raw i18n key instead of the translated "Choose install location" string. The key is now defined in both `src/i18n.ts` (runtime) and `package.nls.json` (VS Code marketplace).

### Tests

- **629 tests across 35 files** (was 616 / 34 in 2.3.0, +13). New file `tests/install-standalone.test.ts` covers platform detection (7 cases: linux x64, darwin arm64/x64, win32 x64, win32 arm64 unsupported, freebsd unsupported, ia32 unsupported), `InstallError` discriminated union (codes x2), tar.gz round-trip via `tar.create` + `tar.extract`, ZIP round-trip via adm-zip, gzip header sanity check.
- Quality gates: `npm run compile` (0 errors), `npm test` (629/629), `npm run compile:standalone` (0 errors).

## 2.3.0

Standalone CLI binary distribution via GitHub Release (Option 2 of the V2 distribution plan) and documentation overhaul for the 2.x API surface.

### Added

- **Standalone CLI binary distribution.** A new `standalone` job in `.github/workflows/release.yml` builds the CLI on a 4-OS matrix (`ubuntu-latest` / `macos-latest` / `macos-13` / `windows-latest`), prunes dev dependencies, packages a per-platform archive (`tar.gz` on POSIX, `zip` on Windows), and attaches it to the GitHub Release alongside the VSIX. Each archive contains a launcher (`bin/aiflowbridge-server` or `bin\aiflowbridge-server.cmd`), the compiled `dist/standalone/`, pruned `node_modules/`, and a `README.txt` pointing at `docs/standalone.md`. No Node.js bundled (~5 MB vs 80+ MB for a packaged Node runtime) - the target machine must have Node.js 20+ installed. The release body now includes a per-platform download table. End users can now consume the gateway without cloning the repo or running `npm ci`.

### Fixed

- **Release workflow warning.** Removed `environment: production` from the `publish` job in `.github/workflows/release.yml`. The environment was referenced but never defined in the repo Settings, causing the GitHub Actions extension to flag it as invalid at lint time. The job runs normally on `ubuntu-latest` with the existing concurrency group.

### Changed

- **Documentation overhaul for the 2.x API surface.**
  - `CONTRIBUTING.md`: replaced the obsolete "edit `src/consts.ts` MODELS array" workflow with the bundled-registry workflow (`resources/models.json` + `RegistryModelDefinition` in `src/aiflowbridge/modelRegistry.schema.ts`); test count updated to **616/34**; added a dedicated section for the standalone build (`npm run compile:standalone`).
  - `SECURITY.md`: bumped "Supported Versions" to **2.x** (1.7.x best-effort), added a "Hardening Highlights" section cataloging the per-version security additions (shutdown auth, SSRF validation, telemetry file persistence, standalone hardening, API key redaction, upstream error sanitization, probe hardening).
  - `README.md`: replaced the misleading "NEW in 2.0.0" banner with a since-2.0.0 tagline that also names the 2.1.x hardening; added the 3 client-setup pages (`kilo-code`, `jetbrains-continue`, `jetbrains-ai-assistant`) to the Documentation table; added 4 missing commands to the Commands table.
  - `docs/architecture.md` and `docs/development.md`: updated for v2.1.1 - full source tree including `src/standalone/`, `src/client/`, `src/provider/unified.ts`; corrected the test count and npm scripts (`publish:vscode` / `publish:openvsx` / `publish:all`).
- **AGENTS.md progressive disclosure.** The agent instruction file went from a 335-line monolith to a 44-line root index pointing at 10 focused pages under `docs/agent-instructions/` (style, architecture, registry, providers, gateway, vision, telemetry, testing, tasks, working-notes). The new structure separates agent-specific guidance (audience: AI coding assistants) from the user-facing `docs/` (audience: end users) so the two can evolve at different cadences. The `docs/agent` path was renamed to `docs/agent-instructions` to avoid ambiguity with the OpenAI Agents SDK / generic "agent" usage.

### Notes

- The repo still ships with a stale `.github/release-please-manifest.json` (`"1.2.2"`) - release-please has been manually overridden since 2.0.0. Version bumps continue to be managed by hand. If you want to re-enable release-please, bump the manifest first.
- Source-code comments and JSDoc across `src/` and `tests/` were cleaned of internal audit-trail labels (`FEAT\d+`, `STU\d+`, `BUG-?\d+`, `SEC\d+`, `AFF\d+`, `WARN-\d+`, `IMPROV-\d+`, `R-\d+`, etc.). No behavior change. The labels remain in the internal-only surfaces (`TODO.md`, `CHANGELOG.md`, `_helpers/`, `_Private/`) for the team that needs them.

## 2.1.1

Standalone gateway hotfix + UX feedback.

### Fixed

- **Standalone: secrets.json short-form keys now resolve correctly.** The user-facing `docs/standalone.md` documents the short form (`"deepseek.apiKey"`, `"minimax.apiKey"`, `"xiaomi.apiKey"`) but the runtime resolver (via `API_KEY_SECRETS` in `src/consts.ts`) asks for the full-prefix form (`"aiflowbridge.providers.<vendor>.apiKey"`). Before this fix, a standalone user following the docs got `login fail: Please carry the API secret key in the 'Authorization' field of the request header (1004)` from the upstream API because the lookup missed. `StandaloneSecretStorage` now mirrors short-form entries to the full-prefix form at load time, so either format works. When both forms are present, the full form wins (deterministic). Symptom reported on Windows with `C:\Users\laure\.aiflowbridge\secrets.json` containing the documented short-form keys.

### Changed / Added

- **Standalone CLI: startup banner with server URL.** After `runtime.activate()`, the standalone CLI now logs one of three contextual messages so the user knows exactly what just happened and where to point their OpenAI-compatible client: `"Server started at http://127.0.0.1:<port>"` (we started our own gateway), `"Joined external gateway at http://127.0.0.1:<port>"` (we joined a VS Code peer or another standalone instance), or `"Server disabled (gateway.enabled = false in config)"` (gateway off in the standalone config). New public `gatewayInfo` getter on `AIFlowBridgeRuntime` exposes `{ running, port, baseUrl, isJoined, providerCount }` for the CLI banner and external consumers (status checks, health endpoints, ...).
- **Build feedback: `compile:standalone` now prints `"[build:standalone] OK - dist/standalone/main.js (<bytes> bytes)"` on success.** `tsc` and `tsc-alias` produce no output on a clean compile, which made it look like the build was hanging. The trailing `node -e "console.log(...)"` confirms visually that the binary was emitted and reports its size.

### Tests

- **616 tests across 34 files** (was 614 in 2.1.0, +2). New: short-form `secrets.json` keys resolve correctly (regression for the 1004 bug) ; full-prefix form wins over short form when both are present (defensive determinism).

## 2.1.0

Post-2.0.0 hardening + small features from the FEAT7 audit follow-up
2.0.0; only new optional settings, more defensive code paths, and additional test coverage (596 -> 614 tests).

### Added

- **`aiflowbridge.gateway.probeTimeoutMs` setting** (`package.json`). Configurable timeout (default 500 ms) for the peer gateway probe that runs when the configured port is already bound. Previously hardcoded.
- **`aiflowbridge.gateway.maxConcurrentRequests` setting** (`package.json`). Hard cap (default 20) on the number of concurrent upstream `/v1/chat/completions` requests. Requests above the cap return HTTP 429 with a `Retry-After: 1` header. Protects the upstream from a runaway local client.
- **`GatewayStatus.inFlightRequests` + `GatewayStatus.maxConcurrentRequests`** fields (`types.ts`). Surfaced alongside the existing `running` / `port` / `baseUrl` / `providerCount` so the dashboard and status bar can render `X / cap` without re-reading the full config.

### Security / Hardening

- **API key redaction in `loadConfig` diagnostic logs** (`providers.ts`, `config.ts`). New `redactProviderForLog()` / `redactProvidersForLog()` helpers strip the `apiKey` field and add an `apiKeyPresent: boolean` so any future verbose dump (or copy-paste of the existing diagnostic loop) never leaks credentials. The loop now logs `apiKey=***` or `apiKey=<none>` instead of nothing.
- **`readBody()` no longer keeps `'error'` / `'close'` listeners alive after settling** (`server.ts`). BUG-A03 follow-up: the listeners are removed in the `settle()` closure so a late socket error (HTTP/1.1 keep-alive edge case on Node >= 20) cannot fire-and-leak the handler closure. Same behavior, lower memory footprint.
- **Translation log for `reasoning_effort` -> `reasoning_split`** (`server.ts`). WARN-B05: when the gateway translates Kilo Code / Open WebUI's `reasoning_effort: "high"` into MiniMax's `reasoning_split: true`, a `logger.debug()` line records the before / after pair (with the `requestId` for correlation). Diagnoses "I sent reasoning_effort=high but the model did not think" reports. The `translatePayloadForUpstream` function itself stays pure (no side effects) for unit testing - the log lives at the call site.

### Test coverage

- `tests/commands-ux.test.ts` (5 tests) - regression for R-01..R-04. The runtime is exercised end-to-end against a mock `IGatewayContext` that captures every command registration and host hook invocation, then asserts that `resetMetrics` calls `ctx.confirm`, `copyGatewayUrl` calls `ctx.clipboardWrite`, `openSettings` calls `ctx.openSettings("aiflowbridge")`, and `setVisionModel` calls `ctx.executeCommand("aiflowbridge.providers.deepseek.setVisionModel")`.
- `tests/telemetry-drain.test.ts` (3 tests) - regression for BUG-A05. Real HTTP/1.1 keep-alive client holds a request open in streaming mode, then `stop()` must close the client socket before a second `start()` can re-bind the same port. Idempotent `stop()` also covered.
- `tests/migration-legacy.test.ts` (4 tests) - regression for B-01. The `AIFlowBridgeRuntime` is activated against a `globalState` pre-seeded with a 1.6.x-shaped snapshot, then asserted on the sentinel flag and the absence of a `globalState.update` write when the sentinel is already set. Standalone-mode no-op also covered.
- `tests/subscriptions-bag.test.ts` (6 tests) - regression for B-04. The `Proxy` returned by `createVSCodeContext().subscriptions` is asserted to support `length`, indexed access, `forEach`, `filter`, `map`, `indexOf`, and `includes`, plus the `push` forward into the host's `context.subscriptions`. Pre-existing subscriptions in the host are preserved.

### Build

- `tsconfig.standalone.json`: `src/aiflowbridge/vscode-context-adapter.ts` is now excluded from the standalone build (it depends on `vscode.Uri` which the shim does not implement as a class with `Symbol.hasInstance`). The standalone binary was already not using this file - the exclusion formalizes the boundary.

## 2.0.0

Standalone gateway + audit-driven hardening. The gateway can now run as a pure Node.js CLI (`aiflowbridge-server`) without VS Code, while the VS Code extension itself was hardened against a batch of regressions and pre-existing security findings.

### Added

- **Standalone gateway (`aiflowbridge-server` CLI).** `GatewayService` and `AIFlowBridgeRuntime` are decoupled from `vscode.ExtensionContext` via a new `IGatewayContext` interface. The CLI binary reads its config from `~/.aiflowbridge/config.json` (with hot-reload via `fs.watch` + 5s polling fallback on Windows), resolves API keys from `AIFLOWBRIDGE_<VENDOR>_API_KEY` env vars first then `secrets.json` (`chmod 600`), and shares the same `gateway.lock` as the VS Code side so only one process owns the gateway. The VS Code extension switches to a "joined" mode (status bar `AIFlowBridge ↗ external`) when it detects a peer already running. New `tsconfig.standalone.json` + `vscode-shim.ts` keep the standalone build type-safe without `@types/vscode`. Docs: `docs/standalone.md`, autostart templates (systemd / launchd / Task Scheduler), and Continue / JetBrains AI Assistant setup guides. 28 new tests in `tests/standalone/` (591 -> 619 baseline).

### Fixed (follow-up audit - 4 LLM consensus)

- **`resetMetrics` lost its modal confirmation.** The `showWarningMessage({ modal: true })` guard against accidental wipes was dropped in the FEAT7 refactor. Reintroduced via a new `ctx.confirm` hook on `IGatewayContext` (modal on VS Code, no-op in standalone CLI).
- **`copyGatewayUrl` stopped copying.** The command name promised clipboard but the implementation only showed an info message. Fixed via `ctx.clipboardWrite` (`vscode.env.clipboard.writeText` on VS Code, `process.stdout.write` in standalone).
- **`openSettings` stopped opening settings.** Same shape: renamed to show the config file path only. Fixed via `ctx.openSettings` (`workbench.action.openSettings` on VS Code, fallback in standalone).
- **`aiflowbridge.setVisionModel` command was orphaned.** Declared in `package.json:113` but the handler was removed in FEAT7 (VS Code showed "command not found"). Re-registered as a thin alias to `aiflowbridge.providers.deepseek.setVisionModel`.
- **Workspace-tier override `.vscode/aiflowbridge.models.json` was silently ignored.** `loadModelRegistry` was called with the raw `ExtensionContext` (no `workspaceFolder` field) before the adapter ran. Fixed by calling `createVSCodeContext(context)` first in `lifecycle.activate()`. The 3-tier merge now reads the workspace tier on the VS Code side again.
- **Legacy `globalState` -> `telemetry.json` migration was dropped.** Users upgrading from 1.6.x lost their cumulative counters (`requests`, `totalTokens`, cost). Reintroduced for the VS Code path via a new `globalState` slot on `IGatewayContext`; standalone is a no-op as before.
- **`StandaloneConfigReader` (internal) and `StandaloneConfigFile` (exported, tested) diverged.** The internal reader skipped the `DEFAULT_STANDALONE_CONFIG` fallback that the documented `StandaloneConfigFile` applies. Removed the internal reader; the runtime now uses the exported one.
- **`subscriptionsBag` was a hand-rolled `length: 0` object cast to `Disposable[]`.** `forEach` / `filter` / `map` / index access would have crashed any caller iterating the bag. Replaced with a real `Array` wrapped in a `Proxy` that mirrors `push` into `context.subscriptions`.

### Security (pre-Action-Plan audit)

- **`stop()` did not drain keep-alive sockets** (`server.ts`). A subsequent `start()` after a window reload hit `EADDRINUSE` because an idle keep-alive socket held the port. Fixed with `server.closeAllConnections?.()` (Node >= 18.2) plus a manual `Set<Socket>` + `socket.destroy()` fallback for older Node.
- **`removeEntry` desynced `durations` from `recent` after `restore()`** (`telemetry.ts`). The p95 percentile was computed from the wrong slice. Fixed by recomputing the p95 from `recent.map(e => e.durationMs).sort(...)` on demand, with a `p95Cache` invalidated on every mutation.
- **Streaming `durationMs` was time-to-first-byte, not last byte** (`server.ts`). Telemetry was recorded right after `pipe()` instead of after the last SSE chunk reached the client. Moved `recordTelemetry` into `response.once('finish', ...)` with a `telemetryRecorded` guard.
- **`recent` was unbounded in memory** (`telemetry.ts`). A high-throughput session could allocate a multi-MB array on every `snapshot()` call. Added a configurable `memoryCap` (default 10000) on `TelemetryStore`; the on-disk persister still receives every entry.
- **API key could leak into 502 response body** (`server.ts`). Some `fetch` error messages embed the full URL; if a `baseUrl` had a credential in the query string, it would surface in the body and logs. New `sanitizeUpstreamErrorMessage()` strips the query string and redacts `api_key` / `Authorization` / `Bearer` references.
- **`probeServerVersion` had no body size limit** (`probe.ts`). A hostile or malfunctioning peer could push a multi-MB body. Added a 4 KiB `content-length` pre-check + `text().length` guard + `try/catch` around `JSON.parse`.
- **`isPortInUse` could leak a timer** (`probe.ts`). `socket.setTimeout(500)` was not cancelled on the `connect` / `error` paths. Added a `setTimeout(0)` so the timer is released immediately.
- **`selectProvider` case-insensitive comparison was `toLowerCase()` only** (`providers.ts`). Switched to `localeCompare(..., { sensitivity: 'base' })` for proper Unicode folding.
- **Probe timeout 200 ms was too short on loaded machines** (`server.ts`). Raised to 500 ms with 1 retry / 100 ms back-off via `probeServerVersionWithRetry()`.
- **`dispose()` is fire-and-forget but `stop()` is async** (`server.ts`). Idempotency is enforced by the `!this.server && !this.joined` guard so the double-stop from `deactivate()` + VS Code's `Disposable` is a no-op.
- **`require(package.json)` in the CLI binary was a RCE vector** (`standalone/main.ts`). Replaced with `readFileSync` + `JSON.parse` so a maliciously-written `package.json` cannot execute arbitrary code via the CommonJS loader.
- **`secrets.json` Windows ACL limitation** is now documented in `docs/standalone.md` (Security section). `chmod 0o600` is a no-op on Windows; the doc notes the limitation rather than silently ignoring it.
- **`resolveVendorApiKey` accepted only `SecretsLike` (get-only) but the runtime cast the full `SecretStorageLike`** (`api-key-resolver.ts`). Widened to `ResolveSecretSource = SecretStorageLike | SecretsLike` so the cast is no longer needed.

### Changed / Refactored

- **`reloadConfiguration` restarted the gateway on every config change** (`index.ts`). Now checks `event.affectsGateway` (derived from `e.affectsConfiguration("aiflowbridge.gateway")` in the VS Code adapter). Non-gateway edits (providers, vision, telemetry) hot-update via `updateConfig()` without a port rebind.
- **Double `/v1` in provider `baseUrl`** (`config.ts`) now logs a warning - the silent path-rewriting foot-gun.
- **`created` in `GET /v1/models` was `Date.now()/1000` per call** (`providers.ts`). Replaced with a constant so OpenAI-compatible clients with model-cache invalidation heuristics keep their cache.
- **`percentile()` re-sorted the durations array on every `snapshot()`** (`telemetry.ts`). `p95Cache` is invalidated on mutation and rebuilt lazily.
- **`clearTimeout` only ran in `finally`** (`token-counter.ts`). Now also runs in the `abort` event handler with a `cleared` flag.
- **Dead `legacy` branch** in `resolveExtensionUri` (`modelRegistry.ts`) removed.
- **Duplicate `getNestedValue`** (`standalone/context.ts` + `config-loader.ts`) extracted into `standalone/util.ts`.
- **Dead `loadConfig(context)` wrapper** (`config.ts`) removed; `loadConfigFromContext(ctx)` is the single entry point.
- **Misleading comment** about `getUserModels()` in standalone (`config.ts`) corrected - the `vscode` shim reads `userModels` from `config.json` (it does NOT return an empty array).
- **`IMPROV-C07` cast** `as unknown as vscode.ExtensionContext` (`config.ts`) removed; `loadModelRegistry` now accepts `RegistryHost` (which `IGatewayContext` satisfies).

### Tests

- **596 tests across 30 files** (was 591 across 29 in 1.7.0, +5).
- New: 28 standalone tests (`tests/standalone/context.test.ts` + `config-loader.test.ts`), 2 regression tests in `tests/telemetry-store.test.ts` (BUG-A01 p95 cache + WARN-B01 memoryCap), 1 regression test (IMPROV-C01 cache invalidation), 2 regression tests in `tests/vscode-context-adapter.test.ts` (FEAT7 `joinPath` -> `vscode.Uri.file()` conversion, was invisible to the previous `options.fs` mock path).
- Quality gates: `npm run compile` (0 errors), `npm run compile:standalone` (0 errors), `npm test` (596/596).

### Known issues / breaking changes (vs 2.0.0-rc)

- `resetMetrics` now requires modal confirmation (was: silent reset).
- `copyGatewayUrl` writes to the clipboard (was: info message only).
- `openSettings` opens VS Code settings (was: shows config path only).
- `aiflowbridge.setVisionModel` is re-registered (was: orphaned in `package.json`).
- Legacy `globalState` -> `telemetry.json` migration re-introduced (was: dropped, lost 1.6.x counters).
- Workspace override `.vscode/aiflowbridge.models.json` is picked up again (was: silently ignored).
- 1.6.x -> 2.0.0 upgrade path: cumulative counters survive via the legacy migration.

## 1.7.0

Hardening release: security, bug-fixes, and refactoring from external audit (STU02 - 8 items). Shutdown auth, SSRF protection for provider baseUrls, race-condition fixes, dead-code removal.

### Security

- **SEC01 - `POST /shutdown` now requires a per-instance auth token.** A `randomUUID()` generated at `GatewayService` construction is returned in `GET /version` and must be echoed in the `X-AIFlowBridge-Shutdown-Token` header. Requests without the header or with a wrong token get a 403. `PeerVersion.shutdownToken` is optional for backward compat (pre-1.7.0 peers do not gate shutdown, so their responses to a token-less request are 200; post-1.7.0 peers reject unauthenticated shutdowns). `requestPeerShutdown(port, { shutdownToken })` passes the header, and `handleOccupiedPort` in `server.ts` forwards the peer token it received from probe. 7 tests in `gateway-restart.test.ts` + `gateway-version.test.ts`.
- **SEC02 - Provider `baseUrl` SSRF validation via `isValidProviderBaseUrl()`.** New helper in `providers.ts` rejects non-http(s) schemes (`file:`, `gopher:`, `javascript:`, ...), unparseable URLs, and cloud metadata endpoints (AWS/GCP/Azure `169.254.x.x`, Alibaba Cloud `100.100.100.200`, AWS IMDS-over-IPv6 `fd00:ec2::254`). `normalizeHost()` handles IPv4-mapped IPv6 in both decimal (`::ffff:1.2.3.4`) and hex (`::ffff:a9fe:a9fe`) forms, plus the brackets added by WHATWG `URL.hostname` on Node 20+. Loopback (`127.x.x.x`, `::1`, `localhost`) is intentionally allowed for Ollama. Entries failing validation are silently dropped in `normalizeProviderProfiles`. 14 tests in `aiflowbridge-providers.test.ts`.

### Fixed

- **BUG13 - `gatewaySnapshot()` fallback logic** (`index.ts`). The fallback to `telemetryFallback.snapshot()` (persisted data from the previous session) is now only triggered when the gateway is NOT running AND has zero requests. Previously it triggered whenever `requests === 0`, causing a freshly-started gateway to display stale data as if it were live.
- **BUG14 - `readBody()` race between `end` and `close`** (`server.ts`). A `settled` flag now guards the Promise so a normal `end`-then-`close` sequence resolves once and ignores the trailing `close`, while a brutal disconnect (`close`-before-`end`) properly rejects. On body-too-large, `request.destroy()` is called to stop buffer accumulation. `readBody` and `MAX_BODY_SIZE` are exported for unit testing. 6 tests in `gateway.test.ts`.
- **BUG15 - `reloadConfiguration()` EPEERSTALLED handling** (`index.ts`). `gateway.start()` is now wrapped in `try/catch` and surfaces a targeted warning with the peer PID when the peer did not free the port within the timeout, mirroring the `activate()` flow.
- **LOW9 - `toNumber(0) || undefined` false positive in `normalizeProviderProfiles`** (`providers.ts`). An explicit `pricing.outputPerMillion: 0` ("free output tokens") was collapsed to `undefined` by the `||` operator because `0` is falsy. The fallback chain now keeps 0 as-is; downstream `formatCostCell` and `estimateCostFromProfile` already handle zero-cost math and display.

### Changed / Refactored

- **REF01 - Factorized `synthesizeProvidersFromUserModels` and `synthesizeProvidersFromBuiltInModels`** (`config.ts`). A private `synthesizeProvidersFromModels()` helper now carries the shared logic; both public functions are thin wrappers. The 22 existing tests in `aiflowbridge-config.test.ts` pass without modification.
- **REF02 - Removed `isPortLikelyOccupied()`** (`index.ts`). The single call site now uses `isPortInUse()` directly. The one-line wrapper added no value.
- **REF03 - Removed `getApiModelId()` alias** (`src/config.ts` + `src/provider/request.ts`). The single call site migrated to `getProviderApiModelId('deepseek', modelInfo.id)`. Verified zero remaining call sites via grep.

### Tests

- **563 tests across 27 files** (was 551 in 1.6.0, +12).
- New coverage: `readBody` settled-flag + body-too-large + stream errors (6 tests in `gateway.test.ts`), `normalizeHost` bracket-stripping + hex IPv6 (6 tests in `aiflowbridge-providers.test.ts`).
- Regression coverage from 1.6.0: shutdown token (7 tests in `gateway-restart.test.ts` + `gateway-version.test.ts`), SSRF validation (14 tests in `aiflowbridge-providers.test.ts`).

## 1.6.0

Metrics dashboard overhaul: pagination, filtering, and history fixes.

### Fixed

- **Pagination strip now updates after page navigation.** The strip (page number, prev/next button state, "X-Y/Z" counter) used to render once at init and stay frozen - clicking next would slice the rows but the bar still showed page 1. Fixed by routing every page change through a single `refresh` closure that re-renders both the table and the pagination controls. Affects all three paginated panels (Recent / By model / Provider).
- **By model panel filter was a no-op.** Preset buttons (`Last 1h`, `Last 24h`, ...) in the By model panel visually activated but never filtered anything - `currentFilters()` only read the Recent panel's active button. Fixed by accepting a `rangeOverride` parameter on `applyFilters` and syncing the active state across both filter groups via `syncPresetButtons()`. Custom date pickers now also deactivate preset buttons in **both** panels (renamed `deactivateAllPresetButtons` for accuracy).
- **Listener leak on the extension-host message bus.** Every call to `showMetricsDashboard()` on an already-open panel accumulated a fresh `onDidReceiveMessage` handler. A single refresh click triggered N rebuilds of the HTML. Fixed by disposing the previous handler before attaching a new one (tracked in a module-level `Disposable`).
- **`buildPricingMaps` was including disabled providers.** Replaced `buildPricingMaps(config.providers)` with `buildPricingMaps(providers)` (filtered to `enabled`) so disabled providers no longer contribute pricing tooltips or estimates.
- **XSS via `</script>` in JSON payloads.** Provider labels and model names are embedded in a `<script>` block; a name containing `</script>` would have broken out of the tag and executed arbitrary code. Fixed by a new `serializeForScript()` helper that escapes `<`, `>`, and `&` to their unicode equivalents (`\u003c`, `\u003e`, `\u0026`) before JSON.stringify output. Applied to every serializer (`serializeRecent`, `serializeByModel`, `serializeByProvider`, `serializeCumulativeTotals`, `serializePricingMaps`).
- **"Estimated cost" card formatting drifted between server and client renders.** Server used `toFixed(4)`, client used `toFixed(4).replace(/0+$/, "").replace(/\.$/, "")`. The card showed `$0.0230` on first open and `$0.023` after one filter toggle. Aligned by extracting a shared `formatCostValue()` helper used by both render paths.
- **Date column rendered locale date+time, header said "Time".** Renamed header to "Date" and switched both server (`formatClock`) and client (`formatTime`) helpers to `Date.toLocaleString()` so dates from different days are distinguishable in the per-row table.
- **`id` field was missing from `serializeRecent`.** After any client-side re-render (pagination, filter), the per-row delete button had `data-remove-id="undefined"` and clicking it would no-op or trigger a wrong removal. Fixed by including `id` in the serialized payload.

### Added

- **Truncation detection banner + one-click reset.** When `snapshot.recent.length < snapshot.requests` by 5 or more (the tell-tale sign of a telemetry file written under the old `MAX_RECENT` cap), the dashboard shows a yellow banner explaining that recent history is incomplete and offers a **Reset history** button. The button delegates to the existing `aiflowbridge.resetMetrics` command (which keeps its native confirmation dialog) and re-renders the dashboard on completion. This is the only recovery path - aggregated totals cannot reconstruct individual entries that were never persisted.
- **Accessibility improvements.** `aria-label="Filter requests"` on the search input; `type="button"` on every non-submit button (refresh + 4 collapse toggles).
- **Cost card alignment.** Both render paths now share `formatCostValue()` for the `$X.YYYY` formatting with trailing-zero trimming.

### Changed

- **`TelemetryStore.MAX_RECENT` cap removed.** The `recent` tail was capped at 100 entries (previously 20), forcing the per-row table to silently hide older entries even though `requests` and `byProvider`/`byModel` aggregates covered the full history. **The cap is no longer applied to new writes.** Affected users (whose files were written under ≤ 1.5.5) will see the truncation banner described above and need to click Reset once.
- **Pagination counter format.** `X-Y of Z` -> `X-Y/Z` per the requested UX.
- **`aggregateModels` trimmed.** No longer computes unused `promptTokens` / `completionTokens` per row.
- **`serializeByModel` / `serializeByProvider` payload slimmed.** New `slimProviderSnapshots()` keeps only the fields the client actually renders (drops `promptTokens` / `completionTokens`), shrinking the on-the-wire JSON by ~40%.

### Code quality / refactor

- Extracted `formatCostValue`, `serializeForScript`, `slimProviderSnapshots`, `syncPresetButtons` as named helpers.
- Renamed `applyAllFilters` to `applyTimeAndDateFilters` (the search needle parameter was dead code).
- Removed trivial `buildHtml` wrapper around `buildDashboardHtml`.
- Removed redundant `&&` guards in `lookupPricing*` (the maps are always defined).
- Tightened comment-level documentation (refresh closure semantics, cap removal rationale, optional-chain for nullable TS API).

### Notes

- Telemetry files written under 1.5.5 or earlier are **permanently truncated** at 20 entries in their `recent` tail. The cumulative counters (`Requests`, `Tokens`, `Estimated cost`, per-provider / per-model aggregates) are unaffected and remain correct. The new truncation banner surfaces a one-click reset for users in this state. From 1.6.0 forward, every recorded request is appended with no eviction.

## 1.5.5

Patch release: README polish

### Fixed

- README: badge bar refreshed for Open VSX discoverability and other minor changes.

### Notes

- **Documentation-only release.** No source file under `src/` was touched, no test was added or modified, no `package.json` dependency changed. The only repo-level changes are: `README.md` (this entry) and `package.json` (version bump `1.5.4` -> `1.5.5`). All three quality gates are still green: `npm run compile` (0 TypeScript errors), `npm test` (515 / 515 passing), and the Open VSX + Marketplace publication workflow is unchanged.

## 1.5.4

Patch release: fix the Open VSX publication step in the release workflow. No code change in the extension, no user-facing change for any install channel (VS Code Marketplace, Open VSX, manual install).

### Fixed

- **Open VSX publication step in `.github/workflows/publish.yml` failed with `error: unknown option '--publisher'`.**

## 1.5.3

Patch release: Open VSX publication plumbing (reach Cursor / Windsurf / VSCodium / code-server users). No user-facing change for VS Code Marketplace users.

### Added

- **Open VSX Registry publication via `ovsx` CLI.** The release workflow (`.github/workflows/publish.yml`) now publishes the extension to Open VSX in addition to the VS Code Marketplace. Users on alternative VS Code distributions (Cursor, Windsurf, VSCodium, code-server, Gitpod, ...) can now install AIFlowBridge from the [Open VSX Registry](https://open-vsx.org/extension/LaurentOngaro/aiflowbridge). The new `ovsx` devDependency (`@eclipse/openvsx` CLI repackaged under the short `ovsx` name on npm) reads `dist/*.vsix` (the exact same artifact produced by `vsce package` for the Marketplace) and uploads it using the `OVSX_PAT` GitHub secret. No new code in the extension, no new user setting, no breaking change for existing Marketplace users.

### Changed

- **`.github/workflows/publish.yml`** renamed from "Publish to VS Code Marketplace" to "Publish to VS Code Marketplace + Open VSX", and now invokes `npx --no-install ovsx publish --packagePath dist/*.vsix --publisher LaurentOngaro` after the Marketplace step. The two steps share the same `dist/*.vsix` artifact so there is no risk of a version mismatch between the two registries. The trigger remains a published GitHub release.

### Notes

- **First release on Open VSX (1.5.2) was published manually** using `npx ovsx publish --packagePath ...`. The 1.5.3 release is the first one published automatically through the GitHub workflow.

## 1.5.2

Patch release: optional reasoning mode for MiniMax M3 in Copilot Chat, Kilo Code reasoning-checkbox pass-through in the gateway, and BUG11 fix (errored requests no longer bill the user).

### Added

- **MiniMax M3 now exposes a "Thinking Effort" selector in the Copilot Chat model picker.** The selector (`None` / `High` / `Max`) is the same dropdown that DeepSeek V4 Pro/Flash already expose. The selection is translated into the upstream MiniMax API's `reasoning_split` boolean: `None` -> `reasoning_split: false` (no reasoning tokens in the response), `High` and `Max` -> `reasoning_split: true` (reasoning tokens split into a separate field, which is what the streaming layer reports via `LanguageModelThinkingPart`). When the user does not touch the selector, the global `aiflowbridge.providers.minimax.reasoningSplit` setting is honored as before (backward compatible). 12 new tests in `tests/config.test.ts` cover the `resolveReasoningSplit(thinkingCapable, picker, global)` pure helper across all combinations of thinking-capable flag, picker value, and global setting.
- **Kilo Code reasoning-checkbox pass-through in the gateway.** Kilo Code's AiflowBridge provider settings expose a "reasoning" checkbox. Until now, the field was silently dropped on the floor by the gateway (it was never in the upstream MiniMax body). A new pure function `translatePayloadForUpstream(payload, provider)` in `src/aiflowbridge/gateway/server.ts` is now called by `forwardChatCompletion` before re-serializing the upstream body. When the matched provider is a MiniMax upstream (detected by `baseUrl` host `minimax.io` / `minimaxi.com` or by an `id` prefix `minimax`), the function injects `reasoning_split: payload.reasoning` and strips the `reasoning` field. The body is always re-serialized after translation (never passed through as the raw `bodyText`) so the AIFB-specific field never reaches the upstream API. 17 new tests in `tests/gateway-reasoning.test.ts` cover the MiniMax translation, the non-translation for DeepSeek / Xiaomi providers, host-based and id-based MiniMax detection, the strip-behavior, and edge cases (undefined / null / empty / non-boolean / pre-existing `reasoning_split`).
- **Kilo Code `reasoning_effort` dropdown now works for MiniMax models.** Kilo Code's "Reasoning Effort" picker in the chat input sends `reasoning_effort: "none" | "high" | "max"` in the request body - the same field it uses for DeepSeek. Until now, this field was passed through unchanged for MiniMax upstreams, which use a different native parameter (`reasoning_split: true/false`). The MiniMax API silently ignored `reasoning_effort`, so toggling the dropdown had no visible effect on MiniMax models. The translator now also handles `reasoning_effort` for MiniMax upstreams: `"none"` -> `reasoning_split: false`, `"high"` and `"max"` -> `reasoning_split: true`, any other string -> `true` (defensive default so a typo does not silently disable reasoning). The field is stripped from the upstream body. DeepSeek upstreams are unaffected (DeepSeek uses `reasoning_effort` natively, so the translator does not touch it). When BOTH `reasoning` (the AiflowBridge checkbox) and `reasoning_effort` (the dropdown) are present, the explicit boolean wins and both AIFB-specific fields are stripped. 8 new tests in `tests/gateway-reasoning.test.ts` (new "Kilo Code `reasoning_effort` dropdown" describe block) cover: `"high"` / `"max"` -> true, `"none"` -> false, unknown values default to true, no input mutation, the explicit-`reasoning`-wins precedence rule for both directions (`false` over `"high"` and `true` over `"none"`), and the defensive override of a pre-existing `reasoning_split`.

### Fixed

- **BUG11: [metric dashboard: requests in error have an estimated cost](https://github.com/LaurentOngaro/AIFlowBridge/issues/5).** `GatewayService.recordTelemetry()` (`src/aiflowbridge/gateway/server.ts:634-664`) now sets `estimatedCost = 0` whenever the recorded `status` is `>= 400` (4xx / 5xx upstream response, or the catch-block default of 502 when the upstream never responded). The request is still recorded (error count, per-provider / per-model usage, duration averages, per-row delete affordance) - it just no longer contributes to the "Estimated cost" totals. Cost is a fait historique: we never bill the user for a request that never produced a billable completion. The fix naturally propagates to the cumulative `TelemetryStore.snapshot()` (`applyEntryToSnapshot` / `applyEntryInMemory` just add `entry.estimatedCost` to the totals, so a zero-cost entry contributes nothing), to the on-disk file (the persister applies the same delta), and to the per-row delete path (`removeEntry` decrements under `Math.max(0, ...)` guards). 5 new regression tests in `tests/gateway.test.ts` (new "BUG11: errored requests have zero cost" describe block) cover: successful 200 (cost computed normally), 5xx upstream response (cost=0, errors=1, model usage still recorded), 4xx upstream response (cost=0, errors=1), unreachable upstream / catch block (statusCode=502, cost=0), and a mixed success/error sequence (only successful requests contribute to the total).

### Tests

- 515 tests across 27 files (was 485 / 26 in 1.5.1).
- New file `tests/gateway-reasoning.test.ts` (25 tests: 17 for the checkbox pass-through + 8 for the `reasoning_effort` dropdown).
- `tests/config.test.ts` (+12 tests, 40 -> 52) for the picker-aware `resolveReasoningSplit` helper.
- `tests/gateway.test.ts` (+5 tests, 22 -> 27) for the BUG11 regression suite.

### Notes

- **M3 thinking selector works in Copilot Chat, not just via the picker.** The dropdown in the model picker is fed by the proposed `vscode.LanguageModelChatInformation.configurationSchema` API (same one Kilo Code uses for its own provider). When Copilot Chat sends the request, the chosen effort is passed through to the provider via the `modelConfiguration.reasoningEffort` field on `ProvideLanguageModelChatResponseOptions`. The provider (`src/provider/minimax.ts:198-211`) reads it, resolves it through `resolveReasoningSplit`, and emits `reasoning_split` in the upstream request body.
- **Other M-series models (M2 / M2.1 / M2.5 / M2.7) keep their current behavior.** Only M3 has `capabilities.thinking: true` in the bundled registry, so only M3 gets the picker dropdown. Users who want the dropdown for another M-series model can add an entry to `aiflowbridge.userModels` with `capabilities.thinking: true` (the 3-tier merge picks it up immediately) or edit the globalStorage / workspace registry override.
- **The gateway translation is the only mechanism that works for OpenAI-compatible clients that do not have a "Thinking Effort" picker.** The two paths are independent: Copilot Chat users get the dropdown, Kilo Code users get the checkbox, both end up with the same `reasoning_split` value on the wire to MiniMax.
- **No new user setting was added.** The existing `aiflowbridge.providers.minimax.reasoningSplit` setting is still the global default for any model that does not opt into the picker. The picker wins when the model has `capabilities.thinking: true` AND the user has not left the dropdown on its default value.
- **BUG11 fix is purely a telemetry-layer change.** No upstream API contract changed, no provider behavior changed, no user-facing setting changed. The only observable difference is that the "Estimated cost" column in the dashboard no longer includes cost for requests that errored out (4xx, 5xx, or catch-block). Historical entries recorded before 1.5.2 keep their original cost (per the existing "Cost is a fait historique" rule in 1.4.1). To clear historical errored entries from the dashboard, use `AIFlowBridge: Reset metrics` (the same command that was already used to re-baseline after a pricing change).

## 1.5.1

Patch release: type-only fixes in the registry loader test mocks. No behavior change, no new tests.

### Fixed

- clean minor warnings in test files
- minor changes in AGENTS.md .

## 1.5.0 (post-release patches)

Incremental additions on top of 1.5.0 without bumping the version. Each entry is self-contained and ships as a patch update.

### Added

- **Per-row delete button in the metrics dashboard "Recent requests" table**. Each row in the "Recent requests" panel now has a trash icon in a new leading column. Clicking the icon posts `{ type: "removeRequest", id }` to the extension, which removes the entry from the in-memory `TelemetryStore` (totals, recent list, per-provider / per-model maps, durations array) and from the on-disk `<globalStorageUri>/telemetry.json` file under the same file lock as `appendDelta` (FEAT1). The cumulative counters and the recent list both reflect the removal immediately; p95 is recomputed from the now-shrunk durations array. A cross-window `Refresh metrics` is enough for a non-leader window to see the removal because the persister writes through to the on-disk file, which is the source of truth.
  - New `TelemetryPersister.removeEntry(id): Promise<boolean>` method (`src/aiflowbridge/telemetry/persistence.ts`). Idempotent: returns `true` when the entry was found and removed, `false` otherwise (e.g. a peer window trying to remove an entry that was already removed by the leader). The reverse-delta math is the mirror of `applyEntryToSnapshot`: totals decrement under `Math.max(0, …)` guards, weighted average is recomputed as `(previous * oldCount - removedDuration) / newCount`, and a per-provider / per-model snapshot whose request count drops to 0 is deleted from its map.
  - New `TelemetryStore.removeEntry(id): boolean` method (`src/aiflowbridge/telemetry.ts`). Schedules a `persister.removeEntry` call (fire-and-forget) and notifies subscribers. Listener exceptions are caught (consistent with `record()` / `reset()`).
  - New `GatewayService.removeEntry(id): boolean` that delegates to the store, exposed for the dashboard message handler.
  - `showMetricsDashboard` gains an optional 5th parameter `onRemoveEntry: (entryId: string) => boolean`. When supplied, the action column is rendered (with a `th.row-actions-col` marker the client uses to know it is in scope), the trash button is added to each row, and a `{ type: "removeRequest", id }` message handler re-renders the panel after the removal. When the parameter is omitted, the action column + the trash button + the click handler are all omitted (backward-compat for callers that do not want the affordance). 9 new dashboard tests cover the positive and negative paths; 8 new tests cover `TelemetryPersister.removeEntry` and `TelemetryStore.removeEntry` (in-memory, listener notification, p95 recomputation, no-op on missing id, drops per-provider / per-model keys on last removal). 466 tests / 26 files (was 453 / 26).
  - The per-row CSS (`.row-actions`, `.row-actions-col`, `.delete-btn`, `:hover`, `:focus-visible`) is emitted conditionally, only when `onRemoveEntry` is supplied, so the no-remove-hook callers do not see the class names in the markup.

### Fixed

- **AFF03 plan-compliance corrections**
  - **Preset ↔ custom date interaction**: the original 1.5.0 implementation intersected the preset and the custom-date filters (both applied at once). The plan asked for clear / deactivate semantics: clicking a preset now clears the From / To inputs; entering a custom date (on either input) calls a new `deactivatePresetButtons()` helper that removes the `active` class from every preset button. Clearing a date input does **not** re-activate the preset (the user has to pick a preset explicitly to go back to relative mode).
  - **By-model search on the model name**: the original 1.5.0 implementation only matched the search needle against the per-entry haystack. The plan asked for entry-level OR model-name substring match. The dashboard's `applyFilters` now runs two filtered lists: the recent table uses the entry-level match; the by-model table uses entry-level OR model-name substring match (`entry.model.toLowerCase().includes(needle)`). A model whose name contains the needle is now included in the by-model aggregation even when none of its individual entries match.
  - 5 new tests in `tests/dashboard.test.ts` cover both behaviors (preset click → from/to inputs cleared in the script source, change handler → `deactivatePresetButtons` invoked, by-model filter contains the `entry.model.toLowerCase().includes(...)` branch, and two behavioral simulations that re-derive the same logic in pure TypeScript and assert the contract). `AGENTS.md` test count updated. 471 tests / 26 files (was 466 / 26).

## 1.5.0

Minor release: cross-window shared metrics with concurrent access management, and a substantial metrics dashboard UX upgrade.

### Added

- **FEAT1: cross-window shared metrics with concurrent access management**. The gateway telemetry is now persisted in a real file at `<globalStorageUri>/telemetry.json` instead of VS Code's internal `globalState`. A sibling `<globalStorageUri>/telemetry.lock` file serializes writers across processes, using the same lock pattern as the existing gateway lock (stale mtime reaper at 30s, symlink refusal, mkdir-recursive, atomic `write-tmp` + `rename`). `TelemetryStore.record()` now fires an async `persister.appendDelta()` per call. The persister's in-process write chain (`this.writeChain.then(fn, fn)`) guarantees the cross-process lock is acquired and released in the right order even when N parallel `record()` calls land in the same microtask. The on-disk file is always written atomically: a crash mid-write leaves the previous snapshot intact, and a read observed during a write returns the old or new content, never a truncated JSON. The `AIFlowBridge: Refresh metrics` command now calls `gateway.refreshFromDisk()` + `telemetryFallback.refreshFromDisk()` so a non-leader window picks up the leader's writes without a reload. A one-time migration runs on first activation after the upgrade: if the legacy `aiflowbridge.telemetry.v1` slot has data and the new file does not, the snapshot is moved over and the legacy slot is cleared (logged at INFO with the request/token counts). New file `src/aiflowbridge/telemetry/persistence.ts`.
- **AFF03: metrics dashboard UI improvements**. The dashboard header now shows the running gateway version (`Gateway vX.Y.Z running/stopped`) and the installed extension version under the title (`Current version: vX.Y.Z`). All four panel sections (Gateway / Recent requests / By model / Provider summary) are now collapsible via a chevron in their header, with the collapsed state persisted in `localStorage` per-section. The Recent requests panel gains two `<input type="date">` controls (From / To) and one `<input type="search">` ("Filter requests…"). The text search is case-insensitive and matches across `model`, `providerId`, `providerLabel`, `status`, `timestamp` (ISO + locale-formatted), `durationMs`, `totalTokens`, `promptTokens`, `completionTokens`, `estimatedCost`, and the `estimated`/`usage` source tag. The custom date range and the text search apply on top of the existing preset time filter. The preset buttons and the custom-date range are mutually exclusive: clicking a preset (All / 1h / 24h / 7d / 30d) clears the From / To inputs, and typing a custom date deactivates the active preset. The "By model" panel uses the same filters AND additionally includes a model whose name (lowercased) contains the search needle, even when no individual field of the entries does. The `buildDashboardHtml` signature gains an optional 4th `versions` parameter (`{ gateway?, extension? }`) so the 1.4.x callers that do not pass versions keep working unchanged. `GatewayService` exposes a `bundledVersion` getter for the header.

### Tests

- 453 tests across 26 files (was 420 / 25 in 1.4.1).
- New file `tests/telemetry-persistence.test.ts` (24 tests): the lock primitive (free acquire, held, symlink refused, stale mtime reaped, fresh mtime not reaped, mkdir-recursive, null handle release), `TelemetryPersister.loadSync` (missing / valid / corrupt / wrong-shape), `TelemetryPersister.appendDelta` (single, accumulated, idempotent, 50 parallel writers, no lost updates), `TelemetryPersister.saveFull` (overwrite) and `clear` (empty snapshot), and the `TelemetryStore` integration (`record()` schedules an `appendDelta` exactly once, `refreshFromDisk()` swaps the in-memory state for the on-disk state, `restore(undefined)` loads from the persister, `appendDelta` errors are caught and logged, 50 parallel `record()` calls do not lose updates).
- `tests/dashboard.test.ts` (+9 tests, 25 -> 34): gateway version in the badge, "Current version: vX.Y.Z" subtitle, collapsible header per panel, `panel-body` wrapper, collapse toggle handler with `localStorage` persistence, two `<input type="date">` + one `<input type="search">`, the client-side filter logic (`filterByCustomDate`, `entrySearchHaystack`, `matchesSearch`) and the input event wiring.

### Notes

- **Data location change**: pre-1.5.0 telemetry lived in the VS Code internal SQLite (`globalState` slot `aiflowbridge.telemetry.v1`); 1.5.0+ lives in `<globalStorageUri>/telemetry.json`. The migration runs once on the first activation after the upgrade and clears the legacy slot. To inspect / back up your metrics: open the Output channel (`AIFlowBridge: Show logs`) and look for the `[AIFlowBridge] Migrating telemetry from globalState to ...` line, which prints the file path; the same path is logged on every subsequent `AIFlowBridge: Refresh metrics` (under `[Telemetry]` debug lines). The file is plain JSON.
- **Concurrent access is managed**: when two VS Code windows are open at the same time, the second one joins the first as a "follower" (the gateway is a singleton, port-bound). The follower's `Refresh metrics` button reads the latest on-disk state and updates its in-memory view. The leader is the only writer; the follower does not write. This is what makes the cross-window shared metrics correct without a distributed lock manager.
- **Historical costs are still frozen** after a pricing change (per-request `RequestTelemetry.estimatedCost` is computed at request time and never recomputed). Only the rate displayed in the tooltip / pricing column updates, and only new requests use the new rate. Use `AIFlowBridge: Reset metrics` to start over with the new rate.
- The dashboard's preset time filter buttons (All / 1h / 24h / 7d / 30d), the custom date range, and the text search can all be combined: the resulting list is the intersection of all active filters. Empty inputs / no range selected = no constraint.

## 1.4.2

Patch release: restores CI on Linux/macOS runners, fixes `vsce publish` / `vsce package` missing-entrypoint, and silences a noisy `getUserModels()` warning.

### Fixed

- **CI: hardcoded Windows path in 3 test files broke `npm test` on Linux/macOS since v1.4.0.** When the static `MODELS` / `DEFAULT_PROVIDER_URLS` imports were removed in v1.4.0, three test files started loading the bundled registry directly from disk with a hardcoded absolute path to the developer's local checkout:
- **`getUserModels()` printed a useless `console.warn` on every invalid entry.** The previous message (`[AIFlowBridge] Skipping invalid userModels entry: missing required field (id/name/family/version)`) didn't say which entry was invalid, fired via `console.warn` (bypassing the VS Code Output channel and polluting `npm test` / `npm run package` output 6 times per run), and listed all four fields as missing even when only one was.
  - Fix: switched to `logger.warn` (so the message goes to the AIFlowBridge Output channel instead of stdout), and made the message actionable:

## 1.4.1

Patch release: closes BUG10 and BUG08

### Fixed

- BUG08: [image not analysed](https://github.com/LaurentOngaro/AIFlowBridge/issues/1)
- **BUG10 root cause #1 - synthesis discarded the per-model `pricing` from the registry**: `synthesizeProviderForModel` in `src/aiflowbridge/config.ts` always set `pricing: familyPricing.get(family)`, throwing away the merged registry's per-model `pricing` and substituting the hardcoded indicative rate from `DEFAULT_GATEWAY_PROFILES`. The function's `model` parameter was even typed without a `pricing` field. Same issue for the hand-curated `buildDefaultGatewayProfiles` (`entry.pricing` was used verbatim with no fallback to the registry). The 3-tier merge in `loadModelRegistry` was propagating the new value correctly, but the gateway `ProviderProfile` builder was overwriting it.
  - Fix: `synthesizeProviderForModel` now accepts a `pricing?` field and applies the precedence `model.pricing` (registry, possibly user-overridden) **>** `familyPricing.get(family)` (indicative default). `buildDefaultGatewayProfiles` now does `entry.pricing ?? toProviderPricing(registryEntry?.pricing)`, so hand-curated entries like `deepseek-flash` (which had no `entry.pricing`) now also pick up the bundled or user-overridden rate.
  - A new `toProviderPricing` helper centralises the `ModelPricing` (registry shape, all required) to `ProviderProfile["pricing"]` (all optional) conversion.
  - `getUserModels()` in `src/config.ts` now also accepts an optional `pricing` block on user-declared models, with a `parseUserModelPricing` helper that mirrors the registry's constraints. User-declared custom models with their own pricing block now propagate through `synthesizeProvidersFromUserModels` correctly.
  - Regression tests: `tests/aiflowbridge-config.test.ts` - "attaches the per-model bundled pricing from the registry", "picks up the per-model pricing from a globalStorage / workspace override (T3 regression)", "falls back to the family-level indicative pricing when a model in the registry has no pricing". The old assertion that `deepseek-v4-flash` had no pricing (which had been locking the bug in place) is replaced with the real bundled values `{ inputPerMillion: 0.27, outputPerMillion: 1.1, currency: 'USD' }`.
- **BUG10 root cause #2 - the validator rejected partial override entries**: `validateModelEntry` ran in `'strict'` mode for **all** three tiers, including the globalStorage and workspace overrides. In strict mode every field is required (`name`, `family`, `version`, `detail`, `maxInputTokens`, `maxOutputTokens`, `requiresThinkingParam`, `capabilities`). The user (correctly) writes a minimal override - just `id` + `pricing` - which was silently dropped with a `[AIFlowBridge] Skipped invalid model entry "..." in globalStorage model registry: missing/invalid "name"` warning. The 3-tier merge then fell back to the bundled entry (with the old pricing) and the dashboard never changed.
  - Fix: `validateModelEntry` now accepts a `mode: 'strict' | 'partial'` parameter. In `'partial'` mode (used for `globalStorage` and `workspace` tiers) only `id` is required; other fields are validated **if present** and an invalid value still rejects the entry (no silent acceptance of `pricing: { inputPerMillion: -1 }`). The returned shape is `Partial<RegistryModelDefinition>`, composable over the lower-priority entry via `deepMergeModel`. `validateRegistryContent` propagates the mode. `mergeTiers` is now documented with the invariant that the first non-empty tier is the bundled (strict) one, so the first map insertion is always complete.
  - Regression tests: `tests/modelRegistry.schema.test.ts` (6 new) - partial mode accepts `id` + `pricing` only (the canonical T3 user scenario), accepts `id` only (workspace-only model), still requires `id`, still rejects unknown family, still rejects invalid pricing, rejects non-object. `tests/modelRegistry.test.ts` (2 new) - end-to-end "accepts a partial globalStorage override that only changes pricing (T3 regression)" and "still rejects an invalid pricing in a partial override".
- **BUG10 root cause #3 - dashboard refresh re-rendered stale tooltips**: `showMetricsDashboard` accepted an `AiFlowBridgeConfig` (captured by closure at panel-creation time) and reused it for the in-place "Refresh" button. After a window reload with a new pricing override, the panel's `getConfig` was still the old one - so the rate tooltips and the `Pricing` column kept showing the pre-reload rates until the panel was closed and reopened. The historical `RequestTelemetry.estimatedCost` is intentionally frozen (semantically a "fact at the time of the request"); only the displayed rate is dynamic.
  - Fix: `showMetricsDashboard` now takes a `ConfigGetter: () => AiFlowBridgeConfig` instead of a captured config. The runtime (`src/aiflowbridge/index.ts:138-144`) passes `() => this.config`, so the refresh handler always reads the current `this.config` (which `loadConfig()` re-evaluates on every activation). The panel's `currentPanel.webview.html` is now regenerated from the live config on every refresh button click.

### Added

- **Diagnostic logging at activation** (developer aid, not user-facing): every activation now logs the resolved model registry and the synthesized gateway provider list to the AIFlowBridge output channel. This was added to make T3 reproducible: a single reload shows the exact file paths being read (`bundled` / `globalStorage` / `workspace`), which tiers exist (`exists=true/false`), the pricing for every model in the merged registry, and the pricing for every synthesized provider. The line `source=aiflowbridge.providers (raw user config)` is the smoking gun when an existing `aiflowbridge.providers` setting short-circuits the synthesis. 20+ lines per activation, easy to grep, cheap to keep.

### Notes

- **`aiflowbridge.providers` in `settings.json` wins over the registry override** for entries that have the same `id` or `model`. This is by design (the user explicitly set the pricing there), but it is the most common reason T3 looked broken during testing: the synthesis only **adds** new entries for models not already covered, it never modifies the user-configured ones. The diagnostic logging added in 1.4.1 makes this case obvious - the line `source=aiflowbridge.providers (raw user config)` flags it immediately. To get the registry override to take effect, either remove the `aiflowbridge.providers` section or set the new pricing directly on the user-configured entry.
- **Historical costs stay frozen** after a pricing change (per-request `RequestTelemetry.estimatedCost` is computed at request time and never recomputed). Only the rate displayed in the tooltip / pricing column updates, and only new requests use the new rate. The total `Estimated cost` at the top of the dashboard is the sum of frozen per-request costs, so it still mixes old and new rates - use `AIFlowBridge: Reset metrics` to start over with the new rate from scratch. This is a deliberate semantic choice (cost = historical fact, rate = current configuration).

## 1.4.0

Minor release: version-aware cooperative restart for the local gateway. Fixes a long-standing dev-experience issue where reloading the extension while a previous gateway was still running would silently reuse the stale instance.

### Fixed

- BUG10: prices are not updated on metrics
- BUG09: "Edit model registry" fails

### Added

- **`GET /version`** on the gateway, returning `{ name, version, pid, startedAt }`. When the configured port is already in use, the new activation probes the peer:
  - **Same or newer version** → join the peer silently (legacy singleton behaviour, no UI).
  - **Older version** → show a non-modal information message with two buttons: `Restart with vX.Y.Z` (cooperative shutdown of the peer, then bind) and `Keep current version` (join the peer as before). If the user dismisses the prompt, the default is to **join** (no surprise behaviour change).
  - **Port occupied by a non-gateway service** → log a warning, no prompt, let the bind fail loudly. The peer is **never** asked to shut down unless it identifies itself as `aiflowbridge-gateway`.
  - **Port occupied by another named service** (`name !== "aiflowbridge-gateway"`) → same as above: log a warning, no prompt, no shutdown.

- **`POST /shutdown`** endpoint on the gateway, used internally by the version-aware restart flow. The server binds on `127.0.0.1` only, so the endpoint is reachable only from the local machine. The handler logs the peer IP, sends `{ ok: true }`, then closes the listening socket. We intentionally do **not** call `process.exit(0)`: the gateway runs inside the VS Code extension host, and killing that process would also kill every other extension the user has installed. Endpoints `/version` and `/shutdown` are deliberately excluded from the telemetry counters.

- **New helpers in `src/aiflowbridge/gateway/probe.ts`** (all pure functions, no VS Code dependency):
  - `peerControlUrl(port)` - hard-coded loopback URL builder, used for both the probe and the shutdown request. Deriving the URL from the configured port (not from the user-configurable `aiflowbridge.gateway.baseUrl`) prevents SSRF via a hostile setting value.
  - `probeServerVersion(port, { timeoutMs })` - `fetch /version` with `AbortController`. Returns `null` on timeout or non-2xx.
  - `requestPeerShutdown(port, { timeoutMs })` - `POST /shutdown`. Never throws (logs and returns `false` on error).
  - `waitUntilPortFree(port, { timeoutMs, intervalMs })` - polls the port until `ECONNREFUSED` or timeout. Needed because Windows can keep a port in `TIME_WAIT` for a few seconds after the listening socket closes.
  - `compareSemver(a, b)` - hand-rolled `<0 / 0 / >0` for `MAJOR.MINOR.PATCH` (ignores prerelease tag for v1, so `1.4.0-beta.1` is treated as `1.4.0`).
  - `isPortInUse(port)` - shared TCP-connect probe (exported, single source of truth). Handles `'timeout'`, `'error'`, and `'connect'` events; destroys the socket on all non-connect paths.

- **New helpers in `src/aiflowbridge/gateway/lock.ts`**: `acquireGatewayLock(path)` / `releaseGatewayLock(handle)`. Returns a discriminated result (`{ ok: true, handle } | { ok: false, reason: "held" | "not-acquirable", error? }`). Refuses to follow a symlink at the lock path (mitigates an arbitrary-file-creation primitive that would otherwise be available to a co-installed malicious extension). Creates the parent directory with `mkdirSync({ recursive: true })` if missing. The lock has a **30s mtime-based stale reaper**: a lock file older than 30s is treated as orphaned (the previous activation crashed between `acquire` and `release`), deleted, and acquisition is retried once. Acquired in `lifecycle.ts:activate()`, released in `deactivate()`. **The lock is enforced, not just logged**: only the lock-owning activation may start the gateway, so two concurrent activations can no longer both probe the peer and both POST `/shutdown` (the ping-pong scenario the lock was added to prevent).

- **`GatewayService` constructor** now takes an optional `bundledVersion: string` (defaults to `"0.0.0"`) and an optional `userPrompt: UserPrompt` (defaults to a lazy `vscode.window.showInformationMessage`). The runtime passes `context.extension.packageJSON.version` to the former. The latter is what makes the version-aware flow unit-testable without a VS Code window.

- **User-facing error on restart-timeout** (per the plan's "erreur claire avec le PID"): when the user picks "Restart" and the peer never frees the port (Windows TIME_WAIT, hung peer), `handleOccupiedPort` throws an `Error` with `code: "EPEERSTALLED"` and `peerPid: number`. The runtime (`src/aiflowbridge/index.ts`) catches it and shows a warning message that includes the old PID and a hint to wait for TIME_WAIT or kill the process manually.

### Changed

- **`src/aiflowbridge/gateway/server.ts`**:
  - The startup flow now routes through a new `private async handleOccupiedPort()` method (extracted from `start()` for readability and testability). Returns a structured `HandleOccupiedPortResult` so the runtime can branch on `joined` / `proceed-bind` / `restart-failed`.
  - The legacy `isGatewayReachable(baseUrl)` helper (which probed `/health` and checked `service === "AIFlowBridge"`) is gone. The new probe is `probeServerVersion(port)` and checks `name === "aiflowbridge-gateway"` (a stable string, not a translatable UI label).
  - `handleRequest` adds two new routes at the very top, before `/health` and the rest: `GET /version` and `POST /shutdown`. Both refuse to record telemetry hits.
  - `isPortInUse` is no longer duplicated; it lives in `probe.ts` and is re-exported from `server.ts` for backward compatibility.
- **`src/aiflowbridge/index.ts`** passes `this.context.extension.packageJSON.version` to the `GatewayService` constructor (was previously only logged at the end of `activate()`).
- **`src/runtime/lifecycle.ts`** acquires the gateway lock at the very beginning of `activate()` (before the registry is loaded, so the lock is held as briefly as possible across the rest of activation) and releases it in `deactivate()`. The lock result is now a discriminated union: a "held" lock (peer activation or stale from a previous crash) or a "not-acquirable" lock (I/O failure, symlink refused, ...); each is logged differently. **Only the lock-owning activation calls `activateAIFlowBridge(context)`** - the other activation logs and continues without starting a gateway, which is what actually prevents the ping-pong loop.

### Tests

- 407 tests across 25 files (was 370 / 22 in 1.3.0). New test files:
  - `tests/gateway-version.test.ts` (21 tests): `compareSemver` edge cases (12 cases including prerelease, missing segments, non-numeric, 0.0.0), `probeServerVersion` (success / invalid payload / unreachable), `requestPeerShutdown` (success / unreachable), `waitUntilPortFree` (free / freed mid-poll / timeout).
  - `tests/gateway-restart.test.ts` (9 tests): end-to-end cooperative restart scenarios. Uses a fake peer HTTP server and a stubbed `UserPrompt`:
    - same version → join silently, no prompt, no shutdown
    - newer version → join silently, no prompt, no shutdown
    - older version + user keeps → join, no shutdown
    - older version + user dismisses → join (default), no shutdown
    - older version + user restarts → bind fresh instance + peer receives `POST /shutdown`
    - port occupied by a foreign service → no prompt, listen fails
    - peer named differently → no prompt, listen fails
    - `GET /version` returns the expected JSON shape (`name`, `version`, `pid`, `startedAt`)
    - **restart-timeout throws `EPEERSTALLED` with peer PID** when the user picks "Restart" but the peer never frees the port (simulated with a peer that responds 200 to `/shutdown` but never closes)
  - `tests/gateway-lock.test.ts` (7 tests): free acquire, "held" on conflict, symlink refused (returns `not-acquirable`), missing parent dir is created, null-safe release, **stale-lock reaper** (lock file with mtime > 30s is reaped and acquisition retried), reaper respects a non-stale lock.
- `tests/gateway.test.ts` (updated): the legacy "singleton detection" test now probes `/version` (with `name: "aiflowbridge-gateway"`) instead of `/health` (with `service: "AIFlowBridge"`).

### Security notes

- The cooperative-restart control plane (`/version` + `/shutdown`) only ever talks to `http://127.0.0.1:<port>`, never to the user-configurable `aiflowbridge.gateway.baseUrl`. This is intentional: a malicious `.vscode/settings.json` pointing `baseUrl` at an internal service would otherwise turn the gateway probe + shutdown into an SSRF primitive. `peerControlUrl(port)` is the only URL builder used for these calls.
- `POST /shutdown` does not call `process.exit(0)`. The gateway runs inside the VS Code extension host, and killing that process would also kill every other extension the user has installed. The handler closes the listening socket; the extension host continues. The new activation (same process or new process) then binds the port.
- The gateway lock (`fs.openSync(path, 'wx')`) refuses to follow a symlink at the lock path. Without this check, a co-installed malicious extension could pre-place a symlink at `<globalStorageUri>/gateway.lock` targeting e.g. `~/.ssh/authorized_keys`, and the "lock acquisition" would create an empty file at the symlink target.
- `isPortInUse` has a proper `'timeout'` handler: a hung peer cannot keep `waitUntilPortFree` waiting past its own timeout.

### Notes

- The cooperative restart is a **dev-experience** fix: end users of the gateway see no change in the common case. The only new user-visible surface is the "Restart with vX.Y.Z?" prompt, which only appears when (a) a debug session is reloaded while the old gateway is still alive, OR (b) the user installs a new version of the extension over an old running one.
- **Stale-lock reaper** closes the "Lock non libéré sur crash" pitfall from the plan: if the extension crashes between `acquire` and `release`, the `.lock` file remains. The next activation with `mtime > 30s` reaps it and retries acquisition once. A healthy activation finishes well under 30s, so a stale lock is always an orphan.
- 6 manual test scenarios (`_helpers/MANUAL_TESTS_v1.4.0+.md`, MT01-MT06) are required to ship 1.4.0 - they validate the cooperative-restart UX in a real VS Code instance and cannot be automated.

## 1.3.0

Minor release: the canonical list of models and vendors is now an external JSON file, overridable without editing source or waiting for a release.

### Added

- **External model registry** (`FEAT2`): the canonical list of models and vendor defaults is now `resources/models.json` (bundled with the extension), overridable at two levels:
  - **globalStorage override** (`<globalStorageUri>/models.json`) - per-user
  - **workspace override** (`<workspaceFolder>/.vscode/aiflowbridge.models.json`) - per-project

  The three tiers are deep-merged in priority order bundled < globalStorage < workspace, per `model.id` and per `vendor` key. A field absent from a higher tier falls through to the lower tier, so a workspace override that only sets `pricing` keeps every other field from the bundled entry. A `model.id` or `vendor` key present only in workspace is preserved (lets you add a new model without touching the bundled file).

  The bundled file is the source of truth for what shows in the Copilot Chat picker (`vscode.lm` model list) and what gets auto-synthesized into the gateway catalog. Per-model `pricing` blocks (USD per 1M tokens) live alongside the model definition - the family-level indicative rates that used to be hardcoded in `src/aiflowbridge/config.ts` are now derived from the registry.

- **`resources/models.schema.json`**: JSON Schema Draft 2020-12 description of the registry file, referenced from `models.json` via `$schema`. VS Code's built-in JSON language server uses it to provide autocompletion, hover help, and inline validation while editing. Covers the root shape, the `vendors` map, the `models` array, capability flags (`toolCalling` accepting `boolean | non-negative integer`), and the `pricing` block (USD only).

- **Two new Command Palette commands** to manage the registry without leaving VS Code:
  - `AIFlowBridge: Edit model registry` - opens `<globalStorageUri>/models.json` in the editor. If the file does not exist yet, it is created by copying the bundled registry (so the user has a valid starting point with the `$schema` reference and all required fields). Edits take effect on the next window reload.
  - `AIFlowBridge: Reset model registry to bundled defaults` - asks for confirmation, deletes the globalStorage override, and offers to reload the window so the bundled defaults take effect immediately.

### Changed

- **Architecture cleanup**: `src/consts.ts` is now 50 lines (was 202). It only carries truly static, never-edited constants (`API_KEY_SECRETS`, `CONFIG_SECTION`, `WALKTHROUGH_ID`, ...). The `MODELS`, `DEFAULT_PROVIDER_URLS`, and `EXTERNAL_URLS` compile-time constants are gone - their data is in the registry, read at activation via `loadModelRegistry(context)`.
- **Providers** (`src/provider/index.ts`, `minimax.ts`, `xiaomi.ts`, `base.ts`, `unified.ts`, `request.ts`) read their model and vendor data from the registry cache (`getLoadedRegistry()`), not from a `const MODELS` import. The cache is populated by `loadModelRegistry(context)` at activation, before any provider or command is registered.
- **`loadConfig` is now async** (`src/aiflowbridge/config.ts:loadConfig(context)`): it awaits the registry, then derives the gateway catalog from `registry.vendors` and `registry.models`. The four synthesis helpers (`buildDefaultGatewayProfiles`, `synthesizeProviderForModel`, `synthesizeProvidersFromBuiltInModels`, `synthesizeProvidersFromUserModels`) take the `ModelRegistry` as a parameter, which makes them pure and unit-testable without touching the cache.
- **Replays, client errors, and the "add custom model" command** also read from the registry. Two module-level constants that depended on a synchronous `MODELS` lookup at import time are now lazy getters (`getReplayMarkerPrefixes()` in `src/provider/replay/consts.ts`, `getApiProviderHttpErrorLinks()` in `src/client/consts.ts`) that resolve on first use, after the registry cache is populated.
- **Registry loading is idempotent** (bug fix discovered while writing the loader tests): a second call to `loadModelRegistry(context)` from inside `loadConfig` (called from `AIFlowBridgeRuntime.activate()`) used to silently re-read the bundled file from disk and overwrite the cache. It now consults the cache first. This means activating with the globalStorage override does one disk read for the bundled, one for the override, and zero for the second call from `loadConfig`. Editing the globalStorage file at runtime still requires a window reload (planned in v1).

### Tests

- 370 tests across 22 files (was 320 / 20). Two new test files:
  - `tests/modelRegistry.schema.test.ts` (~33 tests): hand-rolled validator coverage. Fail-hard structure checks (root, version, models array, vendors object), fail-soft content checks (model entry: id / name / family / version / detail / token counts / capabilities / pricing; vendor entry: baseUrl / apiKeySecret / externalUrls; family must be one of `deepseek`, `minimax`, `xiaomi`; `toolCalling` accepts `boolean | non-negative integer`; pricing currency must be `USD`; etc.), field helpers (`nonEmptyString`, `booleanField`, `positiveInt`, `nonNegativeNumber`, `toolCallingField`), and the three deep-merge primitives (`deepMergeModel`, `deepMergeVendor`, `mergeTiers`).
  - `tests/modelRegistry.test.ts` (11 tests): 3-tier merge with a fake `vscode.workspace.fs`, including override-only models, override-only vendors, deep-merged vendor `externalUrls`, cache idempotency, fatal structure error on the bundled tier, soft-fail structure error on an override tier, and content-error dropping with logger warnings.
- `tests/aiflowbridge-config.test.ts`, `tests/config.test.ts`, and `tests/xiaomi.test.ts` updated to seed the registry cache (`setLoadedRegistry(bundledRegistry)`) in `beforeAll`, since they no longer import `MODELS` / `DEFAULT_PROVIDER_URLS` from `src/consts.ts`.
- Mock strategy: `tests/modelRegistry.test.ts` uses a minimal `vi.mock('vscode', ...)` shim that exposes `Uri.joinPath` (returning a Uri-like with `toString()`), `workspace.fs.readFile`, and `window.createOutputChannel` (for the logger). The shim is hoisted via `vi.hoisted` so it can be referenced from inside the factory function. Both default-import (`import vscode from 'vscode'`, used by the logger) and namespace-import (`import * as vscode from 'vscode'`, used by the loader) shapes are supported by setting `mock.default = mock`.

## 1.2.2

Patch release: one bug fix for user-added models.

### Fixed

- **User-added models fail to resolve their vendor API key** (BUG07): the gateway was rejecting every chat request sent to a model added via `AIFlowBridge: Add a custom model` with the upstream's 401 "Please carry the API secret key" error. The vendor resolver was using a **case-sensitive** comparison (`vendor === "minimax" || vendor.startsWith("minimax-")`), which:
  - failed on the upstream-style camelCase id of MiniMax user-added models (`MiniMax-M3`, `MiniMax-M2.7`), and
  - failed for **every** Xiaomi user-added model because the upstream uses a different prefix (`mimo-` for MiMo, while the default vendor id is `xiaomi`).
    The resolver is now case-insensitive, accepts upstream-style aliases, and explicitly knows about the `mimo-` → `xiaomi` mapping. The matching logic was extracted to `src/aiflowbridge/api-key-resolver.ts` so it is unit-tested in isolation. `selectProvider` was already case-insensitive on the model id, which is why routing worked but key resolution didn't.
- **`Cannot read properties of undefined (reading 'globalState')` on activation** (BUG06): the gateway's `loadState()` callback used to fire from inside the `GatewayService` constructor, but the `AIFlowBridgeRuntime` passed an arrow function that closed over `this.context`. TypeScript class field initializers run **before** the parameter property assignment, so `this.context` was `undefined` when the constructor called the callback. The fix is a small refactor: `GatewayService` no longer auto-wires persistence in its constructor. It now exposes an `init()` method that the runtime calls from its constructor body, after `this.context` is set. `init()` is idempotent, so multiple calls are safe. The activation warning `[Gateway] Failed to restore persisted telemetry: ...` is gone, and the cumulative metrics now load correctly on the first activation after install.

### Changed

- Small README content changes.

### Tests

- 301 tests across 20 files (was 292). New file `tests/api-key-resolver.test.ts` (9 tests): default id matching, camelCase id, `DEEPSEEK` uppercase, unknown vendor, ambiguous prefix, missing secret, throwing `secrets.get()`, sync thenable, and the regression test for `MiMo-V2.5-PRO` → xiaomi.
- Existing persistence tests updated to call `service.init()` after construction, and to assert that `loadState` is **not** called by the constructor alone.

## 1.2.1

Patch release: documentation only, no code changes.

### Fixed

- **README badges for the VS Code Marketplace** (DOC03): the previous `visualstudio-marketplace/i/...` and `visualstudio-marketplace/d/...` shortcuts on shields.io were not real endpoints (shields.io has had unreliable VS Marketplace scraping since Microsoft changed their API). Replaced with the dedicated `vsmarketplacebadge.apphb.com` service for version, installs, and downloads. The GitHub stars / license / CI / release / sponsor badges continue to use shields.io, which is reliable for GitHub metadata.

### Documentation

- **README "What the metrics dashboard actually tracks"** (DOC02): new section under "Demo" explaining that the dashboard tracks **gateway-served requests only** (Kilo Code, Continue, Open WebUI, curl, OpenAI SDK pointed at `http://127.0.0.1:8787/v1`, etc.) and **not** prompts sent from Copilot Chat. Includes a comparison table of the two integrations (entry point, provider implementation, telemetry), the structural reason (VS Code's `vscode.lm` API is push-only, the gateway is a regular HTTP server with full request/response metadata), and a quick `curl` test for verification. The "Example workflow" was rewritten to use Kilo Code (the gateway path) rather than Copilot Chat, so the example matches the explanation.
- **README audit**: fixed several factual errors that had drifted in during the 1.2.0 cycle. The README now reflects the actual code and behavior:
  - **Tagline** (l.17, 39) reworded to "the extension is free, ad-free, tracker-free; you pay the upstream providers directly for model usage" - the models are not free.
  - **Kilo Code example** (l.301) now uses real upstream API ids: `deepseek-v4-flash`, `mimo-v2.5-pro`, `MiniMax-M3`.
  - **`/health` response shape** in Troubleshooting now shows the full payload (`{ok, service, status}`) instead of the truncated `{ok, service}`.
  - **Providers table** clarifies which models have **native** vision (`MiniMax M3`, `Xiaomi MiMo V2.5`) vs go through the vision proxy (everything else).
  - **Architecture tree** refreshed to include `token-counter.ts` (added in 1.2.0), the `gateway/` subdirectory, and the `tools/` / `replay/` / `debug/` / `segment/` subdirectories of `src/provider/`. The `runtime/addCustomModel.ts` path is now correct.
  - **Commands table** updated with the new 1.2.0 commands: `AIFlowBridge: Reset metrics`, `AIFlowBridge: Add a custom model`, `AIFlowBridge: Open request dumps folder`, `DeepSeek: Set vision proxy model`.
  - **Troubleshooting** gains three new entries: 404 from the gateway (BUG05), `Metrics are empty after restart` (gateway vs Copilot explanation), and the `Reset metrics` command.
  - **Settings** has a new "Models" section documenting `aiflowbridge.userModels` and its interaction with the gateway.
  - **Roadmap** synced with `TODO.md`: removed the invented "OpenCode / Claude Code adapters" entry, added the real next-up items (telemetry export, more agentic adapters, more providers, custom upstreams, token streaming diff).
  - **"Why sponsor?"** section uses the **real** GitHub Sponsors tiers ($4 / $12 / $30) verified against `github.com/sponsors/LaurentOngaro`, with an honest callout that the tiers are global to the maintainer's body of work (including TerraBloom), not AIFlowBridge-specific.
  - **Cost comparison** rewritten to drop marketing fluff and explain what AIFlowBridge actually affects (free Copilot vision, no markup, accurate token counting) vs what it does not (no upstream discounts, no free trials).

## 1.2.0

### Added

- **MiniMax accurate token counting** (API01): the gateway now calls MiniMax's upstream `/v1/responses/input_tokens` endpoint in parallel with chat requests when the provider is identified as MiniMax. The returned `input_tokens` replaces the `length / 4` heuristic in both streaming and non-streaming paths, improving cost estimation accuracy in the dashboard.
- **Dashboard - timestamp column on Recent requests** (AFF01): each row in the "Recent requests" table now shows a local-time clock (HH:MM:SS) with the full timestamp in the cell's tooltip. The column is filterable along with the rest of the table.
- **Dashboard - time filters & by-model breakdown** (AFF02): the "Recent requests" and the new "By model" tables are filterable by time range (All / Last 1h / Last 24h / Last 7 days / Last 30 days). The "By model" panel groups requests, tokens, and errors per model ID with the same filters. Client-side filtering is instant and works without re-fetching the snapshot.
- **Dashboard - manual Refresh button**: a refresh button now sits to the right of the dashboard title. Clicking it sends a `refresh` message to the extension, which re-reads the latest gateway snapshot and re-renders the webview. The button spins briefly while the new HTML is being generated, with a 1.5 s safety timeout that removes the spin class even if the page does not reload. The dashboard now accepts getter functions (`() => snapshot, () => isRunning`) instead of fixed values, so the refresh always reflects the current state.
- **Persistent metrics across restarts**: the gateway telemetry (totals, by-provider / by-model breakdowns, last 20 recent entries) is now persisted in VS Code `globalState` under `aiflowbridge.telemetry.v1` and restored on the next activation. Writes are debounced 1 s. The persisted state survives extension reloads, VS Code restarts, and debug sessions, so cumulative counters no longer reset to 0.
- **New `AIFlowBridge: Reset metrics` command**: clears the cumulative counters and the persisted state. Asks for confirmation before wiping.

### Fixed

- **`AIFlowBridge: Add a custom model` no longer fails with "is not a registered configuration"** (BUG03): the command now tries to persist `aiflowbridge.userModels` to the User settings first, and falls back to the Workspace settings target if the User target is not yet initialized. This resolves the common case where the extension is run in a fresh VS Code profile with no user-level `aiflowbridge` block.
- **User-declared models are now exposed by the local gateway** (BUG04): previously, models added via `AIFlowBridge: Add a custom model` (or written directly to `aiflowbridge.userModels`) appeared in the Copilot Chat picker but were missing from `GET /v1/models`, so OpenAI-compatible clients like Kilo Code and Continue could not see or use them. The gateway now synthesizes a virtual `ProviderProfile` for each user model with a known `family` (deepseek / MiniMax / xiaomi), so the model is included in the catalog and routed correctly by `selectProvider`. Duplicates with existing gateway profiles are skipped.
- **Gateway no longer silently routes to the wrong provider** (BUG05): `selectProvider` used to fall back to the first enabled provider when the requested model did not match any provider's `id`, `model`, or `label` aliases. This caused a request for `"mimo-v2.5"` to be silently routed to the DeepSeek V4 Flash upstream (which would rewrite the body to `"deepseek-v4-flash"`) while the dashboard labelled the row as `Provider: DeepSeek V4 Flash, Model: mimo-v2.5` - making it look like DeepSeek had answered a MiMo call. The gateway now returns a 404 listing the available provider ids, and `selectProvider` returns `undefined` on no match (the gateway has a separate 503 path for "no providers configured at all").

### Documentation

- **README "Demo" section** (DOC01): added a 3x3 screenshot grid covering the metrics dashboard, Copilot and Kilo Code model pickers, the vision proxy in action, gateway health and metrics endpoints, the output log, and the settings pages. Screenshots are stored in `resources/screenshots_v1.1.1/`.

### Tests

- 291 tests across 19 files (was 247/15). New files:
  - `tests/token-counter.test.ts` (6 tests) - MiniMax `/input_tokens` call: success, non-2xx, malformed body, custom base URL, empty API key, network error.
  - `tests/aiflowbridge-config.test.ts` (9 tests) - user-model synthesis into the gateway provider list: empty input, single model, duplicate skip, unknown family skip, multi-vendor, ordering, and integration with `selectProvider` + `buildModelCatalog`.
  - `tests/dashboard.test.ts` (10 tests) - metrics dashboard HTML builder: status badge, totals, recent table, by-model panel, per-provider summary, refresh button placement + safety net, time filter buttons, embedded JSON, empty state, and HTML escaping in cells.
  - `tests/telemetry-store.test.ts` (12 tests) - `TelemetryStore`: record / snapshot aggregation, recent cap at 20, restore() round trip, restore(undefined) clear, cumulative record after restore, subscribe + unsubscribe, listener exception isolation, reset(), snapshot→restore identity.

### Notes

- The dashboard tracks **gateway-served requests** (any request that hits `POST /v1/chat/completions` on the local proxy: Kilo Code, Continue, Open WebUI, the OpenAI Python SDK pointed at `http://127.0.0.1:8787/v1`, etc.). Requests made through Copilot Chat go directly to the upstream provider via the language model provider APIs and are not routed through the gateway, so they will not appear in the dashboard. This is by design - the gateway is the OpenAI-compatible proxy; Copilot Chat uses VS Code's `vscode.lm` API.

## 1.1.1

### Documentation

- **README "Multi-Provider Support"**: full list of the 14 officially supported models (previously only 4 were listed) - DeepSeek V4 Flash/Pro, MiniMax M2/M2.1/M2.1 Highspeed/M2.5/M2.5 Highspeed/M2.7/M2.7 Highspeed/M3, Xiaomi MiMo V2 Omni/V2 Pro/V2.5/V2.5 Pro. Added a note clarifying the list is not exhaustive and pointing to `AIFlowBridge: Add a custom model` for adding other models.
- **README "Why AIFlowBridge?"**: refreshed the bullet list of providers with the full model lineup and added a callout pointing to the user-defined models flow.
- **AGENTS.md**: comprehensive update. Reflects the current file structure (adds `src/runtime/addCustomModel.ts`, `src/provider/vision/`, etc.), the new model id convention (`id` = upstream API id), the user-defined models flow, the test count (247 across 15 files), and notes about id translation removal.

### Notes

- No code changes; documentation only. Safe to upgrade.

## 1.1.0

### Added

- **`aiflowbridge.userModels` setting**: declare additional models in your `settings.json` (no extension update required). User-declared models are merged with the built-in registry.
- **`AIFlowBridge: Add a custom model` command**: walk through the Command Palette to fetch a vendor's `/v1/models`, pick a model, declare its capabilities, and save it to `aiflowbridge.userModels`. The fetched list is also logged to the output channel for inspection.
- **Auto-refresh**: the Copilot Chat model picker refreshes automatically when `aiflowbridge.userModels` is edited (no reload required).
- **New models in the built-in registry**:
  - MiniMax: M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3
  - Xiaomi MiMo: V2 Omni, V2 Pro
  - DeepSeek: V4 Flash, V4 Pro (already present, now with the same id convention as upstream)

### Changed

- **Model id convention**: `id` in `MODELS` (and in `aiflowbridge.userModels`) is now the **upstream API id** (e.g. `MiniMax-M2.7`, `mimo-v2.5`) instead of a kebab-case alias. This removes the translation map and the `resolveMiniMaxModelId` / `resolveXiaomiModelId` functions, which are now simple overrides. The human-readable name still shows in the Copilot Chat picker.

### Fixed

- **Xiaomi MiMo vision path**: the previous `hasNativeVision` check used a hardcoded `xiaomi-mimo-v2.5` id that would never match user-declared models. It now uses the upstream `mimo-v2.5` id directly.
- **`addCustomModel` command**: deduplicates models returned by upstream (some providers, e.g. MiniMax, return the same id twice).
- **Settings sync**: synchronized translation keys in `package.nls.json` and `src/i18n.ts` with the new model ids.

### Breaking

- The model id convention changed. Any pre-existing `aiflowbridge.providers.<vendor>.modelIdOverrides` keys using the old kebab-case ids (e.g. `minimax-v2.7`, `xiaomi-mimo-v2.5`) must be updated to the upstream ids (e.g. `MiniMax-M2.7`, `mimo-v2.5`).

## 1.0.2

### Fixed

- **Publish workflow**: switched from the third-party `HaaLeo/publish-vscode-extension` GitHub Action to the official `@vscode/vsce` CLI called directly. The `vsix` input was deprecated in v1.7.0 of the action, causing the previous run to fail. Direct `vsce publish` is the Microsoft-recommended approach and removes a third-party dependency.

## 1.0.1

### Added

- marketplace auto-publish CI workflow for new releases

### Documentation

- **TODO.md fully translated to English** - the repo is now unilingual for its public audience.
- **README badges**: replaced the old single badge with a professional set (Marketplace version, installs, rating, CI status, license).
- **README "Why AIFlowBridge?"**: new section comparing with alternatives and highlighting the local-first, multi-provider value proposition.
- **README "Demo"**: new section with a step-by-step example workflow and keyboard shortcuts.
- **README "Troubleshooting"**: covers the five most common issues (gateway port, API key, vision model, 401 auth, Kilo Code connectivity).
- **README "Privacy & Security"**: documents the local-first model (keychain, localhost-only, no remote telemetry).
- **README "Sponsoring"**: added with links to GitHub Sponsors (tiered: Community / Contributor / Supporter), Patreon, and Tipeee for the French-speaking community.
- **Marketplace description** rewritten for clarity and discoverability.
- **`CONTRIBUTING.md`**: new contributor guide with setup, code standards, provider/model addition workflow, and PR checklist.
- **`SECURITY.md`**: new security policy with supported versions, private disclosure process, and design notes.

### Polish

- **Keywords enriched**: added `copilot-chat`, `coding-assistant`, `openai-compatible`, `ollama`, `kilocode`, `continue`, `gpt`, `claude`, `agent-mode`, `language-model` for better marketplace discoverability.
- **SVG icon** added in `resources/icon.svg` alongside the existing PNG.
- **`.vscodeignore`** cleaned: removed references to deleted `.oxlintrc.json` and `.oxfmtrc.json`.

## 1.0.0

First stable release. AIFlowBridge brings DeepSeek, MiniMax, and Xiaomi MiMo into GitHub Copilot Chat with a local OpenAI-compatible gateway, transparent vision proxy, and usage metrics.

### Highlights

- **Multi-provider Copilot Chat**: DeepSeek V4 (Flash/Pro), MiniMax V2.7, Xiaomi MiMo V2.5/V2.5 Pro registered as native Copilot Chat model providers.
- **OpenAI-compatible gateway**: Local proxy on port 8787, with singleton detection across VS Code windows. Auto-routes Kilo Code, Continue, and any OpenAI-compatible client to the right upstream.
- **Transparent vision proxy**: All models expose the image-paste button in Copilot Chat. Images are converted to text descriptions by a configurable vision model, so even non-vision models can analyze attached screenshots and diagrams.
- **Metrics dashboard**: Per-provider, per-model request counts, tokens, latency, and estimated cost. Recent request history. Status bar indicator.
- **SecretStorage API keys**: All credentials live in the OS keychain, never in `settings.json`.

### Quality

- 237 unit tests across 13 test files (vitest)
- 0 TypeScript errors (`npm run compile`)
- 0 lint or format errors
- GitHub Actions CI: build, test, package, publish VSIX artifact
- Vision proxy, gateway singleton, and provider normalization fully covered

### Documentation & Community

- **Badges** in the README: VS Marketplace (version, installs, rating), CI status, license
- **New sections** in the README: "Why AIFlowBridge?", "Demo", "Troubleshooting", "Privacy & Security", "Sponsoring"
- **`CONTRIBUTING.md`**: setup, code standards, adding a provider/model, PR workflow
- **`SECURITY.md`**: supported versions, private disclosure process, security design notes
- **`TODO.md`**: fully translated to English for an unilingual public repo
- **Sponsoring section**: links to GitHub Sponsors (tiered: Community / Contributor / Supporter), Patreon, and Tipeee (FR community)

### Polish

- **Marketplace description** rewritten for clarity and discoverability
- **Keywords** enriched with `copilot-chat`, `coding-assistant`, `openai-compatible`, `ollama`, `kilocode`, `continue`, `gpt`, `claude`, `agent-mode`, `language-model`
- **Activation event** changed from `onStartupFinished` to `onLanguageModelChatProvider:aiflowbridge` (lazy activation; gateway starts only when actually used)
- **DeepSeek vision model command** (`aiflowbridge.providers.deepseek.setVisionModel`) now declared in `contributes.commands` for proper command palette integration
- **SVG icon** added in `resources/icon.svg` alongside the existing PNG (marketplace vector-friendly)
- **`.vscodeignore`** cleaned: removed references to deleted `.oxlintrc.json`/`.oxfmtrc.json`

### Upgrading from 0.x

**No breaking changes.** All settings, commands, and APIs from 0.x remain available. Internal renames (`setVisionProxyModel` → `chooseVisionProxyModel`, `TODO_TRACKER_PREFIX` → `BACKGROUND_TRACKER_PREFIX`) are not user-facing.

### Notes

- API keys are configured via the Command Palette (`DeepSeek: Set API Key`, `MiniMax: Set API Key`, `Xiaomi MiMo: Set API Key`).
- The gateway starts automatically when the extension activates. Disable it with `aiflowbridge.gateway.enabled: false`.
- See the README for the full configuration reference, gateway endpoints, and Kilo Code integration example.

## 0.6.0

### Fixed

- **CI GitHub Actions**: Removed broken `npm run lint` and `npm run format:check` steps that referenced uninstalled `oxlint`/`oxfmt` packages. Replaced with `npm test` as the quality gate. Renamed artifact from `deepseek-v4-for-copilot.vsix` to `aiflowbridge.vsix`.

- **Vision proxy model resolution**: Unified `getConfiguredVisionModelId()` and `getVisionModelId()` in `src/provider/vision/model.ts`. Vision model selection now uses a single fallback chain: configured ID → first `imageInput: true` model from `MODELS` → `DEFAULT_VISION_MODEL_ID`. Resolved Kilo Code "no vision model available" error when no `aiflowbridge.vision.kiloVisionModel` was set.

### Changed

- **i18n synchronization**: `package.nls.json` synchronized with `src/i18n.ts`. Added 25+ missing translation keys (auth, request, error.http._, error.action._, error.network.\*, extension, command) and unified punctuation/wording between the two files.

- **Vision settings cleanup**: Removed unused `aiflowbridge.vision.enabled` setting. The vision proxy is always-on (opt-out via `aiflowbridge.vision.excludedVendors`).

- **Documentation overhaul**:
  - `README.md`: Corrected providers table (all models use vision proxy, including DeepSeek and Xiaomi). Added 4 missing settings (`minimax.temperature`, `minimax.topP`, `minimax.reasoningSplit`, `xiaomi.reasoningRequiredForToolCalls`). Removed obsolete references to `aiflowbridge.vision.enabled` and `kiloVisionModel`.
  - `AGENTS.md`: Fully rewritten to reflect current file structure, provider registration (DeepSeek as `aiflowbridge` vendor), vision proxy selector + fallback chain, gateway singleton mode, and `vscode.LogOutputChannel` prefixed logging.
  - `TODO.md`: Empty "Bugs" and "Corrections immédiates" sections converted to structured placeholders. Cleaned up circular reference to `_helpers/PLAN_ACTIONS.md`.

- **Repository hygiene**: Added `.kilo/` to `.gitignore` and untracked `.kilo/plans/1779780240537-crisp-planet.md` (Kilo Code internal state).

## 0.5.1

### Changed

- **Code cleanup**: Removed duplicate `getConfiguredVisionModelId()` function in `src/provider/vision/model.ts` (was a byte-identical copy of `getVisionModelId()`). Unified on a single function used by both `createVisionModelGetter` and `setVisionProxyModel`.
- **i18n cleanup**: Removed unused translation keys `vision.proxyUsing` and `vision.notFound` from `src/i18n.ts` and `package.nls.json` (vestiges from the old code that used `t()` instead of the logger).

## 0.5.0

### Fixed

- **BUG01 - Image analysis in Kilo Code**: Removed the vision proxy for Kilo Code. Kilo Code has its own `read` tool that handles image analysis transparently - the vision proxy was unnecessary for MiniMax, MiMo, and DeepSeek via Kilo Code. The vision proxy is now only used for GitHub Copilot (where `provideLanguageModelChatResponse` handles image conversion via `oswe-vscode-prime`).
- **BUG02 - Port occupancy error message**: Improved error handling when the gateway fails to start on port 8787. The extension now distinguishes between "gateway already running" (info message), "port occupied by another service" (descriptive warning), and "actual failure" (error message).

### Added

- **Enhanced logging**: Added structured logging throughout the extension for better debugging:
  - `[AIFlowBridge]` prefix for core activation logs
  - `[Gateway]` prefix for gateway server logs
  - `[Vision]` prefix for vision proxy processing logs
  - `[MiniMax]` prefix for MiniMax provider logs
  - All logs use VS Code `LogOutputChannel` (viewable via `View > Output > AIFlowBridge`)

## 0.4.6

### Fixed

- Fixed Kilo Code "No enabled upstream provider" error: the gateway now auto-generates provider profiles (DeepSeek Flash/Pro, MiniMax, Xiaomi) from the extension's own settings when `aiflowbridge.providers` is empty.
- Fixed Kilo Code model name mismatch (`deepseek` → `deepseek-v4-flash`/`deepseek-v4-pro`): the gateway now overrides the model name in forwarded requests with the provider's actual upstream model name.
- Gateway API keys are now automatically resolved from VS Code SecretStorage when not set in provider profiles.

## 0.4.5

### Fixed

- Fixed Xiaomi MiMo V2.5 Pro image handling: native vision support is now determined by model ID rather than `imageInput` capability. The V2.5 Pro model correctly uses the vision proxy for image descriptions instead of sending images natively, which the Pro API does not support.

## 0.4.4

### Fixed

- Fixed image paste not available for MiniMax and Xiaomi MiMo V2.5 Pro models: set `imageInput: true` in model capabilities so Copilot Chat enables the paste-image button. The vision proxy transparently converts images to text descriptions for models without native vision support.

## 0.4.3

### Fixed

- Fixed `prepareForDeactivate` causing a `Canceled` warning on extension reload by removing the unnecessary `selectChatModels` call during deactivation.
- Fixed Xiaomi MiMo 401 error: changed the default base URL from the pay-as-you-go endpoint (`api.xiaomimimo.com/v1`) to the Token Plan Europe cluster (`token-plan-ams.xiaomimimo.com/v1`), which is the expected endpoint for `tp-*` API keys.
- Added Xiaomi regional Token Plan endpoint URLs to constants (Europe, Singapore, China) for reference.

## 0.4.2

### Fixed

- Improved error logging for provider HTTP errors: the response body from failed API requests is now captured and included in the error message for both MiniMax and Xiaomi providers, providing actionable diagnostic details.

## 0.4.1

### Fixed

- Fixed MiniMax API 400 error (`invalid params, function name or parameters is empty (2013)`) caused by tool definitions with empty names or missing parameters. Tools with empty/whitespace-only names are now filtered out, and a default empty `parameters` object (`{}`) is provided when `inputSchema` is undefined.
- Fixed MiniMax API 400 error caused by `reasoning_split` being incorrectly wrapped in `extra_body`. The MiniMax OpenAI-compatible API expects `reasoning_split` as a top-level parameter, not inside `extra_body` (which is an OpenAI Python SDK-only construct).
- Added temperature clamping for MiniMax provider (`(0.0, 1.0]` range) to prevent 400 errors from out-of-range values.

## 0.4.0

### Fixed

- Fixed `prepareForDeactivate` making an unnecessary `selectChatModels` call that caused a `Canceled` warning on extension deactivation.
- Fixed gateway port conflict when extension is activated in multiple VS Code instances. The gateway now detects if an existing AIFlowBridge gateway is already running on the default port and joins it instead of failing.

### Changed

- Gateway now operates as a singleton across VS Code instances: if the default port (8787) is already occupied by another AIFlowBridge instance, the new instance detects and reuses the existing gateway rather than starting a new one on a different port. This ensures Kilo Code and other OpenAI-compatible clients always find the gateway at the configured URL.

## 0.3.0

### Fixed

- Fixed TypeScript errors in test files (`deepseek-convert.test.ts`, `deepseek-error.test.ts`, `deepseek-classifier.test.ts`, `minimax.test.ts`, `xiaomi.test.ts`).
- Fixed `MockSecretStorage` class identifier conflicts and event emitter type issues in test helpers.
- Fixed tool description type compatibility (now requires non-optional `string`).

### Changed

- Implemented comprehensive unit tests for the Minimax provider, covering model ID resolution, tool argument parsing, tool call accumulation, message conversion, and error handling.
- Added tests for the error handling module, including ProviderRequestError creation and HTTP error normalization.
- Introduced Vitest configuration for running tests in a Node environment with appropriate timeouts and module resolution.
- Add unit tests for Minimax, Xiaomi, and error handling

## 0.2.0

This release marks the first AIFlowBridge line after the DeepSeek baseline.

### Added

- Multi-provider support for DeepSeek, MiniMax, and Xiaomi MiMo.
- OpenAI-compatible local gateway with request routing and telemetry.
- Usage metrics dashboard and status bar integration.
- Transparent vision proxy adapted for multiple providers.
- Provider API key commands and workspace-friendly management flows.
- Profile-aware local debug and install helpers.
- README updates for AIFlowBridge setup, commands, and packaging.
- MiniMax/Xiaomi provider parity improvements (tool calls, vision messages, and model ID mapping).

### Changed

- Rebranded the extension from the original DeepSeek-only identity to AIFlowBridge.
- Updated the manifest, packaging, and installation workflow for the multi-provider extension.

## 0.1.0 - DeepSeek baseline

This is the original DeepSeek foundation the project was forked from.

### Included

- DeepSeek V4 Pro & Flash in the Copilot Chat model picker.
- Thinking mode with multi-turn reasoning cache.
- Reasoning effort control (`high` / `max`).
- Vision proxy for image attachments.
- Tool calling with agent-mode support.
- Prompt cache statistics in the output channel.
- API key storage in VS Code `SecretStorage`.
- Configurable `baseUrl`, `maxTokens`, `visionModel`, and `visionPrompt`.
