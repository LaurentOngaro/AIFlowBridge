/**
 * Pricing registry loader.
 *
 * 4-tier merge (highest priority first):
 *   1. Workspace override (`<workspaceFolder>/.vscode/aiflowbridge.pricing.json`)
 *   2. globalStorage override (`<globalStorageUri>/pricing-override.json`)
 *   3. Bundled `resources/pricing.json`
 *   4. Per-model `pricing` blocks from the merged model registry
 *      (`resources/models.json` -> 3-tier merge in `loadModelRegistry`)
 *
 * Per-entry deep merge: an override that only specifies `inputPerMillion`
 * keeps the lower tier's `outputPerMillion` / `currency` / `fetchedAt`.
 * Missing / malformed override files are logged at WARN and skipped
 * (activation never crashes). The bundled file is mandatory; a missing or
 * malformed bundled file logs at WARN and the registry returns whatever
 * the override tiers had. The fallback chain (`models.json` per-model
 * blocks) lives in `host-config.ts` so this loader stays focused on the
 * dedicated pricing JSON files.
 *
 * The merged result is cached in a module-level variable; `setPricingRegistry()`
 * and `replacePricingEntries()` exist for the user-side refresh path so
 * the in-memory map can be updated without re-reading the files. Consumers
 * in hot paths read the cached value via `getLoadedPricingRegistry()`.
 */

import * as vscode from 'vscode';
import { logger } from '../../logger';
import type { FileSystemLike, IGatewayContext, UriLike } from '../types';
import type { PricingEntry } from './openrouter-fetch';

/** Re-export for callers that don't want to reach into the openrouter-fetch module. */
export type { PricingEntry } from './openrouter-fetch';

/** Path of the bundled pricing JSON, relative to the extension root. */
export const BUNDLED_PRICING_RELATIVE_PATH = ['resources', 'pricing.json'] as const;

/** Path of the globalStorage override, relative to `context.globalStorageDir`. */
export const GLOBAL_STORAGE_PRICING_RELATIVE_PATH = ['pricing-override.json'] as const;

/** Path of the workspace override, relative to the workspace folder URI. */
export const WORKSPACE_PRICING_RELATIVE_PATH = ['.vscode', 'aiflowbridge.pricing.json'] as const;

export interface LoadPricingRegistryOptions {
  /** Filesystem used to read the three tiers. Defaults to `vscode.workspace.fs`. */
  fs?: Pick<vscode.FileSystem, 'readFile'> | FileSystemLike;
  /** Workspace folder override for tests. Defaults to `host.workspaceFolder`. */
  workspaceFolder?: vscode.WorkspaceFolder | UriLike | undefined;
}

/** Shape of the bundled / override pricing JSON file. */
export interface PricingFile {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  sourceUrl?: string;
  aiflowbridgeVersion?: string;
  /** Per-model id pricing map. */
  models: Record<string, PricingEntry>;
}

/**
 * Pricing registry as consumed by `host-config.ts`. The 4-tier merge
 * collapses the three file tiers + the per-model `models.json` blocks
 * into a single map keyed by upstream model id. The per-model map is
 * passed in by the caller so this loader stays decoupled from the
 * model registry (which has its own 3-tier load lifecycle).
 */
export interface PricingRegistry {
  /** Final merged map: upstream model id -> pricing entry. */
  models: Record<string, PricingEntry>;
  /**
   * Per-model provenance so the diagnostic can label each row.
   * Keys are upstream model ids (the same as `models`).
   */
  sourceByModel: Record<string, PricingSource>;
  /** Per-tier file provenance (path + exists) for the diagnostic. */
  sources: PricingSources;
  /** The fetchedAt / generatedAt stamp from the bundled file (or empty). */
  bundledFetchedAt: string;
  /** The AIFlowBridge version that produced the bundled file (or empty). */
  bundledVersion: string;
}

export interface PricingSources {
  bundled: { exists: boolean; path: string };
  globalStorage: { exists: boolean; path: string };
  workspace: { exists: boolean; path: string };
}

/** Diagnostic label per model, used by `host-config.ts` for the per-row log line. */
export type PricingSource = 'override (workspace)' | 'override (globalStorage)' | 'bundled (pricing.json)' | 'bundled (models.json)';

/**
 * Alias kept for the `AiFlowBridgeConfig.pricing.sources` shape so the
 * public `types.ts` interface (`PricingSourceLabel`) does not need to
 * import this internal type. Structurally identical to `PricingSource`.
 */
export type PricingSourceLabel = PricingSource;

interface RegistryHost {
  extensionUri?: UriLike;
  globalStorageDir?: string;
  globalStorageUri?: { fsPath: string };
  workspaceFolder?: vscode.WorkspaceFolder | UriLike | undefined;
  fs?: FileSystemLike;
}

function resolveGlobalStorageDir(host: RegistryHost): string {
  if (host.globalStorageDir) {
    return host.globalStorageDir;
  }
  return host.globalStorageUri?.fsPath ?? '';
}

function resolveExtensionUri(host: RegistryHost): UriLike {
  if (host.extensionUri) {
    return host.extensionUri;
  }
  return { fsPath: '', toString: () => '' } as UriLike;
}

function resolveWorkspaceFolder(host: RegistryHost): UriLike | { uri: vscode.Uri } | undefined {
  if (host.workspaceFolder) {
    return host.workspaceFolder as UriLike | { uri: vscode.Uri };
  }
  return undefined;
}

function workspaceFsPath(folder: UriLike | { uri: vscode.Uri }): string {
  if ('fsPath' in folder) {
    return (folder as UriLike).fsPath;
  }
  return (folder as { uri: vscode.Uri }).uri.fsPath;
}

function resolveFs(host: RegistryHost, options: LoadPricingRegistryOptions): Pick<vscode.FileSystem, 'readFile'> | FileSystemLike {
  if (options.fs) {
    return options.fs;
  }
  if (host.fs) {
    return host.fs;
  }
  return vscode.workspace.fs;
}

function joinPath(base: UriLike, ...segments: string[]): UriLike {
  const cleaned = base.fsPath.replace(/\/+$/, '');
  const fsPath = [cleaned, ...segments].join('/');
  return {
    fsPath,
    toString: () => fsPath,
  } as UriLike;
}

/**
 * Load the 3-tier pricing registry from the file system and merge it
 * over the per-model `pricing` blocks from the already-loaded model
 * registry. Returns a `PricingRegistry` whose `models` map is keyed
 * by upstream model id and which carries the provenance of every
 * tier for the diagnostic log.
 *
 * Idempotent: subsequent calls return the cached registry unless the
 * caller invalidated it via `setPricingRegistry(undefined)`.
 */
export async function loadPricingRegistry(
  context: RegistryHost | vscode.ExtensionContext | IGatewayContext,
  options: LoadPricingRegistryOptions = {},
  perModelPricing?: Record<string, PricingEntry>
): Promise<PricingRegistry> {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const fs = resolveFs(context as RegistryHost, options);
  const rawWorkspaceFolder = options.workspaceFolder ?? resolveWorkspaceFolder(context as RegistryHost);
  const workspaceFolder: UriLike | undefined = rawWorkspaceFolder ? { fsPath: workspaceFsPath(rawWorkspaceFolder) } : undefined;
  const extensionUri = resolveExtensionUri(context as RegistryHost);
  const globalStorageDir = resolveGlobalStorageDir(context as RegistryHost);

  const bundledUri = joinPath(extensionUri, ...BUNDLED_PRICING_RELATIVE_PATH);
  const globalStorageUri = joinPath({ fsPath: globalStorageDir } as UriLike, ...GLOBAL_STORAGE_PRICING_RELATIVE_PATH);
  const workspaceUri = workspaceFolder ? joinPath(workspaceFolder, ...WORKSPACE_PRICING_RELATIVE_PATH) : undefined;

  const bundled = await readTier(fs, bundledUri, 'bundled', { fatal: false });
  const globalStorage = await readTier(fs, globalStorageUri, 'globalStorage', { fatal: false });
  const workspace = workspaceUri ? await readTier(fs, workspaceUri, 'workspace', { fatal: false }) : { file: undefined, exists: false };

  // Merge priority: workspace > globalStorage > bundled > per-model models.json blocks.
  const sources: Record<string, PricingSource> = {};
  const merged: Record<string, PricingEntry> = {};

  if (bundled.file) {
    for (const [id, entry] of Object.entries(bundled.file.models)) {
      if (entry) {
        merged[id] = entry;
        sources[id] = 'bundled (pricing.json)';
      }
    }
  }
  if (globalStorage.file) {
    for (const [id, entry] of Object.entries(globalStorage.file.models)) {
      if (entry) {
        merged[id] = mergeEntry(merged[id], entry);
        sources[id] = 'override (globalStorage)';
      }
    }
  }
  if (workspace.file) {
    for (const [id, entry] of Object.entries(workspace.file.models)) {
      if (entry) {
        merged[id] = mergeEntry(merged[id], entry);
        sources[id] = 'override (workspace)';
      }
    }
  }
  // Lowest priority: per-model `pricing` blocks from `resources/models.json`.
  // Used as the final fallback so a model that does not have a rate in
  // `pricing.json` still picks up its registry-level tariff.
  if (perModelPricing) {
    for (const [id, entry] of Object.entries(perModelPricing)) {
      if (entry && !merged[id]) {
        merged[id] = entry;
        sources[id] = 'bundled (models.json)';
      }
    }
  }

  const result: PricingRegistry = {
    models: merged,
    sourceByModel: sources,
    sources: {
      bundled: { exists: bundled.exists, path: bundledUri.toString() },
      globalStorage: { exists: globalStorage.exists, path: globalStorageUri.toString() },
      workspace: { exists: workspace.exists, path: workspaceUri?.toString() ?? '' },
    },
    bundledFetchedAt: bundled.file?.generatedAt ?? '',
    bundledVersion: bundled.file?.aiflowbridgeVersion ?? '',
  };
  cachedRegistry = result;
  cachedSources = sources;

  // Diagnostic: surface the resolved per-tier provenance so the user can
  // confirm T1 (workspace) and T2 (globalStorage) are actually flowing
  // through the loader.
  logger.info(`[AIFlowBridge] Pricing registry loaded (bundled generatedAt=${result.bundledFetchedAt || '<none>'} v${result.bundledVersion || '<none>'})`);
  logger.info(`[AIFlowBridge]   bundled      = ${result.sources.bundled.path} (exists=${bundled.exists})`);
  logger.info(`[AIFlowBridge]   globalStorage= ${result.sources.globalStorage.path} (exists=${globalStorage.exists})`);
  logger.info(`[AIFlowBridge]   workspace    = ${result.sources.workspace.path || '<none>'} (exists=${workspace.exists})`);
  const changedModels = Object.keys(merged).filter((id) => sources[id] !== 'bundled (pricing.json)' && sources[id] !== 'bundled (models.json)');
  if (changedModels.length > 0) {
    logger.info(`[AIFlowBridge]   ${changedModels.length} model(s) sourced from override tier: ${changedModels.slice(0, 10).join(', ')}${changedModels.length > 10 ? ', ...' : ''}`);
  }

  return result;
}

/**
 * Return the cached pricing registry. Throws if it has not been loaded
 * yet. Intended for hot paths (host-config synthesis, dashboard rendering).
 */
export function getLoadedPricingRegistry(): PricingRegistry {
  if (!cachedRegistry) {
    throw new Error('[AIFlowBridge] Pricing registry accessed before loadPricingRegistry() was called.');
  }
  return cachedRegistry;
}

export function tryGetLoadedPricingRegistry(): PricingRegistry | undefined {
  return cachedRegistry;
}

export function setPricingRegistry(registry: PricingRegistry | undefined): void {
  cachedRegistry = registry;
  cachedSources = {};
}

/**
 * Update the in-memory pricing registry in place with a fresh per-model
 * map. Used by the user-side `Refresh pricing now` command and the
 * dashboard `Refresh prices` button so the dashboard, the tooltips,
 * and the next request pick up the new rates without a window reload.
 *
 * `overrides` is a `{ modelId -> PricingEntry }` map written to the
 * globalStorage override file by the caller. This function merges it
 * over the cached registry (overrides win) and re-labels the source
 * tag so the diagnostic surfaces which models changed.
 */
export function replacePricingEntries(
  entries: Record<string, PricingEntry>,
  source: PricingSource = 'override (globalStorage)'
): PricingRegistry | undefined {
  if (!cachedRegistry) {
    return undefined;
  }
  const next: Record<string, PricingEntry> = { ...cachedRegistry.models };
  for (const [id, entry] of Object.entries(entries)) {
    if (!entry) {
      continue;
    }
    next[id] = mergeEntry(next[id], entry);
    cachedSources[id] = source;
  }
  const updated: PricingRegistry = {
    ...cachedRegistry,
    models: next,
  };
  cachedRegistry = updated;
  for (const id of Object.keys(entries)) {
    logger.info(`[AIFlowBridge]   pricing ${id}: source=${cachedSources[id] ?? source} in=${entries[id].inputPerMillion}/M out=${entries[id].outputPerMillion}/M`);
  }
  return updated;
}

/** Read the cached source tag for a single model id. */
export function getPricingSource(modelId: string): PricingSource | undefined {
  return cachedSources[modelId];
}

let cachedRegistry: PricingRegistry | undefined;
let cachedSources: Record<string, PricingSource> = {};

interface TierLoadResult {
  file: PricingFile | undefined;
  exists: boolean;
}

async function readTier(
  fs: Pick<vscode.FileSystem, 'readFile'> | FileSystemLike,
  uri: UriLike,
  label: 'bundled' | 'globalStorage' | 'workspace',
  options: { fatal: boolean }
): Promise<TierLoadResult> {
  let raw: unknown;
  try {
    const bytes = await (fs.readFile as (u: UriLike) => Promise<Uint8Array>)(uri);
    const text = new TextDecoder('utf-8').decode(bytes);
    raw = JSON.parse(text);
  } catch (err) {
    if (isFileNotFoundError(err)) {
      return { file: undefined, exists: false };
    }
    logger.warn(`[AIFlowBridge] Failed to read ${label} pricing at ${uri.toString()}: ${err instanceof Error ? err.message : String(err)}`);
    return { file: undefined, exists: false };
  }

  const file = parsePricingFile(raw);
  if (!file) {
    logger.warn(`[AIFlowBridge] Ignoring ${label} pricing at ${uri.toString()}: malformed JSON shape.`);
    return { file: undefined, exists: false };
  }
  return { file, exists: true };
}

function parsePricingFile(raw: unknown): PricingFile | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.schemaVersion !== 'number') {
    return undefined;
  }
  // Current schemaVersion is 1; old / future shapes are tolerated but
  // their `models` map must still be a plain object. A more aggressive
  // migration would live here.
  if (!obj.models || typeof obj.models !== 'object' || Array.isArray(obj.models)) {
    return undefined;
  }
  const models: Record<string, PricingEntry> = {};
  for (const [id, rawEntry] of Object.entries(obj.models as Record<string, unknown>)) {
    const entry = parsePricingEntry(rawEntry);
    if (entry) {
      models[id] = entry;
    }
  }
  return {
    schemaVersion: obj.schemaVersion,
    generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : '',
    source: typeof obj.source === 'string' ? obj.source : '',
    sourceUrl: typeof obj.sourceUrl === 'string' ? obj.sourceUrl : undefined,
    aiflowbridgeVersion: typeof obj.aiflowbridgeVersion === 'string' ? obj.aiflowbridgeVersion : undefined,
    models,
  };
}

function parsePricingEntry(raw: unknown): PricingEntry | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const inputPerMillion = obj.inputPerMillion;
  const outputPerMillion = obj.outputPerMillion;
  if (typeof inputPerMillion !== 'number' || !Number.isFinite(inputPerMillion) || inputPerMillion < 0) {
    return undefined;
  }
  if (typeof outputPerMillion !== 'number' || !Number.isFinite(outputPerMillion) || outputPerMillion < 0) {
    return undefined;
  }
  const currency = typeof obj.currency === 'string' && obj.currency.length > 0 ? obj.currency : 'USD';
  const fetchedAt = typeof obj.fetchedAt === 'string' ? obj.fetchedAt : '';
  return {
    inputPerMillion,
    outputPerMillion,
    currency: currency as PricingEntry['currency'],
    fetchedAt,
  };
}

function mergeEntry(base: PricingEntry | undefined, override: PricingEntry): PricingEntry {
  if (!base) {
    return override;
  }
  return {
    inputPerMillion: override.inputPerMillion,
    outputPerMillion: override.outputPerMillion,
    currency: override.currency,
    fetchedAt: override.fetchedAt || base.fetchedAt,
  };
}

function isFileNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  if (code === 'FileNotFound' || code === 'ENOENT') {
    return true;
  }
  const name = (err as { name?: unknown }).name;
  if (name === 'EntryNotFound' || name === 'FileNotFound') {
    return true;
  }
  return false;
}
