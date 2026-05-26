# AIFlowBridge

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=LaurentOngaro.aiflowbridge">
    <img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="Install from VS Code Marketplace">
  </a>
  <br/>
  <img src="https://img.shields.io/github/v/release/ongaro-fr/aiflowbridge?style=for-the-badge&label=Version" alt="Version" />
</p>

**Multi-provider AI coding assistant with transparent vision proxy, usage metrics, and OpenAI-compatible local gateway.**

AIFlowBridge brings together multiple AI providers (DeepSeek, MiniMax, Xiaomi MiMo) under a unified interface inside Copilot Chat — with built-in metrics, proxy routing, and vision bridge capabilities.

## Based On

This project is a fork of [DeepSeek V4 for Copilot](https://github.com/Vizards/deepseek-v4-for-copilot) by the original authors. Special thanks to the Vizards team for creating the foundation that made this extension possible.

The original DeepSeek extension pioneered the Transparent Vision Proxy pattern and seamless Copilot Chat integration. AIFlowBridge extends this work to support multiple AI providers while adding new features like usage metrics and local proxy routing.

## Features

### Multi-Provider Support

- **DeepSeek V4 Pro & Flash** — Full capabilities with thinking mode, vision proxy, tool calling
- **MiniMax V2.7** — High-performance coding assistant with tool calling
- **Xiaomi MiMo V2.5** — Multimodal model with native vision and thinking
- **Xiaomi MiMo V2.5 Pro** — Reasoning model (text-only, uses vision proxy)

### Transparent Vision Proxy

Text-only models can handle images via automatic proxy through another installed Copilot model (Claude, GPT-4o, etc.). Zero configuration required — just pick your preferred vision model once.

### Usage Metrics & Local Gateway

- Built-in OpenAI-compatible proxy on port 8787 (starts automatically)
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

## Providers

| Provider | Models           | Vision     | Thinking | Tool Calling |
| -------- | ---------------- | ---------- | -------- | ------------ |
| DeepSeek | V4 Flash, V4 Pro | ✅ Proxied | ✅       | ✅           |
| MiniMax  | V2.7             | ❌         | ❌       | ✅           |
| Xiaomi   | MiMo V2.5        | ✅ Native  | ✅       | ✅           |
| Xiaomi   | MiMo V2.5 Pro    | ✅ Proxied | ✅       | ✅           |

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

## Usage

### Basic Usage

1. Set at least one API key (see above)
2. Open Copilot Chat (`Ctrl+Shift+I` or click the chat icon)
3. Click the model picker at the top of the chat
4. Select a model from DeepSeek, MiniMax, or Xiaomi
5. Start chatting — all Copilot features (agent mode, tools, etc.) work automatically

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

The local gateway provides an OpenAI-compatible proxy for external tools (e.g., Kilo Code):

```bash
# Gateway starts automatically on port 8787
# Access at: http://127.0.0.1:8787/v1

# Health check
curl http://127.0.0.1:8787/health

# List available models
curl http://127.0.0.1:8787/v1/models

# View metrics
curl http://127.0.0.1:8787/metrics
```

Configure gateway providers in settings:

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
      "baseUrl": "https://api.minimax.chat/v1",
      "model": "minimax-v2.7",
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

| Setting                                     | Default                       | Description                         |
| ------------------------------------------- | ----------------------------- | ----------------------------------- |
| `aiflowbridge.providers`                    | `[]`                          | Array of upstream provider profiles |
| `aiflowbridge.providers.deepseek.baseUrl`   | `https://api.deepseek.com`    | DeepSeek API endpoint               |
| `aiflowbridge.providers.deepseek.maxTokens` | `0`                           | Max output tokens (0 = no limit)    |
| `aiflowbridge.providers.minimax.baseUrl`    | `https://api.minimax.chat/v1` | MiniMax API endpoint                |
| `aiflowbridge.providers.xiaomi.baseUrl`     | `https://api.xiaomi.com/v1`   | Xiaomi MiMo API endpoint            |

### Vision Proxy

| Setting                               | Default             | Description                         |
| ------------------------------------- | ------------------- | ----------------------------------- |
| `aiflowbridge.vision.enabled`         | `true`              | Enable vision proxy                 |
| `aiflowbridge.vision.excludedVendors` | `["deepseek"]`      | Vendors that don't need proxy       |
| `aiflowbridge.vision.defaultModel`    | `oswe-vscode-prime` | Default vision model                |
| `aiflowbridge.vision.model`           | `""`                | User-selected vision model          |
| `aiflowbridge.vision.prompt`          | _(built-in)_        | Custom prompt for image description |

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

## Maintainer

**Laurent Ongaro** — [laurent@ongaro.fr](mailto:laurent@ongaro.fr)

## License

[MIT](LICENSE)
