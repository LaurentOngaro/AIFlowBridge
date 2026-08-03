/**
 * Unit tests for src/standalone/context.ts.
 *
 * Covers:
 *   - Secret storage: env var resolution (priority 1), file fallback
 *     (priority 2), `store()` / `delete()` round-trip via the JSON file.
 *   - Storage dir creation (mkdir-recursive on a fresh path).
 *   - The onConfigChange watcher: `invalidate()` is called on the
 *     underlying ConfigReader when the watched file changes.
 */
/// <reference types="node" />

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
import { createStandaloneContext } from '../../src/standalone/context';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `aiflowbridge-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  // Clear any test-injected env vars so they don't leak between tests.
  delete process.env.AIFLOWBRIDGE_DEEPSEEK_API_KEY;
  delete process.env.AIFLOWBRIDGE_MINIMAX_API_KEY;
  delete process.env.AIFLOWBRIDGE_XIAOMI_API_KEY;
});

describe('createStandaloneContext', () => {
  it('creates the storage dir if it does not exist', async () => {
    // Use a fresh, non-existent subdirectory of tempDir so we can
    // assert `mkdir-recursive` was called by the context itself.
    const freshDir = join(tempDir, 'fresh-subdir');
    expect(existsSync(freshDir)).toBe(false);
    const ctx = await createStandaloneContext({
      globalStorageDir: freshDir,
      extensionVersion: '1.0.0',
      extensionRootPath: freshDir,
    });
    expect(existsSync(freshDir)).toBe(true);
    expect(ctx.globalStorageDir).toBe(freshDir);
    expect(ctx.extensionVersion).toBe('1.0.0');
  });

  it('seeds an empty subscriptions array', async () => {
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    expect(Array.isArray(ctx.subscriptions)).toBe(true);
    expect(ctx.subscriptions).toHaveLength(0);
  });

  it('returns undefined for the UI hooks (no registerCommand, no showInformation, no showWarning)', async () => {
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    expect(ctx.registerCommand).toBeUndefined();
    expect(ctx.showInformation).toBeUndefined();
    expect(ctx.showWarning).toBeUndefined();
  });

  it('exposes an fs adapter that reads files via node:fs/promises', async () => {
    const target = join(tempDir, 'sample.json');
    writeFileSync(target, JSON.stringify({ ok: true }));
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    expect(ctx.fs).toBeDefined();
    const bytes = await ctx.fs!.readFile({ fsPath: target });
    const text = new TextDecoder().decode(bytes);
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  it('exposes extensionUri rooted at the supplied extensionRootPath', async () => {
    const root = join(tempDir, 'extension');
    mkdirSync(root, { recursive: true });
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: root,
    });
    expect(ctx.extensionUri?.fsPath).toBe(root);
  });
});

describe('standalone secrets resolution', () => {
  it('resolves an API key from the env var when set (priority 1)', async () => {
    process.env.AIFLOWBRIDGE_DEEPSEEK_API_KEY = 'sk-from-env';
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    const value = await ctx.secrets.get('aiflowbridge.providers.deepseek.apiKey');
    expect(value).toBe('sk-from-env');
  });

  it('falls back to the secrets.json file when the env var is unset (priority 2)', async () => {
    // Pre-create the secrets.json file.
    writeFileSync(join(tempDir, 'secrets.json'), JSON.stringify({ 'aiflowbridge.providers.deepseek.apiKey': 'sk-from-file' }));
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    const value = await ctx.secrets.get('aiflowbridge.providers.deepseek.apiKey');
    expect(value).toBe('sk-from-file');
  });

  it('accepts the short-form secrets.json keys documented in docs/standalone.md', async () => {
    // The user-facing docs show the short form: "deepseek.apiKey",
    // "minimax.apiKey", "xiaomi.apiKey". The runtime resolver (which
    // uses API_KEY_SECRETS from src/consts.ts) asks for the
    // full-prefix form: "aiflowbridge.providers.<vendor>.apiKey".
    // Without normalization at load time, the lookup misses and the
    // upstream returns 401 "API secret key missing" (regression seen
    // in 2.1.0). The standalone adapter must mirror the short form
    // to the full form so the runtime finds it.
    writeFileSync(
      join(tempDir, 'secrets.json'),
      JSON.stringify({
        'deepseek.apiKey': 'sk-short-deepseek',
        'minimax.apiKey': 'sk-short-minimax',
        'xiaomi.apiKey': 'sk-short-xiaomi',
      })
    );
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    expect(await ctx.secrets.get('aiflowbridge.providers.deepseek.apiKey')).toBe('sk-short-deepseek');
    expect(await ctx.secrets.get('aiflowbridge.providers.minimax.apiKey')).toBe('sk-short-minimax');
    expect(await ctx.secrets.get('aiflowbridge.providers.xiaomi.apiKey')).toBe('sk-short-xiaomi');
  });

  it('prefers the full-prefix form when both short and full are present in secrets.json', async () => {
    // Defensive: if the user happened to define both forms (e.g. after
    // migrating from a previous setup), the full form wins so the
    // runtime behavior is deterministic.
    writeFileSync(
      join(tempDir, 'secrets.json'),
      JSON.stringify({
        'deepseek.apiKey': 'sk-short',
        'aiflowbridge.providers.deepseek.apiKey': 'sk-full',
      })
    );
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    expect(await ctx.secrets.get('aiflowbridge.providers.deepseek.apiKey')).toBe('sk-full');
  });

  it('env var wins over the secrets.json file when both are set', async () => {
    process.env.AIFLOWBRIDGE_DEEPSEEK_API_KEY = 'sk-from-env';
    writeFileSync(join(tempDir, 'secrets.json'), JSON.stringify({ 'aiflowbridge.providers.deepseek.apiKey': 'sk-from-file' }));
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    const value = await ctx.secrets.get('aiflowbridge.providers.deepseek.apiKey');
    expect(value).toBe('sk-from-env');
  });

  it('returns undefined for an unknown key', async () => {
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    const value = await ctx.secrets.get('aiflowbridge.providers.unknown.apiKey');
    expect(value).toBeUndefined();
  });

  it('store() writes through to secrets.json and the new value is read back', async () => {
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    await ctx.secrets.store('aiflowbridge.providers.minimax.apiKey', 'sk-stored');

    // The disk file reflects the new value.
    const onDisk = JSON.parse(readFileSync(join(tempDir, 'secrets.json'), 'utf8'));
    expect(onDisk['aiflowbridge.providers.minimax.apiKey']).toBe('sk-stored');

    // A fresh context reads it back.
    const ctx2 = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    const value = await ctx2.secrets.get('aiflowbridge.providers.minimax.apiKey');
    expect(value).toBe('sk-stored');
  });

  it('delete() removes the key from the file', async () => {
    writeFileSync(join(tempDir, 'secrets.json'), JSON.stringify({ 'aiflowbridge.providers.minimax.apiKey': 'sk-stored' }));
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    await ctx.secrets.delete('aiflowbridge.providers.minimax.apiKey');

    const onDisk = JSON.parse(readFileSync(join(tempDir, 'secrets.json'), 'utf8'));
    expect(onDisk['aiflowbridge.providers.minimax.apiKey']).toBeUndefined();
  });

  it('survives a corrupt secrets.json (returns no keys, no throw)', async () => {
    writeFileSync(join(tempDir, 'secrets.json'), '{not valid json');
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    const value = await ctx.secrets.get('aiflowbridge.providers.deepseek.apiKey');
    expect(value).toBeUndefined();
  });
});

describe('standalone onConfigChange', () => {
  it('returns a Disposable that can be invoked without throwing', async () => {
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    expect(ctx.onConfigChange).toBeDefined();
    const cb = () => undefined;
    const disposable = ctx.onConfigChange!(cb);
    expect(typeof disposable.dispose).toBe('function');
    disposable.dispose();
  });

  it('config watcher fires the callback when the config file changes', async () => {
    const ctx = await createStandaloneContext({
      globalStorageDir: tempDir,
      extensionVersion: '1.0.0',
      extensionRootPath: tempDir,
    });
    // Pre-create the config file so the watcher has something to watch.
    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ gateway: { port: 8787 } }));

    let fired = 0;
    const disposable = ctx.onConfigChange!(() => {
      fired++;
    });

    // Give the watcher a beat to attach.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Mutate the file - the watcher should observe the mtime change.
    writeFileSync(configPath, JSON.stringify({ gateway: { port: 9999 } }));

    // Wait up to 2s for either the inotify watcher OR the 5s polling
    // fallback to notice.
    for (let i = 0; i < 40 && fired === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(fired).toBeGreaterThanOrEqual(1);

    disposable.dispose();
  }, 15_000);
});

void readFileSync;
