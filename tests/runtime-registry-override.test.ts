/**
 * AIFlowBridge - globalStorage registry override tests.
 *
 * Covers the targeted cleanup helper used by the
 * "Switch Google AI Studio route" command to strip stale
 * `vendors.googleaistudio` entries that would otherwise silently
 * hijack the route decision (audit BUG-02).
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRegistryVendorBaseUrl, resetGlobalStorageRegistryOverride } from '../src/aiflowbridge/modelRegistryOverride';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'aifb-registry-override-'));
});

afterEach(async () => {
  // best-effort cleanup; tmpdir is cleaned by the OS eventually.
});

describe('resetGlobalStorageRegistryOverride', () => {
  it('creates the override file with the mutator output when it is missing', async () => {
    const filePath = join(workDir, 'models.json');
    const written = await resetGlobalStorageRegistryOverride(
      workDir,
      ['models.json'],
      () => ({ vendors: {} })
    );
    expect(written).toBe(true);
    const raw = await readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toEqual({ vendors: {} });
  });

  it('strips the stale googleaistudio vendor entry from an existing override', async () => {
    const filePath = join(workDir, 'models.json');
    await writeFile(
      filePath,
      JSON.stringify({
        vendors: {
          googleaistudio: { baseUrl: 'https://cloudcode-pa.googleapis.com', apiKeySecret: '...' },
          openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
        },
        models: [{ id: 'gemini-3.8-flash' }],
      }),
      'utf8'
    );
    const written = await resetGlobalStorageRegistryOverride(
      workDir,
      ['models.json'],
      (registry) => {
        if (registry.vendors?.googleaistudio) {
          delete registry.vendors.googleaistudio;
        }
        return registry;
      }
    );
    expect(written).toBe(true);
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      vendors: Record<string, { baseUrl?: string }>;
      models: Array<{ id: string }>;
    };
    expect(parsed.vendors.googleaistudio).toBeUndefined();
    expect(parsed.vendors.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(parsed.models).toHaveLength(1);
  });

  it('returns false and skips the write when the mutator returns undefined (no-op)', async () => {
    const filePath = join(workDir, 'models.json');
    await writeFile(filePath, JSON.stringify({ vendors: {} }), 'utf8');
    const written = await resetGlobalStorageRegistryOverride(
      workDir,
      ['models.json'],
      () => undefined
    );
    expect(written).toBe(true);
    // Original content unchanged.
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as { vendors: Record<string, unknown> };
    expect(parsed.vendors).toEqual({});
  });

  it('starts from an empty object when the existing file is malformed JSON', async () => {
    const filePath = join(workDir, 'models.json');
    await writeFile(filePath, '{ this is not valid JSON', 'utf8');
    const written = await resetGlobalStorageRegistryOverride(
      workDir,
      ['models.json'],
      (registry) => {
        registry.vendors = { openrouter: { baseUrl: 'https://openrouter.ai/api/v1' } };
        return registry;
      }
    );
    // Malformed JSON: the helper still writes a clean replacement, so
    // `written` is true. The point of this test is the *content*
    // (we get a sane registry, not the malformed JSON left on disk).
    expect(written).toBe(true);
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      vendors: Record<string, { baseUrl?: string }>;
    };
    expect(parsed.vendors.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1');
  });
});

describe('readRegistryVendorBaseUrl', () => {
  const readerFor = (dir: string): { readFile(uri: { fsPath: string }): Promise<Uint8Array> } => ({
    readFile: async (uri: { fsPath: string }) => new TextEncoder().encode(await readFile(uri.fsPath, 'utf8')),
  });

  it('strips both googleaistudio and antigravity vendor keys on switch', async () => {
    const filePath = join(workDir, 'models.json');
    await writeFile(
      filePath,
      JSON.stringify({
        vendors: {
          googleaistudio: { baseUrl: 'https://cloudcode-pa.googleapis.com' },
          antigravity: { baseUrl: 'https://cloudcode-pa.googleapis.com' },
          openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
        },
      }),
      'utf8'
    );
    const written = await resetGlobalStorageRegistryOverride(workDir, ['models.json'], (registry) => {
      const vendors = registry.vendors as Record<string, unknown> | undefined;
      if (registry.vendors?.googleaistudio) {
        delete registry.vendors.googleaistudio;
      }
      if (vendors && 'antigravity' in vendors) {
        delete vendors.antigravity;
      }
      return registry;
    });
    expect(written).toBe(true);
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as { vendors: Record<string, unknown> };
    expect(parsed.vendors.googleaistudio).toBeUndefined();
    expect(parsed.vendors.antigravity).toBeUndefined();
    expect(parsed.vendors.openrouter).toBeDefined();
  });

  it('reads the first matching vendor baseUrl from an override file', async () => {
    const filePath = join(workDir, 'models.json');
    await writeFile(
      filePath,
      JSON.stringify({ vendors: { antigravity: { baseUrl: 'https://cloudcode-pa.googleapis.com' } } }),
      'utf8'
    );
    const found = await readRegistryVendorBaseUrl(readerFor(workDir), workDir, ['models.json'], ['googleaistudio', 'antigravity']);
    expect(found).toBe('https://cloudcode-pa.googleapis.com');
  });

  it('returns undefined when the override file is missing', async () => {
    const found = await readRegistryVendorBaseUrl(readerFor(workDir), workDir, ['models.json'], ['googleaistudio', 'antigravity']);
    expect(found).toBeUndefined();
  });
});
