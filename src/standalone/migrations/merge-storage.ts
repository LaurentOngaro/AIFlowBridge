/**
 * One-shot storage merge utility.
 *
 * Background:
 *   Before 2.8.1, the standalone CLI (`aiflowbridge-server`) wrote its
 *   telemetry to `~/.aiflowbridge/telemetry.json` and its secrets to
 *   `~/.aiflowbridge/secrets.json`, while the VS Code extension wrote
 *   to `<globalStorageUri>/telemetry.json` and the VS Code SecretStorage
 *   API respectively. The two paths diverged on the user's machine, so
 *   the dashboard (which reads the extension path) only saw the entries
 *   recorded by the extension's own embedded gateway - every request
 *   that flowed through the standalone was invisible to the dashboard,
 *   and the standalone could not read the API keys the user had typed
 *   into VS Code's `setApiKey` command (it would 1004 on the first
 *   upstream call).
 *
 *   Starting with 2.8.1, the standalone defaults to the same path as
 *   the extension when the extension is installed (see
 *   `src/standalone/storage-dir.ts`). On a machine where the two
 *   paths already contain different data files, the user must run this
 *   script once to merge them BEFORE the next standalone restart so the
 *   dashboard does not silently drop the standalone's history and the
 *   standalone picks up the API keys the user stored via the VS Code
 *   extension.
 *
 * Usage:
 *   node dist/standalone/migrations/merge-storage.js
 *     [--ext <dir>]         # override the extension storage dir
 *     [--standalone <dir>]  # override the standalone storage dir
 *     [--dry-run]           # report the merge plan without writing
 *
 * Merged files:
 *   - `telemetry.json`: deduplicated union by `entry.id` (UUID v4);
 *     aggregates recomputed via `applyEntryToSnapshot` (the same
 *     function the persister uses) so the merged snapshot is
 *     bit-identical to what the gateway would have produced if it
 *     had always written to one path.
 *   - `secrets.json`: union by key. The extension's VS Code
 *     SecretStorage is not readable from this script (it lives
 *     inside the VS Code process), so the secrets merge is only
 *     between the file-based secrets at the extension's
 *     `globalStorageDir/secrets.json` (if present) and the
 *     standalone's `~/.aiflowbridge/secrets.json`. The extension's
 *     VS Code SecretStorage keys are NOT touched by this script -
 *     they stay in VS Code where the extension reads them.
 *
 * Safety:
 *   - Both source files are backed up to `<file>.bak-<timestamp>`
 *     before any write.
 *   - The telemetry merge is a union by `entry.id` (UUID v4).
 *     Duplicate entries across the two files are deduplicated, not
 *     double-counted.
 *   - Aggregate counters (requests, tokens, cost, ...) and the
 *     byProvider / byModel / byClient / bySource maps are recomputed
 *     from the unique entries using `applyEntryToSnapshot`.
 *   - Entries are applied in chronological order (oldest first) so
 *     `averageDurationMs` is computed correctly by the running
 *     weighted mean.
 *   - If the merge would result in any data loss (fewer unique
 *     entries than the larger of the two source files), the script
 *     aborts and refuses to write.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { homedir, platform } from 'node:os';

import { applyEntryToSnapshot, emptyTelemetrySnapshot } from '../../aiflowbridge/telemetry';
import type { RequestTelemetry, TelemetrySnapshot } from '../../aiflowbridge/types';

const DEFAULT_STORAGE_DIRNAME = '.aiflowbridge';
const EXTENSION_PUBLISHER = 'LaurentOngaro';
const EXTENSION_NAME = 'aiflowbridge';

interface CliArgs {
  extDir: string | undefined;
  standaloneDir: string | undefined;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let extDir: string | undefined;
  let standaloneDir: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ext') {
      extDir = argv[++i];
    } else if (arg === '--standalone') {
      standaloneDir = argv[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { extDir, standaloneDir, dryRun };
}

function defaultExtensionDir(): string {
  let base: string;
  switch (platform()) {
    case 'win32': {
      const appData = process.env.APPDATA;
      if (!appData) throw new Error('APPDATA is not set on Windows');
      base = `${appData}\\Code\\User\\globalStorage`;
      break;
    }
    case 'darwin':
      base = `${homedir()}/Library/Application Support/Code/User/globalStorage`;
      break;
    default: {
      const xdgConfig = process.env.XDG_CONFIG_HOME;
      base = xdgConfig ? `${xdgConfig}/Code/User/globalStorage` : `${homedir()}/.config/Code/User/globalStorage`;
      break;
    }
  }
  return resolve(base, `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`);
}

function defaultStandaloneDir(): string {
  const home = homedir();
  if (platform() === 'win32') {
    return resolve(home, DEFAULT_STORAGE_DIRNAME);
  }
  return resolve(home, `.${DEFAULT_STORAGE_DIRNAME}`);
}

function readSnapshot(path: string): TelemetrySnapshot | null {
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, 'utf8');
  try {
    const parsed = JSON.parse(raw) as TelemetrySnapshot;
    if (!Array.isArray(parsed.recent)) {
      throw new Error('missing recent[]');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readSecrets(path: string): Record<string, string> | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) {
        result[key] = value;
      }
    }
    return result;
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function backup(path: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${path}.bak-${timestamp}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

function mergeTelemetry(ext: TelemetrySnapshot | null, standalone: TelemetrySnapshot | null): TelemetrySnapshot {
  const seen = new Map<string, RequestTelemetry>();
  for (const entry of ext?.recent ?? []) {
    seen.set(entry.id, entry);
  }
  for (const entry of standalone?.recent ?? []) {
    seen.set(entry.id, entry);
  }
  // Chronological order so the running average in `applyEntryToSnapshot`
  // is computed in the same direction the persister would have.
  const ordered = [...seen.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const merged = emptyTelemetrySnapshot();
  for (const entry of ordered) {
    applyEntryToSnapshot(merged, entry);
  }
  return merged;
}

function mergeSecrets(ext: Record<string, string> | null, standalone: Record<string, string> | null): Record<string, string> {
  // The extension's keys (if present) take priority - the user most
  // recently stored them through the VS Code command palette, which
  // is the canonical entry point. Standalone-only keys are kept so
  // the user does not lose a key set through a CLI flag or env var
  // snapshot.
  return { ...(standalone ?? {}), ...(ext ?? {}) };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function reportTelemetry(
  extPath: string,
  standalonePath: string,
  extSnap: TelemetrySnapshot | null,
  standaloneSnap: TelemetrySnapshot | null,
  dryRun: boolean
): { merged: TelemetrySnapshot; uniqueCount: number; maxSingle: number } | null {
  if (!extSnap && !standaloneSnap) {
    console.log('[merge-storage/telemetry] No telemetry files at either path.');
    return null;
  }
  const extCount = extSnap?.recent.length ?? 0;
  const standaloneCount = standaloneSnap?.recent.length ?? 0;
  console.log(`[merge-storage/telemetry] Extension:  ${formatNumber(extCount)} entries at ${extPath}`);
  console.log(`[merge-storage/telemetry] Standalone: ${formatNumber(standaloneCount)} entries at ${standalonePath}`);

  const merged = mergeTelemetry(extSnap, standaloneSnap);
  const uniqueCount = merged.recent.length;
  const deduped = extCount + standaloneCount - uniqueCount;
  console.log(`[merge-storage/telemetry] Union:      ${formatNumber(uniqueCount)} unique entries (${formatNumber(deduped)} duplicates removed)`);

  const maxSingle = Math.max(extCount, standaloneCount);
  if (uniqueCount < maxSingle) {
    throw new Error(
      `Refusing to merge telemetry: result has ${uniqueCount} entries but at least one source had ${maxSingle}. ` +
        `This should be impossible (UUIDs are unique); aborting to protect user data.`
    );
  }
  void dryRun;
  return { merged, uniqueCount, maxSingle };
}

function reportSecrets(
  extPath: string,
  standalonePath: string,
  extSecrets: Record<string, string> | null,
  standaloneSecrets: Record<string, string> | null
): Record<string, string> | null {
  if (!extSecrets && !standaloneSecrets) {
    console.log('[merge-storage/secrets] No secrets files at either path.');
    return null;
  }
  const extKeys = Object.keys(extSecrets ?? {});
  const standaloneKeys = Object.keys(standaloneSecrets ?? {});
  console.log(`[merge-storage/secrets] Extension:  ${formatNumber(extKeys.length)} keys at ${extPath}`);
  console.log(`[merge-storage/secrets] Standalone: ${formatNumber(standaloneKeys.length)} keys at ${standalonePath}`);

  const merged = mergeSecrets(extSecrets, standaloneSecrets);
  const mergedKeys = Object.keys(merged);
  console.log(`[merge-storage/secrets] Union:      ${formatNumber(mergedKeys.length)} keys (${mergedKeys.join(', ')})`);
  return merged;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const extDir = args.extDir ?? defaultExtensionDir();
  const standaloneDir = args.standaloneDir ?? defaultStandaloneDir();

  const extTelemetryPath = join(extDir, 'telemetry.json');
  const standaloneTelemetryPath = join(standaloneDir, 'telemetry.json');
  const extSecretsPath = join(extDir, 'secrets.json');
  const standaloneSecretsPath = join(standaloneDir, 'secrets.json');

  console.log('[merge-storage] ------------------ telemetry ------------------');
  console.log(`[merge-storage] Extension dir:  ${extDir}`);
  console.log(`[merge-storage] Standalone dir: ${standaloneDir}`);
  console.log(`[merge-storage] Mode:           ${args.dryRun ? 'DRY RUN (no writes)' : 'live'}`);

  const extSnap = readSnapshot(extTelemetryPath);
  const standaloneSnap = readSnapshot(standaloneTelemetryPath);
  const telemetryReport = reportTelemetry(extTelemetryPath, standaloneTelemetryPath, extSnap, standaloneSnap, args.dryRun);

  console.log('[merge-storage] ------------------ secrets -------------------');
  const extSecrets = readSecrets(extSecretsPath);
  const standaloneSecrets = readSecrets(standaloneSecretsPath);
  const mergedSecrets = reportSecrets(extSecretsPath, standaloneSecretsPath, extSecrets, standaloneSecrets);

  if (args.dryRun) {
    console.log('[merge-storage] Dry run complete - no files written.');
    return;
  }

  // ---- telemetry writes ----
  if (telemetryReport && extSnap) {
    const backupPath = backup(extTelemetryPath);
    console.log(`[merge-storage/telemetry] Backup: ext -> ${backupPath}`);
  }
  if (telemetryReport && standaloneSnap) {
    const backupPath = backup(standaloneTelemetryPath);
    console.log(`[merge-storage/telemetry] Backup: standalone -> ${backupPath}`);
  }
  if (telemetryReport) {
    writeFileSync(extTelemetryPath, JSON.stringify(telemetryReport.merged, null, 2), 'utf8');
    console.log(`[merge-storage/telemetry] Wrote merged snapshot (${formatNumber(telemetryReport.uniqueCount)} entries) to ${extTelemetryPath}`);
    if (standaloneSnap) {
      writeFileSync(standaloneTelemetryPath, JSON.stringify(emptyTelemetrySnapshot(), null, 2), 'utf8');
      console.log(`[merge-storage/telemetry] Cleared ${standaloneTelemetryPath}`);
    }
  }

  // ---- secrets writes ----
  if (mergedSecrets && Object.keys(mergedSecrets).length > 0) {
    const hasExt = extSecrets && Object.keys(extSecrets).length > 0;
    const hasStandalone = standaloneSecrets && Object.keys(standaloneSecrets).length > 0;
    if (hasExt) {
      const backupPath = backup(extSecretsPath);
      console.log(`[merge-storage/secrets] Backup: ext -> ${backupPath}`);
    }
    if (hasStandalone) {
      const backupPath = backup(standaloneSecretsPath);
      console.log(`[merge-storage/secrets] Backup: standalone -> ${backupPath}`);
    }
    writeFileSync(extSecretsPath, JSON.stringify(mergedSecrets, null, 2), 'utf8');
    console.log(`[merge-storage/secrets] Wrote merged secrets (${Object.keys(mergedSecrets).length} keys) to ${extSecretsPath}`);
    if (hasStandalone) {
      writeFileSync(standaloneSecretsPath, JSON.stringify({}, null, 2), 'utf8');
      console.log(`[merge-storage/secrets] Cleared ${standaloneSecretsPath}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`[merge-storage] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
