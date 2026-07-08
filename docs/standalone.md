# AIFlowBridge standalone gateway

This document covers installing, configuring, and running the **standalone** AIFlowBridge gateway - the Node.js binary that exposes the same OpenAI-compatible endpoint as the VS Code extension, but without requiring VS Code to be running.

> Looking for the VS Code extension docs?
> See [`../gateway.md`](../gateway.md) for the extension-side gateway, or [`../architecture.md`](../architecture.md) for the overall architecture.

## When to use the standalone gateway

Use the standalone binary when:

- You want to consume the gateway from a client that is **not** VS Code (Continue on JetBrains, JetBrains AI Assistant's custom OpenAI endpoint, Kilo Code running in Cursor / Windsurf / VSCodium, Open WebUI, a `curl` script, an OpenAI SDK pointed at `http://127.0.0.1:8787/v1`, ...).
- You want the gateway to survive VS Code restarts, or to start at boot via a service manager (systemd / launchd / Task Scheduler).
- You want to free up RAM on your dev machine: the standalone binary is a tiny process (~30 MB RSS) compared to a full VS Code + extension host session.

If you only consume the gateway from VS Code itself (Copilot Chat or the Kilo Code extension running inside VS Code), the VS Code extension is enough - no need to install the standalone binary.

## Install

```bash
# From the repository root:
npm ci
npm run build:standalone
```

This compiles `dist/standalone/main.js` from `src/standalone/main.ts` (via `tsconfig.standalone.json`). Symlink it into your `PATH`:

```bash
mkdir -p ~/.local/bin
ln -s "$(pwd)/dist/standalone/main.js" ~/.local/bin/aiflowbridge-server
```

## Configure

The standalone gateway reads its config from `~/.aiflowbridge/config.json` (override with the `AIFLOWBRIDGE_DATA_DIR` env var).
The file is optional - when missing the gateway uses sensible defaults.

See [`./standalone-config.example.json`](./standalone-config.example.json) for the full set of keys.

API keys are resolved in this order:

1. Environment variable: `AIFLOWBRIDGE_<VENDOR>_API_KEY` (e.g. `AIFLOWBRIDGE_DEEPSEEK_API_KEY`, `AIFLOWBRIDGE_MINIMAX_API_KEY`, `AIFLOWBRIDGE_XIAOMI_API_KEY`).
2. File: `~/.aiflowbridge/secrets.json` (chmod `600`).

```json
{
  "deepseek.apiKey": "sk-...",
  "minimax.apiKey": "...",
  "xiaomi.apiKey": "..."
}
```

## Run

```bash
aiflowbridge-server
```

The gateway binds `127.0.0.1:8787` (configurable via `gateway.port` / `gateway.baseUrl` in `config.json`). Hit it from any OpenAI-compatible client:

```bash
curl http://127.0.0.1:8787/v1/models
```

The standalone process and the VS Code extension share the same `gateway.lock` file - if VS Code is already running with the gateway on, the standalone process **joins** the existing gateway instead of starting a second one. See [`./lock-and-restart.md`](./lock-and-restart.md).

## Auto-start at boot

- Linux: [`./autostart/systemd.md`](./autostart/systemd.md)
- macOS: [`./autostart/launchd.md`](./autostart/launchd.md)
- Windows: [`./autostart/windows-task.md`](./autostart/windows-task.md)

## Client setup

- Continue (JetBrains): [`./jetbrains-continue.md`](./jetbrains-continue.md)
- JetBrains AI Assistant (custom OpenAI endpoint): [`./jetbrains-ai-assistant.md`](./jetbrains-ai-assistant.md)
- Kilo Code (Cursor / Windsurf / VSCodium / code-server): [`./kilo-code.md`](./kilo-code.md)
- Open WebUI / OpenAI SDK / curl: the endpoint is `http://127.0.0.1:8787/v1`. The gateway validates the real upstream
  API key server-side, so the `Authorization` header on incoming requests can be any non-empty string (e.g. `Bearer standalone`).

## Observability

The standalone process logs to **stderr** (and the bundled log file at `~/.aiflowbridge/gateway.log` once we add it).
All request telemetry goes to `~/.aiflowbridge/telemetry.json`, shared with the VS Code extension so the two stay in sync (use `AIFlowBridge: Refresh metrics` in VS Code to pull the latest snapshot).
