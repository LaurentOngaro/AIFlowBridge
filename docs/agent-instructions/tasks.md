# Common tasks

> Part of the [agent instructions](../AGENTS.md).

## Building

```bash
npm run compile              # Compile TypeScript (VS Code extension)
npm run watch                # Watch mode for development
npm run package              # Build .vsix package (output in dist/)
npm run build:standalone     # Build the standalone gateway CLI (dist/standalone/main.js)
npm run start:standalone     # Run the standalone gateway CLI from a build
npm test                     # Run vitest unit tests (647 tests / 36 files)
npm run publish:vscode       # Publish to VS Code Marketplace (requires PAT)
npm run publish:openvsx      # Publish to Open VSX (Cursor / Windsurf / VSCodium)
npm run publish:all          # Publish to both stores
```

## Local install helper

```bash
# Build, package, and install into the active VS Code profile
pwsh -File _helpers/Publish-AIFlowBridge.ps1

# Build, package, and install into every profile folder found on this machine
pwsh -File _helpers/Publish-AIFlowBridge.ps1 -AllProfiles
```

If you run the helper without `-Profiles` or `-AllProfiles`, the script detects available local profiles and prompts you to pick which ones should receive the VSIX (you can type indices like `1,3` or `a` for all).

## Adding a new provider

1. **Vendor entry** in `resources/models.json` under `vendors` (`baseUrl`, `apiKeySecret`, `externalUrls`). Use the upstream API id as the key.
2. **Model definition(s)** in `resources/models.json` under `models` with `family: <new-vendor>` and the upstream `id`.
3. **Provider registration** in `package.json` (`contributes.languageModelChatProviders`).
4. **Provider implementation** in `src/provider/<vendor>.ts`. Reuse `src/provider/{base,unified,convert,stream,segment,errors,tokens,request}.ts`.
5. **Gateway provider normalization** in `src/aiflowbridge/providers.ts` - the default `aiflowbridge.providers` array uses the hand-curated shape, but every registry model with the new `family` is auto-synthesized on top.
6. **`DEFAULT_GATEWAY_PROFILES`** in `src/aiflowbridge/host-config.ts` if the new vendor should appear in the gateway catalog with a friendly label and family-level indicative pricing.
7. **API key commands** in `package.json` (`<vendor>: Set API Key` / `Clear API Key`).
8. **Provider-specific settings** in `package.json` (`aiflowbridge.providers.{vendor}.*`).
9. **Add tests** in `tests/<vendor>-*.test.ts` + register in `docs/agent-instructions/testing.md`.

> If you want to add a model without editing `resources/models.json` (and waiting for a release), use `AIFlowBridge: Add a custom model` to add it to `aiflowbridge.userModels`, or place a workspace override at `.vscode/aiflowbridge.models.json`.
> Both go through the same merge path as the bundled registry.

## Adding a new model

1. **Add to `models` array in `resources/models.json`** with the **exact upstream API id** (use `AIFlowBridge: Add a custom model` or `curl /v1/models` to confirm).
2. **Follow `RegistryModelDefinition`** in `src/aiflowbridge/modelRegistry.schema.ts` with the capabilities flags and, optionally, a `pricing` block.
3. **Add to `package.nls.json`** with `model.{id}.detail` translation (key is the upstream id, NOT a kebab-case alias).
4. **Update README provider table** (`## Features` and `docs/providers.md`).

## Adding a new test

See [testing.md](testing.md#adding-a-test).

## Debugging

| Symptom                    | Where to look                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Gateway won't start        | `AIFlowBridge: Show logs` (`[Gateway]` lines)                                             |
| Provider returns errors    | `[MiniMax]` / `[Xiaomi]` / `[DeepSeek]` lines + `AIFlowBridge: Open request dumps folder` |
| Dashboard shows stale data | `AIFlowBridge: Refresh metrics` (reads from disk)                                         |
| Vision proxy not invoked   | `[Vision]` lines + `aiflowbridge.vision.excludedVendors`                                  |
| Standalone CLI won't bind  | stderr output + `~/.aiflowbridge/gateway.log`                                             |
