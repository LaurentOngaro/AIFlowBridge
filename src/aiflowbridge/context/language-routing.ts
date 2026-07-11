/**
 * Language-based model routing (action plan item #5).
 *
 * Adds an opt-in routing layer on top of `selectProvider()`: the
 * caller provides a `languageHint` (sourced from a workspace
 * context, an explicit HTTP header, or the first filename mentioned
 * in the request body) and the resolver picks the highest-priority
 * enabled provider mapped to that language in the user's
 * `aiflowbridge.gateway.languageRouting` config.
 *
 * Pure function: the helper takes the full list of providers and
 * the routing config as input, returns either the chosen provider
 * or `undefined` (caller falls back to the existing
 * `selectProvider()` chain).
 */

import type { ProviderProfile } from '../types';
import type { WorkspaceLanguage } from './workspace-context';
import { selectProvider } from '../providers';
import { collectTextFragments } from '../telemetry';

/**
 * User-supplied per-language routing table. Example:
 * ```json
 * { "python": "deepseek-flash", "rust": "deepseek-pro", "*": "minimax" }
 * ```
 * The `*` wildcard is the fallback for any language not explicitly
 * mapped. Values are provider ids (matched against
 * `provider.id`, `provider.model`, or `provider.label`). Stored as
 * `Record<string, string>` so the config layer does not need to know
 * the `WorkspaceLanguage` type.
 */
export type LanguageRoutingConfig = Record<string, string>;

/**
 * Find the enabled provider that matches the language hint AND
 * any of the configured provider aliases. Returns `undefined` when:
 * - no language hint was provided,
 * - the user's `languageRouting` config has no entry for the
 *   language AND no `*` fallback,
 * - the mapped provider id does not match any enabled provider.
 *
 * The result of this call ALWAYS wins over `selectProvider(model,
 * defaultModel)` - the upstream `model` / `defaultModel` fields are
 * the existing behavior preserved as a final fallback when the
 * routing table does not apply.
 */
export function selectProviderByLanguage(
  providers: ProviderProfile[],
  languageHint: WorkspaceLanguage | string | undefined,
  languageRouting: LanguageRoutingConfig | undefined,
): ProviderProfile | undefined {
  if (!languageHint) {
    return undefined;
  }
  if (!languageRouting) {
    return undefined;
  }
  // First check explicit language mapping, then fall back to '*'
  const targetId = languageRouting[languageHint] ?? languageRouting['*'];
  if (!targetId) {
    return undefined;
  }
  const enabledProviders = providers.filter((profile) => profile.enabled);
  const match = enabledProviders.find((profile) => {
    const aliases = [profile.id, profile.model, profile.label];
    return aliases.some((alias) => alias.localeCompare(targetId, undefined, { sensitivity: 'base' }) === 0);
  });
  return match;
}

/**
 * Try language-based routing first, then fall back to the regular
 * `selectProvider()` chain. This is the entry point the gateway
 * uses in `forwardChatCompletion()`.
 */
export function selectProviderWithLanguage(
  providers: ProviderProfile[],
  requestedModel: string | undefined,
  defaultModel: string | undefined,
  languageHint: WorkspaceLanguage | string | undefined,
  languageRouting: LanguageRoutingConfig | undefined,
): ProviderProfile | undefined {
  return (
    selectProviderByLanguage(providers, languageHint, languageRouting) ??
    selectProvider(providers, requestedModel, defaultModel)
  );
}

/**
 * Best-effort language hint from a request body. Scans the first
 * 20 messages for a code-block filename (e.g. a fenced snippet
 * starting with ` ` `python `path/to/file.py` `, or a file path
 * inside a user message) and routes on its extension. Pure
 * function; the hint can be overridden by an explicit
 * `X-AIFlowBridge-Language` HTTP header at the call site.
 *
 * Returns `undefined` when no recognisable filename appears in
 * the request body, so the caller falls back to the workspace
 * context's `primaryLanguage` (or to no hint at all).
 */
const KNOWN_EXTENSIONS: Record<string, WorkspaceLanguage> = {
  '.py': 'python',
  '.pyi': 'python',
  '.pyx': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.cs': 'csharp',
  '.csproj': 'csharp',
  '.rb': 'ruby',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.swift': 'swift',
  '.php': 'php',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
};

// Accepts the filename sandwiched between any whitespace / quote /
// common punctuation character (including newlines, so a fenced
// `python\n# /home/me/proj/src/foo.py\n` snippet still matches
// the `foo.py` file path on the next line). The trailing
// negative-lookahead has two layers:
//   `(?![A-Za-z0-9_/])`   - prevents matching inside a longer
//                           identifier (`foo.pyy` -> match `foo.py`,
//                           but `foo.py/bar` is rejected because the
//                           trailing `/` is part of a path).
//   `(?!\.\.)`            - `/review uncommitted` F6: documented in
//                           the original JSDoc but missing from the
//                           regex. Without it, body text containing
//                           URLs like
//                           `https://docs.example.com/api/foo.py`
//                           produces a false-positive `'python'`
//                           hint. The lookahead also keeps the
//                           match off the path-traversal
//                           `../foo.py` (the leading `.` would
//                           otherwise pair with the trailing `.ext`).
const FILENAME_PATTERN =
  /[`"'(\s,;:!?]([A-Za-z0-9_./-]+?\.(?:py|pyi|pyx|rs|go|js|mjs|cjs|jsx|ts|tsx|mts|cts|java|kt|kts|cs|csproj|rb|ex|exs|swift|php|cpp|cc|cxx|hpp|hxx))(?![A-Za-z0-9_/])(?!\.\.)/i;

export function detectLanguageHintFromPayload(payload: unknown): WorkspaceLanguage | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const body = payload as Record<string, unknown>;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  // Scan at most the first 20 messages to bound the work.
  for (const message of messages.slice(0, 20)) {
    if (!message || typeof message !== 'object') continue;
    const content = (message as Record<string, unknown>).content;
    // `/review uncommitted` F9: reuse the recursive text collector
    // exported by `telemetry.ts` so the content-shape handling
    // stays single-sourced. The previous local copy short-circuited
    // on `obj.text` and would silently drop other string fields as
    // OpenAI content shapes evolve.
    const text = collectTextFragments(content).join('\n');
    const match = text.match(FILENAME_PATTERN);
    if (!match) continue;
    const captured = match[1];
    if (!captured) continue;
    // `/review uncommitted` F6: even with the regex-level
    // `(?!\.\.)` lookahead, body text such as
    // `https://docs.example.com/api/foo.py` still produces a
    // captured group starting with `//` (the regex consumes the
    // `:` as the opening char-class match). A real filename
    // either is a bare name (`foo.py`), starts with `.` or `./`
    // (`./foo.py`), or sits inside a single-segment path
    // (`src/foo.py`). It never starts with `//`. The post-filter
    // also rejects `:` (URL schemes) and the documented `..`
    // path-traversal prefix.
    if (captured.startsWith('//') || captured.includes('://') || captured.startsWith('..')) {
      continue;
    }
    const dot = captured.lastIndexOf('.');
    if (typeof dot !== 'number' || dot < 0) continue;
    const ext = captured.slice(dot).toLowerCase();
    const lang = KNOWN_EXTENSIONS[ext];
    if (lang) return lang;
  }
  return undefined;
}
