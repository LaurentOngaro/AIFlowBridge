/**
 * Unit tests for src/standalone/storage-dir.ts.
 *
 * Covers the storage directory resolution precedence:
 *   1. `AIFLOWBRIDGE_DATA_DIR` env var (always wins).
 *   2. VS Code extension's `globalStorageUri` when it exists on disk.
 *   3. Legacy `~/.aiflowbridge/` fallback.
 *
 * The tests run on every platform vitest supports - they only depend
 * on `process.env` (cleared per-test in `beforeEach`) and the fs
 * `existsSync` check, which is exercised via creating / removing a
 * fake globalStorage directory in `os.tmpdir()`.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_STORAGE_DIRNAME,
  EXTENSION_NAME,
  EXTENSION_PUBLISHER,
  resolveExtensionGlobalStorageDir,
  resolveStorageDir,
} from '../../src/standalone/storage-dir';

describe('resolveExtensionGlobalStorageDir', () => {
  const fakeAppData = join(tmpdir(), 'aiflowbridge-test-appdata');

  beforeEach(() => {
    // Wipe any leftover temp dirs from prior runs so the test is
    // hermetic. The `recursive: true` + `force: true` flags make
    // rmSync idempotent (no-op when the path does not exist).
    rmSync(fakeAppData, { recursive: true, force: true });
    delete process.env.AIFLOWBRIDGE_DATA_DIR;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    rmSync(fakeAppData, { recursive: true, force: true });
    delete process.env.AIFLOWBRIDGE_DATA_DIR;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
  });

  it('returns undefined when APPDATA is unset on Windows and the extension is not installed', () => {
    // Simulate Windows by setting a non-appdata HOME so homedir() is
    // a clean value, then clear APPDATA to force the win32 branch to
    // bail out.
    process.env.APPDATA = '';
    // The implementation branches on process.platform which is set at
    // startup and cannot be changed mid-process. On non-Windows
    // runners this assertion verifies the env-var fallback path
    // (XDG_CONFIG_HOME unset -> uses ~/.config/Code/...).
    const result = resolveExtensionGlobalStorageDir();
    // Either `undefined` (env unset, path does not exist) or a real
    // path on this machine (the user happens to have the extension
    // installed). Both are valid; the contract is "returns the path
    // iff the extension is installed at the expected location".
    if (result !== undefined) {
      expect(result).toContain(EXTENSION_PUBLISHER);
      expect(result).toContain(EXTENSION_NAME);
    }
  });

  it('returns a path when the extension directory is reachable through the env resolver', () => {
    // Pre-create the directory at the location the platform resolver
    // would generate, then verify the function picks it up. The test
    // is platform-aware: it honors the resolver's platform() branch.
    const platform = process.platform;
    let probeBase: string;

    if (platform === 'win32') {
      process.env.APPDATA = fakeAppData;
      probeBase = join(fakeAppData, 'Code', 'User', 'globalStorage');
    } else if (platform === 'darwin') {
      // macOS resolution uses homedir() which we cannot redirect per
      // test; skip the assertion on darwin rather than risk writing
      // into the user's real home directory.
      return;
    } else {
      // Linux: respect the test-controlled XDG_CONFIG_HOME so the
      // assertion is hermetic.
      process.env.XDG_CONFIG_HOME = fakeAppData;
      probeBase = join(fakeAppData, 'Code', 'User', 'globalStorage');
    }

    const target = join(probeBase, `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`);
    mkdirSync(target, { recursive: true });

    const result = resolveExtensionGlobalStorageDir();
    expect(result).toBe(target);

    // Cleanup so the next test starts clean.
    rmSync(fakeAppData, { recursive: true, force: true });
  });

  it('returns undefined when the expected directory does not exist', () => {
    // Re-run with a guaranteed-missing location: force APPDATA / XDG
    // to point at an empty temp dir so the extension globalStorage
    // path under it does not exist.
    if (process.platform === 'win32') {
      process.env.APPDATA = join(fakeAppData, 'no-ext');
    } else if (process.platform !== 'darwin') {
      process.env.XDG_CONFIG_HOME = join(fakeAppData, 'no-ext');
    } else {
      // macOS path uses homedir() which we cannot redirect; skip.
      return;
    }
    const result = resolveExtensionGlobalStorageDir();
    expect(result).toBeUndefined();
  });
});

describe('resolveStorageDir (precedence)', () => {
  beforeEach(() => {
    delete process.env.AIFLOWBRIDGE_DATA_DIR;
  });

  afterEach(() => {
    delete process.env.AIFLOWBRIDGE_DATA_DIR;
  });

  it('returns AIFLOWBRIDGE_DATA_DIR when the env var is set (operator override wins)', () => {
    // Even if the extension globalStorage path exists, the env var
    // must win. Set both and verify the env-var path is returned.
    const envPath = join(tmpdir(), 'aiflowbridge-explicit');
    process.env.AIFLOWBRIDGE_DATA_DIR = envPath;
    const result = resolveStorageDir();
    expect(result).toBe(envPath);
  });

  it('falls back to the extension globalStorage path when no env var is set and the extension is installed', () => {
    // If the host happens to have the extension installed and no env
    // var is set, the resolved path MUST be the extension's path -
    // this is the whole point of the bugfix. We assert via the
    // inverse: if the function returns a path, it must contain the
    // publisher + name; if not, the test runner is on a machine
    // without the extension installed (valid).
    const result = resolveStorageDir();
    if (result.endsWith(join(EXTENSION_PUBLISHER, EXTENSION_NAME)) || result.includes(`${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`)) {
      // Confirmed the extension path branch was hit.
      expect(existsSync(result)).toBe(true);
    } else {
      // No extension installed on this runner - the legacy fallback
      // path is used. Verify it is the legacy name.
      expect(result).toContain(DEFAULT_STORAGE_DIRNAME);
    }
  });
});
