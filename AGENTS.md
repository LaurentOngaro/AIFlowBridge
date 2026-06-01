# AIFlowBridge - Agent Instructions

## Project Overview

AIFlowBridge is a VS Code extension that provides multi-provider AI coding assistance through Copilot Chat and an OpenAI-compatible local gateway. It supports DeepSeek, MiniMax, and Xiaomi MiMo with usage metrics, vision proxy, and singleton gateway routing.

**Repository**: Originally forked from deepseek-v4-for-copilot, now significantly diverged
**Maintainer**: Laurent Ongaro (laurent@ongaro.fr)

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
│   ├── config.ts           # Config loading
│   ├── types.ts            # Type definitions
│   ├── index.ts            # Extension entry point
│   └── ui/                 # Dashboard & status bar
├── provider/               # Language model providers (Copilot Chat)
│   ├── base.ts             # Abstract base class
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
├── consts.ts               # MODELS registry, CONFIG_SECTION, API_KEY_SECRETS
├── auth.ts                 # SecretStorage wrapper
├── config.ts               # VS Code configuration access
├── i18n.ts                 # Translation helper (t() function)
├── logger.ts               # vscode.LogOutputChannel wrapper
└── extension.ts            # activate()/deactivate()
```

## Key Architectural Decisions

### Provider Pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point:

- `aiflowbridge` (DeepSeek V4 Pro/Flash) - registered under generic `aiflowbridge` vendor to coexist with provider-specific vendors
- `minimax` - MiniMax V2.7 (HTTP streaming client)
- `xiaomi` - Xiaomi MiMo V2.5 / V2.5 Pro (HTTP streaming client)

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

1. Add model definition to `src/consts.ts` (MODELS array)
2. Add provider registration to `package.json` (languageModelChatProviders)
3. Create provider-specific API client in `src/provider/`
4. Update gateway provider profiles in `src/aiflowbridge/providers.ts` (validation/normalization)
5. Update `EXTERNAL_URLS` in `src/consts.ts` for account/status links
6. Add provider-specific settings to `package.json` (`aiflowbridge.providers.{vendor}.*`)

### Adding a New Model

1. Add to `MODELS` array in `src/consts.ts`
2. Follow `ModelDefinition` interface (`src/types.ts`) with capabilities flags
3. Add to `package.nls.json` with `model.{id}.detail` translation
4. Update README.md provider table

## Important Files

| File                                     | Purpose                                            |
| ---------------------------------------- | -------------------------------------------------- |
| `src/consts.ts`                          | Model registry, compile-time constants, secret keys |
| `src/provider/vision/model.ts`           | Vision model selection (selector + fallback chain) |
| `src/aiflowbridge/gateway/server.ts`     | Local proxy with singleton detection               |
| `src/aiflowbridge/telemetry.ts`          | Usage tracking and cost estimation                 |
| `src/aiflowbridge/providers.ts`          | Gateway upstream provider normalization            |
| `src/logger.ts`                          | Prefixed logging via LogOutputChannel              |
| `src/i18n.ts`                            | Translation helper, English-only                   |
| `package.json`                           | Extension manifest, contributions, settings schema |

## Configuration

All settings use the `aiflowbridge.` prefix. Provider-specific settings use `aiflowbridge.providers.{vendor}.*`.

Vision proxy model is configurable via `aiflowbridge.vision.copilotVisionModel`. Vision proxy skipped for vendors in `aiflowbridge.vision.excludedVendors`.

Gateway provider profiles are configured as `aiflowbridge.providers: [...]` array (each with `id`, `label`, `kind`, `baseUrl`, `model`, `apiKey`).

## Testing

Run `npm test` for unit tests. The extension uses vitest for testing (237 tests across 13 files).

Quality gates:

- `npm run compile` - 0 TypeScript errors
- `npm test` - 237/237 passing

## Notes

- API keys stored in VS Code SecretStorage (OS keychain) - never in `settings.json`
- No Chinese files should exist in this project
- Gateway starts enabled by default on extension activation
- All code comments and docs in English
- Configuration section prefix: `aiflowbridge`
- Vision proxy is opt-out (excluded vendors) not opt-in
