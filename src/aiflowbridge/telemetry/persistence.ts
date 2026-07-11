import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "../../logger";
import { applyEntryToSnapshot, emptyTelemetrySnapshot } from "../telemetry";
import type { RequestTelemetry, TelemetrySnapshot } from "../types";

const STALE_LOCK_THRESHOLD_MS = 30_000;

export interface TelemetryLockHandle {
  fd: number;
  path: string;
}

export type TelemetryLockResult =
  | { ok: true; handle: TelemetryLockHandle; reapedStale?: boolean }
  | { ok: false; reason: "held" | "not-acquirable"; error?: string };

/**
 * Acquire an exclusive cooperative lock at `path` for serializing telemetry
 * file writes across processes. Ported from `gateway/lock.ts` and
 * intentionally identical in semantics (stale-mtime reaper, symlink
 * refusal, mkdir-recursive) so future lock-management work can be
 * shared.
 */
export function acquireTelemetryLock(path: string): TelemetryLockResult {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (error) {
    return {
      ok: false,
      reason: "not-acquirable",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      return {
        ok: false,
        reason: "not-acquirable",
        error: "lock path is a symlink; refusing to follow it",
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return {
        ok: false,
        reason: "not-acquirable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let fd: number;
  let reapedStale = false;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      if (reapStaleTelemetryLock(path)) {
        reapedStale = true;
        try {
          fd = openSync(path, "wx");
        } catch (retryError) {
          const retryCode = (retryError as NodeJS.ErrnoException).code;
          if (retryCode === "EEXIST" || retryCode === "EACCES") {
            return { ok: false, reason: "held" };
          }
          return {
            ok: false,
            reason: "not-acquirable",
            error: retryError instanceof Error ? retryError.message : String(retryError),
          };
        }
      } else {
        return { ok: false, reason: "held" };
      }
    } else if (code === "EACCES") {
      return { ok: false, reason: "held" };
    } else {
      return {
        ok: false,
        reason: "not-acquirable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const result: { ok: true; handle: TelemetryLockHandle; reapedStale?: boolean } = { ok: true, handle: { fd, path } };
  if (reapedStale) {
    result.reapedStale = true;
  }
  return result;
}

function reapStaleTelemetryLock(path: string): boolean {
  try {
    const stats = statSync(path);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < STALE_LOCK_THRESHOLD_MS) {
      return false;
    }
    unlinkSync(path);
    logger.warn(
      `[Telemetry] Reaped stale lock at ${path} (age ${Math.round(ageMs / 1000)}s > ${STALE_LOCK_THRESHOLD_MS / 1000}s threshold)`,
    );
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return true;
    }
    logger.warn(
      `[Telemetry] Failed to stat/reap stale lock at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export function releaseTelemetryLock(handle: TelemetryLockHandle | null): void {
  if (!handle) {
    return;
  }
  try {
    closeSync(handle.fd);
  } catch {
    // ignore
  }
  try {
    unlinkSync(handle.path);
  } catch {
    // best effort
  }
}

const ATOMIC_SUFFIX = ".tmp";

function isValidSnapshot(value: unknown): value is TelemetrySnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<TelemetrySnapshot>;
  // `byClient` was added in 2.5.0 and `bySource` in 2.6.0; both are
  // optional in the snapshot schema. Older on-disk files written by
  // pre-2.5.0 versions do not include them, and rejecting the file
  // would wipe the user's cumulative counters (BUG18). Treat the
  // per-bucket maps as optional: missing / `undefined` is OK,
  // `normalizeSnapshot` fills in empty objects on the way out.
  // Per-entry `promptSummary` / `responseSummary` (action plan item
  // #3) are also optional. We only validate that `recent` is an
  // array; the per-entry shape is already enforced by the
  // TypeScript `RequestTelemetry` type and a malformed entry
  // would surface as a runtime no-op (the dashboard coalesces
  // absent fields to `''`).
  return (
    typeof candidate.requests === "number" &&
    typeof candidate.totalTokens === "number" &&
    Array.isArray(candidate.recent) &&
    (candidate.byProvider === undefined || typeof candidate.byProvider === "object") &&
    (candidate.byModel === undefined || typeof candidate.byModel === "object") &&
    (candidate.byClient === undefined || typeof candidate.byClient === "object")
  );
}

function normalizeSnapshot(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  if (!snapshot.byProvider) snapshot.byProvider = {};
  if (!snapshot.byModel) snapshot.byModel = {};
  if (!snapshot.byClient) snapshot.byClient = {};
  if (!snapshot.bySource) snapshot.bySource = {};
  return snapshot;
}

export interface TelemetryPersisterOptions {
  filePath: string;
  lockPath: string;
}

/**
 * Cross-window, concurrent-safe file-based persister for the gateway
 * telemetry snapshot. Backed by `<globalStorageUri>/telemetry.json` with a
 * sibling `.lock` file. All writes are serialized through an in-process
 * promise chain AND a cross-process file lock, and the on-disk file is
 * updated atomically (write to `.tmp` + rename) so a crash mid-write
 * leaves the previous snapshot intact.
 */
export class TelemetryPersister {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: TelemetryPersisterOptions) {}

  get filePath(): string {
    return this.options.filePath;
  }

  get lockPath(): string {
    return this.options.lockPath;
  }

  /**
   * Synchronous read of the on-disk snapshot. Returns `undefined` when
   * the file is missing or corrupt (corrupt → warning logged, no throw,
   * because the extension must keep working after a bad manual edit).
   */
  loadSync(): TelemetrySnapshot | undefined {
    return readDiskSnapshot(this.options.filePath);
  }

  /**
   * Async variant of `loadSync`. Returns a Promise so it can be awaited
   * from the dashboard's refresh handler without blocking the UI thread.
   */
  load(): Promise<TelemetrySnapshot | undefined> {
    return Promise.resolve().then(() => readDiskSnapshot(this.options.filePath));
  }

  /**
   * Replace the on-disk snapshot with the supplied one. Serialized
   * through the in-process write chain; the cross-process lock is held
   * for the (sync, sub-millisecond) duration of the atomic rename.
   */
  saveFull(snapshot: TelemetrySnapshot): Promise<void> {
    return this.serialize(async () => {
      this.underLock(() => {
        atomicWriteJson(this.options.filePath, snapshot);
      });
    });
  }

  /**
   * Idempotent delta write: read the disk snapshot, apply the entry,
   * write back. Skips the write if `entry.id` is already present in the
   * disk `recent` list (defensive against a debounce fire-twice or a
   * crashed window replaying the same in-memory entry on reload).
   */
  appendDelta(entry: RequestTelemetry, _baseline: TelemetrySnapshot): Promise<void> {
    return this.serialize(async () => {
      this.underLock(() => {
        const onDisk = readDiskSnapshot(this.options.filePath) ?? emptyTelemetrySnapshot();
        if (onDisk.recent.some((existing) => existing.id === entry.id)) {
          return;
        }
        applyEntryToSnapshot(onDisk, entry);
        atomicWriteJson(this.options.filePath, onDisk);
      });
    });
  }

  clear(): Promise<void> {
    return this.saveFull(emptyTelemetrySnapshot());
  }

  /**
   * Idempotent entry removal: under the file lock, read the on-disk
   * snapshot, locate the entry by id in `recent`, reverse its delta from
   * the totals + per-provider / per-model maps, and write back. If the
   * entry is not on disk (e.g. it was recorded in the leader's in-memory
   * state but never made it to disk before the leader was replaced),
   * the call is a no-op and returns `false`.
   *
   * The in-memory `TelemetryStore` is the source of truth for the
   * "remove" UX path; this method is the cross-window mirror that makes
   * sure a peer window (joined to the leader) sees the entry gone on
   * its next refresh.
   */
  removeEntry(entryId: string): Promise<boolean> {
    return this.serialize(async () => {
      let removed = false;
      this.underLock(() => {
        const onDisk = readDiskSnapshot(this.options.filePath);
        if (!onDisk) {
          return;
        }
        if (revertEntryFromSnapshot(onDisk, entryId)) {
          atomicWriteJson(this.options.filePath, onDisk);
          removed = true;
        }
      });
      return removed;
    });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private underLock(work: () => void): void {
    const result = acquireTelemetryLock(this.options.lockPath);
    if (!result.ok) {
      const reason = result.error ?? result.reason;
      throw new Error(`Could not acquire telemetry lock (${result.reason}): ${reason}`);
    }
    try {
      work();
    } finally {
      releaseTelemetryLock(result.handle);
    }
  }
}

function readDiskSnapshot(filePath: string): TelemetrySnapshot | undefined {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return undefined;
    }
    logger.warn(
      `[Telemetry] Failed to read telemetry file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn(
      `[Telemetry] Corrupt telemetry file at ${filePath}, ignoring: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }

  if (!isValidSnapshot(parsed)) {
    logger.warn(`[Telemetry] Telemetry file at ${filePath} does not match the expected shape, ignoring.`);
    return undefined;
  }
  return normalizeSnapshot(parsed);
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}${ATOMIC_SUFFIX}`;
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
  try {
    renameSync(tmpPath, filePath);
  } catch (error) {
    // On Windows, rename-over-existing can sometimes fail if another
    // process has the destination file open with FILE_SHARE_DELETE
    // disabled. Retry once after a tiny pause.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "EBUSY") {
      const start = Date.now();
      while (Date.now() - start < 250) {
        try {
          renameSync(tmpPath, filePath);
          return;
        } catch {
          // busy-wait briefly
        }
      }
    }
    // Best effort: remove the temp file so it does not accumulate.
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw error;
  }
}

export function defaultTelemetryPaths(globalStorageDir: string): { filePath: string; lockPath: string } {
  return {
    filePath: join(globalStorageDir, "telemetry.json"),
    lockPath: join(globalStorageDir, "telemetry.lock"),
  };
}

/**
 * Reverse the effect of a single `applyEntryToSnapshot` call on the
 * supplied snapshot. Mutates the snapshot in place. Returns `true` when
 * the entry was found and removed, `false` otherwise.
 *
 * The arithmetic guards every subtraction with `Math.max(0, …)` to keep
 * the persisted snapshot sane even if the caller asks to remove an entry
 * that was already partially reverted (e.g. by a concurrent writer
 * racing on the same id). The `requests` counter is the authoritative
 * guard: a snapshot that already lost its matching entry has
 * `requests === 0` for the relevant key, in which case the
 * byProvider / byModel map drops the key entirely.
 */
function revertEntryFromSnapshot(snapshot: TelemetrySnapshot, entryId: string): boolean {
  const idx = snapshot.recent.findIndex((entry) => entry.id === entryId);
  if (idx === -1) {
    return false;
  }
  const entry = snapshot.recent[idx];
  snapshot.recent.splice(idx, 1);

  snapshot.requests = Math.max(0, snapshot.requests - 1);
  snapshot.promptTokens = Math.max(0, snapshot.promptTokens - entry.promptTokens);
  snapshot.completionTokens = Math.max(0, snapshot.completionTokens - entry.completionTokens);
  snapshot.totalTokens = Math.max(0, snapshot.totalTokens - entry.totalTokens);
  snapshot.estimatedCost = Math.max(0, snapshot.estimatedCost - entry.estimatedCost);
  if (entry.status >= 400) {
    snapshot.errors = Math.max(0, snapshot.errors - 1);
  }
  snapshot.averageDurationMs = recomputeWeightedAverage(
    snapshot.averageDurationMs,
    snapshot.requests + 1,
    entry.durationMs,
    snapshot.requests,
  );

  const providerSnapshot = snapshot.byProvider[entry.providerId];
  if (providerSnapshot) {
    revertEntryFromProvider(providerSnapshot, entry);
    if (providerSnapshot.requests <= 0) {
      delete snapshot.byProvider[entry.providerId];
    }
  }

  const modelSnapshot = snapshot.byModel[entry.model];
  if (modelSnapshot) {
    revertEntryFromProvider(modelSnapshot, entry);
    if (modelSnapshot.requests <= 0) {
      delete snapshot.byModel[entry.model];
    }
  }

  return true;
}

function revertEntryFromProvider(
  target: TelemetrySnapshot["byProvider"][string],
  entry: RequestTelemetry,
): void {
  target.requests = Math.max(0, target.requests - 1);
  target.promptTokens = Math.max(0, target.promptTokens - entry.promptTokens);
  target.completionTokens = Math.max(0, target.completionTokens - entry.completionTokens);
  target.totalTokens = Math.max(0, target.totalTokens - entry.totalTokens);
  target.estimatedCost = Math.max(0, target.estimatedCost - entry.estimatedCost);
  if (entry.status >= 400) {
    target.errors = Math.max(0, target.errors - 1);
  }
  target.averageDurationMs = recomputeWeightedAverage(
    target.averageDurationMs,
    target.requests + 1,
    entry.durationMs,
    target.requests,
  );
}

/**
 * Re-derive a weighted average after removing one sample.
 *   previous = totalDuration / oldCount
 *   newTotalDuration = (previous * oldCount) - removedDuration
 *   newAverage       = newTotalDuration / newCount  (or 0 if newCount === 0)
 *
 * `oldCount` is the count BEFORE the removal so the math is consistent
 * with `previous * oldCount` (which was the original `totalDuration`).
 */
function recomputeWeightedAverage(
  previous: number,
  oldCount: number,
  removedDuration: number,
  newCount: number,
): number {
  if (newCount <= 0) {
    return 0;
  }
  const totalDuration = previous * oldCount - removedDuration;
  return totalDuration > 0 ? totalDuration / newCount : 0;
}
