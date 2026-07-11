# Troubleshooting

> Part of the [AIFlowBridge documentation](../README.md).

## `Gateway failed to start on port 8787`

Another service (not AIFlowBridge) is using port 8787. Either stop that service, or change AIFlowBridge's port via `aiflowbridge.gateway.port` in your settings.

## `API key not configured`

Run the matching command from the Command Palette:

- `DeepSeek: Set API Key`
- `MiniMax: Set API Key`
- `Xiaomi MiMo: Set API Key`

The keys live in your OS keychain, not in any file. Use the corresponding `Clear API Key` command to remove them.

## `Vision model not found`

The configured vision model is not registered with VS Code. Open settings (`AIFlowBridge: Open settings`) and either:

- Clear `aiflowbridge.vision.copilotVisionModel` to use the default
- Pick a model that is currently installed in your environment

## `401 Unauthorized` from an upstream provider

The API key is missing, invalid, or for the wrong endpoint. Check:

1. The key is set (`AIFlowBridge: Set API Key`)
2. The `baseUrl` setting points to the right region (DeepSeek/MiniMax/Xiaomi each have regional endpoints)
3. The key has the required permissions on the provider's dashboard

## `404 No gateway provider matches model "..."` from the gateway

Since 1.2.0, the gateway no longer silently routes a request for an unknown model to the first enabled provider (which used to label DeepSeek as "mimo-v2.5" in the dashboard, BUG05). If you see a 404, the model name is not registered in `aiflowbridge.providers` or `aiflowbridge.userModels`. Either:

- Add it via `AIFlowBridge: Add a custom model`
- Configure a provider in `aiflowbridge.providers` with a matching `id` or `model`
- Pass the upstream API id directly (e.g. `MiniMax-M3` instead of `minimax-m3`)

The 404 body lists the available provider ids for reference.

## `Metrics are empty after restart`

Since 1.5.0, metrics are persisted in `<globalStorageUri>/telemetry.json` and shared across VS Code windows. If the dashboard shows 0, one of:

- You're testing through **Copilot Chat**, which goes through the language model provider APIs directly, not the gateway. Only requests that hit the gateway (Kilo Code, Continue, Open WebUI, curl, etc.) are recorded.
- The legacy `globalState` slot had no data and the new file is empty (1.4.x users: the migration runs once on the first activation after the upgrade and logs `[AIFlowBridge] Migrating telemetry from globalState to ...`).
- Run `AIFlowBridge: Reset metrics` and verify the cumulative counters increment as you make gateway calls.

## `Gateway not detected by Kilo Code`

- Confirm the gateway is running: `curl http://127.0.0.1:8787/health` should return `{"ok":true,"service":"AIFlowBridge","status":{...}}`
- Use `http://127.0.0.1:8787/v1` as the OpenAI-compatible base URL
- Any string works as the API key (auth is handled by the upstream provider)

## Dashboard pagination (FIXED in 1.6.0)

The in-memory `recent` list is no longer capped. Every recorded request is kept in `recent` (both in the in-memory `TelemetryStore` and the on-disk `<globalStorageUri>/telemetry.json`), and the Recent panel paginates the full history (set `pageSize` up to 500 via the "Per page" input).

If your on-disk telemetry file was written under an older release (before 1.6.0), it only contains the last 20 or 100 entries in the `recent` tail. The cumulative totals (Requests / Tokens / Estimated cost) always reflect the full history regardless of the recent tail length. New requests recorded after upgrading are appended with no eviction, so the recent tail grows over time.

## `Shared session` panel shows "(no summary)" for every row

Either `aiflowbridge.telemetry.captureSessionLog` is set to `false` (opt-out), or the on-disk telemetry file was written by an extension older than 2.10.0 and the existing entries pre-date the `promptSummary` / `responseSummary` fields. Both cases are expected: the panel degrades gracefully, and new requests recorded after enabling the flag (or after upgrading to 2.10.0) get the summary. To start fresh with all summaries populated, run `AIFlowBridge: Reset metrics` after enabling the flag.

## `curl http://127.0.0.1:8787/v1/replay/<id>` returns 404

The recorded entry is no longer in the in-memory `recent` list. The list is bounded by `memoryCap` (default 10 000); the on-disk persister still receives every entry, but the replay endpoint reads from memory only. Either raise `memoryCap` via the gateway's telemetry store options, or use a `requestId` recorded in the most recent 10 000 requests. The `/v1/sessions?limit=N` endpoint returns the available request ids in reverse chronological order so you can pick one that is still in memory.

**For more details**, run `AIFlowBridge: Show Logs` from the Command Palette.
