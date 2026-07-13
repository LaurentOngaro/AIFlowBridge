# Local gateway

> Part of the [AIFlowBridge documentation](../README.md).

The local gateway provides an OpenAI-compatible proxy that can be used by external tools.
It starts automatically on port 8787 when the extension activates (if `aiflowbridge.gateway.enabled` is `true`).

## Endpoints

```bash
# Health check
curl http://127.0.0.1:8787/health

# List available models
curl http://127.0.0.1:8787/v1/models

# Chat completion (OpenAI-compatible)
curl http://127.0.0.1:8787/v1/chat/completions

# Metrics (request counts, latency, errors)
curl http://127.0.0.1:8787/metrics

# Version probe (cooperative restart flow)
curl http://127.0.0.1:8787/version

# Cooperative shutdown (only an aiflowbridge-gateway instance will honour it)
curl -X POST http://127.0.0.1:8787/shutdown

# Recorded sessions (Q&A summary list, for pair programming)
curl 'http://127.0.0.1:8787/v1/sessions?limit=20'

# Replay one recorded session (pure read from the in-memory store)
curl http://127.0.0.1:8787/v1/replay/<requestId>

# Live event stream (Server-Sent Events: ready / snapshot / request.recorded)
curl -N http://127.0.0.1:8787/v1/events
```

### Workspace context (`GET /v1/context`)

When `aiflowbridge.gateway.workspaceContext.enabled` is `true` (default), the gateway scans the workspace root for language manifests (`pyproject.toml`, `Cargo.toml`, `package.json`, ...) and injects a short system message into every `/v1/chat/completions` body so the upstream model knows which language / package manager / linter / formatter governs the project.

The same detector powers a read-only JSON endpoint that returns the raw detection:

```bash
curl http://127.0.0.1:8787/v1/context
# {
#   "enabled": true,
#   "root": "/home/me/proj",
#   "languages": ["python", "javascript"],
#   "primaryLanguage": "python",
#   "packageManagers": ["poetry / uv / pdm", "npm / pnpm / yarn / bun"],
#   "linters": ["ruff / pylint / flake8", "eslint / biome"],
#   "formatters": ["black / ruff", "prettier / biome"]
# }
```

The detector is memoized on the `root + options` key with a 5-second TTL, so concurrent chat-completion requests against the same workspace share a single `readdirSync` walk (CR02 fix B1).
The resolution order for the workspace root is:

1. `aiflowbridge.gateway.workspaceContext.root` (explicit)
2. `AIFLOWBRIDGE_WORKSPACE` environment variable (lets a service manager point the standalone CLI at the user's project)
3. `process.cwd()` (standalone CLI launched from the project root), ONLY when the cwd contains a project sentinel (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `CMakeLists.txt`, `mix.exs`, `Package.swift`, `composer.json`, `meson.build`, `.git`). This guards the standalone CLI deployment where Windows Task Scheduler / systemd / launchd launch `aiflowbridge-server.cmd` from the install directory: the cwd would otherwise resolve to the install path and the gateway would inject its own `package.json` as the "workspace context" on every chat completion (`/review uncommitted` F8 deploy-safety fix). When the resolved cwd equals the install path, a one-shot warning is logged and injection is skipped.

When the explicit root does not resolve (ENOENT, EACCES, or non-directory file), the gateway logs a one-shot warning and falls back to the env var / cwd.

### Language-based routing (`aiflowbridge.gateway.languageRouting`)

> **Default behavior: OFF.** Out of the box (`languageRouting = {}`), every request goes to the model you (or your client) picked in the model picker. Language-based routing is an **opt-in** feature. It will never silently re-route a request unless you have explicitly added a non-empty entry to the configuration.

If you opt in, the gateway can pick the upstream model automatically based on the detected project language.
This is meant for polyglot projects where each language is best served by a different upstream (Python on DeepSeek Flash, Rust on DeepSeek Pro, ...).

**Enable it** by setting a non-empty map in `settings.json` (or the standalone equivalent):

```jsonc
{
  "aiflowbridge.gateway.languageRouting": {
    "python": "deepseek-flash", // routes Python work to DeepSeek Flash
    "rust": "deepseek-pro", // routes Rust work to DeepSeek Pro
    "typescript": "MiniMax-M3", // routes TS/JS work to MiniMax M3
    "*": "MiniMax-M3", // any other language falls back to MiniMax M3
  },
}
```

**Resolution order** for the language hint:

1. **`X-AIFlowBridge-Language` HTTP header** set by the client (60-char cap, BCP-47-tag-shaped values only). This lets an IDE force a specific language regardless of context. Disabled on shared / hardened machines by setting `aiflowbridge.gateway.allowLanguageHeaderOverride = false` (default `true`).
2. **Workspace context** - the detector above walks the workspace root for language manifests (`pyproject.toml`, `Cargo.toml`, `package.json`, ...) and uses the primary language.
3. **Payload sniffing** (`detectLanguageHintFromPayload`) - the gateway scans the first 20 messages for a recognisable filename (`.py`, `.rs`, `.go`, `.ts`, `.tsx`, `.kt`, `.swift`, `.cpp`, `.hpp`, ...). Anti-false-positive guards reject URL fragments (`https://.../foo.py`), path-traversal (`../foo.py`), and longer identifiers (`foo.pyy`).

**How the value maps to a provider.** Each routing entry is a `providerId`.
The resolver matches it (case-insensitive, locale-aware) against `provider.id`, `provider.model`, or `provider.label` of the enabled providers in `aiflowbridge.providers`.
The first enabled match wins; if none match, the request falls back to the normal `selectProvider(model, defaultModel)` chain - the language rule **never** silently drops a request.

**Cost visibility.** Every routing decision is observable:

- The dashboard's **Sessions** panel groups requests by client, provider, and model. Hover any row to see the resolved `providerId` / `providerLabel` - you always see which upstream was used.
- The dashboard's **Request details** sub-table shows the prompt, the upstream, the token counts, and the estimated cost for each individual request inside a session.
- The verbose log line `[language-routing] hint=<lang> -> <providerId>` (and `[language-routing] honor header (override allowed, hint=<lang>)`) is emitted on every resolved request. Set `aiflowbridge.gateway.logRequests = true` to see it in the gateway logs (the setting is off by default to keep the log lean).
- `GET /v1/context` returns the workspace detector result (raw, no upstream call). `GET /v1/sessions?limit=N` returns the most recent routing decisions in the same shape as the dashboard.

**When in doubt, leave it at `{}`.** The default is chosen so a user who has never opened the settings page gets exactly the behavior described in the README: every prompt goes to the model they picked, no surprises.
Add entries only when you have a clear cost / quality case for routing a specific language to a specific upstream.

### Zero-conf discovery (`GET /v1/discovery`)

When `aiflowbridge.gateway.discovery.enabled` is `true`, the gateway exposes a one-paste configuration endpoint on the loopback URL and (optionally) broadcasts its presence over UDP so LAN tools can pick it up without any pre-shared URL.

```bash
curl http://127.0.0.1:8787/v1/discovery
# {
#   "enabled": true,
#   "host": "127.0.0.1",
#   "port": 8787,
#   "version": "2.7.0",
#   "protocol": "openai",
#   "path": "/v1",
#   "broadcasting": true,
#   "broadcastPort": 8788,
#   "broadcastIntervalMs": 2000,
#   "clients": [
#     { "id": "continue", "displayName": "Continue (VS Code / JetBrains)", "config": "{ ... }" },
#     { "id": "kilocode",  "displayName": "Kilo Code", "config": "{ ... }" },
#     { "id": "openai-sdk","displayName": "OpenAI Python SDK", "config": "from openai import OpenAI\n..." },
#     { "id": "curl",      "displayName": "curl", "config": "curl -X POST ..." }
#   ]
# }
```

The UDP beacon (when enabled) broadcasts a tiny JSON payload on `gateway.discovery.broadcastPort` (default `8788`) every `gateway.discovery.broadcastIntervalMs` (default `2000` ms). **Privacy caveat:** the UDP broadcast announces the gateway's existence to every host on the LAN.
The payload contains only the loopback host, the TCP port, and the gateway version - no API key, no workspace path, no model.
The HTTP `/v1/discovery` endpoint is reachable on the loopback URL only (the gateway binds `127.0.0.1`); the HTTP endpoint and the UDP broadcast are gated on the same `discovery.enabled` flag.

`broadcastPort` is clamped at runtime to the IANA registered-port range `[1024, 65535]`.
Values outside that range (e.g. `0`, hand-edited config) fall back to `8788` with a warning. `broadcastIntervalMs` is clamped to `[500, 300_000]` for the same reason.

**Network reachability caveats.** The UDP broadcast is best-effort and depends on the host's network stack. The beacon will not reach:

- **VPNs and corporate networks** that filter limited broadcast (`255.255.255.255`) at the L3 boundary - the packet is dropped before any LAN listener can see it. Configure a static peer URL instead.
- **WSL 2** with the default virtual switch - WSL 2 runs in a managed VM with its own NAT; the broadcast does not propagate to the Windows host or the LAN. Configure a static peer URL (`http://127.0.0.1:<port>/v1`) or use port forwarding (`netsh interface portproxy add v4tov4 listenport=8787 listenaddress=0.0.0.0 connectport=8787 connectaddress=127.0.0.1`).
- **Container runtimes** (Docker Desktop, Podman) where the container's network namespace is isolated - the broadcast exits the container but typically never reaches the host's LAN unless `--net=host` is used.
- **Firewalled segments** - a strict outbound-allow list will drop the destination UDP packet on the way out.

If the broadcast does not reach a peer, the same IDE can still connect by configuring the gateway URL explicitly (`http://127.0.0.1:8787/v1`).
The UDP beacon is a convenience, not a requirement.

### Shared session log + replay + SSE stream (`GET /v1/sessions`, `GET /v1/replay/{id}`, `GET /v1/events`)

These three endpoints (added in 2.10.0) close the pair-programming loop: a developer can see what the AI just told their pair, replay the original assistant message without re-running the upstream call, and watch new requests land in real time.

When `aiflowbridge.telemetry.captureSessionLog` is `true` (default), every recorded `RequestTelemetry` carries a sanitized + truncated `promptSummary` (max 500 chars) and `responseSummary` (max 1000 chars).
Both are stored in memory and on disk alongside the regular counters; both are redacted at extraction time so a `Bearer ...`, `sk-...`, or `x-api-key: ...` value (and any 60+-char token-like blob without whitespace) never reaches the on-disk telemetry file.

The three endpoints:

```bash
curl 'http://127.0.0.1:8787/v1/sessions?limit=20'
# {
#   "object": "list",
#   "sessions": [
#     {
#       "id": "99929fbd-...",
#       "timestamp": "2026-07-11T17:14:54.243Z",
#       "providerId": "minimax",
#       "providerLabel": "MiniMax M3",
#       "model": "MiniMax-M3",
#       "status": 200,
#       "durationMs": 3642,
#       "totalTokens": 1842,
#       "promptSummary": "What does HTTP 429 mean on the MiniMax streaming endpoint?"
#     },
#     ...
#   ]
# }

curl http://127.0.0.1:8787/v1/replay/99929fbd-9ab1-485c-993f-01b7acf85ff5
# {
#   "id": "99929fbd-...",
#   "object": "chat.completion.replay",
#   "created": 1720708494,
#   "model": "MiniMax-M3",
#   "providerId": "minimax",
#   "providerLabel": "MiniMax M3",
#   "status": 200,
#   "durationMs": 3642,
#   "usage": { "promptTokens": 12, "completionTokens": 1830, "totalTokens": 1842 },
#   "promptSummary": "What does HTTP 429 mean on the MiniMax streaming endpoint?",
#   "responseSummary": "HTTP 429 means Too Many Requests. Back off and retry after the time in Retry-After ...",
#   "choices": [{ "index": 0, "message": { "role": "assistant", "content": "HTTP 429 means ..." }, "finish_reason": "stop" }]
# }

curl -N http://127.0.0.1:8787/v1/events
# event: ready
# data: {"ok":true}
#
# event: snapshot
# data: {"recentCount":0}
#
# event: request.recorded
# data: {"id":"99929fbd-...","timestamp":"2026-07-11T17:14:54.243Z","providerId":"minimax",...}
#
# : heartbeat 1720708500
# : heartbeat 1720708515
# ...
```

Notes:

- `GET /v1/replay/{requestId}` is a **pure read** from the in-memory `TelemetryStore` - no upstream re-forward, safe to fire indefinitely. Returns `400` for missing or overlong (`128+` chars) ids, `404` for unknown ids, `200` with the re-hydrated `chat.completion`-shaped body otherwise. The replay body mirrors the OpenAI non-streaming shape so a pair can paste it back into their IDE without further translation.
- `GET /v1/events` is a long-lived `text/event-stream` connection. The gateway sends a `ready` frame on connect, a `snapshot` frame with `{ recentCount }` so the client sees the current state, and a `request.recorded` frame on every `TelemetryStore.record()` call. A 15 s heartbeat comment frame (`: heartbeat <ts>`) keeps intermediaries from timing the connection out. Listeners are detached on `request.once('close' | 'aborted', cleanup)` so no leak across reconnects.
- The three endpoints are loopback-only (the gateway binds `127.0.0.1`), same posture as `/health`, `/version`, `/v1/models`. The `/v1/events` SSE endpoint is **not** behind the discovery flag: it is always reachable on the loopback URL so a dashboard running on the same machine can subscribe.
- Set `aiflowbridge.telemetry.captureSessionLog = false` to keep the on-disk telemetry file lean. The endpoints still respond but the `promptSummary` / `responseSummary` fields are empty for entries recorded after the flag was flipped (the dashboard Shared Session panel renders those rows as a muted `(no summary)` placeholder).

The corresponding dashboard panel ("Shared session") sits between "By model" and "By client".
Each row shows the local time, provider, model, and sanitized prompt snippet; a per-row "Replay" button posts to the extension host, which re-hydrates the entry from the in-memory store and renders the body inline in a `<pre>` block.

## Singleton behavior

The gateway runs as a single instance shared across all VS Code windows.
If an AIFlowBridge gateway is already running when you open a new VS Code window, that window will automatically detect and use the existing gateway on port 8787 instead of starting a second instance.
This ensures the gateway is always available at the same URL.

## Version-aware restart

The gateway exposes `GET /version`, which returns:

```json
{ "name": "aiflowbridge-gateway", "version": "1.4.0", "pid": 1234, "startedAt": "2026-06-04T10:00:00.000Z" }
```

When the extension activates, it probes this endpoint on the configured port. Three outcomes:

- **Same or newer version running** → join silently (no UI). This is the normal case when you open a second VS Code window.
- **Older version running** (typical during extension development / after a marketplace update) → a non-modal information message appears: `AIFlowBridge gateway v1.2.0 is running. Restart with v1.4.0?` with two buttons:
  - **Restart with v1.4.0** → the new activation sends a cooperative `POST /shutdown` to the old gateway, waits up to 3s for the port to free, then binds. The old instance closes its listening socket (no `process.exit(0)`, so the extension host stays alive); no `taskkill`, no orphan node process.
  - **Keep current version** → the new window joins the old gateway, just like a second window would. Use this if you need to keep the old instance alive (e.g. mid-debug with state on it).
  - Dismiss (close the toast) → same as **Keep**. This is the default behaviour for users who do not interact with the toast: no surprise behaviour change.
- **Port occupied by something else** (e.g. `python -m http.server 8787`, or a process from another tool) → the extension logs a warning and lets the bind fail with `EADDRINUSE`. **No** shutdown request is sent, because the peer identifies itself as something other than `aiflowbridge-gateway` and we never touch foreign processes.

A stale-lock guard (`<globalStorageUri>/gateway.lock`, acquired with `fs.openSync(path, 'wx')`) prevents the ping-pong loop when two debug sessions try to restart the gateway at the same time.
It is best-effort: if the lock cannot be acquired, the new activation logs a warning and lets the holding activation make the restart decision.

## Using with Kilo Code or other OpenAI-compatible clients

Any tool that supports the OpenAI API can use AIFlowBridge as a backend via the gateway.
This lets you access DeepSeek, MiniMax, and Xiaomi MiMo models from clients other than Copilot Chat.

**Kilo Code configuration example:**

| Setting      | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| API Provider | OpenAI Compatible                                                       |
| Base URL     | `http://127.0.0.1:8787/v1`                                              |
| API Key      | Any string (keys are managed by AIFlowBridge)                           |
| Model        | `deepseek-v4-flash`, `MiniMax-M2.7`, `mimo-v2.5-pro`, `MiniMax-M3`, ... |

The gateway routes requests to the correct upstream provider based on the model name. Streaming (`stream: true`) is fully supported.

## Configuring gateway providers

The gateway catalog is built from the [model registry](architecture.md#model-registry) and a few optional `settings.json` overrides.
No need to maintain a long list of provider entries by hand - the registry already lists all 14 supported models, and the gateway synthesizes one catalog entry per registry model on activation.

**Auto-synthesized entries** - for every model in the registry, the gateway creates a provider entry using the vendor defaults (from `registry.vendors[<family>].baseUrl`) and the model's per-token pricing.
The synthesized `id` matches the registry model `id` exactly, so `GET /v1/models` returns the same set you see in the Copilot Chat picker.

**Overriding the catalog** - the priority order is:

1. **Your overrides** in `aiflowbridge.providers` (highest priority - you take full control and replace the synthesized entry). Use this to point a specific model at a different region/cluster, or to disable it.
2. **Auto-synthesized** entries from the [model registry](architecture.md#model-registry) - one per `registry.models` entry, with the vendor default `baseUrl` and the per-model `pricing` block.

To override the rate or endpoint for a single model (e.g.
Xiaomi on the Singapore cluster, billed in EUR), add an entry to `aiflowbridge.providers` with the matching `model` field.
The first entry that matches the model wins.

**Disabling a model from the dashboard catalog** while keeping the others:

```json
{
  "aiflowbridge.providers": [
    {
      "id": "MiniMax-M3",
      "label": "MiniMax M3 (disabled locally)",
      "kind": "openai-compat",
      "baseUrl": "https://api.minimax.io/v1",
      "model": "MiniMax-M3",
      "enabled": false
    }
  ]
}
```

The dashboard and the `GET /v1/models` catalog will skip any provider with `"enabled": false`.
Removing an entry from the array does **not** disable the corresponding model - use `"enabled": false` instead, or override it in the [model registry](architecture.md#model-registry).

**For pricing-only changes** that should apply to all your workspaces (e.g. you have a custom MiniMax rate that you pay via a reseller), prefer editing the registry instead of `aiflowbridge.providers`.
See [architecture.md](architecture.md#model-registry) for the full schema and override rules.

## Settings

| Setting                                              | Default                       | Description                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aiflowbridge.gateway.enabled`                       | `true`                        | Start gateway on activation                                                                                                                                                          |
| `aiflowbridge.gateway.port`                          | `8787`                        | Local proxy port                                                                                                                                                                     |
| `aiflowbridge.gateway.baseUrl`                       | `http://127.0.0.1:8787/v1`    | Gateway URL                                                                                                                                                                          |
| `aiflowbridge.gateway.defaultModel`                  | `""`                          | Default model when client doesn't specify one                                                                                                                                        |
| `aiflowbridge.gateway.probeTimeoutMs`                | `500`                         | Per-call timeout (ms) for `GET /version` when probing a peer gateway on activation                                                                                                   |
| `aiflowbridge.gateway.maxConcurrentRequests`         | `20`                          | Hard cap on in-flight `/v1/chat/completions` (above the cap the gateway returns `429` + `Retry-After`)                                                                               |
| `aiflowbridge.gateway.maxConcurrentPerProvider`      | `3`                           | Per-upstream-provider cap on parallel in-flight requests (`0` disables the cap)                                                                                                      |
| `aiflowbridge.gateway.upstreamIdleTimeoutMs`         | `90000`                       | Watchdog that aborts the upstream `fetch` after this many ms without bytes (`0` disables)                                                                                            |
| `aiflowbridge.gateway.streamTotalTimeoutMs`          | `300000`                      | Hard ceiling on the upstream call duration in ms (`0` disables)                                                                                                                      |
| `aiflowbridge.gateway.minimaxParallelTokenCount`     | `false`                       | When `true`, fires the parallel `/input_tokens` pre-count on streaming MiniMax requests too (off by default)                                                                         |
| `aiflowbridge.gateway.workspaceContext.enabled`      | `true`                        | Inject the detected workspace context as a system message on every chat completion                                                                                                   |
| `aiflowbridge.gateway.workspaceContext.root`         | `""`                          | Explicit workspace root directory (falls back to `AIFLOWBRIDGE_WORKSPACE`, then `process.cwd()`)                                                                                     |
| `aiflowbridge.gateway.workspaceContext.maxDepth`     | `2`                           | Max directory depth the detector walks                                                                                                                                               |
| `aiflowbridge.gateway.workspaceContext.ignoredDirs`  | `[node_modules, target, ...]` | Directory names to skip entirely (no recursion, no listing)                                                                                                                          |
| `aiflowbridge.gateway.languageRouting`               | `{}`                          | Map of `language -> providerId`. The `*` wildcard is the fallback for any language not explicitly mapped                                                                             |
| `aiflowbridge.gateway.discovery.enabled`             | `false`                       | Master switch for the UDP beacon + the `GET /v1/discovery` HTTP endpoint                                                                                                             |
| `aiflowbridge.gateway.discovery.broadcastPort`       | `8788`                        | UDP destination port (clamped to `[1024, 65535]` at runtime)                                                                                                                         |
| `aiflowbridge.gateway.discovery.broadcastIntervalMs` | `2000`                        | Beacon emission interval in ms (clamped to `[500, 300_000]` at runtime)                                                                                                              |
| `aiflowbridge.telemetry.captureSessionLog`           | `true`                        | Capture sanitized + truncated prompt / response summaries on every recorded request (powers `/v1/sessions`, `/v1/replay/{id}`, `/v1/events`, and the dashboard Shared session panel) |

`AIFLOWBRIDGE_WORKSPACE` (environment variable) overrides `aiflowbridge.gateway.workspaceContext.root` for service-manager launches of the standalone CLI (`systemd`, `launchd`, Task Scheduler, ...).
When the explicit `root` setting does not resolve to a directory, the gateway logs a warning and falls back to the env var / `cwd`.

## Privacy

The gateway binds to `127.0.0.1` only - it is not reachable from other machines on your network. Outbound requests go only to the upstream API endpoints you configure.
The `/v1/context` endpoint exposes the workspace root as an absolute path; the `/v1/discovery` endpoint exposes the bundled gateway version plus one-paste client config snippets; the `/v1/replay/{id}` endpoint returns the stored prompt + response summaries (already redacted for credentials).
All three are loopback-only (the bind on `127.0.0.1` is the gate), so the same info is already reachable through `/health`, `/version`, `/v1/models`.
When `aiflowbridge.gateway.discovery.enabled` is `true`, the UDP broadcast announces the gateway's existence to every host on the LAN.
The payload is intentionally tiny (host, port, version) and contains no API key, no workspace path, no model name.
The `promptSummary` / `responseSummary` captured for the Shared Session feature are redacted for Bearer tokens, `sk-...` keys, `x-api-key` headers, and any 60+-char token-like blob before being persisted, so a developer pasting a `curl` one-liner with their upstream key does not leak it via `/v1/replay/{id}` or the dashboard.
See [development.md](development.md#privacy--security) for the full privacy posture.
