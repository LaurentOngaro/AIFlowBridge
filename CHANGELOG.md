# Changelog

## 0.5.1 - AIFlowBridge

### Changed

- **Code cleanup**: Removed duplicate `getConfiguredVisionModelId()` function in `src/provider/vision/model.ts` (was a byte-identical copy of `getVisionModelId()`). Unified on a single function used by both `createVisionModelGetter` and `setVisionProxyModel`.
- **i18n cleanup**: Removed unused translation keys `vision.proxyUsing` and `vision.notFound` from `src/i18n.ts` and `package.nls.json` (vestiges from the old code that used `t()` instead of the logger).

## 0.5.0 - AIFlowBridge

### Fixed

- **BUG01 - Image analysis in Kilo Code**: Removed the vision proxy for Kilo Code. Kilo Code has its own `read` tool that handles image analysis transparently — the vision proxy was unnecessary for MiniMax, MiMo, and DeepSeek via Kilo Code. The vision proxy is now only used for GitHub Copilot (where `provideLanguageModelChatResponse` handles image conversion via `oswe-vscode-prime`).
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
