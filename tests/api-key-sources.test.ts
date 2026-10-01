/**
 * Unit tests for src/aiflowbridge/api-key-sources.ts.
 *
 * Covers the unified gateway key chain (env var -> secrets.json -> host
 * fallback): priority ordering, short-form normalization, writes, mtime
 * hot-reload, and the startup source description used by the
 * initialization log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the `vscode` module so the transitive import chain
// (`aiflowbridge/...` -> `src/logger.ts` -> `vscode`) does not blow up
// under vitest.
vi.mock('vscode', () => {
  const stubChannel = {
    name: 'mock',
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
    append: () => undefined,
    appendLine: () => undefined,
    hide: () => undefined,
    clear: () => undefined,
  };
  return {
    default: {
      window: { createOutputChannel: () => stubChannel },
    },
    window: { createOutputChannel: () => stubChannel },
  };
});

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bareEnvNameForVendor,
  CompositeSecretStorage,
  createGatewaySecrets,
  describeApiKeySource,
  ENV_NAME_PREFIX,
  envAliasForSecretKey,
  envNameForSecretKey,
  envNamesForSecretKey,
  EnvSecretStorage,
  FallbackSecretStorage,
  FileSecretStorage,
  findBareEnvNameForSecretKey,
  normalizeSecretsObject,
} from '../src/aiflowbridge/api-key-sources';
import { API_KEY_SECRETS } from '../src/consts';
import type { SecretStorageLike } from '../src/aiflowbridge/types';

const DEEPSEEK_FULL = 'aiflowbridge.providers.deepseek.apiKey';
const MINIMAX_FULL = 'aiflowbridge.providers.minimax.apiKey';
const OPENROUTER_FULL = 'aiflowbridge.providers.openrouter.apiKey';

/** Every vendor secret key under test, canonical form. */
const ALL_VENDOR_KEYS = [
  DEEPSEEK_FULL,
  MINIMAX_FULL,
  'aiflowbridge.providers.xiaomi.apiKey',
  OPENROUTER_FULL,
  'aiflowbridge.providers.googleaistudio.apiKey',
  'aiflowbridge.providers.zai.apiKey',
  'aiflowbridge.providers.moonshot.apiKey',
] as const;

function makeFallback(initial?: Record<string, string>): SecretStorageLike & { stored: Record<string, string> } {
  const stored: Record<string, string> = { ...initial };
  return {
    stored,
    get: async (key: string) => stored[key],
    store: async (key: string, value: string) => {
      stored[key] = value;
    },
    delete: async (key: string) => {
      delete stored[key];
    },
  };
}

let tempDir: string;
let envBackup: NodeJS.ProcessEnv;

/**
 * Every env var name the key chain can read: the canonical prefixed one
 * and the bare one, for every vendor in `API_KEY_SECRETS`. The bare-name
 * lookup scans the environment, so a developer machine (or CI runner)
 * exporting `MINIMAX_API_KEY` for another tool would otherwise leak
 * into these assertions.
 */
function vendorEnvNames(): string[] {
  return Object.keys(API_KEY_SECRETS).flatMap((vendor) => {
    const bare = bareEnvNameForVendor(vendor) as string;
    return [`${ENV_NAME_PREFIX}${bare}`, bare];
  });
}

/** Drop every env var the key chain can read, leaving the rest untouched. */
function clearVendorApiKeyEnv(): void {
  for (const name of vendorEnvNames()) {
    delete process.env[name];
  }
}

function restoreEnv(): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in envBackup)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, envBackup);
}

beforeEach(() => {
  envBackup = { ...process.env };
  clearVendorApiKeyEnv();
  tempDir = join(tmpdir(), `aiflowbridge-keys-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  restoreEnv();
});

describe('env var mapping', () => {
  it('returns the env value when set and non-empty', async () => {
    process.env.AIFLOWBRIDGE_DEEPSEEK_API_KEY = 'sk-env';
    const source = new EnvSecretStorage();
    expect(await source.get(DEEPSEEK_FULL)).toBe('sk-env');
  });

  it('returns undefined when the env var is empty or missing', async () => {
    process.env.AIFLOWBRIDGE_DEEPSEEK_API_KEY = '';
    const source = new EnvSecretStorage();
    expect(await source.get(DEEPSEEK_FULL)).toBeUndefined();
    expect(await source.get('aiflowbridge.providers.unknown.apiKey')).toBeUndefined();
  });

  it('resolves the OpenRouter key from its env var', async () => {
    process.env.AIFLOWBRIDGE_OPENROUTER_API_KEY = 'sk-openrouter';
    const source = new EnvSecretStorage();
    expect(await source.get(OPENROUTER_FULL)).toBe('sk-openrouter');
  });

  it('resolves the gateway-only vendor keys from their env vars', async () => {
    // Regression guard for the silent-failure mode: `SECRET_KEY_TO_ENV_NAME`
    // is a plain `Record<string, string>`, not compile-checked against
    // `API_KEY_SECRETS`, so a missing entry makes the env var be ignored
    // without any error (same class of bug as the Google AI Studio one).
    process.env.AIFLOWBRIDGE_ZAI_API_KEY = 'zai-env';
    process.env.AIFLOWBRIDGE_MOONSHOT_API_KEY = 'moonshot-env';
    const source = new EnvSecretStorage();
    expect(await source.get('aiflowbridge.providers.zai.apiKey')).toBe('zai-env');
    expect(await source.get('aiflowbridge.providers.moonshot.apiKey')).toBe('moonshot-env');
  });
});

describe('bare env var aliases', () => {
  it('derives one alias per vendor key from the canonical prefixed name', () => {
    const aliases = ALL_VENDOR_KEYS.map((key) => envAliasForSecretKey(key));
    expect(aliases).toEqual([
      'DEEPSEEK_API_KEY',
      'MINIMAX_API_KEY',
      'XIAOMI_API_KEY',
      'OPENROUTER_API_KEY',
      'GOOGLEAISTUDIO_API_KEY',
      'ZAI_API_KEY',
      'MOONSHOT_API_KEY',
    ]);
  });

  it('lists the canonical name before the alias', () => {
    expect(envNamesForSecretKey(DEEPSEEK_FULL)).toEqual(['AIFLOWBRIDGE_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY']);
  });

  it('has no candidate for a key outside the canonical map', () => {
    expect(envNameForSecretKey('aiflowbridge.providers.unknown.apiKey')).toBeUndefined();
    expect(envAliasForSecretKey('aiflowbridge.providers.unknown.apiKey')).toBeUndefined();
    expect(envNamesForSecretKey('aiflowbridge.providers.unknown.apiKey')).toEqual([]);
  });

  it('reads the bare vendor name when the prefixed one is absent', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-bare';
    const source = new EnvSecretStorage();
    expect(await source.get(DEEPSEEK_FULL)).toBe('sk-bare');
  });

  it('resolves every vendor key from its bare name alone', async () => {
    for (const key of ALL_VENDOR_KEYS) {
      const alias = envAliasForSecretKey(key);
      expect(alias).toBeDefined();
      process.env[alias as string] = `sk-${alias}`;
    }
    const source = new EnvSecretStorage();
    for (const key of ALL_VENDOR_KEYS) {
      const alias = envAliasForSecretKey(key) as string;
      expect(await source.get(key)).toBe(`sk-${alias}`);
    }
  });

  it('prefers the prefixed name when both are set', async () => {
    process.env.AIFLOWBRIDGE_MINIMAX_API_KEY = 'sk-prefixed';
    process.env.MINIMAX_API_KEY = 'sk-bare';
    const source = new EnvSecretStorage();
    expect(await source.get(MINIMAX_FULL)).toBe('sk-prefixed');
  });

  it('falls back to the bare name when the prefixed one is empty', async () => {
    process.env.AIFLOWBRIDGE_MINIMAX_API_KEY = '';
    process.env.MINIMAX_API_KEY = 'sk-bare';
    const source = new EnvSecretStorage();
    expect(await source.get(MINIMAX_FULL)).toBe('sk-bare');
  });

  it('returns undefined when both names are empty', async () => {
    process.env.AIFLOWBRIDGE_ZAI_API_KEY = '';
    process.env.ZAI_API_KEY = '';
    const source = new EnvSecretStorage();
    expect(await source.get('aiflowbridge.providers.zai.apiKey')).toBeUndefined();
  });

  it('keeps env above secrets.json regardless of which name answered', async () => {
    const path = join(tempDir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ [DEEPSEEK_FULL]: 'sk-file' }));
    process.env.DEEPSEEK_API_KEY = 'sk-bare';
    const composite = createGatewaySecrets({ secretsPath: path });
    expect(await composite.get(DEEPSEEK_FULL)).toBe('sk-bare');

    delete process.env.DEEPSEEK_API_KEY;
    const fresh = createGatewaySecrets({ secretsPath: path });
    expect(await fresh.get(DEEPSEEK_FULL)).toBe('sk-file');
  });

  it('names the variable that answered in the source description', () => {
    const source = new EnvSecretStorage();
    process.env.XIAOMI_API_KEY = 'sk-bare';
    expect(source.describe('aiflowbridge.providers.xiaomi.apiKey')).toBe('Env (XIAOMI_API_KEY)');

    process.env.AIFLOWBRIDGE_XIAOMI_API_KEY = 'sk-prefixed';
    expect(source.describe('aiflowbridge.providers.xiaomi.apiKey')).toBe('Env (AIFLOWBRIDGE_XIAOMI_API_KEY)');

    expect(source.describe('aiflowbridge.providers.unknown.apiKey')).toBe('unknown');
  });
});

describe('generic bare env discovery', () => {
  it('resolves a <VENDOR>_API_KEY name for every vendor declaring an api key slot', () => {
    // The guard that makes the feature generic: a vendor added to
    // `API_KEY_SECRETS` must get a working bare name with no second
    // declaration. Iterating the source of truth is what turns the
    // silent-omission class (an entry forgotten in a hand-written map,
    // which reads as a missing key with no error) into a red test.
    for (const [vendor, secretKey] of Object.entries(API_KEY_SECRETS)) {
      const name = bareEnvNameForVendor(vendor);
      expect(name).toBe(`${vendor.toUpperCase()}_API_KEY`);
      expect(findBareEnvNameForSecretKey(secretKey, { [name as string]: 'x' })).toBe(name);
    }
  });

  it('has no bare name for a vendor with no api key slot', () => {
    expect(bareEnvNameForVendor('antigravity')).toBeUndefined();
    expect(bareEnvNameForVendor('unknown')).toBeUndefined();
  });

  it('picks the bare name up from the environment without any declaration', () => {
    // A vendor whose canonical name does not follow the
    // `AIFLOWBRIDGE_<VENDOR>_API_KEY` convention is still found by the
    // scan, which is the point of scanning rather than stripping.
    const env = { GOOGLEAISTUDIO_API_KEY: 'x' };
    expect(findBareEnvNameForSecretKey(API_KEY_SECRETS.googleaistudio, env)).toBe('GOOGLEAISTUDIO_API_KEY');
  });

  it('ignores a name that is not exactly <VENDOR>_API_KEY', () => {
    const key = API_KEY_SECRETS.deepseek;
    expect(findBareEnvNameForSecretKey(key, { DEEPSEEK_KEY: 'x' })).toBeUndefined();
    expect(findBareEnvNameForSecretKey(key, { DEEPSEEK_API_KEY_EXTRA: 'x' })).toBeUndefined();
    expect(findBareEnvNameForSecretKey(key, { MY_DEEPSEEK_API_KEY: 'x' })).toBeUndefined();
    expect(findBareEnvNameForSecretKey(key, { DEEPSEEK: 'x' })).toBeUndefined();
    expect(findBareEnvNameForSecretKey(key, { _API_KEY: 'x' })).toBeUndefined();
    expect(findBareEnvNameForSecretKey(key, { '': 'x' })).toBeUndefined();
  });

  it('never treats the prefixed name as a bare one', () => {
    expect(
      findBareEnvNameForSecretKey(API_KEY_SECRETS.deepseek, { AIFLOWBRIDGE_DEEPSEEK_API_KEY: 'x' })
    ).toBeUndefined();
  });

  it('never reads a bare name belonging to another vendor', () => {
    expect(findBareEnvNameForSecretKey(API_KEY_SECRETS.deepseek, { MINIMAX_API_KEY: 'x' })).toBeUndefined();
    expect(findBareEnvNameForSecretKey(API_KEY_SECRETS.zai, { MOONSHOT_API_KEY: 'x' })).toBeUndefined();
  });

  it('matches the name case-insensitively for Windows environments', () => {
    expect(findBareEnvNameForSecretKey(API_KEY_SECRETS.xiaomi, { xiaomi_api_key: 'x' })).toBe('xiaomi_api_key');
  });

  it('returns the first match in sorted order for a stable result', () => {
    const found = findBareEnvNameForSecretKey(API_KEY_SECRETS.zai, { ZAI_API_KEY: 'a', 'zai_api_key': 'b' });
    expect(found).toBe('ZAI_API_KEY');
  });

  it('orders the canonical name before the bare name in the candidate list', () => {
    const env = { ZAI_API_KEY: 'x' };
    expect(envNamesForSecretKey(API_KEY_SECRETS.zai, env)).toEqual(['AIFLOWBRIDGE_ZAI_API_KEY', 'ZAI_API_KEY']);
  });

  it('does not repeat a name that is both derived and scanned', () => {
    const env = { MINIMAX_API_KEY: 'x' };
    const names = envNamesForSecretKey(API_KEY_SECRETS.minimax, env);
    expect(names).toEqual(['AIFLOWBRIDGE_MINIMAX_API_KEY', 'MINIMAX_API_KEY']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('skips an empty bare name and falls through to the next source', async () => {
    process.env.ZAI_API_KEY = '';
    const path = join(tempDir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ [API_KEY_SECRETS.zai]: 'sk-file' }));
    const composite = createGatewaySecrets({ secretsPath: path });
    expect(await composite.get(API_KEY_SECRETS.zai)).toBe('sk-file');
  });
});

describe('normalizeSecretsObject', () => {
  it('keeps only non-empty string values and mirrors the short form', () => {
    expect(
      normalizeSecretsObject({ 'minimax.apiKey': 'sk-a', 'deepseek.apiKey': '', other: 42, nullish: null })
    ).toEqual({ 'minimax.apiKey': 'sk-a', [MINIMAX_FULL]: 'sk-a' });
  });

  it('mirrors short-form keys to the full-prefix form', () => {
    const result = normalizeSecretsObject({ 'minimax.apiKey': 'sk-short' });
    expect(result[MINIMAX_FULL]).toBe('sk-short');
  });

  it('mirrors the gateway-only vendor short forms too', () => {
    // `SECRET_SHORT_TO_FULL` is a plain `Record<string, string>` as
    // well, so a missing entry makes the documented short form
    // silently unreadable in `secrets.json`.
    const result = normalizeSecretsObject({ 'zai.apiKey': 'zai-short', 'moonshot.apiKey': 'moonshot-short' });
    expect(result['aiflowbridge.providers.zai.apiKey']).toBe('zai-short');
    expect(result['aiflowbridge.providers.moonshot.apiKey']).toBe('moonshot-short');
  });

  it('keeps the full-prefix form when both forms are present', () => {
    const result = normalizeSecretsObject({ 'minimax.apiKey': 'sk-short', [MINIMAX_FULL]: 'sk-full' });
    expect(result[MINIMAX_FULL]).toBe('sk-full');
  });

  it('returns an empty object for non-object input', () => {
    expect(normalizeSecretsObject(null)).toEqual({});
    expect(normalizeSecretsObject('nope')).toEqual({});
  });
});

describe('FileSecretStorage', () => {
  it('reads full-prefix keys from secrets.json', async () => {
    const path = join(tempDir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ [DEEPSEEK_FULL]: 'sk-file' }));
    const file = new FileSecretStorage(path);
    expect(await file.get(DEEPSEEK_FULL)).toBe('sk-file');
  });

  it('accepts the documented short-form keys', async () => {
    const path = join(tempDir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ 'deepseek.apiKey': 'sk-short' }));
    const file = new FileSecretStorage(path);
    expect(await file.get(DEEPSEEK_FULL)).toBe('sk-short');
  });

  it('re-reads the file when its mtime changes (hot reload)', async () => {
    const path = join(tempDir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ [DEEPSEEK_FULL]: 'sk-v1' }));
    const file = new FileSecretStorage(path);
    expect(await file.get(DEEPSEEK_FULL)).toBe('sk-v1');

    // Give the file system a beat so the mtime changes.
    await new Promise((resolve) => setTimeout(resolve, 30));
    writeFileSync(path, JSON.stringify({ [DEEPSEEK_FULL]: 'sk-v2' }));
    expect(await file.get(DEEPSEEK_FULL)).toBe('sk-v2');
  });

  it('store() writes through to the file and is read back by a fresh instance', async () => {
    const path = join(tempDir, 'secrets.json');
    const file = new FileSecretStorage(path);
    await file.store(MINIMAX_FULL, 'sk-stored');

    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    expect(onDisk[MINIMAX_FULL]).toBe('sk-stored');
    const fresh = new FileSecretStorage(path);
    expect(await fresh.get(MINIMAX_FULL)).toBe('sk-stored');
  });

  it('delete() removes the key from the file', async () => {
    const path = join(tempDir, 'secrets.json');
    writeFileSync(path, JSON.stringify({ [MINIMAX_FULL]: 'sk-stored' }));
    const file = new FileSecretStorage(path);
    await file.delete(MINIMAX_FULL);
    expect(await file.get(MINIMAX_FULL)).toBeUndefined();
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    expect(onDisk[MINIMAX_FULL]).toBeUndefined();
  });

  it('survives a corrupt secrets.json (returns no keys, no throw)', async () => {
    const path = join(tempDir, 'secrets.json');
    writeFileSync(path, '{not valid json');
    const file = new FileSecretStorage(path);
    expect(await file.get(DEEPSEEK_FULL)).toBeUndefined();
  });
});

describe('CompositeSecretStorage / createGatewaySecrets', () => {
  it('env var wins over the secrets.json file (priority 1)', async () => {
    process.env.AIFLOWBRIDGE_DEEPSEEK_API_KEY = 'sk-env';
    writeFileSync(join(tempDir, 'secrets.json'), JSON.stringify({ [DEEPSEEK_FULL]: 'sk-file' }));
    const secrets = createGatewaySecrets({ secretsPath: join(tempDir, 'secrets.json') });
    expect(await secrets.get(DEEPSEEK_FULL)).toBe('sk-env');
  });

  it('secrets.json wins over the host fallback (priority 2)', async () => {
    writeFileSync(join(tempDir, 'secrets.json'), JSON.stringify({ [DEEPSEEK_FULL]: 'sk-file' }));
    const fallback = makeFallback({ [DEEPSEEK_FULL]: 'sk-fallback' });
    const secrets = createGatewaySecrets({
      secretsPath: join(tempDir, 'secrets.json'),
      fallback,
      fallbackLabel: 'SecretStorage (VS Code)',
    });
    expect(await secrets.get(DEEPSEEK_FULL)).toBe('sk-file');
  });

  it('falls back to the host storage when env and file are empty', async () => {
    const fallback = makeFallback({ [DEEPSEEK_FULL]: 'sk-fallback' });
    const secrets = createGatewaySecrets({
      secretsPath: join(tempDir, 'secrets.json'),
      fallback,
      fallbackLabel: 'SecretStorage (VS Code)',
    });
    expect(await secrets.get(DEEPSEEK_FULL)).toBe('sk-fallback');
  });

  it('store() delegates to the host fallback when one is provided', async () => {
    const fallback = makeFallback();
    const secrets = createGatewaySecrets({
      secretsPath: join(tempDir, 'secrets.json'),
      fallback,
      fallbackLabel: 'SecretStorage (VS Code)',
    });
    await secrets.store(MINIMAX_FULL, 'sk-new');
    expect(fallback.stored[MINIMAX_FULL]).toBe('sk-new');
  });

  it('store() writes to the file when no host fallback exists (standalone)', async () => {
    const secrets = createGatewaySecrets({ secretsPath: join(tempDir, 'secrets.json') });
    await secrets.store(MINIMAX_FULL, 'sk-standalone');
    const onDisk = JSON.parse(readFileSync(join(tempDir, 'secrets.json'), 'utf8')) as Record<string, string>;
    expect(onDisk[MINIMAX_FULL]).toBe('sk-standalone');
  });

  it('delete() removes the key from the host fallback', async () => {
    const fallback = makeFallback({ [MINIMAX_FULL]: 'sk-old' });
    const secrets = createGatewaySecrets({
      secretsPath: join(tempDir, 'secrets.json'),
      fallback,
      fallbackLabel: 'SecretStorage (VS Code)',
    });
    await secrets.delete(MINIMAX_FULL);
    expect(fallback.stored[MINIMAX_FULL]).toBeUndefined();
  });

  it('skips a rejecting source and uses the next one (locked keyring case)', async () => {
    writeFileSync(join(tempDir, 'secrets.json'), JSON.stringify({}));
    const rejecting = new FallbackSecretStorage('rejecting', {
      get: async () => {
        throw new Error('keyring locked');
      },
      store: async () => undefined,
      delete: async () => undefined,
    });
    const answering = new FallbackSecretStorage('answering', {
      get: async () => 'sk-last',
      store: async () => undefined,
      delete: async () => undefined,
    });
    const secrets = new CompositeSecretStorage([
      new EnvSecretStorage(),
      new FileSecretStorage(join(tempDir, 'secrets.json')),
      rejecting,
      answering,
    ]);
    expect(await secrets.get(DEEPSEEK_FULL)).toBe('sk-last');
  });

  it('rejects an empty source list', () => {
    expect(() => new CompositeSecretStorage([])).toThrow(/at least one source/);
  });
});

describe('describeApiKeySource', () => {
  it('reports the env var name when the key comes from the env', async () => {
    process.env.AIFLOWBRIDGE_MINIMAX_API_KEY = 'sk-env';
    const secrets = createGatewaySecrets({ secretsPath: join(tempDir, 'secrets.json') });
    expect(await describeApiKeySource(MINIMAX_FULL, secrets)).toBe('Env (AIFLOWBRIDGE_MINIMAX_API_KEY)');
  });

  it('reports the file path when the key comes from secrets.json', async () => {
    writeFileSync(join(tempDir, 'secrets.json'), JSON.stringify({ [MINIMAX_FULL]: 'sk-file' }));
    const secrets = createGatewaySecrets({ secretsPath: join(tempDir, 'secrets.json') });
    expect(await describeApiKeySource(MINIMAX_FULL, secrets)).toBe(`file ${join(tempDir, 'secrets.json')}`);
  });

  it('reports the host label when the key comes from the fallback', async () => {
    const fallback = makeFallback({ [MINIMAX_FULL]: 'sk-fallback' });
    const secrets = createGatewaySecrets({
      secretsPath: join(tempDir, 'secrets.json'),
      fallback,
      fallbackLabel: 'SecretStorage (VS Code)',
    });
    expect(await describeApiKeySource(MINIMAX_FULL, secrets)).toBe('SecretStorage (VS Code)');
  });

  it('reports not configured when no source has the key', async () => {
    const secrets = createGatewaySecrets({ secretsPath: join(tempDir, 'secrets.json') });
    expect(await describeApiKeySource(MINIMAX_FULL, secrets)).toBe('not configured');
  });

  it('falls back to a plain SecretStorage check for non-composite storages', async () => {
    const fallback = makeFallback({ [MINIMAX_FULL]: 'sk-plain' });
    expect(await describeApiKeySource(MINIMAX_FULL, fallback)).toBe('SecretStorage');
  });

  it('reports not configured when the storage rejects instead of breaking activation', async () => {
    const rejecting = {
      get: async () => {
        throw new Error('keyring locked');
      },
      store: async () => undefined,
      delete: async () => undefined,
    };
    expect(await describeApiKeySource(MINIMAX_FULL, rejecting)).toBe('not configured');
  });
});
