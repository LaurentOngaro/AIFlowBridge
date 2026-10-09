# Architecture

> Part of the [agent instructions](../../AGENTS.md).

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
- **Standalone side:** `createStandaloneContext()` in `src/standalone/context.ts` uses the same unified key chain as the extension gateway (`src/aiflowbridge/api-key-sources.ts`): env vars (`AIFLOWBRIDGE_<VENDOR>_API_KEY`, or the bare `<VENDOR>_API_KEY` name as a fallback) first, then `<globalStorageDir>/secrets.json` (chmod 600). Hot-reload of `~/.aiflowbridge/config.json` via `fs.watch` + 5s `fs.watchFile` polling fallback (Windows).

Both hosts share the same `gateway.lock` file (in `<globalStorageUri>` on VS Code, in `~/.aiflowbridge/` on standalone), so only one process owns the gateway.
The version-aware probe / cooperative shutdown flow lives in `src/aiflowbridge/gateway/{probe,lock,server}.ts` and is reused as-is.

## Logging

- `src/logger.ts` wraps `vscode.LogOutputChannel` on the VS Code side, writes to stderr on standalone.
- Prefixed log levels: `[AIFlowBridge]`, `[Gateway]`, `[Telemetry]`, `[Vision]`, `[MiniMax]`, `[Xiaomi]`, `[DeepSeek]`.
- Inspect via `AIFlowBridge: Show logs` (VS Code) or stderr (standalone).

## Provider pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point, under a **single** `aiflowbridge` vendor id that fronts one unified provider:

- `aiflowbridge` - one `vscode.LanguageModelChatProvider` instance (`src/provider/unified.ts`) that delegates per model id to the matching sub-provider: `src/provider/index.ts` (DeepSeek V4.1 Flash / V4 Pro), `src/provider/minimax.ts` (MiniMax M2.7, M2.7 Highspeed, M3, M3.1 Flash Preview) and `src/provider/xiaomi.ts` (Xiaomi MiMo V2.5, V2.5 Pro, V2.6 Flash, V2.6 Pro, V2.6 Pro UltraSpeed). Both MiniMax and Xiaomi are HTTP streaming clients.
- `openrouter`, `zai`, `moonshot`, and `googleaistudio` are **gateway-only** - they do NOT appear in the Copilot Chat picker. They reach the bundled gateway through the OpenAI-compatible `/v1/chat/completions` endpoint on port 8787 and the gateway picks them up via the generic per-vendor provider profile synthesis. The 100+ other OpenRouter model ids are reachable by name verbatim through `curl` / Kilo Code / Continue. Attribution headers (`HTTP-Referer`, `X-Title`) are injected by `src/aiflowbridge/gateway/openrouter-headers.ts`.
- **The `googleaistudio` vendor carries two auth routes over the same model ids.** BYOK (native Gemini surface, `generativelanguage.googleapis.com`, an `AIzaSy...` key) is the default and the only route verified to work. The OAuth route (Cloud Code Assist, `cloudcode-pa.googleapis.com`; the project historically called it Antigravity - same feature) requires the Cloud project to be attached to the Cloud Code Assist programme and **has never produced a successful generation call**. Upstream quota refusals are classified by `src/aiflowbridge/gateway/quota-diagnostics.ts` into `rate-limited` / `quota-exhausted` / `zero-allocation` / `billing-exhausted`, logged, and published as `X-AIFlowBridge-Quota-State`. See `docs/providers.md`.

Model id convention: the `id` field in the registry IS the upstream API id (`MiniMax-M2.7`, `mimo-v2.6-pro`, `deepseek-flash`, `glm-5.3`, `kimi-k3`).
No kebab-case alias, no id translation map.
