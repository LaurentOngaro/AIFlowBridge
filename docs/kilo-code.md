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
In the AIFlowBridge metrics dashboard (press `Ctrl+Alt+M`, or run `AIFlowBridge: Show metrics dashboard` from the Command Palette) you should see a new row under **Recent requests**.
The dashboard is a VS Code webview: there is no dashboard served by the standalone CLI, so `npm run start:standalone` alone does not give you one.

## Reasoning effort: written for you, on activation

**Nothing to do in the common case.** When AIFlowBridge activates, it checks once whether Kilo Code is set up against the gateway and still does not offer the reasoning levels the registry declares, and if so it asks whether to write them.
The offer names the models, and one click does the work. Reload the Kilo Code window afterwards so it re-reads the file.

The check stays silent when it cannot help: no model declares a level range, no Kilo configuration exists, the file cannot be parsed, no Kilo provider points at the gateway, or the levels are already there.
That last part matters most. Someone who does not use AIFlowBridge through Kilo Code never sees the prompt, and someone who already ran the command never sees it twice.

To opt out permanently, set `aiflowbridge.kiloCode.promptReasoningLevels` to `false`, or pick **Don't ask again** in the prompt, which does the same thing.
To run it on demand, use **`AIFlowBridge: Configure Kilo Code reasoning levels`** from the Command Palette.

**What the command does.** It locates your Kilo configuration, finds the provider entries that point at the AIFlowBridge gateway, and writes one variant per reasoning level declared in the AIFlowBridge registry.
Nothing else is touched: your other providers, your API keys and your model fields are preserved, the write is atomic, and the file lands with mode 600 because it usually holds a provider key.
It refuses to write a configuration it cannot parse, and it says so instead of replacing the file, because losing a hand-tuned provider block is worse than a stale dropdown.
The whole file is rewritten, so comments in a `.jsonc` file are removed; the confirmation modal states this before anything is written.

Run it again after an AIFlowBridge update that adds or renames a level: it is idempotent, and it reports when there is nothing to do.

**Why activation rather than request time.** Kilo Code builds the dropdown when a session starts, so a write triggered by a request would arrive too late to fix the session that produced it.
An activation-time check also covers the next session without the user having to remember the command, and it costs one small file read.

### Why a command is needed

The reasoning dropdown next to the model picker is built by Kilo Code from the model's own `variants` list, so AIFlowBridge cannot change its entries from the request path.
`GET /v1/models` cannot carry them either: Kilo Code's auto-detection reads only `id` and `name` from the response body.
Variants are also declared per provider and per model, which is why the same model can show a correct list under one provider and a stale one under another: the native `minimax` provider carries Kilo Code's own catalog for it, while a custom provider pointing at the gateway carries only what your configuration declares.

Each variant is merged verbatim into the outgoing request body, so the value arrives at the gateway as `reasoning_effort`, which the gateway forwards upstream unchanged when the model declares that level.

### Where a `None` / `Thinking` pair usually comes from

Kilo Code's documentation suggests `variants: { thinking: { reasoning_split: true } }` for MiniMax on an OpenAI-compatible endpoint.
That snippet does exactly what it says, and nothing more: `reasoning_split` is a boolean that only decides whether the thinking comes back in `reasoning_content` instead of inline `<think>` tags.
It is not a depth, so a pair built on it gives the user a formatting switch, not a thinking switch, and `Thinking` collapses to the same upstream behaviour as `High` on a model whose depth comes from `reasoning_effort`.
The command above replaces such a pair with the declared levels.

### Doing it by hand instead

Kilo Code's provider dialog (`Settings -> Providers -> Custom provider`) can declare variants too: enable reasoning on the model card and add one variant per level, each with its `Reasoning effort` set to the level of the same name.
Two limits make it a worse experience than the command: the list stops at `xhigh`, so `max` needs the file form, and the whole file is rewritten either way.

For a model that declares `reasoningEffortLevels` in the registry (MiniMax M3.1 Flash: `low`, `medium`, `high`, `xhigh`, `max`):

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "provider": {
    "aiflowbridge": {
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "sk-aiflowbridge-local"
      },
      "models": {
        "MiniMax-M3.1-Flash": {
          "name": "MiniMax M3.1 Flash",
          "reasoning": true,
          "variants": {
            "low": { "reasoningEffort": "low" },
            "medium": { "reasoningEffort": "medium" },
            "high": { "reasoningEffort": "high" },
            "xhigh": { "reasoningEffort": "xhigh" },
            "max": { "reasoningEffort": "max" }
          }
        }
      }
    }
  }
}
```

Do not use the dialog's `effort` field to work around the missing `max`: that field is the *output* effort, not the reasoning depth, and MiniMax's OpenAI-compatible API does not take it.

The first row of the dropdown is Kilo's `Default`, which sends no `reasoning_effort` at all; the gateway then omits the field and the upstream applies its own default (`max` for MiniMax M3.1 Flash).

Do not declare a `none` variant for a model that declares `reasoningEffortLevels`: `reasoning_effort: "none"` is answered by MiniMax M3.1 Flash with HTTP 400, and the gateway drops a value the model does not declare and pins `reasoning_split: true`, so such an entry would promise something the model cannot do.
A model without `reasoningEffortLevels` (MiniMax M3 and earlier) keeps the historical triple: `none`, `high`, `max`, all mapped to the `reasoning_split` boolean.

See [reasoning.md](reasoning.md) for the per-model level tables and the resolution order.

## Gemini tool calls and thought_signature

Gemini 2.5+ / 3.x thinking models (including `gemini-3.8-flash`) attach an opaque `thought_signature` to every `functionCall` part they return, and reject the next request with `400 Function call is missing a thought_signature` when the signature is not echoed back.
The gateway propagates the signature in both directions on the OpenAI `extra_signature` extension: `tool_calls[i].extra_signature` on the way out (response) and back in (request).
Kilo Code CLI's `openai-chat` protocol, however, drops unknown `extra_signature` fields when it persists conversation history between turns: the signature returned on turn N never reaches the gateway on turn N+1, so the upstream rejects the request even though the gateway translated everything correctly.
Workaround: set `aiflowbridge.gateway.injectThoughtSignature` to `true`.
The gateway then keeps an in-memory cache (`tool_call` id to signature, bounded to 500 entries, 30 min TTL, per gateway process) fed from every model response, and re-injects the cached signature into the Gemini envelope when the client replays a turn without it.
Client-supplied signatures always win over the cache; the cache only fills gaps.
The long-term fix belongs upstream (Kilo Code CLI should persist and replay `extra_signature`, mirroring how it already handles `reasoning_opaque`) - see `docs/providers.md` for the `extra_signature` contract.
