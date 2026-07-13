# Common tasks

> Part of the [agent instructions](../AGENTS.md).

## Building

```bash
npm run compile              # Compile TypeScript (VS Code extension)
npm run watch                # Watch mode for development
npm run package              # Build .vsix package (output in dist/)
npm run build:standalone     # Build the standalone gateway CLI (dist/standalone/main.js)
npm run start:standalone     # Run the standalone gateway CLI from a build
npm test                     # Run vitest unit tests (905 tests / 50 files, includes tests/integration/openrouter.smoke.test.ts)
npm run publish:vscode       # Publish to VS Code Marketplace (requires PAT)
npm run publish:openvsx      # Publish to Open VSX (Cursor / Windsurf / VSCodium)
npm run publish:all          # Publish to both stores
```

## Local install helper

```bash
# Build, package, and install into the active VS Code profile
pwsh -File _helpers/scripts/PublishAIFlowBridge.ps1

# Build, package, and install into every profile folder found on this machine
pwsh -File _helpers/scripts/PublishAIFlowBridge.ps1 -AllProfiles
```

If you run the helper without `-Profiles` or `-AllProfiles`, the script detects available local profiles and prompts you to pick which ones should receive the VSIX (you can type indices like `1,3` or `a` for all).

## Adding a new provider

There are two distinct integration paths. **Pick the right one before editing anything.**

### Path A - Copilot Chat picker + gateway (DeepSeek, MiniMax, Xiaomi MiMo today)

The full recipe - the vendor shows up in the Copilot Chat picker AND in the OpenAI-compatible gateway catalog:

1. **Vendor entry** in `resources/models.json` under `vendors` (`baseUrl`, `apiKeySecret`, `externalUrls`). Use the upstream API id as the key.
2. **Model definition(s)** in `resources/models.json` under `models` with `family: <new-vendor>` and the upstream `id`.
3. **Schema enum** in `resources/models.schema.json` (`family` enum at line 83) - must include the new vendor.
4. **Runtime validator** in `src/aiflowbridge/modelRegistry.schema.ts` (`KNOWN_FAMILIES` Set) - must include the new vendor.
5. **Provider registration** in `package.json` (`contributes.languageModelChatProviders`).
6. **Provider implementation** in `src/provider/<vendor>.ts`. Reuse `src/provider/{base,unified,convert,stream,segment,errors,tokens,request}.ts`.
7. **Per-vendor instantiation** in `src/runtime/provider.ts` (`registerAllProviders`) - instantiate the provider class, push it into the `perVendor` array, register `setApiKey` / `clearApiKey` commands.
8. **Gateway provider normalization** in `src/aiflowbridge/providers.ts` - the default `aiflowbridge.providers` array uses the hand-curated shape, but every registry model with the new `family` is auto-synthesized on top.
9. **`DEFAULT_GATEWAY_PROFILES`** in `src/aiflowbridge/host-config.ts` if the new vendor should appear in the gateway catalog with a friendly label and family-level indicative pricing. **The hand-curated `id` MUST equal the upstream model id** (the same string as `model`) - using a vendor name (e.g. `'minimax'`) or any other fake placeholder here puts a non-existent id in the gateway catalog exposed to Kilo Code / Continue / Open WebUI, making the picker show a model name that no upstream API recognises. The regression test "hand-curated gateway profiles use real upstream model ids as catalog ids" in `tests/host-config.test.ts` is the guard. The historical DeepSeek alias convention (`id: 'deepseek-flash'`, `model: 'deepseek-v4-flash'`) is allowed for friendly display but its `id` is also a real upstream-facing identifier on the same vendor - never a vendor name.
10. **`API_KEY_SECRETS`** in `src/consts.ts` - add `<vendor>: 'aiflowbridge.providers.<vendor>.apiKey'`.
11. **`VENDOR_ALIASES`** in `src/aiflowbridge/api-key-resolver.ts` - add `<vendor>: ['<vendor>']` (and upstream-style aliases like `xiaomi: ['xiaomi', 'mimo']` if the upstream uses a different prefix).
12. **`VENDOR_CHOICES` + `VENDOR_LABELS`** in `src/runtime/addCustomModel.ts` - the picker in the "Add a custom model" command must list the vendor.
13. **API key commands** in `package.json` (`<vendor>: Set API Key` / `Clear API Key`).
14. **Provider-specific settings** in `package.json` (`aiflowbridge.providers.{vendor}.*`).
15. **i18n** in `package.nls.json` (`provider.<vendor>.name` + `model.<id>.detail` per model).
16. **Add tests** in `tests/<vendor>-*.test.ts` + register in `docs/agent-instructions/testing.md`.

### Path B - Gateway-only vendor (OpenRouter since 2.12.0)

The vendor is exposed through the OpenAI-compatible gateway (`http://127.0.0.1:8787/v1`) but **NOT** in the Copilot Chat picker. This is the right path for a meta-provider that fronts many models behind a single OpenAI-compatible endpoint, where writing a per-model `vscode.LanguageModelChatProvider` does not buy the user anything (the gateway already forwards the call verbatim).

1. **Vendor entry** in `resources/models.json` under `vendors` (`baseUrl`, `apiKeySecret`, `externalUrls`).
2. **Bundled model entries** in `resources/models.json` under `models` - optional but recommended for the flagship set so they appear in `GET /v1/models` with dashboard-side pricing. Any other model id from the upstream is reachable verbatim through the gateway via `aiflowbridge.userModels` or registry overrides, no extension update needed.
3. **Schema enum** in `resources/models.schema.json` (`family` enum) - must include the new vendor.
4. **Runtime validator** in `src/aiflowbridge/modelRegistry.schema.ts` (`KNOWN_FAMILIES`) - must include the new vendor.
5. **`API_KEY_SECRETS`** in `src/consts.ts` - the gateway needs to resolve the key.
6. **`VENDOR_ALIASES`** in `src/aiflowbridge/api-key-resolver.ts` - one alias minimum, more if the upstream uses a different id prefix.
7. **`VENDOR_CHOICES` + `VENDOR_LABELS`** in `src/runtime/addCustomModel.ts` - the picker in the "Add a custom model" command lets users discover unknown model ids from the vendor's `/v1/models`.
8. **Provider-specific settings** in `package.json` (`aiflowbridge.providers.<vendor>.baseUrl`) - lets users point at a private relay (e.g. a self-hosted OpenRouter-compatible stack).
9. **Upstream-specific headers** (if the upstream requires them) - e.g. OpenRouter asks for `HTTP-Referer` + `X-Title` so requests are eligible for the free-tier reliability track. Put the helper in a small VS-Code-free module (see `src/aiflowbridge/gateway/openrouter-headers.ts` for the pattern), wire it into `forwardChatCompletion()` in `src/aiflowbridge/gateway/server.ts`, and export the helper so the smoke test can import it without booting the full gateway.
10. **i18n** in `package.nls.json` (`provider.<vendor>.name` + `model.<id>.detail` per bundled model).
11. **Add tests** in `tests/integration/<vendor>.smoke.test.ts` (VS-Code-free so it imports the gateway helpers directly) + register in `docs/agent-instructions/testing.md`.

### Adding a model without a release

> If you want to add a model without editing `resources/models.json` (and waiting for a release), use `AIFlowBridge: Add a custom model` to add it to `aiflowbridge.userModels`, or place a workspace override at `.vscode/aiflowbridge.models.json`.
> Both go through the same merge path as the bundled registry.
> For Path B vendors (OpenRouter-style), this is the recommended way to reach the 100+ model ids that aren't in the bundled set - declare the new id in `userModels` with `family: "openrouter"` and the gateway synthesizes a virtual provider profile from `vendors.openrouter.baseUrl`.

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
| Provider returns errors    | `[MiniMax]` / `[Xiaomi]` / `[DeepSeek]` / `[OpenRouter]` lines + `AIFlowBridge: Open request dumps folder` |
| Dashboard shows stale data | `AIFlowBridge: Refresh metrics` (reads from disk)                                         |
| Vision proxy not invoked   | `[Vision]` lines + `aiflowbridge.vision.excludedVendors`                                  |
| Standalone CLI won't bind  | stderr output + `~/.aiflowbridge/gateway.log`                                             |
