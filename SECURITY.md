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
- **Outbound requests** only go to the API endpoints you configure (`api.deepseek.com`, `api.minimax.io`, `api.xiaomimimo.com`, or your custom upstream).

## Hardening Highlights

- **Cooperative shutdown requires a per-instance auth token (1.7.0).** `POST /shutdown` requires the `X-AIFlowBridge-Shutdown-Token` header to match the `randomUUID()` returned by `GET /version`. Requests without the header or with a wrong token get a 403. Pre-1.7.0 peers do not gate shutdown (backward compat).
- **Provider `baseUrl` SSRF validation (1.7.0).** `isValidProviderBaseUrl()` rejects non-http(s) schemes (`file:`, `gopher:`, `javascript:`, ...), unparseable URLs, and cloud metadata endpoints (AWS/GCP/Azure `169.254.x.x`, Alibaba `100.100.100.200`, AWS IMDS-over-IPv6 `fd00:ec2::254`). IPv4-mapped IPv6 is handled in both decimal and hex forms. Loopback is intentionally allowed (Ollama use case). Entries failing validation are silently dropped in `normalizeProviderProfiles`.
- **Telemetry is file-based (1.5.0).** Persisted at `<globalStorageUri>/telemetry.json` with a sibling `telemetry.lock` (cross-window file lock, atomic `write-tmp` + `rename`). No data leaves the local machine. A one-shot migration moves legacy `globalState` snapshots to the new file on first activation after the upgrade.
- **Standalone gateway is hardened (2.0.0).** `package.json` is read with `readFileSync` + `JSON.parse` (not `require()`, which is an RCE vector if the file is ever maliciously replaced). `secrets.json` is written with `chmodSync(0o600)` on POSIX (Windows: NTFS ACL applies, see `docs/standalone.md#secretsjson-file-permissions`).
- **API key redaction in diagnostic logs (2.1.0)** - `redactProviderForLog()` / `redactProvidersForLog()` strip the `apiKey` field from every diagnostic log line. Adds `apiKeyPresent: boolean` so any future verbose dump can never leak credentials.
- **Upstream error sanitization (2.0.0)** - `sanitizeUpstreamErrorMessage()` strips the query string and redacts `api_key` / `Authorization` / `Bearer` references from any 502 body that surfaces an upstream `fetch` error.
- **Probe hardening (2.0.0)** - `probeServerVersion` has a 4 KiB body size limit + JSON parse guard, and `isPortInUse` no longer leaks its 500 ms timer.

If you find a security issue, please report it privately. Thank you for helping keep AIFlowBridge safe.
