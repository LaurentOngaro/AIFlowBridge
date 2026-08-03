# Changelog

> NOTE:
> This file is written in Markdown and uses the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format.
> The version numbers are [Semantic Versioning](https://semver.org/spec/v2.0.0.html) compliant.
> This file must not contains internal audit-trail labels (`FEAT\d+`, `STU\d+`, `BUG\d+`, `SEC\d+`, `AFF\d+`, `REC\d+`, etc.).
> Tests results are not mentioned anymore because each release is tested on the CI pipeline and fail tests block the release.

## 2.15.5

### Documentation

- **Hero screenshot in the README.** The README now leads with a centered dashboard screenshot (`resources/screenshots_v2.15.5/01a_AIFB_dashboard_all_sections.png`) inserted between the "Why AIFlowBridge?" section and the "Features" section, giving casual readers a visual anchor before they dive into the bullet lists. The image is wrapped in `markdownlint-disable MD033` / `markdownlint-enable MD033` to allow the inline `<p align="center">` + `<img>` HTML, the same pattern already used for the project icon and the Sponsoring badges.
- **Screenshots gallery extracted from `docs/dashboard.md` to a dedicated `docs/screenshots.md`.** The previous gallery lived inside the dashboard doc as a 2x2 table; it has grown to 18 captures across three release folders (`resources/screenshots_v2.15.5/`, `resources/screenshots_v1.4.0/`, `resources/screenshots_v1.1.1/`) and warrants its own page. `docs/screenshots.md` is the canonical gallery now, grouped by release version in descending order, with a one-image-per-row `Description | Screenshot` table format that scales cleanly and a short "Adding new captures" section explaining the convention for future releases. `docs/dashboard.md` keeps a one-paragraph pointer to the new page. The README `## Documentation` table gained a `[docs/screenshots.md](docs/screenshots.md)` row so the gallery is discoverable from the top-level index.

## 2.15.4

### Changed

- **Test files are now type-checked as a first-class gate.** The root `tsconfig.json` only includes `src/`, so the test files under `tests/` were never type-checked by the compiler - vitest transpiles them without type checking, which let type regressions in tests (wrong field names, incompatible mocks, DOM-only lib types) slip into the editor and CI silently. A new `tests/tsconfig.json` (extends the root config, `types: ["node"]`, `noEmit`) is discovered by VS Code's TS server through the normal directory-walk (the same way the root config is found), so files under `tests/` are always assigned to it, and a new `npm run typecheck:tests` script runs it. It is wired into the `npm run package` gate so the release CI rejects test-type regressions just like it rejects `src` compile errors. 40 latent type errors across 5 test files were fixed as part of wiring this up (mock signatures in `tests/export-telemetry.test.ts`, the fake-fs `readFile` typing in `tests/modelRegistry.test.ts` + `tests/pricing-loader.test.ts`, a DOM-only `BodyInit` cast in `tests/gateway-bug17.test.ts`, and an import attribute incompatible with the `commonjs` module mode in `tests/integration/openrouter.smoke.test.ts`). The `/// <reference types="node" />` stopgap directives that used to be needed for `node:*` imports in the editor were removed - they are redundant now that `tests/tsconfig.json` provides the `node` types. (A root-level `tsconfig.test.json` matched only by `include` is not reliably picked up by the editor for file assignment, so the config lives inside `tests/` where directory-walk discovery guarantees it.)

## 2.15.3

### Fixed

- **Dashboard column sorting was completely broken (regression from 2.15.2).** The 2.15.2 refactor moved the sort logic into a new module (`src/aiflowbridge/ui/dashboard-sort.ts`) and added a new client-id truncation helper, but the dashboard's inline webview script kept calling module-scope functions that do not exist in its sandboxed context (no module loader). Two `ReferenceError`s were involved: (1) `defaultSortState()` during script initialization, which removed the sort-arrow indicators and made every header click a no-op, and (2) `truncateClientIdForDisplay()` in the client-side `renderRecent()`, which threw on every re-render and broke sorting, pagination, and filters even after the first error was fixed. Fix: the webview script is self-contained again - the default sort state, the `asc -> desc -> clear` click cycle, the `truncateClientIdForDisplay()` helper, and the `CLIENT_ID_DISPLAY_MAX_LENGTH` constant are all inlined directly in the script, mirroring the module contracts that the unit tests exercise. The module `dashboard-sort.ts` and the exported TS helpers remain as the tested source of truth; the tests that only grepped the HTML for `defaultSortState()` / `cycleSortDir` now assert the actual inline state machine, and a new test pins the inline truncation helper. Also replaced the Unicode ellipsis (U+2026) used in the replay loading hint with the ASCII `Loading...` form to stay within the project typography rules.

## 2.15.2

### Fixed

- **Dashboard "Client" column could overflow its cell on long identifiers.** `normalizeClientId()` (in `src/aiflowbridge/gateway/server.ts`) caps the resolved client id at 128 characters, but custom `X-AIFlowBridge-Client` headers or non-standard User-Agent strings (curl, telnet probes, raw HTTP tools, IDE plugins with verbose UA) could still produce strings long enough to push the recent-requests row past the bounds of its section. The dashboard now shortens the visible cell to 24 characters via a new pure helper `truncateClientIdForDisplay(value, maxLength)` in `src/aiflowbridge/ui/dashboard.ts`, exposed as a constant `CLIENT_ID_DISPLAY_MAX_LENGTH` and applied to all three rendering sites (server-side `recentRow`, client-side `recentRow` re-render, and the "By client" aggregation panel). The full client id is preserved in the `title` attribute (tooltip) and in the JSON payload shipped to the client-side search and replay code, so no information is lost - only the visible text is clamped. A new CSS class `code.client-cell` adds a 220 px max-width + `text-overflow: ellipsis` guard so the column never expands past its allotted width even if the JS path is bypassed. `tests/dashboard.test.ts` passes 138/138 (7 new tests for `truncateClientIdForDisplay` covering the short / exact / too-long / sub-suffix-length / non-positive-or-finite branches, plus a new integration test that asserts the truncation + `title` preservation contract on a long client id; 3 existing assertions for the "By client" panel updated to match the new `<code class="client-cell" title="...">...</code>` shape).

## 2.15.1

### Fixed

- **Release CI was blocked by `tsc` overload disambiguation in `defaultUserPrompt.showModalMessage()`.** The modal `vscode.window.showWarningMessage(message, { modal: true }, ...items)` call in `src/aiflowbridge/gateway/server.ts` failed `tsc` with `TS2345: Argument of type '{ modal: boolean; }' is not assignable to parameter of type 'string'` because TypeScript could not pick the `(message, options, ...items)` overload when `items` was itself a rest `string[]` and fell back to the `(message, ...items)` overload that expects a `string` as the second argument. The release workflow runs `npm run compile` and was aborting with exit code 2 on every release tag. Fix: cast `showWarningMessage` through `unknown` to a function signature that pins `{ modal: boolean }` as the second parameter, exactly the same workaround already used in `src/aiflowbridge/vscode-context-adapter.ts`. No behaviour change at runtime; the local build used a lazy `await import('vscode')` that hid the overload-resolution bug from the editor, but the CI compile path type-checks the module top-to-bottom and caught it.

## 2.15.0

### Added

- **Dynamic pricing and cost estimation.** Pricing is now backed by a bundled `resources/pricing.json` file (schemaVersion, generatedAt, source, sourceUrl, aiflowbridgeVersion) that ships with every release and is regenerated by `npm run pricing:refresh` against the live OpenRouter `/v1/models` listing. A new 4-tier pricing merge (`workspace > globalStorage > bundled pricing.json > per-model models.json`) replaces the old per-model-only lookup. New commands: `AIFlowBridge: Refresh pricing now` (command palette) and `AIFlowBridge: Open pricing data` (open the bundled JSON in the editor). The dashboard's Gateway panel gains a `Refresh prices` button that hits OpenRouter, writes `<globalStorageUri>/pricing-override.json`, updates the in-memory pricing registry in place, and re-renders the tooltips + headline card without a window reload. Every `Est. cost` tooltip now carries a `source: ...` tag so the user knows whether the rate is release-time fresh, user-refreshed, or a fallback from the registry / family default. No network call at activation: the cold-start path stays zero-network; the bundled JSON is the first source of truth and the user refresh is opt-in. New pure module `src/aiflowbridge/pricing/loader.ts` (4-tier merge + `replacePricingEntries` for hot updates) and shared `src/aiflowbridge/pricing/openrouter-fetch.ts` (HTTP fetch + parser, reused by both the user-side refresh and the release-time script). New release-time script `scripts/refresh-bundled-pricing.mjs` parses the OpenRouter response, writes `resources/pricing.json` atomically via `.tmp` + `rename`, and logs a drift table (added / removed / changed / unchanged with delta %) for the maintainer's eyeball pass before committing. Documentation: new `## Pricing` section in `docs/cost.md` covering Source (OpenRouter), Estimative disclaimer (prices are estimates, accurate as of the date stamp), and How to update (user-side vs maintainer-side).
- **Telemetry export from the dashboard (CSV / JSON).** Two new buttons next to `Clear filters` in the Filters panel: `CSV` and `JSON`. Both honor every active filter (preset / provider / date range / text search / inactivity gap) - the export uses `currentRecent`, the same in-memory filtered subset the dashboard already renders. CSV output is RFC 4180-compliant (CRLF line endings, comma-separated, fields containing comma / quote / CR / LF are double-quoted with embedded quotes doubled); JSON output is pretty-printed and carries a metadata header (`schemaVersion`, `source`, `generatedAt`, `extensionVersion`, `filters`, `totals`) so a downstream consumer can reconstruct the filter context without inspecting the filename. Filenames follow the pattern `aiflowbridge-metrics-<preset-slug>-<YYYY-MM-DDTHH-mm-ss>.<ext>` (the preset slug is sanitized to filesystem-safe characters). The webview builds the payload client-side then ships it to the host via `postMessage`; the host delegates to a new internal command `aiflowbridge.exportToFile` (`src/runtime/exportTelemetry.ts`) which owns the native `vscode.window.showSaveDialog` + `vscode.workspace.fs.writeFile` write path. This replaces an earlier client-side `URL.createObjectURL` + `<a download>` pattern that silently no-op'd under the default VS Code webview CSP (the `blob:` URL the synthetic anchor uses is blocked); the new postMessage + save-dialog flow is CSP-safe and surfaces a real save dialog. New pure helpers in `src/aiflowbridge/ui/dashboard.ts`: `escapeCsvValue`, `formatCsvRow`, `buildCsvExport`, `buildJsonExport`, `computeExportTotals`, `buildExportFilename`, plus the `ExportedRequestEntry` and `ExportMetadata` shapes. 15 new unit tests in `tests/dashboard.test.ts` for the AFF07 helpers (was 107, now 122) and 6 new tests in `tests/export-telemetry.test.ts` for the host-side save command.

## 2.14.0

Hardening pass driven by the architecture & code-quality audit of the 2.10.0 → 2.13.0 codebase (audit archived in `_Private/archives/2026_07_13_audit-architecture-code.md`).
All recommendations from the audit report were applied: three low-to-medium severity bugs were fixed, one defense-in-depth check was added on the upstream credential path, three redundant code paths were cleaned up.
No behaviour change for callers on default settings.

### Fixed

- **Dispose-before-activate race could throw `TypeError: Cannot read properties of undefined`.** `AIFlowBridgeRuntime.deactivate()` reached straight into `this.gateway.stop()`; when VS Code called `dispose()` (or `deactivate()`) before `activate()` resolved (an immediate deactivation after install, a test harness that never awaited activation, a hot-reload race), the field was still `undefined` and the call crashed. `deactivate()` now opens with `if (!this.gateway) { return; }`; `dispose()` keeps its fire-and-forget `void this.deactivate()` shape and inherits the guard. Three regression tests in `tests/runtime-gateway-info.test.ts` cover the pre-activation `deactivate()` no-op, the synchronous `dispose()` no-throw, and the post-activation `deactivate()` shape.
- **Dead `ttfbMs` binding in the forward chat completion path.** The variable was assigned exactly once (`Date.now() - startedAt` after the upstream headers arrived) then neutralised by `void ttfbMs` and a justifying comment - the documented diagnostic-parity intent was no longer reachable, and the same timing info is already exposed through `durationMs` (equal to TTFB on non-streaming responses, equal to total stream latency on streaming responses). The 4 sites in `src/aiflowbridge/gateway/server.ts` (declaration, assignment, comment, `void`) are removed; the audit's "delete or finalise" branch was chosen because the value added no information over the existing `durationMs`.
- **`GET /v1/sessions?limit=N` cap was too generous.** The audit flagged the 200-entry ceiling as out of step with the dashboard's 5-session pagination. The cap is now 50 (10 pages of headroom above the default view). `resolveSessionListLimit()` returns the same 20-entry default on missing / non-positive / non-numeric input. Two new regression tests in `tests/session-share.test.ts` record 60 entries, ask for `?limit=10000`, and assert exactly 50 reverse-chronological entries (`entry-59` through `entry-10`); a sibling test exercises the `limit=0`, `limit=-7`, and `limit=notanumber` fallbacks.

### Added

- **Printable-ASCII shape check on the resolved upstream API key before injection.** New pure helper `isValidBearerKey(value)` in `src/aiflowbridge/gateway/bearer-key.ts` validates the resolved key against two rules before it is spliced into `Authorization: Bearer <key>`: length must be 1..512 characters, and every byte must be printable ASCII (`0x21`..`0x7E`). The check rejects CRLF injection, multi-MB strings, control characters, whitespace, non-ASCII bytes, and the DEL character - all of which were previously forwarded verbatim to the upstream socket. Wired into `forwardChatCompletion()` (`src/aiflowbridge/gateway/server.ts`): a malformed key short-circuits with HTTP 502 + a structured `Upstream credential rejected` payload (`requestId`, `providerId`, and the `Re-run Set API Key` instruction) and the request never reaches the upstream. 14 new tests in `tests/bearer-key.test.ts` cover the length cap (512 accepted, 513 rejected, 1 MiB rejected), the printable-ASCII class (CR, LF, CR, NUL, tab, BEL, space, DEL, `￿`, emoji rejected; every printable ASCII character accepted in isolation and as a combined string), and the empty-string / non-string reject path. The helper is also imported by the standalone CLI bundle.

### Changed

- **Triple SSE cleanup listener collapsed into a single `endStream()` helper.** `streamSseEvents()` used to register three near-identical `once('close'|'aborted', ...)` listeners that each repeated the `if (ended) return; ended = true; cleanup();` pattern; the lifetime timer also inlined the same logic before writing its `end` event. The pattern is now extracted to `endStream()`, called from every termination path (request close, request aborted, response close, lifetime cap reached); the lifetime timer keeps its dedicated `event: end` write but routes through `endStream()` first so the `ended` guard and `cleanup()` stay in one place. The declaration order is reordered (`cleanup` then `endStream` then the lifetime `setTimeout`) so the lifetime timer's callback sits in the temporal-safe zone and the helper is reachable from every path. Surface area: 1 helper instead of 3 callbacks that could drift apart over time.
- **`getMaxTokens()` legacy wrapper removed.** The wrapper in `src/config.ts` hard-coded `getProviderMaxTokens('deepseek')` and was the single call site for the DeepSeek `max_tokens` request field. The wrapper is removed and the call site (`src/provider/request.ts`) imports `getProviderMaxTokens` directly, calling it with `'deepseek'`. The contract is now explicit per call site: serving another vendor is a one-line change at the relevant provider module, with no opaque helper in the middle.
- **Two historical narration comments purged from `src/aiflowbridge/index.ts`.** The audit flagged explicit `fix: a previous version...` blocks (in the `gatewayInfo` JSDoc and in `reloadConfiguration()`) that described what the previous version did wrong instead of explaining the current code's structural reason. Both blocks are rephrased in the WHY-structurel register: the `gatewayInfo` JSDoc now documents the always-safe contract for test harnesses and future early-startup consumers; the `reloadConfiguration()` block now explains why the user-facing message picks `start` vs `restart` based on `wasRunning`. The "action plan item #N" roadmap tags flagged in the audit are kept (they form the live table of contents for the roadmap and converting them to pure structurel comments would erase the trace); the purge continues in the next PRs as recommended by the audit.

## 2.13.0

### Fixed

- **Gateway catalog exposed fake model ids for MiniMax and Xiaomi.** The hand-curated `DEFAULT_GATEWAY_PROFILES` entries in `src/aiflowbridge/host-config.ts` had `id: 'minimax'` and `id: 'xiaomi'` (vendor names) instead of real upstream model ids. `GET /v1/models` then surfaced these strings as model names to Kilo Code / Continue / Open WebUI, making the picker show fake model ids that no upstream API recognizes. Functionally the gateway still forwarded the correct upstream model via `profile.model`, but the catalog was inconsistent and misleading. Fixed by aligning the `id` field with the upstream model id: `id: 'MiniMax-M2.7'` (was `'minimax'`) and `id: 'mimo-v2.5-pro'` (was `'xiaomi'`). Four new regression tests in `tests/host-config.test.ts` (`hand-curated gateway profiles use real upstream model ids as catalog ids` describe block) pin the invariant: no `KNOWN_VENDOR_NAMES` leak into the catalog, no lowercase-only-vendor-shape id is accepted, and the end-to-end `buildModelCatalog` output contains only real upstream ids. The recipe for adding a new vendor in `docs/agent-instructions/tasks.md` (Path B, step 9) now encodes the invariant explicitly.

### Changed

- **Data snapshot convention for pricing and model availability.** Every pricing number and model id mentioned in user-facing docs is now stamped `> Data snapshot: 2026-07-13 (AIFlowBridge 2.12.0). Source: ...` so readers know when the numbers were pulled. A centralized `## Data freshness` section in `docs/providers.md` documents the refresh policy: snapshots regenerate on every release that touches `resources/models.json`; the bundled 7 OpenRouter flagships and their `pricing` blocks do NOT auto-refresh at runtime (cold-start path is zero-network); the 100+ non-bundled OpenRouter ids do auto-refresh through `aiflowbridge.userModels` since they are forwarded verbatim to OpenRouter. Stamps applied to `README.md` (tagline + cost table), `docs/providers.md` (bundled flagship table + Pricing section), `docs/cost.md` (three tables + header policy), `docs/architecture.md` (bundled registry mention), and `docs/vision-proxy.md` ($0 vision claim).
- **User-facing docs refreshed with current OpenRouter model examples.** Tagline, "Pick your cost point" comparison, "Why AIFlowBridge?" + "Features" bullets, Quick start + Use it curl examples, and language-based routing example all updated to mention GPT-5.6, Claude Opus 4.8, Gemini 3.5 Flash, Llama 4 Maverick, Mistral Large 2512, Qwen 3.7 Max, and DeepSeek V4 Pro as the current paid flagship examples (the bundled defaults remain the 7 free-tier flagships shipped in 2.12.0).
- **Utility scripts consolidated under `_helpers/scripts/` and Markdown prose formatter rewritten in Python 3.** The repo convention is now: extension-runtime sources stay at the repo root (`src/`, `dist/`, `resources/`, ...); every utility script (PowerShell, Python, Node) lives under the tracked `_helpers/scripts/` subtree; shared working notes, audits, and historical artefacts live under the gitignored `_helpers/docs/` and `_helpers/archives/` subtrees. `_helpers/**` remains excluded from the VSIX via `.vscodeignore`; `_Private/` stays fully gitignored and is explicitly pruned when the formatter walks a directory target. Five scripts relocated: `scripts/check-standalone-bundle.js` and the four PowerShell helpers (`PublishAIFlowBridge.ps1`, `RerunLastCIWorkflow.ps1`, `SetupPrivateRepo.ps1`, `UpdateStandAloneServer.ps1`). The Markdown prose formatter introduced earlier as `_helpers/scripts/formatMarkdownProse.mjs` is rewritten as `_helpers/scripts/formatMarkdownProse.py` (same sentence-boundary soft-wrap algorithm at 250 characters per line, now accepts a directory target walked recursively for `*.md` files with hidden + build + dependency + `_Private` subtrees pruned automatically). Invoked directly via `python3 _helpers/scripts/formatMarkdownProse.py ...`, not through `npm run` - the `docs:wrap` and `docs:wrap:check` aliases are removed from `package.json` to keep parity with how the PowerShell utilities are invoked. Call sites updated: `package.json`, `.github/workflows/release.yml` smoke-test step, `.vscode/tasks.json` (Publish Stable, Publish Insiders, Update Standalone Server), `tests/standalone-bundle.test.ts`, `AGENTS.md`, `docs/agent-instructions/{style,tasks}.md`, `docs/development.md`. `docs/agent-instructions/working-notes.md` is rewritten to document the three-subfolder `_helpers/` layout (`scripts/` tracked, `docs/` + `archives/` gitignored) and the relaxed `_Private/` layout (can hold scripts + docs + archives + any personal material). Internal fixes folded into the moves: `SetupPrivateRepo.ps1` synopsis and `.gitignore` marker no longer reference the non-existent `_helpers/setup-private.ps1`; the four PowerShell scripts had `$PSScriptRoot ".."` bumped to `"..\.."` to account for the new `scripts/` nesting level; `UpdateStandAloneServer.ps1` synopsis describes the `-Source` default as "two levels above this script" instead of "parent of this script's folder". No runtime change for end users; Python 3 is now a contributor-runtime requirement for using the formatter.

## 2.12.0

### Added

- **OpenRouter upstream provider** (100+ models via single OpenAI-compatible endpoint). The bundled model registry declares `vendors.openrouter` (`baseUrl: https://openrouter.ai/api/v1`) plus seven free-tier flagship entries, chosen for coverage of the major labs and current state-of-the-art: `nvidia/nemotron-3-ultra-550b-a55b:free` (550B MoE / 55B active, frontier reasoning), `openai/gpt-oss-120b:free` (117B MoE / 5.1B active, OpenAI open-weight flagship), `google/gemma-4-31b-it:free` (30.7B dense multimodal, configurable thinking), `meta-llama/llama-3.3-70b-instruct:free` (reference 70B instruct), `qwen/qwen3-coder:free` (480B MoE / 35B active coding agent, 1M context), `qwen/qwen3-next-80b-a3b-instruct:free` (80B MoE / 3B active low-latency), `nvidia/nemotron-3-super-120b-a12b:free` (120B MoE / 12B active multi-agent). All seven carry `pricing: $0 / $0 per 1M tokens` per the OpenRouter `/v1/models` snapshot of July 2026. Set the API key via SecretStorage (`aiflowbridge.providers.openrouter.apiKey`) or the `AIFLOWBRIDGE_OPENROUTER_API_KEY` env var on the standalone CLI; pick any of the 100+ model ids verbatim in Kilo Code / Continue / Open WebUI / `curl` against the gateway at `http://127.0.0.1:8787/v1`. The gateway automatically attaches the OpenRouter attribution headers (`HTTP-Referer: https://aiflowbridge.dev v<semver>`, `X-Title: AIFlowBridge v<semver>`) so requests are eligible for the OpenRouter free-tier reliability track. New pure helper `applyOpenRouterAttributionHeaders` lives in `src/aiflowbridge/gateway/openrouter-headers.ts`; covered by 13 unit tests in `tests/integration/openrouter.smoke.test.ts`. The `AIFlowBridge: Add a custom model` command picker now lists OpenRouter alongside MiniMax / DeepSeek / Xiaomi, and the model registry schema (`KNOWN_FAMILIES` Set + JSON Schema `family` enum) accepts `openrouter`. `API_KEY_SECRETS` and `VENDOR_ALIASES` extended with the new entry so `resolveVendorApiKey` matches `openrouter-...` ids. New setting `aiflowbridge.providers.openrouter.baseUrl` lets users point at a private OpenRouter-compatible relay without recompiling. Docs updated: `docs/providers.md` has a dedicated OpenRouter section (setup, bundled flagship table, free-tier pricing, caveats), and the README cost-comparison table + tagline + Quick start are repositioned around OpenRouter as the headline value. No runtime change to the per-vendor providers (`DeepSeekChatProvider`, `MiniMaxChatProvider`, `XiaomiChatProvider`) or to the `UnifiedChatProvider`: OpenRouter is exposed through the gateway path only.

### Fixed

- **Gateway catalog exposed fake model ids for MiniMax and Xiaomi.** The hand-curated `DEFAULT_GATEWAY_PROFILES` entries in `src/aiflowbridge/host-config.ts` had `id: 'minimax'` and `id: 'xiaomi'` (vendor names) instead of real upstream model ids. `GET /v1/models` then surfaced these strings as model names to Kilo Code / Continue / Open WebUI, making the picker show fake model ids that no upstream API recognizes. Functionally the gateway still forwarded the correct upstream model via `profile.model`, but the catalog was inconsistent and misleading. Fixed by aligning the `id` field with the upstream model id: `id: 'MiniMax-M2.7'` (was `'minimax'`) and `id: 'mimo-v2.5-pro'` (was `'xiaomi'`). Four new regression tests in `tests/host-config.test.ts` (`hand-curated gateway profiles use real upstream model ids as catalog ids` describe block) pin the invariant: no `KNOWN_VENDOR_NAMES` leak into the catalog, no lowercase-only-vendor-shape id is accepted, and the end-to-end `buildModelCatalog` output contains only real upstream ids. The recipe for adding a new vendor in `docs/agent-instructions/tasks.md` (Path B, step 9) now encodes the invariant explicitly.

### Changed

- **Data snapshot convention for pricing and model availability.** Every pricing number and model id mentioned in user-facing docs is now stamped `> Data snapshot: 2026-07-13 (AIFlowBridge 2.12.0). Source: ...` so readers know when the numbers were pulled. A centralized `## Data freshness` section in `docs/providers.md` documents the refresh policy: snapshots regenerate on every release that touches `resources/models.json`; the bundled 7 OpenRouter flagships and their `pricing` blocks do NOT auto-refresh at runtime (cold-start path is zero-network); the 100+ non-bundled OpenRouter ids do auto-refresh through `aiflowbridge.userModels` since they are forwarded verbatim to OpenRouter. Stamps applied to `README.md` (tagline + cost table), `docs/providers.md` (bundled flagship table + Pricing section), `docs/cost.md` (three tables + header policy), `docs/architecture.md` (bundled registry mention), and `docs/vision-proxy.md` ($0 vision claim).
- **User-facing docs refreshed with current OpenRouter model examples.** Tagline, "Pick your cost point" comparison, "Why AIFlowBridge?" + "Features" bullets, Quick start + Use it curl examples, and language-based routing example all updated to mention GPT-5.6, Claude Opus 4.8, Gemini 3.5 Flash, Llama 4 Maverick, Mistral Large 2512, Qwen 3.7 Max, and DeepSeek V4 Pro as the current paid flagship examples (the bundled defaults remain the 7 free-tier flagships shipped above).

## 2.11.0

Privacy, safety, and shipping-quality hardening pass.
The release closes the install path for end users (`installStandalone` failed on the published 2.10.0 VSIX because the runtime ZIP/tar modules were not packaged), bounds the on-disk footprint of the session-log feature, and tightens the loopback-only event stream so a passive listener cannot see prompt or response text without an explicit opt-in.
No behaviour change for callers on default settings.

### Fixed

- **AIFlowBridge: Install standalone gateway`fails with`Cannot find module 'adm-zip'`.** Root cause:`.vscodeignore` excluded `node_modules/**` entirely and `package.json` declared `adm-zip` + `tar` in plain `dependencies`, so`vsce` never packaged the runtime modules. The dynamic `await import("adm-zip")` inside `extractTarGz()` / `extractZip()` (a BUG16 hardening) deferred the failure to first install. Two-part fix: `package.json` now lists `adm-zip` + `tar` in `bundledDependencies` so `vsce` copies them into the VSIX, and `.vscodeignore` re-includes `node_modules/adm-zip/**` and `node_modules/tar/**` (the blanket `node_modules/**` exclusion would otherwise wipe them on the way out). New `tests/extension-bundle.test.ts` asserts the static config AND spawns `vsce package` to confirm the produced VSIX actually carries both modules with their entry points resolved by `require('adm-zip')` / `require('tar')`.
- **`acquireProviderSlot` slot transfer no longer double-counts `active`.** When a queued waiter was handed a slot by `releaseProviderSlot`, the original code called the waiter's resolver which incremented `active` a second time. With three concurrent requests against a per-provider cap of 1, `active` reached 2 instead of staying at 1 - which masked the real semantics of "one slot, one holder" and could trip `inFlightRequests >= maxConcurrentRequests` in edge cases. The resolver no longer mutates `active`; the slot is transferred, not duplicated.

### Added

- **`_helpers/RerunLastCIWorkflow.ps1`.** One-shot script that re-triggers the GitHub Actions CI for a tag without rebuilding or pushing a new commit: deletes the tag locally and on the remote, recreates it at the same commit SHA, and pushes it (the push is what fires the workflow). Accepts `-TagName <name>` to target a specific tag; without arguments, falls back to `git describe --tags --abbrev=0` (most recent tag reachable from HEAD), then to `git for-each-ref --sort=-creatordate` if HEAD has no tag ancestor. Idempotent on the detection steps (does not fail when the tag exists on only one of local / remote). Useful when CI failed on an infrastructure flake and the commit itself is fine. Cross-referenced from `.vscode/tasks.json` (`shell: Rerun Last CI Workflow`) so it is one click from the VS Code task runner.
- **`aiflowbridge.telemetry.maxStoredRequestBytes`** (default 8192 / 8 KiB, `0` to disable). Hard byte cap on the serialized size of every entry appended to the on-disk telemetry file. Oversized `promptSummary` / `responseSummary` are truncated in place; when the entry's static overhead already exceeds the cap, both summaries are dropped. New `src/aiflowbridge/telemetry/cap.ts` (`enforceEntrySizeCap`, `truncateUtf8ToBytes` with code-point-safe UTF-8 truncation), wired into `TelemetryPersister.appendDelta` so the on-disk file stays bounded even when a single request carries an abnormally long user prompt.
- **`aiflowbridge.telemetry.retentionDays`** (default 90, `0` to keep entries forever). On every read AND on every write, entries older than `now - retentionDays * 86_400_000 ms` are pruned from the on-disk snapshot and the cumulative counters are re-derived from the survivors so the dashboard stays consistent. New `pruneByRetention` / `pruneInPlace` in `src/aiflowbridge/telemetry/persistence.ts`.
- **`AIFlowBridge: Purge session log` command.** Distinct from `Reset metrics`: wipes ONLY `promptSummary` + `responseSummary`, keeps the cumulative counters (`requests`, `tokens`, `cost`, per-provider / per-model breakdowns). Modal confirmation required. `TelemetryStore.purgeSessionLog()` clears in-memory synchronously; `TelemetryPersister.purgeSessionLog()` clears on-disk under a file lock. New `tests/telemetry-purge.test.ts` covers the in-memory + on-disk wipe, the no-op when no summaries are present, and the missing / malformed snapshot paths.
- **`SECURITY.md` "Session-log privacy" section.** Documents the stored shape (sanitized, truncated, Bearer/sk-/x-api-key/long-blob redacted), the on-disk location (`<globalStorageUri>/telemetry.json`), the new hard caps, the privacy affordances (`Reset metrics`, `Purge session log`, `captureSessionLog = false`), and the limits of the redaction (best-effort, threat model = "accidental disclosure" via loopback).
- **SSE event-stream safety settings** under `aiflowbridge.gateway.events`:
  - `maxConnections` (default 16) - the N+1th `GET /v1/events` request returns HTTP 429 + `Retry-After`. Tracked via `activeSseConnections: Set<ServerResponse>` on `GatewayService`; `stop()` closes every active subscriber so a graceful shutdown does not leave dangling listeners masked by the 15 s heartbeat.
  - `maxLifetimeMs` (default 1 800 000 / 30 min) - the gateway emits `event: end\ndata: {"reason":"max-lifetime-reached"}` and closes the response cleanly so the standard `EventSource` auto-reconnect takes over. `lifetimeTimer.unref?.()` so the timer never blocks process exit.
  - `includeSummariesInEvents` (default `false`) - the `request.recorded` payload drops `promptSummary` / `responseSummary` unless the operator explicitly opts in. The replay endpoint (`GET /v1/replay/{id}`) stays the explicit, opt-in way to fetch the captured summaries.
- **Per-provider semaphore abort support.** `acquireProviderSlot(providerId, max, signal?)` accepts an optional `AbortSignal`. While a waiter is queued, the abort listener removes the entry from the FIFO and rejects with a new `AbortError` (standard `name = "AbortError"` DOMException shape, with an `isAbortError` helper for call-site narrowing). The same `AbortController` that aborts the upstream `fetch()` is now passed into the slot acquisition, so a client disconnect or watchdog firing while the request is queued drops the waiter cleanly (HTTP 499, no telemetry entry, no leaked upstream socket).
- **`aiflowbridge.gateway.allowLanguageHeaderOverride`** (default `true` for backward compatibility). When `false`, the explicit `X-AIFlowBridge-Language` HTTP request header is silently ignored on hardened / shared machines and the routing hint is sourced only from the request body and the workspace context. The header branch in `resolveLanguageHint()` is gated on this flag and emits a `logger.debug` line that records the decision without leaking prompt content.
- **Discovery UDP non-disclosure regression test.** `tests/gateway-actions-2-4-5.test.ts` binds a throwaway UDP listener on the configured `broadcastPort`, captures the first packet, and asserts the JSON keys are EXACTLY `{ host, port, version, protocol, path }` (no `shutdownToken`, no API key, no workspace path, no model name). Catches any future contributor who accidentally adds a sensitive field to the broadcast payload.
- **`docs/gateway.md` "Network reachability caveats" section.** Documents that the UDP broadcast is best-effort: it will not reach a VPN or corporate network that filters limited broadcast, WSL 2 with the default virtual switch (NAT isolates the VM), Docker / Podman / container runtimes without `--net=host`, or firewalled segments. The HTTP `GET /v1/discovery` endpoint and the static URL remain reachable on the loopback interface regardless.

### Changed

- **`_helpers/Publish-AIFlowBridge.ps1` and `_helpers/Setup-PrivateRepo.ps1` renamed** to `PublishAIFlowBridge.ps1` and `SetupPrivateRepo.ps1` (the dashed variants are deleted). The PascalCase form is consistent with the rest of the folder and avoids shell-escaping headaches when invoking the scripts from `.vscode/tasks.json`. Callers updated: `.vscode/tasks.json`, `AGENTS.md`, `docs/agent-instructions/tasks.md`, `docs/agent-instructions/working-notes.md`, `docs/development.md`. If a local checkout still references the old names, the task runner will surface a "task not found" error that points at the new file.
- **`_helpers/UpdateStandAloneServer.ps1` documentation header.** Added the standard `<# .SYNOPSIS .DESCRIPTION .PARAMETER .EXAMPLE .NOTES #>` comment-based help block, `[CmdletBinding()]`, and `Set-StrictMode -Version Latest` to align with the rest of the `_helpers/` folder. No behaviour change. Style-only refactor of the logging helpers (now wrapped in `Write-Step` / `Write-Warn` / `Write-Ok` with the `[update-standalone]` prefix) and conversion of single-quoted literals to double-quoted ones to match the conventions introduced by the reference script `SetupPrivateRepo.ps1`.
- The pre-existing `release.yml` `vsce package` step already runs without `--no-dependencies`. With `bundledDependencies` now listing `adm-zip` + `tar`, the workflow picks them up automatically - no CI change required.

## 2.10.0

Pair-programming headline feature.
Shared session log + replay endpoint + Server-Sent Events stream let a pair see what the AI just told their partner, re-fetch the original assistant message without re-forwarding upstream, and watch new requests land in real time.

### Added

- **Shared session log + replay + SSE stream.** `RequestTelemetry` gains optional `promptSummary` (max 500 chars) and `responseSummary` (max 1000 chars) fields captured at recording time. Both are sanitized before storage (Bearer tokens, `sk-...` keys, `x-api-key` headers, and any 60+-char token-like blob without whitespace are redacted to `[REDACTED]`) so a developer pasting a `curl` one-liner with their upstream key does not silently leak it on the dashboard or via the new endpoints. Three new HTTP endpoints on the loopback URL:
  - `GET /v1/sessions?limit=N` returns the most recent recorded entries (lightweight shape: id, timestamp, provider, model, status, duration, totalTokens, promptSummary).
  - `GET /v1/replay/{requestId}` re-hydrates the stored prompt + response summaries into an OpenAI `chat.completion.replay`-shaped body (pure read from the in-memory store, no upstream re-forward).
  - `GET /v1/events` is a long-lived Server-Sent Events stream emitting `ready`, `snapshot`, and `request.recorded` frames on every `TelemetryStore.record()` call, with a 15 s heartbeat comment frame so intermediaries do not time the connection out.
- **Dashboard "Shared session" panel.** New panel between "By model" and "By client" with the 20 most recent recorded requests (reverse chronological). Each row shows the local time, provider, model, and the sanitized prompt snippet; a "Replay" button per row requests the matching `/v1/replay/{id}` payload from the extension host and renders it inline in a `<pre>` block. The panel degrades gracefully on entries recorded before the feature shipped (`promptSummary` renders as a muted "(no summary)" placeholder).
- **`TelemetryStore.getEntry(id)` + `listSessions(limit)`.** New lookup helpers used by the gateway endpoints and the dashboard projection. `getEntry` returns `undefined` for unknown or evicted ids (the in-memory `recent` list is bounded by `memoryCap` - 10 000 by default; the persister still receives every entry, so no data is lost across reloads). `listSessions` clamps the limit and returns reverse-chronological entries.
- **`aiflowbridge.telemetry.captureSessionLog` setting** (default `true`). When disabled, prompt + response summaries are dropped at recording time so the on-disk `telemetry.json` file stays lean. The replay endpoints still respond but the `promptSummary` / `responseSummary` fields are empty for entries recorded after the flag was flipped.
- **32 new tests** in `tests/session-share.test.ts` covering sanitization (Bearer / sk- / x-api-key / long-blob redaction, idempotency), prompt + response summary extraction (OpenAI messages array, legacy `prompt` fallback, non-streaming JSON, SSE concatenated chunks, `[DONE]` skip, malformed-chunk tolerance, truncation cap, UTF-16 surrogate safety), `TelemetryStore.getEntry` + `listSessions` (hit / miss, reverse-chronological order, limit clamping), `buildReplayResponse` (OpenAI-shaped payload, usage echo, prompt / response projections, created epoch conversion), and end-to-end HTTP integration (`GET /v1/sessions` empty + populated, `GET /v1/replay/{id}` 200 / 404 / 400 for overlong ids, `GET /v1/events` SSE stream with a `request.recorded` event delivered to a live subscriber).

### Fixed

- The dashboard's `<script>` tag now escapes the `\\n` continuation in the "Loading..." / "(truncated)" branches of the Shared Session replay handler. The pre-existing bug surfaced as a `SyntaxError: Invalid or unexpected token` in the webview console when the user opened the Shared Session panel and clicked Replay on an over-4000-character response (the JS string literal was split across two lines, breaking parsing). No visible behaviour change for the 4 KB-or-smaller default case.

## 2.9.0

Dashboard grouping + UX refinements.
One new panel (`Sessions`) and eight preset options for the inactivity gap, with no behaviour change to existing panels or to the telemetry capture path.

### Added

- **Sessions panel on the metrics dashboard.** Groups recorded requests into sessions using a configurable inactivity gap (default 30 min, options 1 / 2 / 5 / 10 / 15 / 30 / 45 / 60 min via the `Inactivity gap` dropdown). Each session is rendered as a collapsible card showing the start time, the request count, and a header summary (total tokens, average duration, total estimated cost, session span in minutes). Expanding a session reveals an aggregate stats table (start / end / requests / tokens / avg duration / errors / est. cost) and a collapsible **Request details (N)** sub-section that lists every individual request (time, provider, model, status pill, duration, tokens, est. cost). The grouping respects all existing filters (time preset, custom date range, provider, search) and lives in its own paginated panel (5 sessions per page by default, persisted in `localStorage` like the other panels). The card is collapsed by default; clicking the header toggles the aggregate body; clicking the `Request details` button toggles the per-request list with `stopPropagation` so the two toggles do not interfere. The styling reuses the existing dark-theme tokens (`--panel-2`, `--accent`, `--border`, etc.) so the new panel matches the rest of the dashboard. No change to the `TelemetryStore`, `RequestTelemetry`, or `TelemetrySnapshot` shapes - the grouping is purely client-side on the existing `recent[]` array. 8 new tests in `tests/dashboard.test.ts` cover the panel structure, the dropdown options, the JS functions (`groupSessions`, `renderSessionSections`, `renderSessionEntries`, `bindSessionsPaginator`), the CSS classes, the persisted page-size lookup, and the new `Est. cost` header count (now 5: recent, by-model, provider summary, session summary, session per-request details).

## 2.8.1

Bugfix release addressing two regressions introduced in 2.8.0's storage layout change.
Both shipped for the standalone CLI; the VS Code extension's telemetry and dashboard are unchanged on default settings.

### Fixed

- **Standalone CLI did not share storage with the VS Code extension dashboard.** Before 2.8.1, the standalone server wrote `telemetry.json` to `~/.aiflowbridge/` while the VS Code extension wrote to `<globalStorageUri>/telemetry.json`. The two paths diverged on machines where both run, so every request flowing through the standalone was invisible to the dashboard. `src/standalone/storage-dir.ts` (new) resolves the standalone's storage directory with cross-platform precedence: `AIFLOWBRIDGE_DATA_DIR` env var (operator override) → VS Code extension's `globalStorageUri` when the extension is installed (Windows `%APPDATA%`, macOS `~/Library/Application Support/Code/User/globalStorage/...`, Linux `$XDG_CONFIG_HOME/Code/...`) → legacy `~/.aiflowbridge/` fallback for headless machines. On Windows the resolver probes `%APPDATA%\Code\User\globalStorage\LaurentOngaro.aiflowbridge\` so both processes now write telemetry to the same file. 5 unit tests in `tests/standalone/storage-dir.test.ts` cover the env-var override, the extension-path detection on each platform, the missing-extension fallback, and the precedence rules.
- **Dashboard sections were not collapsible** in the metrics webview. The CSS rules `.collapse-btn.chevron` (compound selector, matched an element with both classes - never) and `.panel.collapsed.panel-body` (same shape, never matched) were copied wrong from the 1.x stylesheet during the AFF08 selector migration; both were supposed to be descendant selectors. `.collapse-btn.chevron` now targets the `<span class="chevron">` inside the button (so the rotation transition lands on the right element); `.panel.collapsed.panel-body` now targets the `<div class="panel-body">` inside the panel (so collapsing hides the body as designed). Fix is two CSS-level edits to the dashboard HTML string in `src/aiflowbridge/ui/dashboard.ts`.
- **`<select>` combobox background invisible against the dark theme.** VS Code injects styles on native `<select>` elements in webviews, forcing a `#effafe` background regardless of the extension's CSS. The `.preset-select` rule now applies `-webkit-appearance: none`, `background: var(--panel-2) !important`, and an explicit `.preset-select option { background: var(--panel-2); color: var(--text); }` so both the closed combobox and the open dropdown respect the dark theme. The existing tests in `tests/dashboard.test.ts` still pass (the assertions are markup-level, not computed-style).
- **Migration script `merge-telemetry.ts` would have lost the standalone's secrets on first restart after upgrade.** The 2.8.1 storage-dir fix makes the standalone read `secrets.json` from the same path as the extension, but the legacy standalone had its own file at `~/.aiflowbridge/secrets.json` that the new path did not know about. The first restart after upgrade would have 1004'd on every upstream call. Renamed the script to `merge-storage.ts` and extended it to also merge `secrets.json`: the union of file-based secrets between the two locations, with the extension's VS Code SecretStorage keys (read by the extension process) untouched by the script. Same backup-and-rollback discipline as the telemetry side. The script is shipped as `dist/standalone/migrations/merge-storage.js` in the standalone bundle for one-shot use after upgrade.

## 2.8.0

Architecture & quality hardening pass driven by the static analysis of the 2.7.0 codebase (audit archived in `_Private/archives/2026_07_11_code-review-architecture.md`). 11 of 12 recommendations addressed in this release; the 12th (refactor of `forwardChatCompletion()` into discrete handlers) is documented as a follow-up with a recommended incremental decomposition.
No behaviour change for callers on default settings.

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

## 2.7.0

Multi-language quality lift + zero-conf discovery.
Ships three action-plan items in one release: workspace context injection (o every chat completion carries a one-paragraph system message describing the project's languages / package managers / linters / formatters; language-based model routing rules (o a polyglot project automatically routes to the right model per language; zero-conf discovery (o IDEs find the local gateway via a UDP beacon + `GET /v1/discovery` HTTP endpoint without any pre-shared URL.

### Added

- **Workspace context detection + system-message injection.** New `src/aiflowbridge/context/workspace-context.ts` scans the workspace root for language manifests (`pyproject.toml`, `Cargo.toml`, `package.json`, `pom.xml`, `*.csproj`, `mix.exs`, `CMakeLists.txt`, ...) and prepends a short system message to every `/v1/chat/completions` body describing the languages / package managers / linters / formatters it found. The detector is bounded by `maxDepth` (default 2) + `maxEntries` (default 50) + an `ignoredDirs` set (defaults: `node_modules`, `target`, `build`, `dist`, `.git`, `.venv`, ...) so a deep dependency tree cannot stall the request. Workspace root resolves in order: `aiflowbridge.gateway.workspaceContext.root` (explicit) -> `AIFLOWBRIDGE_WORKSPACE` env var (service-manager launch) -> `process.cwd()` (standalone CLI launched from project root) -> VS Code workspace folder. New `GET /v1/context` HTTP endpoint exposes the detected `WorkspaceContext` as raw JSON so an IDE settings UI can surface "this gateway detected Python + ruff in /home/me/proj" without re-running the detector. Opt-out per workspace via `aiflowbridge.gateway.workspaceContext.enabled = false`. Pure-function helpers (`detectWorkspaceContext`, `renderWorkspaceContext`, `prependSystemMessage`) exported for unit testing.
- **Language-based model routing rules.** New `aiflowbridge.gateway.languageRouting` config object (map of `language -> providerId`, with `*` wildcard fallback) so a polyglot project's traffic lands on the best model per language. New `selectProviderWithLanguage()` in `src/aiflowbridge/context/language-routing.ts` tries the routing table first, then falls back to the existing `selectProvider(model, defaultModel)` chain unchanged. The language hint is resolved in order: explicit `X-AIFlowBridge-Language` HTTP request header (IDE override) -> first recognisable filename in the request body's `messages[]` (a fenced `python\n# /home/me/proj/src/foo.py` snippet or a plain `Look at src/main.rs` reference) -> workspace context primary language (tection). New setting `aiflowbridge.gateway.discovery.broadcastIntervalMs` and the per-language `providerId` resolution match against `provider.id` / `provider.model` / `provider.label` with case-insensitive sensitivity (same as the existing model picker). Empty / missing / non-object settings are treated as "no routing rule" and the fallback chain runs unchanged.
- **Zero-conf discovery (UDP broadcast + `GET /v1/discovery`).** New `src/aiflowbridge/gateway/discovery.ts` runs a periodic UDP broadcast on `aiflowbridge.gateway.discovery.broadcastPort` (default 8788) every `aiflowbridge.gateway.discovery.broadcastIntervalMs` (default 2 000 ms). The payload is a small JSON `{ host, port, version, protocol: "openai", path: "/v1" }` broadcast to `255.255.255.255` (limited broadcast, no mDNS dep, no extra `bonjour-service`). New `GET /v1/discovery` HTTP endpoint on the gateway's own TCP server (loopback) returns a richer JSON with one-paste client config snippets for Continue, Kilo Code, the OpenAI Python SDK, and curl, so the user picks one and pastes it into their IDE settings. Both surfaces are gated on the same `aiflowbridge.gateway.discovery.enabled` flag (default `false` so the standalone CLI does not emit UDP packets on shared machines unless explicitly opted in). The default-off posture prevents surprising users on LAN; the HTTP endpoint remains reachable on the loopback URL even with the flag off, returning `{ enabled: false, message: ... }` so a curious user can confirm the flag state via a browser.
- **metric dashboard preset combobox + provider filter + 4 new presets.** The 5-button preset row on each panel (Recent requests + By model) is replaced by a single `<select>` listing the 9 presets: All, Last 15 min, Last 30 min, Last 1 h, Last 24 h, Last 2 days, Last 3 days, Last 7 days, Last 30 days. A second `<select>` on the Recent requests panel filters by provider (`All providers` + the dynamic provider list, populated from the snapshot's `byProvider` keys via a new `refreshProviderOptions()` JS pass that re-runs on every snapshot refresh). The two preset selects stay synchronised via `syncPresetSelects()` (the previous `syncPresetButtons()` helper, renamed for the new shape). `applyAllFilters()` now pipes through the provider stage after the time/custom-date stage and before the per-entry search match. New `.preset-select` CSS matches the visual style of the previous buttons (rounded pill outline, accent highlight on focus). New `PRESET_OPTIONS` constant is exported so the unit tests assert the 9-value list directly without scraping the dashboard HTML. 6 new tests in `tests/dashboard.test.ts` cover the option list, the markup presence, the wire (change handlers + `applyFilters`), and the pipeline ordering.
- Pure-Node UDP broadcast (no new runtime dependency: no `bonjour-service`, no `mdns`, no platform-specific binary).

### Fixed

- **forward HTTP 429 + `Retry-After` from upstream on streaming responses.** Previously, the gateway passed the upstream status code + body to the client but stripped any `Retry-After` / `X-RateLimit-*` headers. On streaming requests that hit a backoff status (`429` or `503`), the upstream's JSON 429 body would be streamed as SSE chunks, which client parsers (Kilo Code, Continue, OpenAI SDK, `curl --no-buffer`) cannot consume. New code in `src/aiflowbridge/gateway/server.ts`: (1) copies any upstream backoff header (`retry-after`, `x-ratelimit-reset`, `x-ratelimit-reset-after`, `x-ratelimit-remaining`, `x-ratelimit-limit`) onto the local response; (2) when streaming + 429/503 is detected BEFORE piping, ends the local response cleanly with `application/json` + the upstream body as the payload so the client sees a proper HTTP 429 with `Retry-After`; (3) records telemetry on the backoff path so the dashboard tracks the failed request. Non-streaming was already forwarding the status code + body but did not forward `Retry-After`; the fix applies to both branches. 4 new regression tests in `tests/gateway-bug17.test.ts` cover streaming + 429 + `Retry-After`, non-streaming + 429, streaming + 503 + `Retry-After`, and a sanity-check that a normal 200 still streams as SSE.
- Hardening pass driven by the `_Private/docs/2026-07-11_Last Code Review.md` (CR02) audit of the 2.7.0 work in progress. Three bugs were fixed outright, six quality issues addressed. No behaviour change for callers on default settings.
  - **`detectWorkspaceContext` walked twice per request.** New `detectWorkspaceContextCached()` in `src/aiflowbridge/context/workspace-context.ts` memoizes the detector on the `root + maxDepth + ignoredDirs` key with a 5 s TTL and `statSync(root).mtimeMs` invalidation. Both call sites in `server.ts` (workspace-injection in `forwardChatCompletion` and the language-routing hint in `resolveLanguageHint`) now share a single `readdirSync` walk per chat-completion burst instead of duplicating it. New `clearWorkspaceContextCache()` is exported for hot-reload use.
  - **`DiscoveryBeacon.start()` swallowed every socket error silently.** Added a `logBeaconError()` helper that emits a one-shot `[Discovery] <kind>: <message>. UDP broadcast disabled; HTTP /v1/discovery on the loopback URL still works.` warning the first time `setBroadcast()`, the `socket.on('error')` listener, or a synchronous `bind()` throws. A Linux user without `CAP_NET_BROADCAST` now sees the failure instead of a beacon that pretends to work.
  - **`X-AIFlowBridge-Language` header was unbounded.** `resolveLanguageHint()` now rejects headers longer than `MAX_LANGUAGE_HINT_HEADER_LENGTH` (64 chars) and trims once before any `toLowerCase()`. A hostile loopback peer can no longer force an MB-long allocation we would then immediately discard.
  - **`broadcastPort` was not clamped at runtime.** `DiscoveryBeacon` constructor now clamps `broadcastPort` to `[1024, 65535]` and falls back to `8788` with a warning when the value is out of range. The package.json schema already enforced the same range; the runtime used to trust hand-edited config (`broadcastPort: 0` produced OS-dependent UDP behaviour).
  - **`matchesGlob()` did not escape `-` in its character class.** Added `-` to the regex character class in `src/aiflowbridge/context/workspace-context.ts:286`. No current `LANGUAGE_MARKERS` pattern exploits the gap, but the trap was a maintenance footgun.
  - **A1 - No user-facing docs on the new settings / endpoints.** `docs/gateway.md` now documents `/v1/context` and `/v1/discovery` (request shape + privacy caveats), the full settings table (workspaceContext._, languageRouting, discovery._), and the `AIFLOWBRIDGE_WORKSPACE` env var override. Privacy section now mentions that `/v1/context` exposes the workspace root and `/v1/discovery` exposes the bundled gateway version (both loopback-only, consistent with `/health` / `/version` / `/v1/models`).
  - **`prependSystemMessage` was exported but had no tests.** New 4-case test block in `tests/gateway-actions-2-4-5.test.ts` (prefix inserted as first system message, no input mutation, non-array `messages` field treated as empty, array-typed `content` preserved).
  - **`DiscoveryBeacon` did not validate `broadcastIntervalMs`.** Constructor now clamps the interval to `[500, 300_000]` ms. A hand-edited `broadcastIntervalMs: 2` no longer produces 30 UDP packets per second.
  - **`resolveContextRoot()` silently fell back when the explicit root was invalid.** When `aiflowbridge.gateway.workspaceContext.root` does not resolve to a directory, the gateway now logs a one-shot warning and falls back to `AIFLOWBRIDGE_WORKSPACE` / `process.cwd()` so the user can spot the typo instead of being surprised by an injection on the wrong folder.
- Post-CR02 code review surfaced 13 additional findings (1 CRITICAL deploy-safety, 9 WARNING, 3 SUGGESTION). All addressed in this commit before the 2.7.0 release.
  - **CRITICAL - deploy-safety.** Workspace-context injection was enabled-by-default with a `process.cwd()` fallback that resolved to the gateway install directory for standalone CLI launches (`aiflowbridge-server.cmd` under Windows Task Scheduler). Every existing standalone user upgrading from 2.6.x would have silently received `Workspace: <install-dir>\nDetected language(s): javascript\n...` on every chat completion, leaking the install path to upstream providers and biasing `selectProviderWithLanguage` against their actual project. Fix: `resolveContextRoot` now requires the resolved cwd to contain a project sentinel (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `CMakeLists.txt`, `mix.exs`, `Package.swift`, `composer.json`, `meson.build`, `.git`) before accepting it as a workspace; the cwd == install dir case logs a one-shot warning and returns `undefined`.
  - **trim() ran before the length cap.** `resolveLanguageHint` was rejecting oversized headers only AFTER calling `headerValue.trim()`, which walked the entire buffer and allocated a fresh string. The cap is now applied to the raw length first; only surviving short values go through `trim()` + `toLowerCase()`.
  - **warning missed non-directory roots.** The explicit-root warning only fired when `statSync` threw ENOENT/EACCES. A typo that picked up a real file (e.g. `C:/foo.txt`) made `statSync` succeed, `.isDirectory()` return false, the loop fall through silently. `explicitRootFailed` is now set whenever the explicit-root candidate was considered but did not produce a directory hit (covers both throwing and non-directory paths).
  - **cache still statSync'd on every hit.** `detectWorkspaceContextCached` called `rootMtimeMs(root)` (a synchronous `statSync`) on every cache hit, defeating the cache's purpose on the request hot path. The mtime recheck on hit is dropped; the 5 s TTL alone is short enough that a developer who creates a new `package.json` sees the updated routing within seconds. `clearWorkspaceContextCache()` remains exported for hot config reload.
  - **matchesGlob rebuilt the `*.csproj` regex on every file entry.** The walk callback now iterates a precompiled `COMPILED_MARKERS` table: 21 literal markers get a string-equality fast path, the one glob marker ships a precompiled `RegExp`.
  - **`resolveContextRoot` did 2-6 statSync per request.** Funneled into `detectWorkspaceContextFromSettings(settings, { cached, cwdSentinels })`; the helper owns the `enabled !== false` gate, the root resolution, and the cache-vs-fresh choice. The three duplicated sites in `server.ts` (workspace injection, language hint, `/v1/context` endpoint) now share the same helper.
  - **`DiscoveryBeacon` start/stop race.** `start()` schedules an async bind callback; `stop()` only cleaned up when `bound` was already true. Fix: `stopped` flag flipped in `stop()` short-circuits the bind callback; socket is recreated in `start()` if it was closed by a previous `stop()`.
  - **`FILENAME_PATTERN` URL false positives.** Even with the documented `(?!\.\.)` lookahead added, body text such as `https://docs.example.com/api/foo.py` still produced a `python` hint (the regex consumed the `:` as the opening char class, capturing `//docs.example.com/api/foo.py`). Added a post-filter in `detectLanguageHintFromPayload` that rejects matches starting with `//`, containing `://`, or starting with `..`.
  - **`collectText` duplicated `collectTextFragments`.** Dropped the local copy in `language-routing.ts` and reused `collectTextFragments` from `telemetry.ts` (single source of truth for OpenAI content-shape handling).
  - **triple-duplicated "shape options, resolve root, call detect" block.** Funneled through `detectWorkspaceContextFromSettings` (see F3).
  - **dead code.** Removed unused `__testing` export in `workspace-context.ts`, unused `emitOnce()` method in `DiscoveryBeacon`, and unused `beaconForTest` getter in `GatewayService`.

## 2.6.1

Hotfix for BUG18: upgrading from a version pre-2.5.0 (where `byClient` did not exist) to 2.6.0 (where `bySource` was added) made the on-disk telemetry file fail the schema validator.
The user's cumulative counters were silently wiped (the dashboard opened empty, with a single `[Telemetry] Telemetry file at <path> does not match the expected shape, ignoring.` warning in the logs).
Treats the per-bucket maps as optional in the validator and adds `bySource` to the `normalizeSnapshot()` defaulting pass so any pre-2.5.0 file loads cleanly and historical counters survive every schema extension.

### Fixed

- **.6.0 wiped the dashboard for users upgrading from a version pre-2.5.0.** `isValidSnapshot()` in `src/aiflowbridge/telemetry/persistence.ts` previously required every per-bucket map to be a present object: `typeof candidate.byProvider === "object"`, `typeof candidate.byModel === "object"`, `typeof candidate.byClient === "object"`. A user upgrading from 2.4.x (where `byClient` did not exist in the on-disk shape) had the file rejected as "does not match the expected shape, ignoring", and the cumulative counters (which the user had built up over months) were silently wiped because the in-memory `TelemetryStore` started from `emptyTelemetrySnapshot()` and the very next `record()` overwrote the rejected file. Fix: the three per-bucket maps are now treated as optional in the validator (`value === undefined || typeof value === "object"`), matching the optional shape they already have in the `TelemetrySnapshot` interface. `normalizeSnapshot()` now also defaults `bySource` to `{}` so the in-memory state matches the on-disk shape after `restore()`. After the fix, a pre-2.5.0 file loads with `byClient: {}` and `bySource: {}` filled in on the way out, the legacy `recent` array survives verbatim, and the next `record()` call starts appending new entries on top of the historical data. Two new regression tests in `tests/telemetry-persistence.test.ts` cover the pre-2.5.0 shape (no `byClient`, no `bySource`, legacy entry with no `source` field) and the post-2.5.0 pre-2.6.0 shape (`byClient: {}` present, `bySource` absent).

## 2.6.0

Bridges the VS Code Copilot Chat path into the metrics dashboard - ships item 6 of the action plan.
Closes the historical blind spot where ~50% of usage (Copilot Chat traffic through `vscode.lm`) was invisible because the gateway only ever saw its own traffic.
Adds a `By source` summary panel (gateway vs copilot-chat) and a sortable `Path` column on the Recent requests table.

### Added

- Bridge the Copilot Chat path into `TelemetryStore`. `UnifiedChatProvider.provideLanguageModelChatResponse` now wraps every Copilot Chat call (success and error) with a `TelemetryStore.recordFromCopilotChat()` call. A new `CopilotChatTelemetrySink` interface is wired in `lifecycle.ts` after the runtime builds its `TelemetryStore`, so Copilot Chat traffic lands in the same `byProvider` / `byModel` / `byClient` maps as gateway traffic and gains a new `bySource` split (`'gateway'` vs `'copilot-chat'`). Pure additive change to the `TelemetrySnapshot` schema (the `source` field on `RequestTelemetry` and the `bySource` field on `TelemetrySnapshot` are both optional, defaulting to `'gateway'` and `{}` respectively, so older on-disk snapshots load unchanged and the next `record()` call repopulates the new aggregation as requests come in). Action plan oses the largest single gap in the metrics view (the dashboard used to be blind to ~50% of usage on a typical install where most prompts go through Copilot Chat instead of Kilo Code / Continue). The wrap is best-effort: a throw inside the sink (telemetry broken) never breaks the upstream pipeline, and a missing sink (runtime not yet built, e.g. when the activation lock is held by a peer activation) is a no-op. Errors are classified into HTTP-ish status codes (e.g. a `ProviderRequestError` carrying `status: 502` from a MiniMax upstream is recorded as 502; anything else lands as 500) so the dashboard's "errors" counter and per-source status breakdown stay meaningful. New public methods: `GatewayService.recordFromCopilotChat(options)`, `AIFlowBridgeRuntime.recordFromCopilotChat(options)`, `UnifiedChatProvider.setTelemetrySink(sink)`, `TelemetryStore.recordFromCopilotChat(options)`.
- Dashboard `By source` panel + sortable `Path` column. New panel between "By client" and "Provider summary" with a table (`Source | Requests | Tokens | Avg duration | Errors`) showing the gateway vs copilot-chat split at a glance. New sortable `Path` column on the Recent requests table (data-sort-key `source`, values `'gateway'` or `'copilot-chat'`, `'copilot-chat'` rows wrapped in a `<code>` tag for visual distinction). Existing `Token source` column (estimated vs usage) renamed from the previous `Source` column to free up the term - the `data-sort-key` stays `estimated` so the sort behaviour and existing tests are unchanged. Search haystack extended with the entry's `source` value so typing "copilot" filters the Recent table down to Copilot Chat traffic. Server-side render and client-side rerender stay in sync (server emits the `<td>` directly; client `entrySearchHaystack` and `recentSortVal` both normalise absent `source` to `'gateway'` for backward compat with older on-disk snapshots). Recent table colspan bumped from 9 / 10 to 10 / 11 to account for the new column. Collapse / chevron wiring extended to the new panel.
- **Per-request log line carries a local-time `YYYY-MM-DD HH:MM:SS` stamp.** The standalone CLI prints `[INFO]  [Gateway] {requestId} {provider} {status} {duration}ms` on every `/v1/chat/completions` (when `gateway.telemetry.logRequests = true`) and the line was missing any date / time information, which made the BUG17 tail-latency investigation hard to correlate with wall-clock spikes. New `formatRequestLogLine()` + `formatLocalTimestamp()` helpers in `src/aiflowbridge/gateway/server.ts` prepend a fixed-width `YYYY-MM-DD HH:MM:SS` stamp (local time, no millisecond noise, locale-independent so the line is greppable across machines and time zones) so the line now reads `[INFO]  [2026-07-11 11:04:41] [Gateway] 99929fbd-9ab1-485c-993f-01b7acf85ff5 MiniMax-M3 200 3642ms`. The payload after `[Gateway]` is unchanged so existing log-grep workflows keep working. Both helpers are exported for unit testing.

## 2.5.1

Hotfix for BUG17: gateway standby under concurrent agents (3 agents in parallel vs MiniMax-M3 / `reasoning_split: true`).
Adds upstream idle / total timeouts so a stalled MiniMax request aborts with HTTP 504 instead of leaving the agent UI in standby for minutes, silences the `MaxListenersExceededWarning` on long-lived keep-alive sockets, and bounds parallel in-flight requests per upstream provider to address the root cause at the gateway layer.

### Fixed

- Gateway standby under concurrent agents (3 agents in parallel vs MiniMax-M3 / `reasoning_split: true`). Standalone CLI users running 3 agents in parallel against MiniMax-M3 (`reasoning_effort: max`) observed tail latencies of 30-100 s on ~25% of requests while siblings completed in 5-15 s, plus two `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 close listeners added to [Socket].` entries in the log. Two independent root causes, both in `src/aiflowbridge/gateway/server.ts`, both triggered by the same workload pattern (long-lived HTTP/1.1 keep-alive + concurrent thinking-mode requests). **Fix A**: the request handler registered a `socket.once('close', ...)` listener on every incoming HTTP request, so N requests on the same keep-alive socket accumulated N listeners on the same `Socket` emitter and crossed Node's per-emitter cap of 10. New `wiredSocketClosers: WeakSet<Socket>` field on `GatewayService` wires the cleanup listener at most once per physical TCP socket; subsequent requests on the same keep-alive connection only call `this.activeSockets.add(socket)` (idempotent). WeakSet so the `Socket` can still be GC'd when its refcount drops. **Fix B**: zero upstream timeout. `forwardChatCompletion` (`server.ts:703`) called `fetch()` with only a client-disconnect abort; if MiniMax silently queued a thinking request without sending bytes, the gateway waited indefinitely and the agent UI sat in standby for minutes. New `upstreamIdleTimeoutMs` watchdog (default 90 000 ms) aborts after N ms of upstream silence; new `streamTotalTimeoutMs` ceiling (default 300 000 ms) is a bounded safety net. Both share the existing `abortController`, the catch block surfaces HTTP 504 + structured JSON body (`{ error: 'Gateway Timeout', requestId, details, idleTimeoutMs, totalTimeoutMs }`) instead of generic 502, and the streaming pipe gains an explicit `node.on('error', abort)` handler plus a `data`-event reset on the idle timer so a slow-but-trickling upstream is not falsely aborted. The post-headers local `response.end()` is a no-op while the pipe owns the response, so the watchdog also calls `response.destroy()` to release the pipe cleanly. **Fix C**: self-inflicted upstream amplification. Every MiniMax request unconditionally kicked off a parallel `fetchMinimaxPromptTokens` POST to `/v1/responses/input_tokens`, doubling the upstream burst (6 outbound calls for 3 thinking-mode agents) precisely when MiniMax was already throttling the main 3. New `minimaxParallelTokenCount` setting (default `false`) gates the parallel pre-count on `!payload.stream`; the pre-count also receives the shared `abortController.signal` so the watchdog kills a stuck pre-count cleanly. **Fix D**: per-provider concurrency semaphore. New `gateway.maxConcurrentPerProvider` setting (default 3) plus module-level `Map<string, ProviderSemaphore>` keyed by `provider.id`. `acquireProviderSlot` returns immediately when `active < max`, otherwise queues a Promise in `waiters`; `releaseProviderSlot` hands the slot to the next waiter or decrements `active` when the queue is empty. The Map entry is freed when `active` drops to 0 with no waiters, so distinct provider ids do not grow the Map unboundedly. `max = 0` disables the cap (allocation-free skip). The slot is released in the `finally` block alongside the global `inFlightRequests` decrement so the slot is never leaked on error / abort / body-read failure. Result: 3 agents in parallel against the same MiniMax upstream now see at most 3 concurrent upstream POSTs (queue depth = N - 3), with `durationMs` in telemetry reflecting end-to-end latency (queue wait + upstream).
- New gateway settings surfaced on `GatewayStatus` for the dashboard. The three new caps (`maxConcurrentPerProvider`, `upstreamIdleTimeoutMs`, `streamTotalTimeoutMs`) are mirrored on `GatewayStatus` (`src/aiflowbridge/types.ts:200-225`) so the status bar / dashboard can show the configured values without re-reading the full config. New `aiflowbridge.gateway.*` settings added to `package.json` with full descriptions. All four new fields are optional in `GatewaySettings` for backward compatibility with older snapshots and test fixtures; the gateway resolves defaults (3 / 90 000 / 300 000 / `false`) at use site.

## 2.5.0

Per-client IDE telemetry in the metrics dashboard - ships item 1 of the action plan.

### Added

- **Per-client IDE telemetry in the dashboard.** The gateway now tags every `/v1/chat/completions` entry with a stable originating-client identifier (`kilo-code@1.2.3`, `continue@0.9.x`, `curl@8.10.1`, `jetbrains-ai-assistant@2024.3`, `mozilla@5.0`, or `unknown`) derived from the `X-AIFlowBridge-Client` header (preferred) or the request's `User-Agent` header (fallback). The dashboard surfaces this in two new places: a sortable **Client** column on the Recent requests table (between Model and Duration, included in the global filter + search haystack), and a new **By client** summary panel that aggregates requests, tokens, average duration, and errors per originating client. Pure additive change to the OpenAI endpoint contract. Older on-disk telemetry snapshots that pre-date the feature (`byClient` absent on disk) load as an empty map and repopulate as new requests come in - no forced reset on upgrade. Names with internal spaces (`Kilo Code`, `JetBrains AI Assistant`) are hyphenated to keep the bucket keys dashboard-safe (`kilo-code@1.2.3`, `jetbrains-ai-assistant@2024.3`); user agents without a `Name/Version` token (e.g. raw `curl --user-agent 'my-script'`) become literal cleaned strings. Two new exported helpers in `src/aiflowbridge/gateway/server.ts`: `normalizeClientId(raw)` - pure parsing function, returns `null` for empty input; `resolveClientId(request)` - reads the headers in priority order. The `TelemetrySnapshot` schema gains `byClient: Record<string, ProviderSnapshot>` (mirrors `byProvider` / `byModel`); the in-memory `TelemetryStore` maintains the map in `applyEntryInMemory`, `applyEntryToSnapshot`, `restore`, `clearInMemory`, and `removeEntry`. Dashboard server-side renderer adds a `<th data-sort-key="clientId">Client</th>` cell to the recent table and a new `<div class="panel" id="panel-client">` between By model and Provider summary; client-side mirror in the script block updates the `recentColspan` (9 without the trash column, 10 with it), the search-haystack array (`entry.clientId || ""`), and the `recentSortVal` switch. Backward compatibility: the field is optional on `RequestTelemetry`; entries without it coalesce into the literal `'unknown'` bucket for the by-client aggregation and render as muted `unknown` cells on the recent table. Closes the User-Agent-is-discarded blind spot noted in `_Private/docs/ACTION_PLAN.md` item 1.

## 2.4.3

Hardens the standalone distribution pipeline so the v2.3.0 regression cannot recur, and fixes missing runtime metadata in the standalone archive.

### Fixed

- **Standalone release artifact completeness guard.** The v2.3.0 release was shipped with only `dist/standalone/` inside the archive, while `dist/standalone/main.js` does `require('../aiflowbridge')`, `require('../aiflowbridge/modelRegistry')`, `require('../logger')`, `require('./context')`. End users hit `Error: Cannot find module '../aiflowbridge'` on every start. Three safeguards now block any future broken release: (1) the `Assemble release tree` step in `.github/workflows/release.yml` fails fast with a `::error::` annotation if any expected sibling module (`dist/aiflowbridge/`, `dist/logger.js`, `dist/config.js`, `dist/consts.js`, `dist/types.js`, `dist/json.js`) is missing - no more silent skip via `[ -e "dist/$module" ]`; (2) a new `Smoke test standalone bundle` step runs `scripts/check-standalone-bundle.js` against the staged tree right after the assemble, parsing `main.js` for every relative `require()` and verifying each one resolves on disk (extension-less + `.js` + `.json` + `/index.js`), plus checking that `package.json` and `resources/models.json` are present so the standalone can report its real version and load the bundled model registry; (3) the same smoke test runs as a vitest unit test on every `npm test`. The workflow cannot upload the archive to the GitHub Release unless all checks pass.
- **Standalone archive missing `package.json` and `resources/models.json`.** The standalone reports `version 0.0.0` and falls back to synthesized providers without pricing because the assemble step never copied these runtime metadata files. `package.json` is now shipped so `resolveExtensionVersion()` reads the correct version (avoiding a cascade: 0.0.0 causes the VS Code extension's version-aware gateway restart to kill the standalone and relaunch it). `resources/models.json` is now shipped so the bundled tier of the 3-tier model registry loads real provider definitions with pricing data.

### Added

- **`scripts/check-standalone-bundle.js`** - reusable Node script (no dependencies) that asserts a given CommonJS entry point can resolve every relative `require()`, and that the expected runtime metadata files (`package.json`, `resources/models.json`) are present at the archive root. Used by both the release workflow and the unit test suite. Exit 0 on success, exit 1 with the list of missing references on failure. Documentation in the script header.
- **`tests/standalone-bundle.test.ts`** - 5 unit tests: script presence, end-to-end resolution against `dist/standalone/main.js` (requires + runtime files), regression guard for the v2.3.0 broken state (stub with missing `require()` targets, asserts exit 1 + correct messages), regression guard for missing runtime files (exit 1 + `package.json`/`resources/models.json` in error), and extension-less specifier handling in a full tree layout.

## 2.4.1

Hotfix for the 2.4.0 command-palette regression + column sorting on the metrics dashboard.

### Fixed

- All command palette commands broken after 2.4.0 install. Static top-level imports of `adm-zip` and `tar` in `src/runtime/installStandalone.ts` failed at module load time because these runtime dependencies are not shipped in the VSIX (`.vscodeignore` excludes `node_modules/**` and the extension has no bundler). The failure cascaded to `src/runtime/commands.ts`, blocking ALL command registrations (`command 'aiflowbridge.showMetrics' not found`, etc.). Fix: (1) `tar` and `adm-zip` imports moved to dynamic `import()` inside `extractTarGz()` / `extractZip()` so they only load when the user actually triggers the install command; (2) `commands.ts` wraps the `installStandalone` import in a `try/catch` so a future dependency issue with a single command cannot break all others.

### Added

- Column sorting on the metrics dashboard. Click any column header on the Recent requests, By model, or Provider summary tables to sort ascending; click again for descending; click a third time to clear the sort (back to default order). Sort state is per-panel (independent). Numeric columns (tokens, cost, duration, status) compare numerically with `NaN` sentinel handling; text columns (provider, model, source) use locale-aware string comparison via `localeCompare()`. Sort arrows (▲ / ▼) appear on the active column with hover opacity hints. Implementation: CSS (`th.sortable`, `.sort-arrow`, `.sorted`), server-side `data-sort-key` attributes on all `<th>` elements, client-side `sortState` object + `compareVals` generic comparator + `recentSortVal` / `objSortVal` extractors + `sortRecentEntries` / `sortObjectEntries` sorter functions + `applySorts()` / `updateSortArrows()` helpers + event delegation click handler on each table's `<thead>` with the 3-state cycle. 13 new tests in `tests/dashboard.test.ts`.

## 2.4.0

New `AIFlowBridge: Install standalone gateway` command for one-click download + extract of the standalone CLI from GitHub Releases, plus bugfixes to the standalone distribution pipeline and the GitHub API client.

### Added

- **AIFlowBridge: Install standalone gateway command.** New VS Code command (`aiflowbridge.installStandalone`) that downloads the platform-matched standalone CLI archive from the latest GitHub Release, extracts it to a user-chosen directory, makes the launcher executable (POSIX), and optionally registers an autostart service (`systemd --user` unit on Linux, `launchd` plist on macOS, scheduled task on Windows). Idempotent: detects an existing install and prompts for Replace / Keep (with date suffix) / Cancel. Resilient: streaming download with `Content-Length` cap (100 MB), atomic extraction to a staging directory with cleanup in a `finally` block, HTTP 301-308 redirects followed up to 5 hops (loop guard). New runtime dependencies: `adm-zip` (Windows archive extraction), `tar` (POSIX archive extraction). 13 new unit tests in `tests/install-standalone.test.ts` cover platform detection, `InstallError` discriminated union, tar.gz round-trip, ZIP round-trip, gzip header sanity.
- **`docs/standalone.md` reworked.** Install section now leads with the in-VS-Code install command (Option A), then the manual GitHub Release download (Option B), then the build-from-source fallback (Option C). Reflects the actual recommended user journey.

### Fixed

- **Standalone archive was missing sibling modules.** The `standalone` job in `release.yml` only copied `dist/standalone/` into the release archive, but `dist/standalone/main.js` does `require('../aiflowbridge')` etc. for the gateway / telemetry / runtime modules. These siblings (`dist/aiflowbridge/`, `dist/logger.js`, `dist/config.js`, `dist/consts.js`, `dist/types.js`, `dist/json.js`) are now copied alongside the standalone entry, so the extracted archive runs out of the box (was: `Error: Cannot find module '../aiflowbridge'` on first launch).
- **GitHub API requests lacked the required `User-Agent` header.** `/releases/latest` was returning HTTP 403 ("You must provide a User-Agent header") for some networks. The request now sends `User-Agent: AIFlowBridge-VSCode-Extension/2.4.0` plus `Accept: application/vnd.github+json` for the v3 REST API.
- **GitHub API HTTP 3xx redirects were not followed.** The download now follows 301 / 302 / 303 / 307 / 308 up to 5 hops (loop guard), resolving both absolute and relative `Location` headers.
- **Rate-limit response was indistinguishable from other 403 errors.** The error path now checks `x-ratelimit-remaining: 0` and surfaces a dedicated i18n string (`installStandalone.rateLimited`) pointing at `docs/standalone.md` as the build-from-source fallback.
- **`installStandalone.pickInstallDir` i18n key was missing.** The folder-picker dialog's "Open" button label showed the raw i18n key instead of the translated "Choose install location" string. The key is now defined in both `src/i18n.ts` (runtime) and `package.nls.json` (VS Code marketplace).

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

## 2.1.0

Post-2.0.0 hardening + small features from the audit follow-up 2.0.0; only new optional settings, more defensive code paths, and additional test coverage (596 -> 614 tests).

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

Standalone gateway + audit-driven hardening.
The gateway can now run as a pure Node.js CLI (`aiflowbridge-server`) without VS Code, while the VS Code extension itself was hardened against a batch of regressions and pre-existing security findings.

### Added

- **Standalone gateway (`aiflowbridge-server` CLI).** `GatewayService` and `AIFlowBridgeRuntime` are decoupled from `vscode.ExtensionContext` via a new `IGatewayContext` interface. The CLI binary reads its config from `~/.aiflowbridge/config.json` (with hot-reload via `fs.watch` + 5s polling fallback on Windows), resolves API keys from `AIFLOWBRIDGE_<VENDOR>_API_KEY` env vars first then `secrets.json` (`chmod 600`), and shares the same `gateway.lock` as the VS Code side so only one process owns the gateway. The VS Code extension switches to a "joined" mode (status bar `AIFlowBridge ↗ external`) when it detects a peer already running. New `tsconfig.standalone.json` + `vscode-shim.ts` keep the standalone build type-safe without `@types/vscode`. Docs: `docs/standalone.md`, autostart templates (systemd / launchd / Task Scheduler), and Continue / JetBrains AI Assistant setup guides. 28 new tests in `tests/standalone/` (591 -> 619 baseline).

### Fixed (follow-up audit - 4 LLM consensus)

- **`resetMetrics` lost its modal confirmation.** The `showWarningMessage({ modal: true })` guard against accidental wipes was dropped in the refactor. Reintroduced via a new `ctx.confirm` hook on `IGatewayContext` (modal on VS Code, no-op in standalone CLI).
- **`copyGatewayUrl` stopped copying.** The command name promised clipboard but the implementation only showed an info message. Fixed via `ctx.clipboardWrite` (`vscode.env.clipboard.writeText` on VS Code, `process.stdout.write` in standalone).
- **`openSettings` stopped opening settings.** Same shape: renamed to show the config file path only. Fixed via `ctx.openSettings` (`workbench.action.openSettings` on VS Code, fallback in standalone).
- **`aiflowbridge.setVisionModel` command was orphaned.** Declared in `package.json:113` but the handler was removed (VS Code showed "command not found"). Re-registered as a thin alias to `aiflowbridge.providers.deepseek.setVisionModel`.
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
- **Unnecessary cast** `as unknown as vscode.ExtensionContext` (`config.ts`) removed; `loadModelRegistry` now accepts `RegistryHost` (which `IGatewayContext` satisfies).

### Known issues / breaking changes (vs 2.0.0-rc)

- `resetMetrics` now requires modal confirmation (was: silent reset).
- `copyGatewayUrl` writes to the clipboard (was: info message only).
- `openSettings` opens VS Code settings (was: shows config path only).
- `aiflowbridge.setVisionModel` is re-registered (was: orphaned in `package.json`).
- Legacy `globalState` -> `telemetry.json` migration re-introduced (was: dropped, lost 1.6.x counters).
- Workspace override `.vscode/aiflowbridge.models.json` is picked up again (was: silently ignored).
- 1.6.x -> 2.0.0 upgrade path: cumulative counters survive via the legacy migration.

## 1.7.0

Hardening release: security, bug-fixes, and refactoring from external audit (STU02 - 8 items).
Shutdown auth, SSRF protection for provider baseUrls, race-condition fixes, dead-code removal.

### Security

- **`POST /shutdown` now requires a per-instance auth token.** A `randomUUID()` generated at `GatewayService` construction is returned in `GET /version` and must be echoed in the `X-AIFlowBridge-Shutdown-Token` header. Requests without the header or with a wrong token get a 403. `PeerVersion.shutdownToken` is optional for backward compat (pre-1.7.0 peers do not gate shutdown, so their responses to a token-less request are 200; post-1.7.0 peers reject unauthenticated shutdowns). `requestPeerShutdown(port, { shutdownToken })` passes the header, and `handleOccupiedPort` in `server.ts` forwards the peer token it received from probe. 7 tests in `gateway-restart.test.ts` + `gateway-version.test.ts`.
- **Provider `baseUrl` SSRF validation via `isValidProviderBaseUrl()`.** New helper in `providers.ts` rejects non-http(s) schemes (`file:`, `gopher:`, `javascript:`, ...), unparseable URLs, and cloud metadata endpoints (AWS/GCP/Azure `169.254.x.x`, Alibaba Cloud `100.100.100.200`, AWS IMDS-over-IPv6 `fd00:ec2::254`). `normalizeHost()` handles IPv4-mapped IPv6 in both decimal (`::ffff:1.2.3.4`) and hex (`::ffff:a9fe:a9fe`) forms, plus the brackets added by WHATWG `URL.hostname` on Node 20+. Loopback (`127.x.x.x`, `::1`, `localhost`) is intentionally allowed for Ollama. Entries failing validation are silently dropped in `normalizeProviderProfiles`. 14 tests in `aiflowbridge-providers.test.ts`.

### Fixed

- **gatewaySnapshot()`fallback logic** (`index.ts`). The fallback to`telemetryFallback.snapshot()` (persisted data from the previous session) is now only triggered when the gateway is NOT running AND has zero requests. Previously it triggered whenever `requests === 0`, causing a freshly-started gateway to display stale data as if it were live.
- **readBody()`race between`end`and`close`** (`server.ts`). A`settled` flag now guards the Promise so a normal `end`-then-`close` sequence resolves once and ignores the trailing `close`, while a brutal disconnect (`close`-before-`end`) properly rejects. On body-too-large,`request.destroy()` is called to stop buffer accumulation. `readBody` and `MAX_BODY_SIZE` are exported for unit testing. 6 tests in `gateway.test.ts`.
- **reloadConfiguration()`EPEERSTALLED handling** (`index.ts`).`gateway.start()` is now wrapped in `try/catch` and surfaces a targeted warning with the peer PID when the peer did not free the port within the timeout, mirroring the `activate()` flow.
- **`toNumber(0) || undefined` false positive in `normalizeProviderProfiles`** (`providers.ts`). An explicit `pricing.outputPerMillion: 0` ("free output tokens") was collapsed to `undefined` by the `||` operator because `0` is falsy. The fallback chain now keeps 0 as-is; downstream `formatCostCell` and `estimateCostFromProfile` already handle zero-cost math and display.

### Changed / Refactored

- **Factorized `synthesizeProvidersFromUserModels` and `synthesizeProvidersFromBuiltInModels`** (`config.ts`). A private `synthesizeProvidersFromModels()` helper now carries the shared logic; both public functions are thin wrappers. The 22 existing tests in `aiflowbridge-config.test.ts` pass without modification.
- **Removed `isPortLikelyOccupied()`** (`index.ts`). The single call site now uses `isPortInUse()` directly. The one-line wrapper added no value.
- **Removed `getApiModelId()` alias** (`src/config.ts` + `src/provider/request.ts`). The single call site migrated to `getProviderApiModelId('deepseek', modelInfo.id)`. Verified zero remaining call sites via grep.

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

## 1.5.4

Patch release: fix the Open VSX publication step in the release workflow.
No code change in the extension, no user-facing change for any install channel (VS Code Marketplace, Open VSX, manual install).

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

- **etric dashboard: requests in error have an estimated cost](https://github.com/LaurentOngaro/AIFlowBridge/issues/5).** `GatewayService.recordTelemetry()` (`src/aiflowbridge/gateway/server.ts:634-664`) now sets `estimatedCost = 0` whenever the recorded `status` is `>= 400` (4xx / 5xx upstream response, or the catch-block default of 502 when the upstream never responded). The request is still recorded (error count, per-provider / per-model usage, duration averages, per-row delete affordance) - it just no longer contributes to the "Estimated cost" totals. Cost is a fait historique: we never bill the user for a request that never produced a billable completion. The fix naturally propagates to the cumulative `TelemetryStore.snapshot()` (`applyEntryToSnapshot` / `applyEntryInMemory` just add `entry.estimatedCost` to the totals, so a zero-cost entry contributes nothing), to the on-disk file (the persister applies the same delta), and to the per-row delete path (`removeEntry` decrements under `Math.max(0, ...)` guards). 5 new regression tests in `tests/gateway.test.ts` (new "BUG11: errored requests have zero cost" describe block) cover: successful 200 (cost computed normally), 5xx upstream response (cost=0, errors=1, model usage still recorded), 4xx upstream response (cost=0, errors=1), unreachable upstream / catch block (statusCode=502, cost=0), and a mixed success/error sequence (only successful requests contribute to the total).

### Notes

- **M3 thinking selector works in Copilot Chat, not just via the picker.** The dropdown in the model picker is fed by the proposed `vscode.LanguageModelChatInformation.configurationSchema` API (same one Kilo Code uses for its own provider). When Copilot Chat sends the request, the chosen effort is passed through to the provider via the `modelConfiguration.reasoningEffort` field on `ProvideLanguageModelChatResponseOptions`. The provider (`src/provider/minimax.ts:198-211`) reads it, resolves it through `resolveReasoningSplit`, and emits `reasoning_split` in the upstream request body.
- **Other M-series models (M2 / M2.1 / M2.5 / M2.7) keep their current behavior.** Only M3 has `capabilities.thinking: true` in the bundled registry, so only M3 gets the picker dropdown. Users who want the dropdown for another M-series model can add an entry to `aiflowbridge.userModels` with `capabilities.thinking: true` (the 3-tier merge picks it up immediately) or edit the globalStorage / workspace registry override.
- **The gateway translation is the only mechanism that works for OpenAI-compatible clients that do not have a "Thinking Effort" picker.** The two paths are independent: Copilot Chat users get the dropdown, Kilo Code users get the checkbox, both end up with the same `reasoning_split` value on the wire to MiniMax.
- **No new user setting was added.** The existing `aiflowbridge.providers.minimax.reasoningSplit` setting is still the global default for any model that does not opt into the picker. The picker wins when the model has `capabilities.thinking: true` AND the user has not left the dropdown on its default value.
- **is purely a telemetry-layer change.** No upstream API contract changed, no provider behavior changed, no user-facing setting changed. The only observable difference is that the "Estimated cost" column in the dashboard no longer includes cost for requests that errored out (4xx, 5xx, or catch-block). Historical entries recorded before 1.5.2 keep their original cost (per the existing "Cost is a fait historique" rule in 1.4.1). To clear historical errored entries from the dashboard, use `AIFlowBridge: Reset metrics` (the same command that was already used to re-baseline after a pricing change).

## 1.5.1

Patch release: type-only fixes in the registry loader test mocks. No behavior change, no new tests.

### Fixed

- clean minor warnings in test files
- minor changes in AGENTS.md .

## 1.5.0 (post-release patches)

Incremental additions on top of 1.5.0 without bumping the version. Each entry is self-contained and ships as a patch update.

### Added

- **Per-row delete button in the metrics dashboard "Recent requests" table**. Each row in the "Recent requests" panel now has a trash icon in a new leading column. Clicking the icon posts `{ type: "removeRequest", id }` to the extension, which removes the entry from the in-memory `TelemetryStore` (totals, recent list, per-provider / per-model maps, durations array) and from the on-disk `<globalStorageUri>/telemetry.json` file under the same file lock as `appendDelta`. The cumulative counters and the recent list both reflect the removal immediately; p95 is recomputed from the now-shrunk durations array. A cross-window `Refresh metrics` is enough for a non-leader window to see the removal because the persister writes through to the on-disk file, which is the source of truth.
  - New `TelemetryPersister.removeEntry(id): Promise<boolean>` method (`src/aiflowbridge/telemetry/persistence.ts`). Idempotent: returns `true` when the entry was found and removed, `false` otherwise (e.g. a peer window trying to remove an entry that was already removed by the leader). The reverse-delta math is the mirror of `applyEntryToSnapshot`: totals decrement under `Math.max(0, …)` guards, weighted average is recomputed as `(previous * oldCount - removedDuration) / newCount`, and a per-provider / per-model snapshot whose request count drops to 0 is deleted from its map.
  - New `TelemetryStore.removeEntry(id): boolean` method (`src/aiflowbridge/telemetry.ts`). Schedules a `persister.removeEntry` call (fire-and-forget) and notifies subscribers. Listener exceptions are caught (consistent with `record()` / `reset()`).
  - New `GatewayService.removeEntry(id): boolean` that delegates to the store, exposed for the dashboard message handler.
  - `showMetricsDashboard` gains an optional 5th parameter `onRemoveEntry: (entryId: string) => boolean`. When supplied, the action column is rendered (with a `th.row-actions-col` marker the client uses to know it is in scope), the trash button is added to each row, and a `{ type: "removeRequest", id }` message handler re-renders the panel after the removal. When the parameter is omitted, the action column + the trash button + the click handler are all omitted (backward-compat for callers that do not want the affordance). 9 new dashboard tests cover the positive and negative paths; 8 new tests cover `TelemetryPersister.removeEntry` and `TelemetryStore.removeEntry` (in-memory, listener notification, p95 recomputation, no-op on missing id, drops per-provider / per-model keys on last removal). 466 tests / 26 files (was 453 / 26).
  - The per-row CSS (`.row-actions`, `.row-actions-col`, `.delete-btn`, `:hover`, `:focus-visible`) is emitted conditionally, only when `onRemoveEntry` is supplied, so the no-remove-hook callers do not see the class names in the markup.

### Fixed

- **compliance corrections**
  - **Preset ↔ custom date interaction**: the original 1.5.0 implementation intersected the preset and the custom-date filters (both applied at once). The plan asked for clear / deactivate semantics: clicking a preset now clears the From / To inputs; entering a custom date (on either input) calls a new `deactivatePresetButtons()` helper that removes the `active` class from every preset button. Clearing a date input does **not** re-activate the preset (the user has to pick a preset explicitly to go back to relative mode).
  - **By-model search on the model name**: the original 1.5.0 implementation only matched the search needle against the per-entry haystack. The plan asked for entry-level OR model-name substring match. The dashboard's `applyFilters` now runs two filtered lists: the recent table uses the entry-level match; the by-model table uses entry-level OR model-name substring match (`entry.model.toLowerCase().includes(needle)`). A model whose name contains the needle is now included in the by-model aggregation even when none of its individual entries match.
  - 5 new tests in `tests/dashboard.test.ts` cover both behaviors (preset click → from/to inputs cleared in the script source, change handler → `deactivatePresetButtons` invoked, by-model filter contains the `entry.model.toLowerCase().includes(...)` branch, and two behavioral simulations that re-derive the same logic in pure TypeScript and assert the contract). `AGENTS.md` test count updated. 471 tests / 26 files (was 466 / 26).

## 1.5.0

Minor release: cross-window shared metrics with concurrent access management, and a substantial metrics dashboard UX upgrade.

### Added

- **cross-window shared metrics with concurrent access management**. The gateway telemetry is now persisted in a real file at `<globalStorageUri>/telemetry.json` instead of VS Code's internal `globalState`. A sibling `<globalStorageUri>/telemetry.lock` file serializes writers across processes, using the same lock pattern as the existing gateway lock (stale mtime reaper at 30s, symlink refusal, mkdir-recursive, atomic `write-tmp` + `rename`). `TelemetryStore.record()` now fires an async `persister.appendDelta()` per call. The persister's in-process write chain (`this.writeChain.then(fn, fn)`) guarantees the cross-process lock is acquired and released in the right order even when N parallel `record()` calls land in the same microtask. The on-disk file is always written atomically: a crash mid-write leaves the previous snapshot intact, and a read observed during a write returns the old or new content, never a truncated JSON. The `AIFlowBridge: Refresh metrics` command now calls `gateway.refreshFromDisk()` + `telemetryFallback.refreshFromDisk()` so a non-leader window picks up the leader's writes without a reload. A one-time migration runs on first activation after the upgrade: if the legacy `aiflowbridge.telemetry.v1` slot has data and the new file does not, the snapshot is moved over and the legacy slot is cleared (logged at INFO with the request/token counts). New file `src/aiflowbridge/telemetry/persistence.ts`.
- **metrics dashboard UI improvements**. The dashboard header now shows the running gateway version (`Gateway vX.Y.Z running/stopped`) and the installed extension version under the title (`Current version: vX.Y.Z`). All four panel sections (Gateway / Recent requests / By model / Provider summary) are now collapsible via a chevron in their header, with the collapsed state persisted in `localStorage` per-section. The Recent requests panel gains two `<input type="date">` controls (From / To) and one `<input type="search">` ("Filter requests…"). The text search is case-insensitive and matches across `model`, `providerId`, `providerLabel`, `status`, `timestamp` (ISO + locale-formatted), `durationMs`, `totalTokens`, `promptTokens`, `completionTokens`, `estimatedCost`, and the `estimated`/`usage` source tag. The custom date range and the text search apply on top of the existing preset time filter. The preset buttons and the custom-date range are mutually exclusive: clicking a preset (All / 1h / 24h / 7d / 30d) clears the From / To inputs, and typing a custom date deactivates the active preset. The "By model" panel uses the same filters AND additionally includes a model whose name (lowercased) contains the search needle, even when no individual field of the entries does. The `buildDashboardHtml` signature gains an optional 4th `versions` parameter (`{ gateway?, extension? }`) so the 1.4.x callers that do not pass versions keep working unchanged. `GatewayService` exposes a `bundledVersion` getter for the header.

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
- **t cause #1 - synthesis discarded the per-model `pricing` from the registry**: `synthesizeProviderForModel` in `src/aiflowbridge/config.ts` always set `pricing: familyPricing.get(family)`, throwing away the merged registry's per-model `pricing` and substituting the hardcoded indicative rate from `DEFAULT_GATEWAY_PROFILES`. The function's `model` parameter was even typed without a `pricing` field. Same issue for the hand-curated `buildDefaultGatewayProfiles` (`entry.pricing` was used verbatim with no fallback to the registry). The 3-tier merge in `loadModelRegistry` was propagating the new value correctly, but the gateway `ProviderProfile` builder was overwriting it.
  - Fix: `synthesizeProviderForModel` now accepts a `pricing?` field and applies the precedence `model.pricing` (registry, possibly user-overridden) **>** `familyPricing.get(family)` (indicative default). `buildDefaultGatewayProfiles` now does `entry.pricing ?? toProviderPricing(registryEntry?.pricing)`, so hand-curated entries like `deepseek-flash` (which had no `entry.pricing`) now also pick up the bundled or user-overridden rate.
  - A new `toProviderPricing` helper centralises the `ModelPricing` (registry shape, all required) to `ProviderProfile["pricing"]` (all optional) conversion.
  - `getUserModels()` in `src/config.ts` now also accepts an optional `pricing` block on user-declared models, with a `parseUserModelPricing` helper that mirrors the registry's constraints. User-declared custom models with their own pricing block now propagate through `synthesizeProvidersFromUserModels` correctly.
  - Regression tests: `tests/aiflowbridge-config.test.ts` - "attaches the per-model bundled pricing from the registry", "picks up the per-model pricing from a globalStorage / workspace override (T3 regression)", "falls back to the family-level indicative pricing when a model in the registry has no pricing". The old assertion that `deepseek-v4-flash` had no pricing (which had been locking the bug in place) is replaced with the real bundled values `{ inputPerMillion: 0.27, outputPerMillion: 1.1, currency: 'USD' }`.
- **t cause #2 - the validator rejected partial override entries**: `validateModelEntry` ran in `'strict'` mode for **all** three tiers, including the globalStorage and workspace overrides. In strict mode every field is required (`name`, `family`, `version`, `detail`, `maxInputTokens`, `maxOutputTokens`, `requiresThinkingParam`, `capabilities`). The user (correctly) writes a minimal override - just `id` + `pricing` - which was silently dropped with a `[AIFlowBridge] Skipped invalid model entry "..." in globalStorage model registry: missing/invalid "name"` warning. The 3-tier merge then fell back to the bundled entry (with the old pricing) and the dashboard never changed.
  - Fix: `validateModelEntry` now accepts a `mode: 'strict' | 'partial'` parameter. In `'partial'` mode (used for `globalStorage` and `workspace` tiers) only `id` is required; other fields are validated **if present** and an invalid value still rejects the entry (no silent acceptance of `pricing: { inputPerMillion: -1 }`). The returned shape is `Partial<RegistryModelDefinition>`, composable over the lower-priority entry via `deepMergeModel`. `validateRegistryContent` propagates the mode. `mergeTiers` is now documented with the invariant that the first non-empty tier is the bundled (strict) one, so the first map insertion is always complete.
  - Regression tests: `tests/modelRegistry.schema.test.ts` (6 new) - partial mode accepts `id` + `pricing` only (the canonical T3 user scenario), accepts `id` only (workspace-only model), still requires `id`, still rejects unknown family, still rejects invalid pricing, rejects non-object. `tests/modelRegistry.test.ts` (2 new) - end-to-end "accepts a partial globalStorage override that only changes pricing (T3 regression)" and "still rejects an invalid pricing in a partial override".
- **t cause #3 - dashboard refresh re-rendered stale tooltips**: `showMetricsDashboard` accepted an `AiFlowBridgeConfig` (captured by closure at panel-creation time) and reused it for the in-place "Refresh" button. After a window reload with a new pricing override, the panel's `getConfig` was still the old one - so the rate tooltips and the `Pricing` column kept showing the pre-reload rates until the panel was closed and reopened. The historical `RequestTelemetry.estimatedCost` is intentionally frozen (semantically a "fact at the time of the request"); only the displayed rate is dynamic.
  - Fix: `showMetricsDashboard` now takes a `ConfigGetter: () => AiFlowBridgeConfig` instead of a captured config. The runtime (`src/aiflowbridge/index.ts:138-144`) passes `() => this.config`, so the refresh handler always reads the current `this.config` (which `loadConfig()` re-evaluates on every activation). The panel's `currentPanel.webview.html` is now regenerated from the live config on every refresh button click.

### Added

- **Diagnostic logging at activation** (developer aid, not user-facing): every activation now logs the resolved model registry and the synthesized gateway provider list to the AIFlowBridge output channel. This was added to make T3 reproducible: a single reload shows the exact file paths being read (`bundled` / `globalStorage` / `workspace`), which tiers exist (`exists=true/false`), the pricing for every model in the merged registry, and the pricing for every synthesized provider. The line `source=aiflowbridge.providers (raw user config)` is the smoking gun when an existing `aiflowbridge.providers` setting short-circuits the synthesis. 20+ lines per activation, easy to grep, cheap to keep.

### Notes

- **`aiflowbridge.providers` in `settings.json` wins over the registry override** for entries that have the same `id` or `model`. This is by design (the user explicitly set the pricing there), but it is the most common reason T3 looked broken during testing: the synthesis only **adds** new entries for models not already covered, it never modifies the user-configured ones. The diagnostic logging added in 1.4.1 makes this case obvious - the line `source=aiflowbridge.providers (raw user config)` flags it immediately. To get the registry override to take effect, either remove the `aiflowbridge.providers` section or set the new pricing directly on the user-configured entry.
- **Historical costs stay frozen** after a pricing change (per-request `RequestTelemetry.estimatedCost` is computed at request time and never recomputed). Only the rate displayed in the tooltip / pricing column updates, and only new requests use the new rate. The total `Estimated cost` at the top of the dashboard is the sum of frozen per-request costs, so it still mixes old and new rates - use `AIFlowBridge: Reset metrics` to start over with the new rate from scratch. This is a deliberate semantic choice (cost = historical fact, rate = current configuration).

## 1.4.0

Minor release: version-aware cooperative restart for the local gateway.
Fixes a long-standing dev-experience issue where reloading the extension while a previous gateway was still running would silently reuse the stale instance.

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

- **External model registry**: the canonical list of models and vendor defaults is now `resources/models.json` (bundled with the extension), overridable at two levels:
  - **globalStorage override** (`<globalStorageUri>/models.json`) - per-user
  - **workspace override** (`<workspaceFolder>/.vscode/aiflowbridge.models.json`) - per-project

  The three tiers are deep-merged in priority order bundled < globalStorage < workspace, per `model.id` and per `vendor` key.
  A field absent from a higher tier falls through to the lower tier, so a workspace override that only sets `pricing` keeps every other field from the bundled entry.
  A `model.id` or `vendor` key present only in workspace is preserved (lets you add a new model without touching the bundled file).

  The bundled file is the source of truth for what shows in the Copilot Chat picker (`vscode.lm` model list) and what gets auto-synthesized into the gateway catalog.
  Per-model `pricing` blocks (USD per 1M tokens) live alongside the model definition - the family-level indicative rates that used to be hardcoded in `src/aiflowbridge/config.ts` are now derived from the registry.

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

- **MiniMax accurate token counting**: the gateway now calls MiniMax's upstream `/v1/responses/input_tokens` endpoint in parallel with chat requests when the provider is identified as MiniMax. The returned `input_tokens` replaces the `length / 4` heuristic in both streaming and non-streaming paths, improving cost estimation accuracy in the dashboard.
- **Dashboard - timestamp column on Recent requests**: each row in the "Recent requests" table now shows a local-time clock (HH:MM:SS) with the full timestamp in the cell's tooltip. The column is filterable along with the rest of the table.
- **Dashboard - time filters & by-model breakdown**: the "Recent requests" and the new "By model" tables are filterable by time range (All / Last 1h / Last 24h / Last 7 days / Last 30 days). The "By model" panel groups requests, tokens, and errors per model ID with the same filters. Client-side filtering is instant and works without re-fetching the snapshot.
- **Dashboard - manual Refresh button**: a refresh button now sits to the right of the dashboard title. Clicking it sends a `refresh` message to the extension, which re-reads the latest gateway snapshot and re-renders the webview. The button spins briefly while the new HTML is being generated, with a 1.5 s safety timeout that removes the spin class even if the page does not reload. The dashboard now accepts getter functions (`() => snapshot, () => isRunning`) instead of fixed values, so the refresh always reflects the current state.
- **Persistent metrics across restarts**: the gateway telemetry (totals, by-provider / by-model breakdowns, last 20 recent entries) is now persisted in VS Code `globalState` under `aiflowbridge.telemetry.v1` and restored on the next activation. Writes are debounced 1 s. The persisted state survives extension reloads, VS Code restarts, and debug sessions, so cumulative counters no longer reset to 0.
- **New `AIFlowBridge: Reset metrics` command**: clears the cumulative counters and the persisted state. Asks for confirmation before wiping.

### Fixed

- **`AIFlowBridge: Add a custom model` no longer fails with "is not a registered configuration"** (BUG03): the command now tries to persist `aiflowbridge.userModels` to the User settings first, and falls back to the Workspace settings target if the User target is not yet initialized. This resolves the common case where the extension is run in a fresh VS Code profile with no user-level `aiflowbridge` block.
- **User-declared models are now exposed by the local gateway** (BUG04): previously, models added via `AIFlowBridge: Add a custom model` (or written directly to `aiflowbridge.userModels`) appeared in the Copilot Chat picker but were missing from `GET /v1/models`, so OpenAI-compatible clients like Kilo Code and Continue could not see or use them. The gateway now synthesizes a virtual `ProviderProfile` for each user model with a known `family` (deepseek / MiniMax / xiaomi), so the model is included in the catalog and routed correctly by `selectProvider`. Duplicates with existing gateway profiles are skipped.
- **Gateway no longer silently routes to the wrong provider** (BUG05): `selectProvider` used to fall back to the first enabled provider when the requested model did not match any provider's `id`, `model`, or `label` aliases. This caused a request for `"mimo-v2.5"` to be silently routed to the DeepSeek V4 Flash upstream (which would rewrite the body to `"deepseek-v4-flash"`) while the dashboard labelled the row as `Provider: DeepSeek V4 Flash, Model: mimo-v2.5` - making it look like DeepSeek had answered a MiMo call. The gateway now returns a 404 listing the available provider ids, and `selectProvider` returns `undefined` on no match (the gateway has a separate 503 path for "no providers configured at all").

### Documentation

- **README "Demo" section** (DOC01): added a 3x3 screenshot grid covering the metrics dashboard, Copilot and Kilo Code model pickers, the vision proxy in action, gateway health and metrics endpoints, the output log, and the settings pages. Screenshots are stored in `resources/screenshots_v1.1.1/`.

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

First stable release.
AIFlowBridge brings DeepSeek, MiniMax, and Xiaomi MiMo into GitHub Copilot Chat with a local OpenAI-compatible gateway, transparent vision proxy, and usage metrics.

### Highlights

- **Multi-provider Copilot Chat**: DeepSeek V4 (Flash/Pro), MiniMax V2.7, Xiaomi MiMo V2.5/V2.5 Pro registered as native Copilot Chat model providers.
- **OpenAI-compatible gateway**: Local proxy on port 8787, with singleton detection across VS Code windows. Auto-routes Kilo Code, Continue, and any OpenAI-compatible client to the right upstream.
- **Transparent vision proxy**: All models expose the image-paste button in Copilot Chat. Images are converted to text descriptions by a configurable vision model, so even non-vision models can analyze attached screenshots and diagrams.
- **Metrics dashboard**: Per-provider, per-model request counts, tokens, latency, and estimated cost. Recent request history. Status bar indicator.
- **SecretStorage API keys**: All credentials live in the OS keychain, never in `settings.json`.

### Quality

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

**No breaking changes.** All settings, commands, and APIs from 0.x remain available.
Internal renames (`setVisionProxyModel` → `chooseVisionProxyModel`, `TODO_TRACKER_PREFIX` → `BACKGROUND_TRACKER_PREFIX`) are not user-facing.

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

- **mage analysis in Kilo Code**: Removed the vision proxy for Kilo Code. Kilo Code has its own `read` tool that handles image analysis transparently - the vision proxy was unnecessary for MiniMax, MiMo, and DeepSeek via Kilo Code. The vision proxy is now only used for GitHub Copilot (where `provideLanguageModelChatResponse` handles image conversion via `oswe-vscode-prime`).
- **ort occupancy error message**: Improved error handling when the gateway fails to start on port 8787. The extension now distinguishes between "gateway already running" (info message), "port occupied by another service" (descriptive warning), and "actual failure" (error message).

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
