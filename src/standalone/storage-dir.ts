/**
 * Storage directory resolution for the standalone server.
 *
 * The standalone `aiflowbridge-server` CLI and the VS Code extension
 * must share the same on-disk state (telemetry, secrets, ...). The VS
 * Code extension reads `<globalStorageUri>/...` which on this machine is
 * `C:\Users\<user>\AppData\Roaming\Code\User\globalStorage\LaurentOngaro.aiflowbridge\`
 * (Windows) / `~/.config/Code/User/globalStorage/...` (Linux) /
 * `~/Library/Application Support/Code/User/globalStorage/...` (macOS).
 *
 * If the standalone server defaults to `~/.aiflowbridge/` instead of
 * detecting the VS Code ext's path, the dashboard (which always reads
 * from the extension's path) goes stale: requests are processed by the
 * standalone gateway and its telemetry is recorded on disk, but the
 * VS Code dashboard reads a different file and shows no new entries.
 *
 * Resolution order in `resolveStorageDir`:
 *   1. `AIFLOWBRIDGE_DATA_DIR` env var (operator override, always wins).
 *   2. VS Code extension's `globalStorageUri` when it exists on this
 *      machine. Keeps telemetry and secrets shared between the VS Code
 *      dashboard and the standalone gateway.
 *   3. Legacy `~/.aiflowbridge/` fallback for headless machines where
 *      the VS Code extension is not installed.
 */

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_STORAGE_DIRNAME = '.aiflowbridge';
export const EXTENSION_PUBLISHER = 'LaurentOngaro';
export const EXTENSION_NAME = 'aiflowbridge';

/**
 * Resolve the VS Code extension's `globalStorageUri` for the
 * `LaurentOngaro.aiflowbridge` extension on this machine. Returns
 * `undefined` if VS Code's user data directory cannot be located or
 * the extension is not installed.
 *
 * Cross-platform paths:
 * - Windows: `%APPDATA%\Code\User\globalStorage\<publisher>.<name>`
 * - macOS:   `~/Library/Application Support/Code/User/globalStorage/<publisher>.<name>`
 * - Linux:   `$XDG_CONFIG_HOME/Code/User/globalStorage/<publisher>.<name>` (fallback `~/.config`)
 */
export function resolveExtensionGlobalStorageDir(): string | undefined {
  let base: string;
  switch (platform()) {
    case 'win32': {
      const appData = process.env.APPDATA;
      if (!appData) return undefined;
      base = join(appData, 'Code', 'User', 'globalStorage');
      break;
    }
    case 'darwin': {
      base = join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
      break;
    }
    default: {
      // Linux and any other Unix-like. Respect XDG_CONFIG_HOME per the
      // XDG Base Directory spec - VS Code on Linux honors it.
      const xdgConfig = process.env.XDG_CONFIG_HOME;
      base = xdgConfig ? join(xdgConfig, 'Code', 'User', 'globalStorage') : join(homedir(), '.config', 'Code', 'User', 'globalStorage');
      break;
    }
  }
  const candidate = join(base, `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`);
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Resolve the storage directory the standalone server should use.
 * See the module-level docs for the precedence rules.
 */
export function resolveStorageDir(): string {
  // 1. Explicit env var always wins (operator override).
  const fromEnv = process.env.AIFLOWBRIDGE_DATA_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  // 2. Share the VS Code extension's globalStorageUri when the
  // extension is installed on this machine. This keeps telemetry
  // (and any other file-based state) consistent between the VS Code
  // dashboard and the standalone gateway.
  const fromExtension = resolveExtensionGlobalStorageDir();
  if (fromExtension) {
    return fromExtension;
  }
  // 3. Last resort: the legacy `~/.aiflowbridge/` directory. Used
  // on machines where the VS Code extension is NOT installed but
  // the standalone server runs anyway (CI, headless dev, user
  // disabled the extension).
  return join(homedir(), DEFAULT_STORAGE_DIRNAME);
}
