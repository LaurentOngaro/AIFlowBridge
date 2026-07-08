/**
 * Standalone adapter for `IGatewayContext` (FEAT7).
 *
 * Implements the runtime-agnostic `IGatewayContext` interface for the
 * standalone CLI mode (no VS Code host). The standalone runtime is
 * intended to be launched as a background Node.js process - either by a
 * service manager (systemd, launchd, Task Scheduler), by the user from a
 * shell, or by an external OpenAI-compatible client (Kilo Code,
 * Continue, JetBrains AI Assistant, curl, ...).
 *
 * Resolution of secrets (API keys):
 *   1. Environment variables `AIFLOWBRIDGE_<VENDOR>_API_KEY`
 *      (e.g. `AIFLOWBRIDGE_DEEPSEEK_API_KEY`, `AIFLOWBRIDGE_MINIMAX_API_KEY`,
 *      `AIFLOWBRIDGE_XIAOMI_API_KEY`).
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

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unwatchFile, watch, watchFile, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConfigReader,
  Disposable,
  FileSystemLike,
  IGatewayContext,
  SecretStorageLike,
  UriLike,
} from "../aiflowbridge/types";
import { logger } from "../logger";
import { StandaloneConfigFile } from "./config-loader";

const POLLING_INTERVAL_MS = 5_000;

/** Map our standalone secret keys to environment variable names. */
const SECRET_TO_ENV: Record<string, string> = {
  "aiflowbridge.providers.deepseek.apiKey": "AIFLOWBRIDGE_DEEPSEEK_API_KEY",
  "aiflowbridge.providers.minimax.apiKey": "AIFLOWBRIDGE_MINIMAX_API_KEY",
  "aiflowbridge.providers.xiaomi.apiKey": "AIFLOWBRIDGE_XIAOMI_API_KEY",
};

interface StandaloneContextOptions {
  globalStorageDir: string;
  extensionVersion: string;
  /** Absolute path to the directory containing the bundled `resources/models.json`. */
  extensionRootPath: string;
}

/**
 * Mutable cache of the on-disk secrets. We read it once at construction
 * and refresh on every `store()` / `delete()` to keep the in-memory
 * view in sync. Env vars are read on every `get()` because the env can
 * change at runtime (e.g. `dotenv` loaded after the process started).
 */
class StandaloneSecretStorage implements SecretStorageLike {
  private readonly secretsPath: string;
  private cached: Record<string, string>;

  constructor(secretsPath: string) {
    this.secretsPath = secretsPath;
    this.cached = readSecretsFile(secretsPath);
  }

  async get(key: string): Promise<string | undefined> {
    const envName = SECRET_TO_ENV[key];
    if (envName) {
      const fromEnv = process.env[envName];
      if (typeof fromEnv === "string" && fromEnv.length > 0) {
        return fromEnv;
      }
    }
    return this.cached[key];
  }

  async store(key: string, value: string): Promise<void> {
    this.cached[key] = value;
    writeSecretsFile(this.secretsPath, this.cached);
  }

  async delete(key: string): Promise<void> {
    delete this.cached[key];
    writeSecretsFile(this.secretsPath, this.cached);
  }
}

function readSecretsFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string" && value.length > 0) {
          result[key] = value;
        }
      }
      return result;
    }
    return {};
  } catch (error) {
    logger.warn(`[Standalone] Failed to read secrets at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function writeSecretsFile(path: string, secrets: Record<string, string>): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  // Best-effort chmod on POSIX; Windows ignores the mode bit.
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore
  }
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

  // Watchdog: poll mtime every 5s so we never miss a write because of a
  // platform-specific `fs.watch` quirk.
  let lastMtime = 0;
  try {
    lastMtime = statSync(path).mtimeMs;
  } catch {
    lastMtime = 0;
  }
  watchFile(path, { persistent: false, interval: POLLING_INTERVAL_MS }, () => {
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

  const secretsPath = join(globalStorageDir, "secrets.json");
  const configPath = join(globalStorageDir, "config.json");
  const secrets = new StandaloneSecretStorage(secretsPath);

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