# Security Policy

## Supported Versions

AIFlowBridge 1.x is currently supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

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

- **API keys** are stored exclusively in VS Code `SecretStorage` (the OS keychain). They never touch `settings.json` or any other file committed to the repo.
- **The local gateway** binds to `127.0.0.1` only - it is not reachable from other machines on your network.
- **Telemetry is local** - request counts, tokens, and cost estimates stay on your machine. There is no remote analytics endpoint.
- **No third-party tracking** - the extension does not phone home, load remote scripts, or embed analytics SDKs.
- **Outbound requests** only go to the API endpoints you configure (`api.deepseek.com`, `api.minimax.io`, `api.xiaomimimo.com`, or your custom upstream).

If you find a security issue, please report it privately. Thank you for helping keep AIFlowBridge safe.
