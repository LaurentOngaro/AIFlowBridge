# AIFlowBridge

<!-- markdownlint-disable MD033 -->
<p align="center">
  <img src="resources/icon.png" height="100" alt="AIFlowBridge">
</p>
<p align="center">
  <a target="_blank" href="https://marketplace.visualstudio.com/items?itemName=LaurentOngaro.aiflowbridge">
    <img src="https://badgen.net/vs-marketplace/v/laurentOngaro.aiflowbridge?color=c61452&icon=rolldown" alt="VS Marketplace version">
  </a>
  <a target="_blank" href="https://open-vsx.org/extension/LaurentOngaro/aiflowbridge">
    <img src="https://badgen.net/open-vsx/version/LaurentOngaro/aiflowbridge?label=Open%20VSX&color=a60ee5&icon=rolldown" alt="Open VSX">
  </a>
  <a target="_blank" href="https://github.com/LaurentOngaro/aiflowbridge/stargazers">
    <img src="https://badgen.net/github/stars/LaurentOngaro/aiflowbridge?icon=github" alt="GitHub stars">
  </a>
  <a target="_blank" href="https://github.com/LaurentOngaro/aiflowbridge/blob/main/LICENSE">
    <img src="https://badgen.net/github/license/LaurentOngaro/aiflowbridge?icon=github" alt="License">
  </a>
</p>
<!-- markdownlint-enable MD033 -->

**100+ AI models through one free local gateway.** Use GPT-5.6, Claude Opus 4.8, Gemini 3.5 Flash, Llama 4 Maverick, MiniMax M3, DeepSeek V4, Qwen 3.7 Max, and the rest of the OpenAI-compatible world in GitHub Copilot Chat, Kilo Code, Continue, Open WebUI, and JetBrains AI Assistant.
Smart routing, shared session replay, and live cost tracking included.

> **AIFlowBridge 2.15.1** - data snapshot **2026-07-14**. Model ids and pricing throughout this README are pinned to this snapshot. Refresh per release; verify against the live OpenRouter catalog (`https://openrouter.ai/api/v1/models`) before quoting numbers externally. See [docs/providers.md#data-freshness](docs/providers.md#data-freshness) for the full refresh policy.

**Runs as a VS Code extension **or** as a standalone Node.js binary (~30 MB RAM).**

> ## 🚀 OpenRouter in 3 steps (most users start here)
>
> **1. Grab a key:** [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) (free tier includes Llama 3.3 70B, Mistral Small, Qwen 3, ...).
>
> **2. Plug it in:**
>
> - **VS Code:** `Ctrl+Shift+P` -> `AIFlowBridge: Add a custom model` -> pick **OpenRouter**.
> - **Standalone CLI:** `export AIFLOWBRIDGE_OPENROUTER_API_KEY=sk-or-v1-...` then start the gateway.
>
> **3. Use it** from any OpenAI-compatible client (Kilo Code, Continue, Open WebUI, JetBrains AI Assistant, `curl`, ...):
>
> ```bash
> curl http://127.0.0.1:8787/v1/chat/completions \
>   -H 'Content-Type: application/json' \
>   -d '{"model": "openai/gpt-5.6-sol", "messages": [{"role": "user", "content": "ping"}]}'
> ```
>
> Swap the `model` field for any id at [openrouter.ai/models](https://openrouter.ai/models) - the gateway forwards it verbatim. No AIFlowBridge update needed for new models.

AIFlowBridge is the **OpenRouter equivalent you can run yourself**, plus three direct vendors (DeepSeek, MiniMax, Xiaomi MiMo) for when going direct is cheaper.
The gateway forwards every prompt to the model you (or your client) pick - no surprises, no hidden re-routing.
One OpenRouter key unlocks 100+ frontier models behind a single endpoint; one direct key per vendor unlocks the cheapest available rate.
Mix both worlds in the same Copilot Chat picker, the same `http://127.0.0.1:8787/v1` gateway, the same dashboard.
If you opt in via `aiflowbridge.gateway.languageRouting`, polyglot projects can route Python to DeepSeek Flash, Rust to DeepSeek Pro, free-tier OpenRouter models to everything else, all from a single endpoint.
Pair-programming is built in: the dashboard shows sanitized prompt / response summaries of every recorded request, with one-click replay and a live Server-Sent Events stream so you see new requests land in real time.

> ## Standalone gateway (no VS Code required, since 2.0.0)
>
> The `aiflowbridge-server` CLI runs the gateway as a pure Node.js process: no VS Code, no extension host, ~30 MB RAM. Start it at boot with systemd / launchd / Task Scheduler, point Kilo Code, Continue, or the JetBrains AI Assistant custom endpoint at `http://127.0.0.1:8787/v1`, and the metrics stay consolidated across VS Code and the CLI. If both are running, the second one joins the first instead of starting a duplicate.
>
> **Three install paths:**
>
> A) **[AIFlowBridge: Install standalone gateway](docs/standalone.md)** command in the VS Code extension - one click, platform-matched binary from GitHub Releases (~30 s).
> B) **[Manual download](https://github.com/LaurentOngaro/aiflowbridge/releases/latest)** of the prebuilt archive for your OS - extract and run.
> C) **[Build from source](docs/standalone.md#option-c---build-from-source)** - `git clone` + `npm ci` + `npm run build:standalone`.
>
> Full setup, autostart templates, and client configs: **[docs/standalone.md](docs/standalone.md)**.

## Pick your cost point

> **Data snapshot: 2026-07-14 (AIFlowBridge 2.15.1).** Source: `https://openrouter.ai/api/v1/models` for OpenRouter entries, per-vendor pricing pages for direct vendors. Refresh per release; verify before quoting numbers externally. See [docs/providers.md#data-freshness](docs/providers.md#data-freshness).

One extension, three pricing tiers - choose what fits your workload.
The OpenRouter path trades a small upstream markup for access to 100+ frontier models (GPT-5.6, Claude Opus 4.8, Gemini 3.5 Flash, Llama 4 Maverick, Qwen 3.7 Max, etc.) behind a single API key.
The direct-vendor path squeezes the last cents out of token cost.
The local path is free forever.

| Stack                                                                                            | Monthly cost (heavy use) |
| ------------------------------------------------------------------------------------------------ | ------------------------ |
| GitHub Copilot Pro                                                                               | $10 / month              |
| Cursor Pro                                                                                       | $20 / month              |
| Kilo Code + OpenAI direct                                                                        | ~$15-30 / month          |
| **Kilo Code + AIFlowBridge + OpenRouter free tier** (Llama 3.3 70B, Mistral Small, Qwen 3, etc.) | **~$0-5 / month**        |
| **Kilo Code + AIFlowBridge + Xiaomi MiMo V2.5**                                                  | **~$11 / month**         |
| **Kilo Code + AIFlowBridge + Ollama local**                                                      | **$0 / month**           |

For occasional use, the cheapest stacks (MiMo, Ollama, OpenRouter free tier) cut your AI bill by 40-100% vs Copilot. The full breakdown lives in [docs/cost.md](docs/cost.md).

AIFlowBridge itself is **free, open-source, ad-free, tracker-free, no data collection**.
You pay only the upstream providers you actually use - OpenRouter, DeepSeek, MiniMax, Xiaomi MiMo, or your own local runtime.

## Why AIFlowBridge?

- **100+ AI models behind one OpenRouter key.** AIFlowBridge ships OpenRouter as a first-class upstream: GPT-5.6, Claude Opus 4.8, Gemini 3.5 Flash, Llama 4 Maverick, Mistral Large 2512, Qwen 3.7 Max, DeepSeek V4 Pro, plus every other model id at [openrouter.ai/models](https://openrouter.ai/models) - all routed through the same local gateway. **Seven free-tier flagships are bundled** (Nemotron 3 Ultra 550B, gpt-oss-120b, Gemma 4 31B multimodal, Llama 3.3 70B, Qwen3 Coder 480B, Qwen3 Next 80B, Nemotron 3 Super 120B) so they appear in `GET /v1/models` with $0 dashboard pricing; the other 100+ ids are reachable verbatim by passing them in the `model` field or adding them to `aiflowbridge.userModels`. Compare to running bare OpenRouter: no telemetry, no cost dashboard, no Copilot Chat picker, no JetsBrains client integration. See [docs/providers.md](docs/providers.md#openrouter-100-models-via-a-single-openai-compatible-endpoint)
- **Go direct when it's cheaper.** The same gateway exposes direct DeepSeek (V4 Pro, V4 Flash, $0.27-$0.55 /M in), MiniMax (M2 -> M3, $0.30 /M in), and Xiaomi MiMo (V2 Omni, V2 Pro, V2.5, V2.5 Pro, $0.10 /M in) - no middleman markup on the three direct vendors, full control over your API key. Mix OpenRouter and direct vendors in the same Copilot Chat picker / dashboard - the cheapest model for boilerplate, the smartest for the hard stuff, all from the same chat window. See [docs/providers.md](docs/providers.md)
- **Smart model routing - opt-in, never surprise you.** Out of the box, the gateway routes every request to the model you (or your client) pick in the model picker. If you opt in via `aiflowbridge.gateway.languageRouting` (`"python": "deepseek-flash"`, `"rust": "deepseek-pro"`, `"*": "anthropic/claude-opus-4.8"` - any model id works, OpenRouter or direct), the gateway auto-detects the project language and routes per request. Costs are visible at all times: every routing decision is logged, the dashboard Sessions panel groups requests by provider / model, and the Request details sub-table shows the per-request cost. See [docs/gateway.md](docs/gateway.md#language-based-routing-aiflowbridgegatewaylanguagerouting) and [docs/architecture.md](docs/architecture.md#workspace-context)
- **Workspace context - informational only.** The detected context (languages, package managers, linters, formatters) is injected as a system message so the model knows your toolchain upfront. It never overrides the model picker - see [docs/gateway.md](docs/gateway.md#workspace-context-get-v1context) and [docs/architecture.md](docs/architecture.md#workspace-context)
- **Pair-programming visibility** - the gateway captures sanitized prompt + response summaries on every request (Bearer / `sk-...` / `x-api-key` redacted before storage). The dashboard's Shared session panel shows the last 20 Q&A pairs with one-click replay. Three loopback HTTP endpoints expose the same data for IDE integrations: `GET /v1/sessions` (list), `GET /v1/replay/{id}` (OpenAI-shaped body), `GET /v1/events` (live SSE stream) - see [docs/gateway.md](docs/gateway.md#shared-session-log--replay--sse-stream-get-v1sessions-get-v1replayid-get-v1events)
- **Cost control** - per-request token counts, latency, and estimated cost in a live dashboard (`Ctrl+Alt+M`). Sessions grouped automatically (inactivity gap configurable 1-60 min). Filter by provider, date range, client (Kilo Code vs Continue vs curl), or source (gateway vs Copilot Chat). Paginated, with per-row delete. **Telemetry export**: two buttons (`CSV` and `JSON`) in the Filters panel download the currently filtered entries with a self-describing metadata header (`generatedAt`, `extensionVersion`, `filters`, `totals`). The bundled pricing snapshot is refreshed via `AIFlowBridge: Refresh pricing now` (or the dashboard's `Refresh prices` button) and stamped with `source: ...` on every `Est. cost` tooltip - see [docs/dashboard.md](docs/dashboard.md)
- **Two ways to run it**: as a VS Code extension or as a standalone Node.js binary - see [docs/standalone.md](docs/standalone.md)
- **Vision proxy** for text-only models (paste an image and the description is injected) - see [docs/vision-proxy.md](vision-proxy.md)
- **Reasoning picker** for MiniMax M3 (None/High/Max), Qwen 3.7 Max, and Gemini 3.5 Flash - see [docs/reasoning.md](reasoning.md)
- **Local-first**: API keys in your OS keychain, telemetry on your machine, no remote endpoints

## Features

- **100+ AI models through one OpenRouter key, plus three direct vendors for the cheapest path.** GPT-5.6, Claude Opus 4.8, Gemini 3.5 Flash, Llama 4 Maverick, Mistral Large 2512, Qwen 3.7 Max, DeepSeek V4 Pro - all routed through the same `http://127.0.0.1:8787/v1` gateway. 14 direct-vendor models bundled for the Copilot Chat picker (DeepSeek V4 Pro / Flash, MiniMax M2 through M3, Xiaomi MiMo V2 Omni / Pro / V2.5 / V2.5 Pro). **7 free-tier OpenRouter flagships bundled** for `GET /v1/models` with $0 dashboard pricing (Nemotron 3 Ultra 550B, gpt-oss-120b, Gemma 4 31B multimodal, Llama 3.3 70B, Qwen3 Coder 480B, Qwen3 Next 80B, Nemotron 3 Super 120B). Every other OpenRouter model id is reachable verbatim by passing it in the `model` field - no AIFlowBridge update needed. See [docs/providers.md](docs/providers.md)
- **Workspace context injection** - auto-detects your project's languages, package managers, linters, and formatters, and tells the model upfront on every request so completions are context-aware from the first token - see [docs/gateway.md](docs/gateway.md#workspace-context-get-v1context)
- **Language-based model routing - opt-in** - off by default (`aiflowbridge.gateway.languageRouting = {}`). When you set a non-empty map (`"python": "deepseek-flash"`, `"rust": "deepseek-pro"`, `"*": "MiniMax-M3"` - any model id is accepted, including OpenRouter ones), the gateway picks the right model for each prompt automatically, or honours an explicit `X-AIFlowBridge-Language` header from the IDE. Disable the header override with `aiflowbridge.gateway.allowLanguageHeaderOverride = false`. Full defaults + cost-visibility notes in [docs/gateway.md](docs/gateway.md#language-based-routing-aiflowbridgegatewaylanguagerouting)
- **Pair-programming replay + live stream** - the gateway captures sanitized summaries on every request; `GET /v1/sessions` lists them, `GET /v1/replay/{id}` returns the full OpenAI-shaped body, `GET /v1/events` streams new requests over SSE in real time. The dashboard's Shared session panel surfaces the same data with one-click replay - see [docs/gateway.md](docs/gateway.md#shared-session-log--replay--sse-stream-get-v1sessions-get-v1replayid-get-v1events)
- **Metrics dashboard with sessions** - per-request token counts, latency, and estimated cost. Nine time presets, provider + date-range + text filters, pagination, per-row delete. Requests are auto-grouped into sessions (inactivity gap configurable 1-60 min) so you see your daily workflow at a glance. `Ctrl+Alt+M` from anywhere - see [docs/dashboard.md](docs/dashboard.md)
- **Built-in OpenAI-compatible gateway** - port 8787, runs as a VS Code extension or a standalone CLI, singleton across processes. The gateway is the integration point for OpenRouter, Kilo Code, Continue, JetBrains AI Assistant, Open WebUI, and any `curl` - see [docs/gateway.md](docs/gateway.md) and [docs/standalone.md](docs/standalone.md)
- **Zero-conf discovery** - `GET /v1/discovery` returns one-paste config snippets for Continue, Kilo Code, the OpenAI Python SDK, and curl. Optional UDP beacon broadcasts the gateway URL on the LAN (off by default) - see [docs/gateway.md](docs/gateway.md#zero-conf-discovery-get-v1discovery)
- **Transparent vision proxy** - text-only models handle images via another installed Copilot model. Zero configuration - see [docs/vision-proxy.md](vision-proxy.md)
- **Reasoning picker** for MiniMax M3 (None/High/Max), Qwen 3.7 Max, and Gemini 3.5 Flash - see [docs/reasoning.md](reasoning.md)
- **Secure by default** - API keys in VS Code's `SecretStorage` (or env vars / `secrets.json` in standalone), never in `settings.json`. Credentials in stored summaries are redacted at extraction time. Telemetry is local, loopback-only. No remote endpoints

## Quick start

### 1. Install

**VS Code extension (Copilot Chat, Kilo Code inside VS Code):**

- VS Code Marketplace: [AIFlowBridge](https://marketplace.visualstudio.com/items?itemName=LaurentOngaro.aiflowbridge)
- Open VSX (Cursor, Windsurf, VSCodium): [AIFlowBridge on open-vsx.org](https://open-vsx.org/extension/LaurentOngaro/aiflowbridge)
- From VS Code: Extensions -> search "AIFlowBridge" -> Install

**Standalone gateway (JetBrains, Kilo Code outside VS Code, Open WebUI, curl, autostart at boot):**

```bash
git clone https://github.com/LaurentOngaro/aiflowbridge
cd aiflowbridge
npm ci
npm run build:standalone
node dist/standalone/main.js   # gateway is live on http://127.0.0.1:8787/v1
```

Full setup including autostart systemd / launchd / Task Scheduler templates: **[docs/standalone.md](docs/standalone.md)**.

### 2. Set your API keys

**Start with one OpenRouter key** to unlock 100+ models - that's usually enough for most setups.
Add direct vendor keys later if you want to bypass the OpenRouter markup for heavy workloads on DeepSeek / MiniMax / Xiaomi MiMo.

**VS Code extension** (keys go to your OS keychain):

```
AIFlowBridge: Add a custom model         # prompts for OpenRouter first (100+ models)
AIFlowBridge: Edit model registry        # or paste the OpenRouter entry directly
```

For the three direct vendors (cheapest at high volume):

```
Ctrl+Shift+P  ->  DeepSeek: Set API Key
Ctrl+Shift+P  ->  MiniMax: Set API Key
Ctrl+Shift+P  ->  Xiaomi MiMo: Set API Key
```

**Standalone** (env vars first, then `~/.aiflowbridge/secrets.json` chmod 600):

```bash
export AIFLOWBRIDGE_OPENROUTER_API_KEY=sk-or-v1-...   # 100+ models behind this one key
export AIFLOWBRIDGE_DEEPSEEK_API_KEY=sk-...
export AIFLOWBRIDGE_MINIMAX_API_KEY=...
export AIFLOWBRIDGE_XIAOMI_API_KEY=...
```

### 3. Use it

**Copilot Chat (VS Code):** open Copilot Chat (`Ctrl+Shift+I`), pick a model in the chat header (DeepSeek V4 Pro / Flash, MiniMax M2 -> M3, Xiaomi MiMo V2 Omni / Pro / V2.5 / V2.5 Pro).
OpenRouter models reach Copilot Chat via Kilo Code or Continue, not the Copilot picker.

**Any OpenAI-compatible client (gateway), 100+ models via OpenRouter:**

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "openai/gpt-5.6-sol", "messages": [{"role": "user", "content": "ping"}]}'
```

Swap the `model` field for any of the OpenRouter ids at [openrouter.ai/models](https://openrouter.ai/models) - the gateway forwards verbatim.
Direct vendors work the same way: `MiniMax-M3`, `deepseek-v4-pro`, `mimo-v2.5`, etc.
See [docs/providers.md](docs/providers.md) for the full list.

Point Kilo Code, Continue, JetBrains AI Assistant, Open WebUI, or any OpenAI SDK at `http://127.0.0.1:8787/v1` with any non-empty `apiKey` (the gateway validates credentials upstream, not in the local header).
See [docs/standalone.md](docs/standalone.md#client-setup) for ready-to-paste client configs.

## Documentation

| Page                                                             | Topic                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| [docs/standalone.md](docs/standalone.md)                         | Install, configure, autostart, client setup for the standalone CLI |
| [docs/kilo-code.md](docs/kilo-code.md)                           | Kilo Code setup (Cursor / Windsurf / VSCodium / code-server)       |
| [docs/jetbrains-continue.md](docs/jetbrains-continue.md)         | Continue on JetBrains (Free / Pro)                                 |
| [docs/jetbrains-ai-assistant.md](docs/jetbrains-ai-assistant.md) | JetBrains AI Assistant custom OpenAI endpoint                      |
| [docs/cost.md](docs/cost.md)                                     | Real cost breakdown, indicative rates, vision savings              |
| [docs/providers.md](docs/providers.md)                           | Provider table, capabilities, adding a custom model                |
| [docs/vision-proxy.md](docs/vision-proxy.md)                     | How the transparent image proxy works                              |
| [docs/reasoning.md](docs/reasoning.md)                           | MiniMax M3 thinking effort selector                                |
| [docs/gateway.md](docs/gateway.md)                               | Local OpenAI-compatible gateway, version handling                  |
| [docs/dashboard.md](docs/dashboard.md)                           | Metrics dashboard features, filters, pagination                    |
| [docs/architecture.md](docs/architecture.md)                     | Source layout, model registry 3-tier merge                         |
| [docs/development.md](docs/development.md)                       | Build, test, package, privacy & security                           |
| [docs/troubleshooting.md](docs/troubleshooting.md)               | Common errors and fixes                                            |

## Commands

| Command                                                  | Description                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `AIFlowBridge: Add a custom model`                       | Declare a new model from any `/v1/models` endpoint (OpenRouter is the default pick and unlocks 100+ ids) |
| `AIFlowBridge: Edit model registry`                      | Open per-user registry override in the editor (paste the `vendors.openrouter` block)                     |
| `AIFlowBridge: Reset model registry to bundled defaults` | Revert to bundled catalog                                                                                |
| `AIFlowBridge: Show metrics dashboard`                   | Open metrics dashboard (`Ctrl+Alt+M`)                                                                    |
| `AIFlowBridge: Refresh metrics`                          | Reload status bar from disk                                                                              |
| `AIFlowBridge: Reset metrics`                            | Clear cumulative counters and disk (modal confirmation)                                                  |
| `AIFlowBridge: Purge session log`                        | Clear only the captured prompt / response summaries (totals kept)                                        |
| `AIFlowBridge: Refresh pricing now`                      | Hit OpenRouter `/v1/models`, write `<globalStorageUri>/pricing-override.json`, hot-update the in-memory pricing registry |
| `AIFlowBridge: Open pricing data`                        | Open the bundled `resources/pricing.json` in the editor                                                  |
| `AIFlowBridge: Start local gateway`                      | Start proxy                                                                                              |
| `AIFlowBridge: Stop local gateway`                       | Stop proxy                                                                                               |
| `AIFlowBridge: Copy gateway URL`                         | Copy URL to clipboard                                                                                    |
| `AIFlowBridge: Join external (standalone) gateway`       | Switch to a running standalone gateway                                                                   |
| `AIFlowBridge: Set vision proxy model`                   | Choose vision model                                                                                      |
| `AIFlowBridge: Open settings`                            | Open the AIFlowBridge settings page                                                                      |
| `AIFlowBridge: Show logs`                                | Open output log                                                                                          |
| `AIFlowBridge: Open request dumps folder`                | Reveal the folder with request dumps for diagnosis                                                       |
| `AIFlowBridge: Install standalone gateway`               | Download + extract the standalone CLI for the current OS                                                 |
| `DeepSeek: Set API Key` / `Clear API Key`                | Manage DeepSeek credentials (direct vendor)                                                              |
| `DeepSeek: Set vision proxy model`                       | Alias for `AIFlowBridge: Set vision proxy model`                                                         |
| `MiniMax: Set API Key` / `Clear API Key`                 | Manage MiniMax credentials (direct vendor)                                                               |
| `Xiaomi MiMo: Set API Key` / `Clear API Key`             | Manage Xiaomi MiMo credentials (direct vendor)                                                           |

Note: OpenRouter has no per-vendor `Set API Key` / `Clear API Key` commands by design - it is exposed through the gateway path only (works from Kilo Code, Continue, Open WebUI, curl).
Store the key via `AIFlowBridge: Add a custom model` (the OpenRouter choice is listed first), or via the registry override file, or via the `AIFLOWBRIDGE_OPENROUTER_API_KEY` env var on the standalone CLI.

## Roadmap (extract)

- Ollama local upstream - the next "single-key unlocks N models" milestone, on par with OpenRouter in terms of breadth per key
- auto-routing with failover across the 4 vendors - ordered fallback list (DeepSeek -> MiniMax -> OpenRouter) so an outage on one doesn't block the agent
- web-based dashboard at `http://127.0.0.1:8787/dashboard`
- ...

Released in 2.15.0: **Dynamic pricing and cost estimation** - bundled `resources/pricing.json` (OpenRouter catalog snapshot, refreshed per release and on demand) + dashboard `Refresh prices` button + `AIFlowBridge: Refresh pricing now` + dashboard `CSV` / `JSON` export of the filtered telemetry. See [CHANGELOG.md](CHANGELOG.md#2150).
Just shipped in 2.15.1: **Release-CI hotfix** - the modal helper in `defaultUserPrompt.showModalMessage()` was failing `tsc` with `TS2345` and blocking every release tag. Cast applied; same workaround already in place in `vscode-context-adapter.ts`. See [CHANGELOG.md](CHANGELOG.md#2151).
Just before (2.14.0): audit-driven hardening pass - 3 fixes + 1 defense-in-depth check on the upstream credential path + 3 redundant code paths cleaned up.
Back in 2.12.0: **OpenRouter upstream** (100+ models via single key) - see [CHANGELOG.md](CHANGELOG.md#2120).

Full roadmap: [TODO.md](TODO.md#roadmap--ideas-to-investigate).

## Sponsoring

AIFlowBridge is **free, open-source, ad-free, tracker-free**. It will never ask you to pay for a feature, show you ads, or phone home.
Sponsorship funds the whole body of work, not just this extension.

<!-- markdownlint-disable MD033 -->
<p align="center">
  <a target="_blank" href="https://github.com/sponsors/LaurentOngaro"><img src="https://badgen.net/static/become/a%20GitHub%20SPONSOR?color=EA4AAA&labelColor=blue&icon=githubsponsors&scale=1.2" alt="Become a GitHub Sponsor"></a>&nbsp;&nbsp;
  <a target="_blank" href="https://www.patreon.com/LaurentOngaro"><img src="https://badgen.net/static/Support%20me%20on/Patreon?color=E000000&labelColor=blue&icon=patreon&scale=1.2" alt="Support me on Patreon"></a>
</p>
<!-- markdownlint-enable MD033 -->

## License

[MIT](LICENSE)
