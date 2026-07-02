# AIFlowBridge - Agent Instructions

## Project Overview

AIFlowBridge is a VS Code extension that provides multi-provider AI coding assistance through Copilot Chat and an OpenAI-compatible local gateway. It supports DeepSeek, MiniMax, and Xiaomi MiMo with usage metrics, vision proxy, and singleton gateway routing.

## DOs

ALWAYS follows the following rules:

-✅ DO USE FRENCH for All the Agent IA interractions in the Chat (thinking, reflection, question, answers...)

## DONTs

ALWAYS follows the following rules:

- **Never use the em-dash (Em dash) character (U+2014).** Use a plain ASCII hyphen-minus (`-`, U+002D) instead.
- **Never use the en-dash (En dash) character (U+2013).** Use a plain ASCII hyphen-minus (`-`, U+002D) instead.

## Code Standards

### Language

- ❌ No Chinese localization files (package.nls.zh-cn.json, README.zh-cn.md, etc.)
- ✅ All code, comments, and documentation must be in **English only**
- ✅ Use English for all user-facing strings

### Style Guidelines

- TypeScript with strict typing
- Use ES modules (import/export)
- Async/await for asynchronous operations
- Prefer const over let
- Use interface for object shapes

### File Structure

```
src/
├── aiflowbridge/                       # Gateway, telemetry, UI module
│   ├── gateway/                        # HTTP proxy server
│   │   ├── server.ts                   # HTTP proxy + /version + /shutdown + version-aware restart
│   │   ├── probe.ts                    # probeServerVersion / requestPeerShutdown / waitUntilPortFree / compareSemver
│   │   └── lock.ts                     # acquireGatewayLock / releaseGatewayLock (fs.openSync 'wx')
│   ├── telemetry/                      # Cross-window telemetry persistence (FEAT1)
│   │   └── persistence.ts              # TelemetryPersister + acquireTelemetryLock / releaseTelemetryLock
│   ├── modelRegistry.schema.ts         # Registry types + hand-rolled validators + merge
│   ├── modelRegistry.ts                # 3-tier loader (bundled < globalStorage < workspace)
│   ├── telemetry.ts                    # Usage metrics
│   ├── providers.ts                    # Gateway upstream provider normalization
│   ├── config.ts                       # async loadConfig(context) - reads registry + settings
│   ├── types.ts                        # Type definitions
│   ├── index.ts                        # Extension entry point
│   └── ui/                             # Dashboard & status bar
├── provider/                           # Language model providers (Copilot Chat)
│   ├── base.ts                         # Abstract base (reads registry cache)
│   ├── index.ts                        # DeepSeek provider (vendor: aiflowbridge)
│   ├── minimax.ts                      # MiniMax provider
│   ├── xiaomi.ts                       # Xiaomi MiMo provider
│   ├── vision/                         # Transparent vision proxy
│   │   ├── model.ts                    # Vision model selector (copilot/kilo)
│   │   ├── resolve.ts                  # describeImageParts
│   │   ├── conversion.ts               # vscode message conversion
│   │   └── index.ts
│   ├── tools/                          # Tool calling support
│   ├── replay/                         # Reasoning replay (Xiaomi)
│   ├── debug/                          # Request dumps
│   └── segment/                        # Stream segmentation
├── runtime/                            # Extension lifecycle, commands, diagnostics
│   ├── lifecycle.ts                    # activate(): loadModelRegistry() then register
│   ├── commands.ts                     # Command registrations
│   ├── addCustomModel.ts               # "Add a custom model" interactive command
│   ├── editModelRegistry.ts            # "Edit model registry" command
│   ├── resetModelRegistry.ts           # "Reset model registry" command
│   ├── provider.ts                     # Provider registration
│   └── actions.ts                      # URI action handlers
├── consts.ts                           # Static constants only (CONFIG_SECTION, API_KEY_SECRETS, ...)
├── auth.ts                             # SecretStorage wrapper
├── config.ts                           # VS Code configuration access (incl. getUserModels)
├── i18n.ts                             # Translation helper (t() function)
├── logger.ts                           # vscode.LogOutputChannel wrapper
└── extension.ts                        # activate()/deactivate()
resources/
├── models.json                         # Bundled model registry (14 models, 3 vendors)
└── models.schema.json                  # JSON Schema for editor autocompletion
```

## Key Architectural Decisions

### Model Registry (3-tier)

The canonical list of models, vendors, capabilities, and per-model pricing is an
external JSON file (`resources/models.json`), not a TypeScript constant. It
flows through a 3-tier merge with `workspace > globalStorage > bundled` priority
(see [README "Model registry"](../../resources/../README.md#model-registry) for
the user-facing version):

```
.vscode/aiflowbridge.models.json  (per-project override)
        ↓ deep merge
<globalStorageUri>/models.json    (per-user override)
        ↓ deep merge
resources/models.json             (shipped with the extension)
```

- **Bundled** (`resources/models.json`) - shipped with the extension, lists the
  14 supported models and the 3 vendor defaults (baseUrl, apiKeySecret,
  external URLs, indicative token-plan rates).
- **globalStorage override** - `AIFlowBridge: Edit model registry` opens (or
  initializes from the bundled) `<globalStorageUri>/models.json` in the
  editor. Affects the current OS user.
- **workspace override** - `<workspaceFolder>/.vscode/aiflowbridge.models.json`.
  Affects only the current project. Committed to Git, lets teams pin the
  catalog per repo.

Merge rules:

- Per `model.id`: `deepMergeModel(base, override)` - top-level fields +
  `capabilities` + `pricing` are deep-merged, so an override that only sets
  `pricing` keeps every other field from the bundled entry.
- Per `vendor` key: `deepMergeVendor(base, override)` - `externalUrls` is
  shallow-merged per key.
- A `model.id` or `vendor` key present only in a higher tier is preserved
  (lets you add a new model without touching the bundled file).
- Tier existence is fail-safe: a missing tier is fine. A structure error in
  the bundled tier is **fatal** (the bundled file is shipped with the
  extension, a broken shipped file is a programming error). A structure
  error in an override tier is **logged and skipped** (the user can fix
  their override without bricking the extension). A per-entry content error
  is **logged and dropped** (the rest of the tier is still used).

Validation is hand-rolled, no `ajv` dependency. The schema module
(`src/aiflowbridge/modelRegistry.schema.ts`) is intentionally VS Code-free
(imports nothing from `vscode`) so it can be unit-tested directly with
vitest. Validators accumulate skip reasons in a `ValidationLog` object that
the loader turns into `logger.warn()` calls - validators themselves never
log, which keeps them pure and easy to test.

The loader caches the merged result in a module-level variable. Consumer
modules read it via `getLoadedRegistry()` (throws if not loaded) or
`tryGetLoadedRegistry()` (returns `undefined`). `loadModelRegistry()` is
idempotent: a second call returns the same cached object instead of
re-reading the bundled file. The cache is invalidated by a window reload
(per `ACTION PLAN.md` "Pièges à éviter" - v1 requires a reload to pick up
hot-edits of the globalStorage file).

For tests, `setLoadedRegistry(registry)` seeds the cache. The unit tests
in `tests/modelRegistry.test.ts` instead inject a fake `vscode.workspace.fs`
through the loader's `options.fs` parameter, which keeps the test isolated
from any real file system.

### Provider Pattern

Each AI provider is registered via VS Code's `languageModelChatProviders` contribution point:

- `aiflowbridge` (DeepSeek V4 Pro/Flash) - registered under generic `aiflowbridge` vendor to coexist with provider-specific vendors
- `minimax` (MiniMax M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3) - HTTP streaming client
- `xiaomi` (Xiaomi MiMo V2 Omni, V2 Pro, V2.5, V2.5 Pro) - HTTP streaming client

### Model Id Convention

**The `id` field in `MODELS` (and in `aiflowbridge.userModels`) is the upstream API id** (e.g. `MiniMax-M2.7`, `mimo-v2.5`, `deepseek-v4-flash`), NOT a kebab-case alias. The human-readable name shows in the Copilot Chat picker. This removes the need for any id translation map between VS Code and upstream.

### User-defined models

Users can extend the registry without an extension update via two complementary
mechanisms:

- **Model registry override** (`resources/models.json` + globalStorage +
  workspace): the source of truth for the **bundled** model list. See the
  "Model Registry (3-tier)" section above. Use this to add models that
  should be available to all users of a project (workspace override) or to
  all projects for the current OS user (globalStorage override).
- **`aiflowbridge.userModels` setting**: array of `ModelDefinition`-shaped
  objects in `settings.json`. Lightweight per-user/per-workspace model
  additions that don't need a registry file. Same merge semantics as the
  registry overrides.
- **`AIFlowBridge: Add a custom model` command**: walks through the
  Command Palette to fetch a vendor's `/v1/models`, pick a model, declare
  capabilities, and save to the `aiflowbridge.userModels` setting.

`BaseChatProvider.getModelsForVendor()` reads from the registry cache
(`getLoadedRegistry().models`) and merges with `getUserModels()` on every
read. The Copilot Chat picker refreshes automatically when either source
changes.

### Provider Implementation

- `src/provider/base.ts` - Abstract base class for all providers
- `src/provider/index.ts` - DeepSeekChatProvider (original implementation)
- `src/provider/minimax.ts` - MiniMax provider with HTTP streaming client
- `src/provider/xiaomi.ts` - Xiaomi provider with HTTP streaming client

### Vision Proxy

Located in `src/provider/vision/`. Generic enough to work with any provider:

- Configurable model via `aiflowbridge.vision.copilotVisionModel` (default: `oswe-vscode-prime`)
- Vendor exclusion list (`aiflowbridge.vision.excludedVendors`, default: `["aiflowbridge"]`)
- Model getter falls back: configured ID → find any `imageInput: true` model → default
- Wraps descriptions in `[Image Description: ...]` markers
- Custom prompt via `aiflowbridge.vision.prompt`

### Gateway

Located in `src/aiflowbridge/gateway/`:

- `server.ts` - OpenAI-compatible HTTP proxy on configurable port (default 8787)
  - Endpoints: `/health`, `/metrics`, `/v1/metrics`, `/v1/models`, `/v1/chat/completions`, `/version`, `/shutdown`
  - **Version-aware cooperative restart**: when the configured port is in use, probes `GET /version`. If the peer identifies as `aiflowbridge-gateway` and reports a strictly older version, prompts the user (`Restart with vX.Y.Z` / `Keep current version`) and on Restart sends a cooperative `POST /shutdown`. Same or newer version → join silently. Foreign service on the port → log warning, no prompt, no shutdown.
  - **Singleton mode** retained as a subset of the above (the "same or newer" branch).
  - After `start()`, `config.gateway.port` and `config.gateway.baseUrl` are synced to the actual bound port (matters when `port: 0` is configured)
  - Provider routing by model alias via `aiflowbridge.providers` array
  - Request/response telemetry (counts, latency, tokens, estimated cost). `/version` and `/shutdown` are explicitly excluded from telemetry. Constructor accepts an optional 4th `persister` argument (a `TelemetryPersisterLike` implementing `loadSync` / `appendDelta` / `removeEntry` / `clear`) for cross-window shared metrics; the index file in `src/aiflowbridge/` builds the persister from `<globalStorageUri>` and wires it on activation. Exposes a `bundledVersion` getter (from the `extension/package.json` shipped with the running extension) and a `removeEntry(id)` / `refreshFromDisk()` pair for the dashboard message handler.
  - Starts automatically if `aiflowbridge.gateway.enabled: true` (default)
- `probe.ts` - `probeServerVersion` / `requestPeerShutdown` / `waitUntilPortFree` / `compareSemver`. Pure functions, no VS Code dependency, unit-tested.
- `lock.ts` - `acquireGatewayLock` / `releaseGatewayLock` using `fs.openSync(path, 'wx')`. Acquired in `lifecycle.ts:activate()` and released in `deactivate()`. Best-effort guard against the ping-pong loop when two debug sessions restart the gateway simultaneously.

### Logging

- `src/logger.ts` wraps `vscode.LogOutputChannel`
- Prefixed log levels: `[AIFlowBridge]`, `[Gateway]`, `[Vision]`, `[MiniMax]`, `[Xiaomi]`
- Accessible via "AIFlowBridge: Show Logs" command

## Common Tasks

### Building

```bash
npm run compile    # Compile TypeScript
npm run watch      # Watch mode
npm run package    # Build .vsix package
npm test           # Run vitest unit tests
```

### Adding a New Provider

1. Add a new entry under `vendors` in `resources/models.json` (baseUrl,
   apiKeySecret, externalUrls). Use the **upstream API id** as the key.
2. Add model definition(s) under `models` in `resources/models.json` with
   `family: <new-vendor>` and the upstream `id`.
3. Add provider registration to `package.json`
   (`contributes.languageModelChatProviders`)
4. Create provider-specific API client in `src/provider/<vendor>.ts`
5. Update gateway provider profiles in `src/aiflowbridge/providers.ts`
   (validation/normalization) - the default `aiflowbridge.providers` array
   still uses the hand-curated shape, but every registry model with the
   new `family` is auto-synthesized on top.
6. Add an entry to `DEFAULT_GATEWAY_PROFILES` in `src/aiflowbridge/config.ts`
   if the new vendor should appear in the gateway catalog with a friendly
   label and family-level indicative pricing.
7. Add provider-specific settings to `package.json`
   (`aiflowbridge.providers.{vendor}.*`)

### Adding a New Model

1. Add to the `models` array in `resources/models.json` with the **exact
   upstream API id** (use `AIFlowBridge: Add a custom model` or
   `curl /v1/models` to confirm)
2. Follow `RegistryModelDefinition` interface
   (`src/aiflowbridge/modelRegistry.schema.ts`) with capabilities flags
   and, optionally, a `pricing` block
3. Add to `package.nls.json` and `src/i18n.ts` with `model.{id}.detail`
   translation (key is the upstream id, not a kebab-case alias)
4. Update README.md provider table

> If you want to add a model without editing `resources/models.json` (and
> waiting for a release), use `AIFlowBridge: Add a custom model` to add it
> to `aiflowbridge.userModels`, or place a workspace override at
> `.vscode/aiflowbridge.models.json`. Both go through the same merge path
> as the bundled registry.

## Important Files

| File                                        | Purpose                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| `resources/models.json`                     | Bundled model registry (14 models, 3 vendors)                |
| `resources/models.schema.json`              | JSON Schema for editor autocompletion in registry files      |
| `src/consts.ts`                             | Static constants only (CONFIG_SECTION, API_KEY_SECRETS, ...) |
| `src/aiflowbridge/modelRegistry.schema.ts`  | Registry types + hand-rolled validators + merge              |
| `src/aiflowbridge/modelRegistry.ts`         | 3-tier loader (bundled < globalStorage < workspace)          |
| `src/aiflowbridge/config.ts`                | async `loadConfig(context)` - reads registry + settings      |
| `src/provider/base.ts`                      | Abstract provider (reads registry cache)                     |
| `src/provider/vision/model.ts`              | Vision model selection (selector + fallback chain)           |
| `src/aiflowbridge/gateway/server.ts`        | Local proxy with version-aware cooperative restart           |
| `src/aiflowbridge/gateway/probe.ts`         | probe / shutdown / waitUntilPortFree / compareSemver         |
| `src/aiflowbridge/gateway/lock.ts`          | acquireGatewayLock / releaseGatewayLock (fs.openSync 'wx')   |
| `src/aiflowbridge/telemetry.ts`             | Usage tracking and cost estimation                           |
| `src/aiflowbridge/telemetry/persistence.ts` | File-based cross-window telemetry persister + file lock      |
| `src/aiflowbridge/providers.ts`             | Gateway upstream provider normalization                      |
| `src/runtime/addCustomModel.ts`             | "Add a custom model" command handler                         |
| `src/runtime/editModelRegistry.ts`          | "Edit model registry" command handler                        |
| `src/runtime/resetModelRegistry.ts`         | "Reset model registry" command handler                       |
| `src/logger.ts`                             | Prefixed logging via LogOutputChannel                        |
| `src/i18n.ts`                               | Translation helper, English-only                             |
| `src/config.ts`                             | VS Code configuration access + `getUserModels()`             |
| `package.json`                              | Extension manifest, contributions, settings schema           |

## Configuration

All settings use the `aiflowbridge.` prefix. Provider-specific settings use `aiflowbridge.providers.{vendor}.*`.

- **`aiflowbridge.userModels`**: array of `ModelDefinition`-shaped objects. Merged with the built-in `MODELS` registry on every read. User-declared models can override built-in ones with the same id. See README "Adding a model without waiting for a release" for details.
- **Vision proxy model**: `aiflowbridge.vision.copilotVisionModel` (default: `oswe-vscode-prime`)
- **Vision proxy vendor exclusion**: `aiflowbridge.vision.excludedVendors` (default: `["aiflowbridge"]`)
- **Gateway profiles**: `aiflowbridge.providers: [...]` array (each with `id`, `label`, `kind`, `baseUrl`, `model`, `apiKey`)
- **Model id overrides** (per-provider): `aiflowbridge.providers.<vendor>.modelIdOverrides` (maps the upstream id to a custom one)

## Testing

Run `npm test` for unit tests. The extension uses vitest for testing (515 tests across 27 files).

Quality gates:

- `npm run compile` - 0 TypeScript errors
- `npm test` - 515/515 passing

Test files of note:

- `tests/modelRegistry.schema.test.ts` - hand-rolled registry validator coverage (~33 tests)
- `tests/modelRegistry.test.ts` - 3-tier loader with mocked `vscode.workspace.fs` (11 tests)
- `tests/gateway.test.ts` - HTTP endpoints + singleton detection + telemetry persistence (22 tests)
- `tests/gateway-version.test.ts` - `compareSemver` (12 cases) + `probeServerVersion` + `requestPeerShutdown` + `waitUntilPortFree` (21 tests)
- `tests/gateway-restart.test.ts` - end-to-end cooperative restart flow with stubbed `UserPrompt` + fake peer (10 tests)
- `tests/gateway-lock.test.ts` - `acquireGatewayLock` / `releaseGatewayLock` (7 tests, including stale-lock reaper)
- `tests/aiflowbridge-providers.test.ts` - gateway profile normalization + selection (26 tests)
- `tests/aiflowbridge-config.test.ts` - user-model synthesis into the gateway provider list (17 tests)
- `tests/minimax-resolveModelId.test.ts` - id passthrough + override
- `tests/token-counter.test.ts` - MiniMax `/v1/responses/input_tokens` wrapper (6 tests)
- `tests/userModels.test.ts` - user-declared model validation (6 tests)
- `tests/dashboard.test.ts` - metrics dashboard HTML builder (43 tests): gateway version in the badge, "Current version" subtitle, collapsible headers with `localStorage` persistence, `<input type="date">` × 2, `<input type="search">`, the client-side filter pipeline (`filterByRange` / `filterByCustomDate` / `entrySearchHaystack` / `matchesSearch`), per-row delete button when `onRemoveEntry` is wired, AFF03 plan-compliance: preset click clears the custom date inputs, entering a custom date deactivates the active preset button, by-model search matches the model name directly (entry-level OR model-name match).
- `tests/telemetry-store.test.ts` - TelemetryStore record / snapshot / restore / reset / persister hook (14 tests)
- `tests/telemetry-persistence.test.ts` - file-based persister + file lock + atomic write + concurrent writers + migration safety + removeEntry (33 tests)

## Notes

- API keys stored in VS Code SecretStorage (OS keychain) - never in `settings.json`
- No Chinese files should exist in this project
- Gateway starts enabled by default on extension activation
- All code comments and docs in English
- Configuration section prefix: `aiflowbridge`
- Vision proxy is opt-out (excluded vendors) not opt-in
- Model ids in `MODELS` and `userModels` must match the upstream API exactly
- No id translation map: what you see in `MODELS` is what gets sent to the API
