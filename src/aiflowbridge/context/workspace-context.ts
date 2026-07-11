/**
 * Workspace context detection (action plan item #2).
 *
 * The gateway injects a system-message prefix into every
 * `/v1/chat/completions` call so the upstream LLM knows which
 * language / package manager / linter governs the project the user
 * is editing. This is a meaningful quality lift for polyglot
 * projects: the LLM gets Python idioms in a Python project,
 * Cargo conventions in a Rust project, etc., instead of guessing
 * from the message body alone.
 *
 * The detection is cheap and offline: we walk the workspace root
 * once (max depth, ignored subdirectories, capped file count) and
 * match well-known manifest / config filenames. No network, no
 * parsing, no shell-out.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '../../logger';

/**
 * Per-root cache for `detectWorkspaceContext`. The detector walks up to
 * `maxDepth * maxEntries` files on every call (CR02 B1). When the
 * gateway handles a chat-completion burst the same workspace is
 * walked twice per request (once for system-message injection, once
 * for the language-routing hint), so we memoize on the
 * `root + maxDepth + ignoredDirs` key with a 5 s TTL.
 *
 * `/review uncommitted` F1: the previous revision re-checked the
 * root's `mtimeMs` on every cache hit, which left one `statSync`
 * syscall on the request hot path (the very thing the cache was
 * meant to remove). The TTL alone is short enough that a developer
 * who creates a new `package.json` sees the updated routing within
 * a handful of seconds, so the mtime recheck on hit is dropped.
 * `clearWorkspaceContextCache()` is still exported so a hot config
 * reload can invalidate the slot on demand.
 */
const DETECT_CACHE_TTL_MS = 5_000;

interface DetectCacheEntry {
  context: WorkspaceContext;
  // captured at insert time; entry expires after `now > expiresAt`.
  expiresAt: number;
}

const detectCache = new Map<string, DetectCacheEntry>();

function detectCacheKey(root: string, options: Required<DetectOptions>): string {
  // Serialise the ignoredDirs set deterministically so two calls with
  // semantically-equal options share the same cache slot.
  const ignored = Array.from(options.ignoredDirs).sort().join('|');
  return `${root}\u0001${options.maxDepth}\u0001${ignored}`;
}

/**
 * Cached variant of `detectWorkspaceContext`. Behaviour is identical
 * to the uncached helper except a fresh walk is skipped when the
 * cache holds an entry that was computed less than
 * `DETECT_CACHE_TTL_MS` ago. Cache misses (first call, TTL expired)
 * fall through to `detectWorkspaceContext()` and repopulate the slot.
 */
export function detectWorkspaceContextCached(root: string, options: DetectOptions = {}): WorkspaceContext {
  const merged: Required<DetectOptions> = { ...DEFAULT_OPTIONS, ...options };
  const key = detectCacheKey(root, merged);
  const now = Date.now();
  const cached = detectCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.context;
  }
  const context = detectWorkspaceContext(root, merged);
  detectCache.set(key, { context, expiresAt: now + DETECT_CACHE_TTL_MS });
  return context;
}

/**
 * Drop every cached entry. Exported so the gateway can invalidate
 * the cache on hot config reload (the user changed
 * `gateway.workspaceContext.ignoredDirs`, etc.) and so the test
 * suite can start from a clean slate between blocks.
 */
export function clearWorkspaceContextCache(): void {
  detectCache.clear();
}

/**
 * The languages we recognise today. The list is intentionally
 * small - the implementation is non-exhaustive by design; the
 * dashboard surfaces the detected language(s) so the user can
 * verify coverage.
 */
export type WorkspaceLanguage =
  | 'python'
  | 'rust'
  | 'go'
  | 'javascript'
  | 'typescript'
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'ruby'
  | 'elixir'
  | 'swift'
  | 'php'
  | 'cpp';

interface LanguageMarker {
  /** Sentinel filename at the workspace root or any subdirectory (no recursion past this depth). */
  filename: string;
  /** Detected language. Multiple markers can resolve to the same language (polyglot projects). */
  language: WorkspaceLanguage;
  /** Optional package manager deduced from a sibling filename. */
  packageManager?: string;
  /** Optional linter deduced from a sibling filename. */
  linter?: string;
  /** Optional formatter deduced from a sibling filename. */
  formatter?: string;
}

const LANGUAGE_MARKERS: LanguageMarker[] = [
  // Python
  { filename: 'pyproject.toml', language: 'python', packageManager: 'poetry / uv / pdm', linter: 'ruff / pylint / flake8', formatter: 'black / ruff' },
  { filename: 'requirements.txt', language: 'python', packageManager: 'pip' },
  { filename: 'Pipfile', language: 'python', packageManager: 'pipenv' },
  { filename: 'setup.py', language: 'python' },
  // Rust
  { filename: 'Cargo.toml', language: 'rust', packageManager: 'cargo', linter: 'clippy', formatter: 'rustfmt' },
  // Go
  { filename: 'go.mod', language: 'go', packageManager: 'go modules', linter: 'golangci-lint / staticcheck', formatter: 'gofmt' },
  // JavaScript / TypeScript
  { filename: 'package.json', language: 'javascript', packageManager: 'npm / pnpm / yarn / bun', linter: 'eslint / biome', formatter: 'prettier / biome' },
  { filename: 'tsconfig.json', language: 'typescript' },
  { filename: 'pnpm-workspace.yaml', language: 'javascript', packageManager: 'pnpm' },
  { filename: 'bun.lockb', language: 'javascript', packageManager: 'bun' },
  // Java / Kotlin
  { filename: 'pom.xml', language: 'java', packageManager: 'maven' },
  { filename: 'build.gradle', language: 'java', packageManager: 'gradle' },
  { filename: 'build.gradle.kts', language: 'kotlin', packageManager: 'gradle (Kotlin DSL)' },
  // C#
  { filename: '*.csproj', language: 'csharp', packageManager: 'nuget' },
  // Ruby
  { filename: 'Gemfile', language: 'ruby', packageManager: 'bundler' },
  // Elixir
  { filename: 'mix.exs', language: 'elixir', packageManager: 'mix', formatter: 'mix format' },
  // Swift
  { filename: 'Package.swift', language: 'swift', packageManager: 'swift package manager' },
  // PHP
  { filename: 'composer.json', language: 'php', packageManager: 'composer' },
  // C++
  { filename: 'CMakeLists.txt', language: 'cpp', packageManager: 'cmake' },
  { filename: 'meson.build', language: 'cpp', packageManager: 'meson' },
];

/**
 * `/review uncommitted` F2: the marker table is precompiled once
 * at module load so the walk callback does not allocate a fresh
 * `RegExp` for `*.csproj` on every file entry. The literal-only
 * markers (21 of 22) get a string-equality fast path; the one
 * glob marker ships a precompiled regex.
 */
interface CompiledMarker extends LanguageMarker {
  literal: string | null;
  regex: RegExp | null;
}

const COMPILED_MARKERS: CompiledMarker[] = LANGUAGE_MARKERS.map((marker) => {
  const hasGlob = marker.filename.includes('*') || marker.filename.includes('?');
  if (!hasGlob) {
    return { ...marker, literal: marker.filename, regex: null };
  }
  const source =
    '^' +
    marker.filename
      .split('')
      .map((char) => {
        if (char === '*') return '.*';
        if (char === '?') return '.';
        return char.replace(/[.+^$|(){}\[\]\\-]/g, '\\$&');
      })
      .join('') +
    '$';
  return { ...marker, literal: null, regex: new RegExp(source) };
});

/**
 * Polyglot projects are common (Rust + TypeScript for a CLI, Java
 * + TypeScript for a web app backend, etc.). The detection must be
 * set-shaped, not first-match-shaped: every marker hit is added to
 * the result.
 */
export interface WorkspaceContext {
  /** Absolute path to the workspace root that was scanned. */
  root: string;
  /** Languages detected, in file-walk order. Empty when no marker matched. */
  languages: WorkspaceLanguage[];
  /**
   * Primary language (first detected). Used by the routing rules to
   * decide which model to send a request to (action plan item #5).
   * `null` when no marker matched.
   */
  primaryLanguage: WorkspaceLanguage | null;
  /** Package managers detected, in file-walk order. */
  packageManagers: string[];
  /** Linters detected, in file-walk order. */
  linters: string[];
  /** Formatters detected, in file-walk order. */
  formatters: string[];
}

const DEFAULT_OPTIONS: Required<DetectOptions> = {
  maxDepth: 2,
  maxEntries: 50,
  ignoredDirs: new Set(['node_modules', 'target', 'build', 'dist', '.git', '.idea', '.vscode', '__pycache__', '.gradle', 'venv', '.venv', '.next', '.turbo']),
};

export interface DetectOptions {
  /** Max directory depth to walk (root = 0). Default 2 (matches typical monorepo layouts). */
  maxDepth?: number;
  /** Hard cap on the number of directory entries inspected. Default 50. */
  maxEntries?: number;
  /**
   * Directory names to skip entirely (no recursion, no listing).
   * Defaults to common build / VCS / dependency directories.
   */
  ignoredDirs?: Set<string>;
}

/**
 * Detect the workspace context (languages, package managers, linters,
 * formatters) for the supplied root directory. Returns a fresh
 * `WorkspaceContext` on every call - the function is side-effect
 * free and safe to call per request.
 *
 * Pure function: the caller passes a `readdir` / `statSync`-shaped
 * dependency if it needs to be 100% side-effect free (the
 * `FileSystemLike` already injected by the runtime). For now the
 * direct `node:fs` calls match the project's "shell on the Node
 * API, not a custom abstraction" style.
 */
export function detectWorkspaceContext(root: string, options: DetectOptions = {}): WorkspaceContext {
  const merged: Required<DetectOptions> = { ...DEFAULT_OPTIONS, ...options };
  const ignoredDirs = new Set(merged.ignoredDirs);

  const languages: WorkspaceLanguage[] = [];
  const packageManagers: string[] = [];
  const linters: string[] = [];
  const formatters: string[] = [];

  walk(root, 0, merged.maxDepth, merged.maxEntries, ignoredDirs, (filename) => {
    for (const marker of COMPILED_MARKERS) {
      // `/review uncommitted` F2: precompiled dispatch - literal
      // markers get a string-equality fast path, glob markers hit
      // the precompiled RegExp.
      if (marker.literal !== null) {
        if (filename !== marker.literal) continue;
      } else if (marker.regex !== null) {
        if (!marker.regex.test(filename)) continue;
      }
      // `marker.language` is the LHS of the marker. The marker is
      // declared with a constant `language` field, so the `Set`
      // below catches duplicates.
      if (!languages.includes(marker.language)) {
        languages.push(marker.language);
      }
      if (marker.packageManager && !packageManagers.includes(marker.packageManager)) {
        packageManagers.push(marker.packageManager);
      }
      if (marker.linter && !linters.includes(marker.linter)) {
        linters.push(marker.linter);
      }
      if (marker.formatter && !formatters.includes(marker.formatter)) {
        formatters.push(marker.formatter);
      }
    }
  });

  return {
    root,
    languages,
    primaryLanguage: languages[0] ?? null,
    packageManagers,
    linters,
    formatters,
  };
}

/**
 * Render a `WorkspaceContext` as a system-message prefix suitable for
 * injection into a `/v1/chat/completions` body. The string is
 * intentionally short (a few lines at most): the upstream LLM gets
 * the gist of the project without us bloating every prompt with a
 * paragraph of context.
 *
 * `null` is returned when no language was detected (workspace is
 * not a code project, or detection failed) - in that case the
 * caller must NOT inject any context.
 */
export function renderWorkspaceContext(context: WorkspaceContext): string | null {
  if (!context.primaryLanguage) {
    return null;
  }
  const lines: string[] = [];
  lines.push(`Workspace: ${context.root}`);
  lines.push(`Detected language(s): ${context.languages.join(', ')}`);
  if (context.packageManagers.length > 0) {
    lines.push(`Package manager(s): ${context.packageManagers.join(', ')}`);
  }
  if (context.linters.length > 0) {
    lines.push(`Linter(s): ${context.linters.join(', ')}`);
  }
  if (context.formatters.length > 0) {
    lines.push(`Formatter(s): ${context.formatters.join(', ')}`);
  }
  lines.push(
    'When suggesting code, prefer the idioms, conventions, and tooling listed above. ' +
    'Do not assume idioms from another language.',
  );
  return lines.join('\n');
}

/**
 * Pure `fs` walker used by `detectWorkspaceContext`. Bounded by
 * `maxDepth` + `maxEntries` so a deep dependency tree (`node_modules`
 * we accidentally did not ignore, `.git/objects/pack`, ...) cannot
 * stall the request for seconds.
 */
function walk(
  dir: string,
  depth: number,
  maxDepth: number,
  maxEntries: number,
  ignoredDirs: Set<string>,
  onFilename: (filename: string) => void,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  let inspected = 0;
  for (const entry of entries) {
    if (inspected >= maxEntries) {
      return;
    }
    inspected++;
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (ignoredDirs.has(entry)) {
        continue;
      }
      if (depth + 1 <= maxDepth) {
        walk(fullPath, depth + 1, maxDepth, maxEntries, ignoredDirs, onFilename);
      }
      continue;
    }
    if (stat.isFile()) {
      onFilename(entry);
    }
  }
}

/**
 * `/review uncommitted` F10: the gateway had three near-identical
 * "shape options, resolve root, call detect" blocks (workspace-
 * context injection in `forwardChatCompletion`, the language-routing
 * hint in `resolveLanguageHint`, and the `/v1/context` HTTP
 * endpoint). Each repeated the `enabled !== false` gate, the
 * `resolveContextRoot` call, and the `{ maxDepth, ignoredDirs }`
 * shaping. Funnel them through this helper so adding a new
 * `DetectOptions` field only touches one place.
 *
 * `cached: true` routes through `detectWorkspaceContextCached()`
 * (the burst-coalesced hot path); `cached: false` always walks the
 * filesystem (the dashboard endpoint wants fresh data on demand).
 *
 * `undefined` is returned when workspace-context injection is
 * disabled, when no root can be resolved, or when the sentinel
 * check (see `resolveContextRoot`) refuses to treat the resolved
 * cwd as a workspace.
 */
export interface DetectFromSettingsOptions {
  /**
   * `true` to use the 5 s TTL cache (the per-request path),
   * `false` to always walk the filesystem (the dashboard endpoint).
   */
  cached: boolean;
  /**
   * `/review uncommitted` F8 (deploy safety): when set, the helper
   * refuses to treat `process.cwd()` as a workspace unless it
   * contains one of these project sentinels. The standalone CLI
   * default-launch cwd is the install directory and would otherwise
   * leak the install path to upstream providers. The VS Code
   * extension supplies a real workspace folder via the explicit
   * `settings.root` (no sentinel check needed).
   */
  cwdSentinels?: string[];
}

export function detectWorkspaceContextFromSettings(
  settings: import('../types').GatewaySettings['workspaceContext'],
  options: DetectFromSettingsOptions,
): WorkspaceContext | undefined {
  if (!settings || settings.enabled === false) {
    return undefined;
  }
  const root = resolveContextRoot(settings, options.cwdSentinels);
  if (!root) {
    return undefined;
  }
  const detectOptions: DetectOptions = {
    maxDepth: settings.maxDepth,
    ignoredDirs: new Set(settings.ignoredDirs ?? []),
  };
  return options.cached
    ? detectWorkspaceContextCached(root, detectOptions)
    : detectWorkspaceContext(root, detectOptions);
}

/**
 * `/review uncommitted` F10 + F8 + F7 (helper factored out of the
 * three duplicated call sites). Resolution order:
 * 1. Explicit `gateway.workspaceContext.root` (most specific).
 * 2. `AIFLOWBRIDGE_WORKSPACE` environment variable (lets a service
 *    manager like systemd / launchd / Task Scheduler point the
 *    standalone CLI at the user's project without a config edit).
 * 3. Process working directory, ONLY if it contains one of the
 *    supplied `cwdSentinels` (`package.json`, `pyproject.toml`,
 *    `Cargo.toml`, `go.mod`, `.git`, ...). The standalone CLI is
 *    typically launched from the install directory by Task
 *    Scheduler / systemd / launchd, so falling back to `cwd`
 *    unconditionally would silently inject the install directory's
 *    own `package.json` as the "workspace context" on every chat
 *    completion (F8 deploy-safety regression). When the resolved
 *    cwd is the install path itself (detectable via
 *    `path.dirname(process.execPath)`), a one-shot warning is
 *    logged and the helper returns `undefined`.
 *
 * Returns `undefined` when none of the above resolves to a
 * directory that satisfies the sentinel rule.
 *
 * F7: the warning is fired for any explicit `root` that did not
 * resolve to a directory, whether because `statSync` threw
 * (ENOENT/EACCES) OR because the path was a non-directory file.
 */
export function resolveContextRoot(
  settings: import('../types').GatewaySettings['workspaceContext'],
  cwdSentinels?: string[],
): string | undefined {
  if (!settings) {
    return undefined;
  }
  const candidates: Array<string | undefined> = [
    settings.root,
    process.env.AIFLOWBRIDGE_WORKSPACE,
    cwdSentinels ? process.cwd() : undefined,
  ];
  const explicitRoot = settings.root;
  let explicitRootFailed = false;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const stat = statSync(candidate);
      if (stat.isDirectory()) {
        if (candidate !== explicitRoot && cwdSentinels && !hasAnySentinel(candidate, cwdSentinels)) {
          // F8: cwd fallback only counts when the directory
          // looks like a project. Skip silently and keep looking.
          continue;
        }
        if (candidate === process.cwd() && isCwdInstallPath(candidate)) {
          // F8: cwd equals the gateway's own install dir.
          // Log once and refuse to inject.
          logInstallDirFallbackOnce();
        }
        return candidate;
      }
      // F7: explicit root that exists but is not a directory
      // also counts as a failure (file path is not a workspace).
      if (candidate === explicitRoot) {
        explicitRootFailed = true;
      }
    } catch {
      // ENOENT / EACCES - try the next candidate.
      if (candidate === explicitRoot) {
        explicitRootFailed = true;
      }
    }
  }
  if (explicitRoot && explicitRootFailed) {
    // Best-effort logger; the gateway layer may upgrade this to a
    // properly-namespaced logger at the call site.
    logRootResolveFailure(explicitRoot);
  }
  return undefined;
}

function hasAnySentinel(dir: string, sentinels: string[]): boolean {
  for (const sentinel of sentinels) {
    if (existsSync(join(dir, sentinel))) {
      return true;
    }
  }
  return false;
}

let installDirWarningLogged = false;
function isCwdInstallPath(cwd: string): boolean {
  try {
    const installDir = dirname(process.execPath);
    return installDir === cwd;
  } catch {
    return false;
  }
}

function logInstallDirFallbackOnce(): void {
  if (installDirWarningLogged) return;
  installDirWarningLogged = true;
  logger.warn(
    '[AIFlowBridge] workspace-context cwd fallback resolved to the gateway install path; ' +
      'skipping injection. Set aiflowbridge.gateway.workspaceContext.root or AIFLOWBRIDGE_WORKSPACE ' +
      'to point at the user project.'
  );
}

let rootResolveWarningLogged = false;
function logRootResolveFailure(root: string): void {
  if (rootResolveWarningLogged) return;
  rootResolveWarningLogged = true;
  logger.warn(
    `[AIFlowBridge] gateway.workspaceContext.root=${JSON.stringify(root)} did not resolve to a directory; ` +
      'falling back to AIFLOWBRIDGE_WORKSPACE / process.cwd().'
  );
}
