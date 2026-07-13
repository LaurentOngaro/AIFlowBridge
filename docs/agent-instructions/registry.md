# Model registry

> Part of the [agent instructions](../AGENTS.md).

The canonical list of models, vendors, capabilities, and per-model pricing is an external JSON file (`resources/models.json`), not a TypeScript constant.

## 3-tier merge

```
.vscode/aiflowbridge.models.json    (per-project override, takes priority)
        ↓ deep merge
<globalStorageUri>/models.json      (per-user override, AIFlowBridge: Edit model registry)
        ↓ deep merge
resources/models.json               (bundled with the extension)
```

- **Bundled** (`resources/models.json`) - ships with the extension, lists the 21 bundled models and the 4 vendor defaults (`deepseek`, `minimax`, `xiaomi`, `openrouter`; each with `baseUrl`, `apiKeySecret`, `externalUrls`, indicative token-plan rates). The 21 bundled entries drive the Copilot Chat picker and the gateway catalog; **the OpenRouter vendor makes all 100+ models reachable** - any model id not in the bundled registry works the moment it is declared in `aiflowbridge.userModels` with `family: "openrouter"` (or via a `globalStorage` / `workspace` registry override). No recompile needed.
- **globalStorage override** - `AIFlowBridge: Edit model registry` opens (or initializes from the bundled) `<globalStorageUri>/models.json` in the editor. Affects the current OS user.
- **workspace override** - `<workspaceFolder>/.vscode/aiflowbridge.models.json`. Affects only the current project. Committed to Git, lets teams pin the catalog per repo.

## Merge rules

- Per `model.id`: `deepMergeModel(base, override)` - top-level fields + `capabilities` + `pricing` are deep-merged, so an override that only sets `pricing` keeps every other field from the bundled entry.
- Per `vendor` key: `deepMergeVendor(base, override)` - `externalUrls` is shallow-merged per key.
- A `model.id` or `vendor` key present only in a higher tier is preserved (lets you add a new model without touching the bundled file).
- **Tier existence is fail-safe:** a missing tier is fine.
- **A structure error in the bundled tier is fatal** (the bundled file is shipped with the extension, a broken shipped file is a programming error).
- **A structure error in an override tier is logged and skipped** (the user can fix their override without bricking the extension).
- **A per-entry content error is logged and dropped** (the rest of the tier is still used).

## Validation

Hand-rolled, no `ajv` dependency.
The schema module (`src/aiflowbridge/modelRegistry.schema.ts`) is intentionally VS Code-free (imports nothing from `vscode`) so it can be unit-tested directly with vitest.

Validators accumulate skip reasons in a `ValidationLog` object that the loader turns into `logger.warn()` calls - validators themselves never log, which keeps them pure and easy to test.

## Loader cache

The loader caches the merged result in a module-level variable. Consumer modules read it via:

- `getLoadedRegistry()` - throws if not loaded.
- `tryGetLoadedRegistry()` - returns `undefined` if not loaded.

`loadModelRegistry()` is idempotent: a second call returns the same cached object instead of re-reading the bundled file. The cache is invalidated by a window reload.
For tests, `setLoadedRegistry(registry)` seeds the cache; the unit tests in `tests/modelRegistry.test.ts` instead inject a fake `vscode.workspace.fs` through the loader's `options.fs` parameter to keep the test isolated from any real file system.

## User-defined models (3 mechanisms)

Users can extend the registry without an extension update via three complementary mechanisms:

1. **Model registry override** (`resources/models.json` + globalStorage + workspace) - the source of truth for the bundled list.
2. **`aiflowbridge.userModels` setting** - array of `RegistryModelDefinition`-shaped objects in `settings.json`. Lightweight per-user/per-workspace model additions that don't need a registry file. Same merge semantics as the registry overrides.
3. **`AIFlowBridge: Add a custom model` command** - walks through the Command Palette to fetch a vendor's `/v1/models`, pick a model, declare capabilities, and save to `aiflowbridge.userModels`.

`BaseChatProvider.getModelsForVendor()` reads from the registry cache (`getLoadedRegistry().models`) and merges with `getUserModels()` on every read.
The Copilot Chat picker refreshes automatically when either source changes.

## Model id convention

**The `id` field in `MODELS` (and in `aiflowbridge.userModels`) is the upstream API id** (e.g. `MiniMax-M2.7`, `mimo-v2.5-pro`, `deepseek-v4-flash`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `openai/gpt-oss-120b:free`), NOT a kebab-case alias.
The human-readable name shows in the Copilot Chat picker (or, for gateway-only models like OpenRouter, in `GET /v1/models` responses).
This removes the need for any id translation map between VS Code and upstream.

The valid `family` values are the vendor config keys declared in `vendors`: `deepseek`, `minimax`, `xiaomi`, `openrouter`.
Adding a new vendor means (1) one entry in `resources/models.json` under `vendors`, (2) one entry in `API_KEY_SECRETS` (`src/consts.ts`) if the new vendor needs a SecretStorage slot, (3) one entry in `KNOWN_FAMILIES` (`src/aiflowbridge/modelRegistry.schema.ts`), (4) one entry in the JSON Schema enum in `resources/models.schema.json`.
Adding any of: per-vendor `OpenRouterChatProvider` (only for Copilot Chat picker integration), `setApiKey`/`clearApiKey` commands (only for VS Code UX parity), or HTTP-Referer injection (already shipped for OpenRouter in `src/aiflowbridge/gateway/openrouter-headers.ts`) - all are optional.
