# Vision proxy

> Part of the [AIFlowBridge documentation](../README.md).

Text-only models (DeepSeek, MiniMax, Xiaomi text-only) handle images via a transparent proxy through another installed Copilot model.

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
If VS Code cannot find it, the vision call fails with `Vision model not found` (see [troubleshooting.md](troubleshooting.md#vision-model-not-found)).

## Vendor exclusion

Some vendors handle images natively (MiniMax M3, Xiaomi MiMo V2 Omni, Xiaomi MiMo V2.5).
For these models, the vision proxy is skipped entirely - the upstream provider receives the image directly.

| Setting                               | Default            | Description                                                 |
| ------------------------------------- | ------------------ | ----------------------------------------------------------- |
| `aiflowbridge.vision.excludedVendors` | `["aiflowbridge"]` | Vendors whose models should NOT go through the vision proxy |

The default `["aiflowbridge"]` is a no-op safety: the bundled registry already marks each model's vision capability, so the proxy only runs when needed.
The setting only matters when you register user-defined models via `AIFlowBridge: Add a custom model` with a `family` you want to exclude.

## Custom prompt

The default image-to-text prompt is built into the extension. Override it if you need different behavior (e.g. extract specific metadata, language-specific output):

```json
{
  "aiflowbridge.vision.prompt": "Describe this image in detail, focusing on anything relevant to a software developer. Output plain text only."
}
```

Markdown rendering is automatic; the result is appended to the user message.

## Why not just use a vision model directly?

For models that _do_ support vision natively, AIFlowBridge passes images straight to the upstream - no extra round-trip. The proxy only kicks in for the models that don't.
This means:

- Native-vision models (MiniMax M3, Xiaomi MiMo V2 Omni/V2.5) get **full image detail** end-to-end
- Text-only models get a **text description** that the model can reason about (slower but workable)
- You don't have to maintain a side-by-side config of "which model needs vision vs. which doesn't" - the registry declares it once

## Cost impact

The vision proxy's text description is appended to the upstream prompt, adding to the request's prompt-token count.
The proxy step itself runs against `aiflowbridge.vision.copilotVisionModel`, which under the default configuration is **free** for Copilot subscribers.

If `aiflowbridge.vision.copilotVisionModel` is changed to a paid model, that model bills the description-generation call. See [cost.md](cost.md#vision-heavy-workload-saves-more).
