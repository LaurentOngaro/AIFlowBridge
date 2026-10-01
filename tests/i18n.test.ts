/**
 * i18n table integrity.
 *
 * `t()` returns the key verbatim when a key is missing from the table, and
 * returns it BEFORE applying the `{0}` substitutions. A key used in the code
 * but absent from the table is therefore a silent bug: the user sees
 * `vision.configuredModelMissing` in a toast, and any argument passed to
 * `t()` is dropped.
 *
 * This exact failure happened twice in this repository: first with
 * `provider.googleaistudio.name` (used by the Google AI Studio key commands
 * via `t('provider.googleaistudio.name')`), then with the three
 * `vision.configured*` keys. Neither produced a compile error or a test
 * failure. This file is the guard against the class of bug.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, t } from '../src/i18n';

const SRC_DIR = resolve(__dirname, '..', 'src');

/** Recursively collect every `.ts` file under `src/`. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every `'some.key'` literal passed as the first argument of `t(...)`. */
function collectUsedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of collectTsFiles(SRC_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const key = match[1];
      const list = used.get(key) ?? [];
      list.push(file);
      used.set(key, list);
    }
  }
  return used;
}

describe('i18n table', () => {
  it('defines every key used with t() somewhere in src/', () => {
    const missing: string[] = [];
    for (const [key, files] of collectUsedKeys()) {
      if (!Object.prototype.hasOwnProperty.call(en, key)) {
        missing.push(`${key}  (${files.length} call site(s))`);
      }
    }
    expect(missing, `clés i18n utilisées mais non définies :\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('scans a non-trivial number of call sites', () => {
    // Guard against the scanner silently becoming vacuous: if the regex or the
    // file walk ever breaks, "no key is missing" would pass for the wrong
    // reason. The table currently holds ~90 keys and src/ calls t() ~70 times.
    const used = collectUsedKeys();
    expect(used.size).toBeGreaterThan(40);
    expect(Object.keys(en).length).toBeGreaterThan(60);
  });

  it('falls back to the key itself for an unknown key', () => {
    expect(t('definitely.not.a.real.key')).toBe('definitely.not.a.real.key');
  });

  it('substitutes {0} placeholders', () => {
    expect(t('vision.vendorLabel', 'copilot')).toBe('vendor: copilot');
  });

  it('defines the per-vendor labels used by the API key commands', () => {
    // `src/runtime/provider.ts` builds its command handlers from these
    // labels. A missing one prints the raw key in the toast.
    for (const key of [
      'provider.deepseek.name',
      'provider.minimax.name',
      'provider.xiaomi.name',
      'provider.openrouter.name',
      'provider.googleaistudio.name',
      'provider.zai.name',
      'provider.moonshot.name',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(en, key), `missing ${key}`).toBe(true);
    }
  });

  it('keeps the vision keys referenced by the vision proxy resolver', () => {
    for (const key of [
      'vision.configuredMissing',
      'vision.configuredMissingVendor',
      'vision.configuredModelMissing',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(en, key), `missing ${key}`).toBe(true);
    }
  });

  it('has no placeholder-less template string left in the vision table', () => {
    // `vision.vendorLabel` is the substitution host for
    // `vision.configuredMissingVendor`; if the latter ever ends up with a
    // `{0}` of its own the rendered label would show a stray placeholder.
    expect(en['vision.configuredMissingVendor']).not.toContain('{');
    expect(en['vision.configuredMissing']).not.toContain('{');
  });
});
