# Changelog

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
