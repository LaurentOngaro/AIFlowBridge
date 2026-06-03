# AIFlowBridge - Agent Instructions

## Project Overview

AIFlowBridge is a VS Code extension that provides multi-provider AI coding assistance through Copilot Chat and an OpenAI-compatible local gateway. It supports DeepSeek, MiniMax, and Xiaomi MiMo with usage metrics, vision proxy, and singleton gateway routing.

**Repository**: Originally forked from deepseek-v4-for-copilot, now significantly diverged
**Maintainer**: [Laurent Ongaro](https://github.com/LaurentOngaro)

## Code Standards

### Language

- All code, comments, and documentation must be in **English only**
- No Chinese localization files (package.nls.zh-cn.json, README.zh-cn.md, etc.)
- Use English for all user-facing strings

### Style Guidelines

- TypeScript with strict typing
- Use ES modules (import/export)
- Async/await for asynchronous operations
- Prefer const over let
- Use interface for object shapes

### File Structure

```
src/
├── aiflowbridge/           # Gateway, telemetry, UI module
│   ├── gateway/server.ts   # HTTP proxy server (singleton mode)
│   ├── telemetry.ts        # Usage metrics
│   ├── providers.ts        # Gateway upstream provider normalization
│   ├── config.ts           # Config loading (incl. gateway profiles)
│   ├── types.ts            # Type definitions
│   ├── index.ts            # Extension entry point
│   └── ui/                 # Dashboard & status bar
├── provider/               # Language model providers (Copilot Chat)
│   ├── base.ts             # Abstract base class (merges MODELS + userModels)
│   ├── index.ts            # DeepSeek provider (vendor: aiflowbridge)
│   ├── minimax.ts          # MiniMax provider
│   ├── xiaomi.ts           # Xiaomi MiMo provider
│   ├── vision/             # Transparent vision proxy
│   │   ├── model.ts        # Vision model selector (copilot/kilo)
│   │   ├── resolve.ts      # describeImageParts
│   │   ├── conversion.ts   # vscode message conversion
│   │   └── index.ts
│   ├── tools/              # Tool calling support
│   ├── replay/             # Reasoning replay (Xiaomi)
│   ├── debug/              # Request dumps
│   └── segment/            # Stream segmentation
├── runtime/                # Extension lifecycle, commands, diagnostics
│   ├── lifecycle.ts        # activate()/deactivate()
│   ├── commands.ts         # Command registrations
│   ├── addCustomModel.ts   # "Add a custom model" interactive command
│   ├── provider.ts         # Provider registration
│   └── actions.ts          # URI action handlers
├── consts.ts               # MODELS registry, CONFIG_SECTION, API_KEY_SECRETS
├── auth.ts                 # SecretStorage wrapper
├── config.ts               # VS Code configuration access (incl. getUserModels)
├── i18n.ts                 # Translation helper (t() function)
├── logger.ts               # vscode.LogOutputChannel wrapper
└── extension.ts            # activate()/deactivate()
```

## Key Architectural Decisions

### Provider Pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point:

- `aiflowbridge` (DeepSeek V4 Pro/Flash) - registered under generic `aiflowbridge` vendor to coexist with provider-specific vendors
- `minimax` (MiniMax M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3) - HTTP streaming client
- `xiaomi` (Xiaomi MiMo V2 Omni, V2 Pro, V2.5, V2.5 Pro) - HTTP streaming client

### Model Id Convention

**The `id` field in `MODELS` (and in `aiflowbridge.userModels`) is the upstream API id** (e.g. `MiniMax-M2.7`, `mimo-v2.5`, `deepseek-v4-flash`), NOT a kebab-case alias. The human-readable name shows in the Copilot Chat picker. This removes the need for any id translation map between VS Code and upstream.

### User-defined models

Users can extend the registry without an extension update via:

- **`aiflowbridge.userModels` setting**: array of `ModelDefinition`-shaped objects in `settings.json`
- **`AIFlowBridge: Add a custom model` command**: walks through the Command Palette to fetch a vendor's `/v1/models`, pick a model, declare capabilities, and save to the setting

The `BaseChatProvider.getModelsForVendor()` merges built-in `MODELS` with user-declared models at every read. The Copilot Chat picker refreshes automatically when `aiflowbridge.userModels` is edited.

### Provider Implementation

- `src/provider/base.ts` - Abstract base class for all providers
- `src/provider/index.ts` - DeepSeekChatProvider (original implementation)
- `src/provider/minimax.ts` - MiniMax provider with HTTP streaming client
- `src/provider/xiaomi.ts` - Xiaomi provider with HTTP streaming client

### Vision Proxy

Located in `src/provider/vision/`. Generic enough to work with any provider:

- Configurable model via `aiflowbridge.vision.copilotVisionModel` (default: `oswe-vscode-prime`)
- Vendor exclusion list (`aiflowbridge.vision.excludedVendors`, default: `["aiflowbridge"]`)
- Model getter falls back: configured ID → find any `imageInput: true` model → default
- Wraps descriptions in `[Image Description: ...]` markers
- Custom prompt via `aiflowbridge.vision.prompt`

### Gateway

Located in `src/aiflowbridge/gateway/server.ts`:

- OpenAI-compatible proxy on configurable port (default 8787)
- **Singleton mode**: detects occupied port and joins existing instance
- After `start()`, `config.gateway.port` and `config.gateway.baseUrl` are synced to the actual bound port (matters when `port: 0` is configured)
- Provider routing by model alias via `aiflowbridge.providers` array
- Request/response telemetry (counts, latency, tokens, estimated cost)
- Starts automatically if `aiflowbridge.gateway.enabled: true` (default)

### Logging

- `src/logger.ts` wraps `vscode.LogOutputChannel`
- Prefixed log levels: `[AIFlowBridge]`, `[Gateway]`, `[Vision]`, `[MiniMax]`, `[Xiaomi]`
- Accessible via "AIFlowBridge: Show Logs" command

## Common Tasks

### Building

```bash
npm run compile    # Compile TypeScript
npm run watch      # Watch mode
npm run package    # Build .vsix package
npm test           # Run vitest unit tests
```

### Adding a New Provider

1. Add model definition(s) to `src/consts.ts` (`MODELS` array). Use the **upstream API id** as `id`.
2. Add provider registration to `package.json` (`contributes.languageModelChatProviders`)
3. Create provider-specific API client in `src/provider/<vendor>.ts`
4. Update gateway provider profiles in `src/aiflowbridge/providers.ts` (validation/normalization)
5. Update `DEFAULT_GATEWAY_PROFILES` in `src/aiflowbridge/config.ts` (if the provider should be in the default gateway set)
6. Update `EXTERNAL_URLS` in `src/consts.ts` for account/status links
7. Add provider-specific settings to `package.json` (`aiflowbridge.providers.{vendor}.*`)

### Adding a New Model

1. Add to `MODELS` array in `src/consts.ts` with the **exact upstream API id** (use `AIFlowBridge: Add a custom model` or `curl /v1/models` to confirm)
2. Follow `ModelDefinition` interface (`src/types.ts`) with capabilities flags
3. Add to `package.nls.json` and `src/i18n.ts` with `model.{id}.detail` translation (key is the upstream id, not a kebab-case alias)
4. Update README.md provider table

## Important Files

| File                                 | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `src/consts.ts`                      | Model registry, compile-time constants, secret keys  |
| `src/provider/base.ts`               | Abstract provider + merge of `MODELS` + `userModels` |
| `src/provider/vision/model.ts`       | Vision model selection (selector + fallback chain)   |
| `src/aiflowbridge/gateway/server.ts` | Local proxy with singleton detection                 |
| `src/aiflowbridge/telemetry.ts`      | Usage tracking and cost estimation                   |
| `src/aiflowbridge/providers.ts`      | Gateway upstream provider normalization              |
| `src/runtime/addCustomModel.ts`      | "Add a custom model" command handler                 |
| `src/logger.ts`                      | Prefixed logging via LogOutputChannel                |
| `src/i18n.ts`                        | Translation helper, English-only                     |
| `src/config.ts`                      | VS Code configuration access + `getUserModels()`     |
| `package.json`                       | Extension manifest, contributions, settings schema   |

## Configuration

All settings use the `aiflowbridge.` prefix. Provider-specific settings use `aiflowbridge.providers.{vendor}.*`.

- **`aiflowbridge.userModels`**: array of `ModelDefinition`-shaped objects. Merged with the built-in `MODELS` registry on every read. User-declared models can override built-in ones with the same id. See README "Adding a model without waiting for a release" for details.
- **Vision proxy model**: `aiflowbridge.vision.copilotVisionModel` (default: `oswe-vscode-prime`)
- **Vision proxy vendor exclusion**: `aiflowbridge.vision.excludedVendors` (default: `["aiflowbridge"]`)
- **Gateway profiles**: `aiflowbridge.providers: [...]` array (each with `id`, `label`, `kind`, `baseUrl`, `model`, `apiKey`)
- **Model id overrides** (per-provider): `aiflowbridge.providers.<vendor>.modelIdOverrides` (maps the upstream id to a custom one)

## Testing

Run `npm test` for unit tests. The extension uses vitest for testing (291 tests across 19 files).

Quality gates:

- `npm run compile` - 0 TypeScript errors
- `npm test` - 291/291 passing

Test files of note:

- `tests/gateway.test.ts` - HTTP endpoints + singleton detection + telemetry persistence (20 tests)
- `tests/aiflowbridge-providers.test.ts` - gateway profile normalization + selection (26 tests)
- `tests/aiflowbridge-config.test.ts` - user-model synthesis into the gateway provider list (9 tests)
- `tests/minimax-resolveModelId.test.ts` - id passthrough + override
- `tests/token-counter.test.ts` - MiniMax `/v1/responses/input_tokens` wrapper (6 tests)
- `tests/userModels.test.ts` - user-declared model validation (6 tests)
- `tests/dashboard.test.ts` - metrics dashboard HTML builder (10 tests)
- `tests/telemetry-store.test.ts` - TelemetryStore record / snapshot / restore / reset (12 tests)

## Notes

- API keys stored in VS Code SecretStorage (OS keychain) - never in `settings.json`
- No Chinese files should exist in this project
- Gateway starts enabled by default on extension activation
- All code comments and docs in English
- Configuration section prefix: `aiflowbridge`
- Vision proxy is opt-out (excluded vendors) not opt-in
- Model ids in `MODELS` and `userModels` must match the upstream API exactly
- No id translation map: what you see in `MODELS` is what gets sent to the API
