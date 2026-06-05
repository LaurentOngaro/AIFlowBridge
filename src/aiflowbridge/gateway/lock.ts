import { closeSync, lstatSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../../logger";

export type LockAcquisitionResult =
  | { ok: true; handle: GatewayLockHandle; reapedStale?: boolean }
  | { ok: false; reason: "held" | "not-acquirable"; error?: string };

export interface GatewayLockHandle {
  fd: number;
  path: string;
}

/**
 * How old a `gateway.lock` file must be (mtime) before we treat it as a
 * stale lock left over from a crashed previous activation and unlink it.
 *
 * Picked at 30s: a healthy VS Code extension activation finishes in well
 * under 30s, so a lock older than that is almost certainly orphaned. The
 * sweep is best-effort; a false positive (a long activation races with a
 * peer restart) costs at most one extra restart prompt to the user.
 */
const STALE_LOCK_THRESHOLD_MS = 30_000;

/**
 * Try to acquire an exclusive cooperative lock at `path`.
 *
 * On success: creates the parent directory if missing, then opens the
 * file with `O_CREAT|O_EXCL` (the `wx` flag). Returns the fd so the
 * caller can release it later.
 *
 * Failure modes are returned, not thrown:
 * - `held`        - the file already exists and is recent (a peer
 *                   activation holds it). A stale lock (mtime > 30s) is
 *                   transparently reaped and the acquisition is retried
 *                   once.
 * - `not-acquirable` - I/O failure other than EEXIST (e.g. permissions,
 *                     the path is a symlink we refuse to follow, ENOENT
 *                     after mkdir, ...).
 */
export function acquireGatewayLock(path: string): LockAcquisitionResult {
  // Ensure the parent directory exists. globalStorageUri is normally
  // pre-created by VS Code, but on a brand-new profile or after a
  // partial uninstall the directory can be missing.
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (error) {
    return {
      ok: false,
      reason: "not-acquirable",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Refuse to follow a symlink at the lock path. openSync(path, 'wx')
  // follows symlinks on POSIX, which would let a co-installed malicious
  // extension turn lock acquisition into an arbitrary-file-creation
  // primitive.
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
    // ENOENT is the happy path - file does not exist, we can create it.
  }

  let fd: number;
  let reapedStale = false;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      // The file already exists. If it looks stale (mtime older than
      // 30s), the previous activation probably crashed between acquire
      // and release. Unlink it and try once more.
      if (reapStaleLock(path)) {
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
  const result: { ok: true; handle: GatewayLockHandle; reapedStale?: boolean } = { ok: true, handle: { fd, path } };
  if (reapedStale) {
    result.reapedStale = true;
  }
  return result;
}

function reapStaleLock(path: string): boolean {
  try {
    const stats = statSync(path);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < STALE_LOCK_THRESHOLD_MS) {
      return false;
    }
    unlinkSync(path);
    logger.warn(
      `[Gateway] Reaped stale lock at ${path} (age ${Math.round(ageMs / 1000)}s > ${STALE_LOCK_THRESHOLD_MS / 1000}s threshold)`,
    );
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // The file disappeared between our EEXIST and the stat; treat as
      // already reaped and let the outer openSync retry succeed.
      return true;
    }
    logger.warn(
      `[Gateway] Failed to stat/reap stale lock at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

export function releaseGatewayLock(handle: GatewayLockHandle | null): void {
  if (!handle) {
    return;
  }
  try {
    closeSync(handle.fd);
  } catch {
    // ignore - lock will be released when the process exits anyway
  }
  // fs.openSync(path, 'wx') fails as long as the file exists, so we must
  // also unlink it to allow a future activation to acquire the lock again.
  try {
    unlinkSync(handle.path);
  } catch {
    // best effort - the file may have been removed by another process.
  }
}
