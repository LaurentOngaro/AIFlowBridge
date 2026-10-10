/**
 * AIFlowBridge - local cleanup of the retired Google product OAuth secrets.
 *
 * The Antigravity / Cloud Code Assist transport is gone. Users who used it
 * still have a legacy `antigravity` slot in `<globalStorageDir>/secrets.json`
 * (standalone: `~/.aiflowbridge/secrets.json`) holding an access token, a
 * refresh token and the account email. This module removes that slot and
 * nothing else.
 *
 * Deliberate properties:
 *
 *   - **Local only.** No token and no refresh token is ever sent anywhere
 *     for revocation. Remote revocation is a separate operation that the
 *     user has to authorize explicitly; this helper does not perform it
 *     and does not imply it happened.
 *   - **Selective.** Only the AIFlowBridge-owned legacy slots are touched.
 *     Other vendors' keys and the Gemini BYOK API key survive untouched.
 *   - **Idempotent.** Calling it twice is a no-op the second time and
 *     reports `changed: false`.
 *   - **Permissions preserving.** The store keeps mode 0600; we never
 *     widen it, and a store that does not exist is left alone.
 *
 * Filesystem only, no `vscode` import, so both the extension and the
 * standalone CLI can call it.
 */

import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Legacy secret slots written by the retired transport. `antigravity` is
 * the canonical one; `googleaistudio` is the older pre-2.17 alias that
 * could hold the same JSON blob. Both are matched by SHAPE as well as by
 * key: a `googleaistudio` slot holding a plain API-key string belongs to
 * the supported BYOK route and must survive.
 */
const LEGACY_SLOT_KEYS: readonly string[] = Object.freeze(['antigravity']);

/** Shape of a stored OAuth blob: an object carrying a refresh token. */
function looksLikeRetiredOAuthBlob(value: unknown): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trimStart();
    if (!trimmed.startsWith('{')) {
      return false;
    }
    try {
      return looksLikeRetiredOAuthBlob(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.refreshToken === 'string' || (typeof record.accessToken === 'string' && typeof record.expiresAt === 'number');
}

export interface PurgeRetiredGoogleSecretsResult {
  /** True when at least one slot was removed and the file was rewritten. */
  readonly changed: boolean;
  /** Absolute path of the secrets file, whether or not it exists. */
  readonly filePath: string;
  /** True when the file existed and was readable at all. */
  readonly fileExisted: boolean;
}

/**
 * Remove the retired Google product OAuth slots from the shared secrets
 * store. Never throws: a read-only or corrupt store is reported as
 * `changed: false` so the caller can log and move on.
 */
export function purgeRetiredGoogleOAuthSecrets(storageDirOrFilePath: string): PurgeRetiredGoogleSecretsResult {
  const filePath = storageDirOrFilePath.endsWith('.json') ? storageDirOrFilePath : join(storageDirOrFilePath, 'secrets.json');
  const fileExisted = existsSync(filePath);
  if (!fileExisted) {
    return { changed: false, filePath, fileExisted };
  }

  let secrets: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { changed: false, filePath, fileExisted };
    }
    secrets = parsed as Record<string, unknown>;
  } catch {
    // Corrupt store: leaving it alone is safer than rewriting it.
    return { changed: false, filePath, fileExisted };
  }

  let changed = false;
  for (const key of LEGACY_SLOT_KEYS) {
    if (key in secrets) {
      delete secrets[key];
      changed = true;
    }
  }
  // Pre-2.17 alias: only remove the `googleaistudio` slot when it holds
  // an OAuth blob, never when it holds the BYOK API-key string.
  if (looksLikeRetiredOAuthBlob(secrets['googleaistudio'])) {
    delete secrets['googleaistudio'];
    changed = true;
  }

  if (!changed) {
    return { changed: false, filePath, fileExisted };
  }

  try {
    const mode = statSync(filePath).mode & 0o777;
    const tmpPath = `${filePath}.purge-${process.pid}`;
    writeFileSync(tmpPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode });
    try {
      chmodSync(tmpPath, mode);
    } catch {
      // ignore on platforms without POSIX modes (Windows)
    }
    renameSync(tmpPath, filePath);
  } catch {
    return { changed: false, filePath, fileExisted };
  }

  return { changed: true, filePath, fileExisted };
}

/**
 * Describe what the purge would touch, without writing. Used by the
 * `Disconnect from Google AI Studio` command to tell the user whether
 * there is anything to clear.
 */
export function hasRetiredGoogleOAuthSecrets(storageDirOrFilePath: string): boolean {
  const filePath = storageDirOrFilePath.endsWith('.json') ? storageDirOrFilePath : join(storageDirOrFilePath, 'secrets.json');
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const secrets = parsed as Record<string, unknown>;
    if (LEGACY_SLOT_KEYS.some((key) => key in secrets)) {
      return true;
    }
    return looksLikeRetiredOAuthBlob(secrets['googleaistudio']);
  } catch {
    return false;
  }
}

/** Absolute path the purge operates on, for log lines. */
export function retiredGoogleSecretsPath(storageDirOrFilePath: string): string {
  return storageDirOrFilePath.endsWith('.json') ? storageDirOrFilePath : join(storageDirOrFilePath, 'secrets.json');
}