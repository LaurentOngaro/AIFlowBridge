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
  CompositeSecretStorage,
  createGatewaySecrets,
  describeApiKeySource,
  EnvSecretStorage,
  FallbackSecretStorage,
  FileSecretStorage,
  normalizeSecretsObject,
} from '../src/aiflowbridge/api-key-sources';
import type { SecretStorageLike } from '../src/aiflowbridge/types';

const DEEPSEEK_FULL = 'aiflowbridge.providers.deepseek.apiKey';
const MINIMAX_FULL = 'aiflowbridge.providers.minimax.apiKey';
const OPENROUTER_FULL = 'aiflowbridge.providers.openrouter.apiKey';

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

beforeEach(() => {
  tempDir = join(tmpdir(), `aiflowbridge-keys-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  delete process.env.AIFLOWBRIDGE_DEEPSEEK_API_KEY;
  delete process.env.AIFLOWBRIDGE_MINIMAX_API_KEY;
  delete process.env.AIFLOWBRIDGE_XIAOMI_API_KEY;
  delete process.env.AIFLOWBRIDGE_OPENROUTER_API_KEY;
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
