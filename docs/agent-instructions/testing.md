# Testing

> Part of the [agent instructions](../AGENTS.md).

## Framework

**vitest** (`vitest` v2.x). Test files live under `tests/` and match `*.test.ts`.

## Current state (2.1.1)

**616 tests across 34 files.** Quality gates:

- `npm run compile` - 0 TypeScript errors.
- `npm test` - 616/616 passing.

## Conventions

- **Pure functions** are tested in isolation. Side effects (logging, file I/O, network) are stubbed or faked.
- **`vscode` is never imported directly in unit tests.** Use the `options.fs` injection point or stub `vscode.workspace.fs` to keep tests isolated from any real file system.
- **No live network.** The gateway tests use a real HTTP server bound to `127.0.0.1:<random>` and stub the upstream `fetch`.
- **No timers in tests** (`setTimeout`, `setInterval`) without explicit `vi.useFakeTimers()` / `vi.advanceTimersByTime()` cleanup.
- **Test names are sentences** (`it("rejects tokens with a zero balance", ...)`), not phrases (`it("test token", ...)`).

## File inventory

```
tests/
├── gateway.test.ts                      # HTTP endpoints + singleton detection + telemetry persistence
├── gateway-version.test.ts              # compareSemver + probeServerVersion + requestPeerShutdown + waitUntilPortFree
├── gateway-restart.test.ts              # End-to-end cooperative restart flow with stubbed UserPrompt + fake peer
├── gateway-lock.test.ts                 # acquireGatewayLock / releaseGatewayLock + stale-lock reaper
├── gateway-reasoning.test.ts            # Kilo Code reasoning pass-through to MiniMax reasoning_split
├── modelRegistry.schema.test.ts         # Hand-rolled registry validator coverage
├── modelRegistry.test.ts                # 3-tier loader with mocked vscode.workspace.fs
├── telemetry-store.test.ts              # TelemetryStore record / snapshot / restore / reset / persister hook
├── telemetry-persistence.test.ts        # File-based persister + file lock + atomic write + concurrent writers + removeEntry
├── telemetry-drain.test.ts              # Keep-alive drain on stop (regression)
├── aiflowbridge-providers.test.ts       # Gateway profile normalization + SSRF + selection
├── aiflowbridge-config.test.ts          # User-model synthesis into the gateway provider list
├── userModels.test.ts                   # User-declared model validation
├── api-key-resolver.test.ts             # resolveVendorApiKey matrix (vendor aliasing, case-insensitive)
├── config.test.ts                       # resolveReasoningSplit helper
├── dashboard.test.ts                    # Metrics dashboard HTML builder (filter pipeline, delete button, versions badge)
├── minimax-resolveModelId.test.ts       # MiniMax id passthrough + override
├── minimax.test.ts                      # MiniMax provider - HTTP streaming + reasoning translation
├── xiaomi.test.ts                       # Xiaomi MiMo provider
├── xiaomi-conversion.test.ts            # Xiaomi message conversion
├── token-counter.test.ts                # MiniMax /v1/responses/input_tokens wrapper
├── deepseek-error.test.ts               # DeepSeek upstream error normalization
├── deepseek-convert.test.ts             # DeepSeek vscode.LM message conversion
├── deepseek-classifier.test.ts          # DeepSeek error classifier
├── deepseek-tokens.test.ts              # DeepSeek token counting
├── deepseek-stream.test.ts              # DeepSeek SSE stream parsing
├── deepseek-notices.test.ts             # DeepSeek tool-call notices
├── provider-errors.test.ts              # Shared upstream error normalization
├── vscode-context-adapter.test.ts       # createVSCodeContext() joinPath + IGatewayContext shape
├── subscriptions-bag.test.ts            # subscriptions Proxy wrapper
├── migration-legacy.test.ts             # 1.6.x -> 2.0.0 telemetry migration
├── commands-ux.test.ts                  # Command registration + IGatewayContext hooks (resetMetrics / copyGatewayUrl / openSettings / setVisionModel)
├── migration-legacy.test.ts             # 1.6.x -> 2.0.0 telemetry migration
└── standalone/
    ├── context.test.ts                  # createStandaloneContext() env-var / secrets.json resolution + hot-reload
    └── config-loader.test.ts            # StandaloneConfigFile reader (override + cache + corrupt JSON)
```

## Adding a test

1. **Find the closest existing test file** - tests are grouped by module under test (e.g. `gateway.test.ts` covers `src/aiflowbridge/gateway/server.ts`).
2. **Match the import style** - top-of-file imports for `vitest` (`describe`, `it`, `expect`, `beforeEach`, `vi`), then the module under test, then any stubs.
3. **Pure-function first** - if the bug is in a pure helper, write a pure-function test. Stub the impure surface only as needed.
4. **Regression tests** link to the originating report in the describe block name (`describe("errored requests have zero cost", ...)`).
5. **Run `npm test`** before committing.

## Quality gates

Before opening a PR:

```bash
npm run compile           # 0 errors
npm test                  # 616/616
npm run compile:standalone  # 0 errors (if standalone touched)
```
