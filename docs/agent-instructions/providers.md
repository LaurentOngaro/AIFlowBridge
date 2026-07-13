# Providers

> Part of the [agent instructions](../AGENTS.md).

## Provider pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point (`contributes.languageModelChatProviders` in `package.json`):

| Vendor         | Models                                                                           | Implementation                                                   |
| -------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `aiflowbridge` | DeepSeek V4 Pro, V4 Flash                                                        | `src/provider/index.ts` + `src/provider/unified.ts` (delegating) |
| `minimax`      | MiniMax M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3 | `src/provider/minimax.ts`                                        |
| `xiaomi`       | Xiaomi MiMo V2 Omni, V2 Pro, V2.5, V2.5 Pro                                      | `src/provider/xiaomi.ts`                                         |

`src/provider/unified.ts` exports `UnifiedChatProvider` - a single `vscode.LanguageModelChatProvider` implementation that delegates each model id to the correct per-vendor sub-provider, so the registry's mixed-vendor model list is exposed under one vendor label.

DeepSeek-specific helpers live next to the DeepSeek provider (`src/provider/{models,convert,stream,segment,errors,tokens,request}.ts`): message conversion to / from `vscode.LanguageModelChatMessage`, SSE stream parsing, stream segmentation around replay markers, upstream error normalization, token estimation for image parts, and the outgoing HTTP request setup.
MiniMax and Xiaomi providers reuse what is reusable and implement vendor-specific behavior in their own files.

The abstract base class is `src/provider/base.ts`, which reads from the registry cache (`getLoadedRegistry()`).

## Sub-modules

- **`src/provider/vision/`** - transparent vision proxy for text-only models. See [vision.md](vision.md).
- **`src/provider/tools/`** - tool-calling adapters (`flow`, `notices`, `consts`, `preflight`, `request`).
- **`src/provider/replay/`** - reasoning replay (Xiaomi requires `reasoning_content` to be echoed back in tool-call followups). Files: `markers`, `consts`, `types`, `index`.
- **`src/provider/debug/`** - request dumps for diagnosis (`dump`, `classifier`, `diagnostics`, `index`).

## Gateway provider profiles

The gateway upstream profile normalization lives in `src/aiflowbridge/providers.ts`:

- `normalizeProviderProfiles()` - validates `aiflowbridge.providers[]` from settings, applies SSRF protection (`isValidProviderBaseUrl()`), and dedupes by id.
- `redactProviderForLog()` / `redactProvidersForLog()` - strip `apiKey` from any log line.
- `selectProvider()` - case-insensitive model id lookup via `localeCompare(..., { sensitivity: 'base' })`.
- `synthesizeProvidersFromBuiltInModels()` / `synthesizeProvidersFromUserModels()` - auto-generate one catalog entry per registry / user model. The synthesis path is how the bundled `openrouter` vendor and its 7 flagship entries (plus any user-declared OpenRouter models on `family: "openrouter"`) reach the gateway without writing a dedicated `OpenRouterChatProvider` class.

For OpenRouter-specific upstream attributes (`HTTP-Referer`, `X-Title` attribution headers required by OpenRouter's reliability track), see the pure helper in `src/aiflowbridge/gateway/openrouter-headers.ts`.
The helper is wired into `forwardChatCompletion()` in `src/aiflowbridge/gateway/server.ts` and is no-op for any non-OpenRouter upstream.

SSRF protection (`isValidProviderBaseUrl()`) rejects:

- Non-http(s) schemes (`file:`, `gopher:`, `javascript:`, ...).
- Unparseable URLs.
- Cloud metadata endpoints (AWS/GCP/Azure `169.254.x.x`, Alibaba `100.100.100.200`, AWS IMDS-over-IPv6 `fd00:ec2::254`).
- IPv4-mapped IPv6 in decimal (`::ffff:1.2.3.4`) and hex (`::ffff:a9fe:a9fe`) forms.

Loopback (`127.x.x.x`, `::1`, `localhost`) is intentionally allowed for Ollama.

## Settings per provider

| Setting                                                       | Vendors | Description                                                      |
| ------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `aiflowbridge.providers.<vendor>.baseUrl`                     | All     | Upstream API base URL                                            |
| `aiflowbridge.providers.<vendor>.maxTokens`                   | All     | Maximum tokens per response (0 = default)                        |
| `aiflowbridge.providers.<vendor>.modelIdOverrides`            | All     | Map of registry id -> upstream id                                |
| `aiflowbridge.providers.minimax.temperature`                  | MiniMax | Sampling temperature (default 1)                                 |
| `aiflowbridge.providers.minimax.topP`                         | MiniMax | Nucleus sampling (default 1)                                     |
| `aiflowbridge.providers.minimax.reasoningSplit`               | MiniMax | Default `reasoning_split` value when no picker is shown          |
| `aiflowbridge.providers.xiaomi.reasoningRequiredForToolCalls` | Xiaomi  | Replay `reasoning_content` in tool-call followups (default true) |

## Adding a new provider / model

See [tasks.md](tasks.md#adding-a-new-provider) for the full workflow.
