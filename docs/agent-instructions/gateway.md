# Gateway

> Part of the [agent instructions](../AGENTS.md).

## Endpoints

The local gateway is an OpenAI-compatible HTTP proxy that starts on port 8787 when the extension activates (if `aiflowbridge.gateway.enabled` is `true`):

| Endpoint               | Method | Purpose                                                               |
| ---------------------- | ------ | --------------------------------------------------------------------- |
| `/health`              | GET    | Liveness probe                                                        |
| `/metrics`             | GET    | Prometheus-style metrics                                              |
| `/v1/metrics`          | GET    | Same metrics under the OpenAI-compatible path                         |
| `/v1/models`           | GET    | Catalog (auto-synthesized from the registry)                          |
| `/v1/chat/completions` | POST   | OpenAI-compatible chat completion (streaming supported)               |
| `/v1/context`          | GET    | Detected workspace context (action plan item #2)                      |
| `/v1/discovery`        | GET    | Zero-conf discovery payload + client config snippets (#4)             |
| `/v1/sessions`         | GET    | Recorded Q&A summary list, reverse chronological (#3)                 |
| `/v1/replay/{id}`      | GET    | Re-hydrated prompt + response summaries from the in-memory store (#3) |
| `/v1/events`           | GET    | SSE stream: `ready` / `snapshot` / `request.recorded` events (#3)     |
| `/version`             | GET    | Returns `{ name, version, pid, startedAt, shutdownToken? }`           |
| `/shutdown`            | POST   | Cooperative shutdown (requires `X-AIFlowBridge-Shutdown-Token`)       |

After `start()`, `config.gateway.port` and `config.gateway.baseUrl` are synced to the actual bound port (matters when `port: 0` is configured).

The gateway binds to `127.0.0.1` only - not reachable from other machines on your network.

## Singleton + version-aware cooperative restart

When the configured port is already in use, the gateway probes `GET /version`:

- **Same or newer version, identifies as `aiflowbridge-gateway`** → join silently (no UI). This is the normal case when a second VS Code window opens, or when the standalone CLI is already running. Status bar shows `AIFlowBridge ↗ external` (the `GatewayService.isJoined` getter is `true`).
- **Strictly older peer, identifies as `aiflowbridge-gateway`** → non-modal information message: `AIFlowBridge gateway v1.x.y is running. Restart with v2.x.z?` with two buttons:
  - `Restart with v2.x.z` → sends a cooperative `POST /shutdown` (with the peer's `shutdownToken` from probe), waits up to 3s for the port to free, then binds.
  - `Keep current version` → joins the old gateway.
  - Dismiss the toast → same as Keep. Default behavior for users who do not interact.
- **Foreign service on the port** (e.g. `python -m http.server 8787`) → logs a warning, no prompt, no shutdown. Never touches non-AIFlowBridge processes.

The `/shutdown` endpoint requires a per-instance random token (`randomUUID()` generated at `GatewayService` construction).
The token is returned in `GET /version` and must be echoed in the `X-AIFlowBridge-Shutdown-Token` header.
Requests without the header or with a wrong token get a 403.
Pre-1.7.0 peers do not gate shutdown (backward compat).

## Lock

`src/aiflowbridge/gateway/lock.ts` - `acquireGatewayLock` / `releaseGatewayLock` using `fs.openSync(path, 'wx')`.
Acquired in `lifecycle.ts:activate()` and released in `deactivate()`.
Best-effort guard against the ping-pong loop when two debug sessions restart the gateway simultaneously.
Stale-lock reaper at 30s.

The lock file lives in `<globalStorageUri>/gateway.lock` on VS Code and in `~/.aiflowbridge/gateway.lock` on standalone.

## Telemetry persistence

Every gateway request is recorded with token counts, latency, status, and estimated cost.
Persistence is in `<globalStorageUri>/telemetry.json` on VS Code and `~/.aiflowbridge/telemetry.json` on standalone.
The persister (`src/aiflowbridge/telemetry/persistence.ts`) uses a sibling `telemetry.lock` file to serialize writers across VS Code windows and the standalone CLI, with atomic `write-tmp` + `rename`.

See [telemetry.md](telemetry.md) for the full telemetry architecture.

## Standalone gateway

The gateway can run as a pure-Node.js CLI (`aiflowbridge-server` npm bin, `dist/standalone/main.js`) without a VS Code host. Source under `src/standalone/`:

- `src/standalone/main.ts` - CLI entry point.
- `src/standalone/context.ts` - `createStandaloneContext()` reads API keys from env vars (`AIFLOWBRIDGE_<VENDOR>_API_KEY`, priority 1) or `~/.aiflowbridge/secrets.json` (priority 2, chmod 600). Config hot-reload via `fs.watch` on `~/.aiflowbridge/config.json` with a 5s `fs.watchFile` polling fallback (Windows).
- `src/standalone/config-loader.ts` - `StandaloneConfigFile` reader for `~/.aiflowbridge/config.json`. Falls back to bundled defaults.
- `src/standalone/util.ts` - shared `getNestedValue` helper (extracted from the duplicate copies that previously lived in `context.ts` and `config-loader.ts`).
- `src/standalone/vscode-shim.ts` - `vscode` module shim so the gateway code typechecks without `@types/vscode`.

Build with `npm run build:standalone` (driven by `tsconfig.standalone.json`). Run with `node dist/standalone/main.js` or `npm run start:standalone`.
The VSIX excludes `dist/standalone/`, `src/standalone/`, and `tsconfig.standalone.json` (see `.vscodeignore`).

Shared `gateway.lock` path means only one process owns the gateway - VS Code and standalone cooperate via the existing `lock.ts` + `probe.ts` flow.

## Provider routing

Provider routing by model alias via `aiflowbridge.providers` array (in `settings.json`). Each entry has:

- `id` - stable identifier
- `label` - human-readable name
- `kind` - `openai-compat` or `ollama`
- `baseUrl` - upstream API base URL
- `model` - concrete upstream model name
- `enabled` - default true; set false to hide from `GET /v1/models` and the dashboard catalog
- `pricing` - optional `{ inputPerMillion, outputPerMillion, currency }`

The catalog is built from the [model registry](registry.md) (one auto-synthesized entry per registry model) plus the user-configured `aiflowbridge.providers` array (user wins over auto-synthesized on id collision).

## Security

- Binds `127.0.0.1` only.
- `POST /shutdown` requires the per-instance token (1.7.0+).
- Provider `baseUrl` validated against SSRF metadata endpoints (1.7.0+).
- API key redaction in diagnostic logs (2.1.0+).
- Upstream error messages sanitized to strip query strings and `api_key` / `Authorization` references (2.0.0+).
- Probe responses limited to 4 KiB + JSON parse guard (2.0.0+).
- Rate limiting: `aiflowbridge.gateway.maxConcurrentRequests` (default 20) - excess requests return HTTP 429 with `Retry-After: 1`.
- Probe timeout: `aiflowbridge.gateway.probeTimeoutMs` (default 500) with 1 retry / 100 ms back-off.
