# ACTION PLAN

This document details the implementation steps to make the AIFlowBridge extension publishable on the VS Code Marketplace. It completes the `TODO.md` file by adding the necessary technical details.

---

## Follow-up agreement

Each completed edit:

- Check the box in this document (go from `[ ]` to `[x]`)
- Update the status in `TODO.md` if a section references it
- Keep the history of this document (do not delete completed sections)

---

## (DONE) Release 1.5.0 - FEAT1 + AFF03

Pre-implementation audit:

- **FEAT1 (cross-window shared metrics)**: data is currently in `globalState` (per-user, not per-workspace, so already shared across windows) but (a) concurrent writes are NOT serialized - two windows both calling `globalState.update()` race and last-write-wins, losing increments - and (b) storage lives in VS Code's internal SQLite, not a file the user can inspect/back up. The file-lock primitive already exists at `src/aiflowbridge/gateway/lock.ts` and is reusable for telemetry.
- **AFF03 (dashboard UX)**: none of the 5 sub-tasks are present in `src/aiflowbridge/ui/dashboard.ts`. The current "Gateway running" badge is a plain text node, the version is never rendered, sections are not collapsible, and the only filters are the 5 preset time ranges.

### FEAT1 - Cross-window shared metrics with concurrent access management

Storage & locking:

- [x] Create `src/aiflowbridge/telemetry/persistence.ts` with the file lock primitive:
  - [x] Port `acquireTelemetryLock(path)` / `releaseTelemetryLock(handle)` from the gateway lock (stale mtime reaper at 30s, symlink refusal, mkdir-recursive, EEXIST→reap-once→retry)
  - [x] `STALE_LOCK_THRESHOLD_MS = 30_000` (same as gateway lock)
  - [x] Type `TelemetryLockHandle = { fd: number; path: string }` and discriminated `LockResult = { ok: true, handle, reapedStale? } | { ok: false, reason: 'held' | 'not-acquirable', error? }`

- [x] In the same file, implement `TelemetryPersister`:
  - [x] Constructor: `constructor({ filePath: string; lockPath: string; logger?: ... })`
  - [x] `loadSync(): TelemetrySnapshot | undefined` - sync read used at activation; returns `undefined` if the file is missing OR corrupt (corrupt → `logger.warn` + treat as missing, do NOT throw)
  - [x] `load(): Promise<TelemetrySnapshot | undefined>` - async variant used by the dashboard Refresh button
  - [x] `appendDelta(entry: RequestTelemetry, baseline: TelemetrySnapshot): Promise<void>` - under lock: read disk, apply `entry` to on-disk state via the same merge rules as `TelemetryStore.record()`, write atomically. The `baseline` argument is the snapshot at the time the entry was recorded locally; it is used to skip the entry if it has already been persisted (defensive idempotency in case the debounce fires twice).
  - [x] `saveFull(snapshot: TelemetrySnapshot): Promise<void>` - under lock: write the full snapshot (used by the "Reset metrics" command)
  - [x] `clear(): Promise<void>` - under lock: write an empty snapshot
  - [x] Atomic write: `writeFileSync(<file>.tmp, JSON.stringify(snapshot))` → `renameSync(<file>.tmp, <file>)` (POSIX-atomic; on Windows `rename` overwrites the destination)
  - [x] In-flight serialization: a per-persister promise chain (`this.writeQueue = this.writeQueue.then(...)`) so two simultaneous `appendDelta` calls do not both pass the lock-acquire check before either has actually held it

Wiring into `TelemetryStore`:

- [x] Modify `src/aiflowbridge/telemetry.ts`:
  - [x] Add an optional 2nd constructor parameter `persister?: TelemetryPersister`
  - [x] In `record(entry)`: if `persister` is set, capture the pre-record snapshot, then schedule `void persister.appendDelta(entry, baseline).catch(err => logger.warn(...))` (fire-and-forget, never throw)
  - [x] Add `refreshFromDisk(): boolean` - calls `persister.loadSync()`, calls `restore(state)`, returns `true` on success
  - [x] In `restore(state)`: if `state` is `undefined` AND `persister` is set, try `persister.loadSync()` first; only return empty if that is also `undefined`

Wiring into the runtime + migration:

- [x] Modify `src/aiflowbridge/index.ts`:
  - [x] Compute paths: `path.join(context.globalStorageUri.fsPath, 'telemetry.json')` and `telemetry.lock`
  - [x] Construct a single `TelemetryPersister` per activation, share it between the `GatewayService` (writer) and the runtime's `telemetryFallback` (mirror reader)
  - [x] Extend `GatewayService` constructor signature with optional `persister: TelemetryPersister` (default `undefined` for backward compatibility with the unit tests)
  - [x] **One-time migration** in `activate()`: if `globalState.get('aiflowbridge.telemetry.v1')` is set AND the file does not exist, call `persister.saveFull(legacySnapshot)` then `globalState.update('aiflowbridge.telemetry.v1', undefined)`. Log the migration at INFO with the snapshot's request count so it is visible in the output channel.
  - [x] `loadPersistedTelemetry()` reads via `persister.loadSync()` (falls back to `globalState` for the very first activation after install, before the migration runs)
  - [x] `savePersistedTelemetry(snapshot)` is now a no-op for the globalState key (the file is the source of truth); kept as a no-op stub to avoid changing the `GatewayService` callback contract
  - [x] The `aiflowbridge.refreshMetrics` command now calls `gateway.refreshFromDisk()` + `telemetryFallback.refreshFromDisk()` before re-rendering, so a joined (non-leader) window picks up the leader's writes on a manual refresh
  - [x] The `aiflowbridge.resetMetrics` command calls `persister.clear()` after `gateway.resetMetrics()`, so a reset is visible to every other window

Tests - new file `tests/telemetry-persistence.test.ts`:

- [x] `acquireTelemetryLock`:
  - [x] free acquire returns `{ ok: true, handle }`
  - [x] second acquire on the same path returns `{ ok: false, reason: 'held' }`
  - [x] symlink at the lock path returns `{ ok: false, reason: 'not-acquirable' }` with an error mentioning 'symlink'
  - [x] stale mtime (>30s) is reaped and the second acquire succeeds with `reapedStale: true`
  - [x] fresh mtime (<30s) is NOT reaped
  - [x] parent directory is created if missing
- [x] `TelemetryPersister`:
  - [x] `loadSync()` on a missing file returns `undefined`
  - [x] `loadSync()` on a valid file returns the parsed snapshot
  - [x] `loadSync()` on a corrupt file returns `undefined` and logs a warning (does not throw)
  - [x] `appendDelta(entry, baseline)` writes the entry to disk
  - [x] `appendDelta` accumulates: N calls with distinct entries → on-disk `requests === N`
  - [x] `appendDelta` is idempotent if the same `(entry.id, baseline)` is replayed (no double-count)
  - [x] `saveFull(snapshot)` overwrites the file with the provided snapshot
  - [x] `clear()` writes an empty snapshot
  - [x] **Concurrent appendDelta from N parallel writers** (Promise.all of 50 calls): on-disk `requests === 50` (no lost writes - the lock + write-queue serialize them)
  - [x] Atomic write: while a write is in progress, the destination file is never observed in a partial state (read-while-write returns the old or new content, never a truncated JSON)
- [x] `TelemetryStore` integration with a stub persister:
  - [x] `record()` calls `persister.appendDelta` exactly once per call
  - [x] `refreshFromDisk()` swaps the in-memory state for the disk state
  - [x] `record()` then `refreshFromDisk()` does NOT lose the just-recorded entry (the disk write is awaited before the refresh in the test, mirroring the real debounce + await)

### AFF03 - Dashboard improvements

Versions in the header:

- [x] Modify `src/aiflowbridge/ui/dashboard.ts`:
  - [x] New prop on `buildDashboardHtml(config, snapshot, running, versions?)` where `versions = { gateway?: string; extension?: string }`
  - [x] Replace the gateway badge with `"Gateway v${gatewayVersion} running"` (or `"stopped"`), keeping the existing `baseUrl` and tooltip
  - [x] Add a subtitle line under the title: `"Current version: v${extensionVersion}"`
  - [x] Default behaviour when versions are not provided: omit the version suffix and the subtitle (backward-compatible with existing tests that don't pass versions)
- [x] Wire from `src/aiflowbridge/index.ts`:
  - [x] Pass `{ gateway: gateway.bundledVersion, extension: context.extension.packageJSON.version }` to `buildDashboardHtml`
  - [x] `showMetricsDashboard` signature gains the same `versions` parameter

Collapsible sections:

- [x] Add CSS for the collapsible header button: chevron `▸` rotates to `▾` on `collapsed`
- [x] Wrap each `.panel` content in `.panel-body`, and add a `.panel-header` `<button>` with `data-collapse-target="<id>"` that toggles a `collapsed` class on the panel
- [x] JS click handler: on click, find the panel by id, toggle `.collapsed`; persist the state in `localStorage` under the key `aiflowbridge.dashboard.collapsed.<id>` (per-section)
- [x] On first render, read each section's stored state and apply it
- [x] Default: all expanded
- [x] Section ids: `gateway`, `recent`, `model`, `provider`

Custom date range pickers:

- [x] Add a "From" and "To" `<input type="date">` in the filter area of the Recent requests panel
- [x] JS: extend the existing `filterByRange` to also accept a `custom` range `{ from?: Date, to?: Date }` (entry kept if `from <= ts <= to`; missing bounds are open-ended)
- [x] Preset buttons (All / 1h / 24h / 7d / 30d) clear the custom range; entering a custom date deactivates the preset buttons
- [x] The same `custom` range is also applied to the "By model" panel (same behavior as the presets)
- [x] Empty / invalid date inputs = no constraint (passes through)

Request text filter:

- [x] Add a single `<input type="search" placeholder="Filter requests…">` in the filter area of the Recent requests panel
- [x] JS: case-insensitive substring match across `model`, `providerId`, `providerLabel`, `status` (as string), `timestamp` (ISO + formatted), `durationMs`, `totalTokens`, `estimatedCost` (as string)
- [x] Filter applies ON TOP of the time range filter (intersection, not replacement)
- [x] Empty input = no filter
- [x] The same search input also filters the "By model" panel (matching models whose name contains the substring, OR any of their recent entries match)

Tests - extend `tests/dashboard.test.ts`:

- [x] "Gateway running" badge includes `v<version>` when a gateway version is provided
- [x] "Current version: vX.Y.Z" subtitle is rendered under the title when an extension version is provided
- [x] Each of the 4 panel sections has a collapsible header (button + chevron + data-collapse-target)
- [x] JS contains the collapse toggle handler
- [x] Two `<input type="date">` controls are rendered in the recent filter area
- [x] `<input type="search">` is rendered
- [x] JS contains the search filter logic and applies it to both the recent and by-model tables
- [x] When the user has not provided versions, the existing snapshot/badge string is preserved (no regression for callers that do not pass `versions`)

### Release hygiene

- [x] `npm run compile` - 0 TypeScript errors
- [x] `npm test` - all green; update the test count in CHANGELOG + AGENTS.md (was 407 tests / 25 files in 1.4.1, plus the new persistence tests)
- [x] `TODO.md`:
  - [x] Move `FEAT1` from "Features" to "Completed > 1.5.0"
  - [x] Move `AFF03` from "Display" to "Completed > 1.5.0"
- [x] `CHANGELOG.md`:
  - [x] Add a `## 1.5.0` entry at the top (above 1.4.2) describing FEAT1 and AFF03
- [x] `package.json`: bump `version` from `1.4.2` to `1.5.0`
- [x] `AGENTS.md`:
  - [x] Update the test count in the testing section
  - [x] Add `src/aiflowbridge/telemetry/persistence.ts` to the "Important Files" / file-structure section
  - [x] Update the gateway lock description if it changes (it does not - telemetry lock is a new file, not a change)

---

## Post-release audit (2026-06-06)

The plan was implemented as-is for everything except three items, which
were caught in a verification pass and corrected in a follow-up:

- **Section ids** (AFF03 collapsible sections): the plan asked for
  bare ids (`gateway` / `recent` / `model` / `provider`). The
  implementation used `panel-*` prefixed ids
  (`panel-gateway` / `panel-recent` / `panel-model` / `panel-provider`)
  for DOM clarity. **Kept as-is** (works correctly, more descriptive).
- **Preset ↔ custom date interaction** (AFF03): the plan asked for
  "preset clears custom / custom deactivates preset". The first
  implementation just intersected the two filters without
  clearing/deactivating. **Corrected in this pass** — clicking a
  preset now clears the from/to inputs; entering a custom date
  deactivates the active preset.
- **By-model search on model name** (AFF03): the plan asked for
  "models whose name contains the substring OR any of their recent
  entries match". The first implementation only matched at the
  entry level. **Corrected in this pass** — the by-model filter
  now includes an entry when its model name (lowercased) contains
  the search needle, even when no individual field in the entry
  matches.
- `AGENTS.md` test count was also updated (453 → 466 → 471 → 473 across
  the four passes: 1.5.0 ship, post-release delete button, audit
  corrections, `reset()` regression tests covering the fix for the bug
  that `clearInMemory` was public and let `reset()`'s write race a
  subsequent `restore()` call). All 473 tests passing.
