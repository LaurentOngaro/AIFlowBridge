# Providers

> Part of the [AIFlowBridge documentation](../README.md).

## Supported models (14 total)

| Provider | Models                                                               | Vision     | Tool Calling |
| -------- | -------------------------------------------------------------------- | ---------- | ------------ |
| DeepSeek | V4 Flash, V4 Pro                                                     | Proxied    | ✅           |
| MiniMax  | M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed | Proxied    | ✅           |
| MiniMax  | M3                                                                   | **Native** | ✅           |
| Xiaomi   | MiMo V2 Omni                                                         | Native     | ✅           |
| Xiaomi   | MiMo V2 Pro, V2.5 Pro                                                | Proxied    | ✅           |
| Xiaomi   | MiMo V2.5                                                            | **Native** | ✅           |

Notes:

- All models expose the image-paste button in Copilot Chat. **Native** models accept images directly. **Proxied** models route the image through a separate vision-capable model that produces a text description, which is then injected into the prompt (see [vision-proxy.md](vision-proxy.md)).
- **Thinking** indicates a reasoning model with a thinking-effort selector exposed in Copilot Chat. MiniMax M2 / M2.1 / M2.5 / M2.7 generations do not expose a thinking selector. **MiniMax M3 exposes a "Thinking Effort" selector** (None / High / Max) that maps to the upstream `reasoning_split` boolean - see [reasoning.md](reasoning.md).
- Configure the proxied vision model with `AIFlowBridge: Set vision proxy model` or via `aiflowbridge.vision.copilotVisionModel`.

## Why is the model list hardcoded?

The list of officially supported models lives in [`resources/models.json`](../resources/models.json) (with its JSON Schema in [`resources/models.schema.json`](../resources/models.schema.json)) and is **not auto-discovered** from the upstream APIs. This is a deliberate design choice driven by VS Code's `vscode.lm.registerLanguageModelChatProvider` API.

VS Code requires each model to declare its capabilities at registration time:

- `maxInputTokens` and `maxOutputTokens` (context window)
- `toolCalling` - `true`, `false`, or a numeric limit on simultaneous tools
- `imageInput` - whether the paste-image button appears in Copilot Chat
- `thinking` - whether the thinking-effort selector is exposed
- `requiresThinkingParam` - provider-specific quirks (e.g. DeepSeek's `thinking: { type: "enabled" }`)

The upstream APIs (`GET /v1/models`) only return `{ id, owned_by, created }`. They do not expose context window, tool limits, vision support, or thinking support in a usable format. Without explicit capabilities, VS Code would:

- Hide the image-paste button for vision-capable models
- Expose tool calling for models that don't support it (broken UX)
- Skip the thinking-effort selector for reasoning models
- Allow context overflow with no warning

A bad capability is a worse user experience than a missing model. A hardcoded registry ensures every supported model works end-to-end on day one. See [architecture.md](architecture.md#model-registry) for how to override individual entries.

**Convention** : the `id` field in `resources/models.json` is the **upstream API id** itself (e.g. `MiniMax-M2.7`, `mimo-v2.5-pro`), not a kebab-case VS Code alias. The picker shows the human-readable `name` field. This avoids any id translation layer between VS Code and the upstream API.

## Adding a model without waiting for a release

You do **not** need a new AIFlowBridge release to use a newly released provider model. Three options, from simplest to most powerful:

### Option 1 - Command Palette (easiest)

Run **`AIFlowBridge: Add a custom model`** from the Command Palette. The command:

1. Asks which provider to query
2. Fetches the model list from the provider's `/v1/models` endpoint (using your stored API key)
3. Lets you pick a model from the list
4. Lets you pick its capabilities (tool calling, vision, thinking) with simple Yes/No prompts
5. Saves the entry to your `aiflowbridge.userModels` setting

The new model appears in the Copilot Chat picker immediately. You can edit or remove the entry in your user settings at any time.

### Option 2 - Direct setting (`aiflowbridge.userModels`)

Add an entry to `settings.json` under `aiflowbridge.userModels`:

```json
{
  "aiflowbridge.userModels": [
    {
      "id": "minimax-m3",
      "name": "MiniMax M3",
      "family": "minimax",
      "version": "m3",
      "maxInputTokens": 1000000,
      "maxOutputTokens": 128000,
      "capabilities": {
        "toolCalling": true,
        "imageInput": true,
        "thinking": false
      },
      "requiresThinkingParam": false
    }
  ]
}
```

**Trade-off** : user-declared models are your responsibility. If you mark `imageInput: true` for a model that does not accept images, the Copilot Chat paste button will appear but the model will fail on upload. Capabilities are not validated against the upstream API.

### Option 3 - Registry override (workspace or per-user)

For a more permanent, structured change (pricing, vendor defaults, full schema validation in the editor), use the **model registry** instead of `aiflowbridge.userModels`. Run **`AIFlowBridge: Edit model registry`** - it opens `<globalStorageUri>/models.json` in the editor (creating it from the bundled file if needed). See [architecture.md](architecture.md#model-registry) for the full schema and override rules. Changes apply to the **next VS Code window reload**.

## Promoting a user model to the official registry

If a user-defined model is widely useful, the recommended path is to add it to the official bundled registry in [`resources/models.json`](../resources/models.json) via a pull request. The PR will be reviewed for:

- Correct `id` matching the upstream API exactly (use `AIFlowBridge: Add a custom model` or `curl /v1/models` to confirm)
- Correct capabilities (especially image input and thinking)
- Matching `maxInputTokens` / `maxOutputTokens` from the provider's documentation
- Per-model `pricing` block (USD per 1M tokens) - see the `ModelPricing` shape in [architecture.md](architecture.md#model-registry)
- Translation key in `package.nls.json` (`model.<id>.detail`)
- Entry in the Providers table above

The release cadence is opportunistic - no fixed schedule. Tag `v1.x.y` when a meaningful set of changes accumulates.
