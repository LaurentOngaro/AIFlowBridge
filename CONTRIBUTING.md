# Contributing to AIFlowBridge

Thanks for your interest in contributing! AIFlowBridge is an open-source VS Code extension that brings DeepSeek, MiniMax, and Xiaomi MiMo into GitHub Copilot Chat.
Every contribution is welcome.

## Quick Start

1. **Fork** the repository on GitHub
2. **Clone** your fork: `git clone https://github.com/<you>/aiflowbridge`
3. **Install** dependencies: `npm ci`
4. **Open** in VS Code: `code .`
5. **Run** in development: press `F5` to launch the Extension Development Host

## Development Workflow

```bash
npm run compile              # TypeScript compile (0 errors required)
npm test                     # vitest
npm run compile:standalone   # TypeScript compile of the standalone CLI (0 errors required)
npm run package              # Build the .vsix locally (output in dist/)
```

Always run `npm run compile`, `npm run compile:standalone`, and `npm test` before opening a pull request.

## Code Standards

- **TypeScript** with strict typing - no `any` unless unavoidable
- **ES modules** (`import` / `export`)
- **async/await** for asynchronous code
- **English only** for all code, comments, and documentation
- **No Chinese localization files** (this project is English-only by design)
- Use **interfaces** for object shapes, **types** for unions/aliases
- Use **const** over let wherever possible
- No `console.*` in source - use `src/logger.ts`
- No em-dash (U+2014) or en-dash (U+2013) in tracked files

## Project Structure

See [`AGENTS.md`](AGENTS.md) for the high-level overview, and [`docs/agent-instructions/architecture.md`](docs/agent-instructions/architecture.md) for the full file structure, key architectural decisions, and the model registry 3-tier merge.

## Adding a New Provider

> Models and vendors live in the **bundled registry** (`resources/models.json`), not in `src/consts.ts`. `MODELS` / `DEFAULT_PROVIDER_URLS` / `EXTERNAL_URLS` constants were removed in v1.3.0.

1. Add a `vendors[<key>]` entry in `resources/models.json` (`baseUrl`, `apiKeySecret`, `externalUrls`). Use the **upstream API id** as the key.
2. Add model definition(s) under `models` in `resources/models.json` with `family: <new-vendor>` and the upstream `id`.
3. Register the provider in `package.json` (`contributes.languageModelChatProviders`).
4. Create the provider implementation in `src/provider/<vendor>.ts` (reuse the shared helpers in `src/provider/{base,unified,convert,stream,segment,errors,tokens,request}.ts`).
5. Add gateway provider normalization in `src/aiflowbridge/providers.ts` (SSRF-validated; the default `aiflowbridge.providers` array uses the hand-curated shape, but every registry model with the new `family` is auto-synthesized on top).
6. Add an entry to `DEFAULT_GATEWAY_PROFILES` in `src/aiflowbridge/host-config.ts` if the new vendor should appear in the gateway catalog with a friendly label and family-level indicative pricing.
7. Add API key commands in `package.json` (`<vendor>: Set API Key` / `<vendor>: Clear API Key`).
8. Add provider-specific settings in `package.json` (`aiflowbridge.providers.{vendor}.*`).
9. Add unit tests in `tests/<vendor>-*.test.ts`.
10. Update `docs/providers.md` and the README provider table.

## Adding a New Model

> Models are validated against `RegistryModelDefinition` in `src/aiflowbridge/modelRegistry.schema.ts` (not `ModelDefinition` in `src/types.ts`, which is the older deprecated shape).

1. Add to the `models` array in `resources/models.json` with the **exact upstream API id** (use `AIFlowBridge: Add a custom model` or `curl /v1/models` to confirm).
2. Follow `RegistryModelDefinition` (`src/aiflowbridge/modelRegistry.schema.ts`) with the capabilities flags and, optionally, a `pricing` block.
3. Add a `model.<id>.detail` string to `package.nls.json` (key is the upstream id, NOT a kebab-case alias).
4. Update `README.md` provider table and `docs/providers.md`.
5. Add unit tests if the model has provider-specific behavior.

> If you want to add a model without editing `resources/models.json` (and waiting for a release), use `AIFlowBridge: Add a custom model` to add it to `aiflowbridge.userModels`, or place a workspace override at `.vscode/aiflowbridge.models.json`. Both go through the same merge path as the bundled registry.

## Standalone Gateway

If your change touches `src/aiflowbridge/`, `src/standalone/`, or `src/client/`, also run `npm run compile:standalone`.
The standalone binary shares the gateway / telemetry / registry code with the VS Code extension (it is NOT a separate codebase), so the same quality gates apply:

```bash
npm run compile:standalone   # Compiles dist/standalone/main.js
npm run start:standalone     # Smoke-tests the CLI (Ctrl+C to stop)
```

`tsconfig.standalone.json` path-maps `vscode` to `src/standalone/vscode-shim.ts` so the same source files typecheck without `@types/vscode`.
Any change that adds a new `vscode.*` import must either go through `IGatewayContext` (preferred) or be added to the shim.

## Pull Requests

- **One feature per PR** - keep changes focused
- **Include tests** for any new behavior
- **Update the CHANGELOG** under an "Unreleased" section if you change user-facing behavior
- **Reference the issue** if your PR fixes a bug ("Fixes #123")
- **Run `npm run compile && npm test && npm run compile:standalone` locally** before pushing

## Reporting Bugs

Open a [GitHub issue](https://github.com/LaurentOngaro/aiflowbridge/issues) with:

- A clear, descriptive title
- VS Code version (`Help > About`)
- AIFlowBridge version
- Steps to reproduce
- Expected vs actual behavior
- Relevant log output (`AIFlowBridge: Show Logs` command)

## Security Issues

**Do not open a public issue for security vulnerabilities.** See [`SECURITY.md`](SECURITY.md) for the private disclosure process.

## Code of Conduct

Be respectful, constructive, and welcoming. We are all here to build good software together.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
