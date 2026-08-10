/**
 * Standalone adapter for `IGatewayContext`.
 *
 * Implements the runtime-agnostic `IGatewayContext` interface for the
 * standalone CLI mode (no VS Code host). The standalone runtime is
 * intended to be launched as a background Node.js process - either by a
 * service manager (systemd, launchd, Task Scheduler), by the user from a
 * shell, or by an external OpenAI-compatible client (Kilo Code,
 * Continue, JetBrains AI Assistant, curl,...).
 *
 * Resolution of secrets (API keys):
 *   Delegated to the shared chain in `src/aiflowbridge/api-key-sources.ts`
 *   (same ordering as the VS Code extension gateway):
 *   1. Environment variable `AIFLOWBRIDGE_<VENDOR>_API_KEY` (read-only).
 *   2. JSON file at `<globalStorageDir>/secrets.json` (e.g.
 *      `~/.aiflowbridge/secrets.json`). Format:
 *      ```json
 *      {
 *        "deepseek.apiKey": "sk-...",
 *        "minimax.apiKey": "...",
 *        "xiaomi.apiKey": "..."
 *      }
 *      ```
 *      `store()` and `delete()` write through this file. Env vars are
 *      read-only.
 *   The file is re-read when its mtime changes, so external edits are
 *   picked up without a restart.
 *
 * Config hot-reload:
 *   `onConfigChange()` watches `<globalStorageDir>/config.json` via
 *   `fs.watch` and re-fires the callback on every change. On Windows
 *   `fs.watch` is less reliable - the adapter falls back to a 5s
 *   polling loop.
 *
 * Subscriptions:
 *   `subscriptions` is a plain `Disposable[]` array. The standalone
 *   process owns the loop lifetime directly (`process.on("SIGINT")`,
 *   `process.on("SIGTERM")`), so there is no host bag to mirror into.
 */

import { mkdirSync, statSync, unwatchFile, watch, watchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGatewaySecrets } from '../aiflowbridge/api-key-sources';
import type { ConfigReader, Disposable, FileSystemLike, IGatewayContext, UriLike } from '../aiflowbridge/types';
import { StandaloneConfigFile } from './config-loader';

const DEFAULT_POLLING_INTERVAL_MS = 5_000;

/**
 * Resolve the polling interval used by the config-file `fs.watchFile`
 * watchdog. Operators on slow disks (network mounts, WSL2, NFS-backed
 * containers) can raise the interval via the
 * `AIFLOWBRIDGE_CONFIG_WATCH_INTERVAL_MS` env var without a code
 * change. Out-of-range or non-numeric values fall back to the 5 s
 * default so a typo never silently disables the watcher.
 */
function resolveConfigWatchIntervalMs(): number {
  const raw = process.env.AIFLOWBRIDGE_CONFIG_WATCH_INTERVAL_MS;
  if (!raw) {
    return DEFAULT_POLLING_INTERVAL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 250) {
    // Below 250 ms the polling loop outpaces a slow disk's mtime
    // granularity and burns CPU for no benefit.
    return DEFAULT_POLLING_INTERVAL_MS;
  }
  return parsed;
}

interface StandaloneContextOptions {
  globalStorageDir: string;
  extensionVersion: string;
  /** Absolute path to the directory containing the bundled `resources/models.json`. */
  extensionRootPath: string;
}

class NodeFileSystem implements FileSystemLike {
  async readFile(uri: UriLike): Promise<Uint8Array> {
    const buffer = await readFile(uri.fsPath);
    return new Uint8Array(buffer);
  }
}

/**
 * Watch a file for changes. On platforms where `fs.watch` is unreliable
 * (Windows), fall back to `fs.watchFile` polling at `POLLING_INTERVAL_MS`.
 * Returns a Disposable that tears down both watchers on dispose.
 */
function watchConfigFile(path: string, onChange: () => void): Disposable {
  let disposed = false;
  let watcher: { close?: () => void } | undefined;

  try {
    watcher = watch(path, { persistent: false }, () => {
      if (!disposed) {
        onChange();
      }
    });
  } catch {
    // `fs.watch` can fail on some platforms (e.g. when the file does
    // not yet exist on Windows); fall through to the polling watcher.
  }

  // Watchdog: poll mtime at the resolved interval (default 5 s,
  // overridable via `AIFLOWBRIDGE_CONFIG_WATCH_INTERVAL_MS`) so we
  // never miss a write because of a platform-specific `fs.watch`
  // quirk. Operators on slow disks (NFS, WSL2) raise the interval to
  // keep the polling loop from outpacing mtime granularity.
  const pollingIntervalMs = resolveConfigWatchIntervalMs();
  let lastMtime = 0;
  try {
    lastMtime = statSync(path).mtimeMs;
  } catch {
    lastMtime = 0;
  }
  watchFile(path, { persistent: false, interval: pollingIntervalMs }, () => {
    if (disposed) {
      return;
    }
    let currentMtime = 0;
    try {
      currentMtime = statSync(path).mtimeMs;
    } catch {
      currentMtime = 0;
    }
    if (currentMtime !== lastMtime) {
      lastMtime = currentMtime;
      onChange();
    }
  });

  return {
    dispose: () => {
      disposed = true;
      try {
        watcher?.close?.();
      } catch {
        // ignore
      }
      try {
        unwatchFile(path);
      } catch {
        // ignore
      }
    },
  };
}

export async function createStandaloneContext(options: StandaloneContextOptions): Promise<IGatewayContext> {
  const { globalStorageDir, extensionVersion, extensionRootPath } = options;

  // Ensure the storage dir exists before anything tries to write into it.
  mkdirSync(globalStorageDir, { recursive: true });

  const secretsPath = join(globalStorageDir, 'secrets.json');
  const configPath = join(globalStorageDir, 'config.json');
  // Unified env -> secrets.json chain shared with the VS Code extension
  // gateway. `store()` / `delete()` write through the file (no host
  // fallback in standalone mode).
  const secrets = createGatewaySecrets({ secretsPath, logPrefix: '[Standalone]' });

  // Shared ConfigReader instance; the watcher calls `invalidate()` on
  // every config file change so the next `get()` re-reads the file.
  // Reuses the exported/tested `StandaloneConfigFile` (B-03) so the
  // bundled defaults from `DEFAULT_STANDALONE_CONFIG` apply in
  // standalone mode too.
  const configReader = new StandaloneConfigFile(configPath);
  const getConfiguration = (): ConfigReader => configReader;

  return {
    secrets,
    globalStorageDir,
    extensionVersion,
    subscriptions: [],
    onConfigChange: (cb: () => void): Disposable => {
      return watchConfigFile(configPath, () => {
        configReader.invalidate();
        cb();
      });
    },
    getConfiguration,
    // No UI hooks in standalone mode - the gateway logs to the channel.
    // The optional `registerCommand` / `showInformation` / `showWarning`
    // fields are intentionally left undefined.
    fs: new NodeFileSystem(),
    extensionUri: { fsPath: extensionRootPath },
  };
}
