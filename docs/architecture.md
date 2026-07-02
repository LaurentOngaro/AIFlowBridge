# Architecture

> Part of the [AIFlowBridge documentation](../README.md).

## Source layout

```
src/
├── aiflowbridge/                       # Gateway, telemetry, dashboard
│   ├── gateway/                        # OpenAI-compatible proxy server
│   ├── ui/                             # Dashboard webview, status bar
│   ├── telemetry/                      # Cross-window telemetry persistence
│   │   └── persistence.ts              # TelemetryPersister + file lock
│   ├── token-counter.ts                # MiniMax /v1/responses/input_tokens wrapper
│   ├── telemetry.ts                    # TelemetryStore + cost estimation
│   ├── config.ts                       # Gateway settings + userModel synthesis
│   ├── providers.ts                    # Gateway upstream provider normalization
│   ├── modelRegistry.ts                # 3-tier loader
│   ├── modelRegistry.schema.ts         # Hand-rolled validators + deep merge
│   └── types.ts
├── provider/                           # Language model providers (Copilot Chat)
│   ├── base.ts                         # Abstract base (reads registry cache + userModels)
│   ├── index.ts                        # DeepSeek
│   ├── minimax.ts                      # MiniMax (HTTP streaming)
│   ├── xiaomi.ts                       # Xiaomi MiMo
│   ├── tools/                          # Tool-calling adapters
│   ├── replay/                         # Reasoning replay (Xiaomi)
│   ├── debug/                          # Request dumps
│   ├── segment/                        # Stream segmentation
│   └── vision/                         # Transparent vision proxy
├── runtime/                            # Extension lifecycle, commands, diagnostics
│   ├── lifecycle.ts
│   ├── commands.ts
│   ├── addCustomModel.ts
│   ├── editModelRegistry.ts
│   ├── resetModelRegistry.ts
│   ├── provider.ts
│   └── actions.ts
└── consts.ts                           # Static constants (CONFIG_SECTION, API_KEY_SECRETS, ...)

resources/
├── models.json                         # Bundled model registry (14 models, 3 vendors)
└── models.schema.json                  # JSON Schema for editor autocompletion
```

## Model registry (3-tier)

The list of officially supported models, vendors, capabilities, and per-model pricing lives in an external JSON file rather than a TypeScript constant. The runtime reads it from a 3-tier chain on activation:

```
.vscode/aiflowbridge.models.json   (per-project override, takes priority)
       ↓ deep merge
<globalStorageUri>/models.json     (per-user override, opened via AIFlowBridge: Edit model registry)
       ↓ deep merge
resources/models.json              (bundled with the extension, source of truth on first run)
```

- **Bundled** - `resources/models.json` lists the 14 supported models and the 3 vendors (baseUrl, apiKeySecret, external URLs, indicative token-plan rates).
- **Per-user override** - `AIFlowBridge: Edit model registry` opens (or initializes from the bundled) `<globalStorageUri>/models.json` in the editor. Affects the current OS user across all workspaces.
- **Per-project override** - `<workspaceFolder>/.vscode/aiflowbridge.models.json`. Affects only the current project. Committed to Git, lets teams pin the catalog per repo.

### Merge rules

- Per `model.id`: `deepMergeModel(base, override)` - top-level fields + `capabilities` + `pricing` are deep-merged, so an override that only sets `pricing` keeps every other field from the bundled entry.
- Per `vendor` key: `deepMergeVendor(base, override)` - `externalUrls` is shallow-merged per key.
- A `model.id` or `vendor` key present only in a higher tier is preserved (lets you add a new model without touching the bundled file).
- Tier existence is fail-safe: a missing tier is fine. A structure error in the bundled tier is **fatal** (the bundled file is shipped with the extension). A structure error in an override tier is **logged and skipped** (the user can fix their override without bricking the extension). A per-entry content error is **logged and dropped** (the rest of the tier is still used).

Schema: [`resources/models.schema.json`](../resources/models.schema.json) - JSON Schema Draft 2020-12, referenced via `$schema` in the bundled file for editor autocompletion.

### Minimal override example

Change the MiniMax M2.7 pricing to whatever your reseller charges (in `<globalStorageUri>/models.json` or `.vscode/aiflowbridge.models.json`):

```json
{
  "version": 1,
  "models": [
    {
      "id": "MiniMax-M2.7",
      "pricing": {
        "inputPerMillion": 0.25,
        "outputPerMillion": 1.0,
        "currency": "USD"
      }
    }
  ]
}
```

The loader will deep-merge this on top of the bundled entry: every other field (name, capabilities, max tokens, etc.) comes from the bundled file, and only the `pricing` block is replaced.

### Add a brand-new model

Without editing the bundled file:

```json
{
  "version": 1,
  "models": [
    {
      "id": "MiniMax-M4",
      "name": "MiniMax M4",
      "family": "minimax",
      "maxInputTokens": 131072,
      "maxOutputTokens": 8192,
      "capabilities": { "toolCalling": true, "imageInput": false, "thinking": false },
      "pricing": { "inputPerMillion": 0.3, "outputPerMillion": 1.2, "currency": "USD" }
    }
  ]
}
```

Validation is hand-rolled (no `ajv` runtime dependency). See [`src/aiflowbridge/modelRegistry.schema.ts`](../src/aiflowbridge/modelRegistry.schema.ts) for the validator source.

## Provider pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point:

- `aiflowbridge` (DeepSeek V4 Pro/Flash) - registered under generic `aiflowbridge` vendor to coexist with provider-specific vendors
- `minimax` (MiniMax M2 → M3, HTTP streaming client)
- `xiaomi` (Xiaomi MiMo V2 Omni/Pro/V2.5/V2.5 Pro, HTTP streaming client)

The model id field in the registry is the **upstream API id** (`MiniMax-M2.7`, `mimo-v2.5-pro`), not a kebab-case alias. The picker shows the human-readable `name` field.

## Gateway singleton + version-aware restart

The local gateway enforces a singleton across all VS Code windows. When a second window activates, it probes `GET /version` on the configured port; see [gateway.md](gateway.md#version-aware-restart) for the full restart flow (`/shutdown`, `/version`, `<globalStorageUri>/gateway.lock`).
