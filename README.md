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

**Use DeepSeek V4, MiniMax M3, and Xiaomi MiMo in GitHub Copilot Chat - at $0.27/M input tokens, with a free local OpenAI-compatible gateway for Kilo Code, Continue, and JetBrains AI Assistant.
Smart routing, shared session replay, and live cost tracking included.**

**Runs as a VS Code extension **or** as a standalone Node.js binary (~30 MB RAM).**

AIFlowBridge turns Copilot Chat into a multi-model switcher: pick the cheapest model for boilerplate, the smartest for the hard stuff, all from the same chat window.
The gateway routes every prompt to the model you (or your client) pick in the model picker - no surprises, no hidden re-routing.
If you opt in via `aiflowbridge.gateway.languageRouting`, polyglot projects can route Python to DeepSeek Flash, Rust to DeepSeek Pro, and everything else to MiniMax M3, all from a single `http://127.0.0.1:8787/v1` endpoint.
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

## Migrating from Copilot alone?

Microsoft's single-vendor pricing is no longer the cheapest path:

| Stack                                           | Monthly cost (heavy use) |
| ----------------------------------------------- | ------------------------ |
| GitHub Copilot Pro                              | $19 / month              |
| Cursor Pro                                      | $20 / month              |
| Kilo Code + OpenAI direct                       | ~$15-30 / month          |
| **Kilo Code + AIFlowBridge + Xiaomi MiMo V2.5** | **~$11 / month**         |
| **Kilo Code + AIFlowBridge + Ollama local**     | **$0 / month**           |

For occasional use, the cheapest stacks (MiMo, Ollama) cut your AI bill by 40-100% vs Copilot. The full breakdown lives in [docs/cost.md](docs/cost.md).

AIFlowBridge itself is **free, open-source, ad-free, tracker-free, no data collection**. You pay only the upstream providers you actually use.

## Why AIFlowBridge?

- **Smart model routing - opt-in, never surprise you.** Out of the box, the gateway routes every request to the model you (or your client) pick in the model picker. If you opt in via `aiflowbridge.gateway.languageRouting` (`"python": "deepseek-flash"`, `"rust": "deepseek-pro"`, `"*": "MiniMax-M3"`), the gateway auto-detects the project language and routes per request. Costs are visible at all times: every routing decision is logged, the dashboard Sessions panel groups requests by provider / model, and the Request details sub-table shows the per-request cost. See [docs/gateway.md](docs/gateway.md#language-based-routing-aiflowbridgegatewaylanguagerouting) and [docs/architecture.md](docs/architecture.md#workspace-context)
- **Workspace context - informational only.** The detected context (languages, package managers, linters, formatters) is injected as a system message so the model knows your toolchain upfront. It never overrides the model picker - see [docs/gateway.md](docs/gateway.md#workspace-context-get-v1context) and [docs/architecture.md](docs/architecture.md#workspace-context)
- **Pair-programming visibility** - the gateway captures sanitized prompt + response summaries on every request (Bearer / `sk-...` / `x-api-key` redacted before storage). The dashboard's Shared session panel shows the last 20 Q&A pairs with one-click replay. Three loopback HTTP endpoints expose the same data for IDE integrations: `GET /v1/sessions` (list), `GET /v1/replay/{id}` (OpenAI-shaped body), `GET /v1/events` (live SSE stream) - see [docs/gateway.md](docs/gateway.md#shared-session-log--replay--sse-stream-get-v1sessions-get-v1replayid-get-v1events)
- **Cost control** - per-request token counts, latency, and estimated cost in a live dashboard (`Ctrl+Alt+M`). Sessions grouped automatically (inactivity gap configurable 1-60 min). Filter by provider, date range, client (Kilo Code vs Continue vs curl), or source (gateway vs Copilot Chat). Paginated, with per-row delete - see [docs/dashboard.md](docs/dashboard.md)
- **Two ways to run it**: as a VS Code extension or as a standalone Node.js binary - see [docs/standalone.md](docs/standalone.md)
- **Vision proxy** for text-only models (paste an image and the description is injected) - see [docs/vision-proxy.md](docs/vision-proxy.md)
- **Reasoning picker** for MiniMax M3 (None/High/Max) - see [docs/reasoning.md](docs/reasoning.md)
- **Local-first**: API keys in your OS keychain, telemetry on your machine, no remote endpoints

## Features

- **Multi-provider in one place** - DeepSeek (V4 Pro, V4 Flash), MiniMax (M2 -> M3), Xiaomi MiMo (V2 Omni, V2 Pro, V2.5, V2.5 Pro). 14 models across 3 vendors - see [docs/providers.md](docs/providers.md)
- **Workspace context injection** - auto-detects your project's languages, package managers, linters, and formatters, and tells the model upfront on every request so completions are context-aware from the first token - see [docs/gateway.md](docs/gateway.md#workspace-context-get-v1context)
- **Language-based model routing - opt-in** - off by default (`aiflowbridge.gateway.languageRouting = {}`). When you set a non-empty map (`"python": "deepseek-flash"`, `"rust": "deepseek-pro"`, `"*": "MiniMax-M3"`), the gateway picks the right model for each prompt automatically, or honours an explicit `X-AIFlowBridge-Language` header from the IDE. Disable the header override with `aiflowbridge.gateway.allowLanguageHeaderOverride = false`. Full defaults + cost-visibility notes in [docs/gateway.md](docs/gateway.md#language-based-routing-aiflowbridgegatewaylanguagerouting)
- **Pair-programming replay + live stream** - the gateway captures sanitized summaries on every request; `GET /v1/sessions` lists them, `GET /v1/replay/{id}` returns the full OpenAI-shaped body, `GET /v1/events` streams new requests over SSE in real time. The dashboard's Shared session panel surfaces the same data with one-click replay - see [docs/gateway.md](docs/gateway.md#shared-session-log--replay--sse-stream-get-v1sessions-get-v1replayid-get-v1events)
- **Metrics dashboard with sessions** - per-request token counts, latency, and estimated cost. Nine time presets, provider + date-range + text filters, pagination, per-row delete. Requests are auto-grouped into sessions (inactivity gap configurable 1-60 min) so you see your daily workflow at a glance. `Ctrl+Alt+M` from anywhere - see [docs/dashboard.md](docs/dashboard.md)
- **Built-in OpenAI-compatible gateway** - port 8787, runs as a VS Code extension or a standalone CLI, singleton across processes - see [docs/gateway.md](docs/gateway.md) and [docs/standalone.md](docs/standalone.md)
- **Zero-conf discovery** - `GET /v1/discovery` returns one-paste config snippets for Continue, Kilo Code, the OpenAI Python SDK, and curl. Optional UDP beacon broadcasts the gateway URL on the LAN (off by default) - see [docs/gateway.md](docs/gateway.md#zero-conf-discovery-get-v1discovery)
- **Transparent vision proxy** - text-only models handle images via another installed Copilot model. Zero configuration - see [docs/vision-proxy.md](docs/vision-proxy.md)
- **Reasoning picker** for MiniMax M3 (None/High/Max) - see [docs/reasoning.md](docs/reasoning.md)
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

**VS Code extension** (keys go to your OS keychain):

```
Ctrl+Shift+P  ->  DeepSeek: Set API Key
Ctrl+Shift+P  ->  MiniMax: Set API Key
Ctrl+Shift+P  ->  Xiaomi MiMo: Set API Key
```

**Standalone** (env vars first, then `~/.aiflowbridge/secrets.json` chmod 600):

```bash
export AIFLOWBRIDGE_DEEPSEEK_API_KEY=sk-...
export AIFLOWBRIDGE_MINIMAX_API_KEY=...
export AIFLOWBRIDGE_XIAOMI_API_KEY=...
```

### 3. Use it

**Copilot Chat (VS Code):** open Copilot Chat (`Ctrl+Shift+I`), pick a model in the chat header (DeepSeek, MiniMax, Xiaomi MiMo).

**Any OpenAI-compatible client:**

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "MiniMax-M3", "messages": [{"role": "user", "content": "ping"}]}'
```

Point Kilo Code, Continue, JetBrains AI Assistant, Open WebUI, or any OpenAI SDK at `http://127.0.0.1:8787/v1` with any non-empty `apiKey` (the gateway validates credentials upstream, not in the local header). See [docs/standalone.md](docs/standalone.md#client-setup) for ready-to-paste client configs.

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

| Command                                                  | Description                                              |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `AIFlowBridge: Show metrics dashboard`                   | Open metrics dashboard (`Ctrl+Alt+M`)                    |
| `AIFlowBridge: Refresh metrics`                          | Reload status bar from disk                              |
| `AIFlowBridge: Reset metrics`                            | Clear cumulative counters and disk (modal confirmation)  |
| `AIFlowBridge: Start local gateway`                      | Start proxy                                              |
| `AIFlowBridge: Stop local gateway`                       | Stop proxy                                               |
| `AIFlowBridge: Copy gateway URL`                         | Copy URL to clipboard                                    |
| `AIFlowBridge: Join external (standalone) gateway`       | Switch to a running standalone gateway                   |
| `AIFlowBridge: Add a custom model`                       | Declare a new model from `/v1/models`                    |
| `AIFlowBridge: Edit model registry`                      | Open per-user registry override in the editor            |
| `AIFlowBridge: Reset model registry to bundled defaults` | Revert to bundled catalog                                |
| `AIFlowBridge: Set vision proxy model`                   | Choose vision model                                      |
| `AIFlowBridge: Open settings`                            | Open the AIFlowBridge settings page                      |
| `AIFlowBridge: Show logs`                                | Open output log                                          |
| `AIFlowBridge: Open request dumps folder`                | Reveal the folder with request dumps for diagnosis       |
| `AIFlowBridge: Install standalone gateway`               | Download + extract the standalone CLI for the current OS |
| `DeepSeek: Set API Key` / `Clear API Key`                | Manage DeepSeek credentials                              |
| `DeepSeek: Set vision proxy model`                       | Alias for `AIFlowBridge: Set vision proxy model`         |
| `MiniMax: Set API Key` / `Clear API Key`                 | Manage MiniMax credentials                               |
| `Xiaomi MiMo: Set API Key` / `Clear API Key`             | Manage Xiaomi MiMo credentials                           |

## Roadmap (extract)

- telemetry export (CSV/JSON)
- OpenRouter upstream (100+ models via single key)
- Ollama local upstream
- auto-routing with failover
- web-based dashboard at `http://127.0.0.1:8787/dashboard`
- ...

Full roadmap: [TODO.md](TODO.md#1-versions-roadmap).

## Sponsoring

AIFlowBridge is **free, open-source, ad-free, tracker-free**. It will never ask you to pay for a feature, show you ads, or phone home. Sponsorship funds the whole body of work, not just this extension.

<!-- markdownlint-disable MD033 -->
<p align="center">
  <a target="_blank" href="https://github.com/sponsors/LaurentOngaro"><img src="https://badgen.net/static/become/a%20GitHub%20SPONSOR?color=EA4AAA&labelColor=blue&icon=githubsponsors&scale=1.2" alt="Become a GitHub Sponsor"></a>&nbsp;&nbsp;
  <a target="_blank" href="https://www.patreon.com/LaurentOngaro"><img src="https://badgen.net/static/Support%20me%20on/Patreon?color=E000000&labelColor=blue&icon=patreon&scale=1.2" alt="Support me on Patreon"></a>
</p>
<!-- markdownlint-enable MD033 -->

## License

[MIT](LICENSE)
