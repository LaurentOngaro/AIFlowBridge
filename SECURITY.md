# Security Policy

## Supported Versions

AIFlowBridge 2.x is currently supported with security updates. 1.7.x receives security fixes on a best-effort basis.

| Version | Supported                        |
| ------- | -------------------------------- |
| 2.x     | :white_check_mark:               |
| 1.7.x   | :white_check_mark: (best effort) |
| < 1.7   | :x:                              |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Send a private report by DM on GitHub with:

- A clear description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive an initial response within **7 days**. We will work with you on a coordinated disclosure timeline.

## Security Design

AIFlowBridge is designed with a local-first security model:

- **API keys** are stored exclusively in VS Code `SecretStorage` (the OS keychain). They never touch `settings.json` or any other file committed to the repo. On the standalone CLI, keys live in `AIFLOWBRIDGE_<VENDOR>_API_KEY` env vars or `~/.aiflowbridge/secrets.json` (`chmod 600` on POSIX).
- **The local gateway** binds to `127.0.0.1` only - it is not reachable from other machines on your network.
- **Telemetry is local** - request counts, tokens, and cost estimates stay on your machine. There is no remote analytics endpoint.
- **No third-party tracking** - the extension does not phone home, load remote scripts, or embed analytics SDKs.
- **Outbound requests** only go to the API endpoints you configure (`api.deepseek.com`, `api.minimax.io`, `api.xiaomimimo.com`, `openrouter.ai`, or your custom upstream).

## Session-log privacy (action plan item #3, hardened 2.10.x)

When `aiflowbridge.telemetry.captureSessionLog` is `true` (the default), every recorded request carries a sanitized + truncated `promptSummary` (max 500 chars) and `responseSummary` (max 1000 chars).
Both are persisted to the on-disk telemetry file (`<globalStorageUri>/telemetry.json`) so the Shared Session panel + `GET /v1/sessions` + `GET /v1/replay/{id}` can replay them.

**Stored shape (post-sanitization):**

- `promptSummary` - sanitized `messages[]` user-side text, max 500 chars.
- `responseSummary` - sanitized upstream response (or assembled SSE `delta.content` for streaming), max 1000 chars.
- Both fields are run through `sanitizeSummaryText()` which strips `Bearer ...`, `sk-...`, `x-api-key=...` and any 60+-char token-like blob without whitespace. The cap is applied AFTER sanitization so a redacted credential that survives truncation is no longer reachable.

**On-disk location:** `<globalStorageUri>/telemetry.json` (path is per-OS-user, per-machine).
The file is JSON, written atomically (`.tmp` + `rename`) under a cross-process lock (`telemetry.lock`, stale-mtime reaper at 30 s).

**Hard caps:**

- `aiflowbridge.telemetry.maxStoredRequestBytes` (default 8192 / 8 KiB) - hard cap on the serialized size of every entry appended to the on-disk file. Oversized `promptSummary` / `responseSummary` are truncated in place; when the entry's static overhead already exceeds the cap, both summaries are dropped. Set to `0` to disable.
- `aiflowbridge.telemetry.retentionDays` (default 90) - on every read AND write, entries older than `now - retentionDays * 86_400_000 ms` are pruned from the on-disk snapshot. The cumulative counters are re-derived from the survivors so the dashboard stays consistent. Set to `0` to keep every entry forever.

**Privacy affordances:**

- `AIFlowBridge: Reset metrics` - wipes every recorded entry (counters + summaries) both in memory and on disk. Modal confirmation required.
- `AIFlowBridge: Purge session log` - wipes ONLY the captured `promptSummary` / `responseSummary` fields; usage totals (requests, tokens, cost, per-provider / per-model breakdowns) are kept. Modal confirmation required. This is the privacy-driven affordance: keep the analytics, drop the replay text.
- Disable entirely: set `aiflowbridge.telemetry.captureSessionLog = false`. The replay / session / SSE endpoints stay available; new entries are stored without summaries.

**Limits of the redaction.** `sanitizeSummaryText` is best-effort.
The threat model is "accidental disclosure" (a developer pasting a `curl` one-liner that includes their upstream key) - the gateway runs loopback-only.
A determined adversary could craft a payload that leaks through, but that is out of scope: it requires the same loopback access that would let them read `~/.aiflowbridge/secrets.json` directly.

## Hardening Highlights

- **Cooperative shutdown requires a per-instance auth token (1.7.0).** `POST /shutdown` requires the `X-AIFlowBridge-Shutdown-Token` header to match the `randomUUID()` returned by `GET /version`. Requests without the header or with a wrong token get a 403. Pre-1.7.0 peers do not gate shutdown (backward compat).
- **Provider `baseUrl` SSRF validation (1.7.0).** `isValidProviderBaseUrl()` rejects non-http(s) schemes (`file:`, `gopher:`, `javascript:`, ...), unparseable URLs, and cloud metadata endpoints (AWS/GCP/Azure `169.254.x.x`, Alibaba `100.100.100.200`, AWS IMDS-over-IPv6 `fd00:ec2::254`). IPv4-mapped IPv6 is handled in both decimal and hex forms. Loopback is intentionally allowed (Ollama use case). Entries failing validation are silently dropped in `normalizeProviderProfiles`.
- **Telemetry is file-based (1.5.0).** Persisted at `<globalStorageUri>/telemetry.json` with a sibling `telemetry.lock` (cross-window file lock, atomic `write-tmp` + `rename`). No data leaves the local machine. A one-shot migration moves legacy `globalState` snapshots to the new file on first activation after the upgrade.
- **Standalone gateway is hardened (2.0.0).** `package.json` is read with `readFileSync` + `JSON.parse` (not `require()`, which is an RCE vector if the file is ever maliciously replaced). `secrets.json` is written with `chmodSync(0o600)` on POSIX (Windows: NTFS ACL applies, see `docs/standalone.md#secretsjson-file-permissions`).
- **API key redaction in diagnostic logs (2.1.0)** - `redactProviderForLog()` / `redactProvidersForLog()` strip the `apiKey` field from every diagnostic log line. Adds `apiKeyPresent: boolean` so any future verbose dump can never leak credentials.
- **Upstream error sanitization (2.0.0)** - `sanitizeUpstreamErrorMessage()` strips the query string and redacts `api_key` / `Authorization` / `Bearer` references from any 502 body that surfaces an upstream `fetch` error.
- **Probe hardening (2.0.0)** - `probeServerVersion` has a 4 KiB body size limit + JSON parse guard, and `isPortInUse` no longer leaks its 500 ms timer.
- **Loopback unauthenticated endpoints by design (2.7.0+).** `GET /health` (status snapshot) and `GET /metrics` (cumulative request telemetry, including per-provider token counts and per-model breakdowns) intentionally do **not** require any token, because the gateway binds to `127.0.0.1` only and these endpoints are meant to be polled by local dashboards / status bars / health checks. The same is true of `GET /v1/models` and `GET /v1/discovery` (a discovery metadata document for LAN clients). If you forward any of these endpoints off-host (e.g. by binding the gateway to `0.0.0.0` via a reverse proxy, or by exposing the loopback through `ngrok` / a tunnel), you are responsible for adding authentication at the proxy layer. The `GET /version` endpoint returns the `shutdownToken` used by `POST /shutdown` - this is acceptable on loopback because the token is per-instance and rotated at every restart, but the same caveat applies if you expose it off-host.

If you find a security issue, please report it privately. Thank you for helping keep AIFlowBridge safe.
