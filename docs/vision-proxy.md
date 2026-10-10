# Vision proxy

> Part of the [AIFlowBridge documentation](../README.md).

In Copilot Chat, pasted images are turned into a text description by another installed Copilot model, and that description is injected into the prompt.
This covers every DeepSeek and MiniMax model, and every Xiaomi MiMo model except `mimo-v2.5`, which is the only model whose upstream receives the image bytes directly.

The gateway does **not** run this step: a request that goes through `http://127.0.0.1:8787/v1` (Kilo Code, Continue, `curl`) forwards its image parts unchanged, and the upstream vendor decides what to do with them.
Everything on this page describes the Copilot Chat path.

## How it works

1. The user pastes an image into Copilot Chat
2. AIFlowBridge intercepts the message (the extension's `vscode.lm` request goes through `src/provider/vision/`)
3. The image is sent to a vision-capable model for a description
4. The description is injected into the text-only model's prompt
5. The text-only model responds as if the description were the user's original content

The flow is transparent: the user sees the model they picked in the picker, the vision step happens behind the scenes, and no configuration is required.

## Default vision model

| Setting                                  | Default             |
| ---------------------------------------- | ------------------- |
| `aiflowbridge.vision.copilotVisionModel` | `oswe-vscode-prime` |

`oswe-vscode-prime` is bundled with a GitHub Copilot subscription. **If you already pay for Copilot, vision calls cost $0** through AIFlowBridge - instead of paying for a vision-capable upstream model.

## Changing the vision model

Run from the Command Palette:

```
AIFlowBridge: Set vision proxy model
```

Or set the value directly in `settings.json`:

```json
{
  "aiflowbridge.vision.copilotVisionModel": "claude-3.5-sonnet"
}
```

The configured model must be **already registered** with VS Code.
If VS Code cannot find it, AIFlowBridge logs a `[Vision]` warning and falls back to the default model, so the request still completes.
If no vision-capable model is available at all, the prompt gets an explicit "image description unavailable" placeholder instead of a crash.
See [troubleshooting.md](troubleshooting.md#vision-model-not-found).

## Which models go through the proxy

The decision is hard-coded per provider, not driven by a setting:

| Provider    | Models                                              | Path                             |
| ----------- | --------------------------------------------------- | -------------------------------- |
| DeepSeek    | V4.1 Flash, V4 Pro                                  | Vision proxy                     |
| MiniMax     | M2.7, M2.7 Highspeed, M3, M3.1 Flash Preview        | Vision proxy                     |
| Xiaomi MiMo | `mimo-v2.5`                                         | Native (upstream receives bytes) |
| Xiaomi MiMo | V2.5 Pro, V2.6 Flash, V2.6 Pro, V2.6 Pro UltraSpeed | Vision proxy                     |

The registry declares `imageInput: true` on the DeepSeek, MiniMax and Xiaomi entries, which is what makes VS Code show the paste-image button.
The description step below still runs for those models unless the code path above says otherwise, so "the paste button is visible" and "the image bytes reach the upstream" are two different things.

## Vendor exclusion

The `aiflowbridge.vision.excludedVendors` setting only filters the model picker shown by `AIFlowBridge: Set vision proxy model`, so you cannot accidentally choose a model from an excluded vendor as the description model.

| Setting                               | Default            | Description                                                                  |
| ------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `aiflowbridge.vision.excludedVendors` | `["aiflowbridge"]` | Vendors hidden from the vision-model picker (does not change the proxy path) |

The default `["aiflowbridge"]` hides AIFlowBridge's own models from the picker, which is sensible since the description model should be a different one.
It has no effect on which request path a model takes: the table above is the real rule.

## Custom prompt

The default image-to-text prompt is built into the extension. Override it if you need different behavior (e.g. extract specific metadata, language-specific output):

```json
{
  "aiflowbridge.vision.prompt": "Describe this image in detail, focusing on anything relevant to a software developer. Output plain text only."
}
```

Markdown rendering is automatic; the result is appended to the user message.

## Why not just use a vision model directly?

For models that do pass images upstream natively, AIFlowBridge forwards the bytes directly and there is no extra round-trip.
For every other model, the model reasons about a text description instead (slower but workable).
Concretely:

- `mimo-v2.5` gets **full image detail** end-to-end
- Every other DeepSeek, MiniMax and Xiaomi model gets a **text description** that the model can reason about
- You don't have to maintain a side-by-side config of "which model needs vision vs. which doesn't" - the provider code decides

## Cost impact

The vision proxy's text description is appended to the upstream prompt, adding to the request's prompt-token count.
The proxy step itself runs against `aiflowbridge.vision.copilotVisionModel`, which under the default configuration is **free** for Copilot subscribers.

If `aiflowbridge.vision.copilotVisionModel` is changed to a paid model, that model bills the description-generation call. See [cost.md](cost.md#vision-heavy-workload-saves-more).
