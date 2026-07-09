/**
 * 3-tier model registry loader.
 *
 * Orchestrates:
 *   1. Bundled registry  (`resources/models.json` shipped with the extension)
 *   2. globalStorage override (`<globalStorageUri>/models.json`)
 *   3. Workspace override   (`<workspaceFolder>/.vscode/aiflowbridge.models.json`)
 *
 * For each tier the loader:
 *   - Reads + JSON-parses the file. Missing files are NOT an error - they
 *     simply skip that tier.
 *   - Runs `validateRegistryStructure` (fail-hard). For the bundled tier,
 *     a structure error is fatal. For the override tiers, it logs a warning
 *     and skips the tier (the user can fix their override without
 *     bricking the extension).
 *   - Runs `validateRegistryContent` (fail-soft). Invalid entries are
 *     dropped and a `logger.warn()` is emitted per skip reason.
 *
 * Tiers are then merged in priority order bundled < globalStorage < workspace
 * via `mergeTiers`. The returned `ModelRegistry` is plain (the loader does
 * not freeze it) but is intended to be treated as immutable by callers.
 *
 * After `loadModelRegistry()` returns, the result is cached in a module-level
 * variable. Consumers in non-async code paths (class field initializers,
 * module-level constants, etc.) read the cached value via
 * `getLoadedRegistry()` / `tryGetLoadedRegistry()`. This is a temporary
 * seam: step 4 (provider refactor) and step 5 (config refactor) replace
 * the cache with proper async / constructor-injected access. Tests can
 * seed the cache with `setLoadedRegistry()`.
 *
 * `fs` and `workspaceFolder` are injectable to keep the loader unit-testable
 * without a real VS Code host.
 */

import * as vscode from 'vscode';
import { logger } from '../logger';
import {
  mergeTiers,
  type ModelRegistry,
  type RegistryModelDefinition,
  type RegistrySources,
  type ValidatedContent,
  validateRegistryContent,
  validateRegistryStructure,
} from './modelRegistry.schema';
import type { FileSystemLike, IGatewayContext, UriLike } from './types';

/** Path of the bundled registry, relative to the extension root. */
export const BUNDLED_REGISTRY_RELATIVE_PATH = ['resources', 'models.json'] as const;

/** Path of the globalStorage override, relative to `context.globalStorageUri`. */
export const GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH = ['models.json'] as const;

/** Path of the workspace override, relative to the workspace folder URI. */
export const WORKSPACE_REGISTRY_RELATIVE_PATH = ['.vscode', 'aiflowbridge.models.json'] as const;

export interface LoadModelRegistryOptions {
  /**
   * Filesystem used to read the three tiers. Defaults to `vscode.workspace.fs`.
   * Exposed for unit tests; only `readFile` is required.
   */
  fs?: Pick<vscode.FileSystem, 'readFile'> | FileSystemLike;
  /**
   * Workspace folder to use for the workspace tier. Defaults to
   * `vscode.workspace.workspaceFolders?.[0]`. Exposed for unit tests.
   */
  workspaceFolder?: vscode.WorkspaceFolder | UriLike | undefined;
}

interface TierLoadResult {
  tier: ValidatedContent<RegistryModelDefinition> | ValidatedContent<Partial<RegistryModelDefinition>> | undefined;
  exists: boolean;
}

/**
 * Generic shape accepted by `loadModelRegistry`. Both `vscode.ExtensionContext`
 * and `IGatewayContext` satisfy this shape - the
 * loader only needs `extensionUri`, `globalStorageUri` (or
 * `globalStorageDir`), and the optional `workspaceFolder`.
 */
type RegistryHost = Pick<IGatewayContext, 'extensionUri' | 'globalStorageDir' | 'workspaceFolder' | 'fs'> & {
  globalStorageUri?: { fsPath: string };
};

function resolveGlobalStorageDir(host: RegistryHost): string {
  if (host.globalStorageDir) {
    return host.globalStorageDir;
  }
  const uri = (host as { globalStorageUri?: { fsPath: string } }).globalStorageUri;
  return uri?.fsPath ?? '';
}

function resolveExtensionUri(host: RegistryHost): UriLike {
  if (host.extensionUri) {
    return host.extensionUri;
  }
  return { fsPath: '', toString: () => '' };
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

function resolveFs(host: RegistryHost, options: LoadModelRegistryOptions): Pick<vscode.FileSystem, 'readFile'> | FileSystemLike {
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
 * Load the 3-tier model registry. The bundled tier is required; override
 * tiers are optional.
 *
 * Throws on a structural error in the bundled tier or a JSON parse error in
 * any tier (i.e. the bundled registry is shipped with the extension, so a
 * broken shipped file is a programming error, not a recoverable condition).
 *
 * Accepts either a `vscode.ExtensionContext` (legacy VS Code entry point)
 * or an `IGatewayContext` ( standalone entry point). Both expose
 * `extensionUri`, `globalStorageUri` / `globalStorageDir`, and the optional
 * `workspaceFolder` / `fs` fields the loader needs.
 */
export async function loadModelRegistry(
  context: RegistryHost | vscode.ExtensionContext,
  options: LoadModelRegistryOptions = {}
): Promise<ModelRegistry> {
  // Idempotent: if the registry has already been loaded during this
  // activation, return the cached object. Re-loading would re-read the
  // bundled file from disk and re-validate, which is wasteful. The cache
  // is invalidated by a window reload - v1 requires a reload to pick up hot-edits of the globalStorage
  // file). For tests, `setLoadedRegistry(undefined)` clears it.
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const fs = resolveFs(context as RegistryHost, options);
  const rawWorkspaceFolder = options.workspaceFolder ?? resolveWorkspaceFolder(context as RegistryHost);
  const workspaceFolder: UriLike | undefined = rawWorkspaceFolder ? { fsPath: workspaceFsPath(rawWorkspaceFolder) } : undefined;
  const extensionUri = resolveExtensionUri(context as RegistryHost);
  const globalStorageDir = resolveGlobalStorageDir(context as RegistryHost);

  const bundledUri = joinPath(extensionUri, ...BUNDLED_REGISTRY_RELATIVE_PATH);
  const globalStorageUri = joinPath({ fsPath: globalStorageDir }, ...GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH);
  const workspaceUri = workspaceFolder ? joinPath(workspaceFolder, ...WORKSPACE_REGISTRY_RELATIVE_PATH) : undefined;

  const bundled = await loadTier(fs, bundledUri, 'bundled', { fatal: true, mode: 'strict' });
  const globalStorage = await loadTier(fs, globalStorageUri, 'globalStorage', { fatal: false, mode: 'partial' });
  const workspace = workspaceUri
    ? await loadTier(fs, workspaceUri, 'workspace', { fatal: false, mode: 'partial' })
    : { tier: undefined, exists: false };

  const merged = mergeTiers(bundled.tier, globalStorage.tier, workspace.tier);

  const sources: RegistrySources = {
    bundled: { exists: true, path: bundledUri.toString() },
    globalStorage: { exists: globalStorage.exists, path: globalStorageUri.toString() },
    workspace: { exists: workspace.exists, path: workspaceUri?.toString() ?? '' },
  };

  const result: ModelRegistry = { ...merged, sources };
  cachedRegistry = result;

  // Diagnostic: surface the resolved registry's pricing so the user can
  // confirm T3 (pricing override) is actually flowing through the loader.
  // Cheap, runs only once per activation, and is essential to debug the
  // "I edited the file but the dashboard still shows the old price" report.
  logger.info(`[AIFlowBridge] Model registry loaded (version ${result.version})`);
  logger.info(`[AIFlowBridge]   bundled      = ${sources.bundled.path} (always present)`);
  logger.info(`[AIFlowBridge]   globalStorage= ${sources.globalStorage.path} (exists=${globalStorage.exists})`);
  logger.info(`[AIFlowBridge]   workspace    = ${sources.workspace.path || '<none>'} (exists=${workspace.exists})`);
  for (const model of result.models) {
    const pricingStr = model.pricing
      ? `in=${model.pricing.inputPerMillion}/M out=${model.pricing.outputPerMillion}/M ${model.pricing.currency}`
      : '<no pricing>';
    logger.info(`[AIFlowBridge]   model ${model.id.padEnd(20)} family=${model.family.padEnd(10)} pricing=${pricingStr}`);
  }

  return result;
}

// ---- Cached accessors ----
// // The cache is populated by `loadModelRegistry()` during extension activation
// (see `src/runtime/lifecycle.ts`). Steps 4 (providers) and 5 (config) will
// replace this synchronous cache with proper async / constructor-injected
// access. For now, this seam lets us remove the compile-time constants
// (`MODELS`, `DEFAULT_PROVIDER_URLS`, `EXTERNAL_URLS`) from `src/consts.ts`
// while keeping call sites that run before the registry is loaded
// (module-level constants, class field initializers) working - the bundled
// tier is enough for those early reads.

let cachedRegistry: ModelRegistry | undefined;

/**
 * Return the registry that was loaded by the most recent
 * `loadModelRegistry()` call. Throws if no registry has been loaded yet.
 *
 * Intended for hot paths that run after extension activation (provider
 * methods, gateway request handlers, command handlers,...).
 */
export function getLoadedRegistry(): ModelRegistry {
  if (!cachedRegistry) {
    throw new Error(
      '[AIFlowBridge] Model registry accessed before loadModelRegistry() was called. ' +
        'Call it during extension activation (see src/runtime/lifecycle.ts).'
    );
  }
  return cachedRegistry;
}

/**
 * Same as `getLoadedRegistry()` but returns `undefined` if the registry
 * has not been loaded yet. Intended for code paths that may legitimately
 * run before activation (e.g. JSON schema validators, unit tests).
 */
export function tryGetLoadedRegistry(): ModelRegistry | undefined {
  return cachedRegistry;
}

/**
 * Override the cached registry. Intended for tests; production code should
 * always go through `loadModelRegistry()`.
 */
export function setLoadedRegistry(registry: ModelRegistry | undefined): void {
  cachedRegistry = registry;
}

async function loadTier(
  fs: Pick<vscode.FileSystem, 'readFile'> | FileSystemLike,
  uri: UriLike | vscode.Uri,
  label: 'bundled' | 'globalStorage' | 'workspace',
  options: { fatal: boolean; mode: 'strict' | 'partial' }
): Promise<TierLoadResult> {
  const raw = await readJsonFile(fs, uri);
  if (raw === undefined) {
    return { tier: undefined, exists: false };
  }

  const fsPath = (uri as { fsPath?: string }).fsPath ?? uri.toString();

  try {
    validateRegistryStructure(raw);
  } catch (err) {
    if (options.fatal) {
      throw err;
    }
    logger.warn(`[AIFlowBridge] Ignoring ${label} model registry at ${fsPath}: ${err instanceof Error ? err.message : String(err)}`);
    return { tier: undefined, exists: false };
  }

  const result = validateRegistryContent(raw, options.mode);
  for (const skip of result.log.skipped) {
    logger.warn(`[AIFlowBridge] Skipped invalid ${skip.kind} entry "${skip.key}" in ${label} model registry: ${skip.reason}`);
  }

  return { tier: result, exists: true };
}

/**
 * Read a JSON file from `uri`. Returns:
 *   - `undefined` if the file does not exist
 *   - the parsed JSON value otherwise
 *
 * Throws on JSON parse errors (the caller decides whether that's fatal).
 *
 * The `fs` argument may be either VS Code's `FileSystem` (whose `readFile`
 * accepts a `vscode.Uri`) or the standalone `FileSystemLike` (whose
 * `readFile` accepts a `UriLike`). Both shapes expose `readFile` and we
 * pass the supplied URI straight through - the caller picks which URI
 * shape to build.
 */
async function readJsonFile(fs: Pick<vscode.FileSystem, 'readFile'> | FileSystemLike, uri: UriLike | vscode.Uri): Promise<unknown | undefined> {
  let bytes: Uint8Array;
  try {
    // `fs.readFile` accepts `vscode.Uri` (VS Code adapter) or `UriLike`
    // (standalone adapter). The two shapes share `fsPath` so we cast
    // through `unknown` to bridge the union.
    bytes = await (fs.readFile as (u: UriLike | vscode.Uri) => Promise<Uint8Array>)(uri);
  } catch (err) {
    if (isFileNotFoundError(err)) {
      return undefined;
    }
    throw err;
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  return JSON.parse(text) as unknown;
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
