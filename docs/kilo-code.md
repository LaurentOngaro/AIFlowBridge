# Connecting Kilo Code (Cursor / Windsurf / VSCodium / code-server) to the standalone gateway

[Kilo Code](https://kilocode.ai/) runs inside any VS Code fork.
It has a built-in OpenAI-compatible provider, so the AIFlowBridge standalone gateway is a drop-in.

## Configure

In the Kilo Code side panel: `Settings -> Providers -> API Provider -> OpenAI Compatible`

| Field     | Value                      |
| --------- | -------------------------- |
| Base URL  | `http://127.0.0.1:8787/v1` |
| API Key   | (any non-empty string)     |
| Model     | `deepseek-v4-pro`          |
| Streaming | Enabled                    |

Save. The picker now lists the model. Repeat for any other model from `GET /v1/models` if you want them all in the picker.

## Verify

Ask Kilo Code a question. The response should stream normally.
In the AIFlowBridge metrics dashboard (run `npm run start:standalone` from a terminal, or open the VS Code extension's `AIFlowBridge: Show metrics dashboard`) you should see a new row under **Recent requests**.

## Gemini tool calls and thought_signature

Gemini 2.5+ / 3.x thinking models (including `gemini-3.8-flash`) attach an opaque `thought_signature` to every `functionCall` part they return, and reject the next request with `400 Function call is missing a thought_signature` when the signature is not echoed back.
The gateway propagates the signature in both directions on the OpenAI `extra_signature` extension: `tool_calls[i].extra_signature` on the way out (response) and back in (request).
Kilo Code CLI's `openai-chat` protocol, however, drops unknown `extra_signature` fields when it persists conversation history between turns: the signature returned on turn N never reaches the gateway on turn N+1, so the upstream rejects the request even though the gateway translated everything correctly.
Workaround: set `aiflowbridge.gateway.injectThoughtSignature` to `true`.
The gateway then keeps an in-memory cache (`tool_call` id to signature, bounded to 500 entries, 30 min TTL, per gateway process) fed from every model response, and re-injects the cached signature into the Gemini / Antigravity envelope when the client replays a turn without it.
Client-supplied signatures always win over the cache; the cache only fills gaps.
The long-term fix belongs upstream (Kilo Code CLI should persist and replay `extra_signature`, mirroring how it already handles `reasoning_opaque`) - see `docs/providers.md` for the `extra_signature` contract.
