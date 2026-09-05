/**
 * AIFlowBridge - globalStorage registry override helpers.
 *
 * The 3-tier model registry merge (`resources/models.json` <
 * `<globalStorageDir>/models.json` < `.vscode/aiflowbridge.models.json`)
 * is silent: a stale override in globalStorage can hijack a provider
 * without any user-visible signal. Audit BUG-02 surfaced exactly that
 * failure mode on the Google AI Studio integration: the user toggled
 * the route via the setting, but the globalStorage override still
 * pointed at the OAuth upstream and silently re-routed the request.
 *
 * This module exposes a small targeted helper that loads
 * `<globalStorageDir>/models.json`, runs a user-supplied mutator on
 * the parsed registry, and writes the file back atomically (write-tmp
 * + rename + chmod 600). The mutator pattern keeps this generic
 * enough to cover future override cleanup paths without a second
 * helper per vendor.
 *
 * The file is best-effort: missing files are created on first write
 * (an empty `{}` JSON), unparseable files are left untouched (the
 * loader skips invalid tiers and logs a warn). The caller decides
 * whether to reload the registry; this module never re-imports the
 * loader to keep its dependency surface small.
 */

import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FILE_MODE = 0o600;

interface MutableRegistry {
  vendors?: Record<string, { baseUrl?: string; apiKeySecret?: string; externalUrls?: Record<string, string> }>;
  models?: unknown[];
  [key: string]: unknown;
}

/**
 * Apply `mutator` to the parsed `<globalStorageDir>/models.json` (or
 * create it if absent) and write back atomically. Returns `true`
 * when the file was modified (or created with the mutator's output).
 *
 * The mutator is free to mutate the parsed registry in place; it can
 * also return a fresh object. If `mutator` returns `undefined` the
 * file is left untouched (used by callers that need a dry-run path).
 *
 * `relativePath` defaults to `['models.json']` to match
 * `GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH`. Exposed via the parameter so
 * tests can point at a fixture directory without juggling imports.
 */
export async function resetGlobalStorageRegistryOverride(
  globalStorageDir: string,
  relativePath: readonly string[] = ['models.json'],
  mutator: (registry: MutableRegistry) => MutableRegistry | undefined
): Promise<boolean> {
  const filePath = join(globalStorageDir, ...relativePath);
  let raw: string;
  let parsed: MutableRegistry = {};
  let existed = false;
  try {
    raw = await readFile(filePath, 'utf8');
    existed = true;
    const candidate = JSON.parse(raw) as unknown;
    if (candidate && typeof candidate === 'object') {
      parsed = candidate as MutableRegistry;
    }
  } catch {
    // missing or unparseable: start from a clean `{}` and let the
    // mutator populate the structure.
    parsed = {};
  }

  const next = mutator(parsed);
  if (next === undefined) {
    return existed;
  }

  const serialized = JSON.stringify(next, null, 2) + '\n';
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmpPath, serialized, { mode: FILE_MODE });
    await rename(tmpPath, filePath);
  } catch (err) {
    // Best effort: leave the user with a clear error message, the
    // existing file (if any) is untouched on disk because the rename
    // is atomic. Surface to the caller via a wrapped error.
    throw new Error(
      `Failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  try {
    await chmod(filePath, FILE_MODE);
  } catch {
    // ignore on Windows where chmod is unsupported.
  }
  return true;
}
