# Testing

> Part of the [agent instructions](../AGENTS.md).

## Framework

**vitest** (`vitest` v2.x). Test files live under `tests/` and match `*.test.ts`.

## Conventions

- **Pure functions** are tested in isolation. Side effects (logging, file I/O, network) are stubbed or faked.
- **`vscode` is never imported directly in unit tests.** Use the `options.fs` injection point or stub `vscode.workspace.fs` to keep tests isolated from any real file system.
- **No live network.** The gateway tests use a real HTTP server bound to `127.0.0.1:<random>` and stub the upstream `fetch`.
- **No timers in tests** (`setTimeout`, `setInterval`) without explicit `vi.useFakeTimers()` / `vi.advanceTimersByTime()` cleanup.
- **Test names are sentences** (`it("rejects tokens with a zero balance", ...)`), not phrases (`it("test token", ...)`).
- **Test should avoid mentioning internal audit-trail labels** (`FEAT\d+`, `STU\d+`, `BUG\d+`, `SEC\d+`, `AFF\d+`, `REC\d+`, etc.).

## File inventory

The list of test files is changing constantly with new features and refactors.
The current inventory must be build dynamically by reading the files from the `tests/` folder.
In the same order of idea, mentioning the number of available tests is unreliable.

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
npm test
npm run compile:standalone  # 0 errors (if standalone touched)
npm run typecheck:tests   # 0 errors (type-checks tests/ via tests/tsconfig.json)
```

## Test type-checking (`tests/tsconfig.json`)

The root `tsconfig.json` only includes `src/`, so test files are not
type-checked by `npm run compile` (vitest transpiles them without type
checking). `tests/tsconfig.json` covers the `tests/` directory with
`noEmit`, inherits `strict` + `types: ["node"]` from the root config,
and is the config VS Code's TS server finds when walking up from any
file under `tests/` - the same directory-walk discovery used for the
root config, so the editor always assigns test files to it (a
root-level `tsconfig.test.json` matched only by `include` is not
reliably picked up by the editor). Run it explicitly with
`npm run typecheck:tests` (or `tsc -p tests/tsconfig.json`) to catch
type regressions in tests before CI.

Do NOT add `/// <reference types="node" />` to test files - that was a
stopgap for the old inferred-project setup and is no longer needed.
