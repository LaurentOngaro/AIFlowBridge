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

**Use DeepSeek V4, MiniMax M3, and Xiaomi MiMo in GitHub Copilot Chat - at $0.27/M input tokens, with a free local OpenAI-compatible gateway for Kilo Code and Continue.**

AIFlowBridge turns Copilot Chat into a multi-model switcher: pick the cheapest model for boilerplate, the smartest for the hard stuff, all from the same chat window - with a per-request cost breakdown in a live dashboard.

## Migrating from Copilot alone?

Microsoft's single-vendor pricing is no longer the cheapest path:

| Stack                                           | Monthly cost (heavy use) |
| ----------------------------------------------- | ------------------------ |
| GitHub Copilot Pro                              | $19 / month              |
| Cursor Pro                                      | $20 / month              |
| Kilo Code + OpenAI direct                       | ~$15–30 / month          |
| **Kilo Code + AIFlowBridge + Xiaomi MiMo V2.5** | **~$11 / month**         |
| **Kilo Code + AIFlowBridge + Ollama local**     | **$0 / month**           |

For occasional use, the cheapest stacks (MiMo, Ollama) cut your AI bill by 40-100% vs Copilot. The full breakdown lives in [docs/cost.md](docs/cost.md).

AIFlowBridge itself is **free, open-source, ad-free, tracker-free, no data collection**. You pay only the upstream providers you actually use.

## Why AIFlowBridge?

- **One place to switch models** in Copilot Chat - no copy-pasting code between vendor sites
- **Local OpenAI-compatible gateway** on port 8787 - Kilo Code, Continue, Open WebUI, curl
- **Per-request metrics**: token counts, latency, estimated cost - see [docs/dashboard.md](docs/dashboard.md)
- **Vision proxy** for text-only models (paste an image and the description is injected) - see [docs/vision-proxy.md](docs/vision-proxy.md)
- **Reasoning picker** for MiniMax M3 (None/High/Max) - see [docs/reasoning.md](docs/reasoning.md)
- **Local-first**: API keys live in your OS keychain, telemetry stays on your machine

## Features

- **Multi-provider in one place** - DeepSeek (V4 Pro, V4 Flash), MiniMax (M2 → M3), Xiaomi MiMo (V2 Omni, V2 Pro, V2.5, V2.5 Pro). See [docs/providers.md](docs/providers.md).
- **Transparent vision proxy** - text-only models handle images via another installed Copilot model. Zero configuration.
- **Built-in OpenAI-compatible gateway** - port 8787, singleton across VS Code windows. See [docs/gateway.md](docs/gateway.md).
- **Copilot Chat integration** - agent mode, tool calling, instructions, MCP, skills. 1M token context on supporting models.
- **Secure by default** - API keys in VS Code's `SecretStorage`, never in `settings.json`. Telemetry is local.

## Quick start

### 1. Install

- VS Code Marketplace: [AIFlowBridge](https://marketplace.visualstudio.com/items?itemName=LaurentOngaro.aiflowbridge)
- Open VSX (Cursor, Windsurf, VSCodium): [AIFlowBridge on open-vsx.org](https://open-vsx.org/extension/LaurentOngaro/aiflowbridge)
- From VS Code: Extensions → search "AIFlowBridge" → Install

### 2. Set your API keys

```
Ctrl+Shift+P  →  DeepSeek: Set API Key
Ctrl+Shift+P  →  MiniMax: Set API Key
Ctrl+Shift+P  →  Xiaomi MiMo: Set API Key
```

Keys are stored in your OS keychain via VS Code's `SecretStorage`.

### 3. Use it

- Open Copilot Chat (`Ctrl+Shift+I`)
- Pick a model in the chat header (DeepSeek, MiniMax, Xiaomi MiMo)
- Or use the local gateway from any OpenAI-compatible client:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "MiniMax-M3", "messages": [{"role": "user", "content": "ping"}]}'
```

## Documentation

| Page                                               | Topic                                                 |
| -------------------------------------------------- | ----------------------------------------------------- |
| [docs/cost.md](docs/cost.md)                       | Real cost breakdown, indicative rates, vision savings |
| [docs/providers.md](docs/providers.md)             | Provider table, capabilities, adding a custom model   |
| [docs/vision-proxy.md](docs/vision-proxy.md)       | How the transparent image proxy works                 |
| [docs/reasoning.md](docs/reasoning.md)             | MiniMax M3 thinking effort selector                   |
| [docs/gateway.md](docs/gateway.md)                 | Local OpenAI-compatible gateway, version handling     |
| [docs/dashboard.md](docs/dashboard.md)             | Metrics dashboard features, filters, pagination       |
| [docs/architecture.md](docs/architecture.md)       | Source layout, model registry 3-tier merge            |
| [docs/development.md](docs/development.md)         | Build, test, package, privacy & security              |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common errors and fixes                               |

## Commands

| Command                                                  | Description                                   |
| -------------------------------------------------------- | --------------------------------------------- |
| `AIFlowBridge: Show metrics dashboard`                   | Open metrics dashboard (`Ctrl+Alt+M`)         |
| `AIFlowBridge: Refresh metrics`                          | Reload status bar                             |
| `AIFlowBridge: Reset metrics`                            | Clear cumulative counters and disk            |
| `AIFlowBridge: Start local gateway`                      | Start proxy                                   |
| `AIFlowBridge: Stop local gateway`                       | Stop proxy                                    |
| `AIFlowBridge: Copy gateway URL`                         | Copy URL to clipboard                         |
| `AIFlowBridge: Add a custom model`                       | Declare a new model from `/v1/models`         |
| `AIFlowBridge: Edit model registry`                      | Open per-user registry override in the editor |
| `AIFlowBridge: Reset model registry to bundled defaults` | Revert to bundled catalog                     |
| `AIFlowBridge: Set vision proxy model`                   | Choose vision model                           |
| `AIFlowBridge: Show logs`                                | Open output log                               |
| `DeepSeek: Set API Key` / `Clear API Key`                | Manage DeepSeek credentials                   |
| `MiniMax: Set API Key` / `Clear API Key`                 | Manage MiniMax credentials                    |
| `Xiaomi MiMo: Set API Key` / `Clear API Key`             | Manage Xiaomi MiMo credentials                |

## Roadmap

- **v1.5** shipped: cross-window shared metrics (`<globalStorageUri>/telemetry.json`), dashboard UX (collapsible panels, date range, text search, version badge, per-row delete)
- **Next**: OpenRouter upstream (100+ models via single key), Ollama local upstream, telemetry export (CSV/JSON), auto-routing with failover

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
