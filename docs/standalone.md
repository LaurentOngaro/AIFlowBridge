# AIFlowBridge standalone gateway

This document covers installing, configuring, and running the **standalone** AIFlowBridge gateway - the Node.js binary that exposes the same OpenAI-compatible endpoint as the VS Code extension, but without requiring VS Code to be running.

> Looking for the VS Code extension docs?
> See [`./gateway.md`](./gateway.md) for the extension-side gateway, or [`./architecture.md`](./architecture.md) for the overall architecture.

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

The command downloads the platform-matched archive from the latest GitHub Release, extracts it, makes the launcher executable (POSIX), and writes the autostart unit if requested.
It is **idempotent**: if an existing install is found at the chosen path, you are prompted to replace it, install alongside, or cancel.

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

This compiles `dist/standalone/main.js` from `src/standalone/main.ts` (via `tsconfig.standalone.json`).
The output is a CommonJS module with **no shebang**, so a bare symlink is not enough on Linux and macOS (`Exec format error`).
Create a wrapper instead:

```bash
mkdir -p ~/.local/bin
printf '#!/bin/sh\nexec node "%s/dist/standalone/main.js" "$@"\n' "$(pwd)" > ~/.local/bin/aiflowbridge-server
chmod +x ~/.local/bin/aiflowbridge-server
```

The official release archives do not need this: they ship a generated launcher at `bin/aiflowbridge-server` (`bin\aiflowbridge-server.cmd` on Windows) that runs the same entry point.

## Configure

The standalone gateway resolves its storage directory in this order (`src/standalone/storage-dir.ts`):

1. the `AIFLOWBRIDGE_DATA_DIR` environment variable, if set (always wins);
2. the VS Code extension's `globalStorage` folder, if it exists on this machine - so on a workstation with the extension installed the standalone gateway shares `config.json`, `secrets.json`, `telemetry.json` and `gateway.lock` with it;
3. `~/.aiflowbridge/`, the fallback for a headless machine with no VS Code install.

That third case is why the paths are written as `<storageDir>/...` below.
If you write `~/.aiflowbridge/config.json` on a machine that also runs the extension, the file is silently ignored: check the startup log line that prints the resolved directory.

`config.json` is optional - when missing, the gateway uses sensible defaults. Keys are **nested**, because the loader splits a dotted key and walks the object:

```json
{
  "gateway": { "port": 8787 },
  "providers": { "minimax": { "baseUrl": "https://api.minimax.io/v1" } }
}
```

See [`./autostart/standalone-config.example.json`](./autostart/standalone-config.example.json) for the full set of keys.

API keys are resolved in this order (the same unified chain as the VS Code extension gateway, backed by `src/aiflowbridge/api-key-sources.ts`):

1. Environment variable: `AIFLOWBRIDGE_<VENDOR>_API_KEY` (e.g. `AIFLOWBRIDGE_DEEPSEEK_API_KEY`, `AIFLOWBRIDGE_MINIMAX_API_KEY`, `AIFLOWBRIDGE_XIAOMI_API_KEY`, `AIFLOWBRIDGE_ZAI_API_KEY`, `AIFLOWBRIDGE_MOONSHOT_API_KEY`, `AIFLOWBRIDGE_OPENROUTER_API_KEY`, `AIFLOWBRIDGE_GOOGLEAISTUDIO_API_KEY`).
The bare vendor name is accepted at the same priority as a fallback: `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`, `XIAOMI_API_KEY`, `ZAI_API_KEY`, `MOONSHOT_API_KEY`, `OPENROUTER_API_KEY` and `GOOGLEAISTUDIO_API_KEY` are read when the prefixed one is absent or empty, so an environment that already exports the vendor keys under their short names works unchanged.
The prefixed name wins when both are set.
The bare name is found by scanning the environment for a `<VENDOR>_API_KEY` variable whose vendor is declared in `API_KEY_SECRETS`, so a vendor added in a later release is picked up with nothing to configure; a name that is not exactly `<VENDOR>_API_KEY` is ignored.
2. File: `<globalStorageDir>/secrets.json` (chmod `600`). The file is re-read when it changes on disk, no restart needed. In the VS Code extension, VS Code `SecretStorage` is the last fallback (the target of the "Set API Key" commands); env vars and the file win over it.

```json
{
  "deepseek.apiKey": "sk-...",
  "minimax.apiKey": "...",
  "xiaomi.apiKey": "...",
  "zai.apiKey": "...",
  "moonshot.apiKey": "...",
  "openrouter.apiKey": "sk-or-v1-...",
  "googleaistudio.apiKey": "AIzaSy..."
}
```

Google AI Studio (Gemini) has two distinct authentication routes. Pick the one that matches your setup:

```bash
# API-key (BYOK, pay-as-you-go on your GCP project, always available):
aiflowbridge-server auth googleaistudio setApiKey <AIzaSy...>            # save an API key in secrets.json
aiflowbridge-server auth googleaistudio clearApiKey                        # revoke it
# ... or set AIFLOWBRIDGE_GOOGLEAISTUDIO_API_KEY in the environment.

# The Google product OAuth route (Antigravity / Cloud Code Assist) was RETIRED in this release. Login, --probe and --list-models now exit non-zero with an explanation, and send nothing to the network:
aiflowbridge-server auth googleaistudio --status                           # local read only: reports the retired state and whether local credentials remain
aiflowbridge-server auth googleaistudio --logout                           # local, idempotent deletion of the legacy credentials (NOT a remote revocation)
```

`--status` never refreshes a token, `--logout` never contacts Google.
Any configuration still pointing at `https://cloudcode-pa.googleapis.com` is refused by the gateway with HTTP 503 and the code `google_product_oauth_unsupported`, before any upstream request.
See [providers.md](providers.md#the-retired-google-product-oauth-route) for the sources behind the decision.

Full vendor notes: [providers.md](providers.md#google-ai-studio-via-api-key-byok-pay-as-you-go).

## Run

```bash
aiflowbridge-server
```

The gateway binds `127.0.0.1:8787` (configurable via `gateway.port` / `gateway.baseUrl` in `config.json`). Hit it from any OpenAI-compatible client:

```bash
curl http://127.0.0.1:8787/v1/models
```

The standalone process and the VS Code extension share the same `gateway.lock` file - if VS Code is already running with the gateway on, the standalone process **joins** the existing gateway instead of starting a second one.
See [Singleton behavior](gateway.md#singleton-behavior) and [Version-aware restart](gateway.md#version-aware-restart) in [gateway.md](gateway.md).

## Auto-start at boot

- Linux: [`./autostart/linux-systemd.md`](./autostart/linux-systemd.md)
- macOS: [`./autostart/macos-launchd.md`](./autostart/macos-launchd.md)
- Windows: [`./autostart/windows-task.md`](./autostart/windows-task.md)

## Client setup

- Continue (JetBrains): [`./jetbrains-continue.md`](./jetbrains-continue.md)
- JetBrains AI Assistant (custom OpenAI endpoint): [`./jetbrains-ai-assistant.md`](./jetbrains-ai-assistant.md)
- Kilo Code (Cursor / Windsurf / VSCodium / code-server): [`./kilo-code.md`](./kilo-code.md)
- Open WebUI / OpenAI SDK / curl: the endpoint is `http://127.0.0.1:8787/v1`. The gateway validates the real upstream
  API key server-side, so the `Authorization` header on incoming requests can be any non-empty string (e.g. `Bearer standalone`).

## Observability

The standalone process writes INFO and DEBUG lines to **stdout**, and WARN and ERROR lines to **stderr** (`src/standalone/vscode-shim.ts`).
There is no log file yet: redirect stdout to a file or run the process under a supervisor to keep one.
All request telemetry goes to `<storageDir>/telemetry.json`, shared with the VS Code extension so the two stay in sync (use `AIFlowBridge: Refresh metrics` in VS Code to pull the latest snapshot).

The standalone gateway exposes the same OpenAI-compatible surface as the VS Code extension, plus the loopback-only pair-programming endpoints added in 2.10.0:

- `GET /v1/sessions?limit=N` - lightweight list of recorded requests (sanitized `promptSummary` + totals). Powered by `TelemetryStore.listSessions()`.
- `GET /v1/replay/{requestId}` - re-hydrates the stored prompt + response summaries into an OpenAI `chat.completion.replay`-shaped body. Pure read from the in-memory store, no upstream re-forward. Powered by `TelemetryStore.getEntry()`.
- `GET /v1/events` - long-lived Server-Sent Events stream (15 s heartbeat comment frames, `ready` / `snapshot` / `request.recorded` event types). Powered by `TelemetryStore.subscribe()`.

All three endpoints bind on `127.0.0.1` only (same posture as the rest of the gateway).
The sanitization step on capture is identical to the VS Code extension's (Bearer / `sk-...` / `x-api-key` / 60+-char token-like blobs redacted to `[REDACTED]`), so the on-disk telemetry file is safe to share via Git or backup.
See [gateway.md](gateway.md#shared-session-log--replay--sse-stream-get-v1sessions-get-v1replayid-get-v1events) for the full request / response shapes.

## Security

### API key resolution

API keys live in **one** of two places, in priority order (env wins over file):

1. Environment variables `AIFLOWBRIDGE_<VENDOR>_API_KEY`, or the bare `<VENDOR>_API_KEY` alias as a fallback.
2. `<storageDir>/secrets.json` (mode `0600` on POSIX).

The gateway reads both lazily via `src/standalone/context.ts` and never logs the values.

### `secrets.json` file permissions

The file is written with mode `0600` (`chmodSync(path, 0o600)`) so only the owning user can read it on POSIX systems (Linux, macOS, WSL).

**Windows limitation.** Windows does not honor POSIX mode bits, so the `chmodSync(0o600)` call is a no-op there.
NTFS ACLs apply, and by default `secrets.json` inherits the user's profile ACL (other local users on the same machine could read it).
This is an accepted limitation of the current implementation: a future hardening pass could shell out to `icacls` on first write to lock the file down to the current user only.
For now, the recommendation on Windows is to prefer the env-var resolution path (1) for any multi-user host.

### `package.json` loading

The standalone entry point reads the extension's root `package.json` (resolved next to `resources/models.json`) with `readFileSync` + `JSON.parse`.
The previous implementation used `require()`, which would execute the file as JavaScript if it were ever replaced by a malicious package; the read+parse path closes that RCE vector (S-01).
