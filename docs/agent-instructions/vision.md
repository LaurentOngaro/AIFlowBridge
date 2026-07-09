# Vision proxy

> Part of the [agent instructions](../AGENTS.md).

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

| Setting                                  | Default              | Description                                                                                          |
| ---------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `aiflowbridge.vision.copilotVisionModel` | `oswe-vscode-prime`  | Model to use for vision proxy in GitHub Copilot                                                      |
| `aiflowbridge.vision.excludedVendors`    | `["aiflowbridge"]`   | Vendors that should NOT use the vision proxy (text-only models that benefit from image descriptions) |
| `aiflowbridge.vision.prompt`             | (multi-line default) | Prompt used for vision proxy image descriptions                                                      |

The vendor exclusion list is **opt-out**: by default only `aiflowbridge` (DeepSeek) is excluded, so MiniMax M3 and Xiaomi MiMo already see images directly.

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
