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

/** Matches the `t(` of every call site, whatever the argument syntax. */
const T_CALL = /\bt\s*\(/g;

/** Matches the `t('key')` / `t("key")` / `` t(`key`) `` forms (no interpolation). */
const T_LITERAL_CALL = /\bt\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`$]*)`)/g;

/**
 * Every string literal passed as the first argument of `t(...)`.
 *
 * Three quoting styles are accepted: `'key'`, `"key"`, and a backtick template
 * without interpolation. A call whose argument is an interpolated template or an
 * identifier cannot be resolved statically: it is reported by
 * `collectDynamicCallSites()` instead, which pins the remaining gap.
 */
function collectUsedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of collectTsFiles(SRC_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(T_LITERAL_CALL)) {
      const key = match[1] ?? match[2] ?? match[3];
      if (!key) {
        continue;
      }
      const list = used.get(key) ?? [];
      list.push(file);
      used.set(key, list);
    }
  }
  return used;
}

/**
 * `t(...)` call sites whose first argument is not a statically resolvable string
 * literal, i.e. the keys the scan above cannot prove are present in the table.
 *
 * Each entry is a potential silent gap, so the list is pinned by an allow-list
 * test: adding a dynamic call site forces a decision - cover the keys it can
 * produce with a test, or add it to the allow-list with a justification.
 */
function collectDynamicCallSites(): string[] {
  const sites: string[] = [];
  for (const file of collectTsFiles(SRC_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(T_CALL)) {
      // `export function t(key: string, ...)` is the declaration, not a call.
      if (/(?:export\s+)?function\s+$/.test(src.slice(Math.max(0, match.index - 20), match.index))) {
        continue;
      }
      const after = src.slice(match.index + match[0].length);
      const literal = /^\s*(?:'[^']*'|"[^"]*"|`[^`$]*`)/.exec(after);
      if (literal) {
        continue;
      }
      const arg = /^\s*([^\n,)]*)/.exec(after)?.[1].trim() ?? '';
      const line = src.slice(0, match.index).split('\n').length;
      sites.push(`${file.slice(SRC_DIR.length + 1)}:${line}  t(${arg.length > 0 ? arg : '?'})`);
    }
  }
  return sites.sort();
}

/** Dynamic call sites, each one covered by a dedicated assertion. */
const KNOWN_DYNAMIC_CALL_SITES: Record<string, string> = {
  'client/error.ts': 'every ErrorActionLink.labelKey listed in the client error tests',
  'provider/models.ts': '`model.<id>.detail` keys, resolved with a translation-probe fallback to m.detail',
  'runtime/provider.ts': 'the three provider label keys asserted by the per-vendor label test',
};

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

  it('detects a missing key whichever quoting style the call site uses', () => {
    // The scanner is the only thing standing between a typo and a raw key in a
    // toast, so the accepted syntaxes are pinned here instead of being assumed.
    for (const call of [
      "t('a.single.quoted.key')",
      't("a.double.quoted.key")',
      't(`a.backtick.key`)',
      "t(\n  'a.wrapped.key',\n)",
    ]) {
      expect([...call.matchAll(T_LITERAL_CALL)], `not matched: ${call}`).toHaveLength(1);
    }
  });

  it('reports every call site whose key cannot be resolved statically', () => {
    // A dynamic call is a hole in the static scan. Pinning the list means a new
    // one cannot be introduced silently: it has to be declared here.
    const sites = collectDynamicCallSites();
    expect(sites.length, `sites dynamiques non déclarés :\n  ${sites.join('\n  ')}`).toBeGreaterThan(0);
    const files = [...new Set(sites.map((site) => site.split(':')[0]))].sort();
    expect(files).toEqual(Object.keys(KNOWN_DYNAMIC_CALL_SITES).sort());
  });

  it('does not classify a literal call site as dynamic', () => {
    const dynamic = new Set(collectDynamicCallSites());
    expect(dynamic.size).toBe(collectDynamicCallSites().length);
    for (const site of dynamic) {
      expect(site, `literal key wrongly reported as dynamic: ${site}`).not.toMatch(/t\(['"`]/);
    }
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
