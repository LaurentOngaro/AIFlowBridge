/**
 * AIFlowBridge - registry override read tests.
 *
 * Covers the read helper the Google AI Studio migration command uses to
 * name which tier of the 3-tier registry merge (settings, workspace
 * override, globalStorage override) still carries a retired `baseUrl`
 * (audit BUG-02: a stale override silently hijacks the route).
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readRegistryVendorBaseUrl } from '../src/aiflowbridge/modelRegistryOverride';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'aifb-registry-override-'));
});

describe('readRegistryVendorBaseUrl', () => {
  const readerFor = (dir: string): { readFile(uri: { fsPath: string }): Promise<Uint8Array> } => ({
    readFile: async (uri: { fsPath: string }) => new TextEncoder().encode(await readFile(uri.fsPath, 'utf8')),
  });

  it('reads the vendor baseUrl an override carries', async () => {
    await writeFile(
      join(workDir, 'models.json'),
      JSON.stringify({ vendors: { googleaistudio: { baseUrl: 'https://cloudcode-pa.googleapis.com' } } }),
      'utf8'
    );
    const found = await readRegistryVendorBaseUrl(readerFor(workDir), workDir, ['models.json'], ['googleaistudio']);
    expect(found).toBe('https://cloudcode-pa.googleapis.com');
  });

  it('ignores a vendor key the caller did not ask for', async () => {
    await writeFile(
      join(workDir, 'models.json'),
      JSON.stringify({ vendors: { antigravity: { baseUrl: 'https://cloudcode-pa.googleapis.com' } } }),
      'utf8'
    );
    const found = await readRegistryVendorBaseUrl(readerFor(workDir), workDir, ['models.json'], ['googleaistudio']);
    expect(found).toBeUndefined();
  });

  it('returns undefined when the override file is missing', async () => {
    const found = await readRegistryVendorBaseUrl(readerFor(workDir), workDir, ['models.json'], ['googleaistudio']);
    expect(found).toBeUndefined();
  });

  it('returns undefined when the override file is not valid JSON', async () => {
    await writeFile(join(workDir, 'models.json'), '{ this is not valid JSON', 'utf8');
    const found = await readRegistryVendorBaseUrl(readerFor(workDir), workDir, ['models.json'], ['googleaistudio']);
    expect(found).toBeUndefined();
  });
});