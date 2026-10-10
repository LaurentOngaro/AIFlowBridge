# Vision proxy

> Part of the [agent instructions](../../AGENTS.md).

The vision proxy is a transparent image-to-text converter that lets text-only models (DeepSeek, Xiaomi MiMo) handle pasted images by routing the description through another installed Copilot model.

## Location

`src/provider/vision/`:

- `model.ts` - vision model selector (`copilot` / `kilo`).
- `resolve.ts` - `describeImageParts()` - the function that converts image parts into a text description.
- `conversion.ts` - vscode.LM message conversion.
- `consts.ts` - default prompt, marker format.
- `types.ts` - shared types.
- `index.ts` - public re-exports.

## Configuration

| Setting                                  | Default              | Description                                                                  |
| ---------------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `aiflowbridge.vision.copilotVisionModel` | `oswe-vscode-prime`  | Model to use for vision proxy in GitHub Copilot                              |
| `aiflowbridge.vision.excludedVendors`    | `["aiflowbridge"]`   | Vendors hidden from the vision-model picker (does NOT change the proxy path) |
| `aiflowbridge.vision.prompt`             | (multi-line default) | Prompt used for vision proxy image descriptions                              |

The exclusion list only feeds `chooseVisionProxyModel()` (`model.ts:105-108`): it removes those vendors from the model list shown by `AIFlowBridge: Set vision proxy model`.
It does not decide which request takes the proxy.

That decision is hard-coded per provider, and it is broader than the docs used to claim:

- DeepSeek (`request.ts:64`) and every MiniMax model (`minimax.ts:194`) call `resolveImageMessages` unconditionally, so they are always proxied even though the registry declares `imageInput: true` on them.
- Xiaomi (`xiaomi.ts:192`) skips the proxy only when `modelInfo.id === 'mimo-v2.5'`; V2.5 Pro and the whole V2.6 suite are proxied.

The gateway path (`/v1/chat/completions`) has no proxy at all: image parts are forwarded verbatim and the upstream vendor decides.

## Fallback chain

The vision model getter (`getVisionModel()` in `model.ts`) tries in order:

1. `aiflowbridge.vision.copilotVisionModel` if it is registered as an available Copilot model.
2. Any model with `capabilities.imageInput: true` (excluding the configured `excludedVendors`).
3. The default `oswe-vscode-prime`.

## Marker format

The proxy wraps the description in `[Image Description: ...]` markers so downstream prompts can distinguish the synthesized description from user content.

## Custom prompt

Override `aiflowbridge.vision.prompt` to customize the description. The default is:

```
Describe all image attachments in this message.

If there is one image, describe it directly.
If there are multiple images:
1. Describe each image separately, preserving their order.
2. Then provide a combined description explaining the overall context.

Return one concise factual description suitable for inserting into a text-only chat prompt.
```
