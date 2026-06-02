# Contributing to AIFlowBridge

Thanks for your interest in contributing! AIFlowBridge is an open-source VS Code extension that brings DeepSeek, MiniMax, and Xiaomi MiMo into GitHub Copilot Chat. Every contribution is welcome.

## Quick Start

1. **Fork** the repository on GitHub
2. **Clone** your fork: `git clone https://github.com/<you>/aiflowbridge`
3. **Install** dependencies: `npm ci`
4. **Open** in VS Code: `code .`
5. **Run** in development: press `F5` to launch the Extension Development Host

## Development Workflow

```bash
npm run compile   # TypeScript compile (0 errors required)
npm test          # vitest, 237 tests must pass
npm run package   # Build the .vsix locally
```

Always run `npm run compile` and `npm test` before opening a pull request.

## Code Standards

- **TypeScript** with strict typing - no `any` unless unavoidable
- **ES modules** (`import` / `export`)
- **async/await** for asynchronous code
- **English only** for all code, comments, and documentation
- **No Chinese localization files** (this project is English-only by design)
- Use **interfaces** for object shapes, **types** for unions/aliases
- Use **const** over let wherever possible

## Project Structure

See [`AGENTS.md`](AGENTS.md) for the full file structure, key architectural decisions, and common tasks (adding a provider, adding a model).

## Adding a New Provider

1. Add the model definition to `src/consts.ts` (`MODELS` array)
2. Register the provider in `package.json` (`contributes.languageModelChatProviders`)
3. Create the provider implementation in `src/provider/<vendor>.ts`
4. Add gateway provider normalization in `src/aiflowbridge/providers.ts`
5. Add the API key command in `package.json` (`contributes.commands`)
6. Add external URLs to `src/consts.ts` (`EXTERNAL_URLS`)
7. Update `package.nls.json` with the provider's `model.<id>.detail` strings
8. Update the README provider table

## Adding a New Model

1. Add to `MODELS` in `src/consts.ts`
2. Follow the `ModelDefinition` interface (`src/types.ts`) with the correct capabilities flags
3. Add a `model.<id>.detail` string to `package.nls.json`
4. Update the README provider table
5. Add unit tests if the model has provider-specific behavior

## Pull Requests

- **One feature per PR** - keep changes focused
- **Include tests** for any new behavior
- **Update the CHANGELOG** under an "Unreleased" section if you change user-facing behavior
- **Reference the issue** if your PR fixes a bug ("Fixes #123")
- **Run `npm run compile && npm test` locally** before pushing

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
