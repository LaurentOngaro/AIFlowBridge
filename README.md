# AIFlowBridge

<!-- markdownlint-disable MD033 -->
<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=LaurentOngaro.aiflowbridge">
    <img src="https://img.shields.io/badge/VS%20Code-Marketplace-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace">
  </a>
  <a href="https://github.com/LaurentOngaro/aiflowbridge">
    <img src="https://img.shields.io/badge/Source-GitHub-24292f?style=for-the-badge&logo=github&logoColor=white" alt="Source code on GitHub">
  </a>
  <a href="https://github.com/LaurentOngaro/aiflowbridge/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/LaurentOngaro/aiflowbridge?style=for-the-badge" alt="License">
  </a>
</p>
<!-- markdownlint-disable MD033 -->

**Use DeepSeek, MiniMax, and Xiaomi MiMo directly in GitHub Copilot Chat. Free multi-provider models with transparent vision proxy, usage metrics, and an OpenAI-compatible local gateway for Kilo Code, Continue, and more.**

AIFlowBridge brings together multiple AI providers (DeepSeek, MiniMax, Xiaomi MiMo) under a unified interface inside Copilot Chat - with built-in metrics, proxy routing, and vision bridge capabilities.

## Features

### Multi-Provider Support

- **DeepSeek V4 Pro & Flash** - Full capabilities with thinking mode, vision proxy, tool calling
- **MiniMax V2.7** - High-performance coding assistant with tool calling
- **Xiaomi MiMo V2.5** - Multimodal model with native vision and thinking
- **Xiaomi MiMo V2.5 Pro** - Reasoning model (text-only, uses vision proxy)

### Transparent Vision Proxy

Text-only models can handle images via automatic proxy through another installed Copilot model (Claude, GPT-4o, etc.). Zero configuration required - just pick your preferred vision model once.

### Usage Metrics & Local Gateway

- Built-in OpenAI-compatible proxy on port 8787 (starts automatically, singleton across VS Code instances)
- Request, token, and duration telemetry
- Per-provider and per-model cost estimation
- Metrics dashboard (`Ctrl+Alt+M`) with status bar indicator

### Copilot Chat Integration

All providers appear directly in the Copilot Chat model picker:

- Agent mode, tool calling, instructions, MCP, skills
- 1M token context on supporting models
- Thinking mode with reasoning effort control (DeepSeek, Xiaomi)

### Secure by Default

API keys stored in VS Code's `SecretStorage` (OS keychain). Never in `settings.json`, never in Git history.

## Why AIFlowBridge?

GitHub Copilot Chat ships with one vendor. AIFlowBridge adds a multi-provider switcher so you can pick the best model for the job, all from the same chat window.

- **DeepSeek V4** - frontier reasoning at a fraction of the cost. 1M token context, tool calling, thinking mode.
- **MiniMax V2.7** - fast open-weight model with strong tool-use and code completion.
- **Xiaomi MiMo V2.5 / V2.5 Pro** - open-weight multimodal and reasoning models.

Compared to running each provider's CLI or website, AIFlowBridge gives you:

- **One place** to switch models in Copilot Chat (no copy-pasting code between sites)
- **Local OpenAI-compatible gateway** so Kilo Code, Continue, Open WebUI, and any OpenAI-compatible client can use the same models
- **Per-request metrics**: token counts, latency, estimated cost - visible in the dashboard
- **Vision proxy** for text-only models: paste an image and the description is injected automatically
- **Local-first**: API keys live in your OS keychain, telemetry stays on your machine

## Providers

| Provider | Models           | Vision     | Thinking | Tool Calling |
| -------- | ---------------- | ---------- | -------- | ------------ |
| DeepSeek | V4 Flash, V4 Pro | ✅ Proxied | ✅       | ✅           |
| MiniMax  | V2.7             | ✅ Proxied | ❌       | ✅           |
| Xiaomi   | MiMo V2.5        | ✅ Proxied | ✅       | ✅           |
| Xiaomi   | MiMo V2.5 Pro    | ✅ Proxied | ✅       | ✅           |

Note: All models expose the image-paste button in Copilot Chat (`imageInput: true`). Images are transparently converted to text descriptions by the vision proxy (a separate vision-capable model). Configure the vision model with `AIFlowBridge: Set vision proxy model` or via `aiflowbridge.vision.copilotVisionModel`.

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

The dashboard shows:

- **Totals**: requests, prompt/completion tokens, estimated cost
- **Per-provider breakdown**: requests and tokens by DeepSeek / MiniMax / Xiaomi
- **Per-model breakdown**: the same, sliced by model ID
- **Recent requests table**: timestamp, model, tokens, latency, status

The status bar shows the current gateway state (running / stopped / error).

### Example workflow

1. Open Copilot Chat and pick `DeepSeek V4 Pro` from the model picker
2. Ask it a coding question with thinking enabled - watch the status bar for request count
3. Open the dashboard with `Ctrl+Alt+M` to inspect token usage and cost per request
4. Switch to `Xiaomi MiMo V2.5` and ask a follow-up - the same metrics, grouped by model
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
```

#### Using with Kilo Code or Other OpenAI-Compatible Clients

Any tool that supports the OpenAI API can use AIFlowBridge as a backend via the gateway. This lets you access DeepSeek, MiniMax, and Xiaomi MiMo models from clients other than Copilot Chat.

**Gateway singleton behavior:** The gateway runs as a single instance shared across all VS Code windows. If an AIFlowBridge gateway is already running when you open a new VS Code window, that window will automatically detect and use the existing gateway on port 8787 instead of starting a second instance. This ensures the gateway is always available at the same URL.

**Kilo Code configuration example:**

| Setting      | Value                                              |
| ------------ | -------------------------------------------------- |
| API Provider | OpenAI Compatible                                  |
| Base URL     | `http://127.0.0.1:8787/v1`                         |
| API Key      | Any string (keys are managed by AIFlowBridge)      |
| Model        | `deepseek-chat`, `minimax-v2.7`, `mimo-v2.5`, etc. |

The gateway routes requests to the correct upstream provider based on the model name. Streaming (`stream: true`) is fully supported.

#### Configuring Gateway Providers

Gateway providers are configured in VS Code settings (`settings.json`):

```json
{
  "aiflowbridge.providers": [
    {
      "id": "deepseek-flash",
      "label": "DeepSeek Flash",
      "kind": "openai-compat",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-v4-flash",
      "apiKey": "sk-..."
    },
    {
      "id": "minimax",
      "label": "MiniMax V2.7",
      "kind": "openai-compat",
      "baseUrl": "https://api.minimax.io/v1",
      "model": "minimax-v2.7",
      "apiKey": "..."
    },
    {
      "id": "MiMo",
      "label": "Xiaomi MiMo V2.5 Pro",
      "kind": "openai-compat",
      "baseUrl": "https://token-plan-ams.xiaomimimo.com/v1",
      "model": "MiMo-V2.5-PRO",
      "apiKey": "..."
    }
  ]
}
```

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

## Settings

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

In the Command Palette, the provider key commands are grouped under the `AIFlowBridge` category. If you do not see them immediately, search for `set api`.

| Command                                | Description             |
| -------------------------------------- | ----------------------- |
| **AIFlowBridge**                       |                         |
| `AIFlowBridge: Show metrics dashboard` | Open metrics dashboard  |
| `AIFlowBridge: Refresh metrics`        | Refresh status bar      |
| `AIFlowBridge: Start local gateway`    | Start proxy             |
| `AIFlowBridge: Stop local gateway`     | Stop proxy              |
| `AIFlowBridge: Copy gateway URL`       | Copy URL to clipboard   |
| `AIFlowBridge: Open settings`          | Open extension settings |
| `AIFlowBridge: Set vision proxy model` | Choose vision model     |
| `AIFlowBridge: Show logs`              | Open output log         |
| **DeepSeek**                           |                         |
| `DeepSeek: Set API Key`                | Configure API key       |
| `DeepSeek: Clear API Key`              | Remove stored key       |
| **MiniMax**                            |                         |
| `MiniMax: Set API Key`                 | Configure API key       |
| `MiniMax: Clear API Key`               | Remove stored key       |
| **Xiaomi MiMo**                        |                         |
| `Xiaomi MiMo: Set API Key`             | Configure API key       |
| `Xiaomi MiMo: Clear API Key`           | Remove stored key       |

## Architecture

```
AIFlowBridge
├── src/aiflowbridge/           # Gateway, telemetry, UI
│   ├── gateway/server.ts       # OpenAI-compatible proxy
│   ├── telemetry.ts            # Usage tracking & cost estimation
│   ├── ui/dashboard.ts         # Metrics webview
│   ├── ui/statusbar.ts         # Status bar indicator
│   ├── config.ts               # Settings loader
│   └── types.ts                # Shared types
├── src/provider/               # Language model providers
│   ├── base.ts                 # Abstract provider base class
│   ├── index.ts                # DeepSeek provider
│   ├── minimax.ts              # MiniMax provider
│   ├── xiaomi.ts               # Xiaomi provider
│   └── vision/                 # Transparent vision proxy
│       ├── model.ts            # Vision model selection
│       └── resolve.ts          # Image resolution
├── src/runtime/                # Extension lifecycle
│   ├── lifecycle.ts            # Activation & deactivation
│   ├── provider.ts             # Provider registration
│   ├── commands.ts             # Command handlers
│   └── actions.ts              # URI action handlers
└── src/consts.ts               # Model registry & constants
```

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

**Gateway not detected by Kilo Code / Continue**

- Confirm the gateway is running: `curl http://127.0.0.1:8787/health` should return `{"ok":true,"service":"AIFlowBridge"}`
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

## Maintainer

**Laurent Ongaro** - [Laurent Ongaro](https://github.com/LaurentOngaro)

## Sponsoring

AIFlowBridge is free, open-source, and ad-free. If it saves you time or money, consider supporting its development.

**Why sponsor?**

- No tracking, no ads, no paywalls - the extension stays free for everyone
- Your sponsorship funds continued maintenance, new providers, and bug fixes
- You get direct input on the roadmap (Community tier and above)
- You're supporting an indie developer who builds tools for the community

**What your sponsorship funds:**

- Development time for new providers and features
- Hosting and CI infrastructure for the marketplace builds
- Documentation, troubleshooting guides, and community support

**Sponsorship platforms:**

- **GitHub Sponsors** (preferred): [github.com/sponsors/LaurentOngaro](https://github.com/sponsors/LaurentOngaro) - tiered rewards (Community / Contributor / Supporter)
- **Patreon**: [patreon.com/LaurentOngaro](https://www.patreon.com/LaurentOngaro)
- **Tipeee** (communauté francophone): [fr.tipeee.com/laurentongaro](https://fr.tipeee.com/laurentongaro)

**Sponsors and backers** (thank you!):

_This section is updated with each release. Become a sponsor to have your name listed here._

## License

[MIT](LICENSE)
