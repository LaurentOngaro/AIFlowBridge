/**
 * Unified API key resolution for the gateway.
 *
 * Both hosts (VS Code extension and standalone CLI) resolve upstream API
 * keys through the same ordered chain, so a key configured once works
 * identically everywhere:
 *
 *   1. Environment variable `AIFLOWBRIDGE_<VENDOR>_API_KEY` (highest
 *      priority, read on every lookup so a `dotenv` loaded after startup
 *      is picked up). The bare `<VENDOR>_API_KEY` name is accepted at
 *      the same priority as a fallback, so an environment that already
 *      exports vendor keys under their short names works unchanged. The
 *      bare name is discovered by scanning the environment against the
 *      vendors declared in `API_KEY_SECRETS`, so a vendor added there
 *      is wired with no further declaration. The canonical
 *      `AIFLOWBRIDGE_` name wins when both are set.
 *   2. `secrets.json` file in the storage dir
 *      (`<globalStorageDir>/secrets.json`). Short-form keys documented in
 *      `docs/standalone.md` (`"minimax.apiKey"`) are mirrored to the
 *      full-prefix form (`"aiflowbridge.providers.minimax.apiKey"`) at
 *      load time so either format works; when both are present the full
 *      form wins (deterministic). The file is re-read when its mtime
 *      changes, so an external edit is picked up without a restart.
 *   3. Host fallback: VS Code `SecretStorage` in the extension (the
 *      target of the "Set API Key" commands), or the standalone's own
 *      store.
 *
 * Writes (`store()` / `delete()`) always go to the host fallback so the
 * "Set API Key" command keeps writing into the OS keychain on VS Code
 * and into `secrets.json` on the standalone.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { API_KEY_SECRETS } from '../consts';
import { logger } from '../logger';
import type { SecretStorageLike } from './types';

/** Map full-prefix secret keys (see `API_KEY_SECRETS` in `src/consts.ts`) to their env var name. */
export const SECRET_KEY_TO_ENV_NAME: Readonly<Record<string, string>> = {
  'aiflowbridge.providers.deepseek.apiKey': 'AIFLOWBRIDGE_DEEPSEEK_API_KEY',
  'aiflowbridge.providers.minimax.apiKey': 'AIFLOWBRIDGE_MINIMAX_API_KEY',
  'aiflowbridge.providers.xiaomi.apiKey': 'AIFLOWBRIDGE_XIAOMI_API_KEY',
  'aiflowbridge.providers.openrouter.apiKey': 'AIFLOWBRIDGE_OPENROUTER_API_KEY',
  // The Google AI Studio BYOK API key is independent from the Antigravity
  // OAuth tokens (which live in a different `secrets.json` slot and are
  // managed by `AntigravityTokenManager`). Audit BUG-07: this entry was
  // missing, so `AIFLOWBRIDGE_GOOGLEAISTUDIO_API_KEY` was silently ignored.
  'aiflowbridge.providers.googleaistudio.apiKey': 'AIFLOWBRIDGE_GOOGLEAISTUDIO_API_KEY',
  'aiflowbridge.providers.zai.apiKey': 'AIFLOWBRIDGE_ZAI_API_KEY',
  'aiflowbridge.providers.moonshot.apiKey': 'AIFLOWBRIDGE_MOONSHOT_API_KEY',
};

/** Prefix carried by every canonical env var name in `SECRET_KEY_TO_ENV_NAME`. */
export const ENV_NAME_PREFIX = 'AIFLOWBRIDGE_';

/** Suffix a bare vendor env var name must carry to be picked up. */
export const BARE_ENV_SUFFIX = '_API_KEY';

/**
 * `<VENDOR>_API_KEY` -> secret key, built from `API_KEY_SECRETS` so a
 * vendor added there is detected with no extra declaration. This is the
 * source of truth for the bare-name scan; `SECRET_KEY_TO_ENV_NAME` only
 * drives the canonical prefixed name.
 */
const BARE_ENV_TO_SECRET_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(API_KEY_SECRETS).map(([vendor, secretKey]) => [
    `${vendor.toUpperCase()}${BARE_ENV_SUFFIX}`,
    secretKey,
  ])
);

/** Env var name for a secret key, or `undefined` when the key has no env mapping. */
export function envNameForSecretKey(key: string): string | undefined {
  return SECRET_KEY_TO_ENV_NAME[key];
}

/**
 * The `<VENDOR>_API_KEY` name a secret key would be read from, derived
 * from the canonical name by stripping the `AIFLOWBRIDGE_` prefix
 * (`AIFLOWBRIDGE_XIAOMI_API_KEY` -> `XIAOMI_API_KEY`). Pure and O(1);
 * whether it is actually set is confirmed by
 * `findBareEnvNameForSecretKey`.
 */
export function envAliasForSecretKey(key: string): string | undefined {
  const canonical = SECRET_KEY_TO_ENV_NAME[key];
  if (!canonical || !canonical.startsWith(ENV_NAME_PREFIX)) {
    return undefined;
  }
  const alias = canonical.slice(ENV_NAME_PREFIX.length);
  return alias.toUpperCase().endsWith(BARE_ENV_SUFFIX) ? alias : undefined;
}

/**
 * The `<VENDOR>_API_KEY` name for a declared vendor, or `undefined` when
 * the vendor has no API-key slot (OAuth-only vendors are absent from
 * `API_KEY_SECRETS` by design).
 *
 * Exposed so the coverage of the bare-name lookup can be asserted over
 * `API_KEY_SECRETS` itself: a vendor added there gets a working
 * `<VENDOR>_API_KEY` name with no second declaration, and the check
 * fails loudly if that ever stops being true.
 */
export function bareEnvNameForVendor(vendor: string): string | undefined {
  const name = `${vendor.toUpperCase()}${BARE_ENV_SUFFIX}`;
  return BARE_ENV_TO_SECRET_KEY.has(name) ? name : undefined;
}

/**
 * Scan the environment for a `<VENDOR>_API_KEY` variable that resolves
 * to this secret key.
 *
 * A candidate is accepted only when its name is exactly
 * `<VENDOR>_API_KEY` (compared case-insensitively, because Windows env
 * names are case-insensitive) for a vendor declared in
 * `API_KEY_SECRETS`. Anything else is ignored, which is what keeps
 * unrelated variables out: `AIFLOWBRIDGE_DEEPSEEK_API_KEY` maps to the
 * vendor token `AIFLOWBRIDGE_DEEPSEEK` (undeclared) and `FOO_API_KEY`
 * maps to `FOO` (undeclared), so neither is ever read as a bare
 * DeepSeek key.
 *
 * Returns the first match in sorted order so the result never depends
 * on the iteration order of the environment object.
 */
export function findBareEnvNameForSecretKey(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (BARE_ENV_TO_SECRET_KEY.size === 0) {
    return undefined;
  }
  const matches: string[] = [];
  for (const name of Object.keys(env)) {
    if (name.length <= BARE_ENV_SUFFIX.length) {
      continue;
    }
    if (!name.toUpperCase().endsWith(BARE_ENV_SUFFIX)) {
      continue;
    }
    if (BARE_ENV_TO_SECRET_KEY.get(name.toUpperCase()) === key) {
      matches.push(name);
    }
  }
  return matches.length > 0 ? matches.sort()[0] : undefined;
}

/**
 * Names reachable without scanning the environment: the canonical
 * prefixed name and the alias derived from it.
 */
function declaredEnvNamesForSecretKey(key: string): string[] {
  const names: string[] = [];
  for (const candidate of [envNameForSecretKey(key), envAliasForSecretKey(key)]) {
    if (candidate && !names.includes(candidate)) {
      names.push(candidate);
    }
  }
  return names;
}

/**
 * Ordered env var candidates for a secret key: the canonical
 * `AIFLOWBRIDGE_*` name first, then its bare `<VENDOR>_API_KEY` name.
 * Both are read at the same priority (env is source 1 of the chain);
 * the canonical name wins when both are set, so no existing
 * configuration changes behaviour.
 *
 * The bare name is looked up in the environment on every call, so a
 * `dotenv` loaded after startup is still picked up.
 */
export function envNamesForSecretKey(key: string, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const names = declaredEnvNamesForSecretKey(key);
  const scanned = findBareEnvNameForSecretKey(key, env);
  if (scanned && !names.includes(scanned)) {
    names.push(scanned);
  }
  return names;
}

/**
 * Map short-form secret keys (as documented in `docs/standalone.md`) to
 * the full-prefix form expected by `API_KEY_SECRETS` in `src/consts.ts`.
 * Both forms are accepted in `secrets.json`; the short form is a
 * documentation aid, not a runtime lookup key.
 */
const SECRET_SHORT_TO_FULL: Readonly<Record<string, string>> = {
  'deepseek.apiKey': 'aiflowbridge.providers.deepseek.apiKey',
  'minimax.apiKey': 'aiflowbridge.providers.minimax.apiKey',
  'xiaomi.apiKey': 'aiflowbridge.providers.xiaomi.apiKey',
  'openrouter.apiKey': 'aiflowbridge.providers.openrouter.apiKey',
  'googleaistudio.apiKey': 'aiflowbridge.providers.googleaistudio.apiKey',
  'zai.apiKey': 'aiflowbridge.providers.zai.apiKey',
  'moonshot.apiKey': 'aiflowbridge.providers.moonshot.apiKey',
};

/**
 * Normalize a parsed `secrets.json` payload: keep only non-empty string
 * values and mirror short-form keys to the full-prefix form. Pure
 * function, unit-tested in isolation.
 */
export function normalizeSecretsObject(parsed: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!parsed || typeof parsed !== 'object') {
    return result;
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    result[key] = value;
    const fullKey = SECRET_SHORT_TO_FULL[key];
    if (fullKey && !result[fullKey]) {
      result[fullKey] = value;
    }
  }
  return result;
}

function readSecretsFile(path: string, logPrefix: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, 'utf8');
    return normalizeSecretsObject(JSON.parse(raw) as unknown);
  } catch (error) {
    logger.warn(`${logPrefix} Failed to read secrets at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function writeSecretsFile(path: string, secrets: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  // Best-effort chmod on POSIX; Windows ignores the mode bit.
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore
  }
}

/**
 * A key source that can describe itself for the startup log. The
 * description names where the value was found (env var name, file path,
 * or host storage label) and never contains the key value itself.
 */
export interface ApiKeySourceLike extends SecretStorageLike {
  describe(key: string): string;
}

/** Read-only source backed by the `AIFLOWBRIDGE_<VENDOR>_API_KEY` env vars and their bare `<VENDOR>_API_KEY` names. */
export class EnvSecretStorage implements ApiKeySourceLike {
  async get(key: string): Promise<string | undefined> {
    // The declared names are tried first so the environment scan only
    // runs for a vendor that is not already set under its prefixed
    // name. The scan stays a last resort rather than a cached index on
    // purpose: a `dotenv` loaded after startup must still be seen.
    for (const envName of declaredEnvNamesForSecretKey(key)) {
      const value = process.env[envName];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    const scanned = findBareEnvNameForSecretKey(key);
    if (scanned) {
      const value = process.env[scanned];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
  }

  async store(_key: string, _value: string): Promise<void> {
    // Environment variables are a read-only source. Writes go to the
    // composite's write target (secrets.json on standalone, VS Code
    // SecretStorage in the extension).
  }

  async delete(_key: string): Promise<void> {
    // Read-only source, see `store()`.
  }

  describe(key: string): string {
    const names = envNamesForSecretKey(key);
    if (names.length === 0) {
      return 'unknown';
    }
    // Name the candidate that actually answers, so the startup log points
    // at the variable the operator really set.
    const active = names.find((name) => (process.env[name] ?? '').length > 0);
    return `Env (${active ?? names[0]})`;
  }
}

/** File-backed source (`<globalStorageDir>/secrets.json`, chmod 600). */
export class FileSecretStorage implements ApiKeySourceLike {
  private cached: Record<string, string> = {};
  private lastMtimeMs = -1;

  constructor(
    private readonly filePath: string,
    private readonly logPrefix = '[AIFlowBridge]'
  ) {
    this.reload();
    this.lastMtimeMs = this.currentMtimeMs();
  }

  get path(): string {
    return this.filePath;
  }

  async get(key: string): Promise<string | undefined> {
    this.reloadIfChanged();
    return this.cached[key];
  }

  async store(key: string, value: string): Promise<void> {
    this.cached[key] = value;
    writeSecretsFile(this.filePath, this.cached);
  }

  async delete(key: string): Promise<void> {
    delete this.cached[key];
    writeSecretsFile(this.filePath, this.cached);
  }

  describe(): string {
    return `file ${this.filePath}`;
  }

  private currentMtimeMs(): number {
    try {
      return statSync(this.filePath).mtimeMs;
    } catch {
      return -1;
    }
  }

  /**
   * Re-read the file only when its mtime changed. The stat is a local
   * syscall (~microseconds) compared to the upstream network round-trip
   * that follows, so the freshness check is free in practice and lets an
   * external edit (or a peer standalone process writing the shared file)
   * take effect without a restart.
   */
  private reloadIfChanged(): void {
    const mtimeMs = this.currentMtimeMs();
    if (mtimeMs !== this.lastMtimeMs) {
      this.lastMtimeMs = mtimeMs;
      this.reload();
    }
  }

  private reload(): void {
    this.cached = readSecretsFile(this.filePath, this.logPrefix);
  }
}

/** Labeled wrapper around a host storage used as the last-chance source. */
export class FallbackSecretStorage implements ApiKeySourceLike {
  constructor(
    private readonly label: string,
    private readonly inner: SecretStorageLike
  ) {}

  async get(key: string): Promise<string | undefined> {
    return this.inner.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    await this.inner.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.inner.delete(key);
  }

  describe(): string {
    return this.label;
  }
}

/**
 * Ordered key chain. `get()` returns the first non-empty value across
 * the sources; `store()` / `delete()` delegate to the write target
 * (the host fallback when provided, otherwise the last source).
 */
export class CompositeSecretStorage implements SecretStorageLike {
  readonly sources: readonly ApiKeySourceLike[];
  private readonly writeSource: SecretStorageLike;

  constructor(sources: readonly ApiKeySourceLike[], writeSource?: SecretStorageLike) {
    if (sources.length === 0) {
      throw new Error('CompositeSecretStorage requires at least one source');
    }
    this.sources = sources;
    this.writeSource = writeSource ?? sources[sources.length - 1];
  }

  async get(key: string): Promise<string | undefined> {
    for (const source of this.sources) {
      // A source that fails (e.g. a locked OS keyring rejecting a read)
      // must not kill the whole chain - skip it and try the next one.
      try {
        const value = await source.get(key);
        if (typeof value === 'string' && value.length > 0) {
          return value;
        }
      } catch {
        // Ignore and fall through to the next source.
      }
    }
    return undefined;
  }

  async store(key: string, value: string): Promise<void> {
    await this.writeSource.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.writeSource.delete(key);
  }
}

export interface GatewaySecretsOptions {
  /** Absolute path of the `secrets.json` file (storage dir + `secrets.json`). */
  secretsPath: string;
  /** Optional host storage (VS Code `SecretStorage`). When absent the file is the write target. */
  fallback?: SecretStorageLike;
  /** Label used in startup logs for the host storage (e.g. `SecretStorage (VS Code)`). */
  fallbackLabel?: string;
  /** Prefix for file read/write warnings (`[AIFlowBridge]` or `[Standalone]`). */
  logPrefix?: string;
}

/**
 * Build the unified gateway key chain: env var -> secrets.json -> host
 * fallback (when provided). Writes go to the host fallback when present
 * (VS Code keeps using the OS keychain), otherwise to the file
 * (standalone).
 */
export function createGatewaySecrets(options: GatewaySecretsOptions): CompositeSecretStorage {
  const file = new FileSecretStorage(options.secretsPath, options.logPrefix);
  const sources: ApiKeySourceLike[] = [new EnvSecretStorage(), file];
  let writeSource: SecretStorageLike = file;
  if (options.fallback) {
    sources.push(new FallbackSecretStorage(options.fallbackLabel ?? 'SecretStorage', options.fallback));
    writeSource = options.fallback;
  }
  return new CompositeSecretStorage(sources, writeSource);
}

/**
 * Describe where a secret key is currently found, for the startup log.
 * The returned string names the source (env var name, file path, or
 * host label) and never contains the key value. Falls back to a plain
 * `SecretStorage` check when the storage is not a
 * `CompositeSecretStorage`.
 */
export async function describeApiKeySource(secretKey: string, secrets: SecretStorageLike): Promise<string> {
  if (secrets instanceof CompositeSecretStorage) {
    for (const source of secrets.sources) {
      // A rejecting source (locked OS keyring) must not break the
      // startup log - skip it and report the next source that answers.
      try {
        const value = await source.get(secretKey);
        if (typeof value === 'string' && value.length > 0) {
          return source.describe(secretKey);
        }
      } catch {
        // Ignore and fall through to the next source.
      }
    }
    return 'not configured';
  }
  try {
    const value = await secrets.get(secretKey);
    return typeof value === 'string' && value.length > 0 ? 'SecretStorage' : 'not configured';
  } catch {
    // A rejecting storage reads as "not configured" rather than
    // breaking the activation flow.
    return 'not configured';
  }
}
