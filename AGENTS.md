# AGENTS.md

## Project

AIFlowBridge is a VS Code extension providing multi-provider AI coding assistance through Copilot Chat and an OpenAI-compatible local gateway (DeepSeek, MiniMax, Xiaomi MiMo). The gateway also runs as a standalone Node.js CLI (`aiflowbridge-server`) without VS Code.

## Quick reference

- **Compile (VS Code ext):** `npm run compile`
- **Compile (standalone CLI):** `npm run build:standalone`
- **Test:** `npm test` (vitest, 616 tests / 34 files)
- **Package:** `npm run package` (VSIX in `dist/`)
- **Dev loop:** `npm run watch` + F5 in VS Code
- **Local install helper:** `pwsh -File _helpers/Publish-AIFlowBridge.ps1`
- **Private working notes setup:** `pwsh -File _helpers/Setup-PrivateRepo.ps1`

## Style rules (apply to every task)

- **Chat interactions:** French (thinking, questions, answers).
- **Code, comments, docs:** English only.
- **Markdown prose:** one paragraph = one physical line. No line break inside a sentence.
- **No em-dash (U+2014) or en-dash (U+2013).** Use ASCII `-`.
- **No smart quotes / ellipsis.** ASCII `'` `"` `...`. French diacritics are fine.
- **No Chinese localization files** (`package.nls.zh-cn.json`, `README.zh-cn.md`, ...).
- **TypeScript:** strict, ES modules, async/await, `const` over `let`, `interface` for object shapes.

## Detailed instructions

| Topic                                                  | File                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Style rules expanded, anti-patterns                    | [docs/agent-instructions/style.md](docs/agent-instructions/style.md)                 |
| File structure, design decisions                       | [docs/agent-instructions/architecture.md](docs/agent-instructions/architecture.md)   |
| Model registry 3-tier merge                            | [docs/agent-instructions/registry.md](docs/agent-instructions/registry.md)           |
| Provider pattern + user-defined models                 | [docs/agent-instructions/providers.md](docs/agent-instructions/providers.md)         |
| Gateway singleton + version-aware restart + standalone | [docs/agent-instructions/gateway.md](docs/agent-instructions/gateway.md)             |
| Vision proxy                                           | [docs/agent-instructions/vision.md](docs/agent-instructions/vision.md)               |
| Telemetry, dashboard, metrics                          | [docs/agent-instructions/telemetry.md](docs/agent-instructions/telemetry.md)         |
| Testing conventions                                    | [docs/agent-instructions/testing.md](docs/agent-instructions/testing.md)             |
| Common tasks (add provider/model, build, package)      | [docs/agent-instructions/tasks.md](docs/agent-instructions/tasks.md)                 |
| `_helpers/` vs `_Private/` working-notes pattern       | [docs/agent-instructions/working-notes.md](docs/agent-instructions/working-notes.md) |

## User-facing documentation

The end-user documentation lives under `docs/` (architecture, gateway, vision, reasoning, providers, dashboard, standalone, troubleshooting, cost, development, kilocode, jetbrains). It has a different audience and update cadence than the agent instructions above.
