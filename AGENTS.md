# AIFlowBridge - Agent Instructions

## Project Overview

AIFlowBridge is a VS Code extension that provides multi-provider AI coding assistance through Copilot Chat. It extends the original DeepSeek V4 for Copilot extension to support multiple AI providers (DeepSeek, MiniMax, Xiaomi MiMo) with additional features like usage metrics and local proxy routing.

**Repository**: Fork of deepseek-v4-for-copilot, now significantly diverged
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
├── aiflowbridge/           # New gateway/telemetry module
│   ├── gateway/server.ts    # HTTP proxy server
│   ├── telemetry.ts         # Usage metrics
│   ├── providers.ts         # Provider normalization
│   ├── config.ts            # Config loading
│   ├── types.ts             # Type definitions
│   └── ui/                  # Dashboard & status bar
├── provider/                # Language model providers (existing)
│   ├── index.ts             # DeepSeek provider
│   ├── minimax.ts           # MiniMax provider
│   ├── xiaomi.ts            # Xiaomi provider
│   ├── vision/              # Transparent vision proxy
│   └── ...
├── runtime/                 # Extension lifecycle
└── ...
```

## Key Architectural Decisions

### Provider Pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point:

- `deepseek` - DeepSeek V4 Pro/Flash (fully implemented)
- `minimax` - MiniMax V2.7 (API client implemented, basic streaming)
- `xiaomi` - Xiaomi MiMo (API client implemented, basic streaming)

### Provider Implementation

- `src/provider/base.ts` - Abstract base class for all providers
- `src/provider/index.ts` - DeepSeekChatProvider (original implementation)
- `src/provider/minimax.ts` - MiniMax provider with HTTP streaming client
- `src/provider/xiaomi.ts` - Xiaomi provider with HTTP streaming client

### Vision Proxy

Located in `src/provider/vision/`. Generic enough to work with any non-vision provider:

- Configurable vendor exclusion list (`aiflowbridge.vision.excludedVendors`)
- Uses any Copilot model for image description
- Wraps descriptions in `[Image Description: ...]` markers

### Gateway

Located in `src/aiflowbridge/gateway/server.ts`:

- OpenAI-compatible proxy on configurable port (default 8787)
- Provider routing by model alias
- Request/response telemetry
- Starts automatically if `aiflowbridge.gateway.enabled: true`

## Common Tasks

### Building

```bash
npm run compile    # Compile TypeScript
npm run watch      # Watch mode
npm run package   # Build .vsix package
```

### Adding a New Provider

1. Add model definition to `src/consts.ts` (MODELS array)
2. Add provider registration to `package.json` (languageModelChatProviders)
3. Create provider-specific API client in `src/provider/`
4. Update vision proxy exclusion list if needed

### Adding a New Model

1. Add to `MODELS` array in `src/consts.ts`
2. Follows `ModelDefinition` interface with capabilities flags

## Important Files

| File                                 | Purpose                                            |
| ------------------------------------ | -------------------------------------------------- |
| `src/consts.ts`                      | Model registry and compile-time constants          |
| `src/provider/vision/model.ts`       | Vision proxy model selection (vendor exclusion)    |
| `src/aiflowbridge/gateway/server.ts` | Local proxy for metrics/routing                    |
| `src/aiflowbridge/telemetry.ts`      | Usage tracking and cost estimation                 |
| `package.json`                       | Extension manifest, contributions, settings schema |

## Configuration

All settings use the `aiflowbridge.` prefix. Provider-specific settings use `aiflowbridge.providers.{vendor}.*`.

Vision proxy excluded vendors are configurable via:

```json
"aiflowbridge.vision.excludedVendors": ["deepseek", "other-vendor"]
```

## Testing

Run `npm run test` for unit tests. The extension uses vitest for testing.

## Notes

- API keys stored in VS Code SecretStorage (OS keychain)
- No Chinese files should exist in this project
- Gateway starts enabled by default on extension activation
- All code comments and docs in English
