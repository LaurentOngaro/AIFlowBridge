# AIFlowBridge

<!-- markdownlint-disable MD033 -->
<p align="center">
  <img src="resources/icon.png" height="100" alt="Version"><hr/>
</p>
<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=LaurentOngaro.aiflowbridge">
    <img src="https://badgen.net/vs-marketplace/v/laurentOngaro.aiflowbridge" alt="Version">
  </a>
  <a href="https://github.com/LaurentOngaro/aiflowbridge">
    <img src="https://badgen.net/github/last-commit/LaurentOngaro/aiflowbridge" alt="Last Commit">
  </a>
  <a href="https://github.com/LaurentOngaro/aiflowbridge/stargazers">
    <img src="https://badgen.net/github/stars/LaurentOngaro/aiflowbridge" alt="GitHub stars">
  </a>
  <a href="https://github.com/LaurentOngaro/aiflowbridge/blob/main/LICENSE">
    <img src="https://badgen.net/github/license/LaurentOngaro/aiflowbridge" alt="License">
  </a>
  <a href="https://github.com/LaurentOngaro/aiflowbridge/issues">
    <img src="https://badgen.net/github/issues/LaurentOngaro/aiflowbridge" alt="Open issues">
  </a>
  <a href="https://github.com/LaurentOngaro/aiflowbridge/releases/latest">
    <img src="https://badgen.net/github/release/LaurentOngaro/aiflowbridge" alt="Latest release">
  </a>
</p>
<!-- markdownlint-enable MD033 -->

**Use DeepSeek, MiniMax, and Xiaomi MiMo directly in GitHub Copilot Chat. The extension is free, open-source, and ad-free; you pay the upstream providers directly for the model usage. Transparent vision proxy, usage metrics, and an OpenAI-compatible local gateway for Kilo Code, Continue, and more.**

AIFlowBridge brings together multiple AI providers (DeepSeek, MiniMax, Xiaomi MiMo) under a unified interface inside Copilot Chat - with built-in metrics, proxy routing, and vision bridge capabilities.

> **AIFlowBridge can save you time or money, so consider [sponsoring its development](https://github.com/sponsors/LaurentOngaro)**.
> The extension is free, ad-free, tracker-free and no personal data is collected - **your support is what keeps it that way ->[more info on how to become one of our sponsors](#sponsoring)**
>
> **Spread the word**
> ![GitHub Repo stars](https://badgen.net/github/stars/LaurentOngaro/aiflowbridge)
> Increase the project's visibility by adding a star to its GitHub repository
>
> **That's the easiest way to show your support and help others discover the extension**

## Features

- **Multi-provider in one place** - DeepSeek (V4 Pro, V4 Flash), MiniMax (M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3), Xiaomi MiMo (V2 Omni, V2 Pro, V2.5, V2.5 Pro). See the [Providers](#providers) table for the canonical list and which ones have **native** vision vs use the [vision proxy](#vision-proxy). To add a model not in the list, run **`AIFlowBridge: Add a custom model`** (see [Adding a model without waiting for a release](#adding-a-model-without-waiting-for-a-release)).
- **Transparent vision proxy** - text-only models handle images via automatic proxy through another installed Copilot model (Claude, GPT-4o, etc.). Zero configuration required; pick your preferred vision model once.
- **Built-in OpenAI-compatible gateway** - starts automatically on port 8787 (singleton across VS Code instances) so Kilo Code, Continue, Open WebUI, and any OpenAI-compatible client can use the same models. Per-request metrics, tokens, and estimated cost, persisted across restarts and **shared across windows** in `<globalStorageUri>/telemetry.json` (file-locked).
- **Copilot Chat integration** - agent mode, tool calling, instructions, MCP, skills. 1M token context on supporting models. Thinking mode with reasoning effort control (DeepSeek, Xiaomi).
- **Secure by default** - API keys in VS Code's `SecretStorage` (OS keychain), never in `settings.json` or in Git history. Telemetry stays local.

## Why AIFlowBridge?

GitHub Copilot Chat ships with one vendor. AIFlowBridge adds a multi-provider switcher so you can pick the best model for the job, all from the same chat window.

Compared to running each provider's CLI or website, AIFlowBridge gives you:

- **One place** to switch models in Copilot Chat (no copy-pasting code between sites)
- **Local OpenAI-compatible gateway** so Kilo Code, Continue, Open WebUI, and any OpenAI-compatible client can use the same models
- **Per-request metrics**: token counts, latency, estimated cost - visible in the dashboard
- **Vision proxy** for text-only models: paste an image and the description is injected automatically
- **Local-first**: API keys live in your OS keychain, telemetry stays on your machine

**Want to use a model not in the list?** Run **`AIFlowBridge: Add a custom model`** from the Command Palette to add any model returned by the provider's `/v1/models` endpoint - see [Adding a model without waiting for a release](#adding-a-model-without-waiting-for-a-release).

## Cost comparison - what's real, what isn't

AIFlowBridge is **local glue** around paid upstream APIs. It does not replace those APIs and it does not magically lower their per-token prices. Anything that says otherwise is marketing.

What it **does** affect:

- **Free vision for Copilot subscribers.** Models that do not accept images (DeepSeek, MiniMax, Xiaomi text-only) handle them via a _vision proxy_. The default vision model is `oswe-vscode-prime`, which is bundled with a GitHub Copilot subscription. If you already pay for Copilot, vision calls cost **$0** through AIFlowBridge instead of paying a vision-capable upstream model.
- **No markup on token prices.** Other OpenAI-compatible proxies (OpenRouter, Portkey, Together, etc.) add 5–15% on top of the catalog price. AIFlowBridge calls upstream APIs directly with your own API keys - the price you see on the provider's dashboard is the price you pay.
- **One bill per task, not per provider.** Switching between DeepSeek Flash ($0.14/M input) for boilerplate and MiniMax M3 for the hard stuff happens inside the same Copilot Chat window, with per-request token counts. You avoid paying a single premium model for every interaction.
- **Accurate token counting (v1.2+).** The dashboard and the cost estimate for MiniMax (and future models that exposes tokens count through their API) use the upstream endpoint instead of a `length/4` heuristic. No end-of-month surprise.
- **No subscription, no per-seat fee.** AIFlowBridge itself is free; you only pay the upstream APIs you actually use.

What it **does not** do:

- Discounts or rebates on upstream pricing
- Free trial credits
- Bundled inference

Typical monthly spend for a solo developer using AIFlowBridge (heavy Copilot-style use, ~50 M input + 20 M output tokens):

| Workload                                              | Approx. cost                      |
| ----------------------------------------------------- | --------------------------------- |
| All DeepSeek V4 Flash                                 | $3–5                              |
| Mixed: 70% Flash + 30% MiniMax M3                     | $5–8                              |
| Mostly MiniMax M3 (1 M context)                       | $8–12                             |
| Vision-heavy with `oswe-vscode-prime` proxy (Copilot) | **+ $0** - covered by Copilot sub |
| AIFlowBridge itself                                   | **$0** + optional sponsorship     |

The cheapest "Copilot Chat with image paste" workflow is AIFlowBridge + DeepSeek V4 Flash + the bundled Copilot vision model. There is no cheaper stack that gives you the same feature set in a single UI.

## Providers

| Provider | Models                                                               | Vision     | Tool Calling |
| -------- | -------------------------------------------------------------------- | ---------- | ------------ |
| DeepSeek | V4 Flash, V4 Pro                                                     | Proxied    | ✅           |
| MiniMax  | M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed | Proxied    | ✅           |
| MiniMax  | M3                                                                   | **Native** | ✅           |
| Xiaomi   | MiMo V2 Omni                                                         | Native     | ✅           |
| Xiaomi   | MiMo V2 Pro, V2.5 Pro                                                | Proxied    | ✅           |
| Xiaomi   | MiMo V2.5                                                            | **Native** | ✅           |

Notes:

- All models expose the image-paste button in Copilot Chat. **Native** models accept images directly. **Proxied** models route the image through a separate vision-capable model that produces a text description, which is then injected into the prompt (see [Transparent Vision Proxy](#vision-proxy)).
- "Thinking" indicates a reasoning model with a thinking-effort selector exposed in Copilot Chat. MiniMax M2/M2.1/M3 generations do not expose a thinking selector.
- Configure the proxied vision model with `AIFlowBridge: Set vision proxy model` or via `aiflowbridge.vision.copilotVisionModel`.

### Why is the model list hardcoded?

The list of officially supported models lives in [`resources/models.json`](resources/models.json) (with its JSON Schema in [`resources/models.schema.json`](resources/models.schema.json)) and is **not auto-discovered** from the upstream APIs. This is a deliberate design choice driven by VS Code's `vscode.lm.registerLanguageModelChatProvider` API.

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

A bad capability is a worse user experience than a missing model. A hardcoded registry ensures every supported model works end-to-end on day one. See the [Model registry](#model-registry) section below for how to override individual entries.

**Convention** : the `id` field in `resources/models.json` is the **upstream API id** itself (e.g. `MiniMax-M2.7`, `mimo-v2.5-pro`), not a kebab-case VS Code alias. The picker shows the human-readable `name` field. This avoids any id translation layer between VS Code and the upstream API.

### Adding a model without waiting for a release

You do **not** need a new AIFlowBridge release to use a newly released provider model. Three options, from simplest to most powerful:

#### Option 1 - Command Palette (easiest)

Run **`AIFlowBridge: Add a custom model`** from the Command Palette. The command:

1. Asks which provider to query
2. Fetches the model list from the provider's `/v1/models` endpoint (using your stored API key)
3. Lets you pick a model from the list
4. Lets you pick its capabilities (tool calling, vision, thinking) with simple Yes/No prompts
5. Saves the entry to your `aiflowbridge.userModels` setting

The new model appears in the Copilot Chat picker immediately. You can edit or remove the entry in your user settings at any time.

#### Option 2 - Direct setting (`aiflowbridge.userModels`)

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

#### Option 3 - Registry override (workspace or per-user)

For a more permanent, structured change (pricing, vendor defaults, full schema validation in the editor), use the **model registry** instead of `aiflowbridge.userModels`. Run **`AIFlowBridge: Edit model registry`** - it opens `<globalStorageUri>/models.json` in the editor (creating it from the bundled file if needed). See the [Model registry](#model-registry) section below for the full schema and override rules. Changes apply to the **next VS Code window reload**.

### Promoting a user model to the official registry

If a user-defined model is widely useful, the recommended path is to add it to the official bundled registry in [`resources/models.json`](resources/models.json) via a pull request. The PR will be reviewed for:

- Correct `id` matching the upstream API exactly (use `AIFlowBridge: Add a custom model` or `curl /v1/models` to confirm)
- Correct capabilities (especially image input and thinking)
- Matching `maxInputTokens` / `maxOutputTokens` from the provider's documentation
- Per-model `pricing` block (USD per 1M tokens) - see the `ModelPricing` shape in the [Model registry](#model-registry) section
- Translation key in `package.nls.json` (`model.<id>.detail`)
- Entry in the Providers table above

The release cadence is opportunistic - no fixed schedule. Tag `v1.x.y` when a meaningful set of changes accumulates.

## Installation

### Prerequisites

- VS Code 1.90 or later
- GitHub Copilot subscription (Free / Pro / Enterprise)
- At least one API key from a supported provider

### Install the Extension

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "AIFlowBridge"
4. Click Install

Or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=LaurentOngaro.aiflowbridge).

### Configure API Keys

Run the appropriate command from the Command Palette (`Ctrl+Shift+P`):

```
DeepSeek: Set API Key
MiniMax: Set API Key
Xiaomi MiMo: Set API Key
```

API keys are stored securely in your OS keychain via VS Code's SecretStorage.

## Demo

Once installed, the metrics dashboard is one keyboard shortcut away: press **`Ctrl+Alt+M`** (or `Cmd+Alt+M` on macOS), or run `AIFlowBridge: Show metrics dashboard` from the Command Palette.

### Screenshots

| Dashboard (v1.1.1)                                                                      | Copilot picker (v1.1.1)                                                            | Kilo Code picker (v1.1.1)                                                             |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ![Metrics dashboard](resources/screenshots_v1.1.1/01_AIFB_dashboard_after_a_prompt.png) | ![Copilot picker](resources/screenshots_v1.1.1/03_AIFB_copilot%20LLM%20picker.png) | ![Kilo Code picker](resources/screenshots_v1.1.1/02_AIFB_kiloCode%20LLM%20picker.png) |

| Vision proxy (v1.1.1)                                                                           | Gateway health (v1.1.1)                                                |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ![Vision module](resources/screenshots_v1.1.1/04_AIFB_vision_module_for_Minimax_in_copilot.png) | ![Gateway health](resources/screenshots_v1.1.1/05_AIFB_API_health.png) |

| Output log (v1.1.1)                                                | Settings (v1.1.1)                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| ![Output log](resources/screenshots_v1.1.1/07_AIFB_Output_Log.png) | ![Settings](resources/screenshots_v1.1.1/08_AIFB_settings_1.png) |

| Gateway metrics (v1.4.0)                                                    | Gateway metrics (v1.4.0)                                                    |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| ![Gateway metrics](resources/screenshots_v1.4.0/06a_AIFB_API_metrics_1.png) | ![Gateway metrics](resources/screenshots_v1.4.0/06b_AIFB_API_metrics_2.png) |

### What the dashboard shows

- **Totals**: requests, prompt/completion tokens, estimated cost
- **By model**: requests, tokens, and **Est. cost** sliced by model ID, with time filters (All / Last 1h / 24h / 7d / 30d)
- **Recent requests table**: timestamp, model, tokens, latency, status, **Est. cost** (with the same time filters). Each row has a **trash button** in a leading column that removes the entry from the cumulative counters and from the on-disk file (see [Per-row delete](#per-row-delete)).
- **Provider summary**: requests, tokens, and **Est. cost** by DeepSeek / MiniMax / Xiaomi
- **Gateway badge** in the header shows the running gateway version (`Gateway vX.Y.Z running/stopped`), and a "Current version: vX.Y.Z" subtitle shows the installed extension version
- **Collapsible panels** - each of the four panel sections (Gateway / Recent / By model / Provider) can be collapsed by clicking the chevron in its header. The collapsed state is persisted per-panel in `localStorage`.
- **Custom date range** - two `<input type="date">` controls (From / To) on the Recent requests panel apply on top of the preset time filter. Entering a date deactivates the active preset button; clicking a preset clears the From / To inputs.
- **Text search** - a single search box ("Filter requests…") on the Recent panel matches case-insensitively across model, provider, status, timestamp, duration, tokens, and estimated cost. The by-model panel additionally matches against the model name itself (so a model whose name contains the needle is included even if no individual entry matches).

The status bar shows the current gateway state (running / stopped / error).

### Estimated cost and pricing

The **Est. cost** column shows the cost of each request (or the aggregated total for the row), computed as:

```
cost = (promptTokens * pricing.inputPerMillion
      + completionTokens * pricing.outputPerMillion) / 1_000_000
```

**Indicative defaults** - AIFlowBridge ships with indicative per-million-token rates baked into the bundled model registry ([`resources/models.json`](resources/models.json)) so the dashboard shows non-zero costs out of the box. The current per-model rates are:

| Family      | Input / 1M    | Output / 1M   | Currency | Applies to                                                               |
| ----------- | ------------- | ------------- | -------- | ------------------------------------------------------------------------ |
| DeepSeek    | $0.27 - $0.55 | $1.10 - $2.19 | USD      | V4 Flash, V4 Pro (per-model rates in the registry)                       |
| MiniMax     | $0.30         | $1.20         | USD      | M2, M2.1, M2.1 Highspeed, M2.5, M2.5 Highspeed, M2.7, M2.7 Highspeed, M3 |
| Xiaomi MiMo | $0.10         | $0.30         | USD      | V2 Omni, V2 Pro, V2.5, V2.5 Pro                                          |

Every model in the registry is auto-synthesized into the gateway catalog with the appropriate rate, so the catalog covers all 14 models without any user input.

These are **estimates**, not a quote. The actual tariff depends on your plan tier, region (Xiaomi ships separate plans per cluster: `token-plan-ams`, `token-plan-sgp`, `token-plan-cn`), and whether you use token-plan keys (`tp-*`) or pay-as-you-go. The per-row tooltip on each Est. cost cell shows the rate that was used to compute it.

**Overriding the pricing** - there are three layers, from most permanent to most local:

1. **Workspace override** (`.vscode/aiflowbridge.models.json`) - committed to the project repo, affects only the current workspace, picks up the next time VS Code loads the workspace.
2. **Per-user override** (`<globalStorageUri>/models.json`) - opened via `AIFlowBridge: Edit model registry`, affects all workspaces for the current OS user, picks up on the next VS Code window reload.
3. **Provider override** (`aiflowbridge.providers[].pricing` in `settings.json`) - the most surgical option, lets you change the rate of a single gateway entry without touching the registry. Useful for one-off experiments or per-region billing.

To override the rate for one model only (e.g. Xiaomi on the Singapore cluster, billed in EUR), the easiest path is a globalStorage override of the registry. See the [Model registry](#model-registry) section for the full schema and override rules.

User-declared models added via `aiflowbridge.userModels` (or the **AIFlowBridge: Add a custom model** command) inherit the family-level default pricing automatically - so a custom MiniMax-M3 model gets the same indicative rate as the built-in MiniMax M2.7 profile. Override it the same way by adding a `pricing` block to the synthesized provider entry.

Providers without a `pricing` block show `-` in the Est. cost column, and requests routed through them contribute `0` to the total.

### What the metrics dashboard actually tracks

> **TL;DR** - the dashboard counts requests that go through AIFlowBridge's **local gateway** (Kilo Code, Continue, Open WebUI, curl, OpenAI SDK pointed at `http://127.0.0.1:8787/v1`, etc.). It does **not** count prompts sent directly from Copilot Chat. This is by design, not a bug.

AIFlowBridge ships two complementary integrations. They share models and API keys but have **different telemetry** paths:

|                             | Copilot Chat                                      | Local gateway                                    |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Entry point**             | `vscode.lm` API in VS Code                        | `POST http://127.0.0.1:8787/v1/chat/completions` |
| **Provider implementation** | `src/provider/*.ts` (DeepSeek / MiniMax / Xiaomi) | `src/aiflowbridge/gateway/server.ts`             |
| **Upstream call**           | Direct `fetch` to the vendor                      | Direct `fetch` to the vendor                     |
| **Telemetry recorded?**     | No                                                | Yes (gateway's `TelemetryStore`)                 |

The reason is structural: VS Code's language model API is a push-only interface - the extension returns a stream of tokens, but the framework owns the request lifecycle. AIFlowBridge does not see a "request started / request ended" event it can hook into. The gateway, in contrast, is a regular HTTP server, so it has full request/response metadata (status, duration, prompt/completion token counts from the upstream `usage` field) at the right granularity for per-request metrics.

**Practical implication** - if you want to populate the dashboard, point an OpenAI-compatible client at the gateway. The README's [Gateway](#gateway-optional) section has the full config. Sending a single `curl` is enough to verify the pipeline:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "deepseek-v4-flash", "messages": [{"role": "user", "content": "ping"}]}'
```

The status bar reflects the same source: it shows the gateway state, not Copilot Chat activity. The "requests" counter in the status bar increments only when the gateway handles a request.

### Example workflow

1. Pick a model in Copilot Chat - the gateway stays empty until you exercise it (see the note above)
2. Switch to Kilo Code (or Continue / any OpenAI-compatible client) and point it at `http://127.0.0.1:8787/v1`
3. Send a prompt through that client - the dashboard increments in real time
4. Press `Ctrl+Alt+M` to open the dashboard and inspect token usage, latency, and estimated cost
5. Run `AIFlowBridge: Show logs` to inspect any errors in detail

## Usage

### Basic Usage

1. Set at least one API key (see above)
2. Open Copilot Chat (`Ctrl+Shift+I` or click the chat icon)
3. Click the model picker at the top of the chat
4. Select a model from DeepSeek, MiniMax, or Xiaomi
5. Start chatting - all Copilot features (agent mode, tools, etc.) work automatically

### Vision Proxy

For text-only models (DeepSeek, MiniMax), images are automatically proxied through another model:

1. Drop an image into Copilot Chat
2. AIFlowBridge sends it to a vision-capable model for description
3. The description is injected into the text-only model's prompt

To change the vision proxy model:

```
AIFlowBridge: Set vision proxy model
```

### Gateway (Optional)

The local gateway provides an OpenAI-compatible proxy that can be used by external tools. It starts automatically on port 8787 when the extension activates (if `aiflowbridge.gateway.enabled` is `true`).

The gateway operates as a singleton shared across all VS Code instances. If another VS Code window already has an active AIFlowBridge gateway, the new window will detect and reuse it instead of starting a second instance.

```bash
# Health check
curl http://127.0.0.1:8787/health

# List available models
curl http://127.0.0.1:8787/v1/models

# View metrics
curl http://127.0.0.1:8787/metrics

# Version probe (used by the cooperative restart flow)
curl http://127.0.0.1:8787/version
```

#### Version handling

The gateway exposes `GET /version`, which returns:

```json
{ "name": "aiflowbridge-gateway", "version": "1.4.0", "pid": 1234, "startedAt": "2026-06-04T10:00:00.000Z" }
```

When the extension activates, it probes this endpoint on the configured port. Three outcomes:

- **Same or newer version running** → join silently (no UI). This is the normal case when you open a second VS Code window.
- **Older version running** (typical during extension development / after a marketplace update) → a non-modal information message appears: `AIFlowBridge gateway v1.2.0 is running. Restart with v1.4.0?` with two buttons:
  - **Restart with v1.4.0** → the new activation sends a cooperative `POST /shutdown` to the old gateway, waits up to 3s for the port to free, then binds. The old instance closes its listening socket (no `process.exit(0)`, so the extension host stays alive); no `taskkill`, no orphan node process.
  - **Keep current version** → the new window joins the old gateway, just like a second window would. Use this if you need to keep the old instance alive (e.g. mid-debug with state on it).
  - Dismiss (close the toast) → same as **Keep**. This is the default behaviour for users who do not interact with the toast: no surprise behaviour change.
- **Port occupied by something else** (e.g. `python -m http.server 8787`, or a process from another tool) → the extension logs a warning and lets the bind fail with `EADDRINUSE`. **No** shutdown request is sent, because the peer identifies itself as something other than `aiflowbridge-gateway` and we never touch foreign processes.

A stale-lock guard (`<globalStorageUri>/gateway.lock`, acquired with `fs.openSync(path, 'wx')`) prevents the ping-pong loop when two debug sessions try to restart the gateway at the same time. It is best-effort: if the lock cannot be acquired, the new activation logs a warning and lets the holding activation make the restart decision.

#### Using with Kilo Code or Other OpenAI-Compatible Clients

Any tool that supports the OpenAI API can use AIFlowBridge as a backend via the gateway. This lets you access DeepSeek, MiniMax, and Xiaomi MiMo models from clients other than Copilot Chat.

**Gateway singleton behavior:** The gateway runs as a single instance shared across all VS Code windows. If an AIFlowBridge gateway is already running when you open a new VS Code window, that window will automatically detect and use the existing gateway on port 8787 instead of starting a second instance. This ensures the gateway is always available at the same URL.

**Kilo Code configuration example:**

| Setting      | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| API Provider | OpenAI Compatible                                                       |
| Base URL     | `http://127.0.0.1:8787/v1`                                              |
| API Key      | Any string (keys are managed by AIFlowBridge)                           |
| Model        | `deepseek-v4-flash`, `MiniMax-M2.7`, `mimo-v2.5-pro`, `MiniMax-M3`, ... |

The gateway routes requests to the correct upstream provider based on the model name. Streaming (`stream: true`) is fully supported.

#### Configuring Gateway Providers

The gateway catalog is built from the [model registry](#model-registry) and a few optional `settings.json` overrides. No need to maintain a long list of provider entries by hand - the registry already lists all 14 supported models, and the gateway synthesizes one catalog entry per registry model on activation.

**Auto-synthesized entries** - for every model in the registry, the gateway creates a provider entry using the vendor defaults (from `registry.vendors[<family>].baseUrl`) and the model's per-token pricing. The synthesized `id` matches the registry model `id` exactly, so `GET /v1/models` returns the same set you see in the Copilot Chat picker.

**Overriding the catalog** - the priority order is:

1. **Your overrides** in `aiflowbridge.providers` (highest priority - you take full control and replace the synthesized entry). Use this to point a specific model at a different region/cluster, or to disable it.
2. **Auto-synthesized** entries from the [model registry](#model-registry) - one per `registry.models` entry, with the vendor default `baseUrl` and the per-model `pricing` block.

To override the rate or endpoint for a single model (e.g. Xiaomi on the Singapore cluster, billed in EUR), add an entry to `aiflowbridge.providers` with the matching `model` field. The first entry that matches the model wins.

**Disabling a model from the dashboard catalog** while keeping the others:

```json
{
  "aiflowbridge.providers": [
    {
      "id": "MiniMax-M3",
      "label": "MiniMax M3 (disabled locally)",
      "kind": "openai-compat",
      "baseUrl": "https://api.minimax.io/v1",
      "model": "MiniMax-M3",
      "enabled": false
    }
  ]
}
```

The dashboard and the `GET /v1/models` catalog will skip any provider with `"enabled": false`. Removing an entry from the array does **not** disable the corresponding model - use `"enabled": false` instead, or override it in the [model registry](#model-registry).

**For pricing-only changes** that should apply to all your workspaces (e.g. you have a custom MiniMax rate that you pay via a reseller), prefer editing the registry instead of `aiflowbridge.providers`. See the [Model registry](#model-registry) section below.

### Metrics Dashboard

Press `Ctrl+Alt+M` or run:

```
AIFlowBridge: Show metrics dashboard
```

The dashboard shows:

- Total requests, tokens, and estimated cost
- Per-provider and per-model breakdown
- Recent request history with latency
- Gateway status
- Collapsible panels (state persisted per-panel in `localStorage`)
- Gateway version badge + "Current version" subtitle
- Custom date range (From / To) and a text search field on the Recent requests panel
- Per-row delete button (trash icon) in the Recent requests table

#### Per-row delete

Each row in the "Recent requests" table has a leading trash-icon column. Clicking it:

1. Removes the entry from the in-memory `TelemetryStore` (totals, recent list, per-provider / per-model maps, durations array) and from the on-disk `<globalStorageUri>/telemetry.json` file under the same file lock as `appendDelta` (see [Cross-window shared metrics](#cross-window-shared-metrics))
2. Recomputes p95 from the now-shrunk durations array
3. Re-renders the panel with the updated cumulative counters and the updated recent list

The action column is only rendered when the dashboard is opened from the extension host (which wires an `onRemoveEntry` hook). Backward-compat callers that pass no hook see neither the action column nor the trash button. `AIFlowBridge: Refresh metrics` in any window picks up the deletion because the persister writes through to the on-disk file, which is the source of truth.

#### Cross-window shared metrics

Metrics live in `<globalStorageUri>/telemetry.json` (a sibling `<globalStorageUri>/telemetry.lock` serializes writers across processes). The data is shared across all VS Code windows: every `record()` goes through a file lock, the in-process write chain guarantees sequential file access, and a `Refresh metrics` in any window reloads from disk. This means the totals you see in a non-leader window are the same as the ones the leader just wrote, without needing a window reload.

The file is plain JSON. The Output channel (`AIFlowBridge: Show logs`) prints the path under `[Telemetry]` debug lines, which is the easiest way to find it on Windows / macOS / Linux.

## Settings

### Models

| Setting                   | Default | Description                                                                                                                                                                                                                                                             |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiflowbridge.userModels` | `[]`    | User-declared models merged with the [model registry](#model-registry) on every read. See [Adding a model without waiting for a release](#adding-a-model-without-waiting-for-a-release). User-declared models are also exposed by the local gateway's `GET /v1/models`. |

The official 14-model catalog lives in [`resources/models.json`](resources/models.json) and is overridable per-user (`AIFlowBridge: Edit model registry`) or per-project (`.vscode/aiflowbridge.models.json`). See the [Model registry](#model-registry) section for the full schema.

### Gateway

| Setting                             | Default                    | Description                                   |
| ----------------------------------- | -------------------------- | --------------------------------------------- |
| `aiflowbridge.gateway.enabled`      | `true`                     | Start gateway on activation                   |
| `aiflowbridge.gateway.port`         | `8787`                     | Local proxy port                              |
| `aiflowbridge.gateway.baseUrl`      | `http://127.0.0.1:8787/v1` | Gateway URL                                   |
| `aiflowbridge.gateway.defaultModel` | `""`                       | Default model when client doesn't specify one |

### Providers (Gateway Upstream)

| Setting                                                       | Default                         | Description                                     |
| ------------------------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| `aiflowbridge.providers`                                      | `[]`                            | Array of upstream provider profiles             |
| `aiflowbridge.providers.deepseek.baseUrl`                     | `https://api.deepseek.com`      | DeepSeek API endpoint                           |
| `aiflowbridge.providers.deepseek.maxTokens`                   | `0`                             | Max output tokens (0 = no limit)                |
| `aiflowbridge.providers.deepseek.modelIdOverrides`            | `{}`                            | DeepSeek model ID overrides                     |
| `aiflowbridge.providers.minimax.baseUrl`                      | `https://api.minimax.io/v1`     | MiniMax API endpoint                            |
| `aiflowbridge.providers.minimax.maxTokens`                    | `0`                             | Max output tokens (0 = no limit)                |
| `aiflowbridge.providers.minimax.modelIdOverrides`             | `{}`                            | MiniMax model ID overrides                      |
| `aiflowbridge.providers.minimax.temperature`                  | `1`                             | Sampling temperature for MiniMax                |
| `aiflowbridge.providers.minimax.topP`                         | `0.95`                          | Top-p sampling for MiniMax                      |
| `aiflowbridge.providers.minimax.reasoningSplit`               | `true`                          | Split reasoning into separate field             |
| `aiflowbridge.providers.xiaomi.baseUrl`                       | `https://api.xiaomimimo.com/v1` | Xiaomi MiMo API endpoint                        |
| `aiflowbridge.providers.xiaomi.maxTokens`                     | `0`                             | Max output tokens (0 = no limit)                |
| `aiflowbridge.providers.xiaomi.modelIdOverrides`              | `{}`                            | Xiaomi MiMo model ID overrides                  |
| `aiflowbridge.providers.xiaomi.reasoningRequiredForToolCalls` | `true`                          | Replay reasoning_content in tool-call followups |

### Vision Proxy

| Setting                                  | Default             | Description                                  |
| ---------------------------------------- | ------------------- | -------------------------------------------- |
| `aiflowbridge.vision.excludedVendors`    | `["aiflowbridge"]`  | Vendors that should NOT use the vision proxy |
| `aiflowbridge.vision.copilotVisionModel` | `oswe-vscode-prime` | Vision model for GitHub Copilot              |
| `aiflowbridge.vision.prompt`             | _(built-in)_        | Custom prompt for image description          |

### Telemetry

| Setting                              | Default | Description           |
| ------------------------------------ | ------- | --------------------- |
| `aiflowbridge.telemetry.enabled`     | `true`  | Enable usage tracking |
| `aiflowbridge.telemetry.logRequests` | `true`  | Log each request      |

### Diagnostics

| Setting                  | Default   | Description                         |
| ------------------------ | --------- | ----------------------------------- |
| `aiflowbridge.debugMode` | `minimal` | `minimal`, `metadata`, or `verbose` |

## Commands

In the Command Palette, the provider key commands are grouped under the `AIFlowBridge` category. If you do not see them immediately, search for `set api` or `add custom`.

| Command                                                  | Description                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **AIFlowBridge**                                         |                                                                                                |
| `AIFlowBridge: Show metrics dashboard`                   | Open metrics dashboard                                                                         |
| `AIFlowBridge: Refresh metrics`                          | Refresh status bar                                                                             |
| `AIFlowBridge: Reset metrics`                            | Clear cumulative counters and disk                                                             |
| `AIFlowBridge: Start local gateway`                      | Start proxy                                                                                    |
| `AIFlowBridge: Stop local gateway`                       | Stop proxy                                                                                     |
| `AIFlowBridge: Copy gateway URL`                         | Copy URL to clipboard                                                                          |
| `AIFlowBridge: Open settings`                            | Open extension settings                                                                        |
| `AIFlowBridge: Set vision proxy model`                   | Choose vision model                                                                            |
| `AIFlowBridge: Add a custom model`                       | Declare a new model from `/v1/models`                                                          |
| `AIFlowBridge: Edit model registry`                      | Open the per-user registry override in the editor (creates it from the bundled file if needed) |
| `AIFlowBridge: Reset model registry to bundled defaults` | Delete the per-user override and revert to the bundled file                                    |
| `AIFlowBridge: Open request dumps folder`                | Open the folder of last request dumps                                                          |
| `AIFlowBridge: Show logs`                                | Open output log                                                                                |
| **DeepSeek**                                             |                                                                                                |
| `DeepSeek: Set API Key`                                  | Configure API key                                                                              |
| `DeepSeek: Clear API Key`                                | Remove stored key                                                                              |
| `DeepSeek: Set vision proxy model`                       | Choose vision model (DeepSeek)                                                                 |
| **MiniMax**                                              |                                                                                                |
| `MiniMax: Set API Key`                                   | Configure API key                                                                              |
| `MiniMax: Clear API Key`                                 | Remove stored key                                                                              |
| **Xiaomi MiMo**                                          |                                                                                                |
| `Xiaomi MiMo: Set API Key`                               | Configure API key                                                                              |
| `Xiaomi MiMo: Clear API Key`                             | Remove stored key                                                                              |

## Architecture

```
src/
├── aiflowbridge/                  # Extension-specific: gateway, telemetry, dashboard
│   ├── gateway/                   # OpenAI-compatible proxy server
│   ├── ui/                        # Dashboard webview, status bar
│   ├── telemetry/                 # Cross-window telemetry persistence (file lock + persister)
│   │   └── persistence.ts         # TelemetryPersister + file lock (fs.openSync 'wx')
│   ├── token-counter.ts           # MiniMax /v1/responses/input_tokens wrapper
│   ├── telemetry.ts               # TelemetryStore + cost estimation
│   ├── config.ts                  # Gateway settings loader (incl. userModel synthesis)
│   ├── modelRegistry.ts           # 3-tier loader (bundled < globalStorage < workspace)
│   ├── modelRegistry.schema.ts    # Hand-rolled registry validators + deep merge
│   ├── providers.ts               # Gateway upstream provider normalization
│   └── types.ts
├── provider/                      # Language model providers (Copilot Chat)
│   ├── base.ts                    # Abstract base (reads registry cache + userModels)
│   ├── index.ts                   # DeepSeek
│   ├── minimax.ts                 # MiniMax (HTTP streaming)
│   ├── xiaomi.ts                  # Xiaomi MiMo
│   ├── tools/                     # Tool-calling adapters
│   ├── replay/                    # Reasoning replay (Xiaomi)
│   ├── debug/                     # Request dumps
│   ├── segment/                   # Stream segmentation
│   └── vision/                    # Transparent vision proxy
├── runtime/                       # Extension lifecycle, commands, diagnostics
│   ├── lifecycle.ts
│   ├── commands.ts
│   ├── addCustomModel.ts
│   ├── editModelRegistry.ts
│   ├── resetModelRegistry.ts
│   ├── provider.ts
│   └── actions.ts
└── consts.ts                      # Static constants only (CONFIG_SECTION, API_KEY_SECRETS, ...)
resources/
├── models.json                    # Bundled model registry (14 models, 3 vendors)
└── models.schema.json             # JSON Schema for editor autocompletion
```

### Model registry

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

Merge rules:

- Per `model.id`: `deepMergeModel(base, override)` - top-level fields + `capabilities` + `pricing` are deep-merged, so an override that only sets `pricing` keeps every other field from the bundled entry.
- Per `vendor` key: `deepMergeVendor(base, override)` - `externalUrls` is shallow-merged per key.
- A `model.id` or `vendor` key present only in a higher tier is preserved (lets you add a new model without touching the bundled file).
- Tier existence is fail-safe: a missing tier is fine. A structure error in the bundled tier is **fatal** (the bundled file is shipped with the extension). A structure error in an override tier is **logged and skipped** (the user can fix their override without bricking the extension). A per-entry content error is **logged and dropped** (the rest of the tier is still used).

Schema: [`resources/models.schema.json`](resources/models.schema.json) - JSON Schema Draft 2020-12, referenced via `$schema` in the bundled file for editor autocompletion.

**Minimal override example** (in `<globalStorageUri>/models.json` or `.vscode/aiflowbridge.models.json`) - change the MiniMax M2.7 pricing to whatever your reseller charges:

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

**Add a brand-new model** without editing the bundled file:

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

Validation is hand-rolled (no `ajv` runtime dependency). See [`src/aiflowbridge/modelRegistry.schema.ts`](src/aiflowbridge/modelRegistry.schema.ts) for the validator source.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- npm (included with Node.js)
- [Visual Studio Code](https://code.visualstudio.com/)

### Build

```bash
# Install dependencies
npm install

# Compile TypeScript (cleans out/ first)
npm run compile

# Watch mode - recompiles on file changes
npm run watch
```

### Run in Development Host

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. A new VS Code window opens with the extension loaded from source
4. Make changes, then reload the window (`Ctrl+Shift+R`) to pick them up

### Package & Install

```bash
# Build a .vsix package (output in dist/)
npm run package

# Install locally via CLI
code --install-extension dist/aiflowbridge-<VERSION>.vsix
```

Or install manually: open VS Code → Extensions → `...` menu → **Install from VSIX...** → select the file in `dist/`.

For repeatable local updates, use the helper script in `_helpers/Publish-AIFlowBridge.ps1`:

```powershell
# Build, package, and install into the active profile
.\_helpers\Publish-AIFlowBridge.ps1

# Build, package, and install into every profile folder found on this machine
.\_helpers\Publish-AIFlowBridge.ps1 -AllProfiles
```

## Interactive mode

If you run the helper without `-Profiles` or `-AllProfiles`, the script will detect available local profiles and prompt you to pick which profiles should receive the VSIX (you can type indices like `1,3` or `a` for all). This makes it easier to push local builds into selected profiles during development.

### Publish

```bash
# Requires a Personal Access Token for the VS Code Marketplace
npm run publish
```

## Troubleshooting

**`Gateway failed to start on port 8787`**

Another service (not AIFlowBridge) is using port 8787. Either stop that service, or change AIFlowBridge's port via `aiflowbridge.gateway.port` in your settings.

**`API key not configured`**

Run the matching command from the Command Palette:

- `DeepSeek: Set API Key`
- `MiniMax: Set API Key`
- `Xiaomi MiMo: Set API Key`

The keys live in your OS keychain, not in any file. Use the corresponding `Clear API Key` command to remove them.

**`Vision model not found`**

The configured vision model is not registered with VS Code. Open settings (`AIFlowBridge: Open settings`) and either:

- Clear `aiflowbridge.vision.copilotVisionModel` to use the default
- Pick a model that is currently installed in your environment

**`401 Unauthorized` from an upstream provider**

The API key is missing, invalid, or for the wrong endpoint. Check:

1. The key is set (`AIFlowBridge: Set API Key`)
2. The `baseUrl` setting points to the right region (DeepSeek/MiniMax/Xiaomi each have regional endpoints)
3. The key has the required permissions on the provider's dashboard

**`404 No gateway provider matches model "..."` from the gateway**

Since 1.2.0, the gateway no longer silently routes a request for an unknown model to the first enabled provider (which used to label DeepSeek as "mimo-v2.5" in the dashboard, BUG05). If you see a 404, the model name is not registered in `aiflowbridge.providers` or `aiflowbridge.userModels`. Either:

- Add it via `AIFlowBridge: Add a custom model`
- Configure a provider in `aiflowbridge.providers` with a matching `id` or `model`
- Pass the upstream API id directly (e.g. `MiniMax-M3` instead of `minimax-m3`)

The 404 body lists the available provider ids for reference.

**`Metrics are empty after restart`**

Since 1.5.0, metrics are persisted in `<globalStorageUri>/telemetry.json` and shared across VS Code windows. If the dashboard shows 0, one of:

- You're testing through **Copilot Chat**, which goes through the language model provider APIs directly, not the gateway. Only requests that hit the gateway (Kilo Code, Continue, Open WebUI, curl, etc.) are recorded.
- The legacy `globalState` slot had no data and the new file is empty (1.4.x users: the migration runs once on the first activation after the upgrade and logs `[AIFlowBridge] Migrating telemetry from globalState to ...`).
- Run `AIFlowBridge: Reset metrics` and verify the cumulative counters increment as you make gateway calls.

**`Gateway not detected by Kilo Code`**

- Confirm the gateway is running: `curl http://127.0.0.1:8787/health` should return `{"ok":true,"service":"AIFlowBridge","status":{...}}`
- Use `http://127.0.0.1:8787/v1` as the OpenAI-compatible base URL
- Any string works as the API key (auth is handled by the upstream provider)

**For more details**, run `AIFlowBridge: Show Logs` from the Command Palette.

## Privacy & Security

AIFlowBridge is **local-first** by design:

- **API keys** are stored exclusively in VS Code `SecretStorage` (your OS keychain). They never appear in `settings.json`, in Git history, or in any file you commit.
- **The gateway binds to `127.0.0.1` only** - it is not reachable from other machines on your network.
- **Telemetry is local**: request counts, token usage, and cost estimates stay on your machine. There is no remote analytics endpoint.
- **No third-party tracking**: the extension does not phone home, load remote scripts, or embed analytics SDKs.
- **Outbound requests** only go to the API endpoints you configure: `api.deepseek.com`, `api.minimax.io`, `api.xiaomimimo.com`, or your custom upstream URLs.

You can audit the network traffic from the `AIFlowBridge: Show Logs` output channel.

Report security issues privately - see [`SECURITY.md`](SECURITY.md).

## Roadmap

AIFlowBridge is in active development. The roadmap below is a high-level view of what's coming. Items are tagged with their status. Sponsors (Community tier and above) get early input on prioritization.

### Shipped

- **v1.0** - initial release, DeepSeek + MiniMax + Xiaomi MiMo providers, vision proxy, OpenAI-compatible gateway, metrics dashboard
- **v1.1** - user-defined models via `AIFlowBridge: Add a custom model`, per-model settings, offline docs
- **v1.2** - accurate MiniMax token counting via `/v1/responses/input_tokens`, persistent metrics across restarts, gateway-safe model routing, "By model" dashboard panel with time filters, screenshots, language polish (English only)
- **v1.5** - cross-window shared metrics in `<globalStorageUri>/telemetry.json` (file lock + atomic writes + one-time migration from `globalState`), dashboard UX upgrade (collapsible panels, custom date range, text search, gateway version badge, "Current version" subtitle), per-row delete button in the Recent requests table

### In progress

_Nothing actively in flight right now - the 1.5.0 backlog has shipped._

### Next up

- **Telemetry export** - export the metrics snapshot to JSON / CSV for billing or analysis
- **More agentic coding extension adapters** (e.g. Claude Code) - first-class support for the OpenAI-compatible clients so `aiflowbridge.providers` is auto-pushed to them on activation
- **More openAI-compatible providers** - add more profiles to the default `aiflowbridge.providers` (e.g. Azure, Gemini, Mistral) and test compatibility with the gateway routing
- **Custom OpenAI-compatible upstreams** - bring-your-own endpoint (LM Studio, vLLM, llama.cpp) routed through the same gateway
- **Token-by-token streaming diff in the dashboard** - show the first/last token of each response, not just the total

### Backlog (value to confirm)

- **Web-based dashboard** at `http://127.0.0.1:8787/dashboard` (in addition to the VS Code panel)
- **Workspace-level metrics** - break down usage by current repo / current branch
- **i18n of the extension UI** (only English today, by design - revisit if requests come in)

Want to influence the order? [Open an issue](https://github.com/LaurentOngaro/aiflowbridge/issues) or [join the sponsor discussion](https://github.com/sponsors/LaurentOngaro).

## Sponsoring

AIFlowBridge is **free, open-source, and ad-free**. It will never ask you to pay for a feature, show you ads, or phone home. The code is yours forever, even if I disappear.

<!-- markdownlint-disable MD033 -->
<p align="center">
  <a href="https://github.com/sponsors/LaurentOngaro">
    <img src="https://img.shields.io/github/sponsors/LaurentOngaro?style=for-the-badge&logo=github-sponsors&logoColor=EA4AAA&label=Sponsor%20on%20GitHub" alt="Sponsor on GitHub">
  </a>
  <a href="https://www.patreon.com/LaurentOngaro">
    <img src="https://img.shields.io/badge/Support_on-Patreon-orange?style=for-the-badge&logo=patreon&logoColor=white" alt="Support on Patreon">
  </a>
</p>
<!-- markdownlint-enable MD033 -->

### Why sponsor?

AIFlowBridge is one of several open-source projects I maintain (alongside [UEVaultManager](https://github.com/LaurentOngaro/UEVaultManager), [FabAssetsManager](https://github.com/LaurentOngaro/FabAssetsManager), [TerraBloom](https://playterrabloom.com), and others). Sponsorship funds the **whole body of work**, not just this extension. Your support:

- **Funds dev time** - most weekends and evenings go to OSS, not paid work
- **Funds infrastructure** - CI runners, marketplace signing, domain names
- **Gets you closer to the work** - Discord, early access, roadmap input
- **Keeps everything MIT** - no proprietary "Pro" features, no paywalled tiers

You are sponsoring **indie infrastructure**, not a product. The extension stays free regardless.

### Sponsorship tiers (live from [github.com/sponsors/LaurentOngaro](https://github.com/sponsors/LaurentOngaro))

| Tier               | Price / month | What you get                                                                                                                                    |
| ------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 **Community**   | **$4**        | Private Discord channel · Preview releases & playtest invites · behind-the-scenes devlogs · vote on roadmap priorities                          |
| 🟠 **Contributor** | **$12**       | Everything above, **plus:** exclusive scripts and assets · early access to all releases - Ask for features (reviewed then queued when possible) |
| 🟣 **Supporter**   | **$30**       | Everything above, **plus:** your name in the Project credits · direct Discord access to discuss the Project                                     |

All tiers are **cancel anytime**. Higher tiers also include the public "Sponsor" achievement on your GitHub profile.

> ⚠️ **Heads up**: these tiers are **global to my work** (TerraBloom + all my OSS projects, including AIFlowBridge). The playtest and asset rewards are game-dev-flavored, not specifically for AIFlowBridge. AIFlowBridge itself remains **100% free and feature-complete** at zero tier.

### Sponsors and backers

_This section is updated with each release. **[Become the first sponsor](https://github.com/sponsors/LaurentOngaro)** to have your name (or your team's logo) listed here._

> ⭐ _Want to be listed? Sponsor at the **Community** tier or above and open an issue titled "sponsor listing" with the exact name / link you want shown. If you'd rather stay anonymous, your contribution still counts - thank you._

### Sponsorship platforms

- **GitHub Sponsors** (preferred, USD/EUR): [github.com/sponsors/LaurentOngaro](https://github.com/sponsors/LaurentOngaro)
- **Patreon** (EUR): [patreon.com/LaurentOngaro](https://www.patreon.com/LaurentOngaro)
- **Tipeee** (EUR, communauté francophone): [fr.tipeee.com/laurentongaro](https://fr.tipeee.com/laurentongaro)

## License

[MIT](LICENSE)
