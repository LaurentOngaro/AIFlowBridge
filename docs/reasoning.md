# MiniMax reasoning modes

> Part of the [AIFlowBridge documentation](../README.md).

Two different shapes coexist, decided per model by the registry, not by the vendor.

## MiniMax M3: optional reasoning (None / High / Max)

MiniMax M3 supports an optional reasoning mode. AIFlowBridge exposes a **"Thinking Effort"** selector in the Copilot Chat model picker for M3.
The selection is translated to the upstream `reasoning_split` boolean:

| Picker | `reasoning_split` | Effect                                                   |
| ------ | ----------------- | -------------------------------------------------------- |
| `None` | `false`           | Plain response, no reasoning tokens                      |
| `High` | `true`            | Reasoning tokens split into a separate field (default)   |
| `Max`  | `true`            | Same as `High` (MiniMax does not expose a higher effort) |

If you do not touch the selector, the global `aiflowbridge.providers.minimax.reasoningSplit` setting is honored as the fallback (default: `true`).

## MiniMax M3.1 Flash Preview: always-on reasoning with 5 depth levels

M3.1 Flash Preview always thinks: the upstream answers HTTP 400 (`requires adaptive thinking`) to `reasoning_split: false`, `thinking.type: "disabled"` and `reasoning_effort: "none"`.
Its **depth** is tunable through the upstream `reasoning_effort` field, which accepts five levels:

| Picker       | `reasoning_effort` | Effect                                                        |
| ------------ | ------------------ | ------------------------------------------------------------- |
| `Low`        | `low`              | Shortest thinking, lowest latency                             |
| `Medium`     | `medium`           | Deeper thinking for multi-step tasks                          |
| `High`       | `high`             | Strong default for heavy work                                 |
| `Extra high` | `xhigh`            | Near-maximum depth for very hard problems                     |
| `Max`        | `max`              | Maximum depth (the upstream default when the field is absent) |

There is no `None` entry, because the model cannot answer without thinking.
`reasoning_split` is pinned to `true` so the thinking arrives in the `reasoning_content` field, which is what the stream reader consumes.

**Resolution order** for the value sent upstream:

1. the Copilot Chat "Thinking Effort" selection, when it is one of the five levels;
2. the `aiflowbridge.providers.minimax.reasoningEffort` setting, when it is one of the five levels;
3. `max`, the upstream default.

That order lives in `resolveEffortLevel()` (`src/provider/models.ts`) and `resolveMiniMaxReasoning()` (`src/provider/minimax.ts`), both pure functions.

The same applies on the gateway path: a client (Kilo Code, Continue, `curl`) that sends `reasoning_effort: "xhigh"` to M3.1 Flash Preview gets that exact value forwarded upstream, instead of the historical collapse into `reasoning_split`.
A value the model does not declare is dropped so the upstream applies its own default rather than failing.

## For OpenAI-compatible clients (Kilo Code, Continue) using the local gateway

The gateway translates Kilo Code's `reasoning: true/false` checkbox field into the upstream `reasoning_split` boolean on the fly (`src/aiflowbridge/gateway/server.ts`, `translatePayloadForUpstream`).
No configuration needed - toggle the reasoning checkbox in the AIFlowBridge provider settings and the change is reflected on the wire.

```ts
// Kilo Code sends:
{ "model": "MiniMax-M3", "reasoning": true, "messages": [...] }

// Gateway translates to upstream:
{ "model": "MiniMax-M3", "reasoning_split": true, "messages": [...] }
```

On a model that declares `reasoningEffortLevels`, the dropdown values pass through instead of collapsing into the boolean:

```ts
// Kilo Code sends:
{ "model": "MiniMax-M3.1-Flash-Preview", "reasoning_effort": "xhigh", "messages": [...] }

// Gateway forwards:
{ "model": "MiniMax-M3.1-Flash-Preview", "reasoning_effort": "xhigh", "reasoning_split": true, "messages": [...] }
```

**The list Kilo Code displays is not AIFlowBridge's to choose.** Kilo Code renders its reasoning dropdown from the model's `variants` list, which it reads from its own configuration, and it does not read variant metadata from `GET /v1/models`.
A model that declares `reasoningEffortLevels` in the registry therefore shows whatever entries the Kilo configuration declares, which is why the five levels have to be written there: AIFlowBridge offers to do it on activation, see [kilo-code.md#reasoning-effort-written-for-you-on-activation](kilo-code.md#reasoning-effort-written-for-you-on-activation).

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

**Option B** - Registry override. See [architecture.md](architecture.md#model-registry-3-tier).

## Declaring a tunable depth on another model

A model whose upstream exposes a real `reasoning_effort` field gets the same treatment as M3.1 Flash Preview by declaring `reasoningEffortLevels` in its registry entry.
The list is the dropdown content, in ascending order, and the selected value is forwarded verbatim:

```json
{
  "id": "some-model",
  "family": "minimax",
  "capabilities": { "toolCalling": true, "imageInput": false, "thinking": true },
  "requiresThinkingParam": true,
  "reasoningEffortLevels": ["low", "medium", "high", "xhigh", "max"]
}
```

Omit the field and the model keeps the historical None / High / Max dropdown mapped to `reasoning_split`.
A list without `none` means thinking cannot be switched off, which is the usual case for an always-reasoning upstream.

## Always-on reasoning models (Z.ai GLM 5.3 and MoonshotAI Kimi)

Z.ai GLM 5.3 (`glm-5.3`, `glm-5.3-flash`, `glm-5.3-flashx`) and MoonshotAI Kimi (`kimi-k3`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`) are **always-on thinking models**.
Their upstream APIs reject any request that attempts to disable thinking (for example sending `thinking: { type: "disabled" }` returns HTTP 400 on GLM 5.3).

- **Gateway behavior**: The gateway forwards the client payload directly without injecting thinking-disable parameters.
- **Client configuration**: When connecting Kilo Code, Continue, or custom OpenAI SDK scripts, pass `reasoning_effort` (`low` / `high` / `max`, default `max`) to tune reasoning depth rather than attempting to disable reasoning.
- **MoonshotAI Kimi K2.6 exception**: `kimi-k2.6` is the only current Moonshot model where thinking can be toggled on or off (`requiresThinkingParam: false`).
