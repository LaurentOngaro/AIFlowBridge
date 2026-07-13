# Architecture

> Part of the [agent instructions](../AGENTS.md).

## File structure (current as of 2.1.1)

The full source layout lives in [`docs/architecture.md`](../architecture.md) (user-facing, on GitHub). The agent-relevant additions to that tree are:

- `src/standalone/` - pure-Node.js CLI binary. Independent of `vscode`, compiled by `tsconfig.standalone.json`.
- `src/client/` - DeepSeek HTTP client (request/response/error helpers). The gateway uses the same `fetch` primitives.
- `src/aiflowbridge/ui/{dashboard,statusbar}.ts` - the webview + status bar controllers, with a "joined" state when the local extension detects a peer gateway already owning the port.
- `src/aiflowbridge/{token-counter,vscode-context-adapter,api-key-resolver,types,index}.ts` - the host-decoupling primitives.
- `src/provider/{unified,models,convert,stream,segment,errors,tokens,request}.ts` - DeepSeek-specific helpers and the `UnifiedChatProvider` (delegates to the per-vendor sub-providers under the `aiflowbridge` vendor).

## Host-agnostic core

The gateway + telemetry + UI logic lives in `src/aiflowbridge/` and is **independent of `vscode`**.
The decoupling uses an `IGatewayContext` interface (`src/aiflowbridge/types.ts`):

- **VS Code side:** `createVSCodeContext()` in `src/aiflowbridge/vscode-context-adapter.ts` wraps `vscode.ExtensionContext`. The lifecycle entry point (`src/runtime/lifecycle.ts`) calls `createVSCodeContext(context)` before `activateAIFlowBridge()`.
- **Standalone side:** `createStandaloneContext()` in `src/standalone/context.ts` reads API keys from env vars (`AIFLOWBRIDGE_<VENDOR>_API_KEY`) or `~/.aiflowbridge/secrets.json` (chmod 600). Hot-reload of `~/.aiflowbridge/config.json` via `fs.watch` + 5s `fs.watchFile` polling fallback (Windows).

Both hosts share the same `gateway.lock` file (in `<globalStorageUri>` on VS Code, in `~/.aiflowbridge/` on standalone), so only one process owns the gateway.
The version-aware probe / cooperative shutdown flow lives in `src/aiflowbridge/gateway/{probe,lock,server}.ts` and is reused as-is.

## Logging

- `src/logger.ts` wraps `vscode.LogOutputChannel` on the VS Code side, writes to stderr on standalone.
- Prefixed log levels: `[AIFlowBridge]`, `[Gateway]`, `[Telemetry]`, `[Vision]`, `[MiniMax]`, `[Xiaomi]`, `[DeepSeek]`.
- Inspect via `AIFlowBridge: Show logs` (VS Code) or stderr (standalone).

## Provider pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point:

- `aiflowbridge` (DeepSeek V4 Pro / V4 Flash) - registered under generic `aiflowbridge` vendor to coexist with provider-specific vendors.
- `minimax` (MiniMax M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3) - HTTP streaming client.
- `xiaomi` (Xiaomi MiMo V2 Omni, V2 Pro, V2.5, V2.5 Pro) - HTTP streaming client.
- `openrouter` is **gateway-only** - the bundled registry declares seven free-tier flagships (`nvidia/nemotron-3-ultra-550b-a55b:free`, `openai/gpt-oss-120b:free`, `google/gemma-4-31b-it:free`, `meta-llama/llama-3.3-70b-instruct:free`, `qwen/qwen3-coder:free`, `qwen/qwen3-next-80b-a3b-instruct:free`, `nvidia/nemotron-3-super-120b-a12b:free`) but they are NOT surfaced in the Copilot Chat picker. They reach the bundled gateway through the OpenAI-compatible `/v1/chat/completions` endpoint on port 8787 and the gateway picks them up via the generic per-vendor provider profile synthesis (no per-vendor `OpenRouterChatProvider` class). The 100+ other OpenRouter model ids are reachable by name verbatim through `curl` / Kilo Code / Continue. Attribution headers (`HTTP-Referer`, `X-Title`) are injected by `src/aiflowbridge/gateway/openrouter-headers.ts`.

Model id convention: the `id` field in the registry IS the upstream API id (`MiniMax-M2.7`, `mimo-v2.5-pro`, `deepseek-v4-flash`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `openai/gpt-oss-120b:free`).
No kebab-case alias, no id translation map.
