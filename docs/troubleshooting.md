# Troubleshooting

> Part of the [AIFlowBridge documentation](../README.md).

## `Gateway failed to start on port 8787`

Another service (not AIFlowBridge) is using port 8787. Either stop that service, or change AIFlowBridge's port via `aiflowbridge.gateway.port` in your settings.

## `API key not configured`

Run the matching command from the Command Palette:

- `DeepSeek: Set API Key`
- `MiniMax: Set API Key`
- `Xiaomi MiMo: Set API Key`
- `Google AI Studio: Set API Key (BYOK pay-as-you-go)`
- `Z.ai GLM: Set API Key`
- `MoonshotAI Kimi: Set API Key`

OpenRouter has no such command by design: set `AIFLOWBRIDGE_OPENROUTER_API_KEY` (or the bare `OPENROUTER_API_KEY`, or `openrouter.apiKey` in `secrets.json`).
See [providers.md](providers.md#openrouter-100-models-via-a-single-openai-compatible-endpoint).

The keys live in your OS keychain, not in any file. Use the corresponding `Clear API Key` command to remove them.

## `Vision model not found`

The configured vision model is not registered with VS Code.
Nothing breaks: AIFlowBridge logs `[Vision] Configured model "..." not found in vscode.lm, falling back to default` and continues with the default (`oswe-vscode-prime`), so the pasted image is still described.

To silence the warning, either clear `aiflowbridge.vision.copilotVisionModel` or pick a model that is actually installed, with `AIFlowBridge: Set vision proxy model`.
If no vision-capable model is available at all, the request still completes with an "image description unavailable" placeholder in the prompt instead of a description.

## `401 Unauthorized` from an upstream provider

The API key is missing, invalid, or for the wrong endpoint. Check:

1. The key is set (see the `Set API Key` commands listed above; OpenRouter uses the env var or `secrets.json`)
2. The `baseUrl` setting points to the right region (DeepSeek/MiniMax/Xiaomi each have regional endpoints)
3. The key has the required permissions on the provider's dashboard

## `429 Resource has been exhausted` from an upstream provider

`RESOURCE_EXHAUSTED` covers three situations that need opposite reactions, and Google does not always tell them apart.
AIFlowBridge classifies the refusal and writes the verdict to `AIFlowBridge: Show logs`, also publishing it as the `X-AIFlowBridge-Quota-State` response header.

| State               | Meaning                                                        | What to do                                                                                                                 |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `rate-limited`      | Per-minute or per-second cap                                   | Wait. A `Retry-After` is forwarded when the upstream supplies one.                                                         |
| `quota-exhausted`   | A real allowance has been spent                                | Wait for the reset time in `X-AIFlowBridge-Quota-Reset`, or raise the quota in the provider console.                       |
| `zero-allocation`   | The upstream reported a named metric with an allowance of zero | Retrying will never help. Review the quota granted to this account in the provider console, or use a different credential. |
| `billing-exhausted` | The project's billing credit is gone                           | Top up or enable billing. Waiting does not help.                                                                           |

`zero-allocation` and `billing-exhausted` are logged at ERROR level because they are the two states no amount of retrying can clear.

**A bare `RESOURCE_EXHAUSTED` is NOT classified.** Since this release, a 429 whose body carries no `google.rpc.QuotaFailure` violation block leaves the gateway undecided and publishes **no** `X-AIFlowBridge-Quota-State` header at all.
The absence of a quota metric is not evidence of a missing entitlement: the same body is compatible with a rate limit, a spent allowance and a missing allocation, and each needs a different reaction.
Earlier versions labelled that shape `zero-allocation`, which sent users to a console change for what could have been a momentary rate limit.
If you need a verdict, ask the upstream for a body that names the metric (the Gemini Developer API does), or inspect the raw status and body yourself.

A local refusal is not a quota signal either: the retired Google product OAuth transport answers HTTP 503 with `google_product_oauth_unsupported` **without contacting Google**, so no quota header is published for it.

The upstream body is forwarded untouched, so clients that parse the provider's own error shape keep working.

## `404 No gateway provider matches model "..."` from the gateway

Since 1.2.0, the gateway no longer silently routes a request for an unknown model to the first enabled provider (which used to label DeepSeek as "mimo-v2.5" in the dashboard).
If you see a 404, the model name is not registered in `aiflowbridge.providers` or `aiflowbridge.userModels`.
Either:

- Add it via `AIFlowBridge: Add a custom model`
- Configure a provider in `aiflowbridge.providers` with a matching `id` or `model`
- Pass the upstream API id directly (e.g. `MiniMax-M3` instead of `minimax-m3`)

The 404 body lists the available provider ids for reference.

## `Metrics are empty after restart`

Since 1.5.0, metrics are persisted in `<globalStorageUri>/telemetry.json` and shared across VS Code windows. If the dashboard shows 0, one of:

- You're testing through **Copilot Chat**, which goes through the language model provider APIs directly, not the gateway. Only requests that hit the gateway (Kilo Code, Continue, Open WebUI, curl, etc.) are recorded.
- The legacy `globalState` slot had no data and the new file is empty (1.6.x users: the migration runs once on the first activation after the upgrade and logs `[AIFlowBridge] Migrating legacy 1.6.x globalState telemetry to the new file-based store...`).
- Run `AIFlowBridge: Reset metrics` and verify the cumulative counters increment as you make gateway calls.

## `Gateway not detected by Kilo Code`

- Confirm the gateway is running: `curl http://127.0.0.1:8787/health` should return `{"ok":true,"service":"AIFlowBridge","status":{...}}`
- Use `http://127.0.0.1:8787/v1` as the OpenAI-compatible base URL
- Any string works as the API key (auth is handled by the upstream provider)

## Dashboard pagination (FIXED in 1.6.0)

The in-memory `recent` list is no longer capped.
Every recorded request is kept in `recent` (both in the in-memory `TelemetryStore` and the on-disk `<globalStorageUri>/telemetry.json`), and the Recent panel paginates the full history (set `pageSize` up to 500 via the "Per page" input).

If your on-disk telemetry file was written under an older release (before 1.6.0), it only contains the last 20 or 100 entries in the `recent` tail.
The cumulative totals (Requests / Tokens / Estimated cost) always reflect the full history regardless of the recent tail length.
New requests recorded after upgrading are appended with no eviction, so the recent tail grows over time.

## `Shared session` panel shows "(no summary)" for every row

Either `aiflowbridge.telemetry.captureSessionLog` is set to `false` (opt-out), or the on-disk telemetry file was written by an extension older than 2.10.0 and the existing entries pre-date the `promptSummary` / `responseSummary` fields.
Both cases are expected: the panel degrades gracefully, and new requests recorded after enabling the flag (or after upgrading to 2.10.0) get the summary.
To start fresh with all summaries populated, run `AIFlowBridge: Reset metrics` after enabling the flag.

## `curl http://127.0.0.1:8787/v1/replay/<id>` returns 404

The recorded entry is no longer in the in-memory `recent` list.
The list is bounded by `memoryCap` (default 10 000); the on-disk persister still receives every entry, but the replay endpoint reads from memory only.
Either raise `memoryCap` via the gateway's telemetry store options, or use a `requestId` recorded in the most recent 10 000 requests.
The `/v1/sessions?limit=N` endpoint returns the available request ids in reverse chronological order so you can pick one that is still in memory.

**For more details**, run `AIFlowBridge: Show logs` from the Command Palette.
