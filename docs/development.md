# Development & privacy

> Part of the [AIFlowBridge documentation](../README.md).

## Build

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- npm (included with Node.js)
- [Visual Studio Code](https://code.visualstudio.com/)

### Scripts

```bash
# Install dependencies
npm install

# Compile TypeScript (cleans out/ first)
npm run compile

# Watch mode - recompiles on file changes
npm run watch

# Compile the standalone gateway CLI (dist/standalone/main.js)
npm run build:standalone

# Run the standalone gateway CLI from a build
npm run start:standalone
```

## Run in Development Host

1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. A new VS Code window opens with the extension loaded from source
4. Make changes, then reload the window (`Ctrl+Shift+R`) to pick them up

## Run the tests

```bash
# Full vitest suite (unit tests)
npm test

# Watch mode (vitest native --watch)
npx vitest --watch
```

The extension ships with **an exhaustive battery of unit tests** (vitest) covering the registry loader, gateway HTTP routes, telemetry store and persister, dashboard generation, provider ID resolution, the file-locking telemetry persister, the standalone CLI context, and end-to-end cooperative restart flows.

## Package & install locally

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
.\Publish-AIFlowBridge.ps1

# Build, package, and install into every profile folder found on this machine
.\Publish-AIFlowBridge.ps1 -AllProfiles
```

### Interactive mode

If you run the helper without `-Profiles` or `-AllProfiles`, the script will detect available local profiles and prompt you to pick which profiles should receive the VSIX (you can type indices like `1,3` or `a` for all). This makes it easier to push local builds into selected profiles during development.

## Publish

```bash
# Publish to VS Code Marketplace (requires a Personal Access Token)
npm run publish:vscode

# Publish only to Open VSX (Cursor, Windsurf, VSCodium, code-server)
npm run publish:openvsx

# Publish to both stores
npm run publish:all
```

The release workflow (`.github/workflows/release-please.yml`) drives marketplace publication from version tags. `release-please` opens/updates the release PR; merging it creates a `vx.y.z` tag and triggers the publishing workflow. The Open VSX counterpart (`.github/workflows/publish.yml`) requires an `OPENVSX_TOKEN` repository secret.

## Privacy & Security

AIFlowBridge is **local-first** by design:

- **API keys** are stored exclusively in VS Code `SecretStorage` (your OS keychain) on the VS Code side, and in `AIFLOWBRIDGE_<VENDOR>_API_KEY` env vars or `~/.aiflowbridge/secrets.json` (`chmod 600` on POSIX) on the standalone side. They never appear in `settings.json`, in Git history, or in any file you commit.
- **The gateway binds to `127.0.0.1` only** - it is not reachable from other machines on your network.
- **Telemetry is local**: request counts, token usage, and cost estimates stay on your machine at `<globalStorageUri>/telemetry.json` (VS Code) or `~/.aiflowbridge/telemetry.json` (standalone). The two files are shared so the dashboard stays in sync across both hosts. There is no remote analytics endpoint.
- **No third-party tracking**: the extension does not phone home, load remote scripts, or embed analytics SDKs.
- **Outbound requests** only go to the API endpoints you configure: `api.deepseek.com`, `api.minimax.io`, `api.xiaomimimo.com`, or your custom upstream URLs.
- **Provider `baseUrl` SSRF validation (1.7.0+)**: non-http(s) schemes and cloud metadata endpoints (`169.254.x.x`, `100.100.100.200`, `fd00:ec2::254`) are rejected.
- **Cooperative shutdown auth (1.7.0+)**: `POST /shutdown` requires a per-instance token returned by `GET /version`.
- **API key redaction in logs** (2.1.0): every diagnostic line that would surface a `ProviderProfile` strips the `apiKey` field.

You can audit the network traffic from the `AIFlowBridge: Show Logs` output channel.

Report security issues privately - see [`SECURITY.md`](../SECURITY.md).

## License

[MIT](../LICENSE)
