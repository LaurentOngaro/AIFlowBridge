# Changelog

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

- **BUG11: [metric dashboard: requests in error have an estimated cost](https://github.com/LaurentOngaro/AIFlowBridge/issues/5).** `GatewayService.recordTelemetry()` (`src/aiflowbridge/gateway/server.ts:634-664`) now sets `estimatedCost = 0` whenever the recorded `status` is `>= 400` (4xx / 5xx upstream response, or the catch-block default of 502 when the upstream never responded). The request is still recorded (error count, per-provider / per-model usage, duration averages, per-row delete affordance) — it just no longer contributes to the "Estimated cost" totals. Cost is a fait historique: we never bill the user for a request that never produced a billable completion. The fix naturally propagates to the cumulative `TelemetryStore.snapshot()` (`applyEntryToSnapshot` / `applyEntryInMemory` just add `entry.estimatedCost` to the totals, so a zero-cost entry contributes nothing), to the on-disk file (the persister applies the same delta), and to the per-row delete path (`removeEntry` decrements under `Math.max(0, ...)` guards). 5 new regression tests in `tests/gateway.test.ts` (new "BUG11: errored requests have zero cost" describe block) cover: successful 200 (cost computed normally), 5xx upstream response (cost=0, errors=1, model usage still recorded), 4xx upstream response (cost=0, errors=1), unreachable upstream / catch block (statusCode=502, cost=0), and a mixed success/error sequence (only successful requests contribute to the total).

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

- **AFF03 plan-compliance corrections** (caught in a post-release audit of `_helpers/ACTION PLAN.md`):
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

- **CI: hardcoded Windows path in 3 test files broke `npm test` on Linux/macOS since v1.4.0.** When the static `MODELS` / `DEFAULT_PROVIDER_URLS` imports were removed in v1.4.0 (ACTION PLAN.md step 3), three test files started loading the bundled registry directly from disk with a hardcoded absolute path to the developer's local checkout:
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
- **Registry loading is idempotent** (bug fix discovered while writing the loader tests): a second call to `loadModelRegistry(context)` from inside `loadConfig` (called from `AIFlowBridgeRuntime.activate()`) used to silently re-read the bundled file from disk and overwrite the cache. It now consults the cache first. This means activating with the globalStorage override does one disk read for the bundled, one for the override, and zero for the second call from `loadConfig`. Editing the globalStorage file at runtime still requires a window reload (planned in v1, as documented in `ACTION PLAN.md` "Pièges à éviter").

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
