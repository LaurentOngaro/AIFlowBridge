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

### Option A - One-click install from VS Code (recommended)

If you have the AIFlowBridge VS Code extension installed, run:

1. `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette
2. Type `AIFlowBridge: Install standalone gateway` and select it
3. Pick the install folder (defaults: `%LOCALAPPDATA%\aiflowbridge\` on Windows, `~/Applications/AIFlowBridge/` on macOS, `~/.local/share/aiflowbridge/` on Linux)
4. Wait for the download + extraction to complete (one notification, ~30s)
5. Optional: confirm the autostart prompt to register a systemd / launchd / Task Scheduler service so the gateway starts at login

The command downloads the platform-matched archive from the latest GitHub Release, extracts it, makes the launcher executable (POSIX), and writes the autostart unit if requested. It is **idempotent**: if an existing install is found at the chosen path, you are prompted to replace it, install alongside, or cancel.

### Option B - Manual download from GitHub Releases

Each AIFlowBridge release ships a prebuilt archive per platform, attached to the [GitHub Release page](https://github.com/LaurentOngaro/aiflowbridge/releases/latest).
Download the archive for your platform:

| Platform              | Architecture | Archive                                   |
| --------------------- | ------------ | ----------------------------------------- |
| Linux                 | x64          | `aiflowbridge-server-linux-x64.tar.gz`    |
| macOS (Apple Silicon) | arm64        | `aiflowbridge-server-darwin-arm64.tar.gz` |
| macOS (Intel) (1)     | x64          | `aiflowbridge-server-darwin-x64.tar.gz`   |
| Windows               | x64          | `aiflowbridge-server-win-x64.zip`         |

(1): this version can be missing with some releases because github has few available resources for this type of build.

Extract it and run the launcher:

```bash
# POSIX
tar xzf aiflowbridge-server-linux-x64.tar.gz
./aiflowbridge-server-linux-x64/bin/aiflowbridge-server

# Windows (PowerShell)
Expand-Archive aiflowbridge-server-win-x64.zip
.\aiflowbridge-server-win-x64\bin\aiflowbridge-server.cmd
```

Requires Node.js 20+ on the target machine (not bundled - keeps the artifact at ~5 MB instead of 80+ MB).

### Option C - Build from source

If neither Option A nor B fits your use case (custom patches, unreleased platform, offline build), compile from the repository:

```bash
git clone https://github.com/LaurentOngaro/aiflowbridge
cd aiflowbridge
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

## Security

### API key resolution

API keys live in **one** of two places, in priority order (env wins over file):

1. Environment variables `AIFLOWBRIDGE_<VENDOR>_API_KEY`.
2. `~/.aiflowbridge/secrets.json` (mode `0600` on POSIX).

The gateway reads both lazily via `src/standalone/context.ts` and never logs the values.

### `secrets.json` file permissions

The file is written with mode `0600` (`chmodSync(path, 0o600)`) so only the owning user can read it on POSIX systems (Linux, macOS, WSL).

**Windows limitation.** Windows does not honor POSIX mode bits, so the `chmodSync(0o600)` call is a no-op there. NTFS ACLs apply, and by default `secrets.json` inherits the user's profile ACL (other local users on the same machine could read it).
This is an accepted limitation of the current implementation: a future hardening pass could shell out to `icacls` on first write to lock the file down to the current user only.
For now, the recommendation on Windows is to prefer the env-var resolution path (1) for any multi-user host.

### `package.json` loading

The standalone entry point reads the bundled `resources/../package.json` with `readFileSync` + `JSON.parse`.
The previous implementation used `require()`, which would execute the file as JavaScript if it were ever replaced by a malicious package; the read+parse path closes that RCE vector (S-01).
