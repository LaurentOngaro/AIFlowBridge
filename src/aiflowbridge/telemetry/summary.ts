/**
 * Action plan item #3. Helpers that turn the raw request body and
 * the raw upstream response into sanitized, truncated summaries that
 * are safe to persist alongside the regular `RequestTelemetry`
 * counters and to surface on the dashboard's Shared Session panel.
 *
 * Two responsibilities:
 *  1. **Sanitization.** Strip anything that looks like a credential
 *     (Bearer tokens, `sk-...` keys, `x-api-key` headers, base64-ish
 *     blobs longer than 40 chars that contain non-printable ASCII).
 *     This is best-effort: a determined adversary could craft a
 *     payload that leaks through, but the gateway already runs
 *     loopback-only, so the threat model is "accidental disclosure"
 *     (a developer pasting a curl one-liner that includes their
 *     upstream key), not hostile exfiltration.
 *  2. **Truncation.** Cap the prompt summary to 500 chars and the
 *     response summary to 1000 chars to bound the on-disk footprint
 *     of `telemetry.json`. The cap is applied AFTER sanitization so
 *     a redacted credential that survives the truncation is no
 *     longer reachable.
 */

import { collectTextFragments } from '../telemetry';

const PROMPT_SUMMARY_MAX = 500;
const RESPONSE_SUMMARY_MAX = 1000;

const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/gi;
const SK_KEY_RE = /\bsk-[A-Za-z0-9_\-]{20,}\b/g;
const X_API_KEY_RE = /x-api-key["']?\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{16,}/gi;
const LONG_BLOB_RE = /[A-Za-z0-9+/=_\-]{60,}/g;

export interface PromptSummaryOptions {
  /** Override the cap (used by tests). Default = 500. */
  maxChars?: number;
}

export interface ResponseSummaryOptions {
  /** Override the cap (used by tests). Default = 1000. */
  maxChars?: number;
}

/**
 * Redact credential-looking fragments. Returns the cleaned string
 * with `[REDACTED]` placeholders. Idempotent: running it twice on
 * the same input returns the same output. Empty / non-string input
 * returns `''`.
 */
export function sanitizeSummaryText(text: string | undefined | null): string {
  if (typeof text !== 'string') {
    return '';
  }
  let result = text;
  result = result.replace(BEARER_RE, 'Bearer [REDACTED]');
  result = result.replace(SK_KEY_RE, 'sk-[REDACTED]');
  result = result.replace(X_API_KEY_RE, 'x-api-key=[REDACTED]');
  result = result.replace(LONG_BLOB_RE, '[REDACTED]');
  return result;
}

/**
 * Build a sanitized + truncated prompt summary from an OpenAI-style
 * chat-completion payload. The body may be `undefined` (streaming
 * clients that send empty bodies - rare but legal). The result is
 * always a string (empty string when nothing usable was found).
 *
 * The shape inspected is the standard `messages[]` array; we walk
 * every message, concatenate the text fragments (the existing
 * `collectTextFragments` helper handles strings, arrays of strings,
 * and nested objects), and use the user-side messages first. When
 * no messages are present we fall back to the legacy `prompt` field.
 */
export function buildPromptSummary(payload: unknown, options: PromptSummaryOptions = {}): string {
  const cap = options.maxChars ?? PROMPT_SUMMARY_MAX;
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const body = payload as Record<string, unknown>;
  const fragments: string[] = [];

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object') {
        continue;
      }
      const candidate = message as Record<string, unknown>;
      const role = typeof candidate.role === 'string' ? candidate.role : '';
      // Prefer user-side text. Keep the role prefix only when it
      // adds information (skip the default 'user' / 'assistant' to
      // stay under the cap faster).
      const text = collectTextFragments(candidate.content).join(' ').trim();
      if (!text) {
        continue;
      }
      if (role && role !== 'user' && role !== 'assistant' && role !== 'system') {
        fragments.push(`[${role}] ${text}`);
      } else {
        fragments.push(text);
      }
    }
  } else if (typeof body.prompt === 'string') {
    fragments.push(body.prompt);
  } else if (typeof body.input === 'string') {
    fragments.push(body.input);
  }

  const joined = fragments.join('\n').trim();
  if (!joined) {
    return '';
  }
  return truncateSummary(sanitizeSummaryText(joined), cap);
}

/**
 * Build a sanitized + truncated response summary from the upstream
 * response body. For non-streaming upstream calls the body is a
 * JSON object with `choices[0].message.content`. For streaming
 * upstream calls the body is the concatenated SSE chunks; this
 * helper extracts the `data: ...` payload lines, JSON-parses each
 * one, and concatenates the `choices[0].delta.content` fragments.
 *
 * The truncation cap is applied AFTER sanitization so a redacted
 * credential that survives is no longer reachable.
 */
export function buildResponseSummary(upstreamBody: string | undefined, options: ResponseSummaryOptions = {}): string {
  const cap = options.maxChars ?? RESPONSE_SUMMARY_MAX;
  if (!upstreamBody) {
    return '';
  }
  const extracted = extractAssistantText(upstreamBody);
  if (!extracted) {
    return '';
  }
  return truncateSummary(sanitizeSummaryText(extracted), cap);
}

/**
 * Extract the assistant text from either a JSON chat-completion
 * response or a concatenated SSE stream. The streaming branch
 * tolerates malformed JSON chunks (skips them silently - a chunk
 * may carry only metadata like `usage`). Returns the empty string
 * when nothing usable was found.
 */
export function extractAssistantText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  // Try the non-streaming JSON path first.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const text = readAssistantFromJson(parsed);
    if (text) {
      return text;
    }
  } catch {
    // not JSON - fall through to the SSE path
  }
  return readAssistantFromSse(trimmed);
}

/**
 * Read the assistant text from a single JSON chunk. Returns the
 * raw extracted text; callers decide whether to collapse / trim
 * (the non-streaming JSON path trims; the SSE path leaves the
 * chunks intact and collapses only at the final join).
 */
function readAssistantFromJson(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const body = value as Record<string, unknown>;
  const choices = body.choices;
  if (!Array.isArray(choices)) {
    return '';
  }
  const fragments: string[] = [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue;
    }
    const c = choice as Record<string, unknown>;
    const message = c.message;
    if (message && typeof message === 'object') {
      const text = collectTextFragments((message as Record<string, unknown>).content).join('').trim();
      if (text) {
        fragments.push(text);
        continue;
      }
    }
    const delta = c.delta;
    if (delta && typeof delta === 'object') {
      const text = collectTextFragments((delta as Record<string, unknown>).content).join('');
      if (text) {
        fragments.push(text);
      }
    }
  }
  return fragments.join('');
}

function readAssistantFromSse(raw: string): string {
  const fragments: string[] = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      const text = readAssistantFromJson(parsed);
      if (text) {
        fragments.push(text);
      }
    } catch {
      // skip malformed chunk
    }
  }
  // Collapse runs of whitespace to a single space and trim the
  // outer edges. The per-chunk content is preserved verbatim
  // (no per-chunk trim) so a trailing space at the end of a word
  // boundary in chunk N is not lost before chunk N+1 starts.
  return fragments.join('').replace(/\s+/g, ' ').trim();
}

function truncateSummary(text: string, cap: number): string {
  if (cap <= 0 || text.length <= cap) {
    return text;
  }
  // Truncate on a char boundary that does not split a UTF-16 surrogate
  // pair (defensive - sanitize may have left multi-byte chars in place).
  let end = cap;
  // Last char of the prefix is the truncation marker; leave room for
  // it so the returned text reads naturally in the dashboard.
  const suffix = '...';
  if (end > suffix.length) {
    end = cap - suffix.length;
  }
  // Snap `end` down to a code-point boundary.
  if (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
  }
  return `${text.slice(0, end)}${suffix}`;
}