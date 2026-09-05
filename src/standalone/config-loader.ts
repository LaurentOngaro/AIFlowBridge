/**
 * Standalone configuration loader.
 *
 * Reads `<globalStorageDir>/config.json` (default: `~/.aiflowbridge/config.json`)
 * and exposes a typed reader that the standalone `IGatewayContext`
 * implementation can wire into `getConfiguration()`.
 *
 * The format is identical to the VS Code settings (section
 * `aiflowbridge`). The file is OPTIONAL: when it is missing or invalid
 * the loader logs a warning and returns sensible defaults so the
 * gateway can still start.
 *
 * See `docs/standalone-config.example.json` for the full set of
 * supported keys.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigReader } from '../aiflowbridge/types';
import { logger } from '../logger';
import { getNestedValue } from './util';

/**
 * Default configuration values, applied when the file is absent or
 * when a key is missing. Mirrors the `default` values declared in
 * `package.json#contributes.configuration.properties`.
 */
export const DEFAULT_STANDALONE_CONFIG: Record<string, unknown> = {
  'gateway.enabled': true,
  'gateway.port': 8787,
  'gateway.baseUrl': 'http://127.0.0.1:8787/v1',
  'gateway.defaultModel': '',
  'telemetry.enabled': true,
  'telemetry.logRequests': true,
  'vision.excludedVendors': ['aiflowbridge'],
  'vision.copilotVisionModel': 'oswe-vscode-prime',
  providers: [],
  'providers.deepseek.baseUrl': 'https://api.deepseek.com',
  'providers.minimax.baseUrl': 'https://api.minimax.io/v1',
  'providers.xiaomi.baseUrl': 'https://api.xiaomimimo.com/v1',
  'providers.googleaistudio.baseUrl': 'https://cloudcode-pa.googleapis.com',
  'providers.deepseek.maxTokens': 0,
  'providers.minimax.maxTokens': 0,
  'providers.xiaomi.maxTokens': 0,
  'providers.googleaistudio.maxTokens': 0,
};

/**
 * File-backed `ConfigReader`. Each call to `get()` re-reads the file
 * when the cache is invalidated (the watcher in
 * `src/standalone/context.ts` calls `invalidate()` on every change).
 */
export class StandaloneConfigFile implements ConfigReader {
  private cached: Record<string, unknown> | undefined;

  constructor(private readonly configPath: string) {}

  get<T>(key: string, fallback?: T): T {
    if (this.cached === undefined) {
      this.cached = loadFromDisk(this.configPath);
    }
    const value = getNestedValue(this.cached, key);
    if (value === undefined || value === null) {
      // Fall back to the bundled default for the key (if any), then to
      // the caller-supplied fallback.
      const defaultValue = DEFAULT_STANDALONE_CONFIG[key];
      if (defaultValue !== undefined) {
        return defaultValue as T;
      }
      return fallback as T;
    }
    return value as T;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

function loadFromDisk(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    logger.info(`[Standalone] No config file at ${path}; using bundled defaults.`);
    return {};
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    logger.warn(`[Standalone] Config file at ${path} is not a JSON object, using defaults.`);
    return {};
  } catch (error) {
    logger.warn(`[Standalone] Failed to parse config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/**
 * Return the conventional path for the standalone config file, given
 * a storage dir.
 */
export function defaultStandaloneConfigPath(globalStorageDir: string): string {
  return join(globalStorageDir, 'config.json');
}
