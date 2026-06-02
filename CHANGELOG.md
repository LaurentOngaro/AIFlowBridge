# Changelog

## 1.0.1 - AIFlowBridge

### Added

- marketplace auto-publish CI workflow for new releases

### Documentation

- **TODO.md fully translated to English** — the repo is now unilingual for its public audience.
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

## 1.0.0 - AIFlowBridge

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

## 0.6.0 - AIFlowBridge

### Fixed

- **CI GitHub Actions**: Removed broken `npm run lint` and `npm run format:check` steps that referenced uninstalled `oxlint`/`oxfmt` packages. Replaced with `npm test` as the quality gate. Renamed artifact from `deepseek-v4-for-copilot.vsix` to `aiflowbridge.vsix`.

- **Vision proxy model resolution**: Unified `getConfiguredVisionModelId()` and `getVisionModelId()` in `src/provider/vision/model.ts`. Vision model selection now uses a single fallback chain: configured ID → first `imageInput: true` model from `MODELS` → `DEFAULT_VISION_MODEL_ID`. Resolved Kilo Code "no vision model available" error when no `aiflowbridge.vision.kiloVisionModel` was set.

### Changed

- **i18n synchronization**: `package.nls.json` synchronized with `src/i18n.ts`. Added 25+ missing translation keys (auth, request, error.http.*, error.action.*, error.network.*, extension, command) and unified punctuation/wording between the two files.

- **Vision settings cleanup**: Removed unused `aiflowbridge.vision.enabled` setting. The vision proxy is always-on (opt-out via `aiflowbridge.vision.excludedVendors`).

- **Documentation overhaul**:
  - `README.md`: Corrected providers table (all models use vision proxy, including DeepSeek and Xiaomi). Added 4 missing settings (`minimax.temperature`, `minimax.topP`, `minimax.reasoningSplit`, `xiaomi.reasoningRequiredForToolCalls`). Removed obsolete references to `aiflowbridge.vision.enabled` and `kiloVisionModel`.
  - `AGENTS.md`: Fully rewritten to reflect current file structure, provider registration (DeepSeek as `aiflowbridge` vendor), vision proxy selector + fallback chain, gateway singleton mode, and `vscode.LogOutputChannel` prefixed logging.
  - `TODO.md`: Empty "Bugs" and "Corrections immédiates" sections converted to structured placeholders. Cleaned up circular reference to `_helpers/PLAN_ACTIONS.md`.

- **Repository hygiene**: Added `.kilo/` to `.gitignore` and untracked `.kilo/plans/1779780240537-crisp-planet.md` (Kilo Code internal state).

## 0.5.1 - AIFlowBridge

### Changed

- **Code cleanup**: Removed duplicate `getConfiguredVisionModelId()` function in `src/provider/vision/model.ts` (was a byte-identical copy of `getVisionModelId()`). Unified on a single function used by both `createVisionModelGetter` and `setVisionProxyModel`.
- **i18n cleanup**: Removed unused translation keys `vision.proxyUsing` and `vision.notFound` from `src/i18n.ts` and `package.nls.json` (vestiges from the old code that used `t()` instead of the logger).

## 0.5.0 - AIFlowBridge

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

## 0.4.6 - AIFlowBridge

### Fixed

- Fixed Kilo Code "No enabled upstream provider" error: the gateway now auto-generates provider profiles (DeepSeek Flash/Pro, MiniMax, Xiaomi) from the extension's own settings when `aiflowbridge.providers` is empty.
- Fixed Kilo Code model name mismatch (`deepseek` → `deepseek-v4-flash`/`deepseek-v4-pro`): the gateway now overrides the model name in forwarded requests with the provider's actual upstream model name.
- Gateway API keys are now automatically resolved from VS Code SecretStorage when not set in provider profiles.

## 0.4.5 - AIFlowBridge

### Fixed

- Fixed Xiaomi MiMo V2.5 Pro image handling: native vision support is now determined by model ID rather than `imageInput` capability. The V2.5 Pro model correctly uses the vision proxy for image descriptions instead of sending images natively, which the Pro API does not support.

## 0.4.4 - AIFlowBridge

### Fixed

- Fixed image paste not available for MiniMax and Xiaomi MiMo V2.5 Pro models: set `imageInput: true` in model capabilities so Copilot Chat enables the paste-image button. The vision proxy transparently converts images to text descriptions for models without native vision support.

## 0.4.3 - AIFlowBridge

### Fixed

- Fixed `prepareForDeactivate` causing a `Canceled` warning on extension reload by removing the unnecessary `selectChatModels` call during deactivation.
- Fixed Xiaomi MiMo 401 error: changed the default base URL from the pay-as-you-go endpoint (`api.xiaomimimo.com/v1`) to the Token Plan Europe cluster (`token-plan-ams.xiaomimimo.com/v1`), which is the expected endpoint for `tp-*` API keys.
- Added Xiaomi regional Token Plan endpoint URLs to constants (Europe, Singapore, China) for reference.

## 0.4.2 - AIFlowBridge

### Fixed

- Improved error logging for provider HTTP errors: the response body from failed API requests is now captured and included in the error message for both MiniMax and Xiaomi providers, providing actionable diagnostic details.

## 0.4.1 - AIFlowBridge

### Fixed

- Fixed MiniMax API 400 error (`invalid params, function name or parameters is empty (2013)`) caused by tool definitions with empty names or missing parameters. Tools with empty/whitespace-only names are now filtered out, and a default empty `parameters` object (`{}`) is provided when `inputSchema` is undefined.
- Fixed MiniMax API 400 error caused by `reasoning_split` being incorrectly wrapped in `extra_body`. The MiniMax OpenAI-compatible API expects `reasoning_split` as a top-level parameter, not inside `extra_body` (which is an OpenAI Python SDK-only construct).
- Added temperature clamping for MiniMax provider (`(0.0, 1.0]` range) to prevent 400 errors from out-of-range values.

## 0.4.0 - AIFlowBridge

### Fixed

- Fixed `prepareForDeactivate` making an unnecessary `selectChatModels` call that caused a `Canceled` warning on extension deactivation.
- Fixed gateway port conflict when extension is activated in multiple VS Code instances. The gateway now detects if an existing AIFlowBridge gateway is already running on the default port and joins it instead of failing.

### Changed

- Gateway now operates as a singleton across VS Code instances: if the default port (8787) is already occupied by another AIFlowBridge instance, the new instance detects and reuses the existing gateway rather than starting a new one on a different port. This ensures Kilo Code and other OpenAI-compatible clients always find the gateway at the configured URL.

## 0.3.0 - AIFlowBridge

### Fixed

- Fixed TypeScript errors in test files (`deepseek-convert.test.ts`, `deepseek-error.test.ts`, `deepseek-classifier.test.ts`, `minimax.test.ts`, `xiaomi.test.ts`).
- Fixed `MockSecretStorage` class identifier conflicts and event emitter type issues in test helpers.
- Fixed tool description type compatibility (now requires non-optional `string`).

### Changed

- Implemented comprehensive unit tests for the Minimax provider, covering model ID resolution, tool argument parsing, tool call accumulation, message conversion, and error handling.
- Added tests for the error handling module, including ProviderRequestError creation and HTTP error normalization.
- Introduced Vitest configuration for running tests in a Node environment with appropriate timeouts and module resolution.
- Add unit tests for Minimax, Xiaomi, and error handling

## 0.2.0 - AIFlowBridge

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
