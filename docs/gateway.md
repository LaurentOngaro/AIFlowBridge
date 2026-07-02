# Local gateway

> Part of the [AIFlowBridge documentation](../README.md).

The local gateway provides an OpenAI-compatible proxy that can be used by external tools. It starts automatically on port 8787 when the extension activates (if `aiflowbridge.gateway.enabled` is `true`).

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
```

## Singleton behavior

The gateway runs as a single instance shared across all VS Code windows. If an AIFlowBridge gateway is already running when you open a new VS Code window, that window will automatically detect and use the existing gateway on port 8787 instead of starting a second instance. This ensures the gateway is always available at the same URL.

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

A stale-lock guard (`<globalStorageUri>/gateway.lock`, acquired with `fs.openSync(path, 'wx')`) prevents the ping-pong loop when two debug sessions try to restart the gateway at the same time. It is best-effort: if the lock cannot be acquired, the new activation logs a warning and lets the holding activation make the restart decision.

## Using with Kilo Code or other OpenAI-compatible clients

Any tool that supports the OpenAI API can use AIFlowBridge as a backend via the gateway. This lets you access DeepSeek, MiniMax, and Xiaomi MiMo models from clients other than Copilot Chat.

**Kilo Code configuration example:**

| Setting      | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| API Provider | OpenAI Compatible                                                       |
| Base URL     | `http://127.0.0.1:8787/v1`                                              |
| API Key      | Any string (keys are managed by AIFlowBridge)                           |
| Model        | `deepseek-v4-flash`, `MiniMax-M2.7`, `mimo-v2.5-pro`, `MiniMax-M3`, ... |

The gateway routes requests to the correct upstream provider based on the model name. Streaming (`stream: true`) is fully supported.

## Configuring gateway providers

The gateway catalog is built from the [model registry](architecture.md#model-registry) and a few optional `settings.json` overrides. No need to maintain a long list of provider entries by hand - the registry already lists all 14 supported models, and the gateway synthesizes one catalog entry per registry model on activation.

**Auto-synthesized entries** - for every model in the registry, the gateway creates a provider entry using the vendor defaults (from `registry.vendors[<family>].baseUrl`) and the model's per-token pricing. The synthesized `id` matches the registry model `id` exactly, so `GET /v1/models` returns the same set you see in the Copilot Chat picker.

**Overriding the catalog** - the priority order is:

1. **Your overrides** in `aiflowbridge.providers` (highest priority - you take full control and replace the synthesized entry). Use this to point a specific model at a different region/cluster, or to disable it.
2. **Auto-synthesized** entries from the [model registry](architecture.md#model-registry) - one per `registry.models` entry, with the vendor default `baseUrl` and the per-model `pricing` block.

To override the rate or endpoint for a single model (e.g. Xiaomi on the Singapore cluster, billed in EUR), add an entry to `aiflowbridge.providers` with the matching `model` field. The first entry that matches the model wins.

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

The dashboard and the `GET /v1/models` catalog will skip any provider with `"enabled": false`. Removing an entry from the array does **not** disable the corresponding model - use `"enabled": false` instead, or override it in the [model registry](architecture.md#model-registry).

**For pricing-only changes** that should apply to all your workspaces (e.g. you have a custom MiniMax rate that you pay via a reseller), prefer editing the registry instead of `aiflowbridge.providers`. See [architecture.md](architecture.md#model-registry) for the full schema and override rules.

## Settings

| Setting                             | Default                    | Description                                   |
| ----------------------------------- | -------------------------- | --------------------------------------------- |
| `aiflowbridge.gateway.enabled`      | `true`                     | Start gateway on activation                   |
| `aiflowbridge.gateway.port`         | `8787`                     | Local proxy port                              |
| `aiflowbridge.gateway.baseUrl`      | `http://127.0.0.1:8787/v1` | Gateway URL                                   |
| `aiflowbridge.gateway.defaultModel` | `""`                       | Default model when client doesn't specify one |

## Privacy

The gateway binds to `127.0.0.1` only - it is not reachable from other machines on your network. Outbound requests go only to the upstream API endpoints you configure. See [development.md](development.md#privacy--security) for the full privacy posture.
