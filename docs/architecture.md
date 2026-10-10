# Architecture

> Part of the [AIFlowBridge documentation](../README.md).

## Source layout

```
src/
├── aiflowbridge/                       # Host-agnostic gateway + telemetry + UI module
│   ├── gateway/                        # OpenAI-compatible HTTP proxy
│   │   ├── server.ts                   # HTTP server + /version + /shutdown + cooperative restart
│   │   ├── probe.ts                    # probeServerVersion / requestPeerShutdown / waitUntilPortFree / compareSemver
│   │   ├── lock.ts                     # acquireGatewayLock / releaseGatewayLock (fs.openSync 'wx')
│   │   ├── loopback-guard.ts           # Host/Origin loopback-only request guard
│   │   ├── bearer-key.ts               # Accepted local Authorization header shapes
│   │   ├── discovery.ts                # GET /v1/discovery payload + optional UDP beacon
│   │   ├── openrouter-headers.ts       # HTTP-Referer / X-Title attribution headers
│   │   └── quota-diagnostics.ts        # Upstream quota-refusal classification
│   ├── telemetry/                      # Cross-window telemetry persistence
│   │   ├── persistence.ts              # TelemetryPersister + acquireTelemetryLock / releaseTelemetryLock
│   │   ├── cap.ts                      # Bounded summary capture (maxStoredRequestBytes)
│   │   └── summary.ts                  # sanitizeSummaryText + buildPromptSummary + buildResponseSummary (pair-programming log)
│   ├── ui/                             # Dashboard webview + status bar
│   │   ├── dashboard.ts                # buildDashboardHtml + showMetricsDashboard
│   │   ├── dashboard-sort.ts           # Three-state column sorting (asc / desc / cleared)
│   │   └── statusbar.ts                # Status bar entry, "joined" state when peer owns the gateway
│   ├── pricing/                        # Pricing registry
│   │   ├── loader.ts                   # resolution order + pricing-override.json read/write
│   │   └── openrouter-fetch.ts         # Live OpenRouter /v1/models refresh
│   ├── gemini/                         # Gemini native transport
│   │   ├── gemini-native.ts            # Native Gemini request/response path
│   │   ├── content-parts.ts           # Part conversion (text / inlineData / thought_signature)
│   │   ├── json-schema-clean.ts        # Upstream-compatible tool schema normalisation
│   │   └── thought-signature-cache.ts  # Bounded thought_signature cache (500 entries / 30 min)
│   ├── token-counter.ts                # MiniMax /v1/responses/input_tokens wrapper
│   ├── context/                        # Workspace detector + language routing (action plan items #2 + #5)
│   │   ├── workspace-context.ts        # detectWorkspaceContext + renderWorkspaceContext + prependSystemMessage
│   │   └── language-routing.ts         # selectProviderWithLanguage + detectLanguageHintFromPayload
│   ├── modelRegistry.schema.ts         # Hand-rolled registry types + validators + deep merge
│   ├── modelRegistry.ts                # 3-tier loader (bundled < globalStorage < workspace)
│   ├── modelRegistryOverride.ts        # Registry override file read/write
│   ├── telemetry.ts                    # TelemetryStore + cost estimation
│   ├── providers.ts                    # Gateway upstream provider normalization + SSRF validation
│   ├── host-config.ts                  # loadConfigFromContext(ctx) + DEFAULT_GATEWAY_PROFILES - host-agnostic
│   ├── api-key-sources.ts              # Unified key chain (env vars > secrets.json > SecretStorage)
│   ├── api-key-resolver.ts             # resolveVendorApiKey(vendor, secrets) - SecretStorageLike agnostic
│   ├── auth-mode.ts                    # Auth mode detection (byok / oauth / plan / token)
│   ├── google-transport-policy.ts      # classifyGoogleTransport - refuses the retired Google OAuth host
│   ├── googleai-studio-route.ts        # Gemini API route resolution
│   ├── retired-google-oauth-secrets.ts # Local purge of the legacy antigravity credential slot
│   ├── kilo-code-config.ts             # Writes registry-declared reasoning levels into Kilo Code config
│   ├── types.ts                        # IGatewayContext + Disposable + SecretStorageLike + ConfigReader + FileSystemLike
│   ├── index.ts                        # AIFlowBridgeRuntime(ctx: IGatewayContext) - host-agnostic entry point
│   └── vscode-context-adapter.ts       # createVSCodeContext(context) - wraps vscode.ExtensionContext
├── standalone/                         # Pure-Node.js CLI binary
│   ├── main.ts                         # CLI entry point (aiflowbridge-server npm bin)
│   ├── context.ts                      # createStandaloneContext() - env vars + storage dir + fs.watch hot-reload
│   ├── storage-dir.ts                  # Storage directory resolution (AIFLOWBRIDGE_DATA_DIR > VS Code globalStorage > ~/.aiflowbridge)
│   ├── config-loader.ts                # StandaloneConfigFile - nested JSON reader for <storageDir>/config.json
│   ├── util.ts                         # Shared getNestedValue / setNestedValue helpers
│   ├── migrations/
│   │   └── merge-storage.ts            # One-shot merge of a legacy storage dir into the resolved one
│   └── vscode-shim.ts                  # vscode module shim so the gateway code typechecks without @types/vscode
├── provider/                           # Language model providers (Copilot Chat)
│   ├── base.ts                         # Abstract base (reads registry cache)
│   ├── index.ts                        # DeepSeek provider
│   ├── minimax.ts                      # MiniMax provider
│   ├── xiaomi.ts                       # Xiaomi MiMo provider
│   ├── unified.ts                      # Shared provider helpers (reasoning, token counting)
│   ├── models.ts                       # Model id resolution helpers
│   ├── convert.ts                      # vscode.LM <-> upstream message conversion
│   ├── stream.ts                       # SSE stream parsing
│   ├── segment.ts                      # Stream segmentation
│   ├── errors.ts                       # Upstream error normalization
│   ├── tokens.ts                       # Token counting heuristics
│   ├── request.ts                      # Outgoing HTTP request builder
│   ├── tools/                          # Tool-calling adapters
│   ├── replay/                         # Reasoning replay (Xiaomi)
│   ├── debug/                          # Request dumps
│   └── vision/                         # Transparent vision proxy
├── client/                             # Internal HTTP client (no vscode dependency)
│   ├── core.ts                         # fetch wrapper with timeout + retry
│   ├── consts.ts                       # Default headers, user-agent
│   ├── error.ts                        # NetworkError / TimeoutError
│   ├── types.ts                        # Request/response shapes
│   └── index.ts
├── runtime/                            # VS Code-specific lifecycle, commands, diagnostics
│   ├── lifecycle.ts                    # activate(): createVSCodeContext() then activateAIFlowBridge()
│   ├── commands.ts                     # Command registrations
│   ├── provider.ts                     # languageModelChatProviders registration
│   ├── actions.ts                      # URI action handlers (vscode://aiflowbridge/...)
│   ├── addCustomModel.ts               # "Add a custom model" interactive command
│   ├── editModelRegistry.ts            # "Edit model registry" command
│   ├── resetModelRegistry.ts           # "Reset model registry" command
│   ├── configureKiloCode.ts            # "Configure Kilo Code reasoning levels" command
│   ├── installStandalone.ts            # "Install standalone gateway" command
│   ├── refreshPricing.ts               # "Refresh pricing now" command
│   ├── openPricingData.ts              # "Open pricing data" command
│   ├── exportTelemetry.ts              # CSV / JSON export of the filtered entries
│   ├── diagnostics.ts                  # Extension diagnostics + debug mode
│   ├── welcome.ts                      # First-activation welcome flow
│   └── index.ts                        # Public re-exports for extension.ts
├── consts.ts                           # Static constants (CONFIG_SECTION, API_KEY_SECRETS, ...)
├── auth.ts                             # SecretStorage wrapper
├── config.ts                           # VS Code configuration access (incl. getUserModels, DebugMode)
├── i18n.ts                             # Translation helper (English only)
├── logger.ts                           # LogOutputChannel wrapper
├── json.ts                             # JSON.parse / stringify with safe defaults
├── types.ts                            # Shared types
└── extension.ts                        # activate()/deactivate()

resources/
├── models.json                         # Bundled model registry (38 entries across 7 vendors; OpenRouter adds 100+ model ids reachable verbatim through userModels / registry override)
└── models.schema.json                  # JSON Schema for editor autocompletion
```

The `aiflowbridge/` core is **host-agnostic**: it has no `vscode` imports.
The VS Code side wraps it via `createVSCodeContext()` (`vscode-context-adapter.ts`), the standalone side wraps it via `createStandaloneContext()` (`standalone/context.ts`).
Both hosts share the same `gateway.lock` and `telemetry.json` files.

## Model registry (3-tier)

The list of officially supported models, vendors, capabilities, and per-model pricing lives in an external JSON file rather than a TypeScript constant.
The runtime reads it from a 3-tier chain on activation:

```
.vscode/aiflowbridge.models.json   (per-project override, takes priority)
       ↓ deep merge
<globalStorageUri>/models.json     (per-user override, opened via AIFlowBridge: Edit model registry)
       ↓ deep merge
resources/models.json              (bundled with the extension, source of truth on first run)
```

- **Bundled** - `resources/models.json` lists the 38 bundled models and the 7 vendors with models (baseUrl, apiKeySecret, external URLs, indicative token-plan rates); `antigravity` is an eighth vendor entry with no bundled model, kept as historical metadata for the Google product OAuth route retired in this release: it pins the retired upstream `baseUrl` and the external URLs, selects nothing, and any profile aimed at that host is refused with `google_product_oauth_unsupported`.
  - The OpenRouter bundled entries advertise the 15 models on the current free tier in `GET /v1/models`; the 100+ other OpenRouter model ids are reachable verbatim by adding them to `aiflowbridge.userModels` or a registry override - see [docs/providers.md](providers.md#openrouter-100-models-via-a-single-openai-compatible-endpoint).
  - Data snapshot **2026-10-01** (AIFlowBridge **2.24.0**); see [docs/providers.md#data-freshness](providers.md#data-freshness) for the refresh policy.
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

The extension registers a **single** vendor through VS Code's `languageModelChatProviders` contribution point: `aiflowbridge`.
Behind it, one `vscode.LanguageModelChatProvider` implementation (`UnifiedChatProvider` in `src/provider/unified.ts`) dispatches each request to the sub-provider matching the model id from the registry:

| Model family                                   | Sub-provider              | Copilot Chat picker |
| ---------------------------------------------- | ------------------------- | ------------------- |
| DeepSeek V4.1 Flash / V4 Pro                   | `src/provider/index.ts`   | Yes                 |
| MiniMax M2.7 -> M3.1                           | `src/provider/minimax.ts` | Yes                 |
| Xiaomi MiMo V2.5 -> V2.6                       | `src/provider/xiaomi.ts`  | Yes                 |
| Google AI Studio, Z.ai, MoonshotAI, OpenRouter | none (gateway-only)       | No                  |

Adding a picker entry therefore means adding a model to the registry plus a delegation branch, not registering a new vendor contribution point.

Shared logic lives in `src/provider/{convert,stream,segment,errors,tokens,request}.ts` (vscode.LM message conversion, SSE parsing, stream segmentation, upstream error normalization, token counting heuristics, outgoing HTTP request builder), with `src/provider/models.ts` for model id resolution and `src/provider/tools/` for tool-calling adapters.

The model id field in the registry is the **upstream API id** (`MiniMax-M2.7`, `mimo-v2.6-pro`, `deepseek-flash`), not a kebab-case alias.
The picker shows the human-readable `name` field.

## Gateway singleton + version-aware restart

The local gateway enforces a singleton across all VS Code windows AND the standalone CLI.
When a second window / process activates, it probes `GET /version` on the configured port; see [gateway.md](gateway.md#version-aware-restart) for the full restart flow (`/shutdown`, `/version`, `<globalStorageUri>/gateway.lock`).

The `/shutdown` endpoint (1.7.0+) requires a per-instance random token returned by `GET /version` and echoed in the `X-AIFlowBridge-Shutdown-Token` header.
Foreign services on the port are never touched (no `POST /shutdown` is sent).

## Pair-programming HTTP surface

The gateway exposes a small set of loopback-only endpoints on top of the OpenAI-compatible `/v1/chat/completions` core, all bound to `127.0.0.1` (same posture as the rest of the gateway):

- **Workspace context** (`GET /v1/context`, action plan item #2) - JSON dump of the detected workspace languages / package managers / linters / formatters.
- **Discovery** (`GET /v1/discovery`, item #4) - one-paste client config snippets for Continue / Kilo Code / OpenAI Python SDK / curl, gated on `gateway.discovery.enabled`.
- **Sessions + replay + SSE** (`GET /v1/sessions`, `GET /v1/replay/{id}`, `GET /v1/events`, item #3, 2.10.0+) - the pair-programming surface. The Shared session panel in the dashboard uses the same HTTP endpoints; the in-process replay path (via `TelemetryStore.getEntry()` + `attachMessageHandler()`) is what wires the button.

The `promptSummary` / `responseSummary` fields on `RequestTelemetry` are populated by `src/aiflowbridge/telemetry/summary.ts` at recording time and sanitized before storage (Bearer tokens, `sk-...` keys, `x-api-key` headers, and 60+-char token-like blobs are redacted to `[REDACTED]`).
Both fields are optional in the schema so older on-disk snapshots load unchanged and the next `record()` call repopulates the new fields as requests come in - no migration required.
