# MiniMax M3 reasoning mode

> Part of the [AIFlowBridge documentation](../README.md).

MiniMax M3 supports an optional reasoning mode. AIFlowBridge exposes a **"Thinking Effort"** selector in the Copilot Chat model picker for M3 only (None / High / Max). The selection is translated to the upstream `reasoning_split` boolean:

| Picker | `reasoning_split` | Effect                                                   |
| ------ | ----------------- | -------------------------------------------------------- |
| `None` | `false`           | Plain response, no reasoning tokens                      |
| `High` | `true`            | Reasoning tokens split into a separate field (default)   |
| `Max`  | `true`            | Same as `High` (MiniMax does not expose a higher effort) |

If you do not touch the selector, the global `aiflowbridge.providers.minimax.reasoningSplit` setting is honored as the fallback (default: `true`).

## For OpenAI-compatible clients (Kilo Code, Continue) using the local gateway

The gateway translates Kilo Code's `reasoning: true/false` checkbox field into the upstream `reasoning_split` boolean on the fly (`src/aiflowbridge/gateway/server.ts`, `translatePayloadForUpstream`). No configuration needed - toggle the reasoning checkbox in the AIFlowBridge provider settings and the change is reflected on the wire.

```ts
// Kilo Code sends:
{ "model": "MiniMax-M3", "reasoning": true, "messages": [...] }

// Gateway translates to upstream:
{ "model": "MiniMax-M3", "reasoning_split": true, "messages": [...] }
```

## Enabling the picker on another M-series model

To add the thinking-effort selector to M2 / M2.1 / M2.5 / M2.7 (none of which ship with it in the bundled registry):

**Option A** - `aiflowbridge.userModels`:

```json
{
  "aiflowbridge.userModels": [
    {
      "id": "MiniMax-M2.7",
      "name": "MiniMax M2.7 (thinking)",
      "family": "minimax",
      "version": "m2.7",
      "maxInputTokens": 131072,
      "maxOutputTokens": 8192,
      "capabilities": { "toolCalling": true, "imageInput": false, "thinking": true },
      "requiresThinkingParam": false
    }
  ]
}
```

The 3-tier registry merge picks it up immediately on the next Copilot Chat reload.

**Option B** - Registry override. See [architecture.md](architecture.md#model-registry).
