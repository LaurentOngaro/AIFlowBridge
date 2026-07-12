/**
 * helpers that bound the per-entry size of the on-disk
 * telemetry snapshot.
 *
 * Two related primitives:
 *   - `byteLengthUtf8(text)`: exact UTF-8 byte count (Node's
 *     `Buffer.byteLength(text, "utf8")`).
 *   - `enforceEntrySizeCap(entry, maxBytes)`: returns a NEW entry
 *     (the input is not mutated) where `promptSummary` and
 *     `responseSummary` are independently truncated so the JSON
 *     serialization of the entry fits under `maxBytes` bytes.
 *
 * The cap is intentionally applied AFTER the per-field sanitizer /
 * truncator in `summary.ts` (which already caps prompt at 500 chars
 * and response at 1000 chars). The audit-recommended hard ceiling is
 * 8 KiB; that is the default the `TelemetryStore` passes in unless
 * the user disabled the setting. The hard ceiling is a defensive back
 * stop, NOT a replacement for the per-field caps: in the typical case
 * an entry is well under the limit and no further work happens.
 *
 * Truncation rules:
 *   - Compute the byte cost of the entry minus the two summaries.
 *     That gives the budget available for both summaries combined.
 *   - Trim response summary first (it is the larger and usually the
 *     less replay-critical of the two), then prompt summary.
 *   - The `...` truncation suffix is 3 ASCII bytes regardless of
 *     multi-byte content, leaving room for any UTF-8 codepoint at
 *     the cut point (we snap to a code-point boundary, not a
 *     surrogate-pair boundary - JSON.stringify emits the high
 *     surrogate as two `\uXXXX` sequences for invalid pairs, so the
 *     byte count survives the JSON round-trip).
 */

import type { RequestTelemetry } from '../types';

export function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * JSON size of a `RequestTelemetry` entry with the two summary
 * fields replaced by the supplied placeholders. Used to derive the
 * byte budget for `promptSummary` + `responseSummary` given a hard
 * cap on the whole entry.
 */
function approxEntryOverhead(entry: RequestTelemetry, promptLen: number, responseLen: number): number {
  // The entry is a flat object. We do an exact JSON measure by
  // rebuilding the entry with placeholders of the same field shape
  // so the JSON.stringify output is byte-faithful.
  const probe: RequestTelemetry = {
    ...entry,
    promptSummary: promptLen === 0 ? undefined : 'p'.repeat(promptLen),
    responseSummary: responseLen === 0 ? undefined : 'r'.repeat(responseLen),
  };
  return byteLengthUtf8(JSON.stringify(probe));
}

/**
 * Truncate a UTF-8 string so its `Buffer.byteLength("utf8")` is at
 * most `maxBytes`. Returns the original string if it already fits.
 * The truncation suffix is `'...'` (3 ASCII bytes).
 *
 * The returned string's UTF-8 representation is guaranteed to be
 * valid: the cut point is snapped forward to a code-point boundary
 * (no half-codepoint). The total length is `<= maxBytes` for all
 * input sizes; the invariant is enforced byte-by-byte, not by
 * character count.
 */
export function truncateUtf8ToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }
  const suffix = '...';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  if (byteLengthUtf8(text) <= maxBytes) {
    return text;
  }
  const target = maxBytes - suffixBytes;
  if (target <= 0) {
    // maxBytes < 3 (or barely fits the suffix itself). We can only
    // return a partial truncation marker; the caller is asking for
    // an unreasonably small cap.
    return suffix.slice(0, maxBytes);
  }
  // Walk the string and count UTF-8 bytes per code point. Stop as
  // soon as the next code point would push us past `target`, so the
  // result is always `<= maxBytes` bytes long.
  let bytes = 0;
  let cutAt = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    let charBytes: number;
    if (code < 0x80) {
      charBytes = 1;
    } else if (code < 0x800) {
      charBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate. UTF-16 surrogates are paired; account for
      // both code units as a single 4-byte UTF-8 sequence.
      charBytes = 4;
      i += 1;
    } else {
      charBytes = 3;
    }
    if (bytes + charBytes > target) {
      break;
    }
    bytes += charBytes;
    i += 1;
    cutAt = i;
  }
  if (cutAt <= 0) {
    return suffix.slice(0, maxBytes);
  }
  return text.slice(0, cutAt) + suffix;
}

/**
 * Enforce a hard byte budget on a single `RequestTelemetry` entry.
 * Returns a new entry (or the same reference when nothing had to
 * be truncated). `promptSummary` and `responseSummary` are
 * trimmed independently so the overall entry stays under
 * `maxBytes` once re-serialized.
 *
 * When `maxBytes <= 0` the function is a no-op (the cap is
 * disabled). The function is also a no-op when the entry already
 * fits under the budget.
 */
export function enforceEntrySizeCap(entry: RequestTelemetry, maxBytes: number): RequestTelemetry {
  if (maxBytes <= 0) {
    return entry;
  }
  const promptSummary = entry.promptSummary;
  const responseSummary = entry.responseSummary;
  if (!promptSummary && !responseSummary) {
    if (byteLengthUtf8(JSON.stringify(entry)) <= maxBytes) {
      return entry;
    }
  }
  const promptLen = promptSummary ? byteLengthUtf8(promptSummary) : 0;
  const responseLen = responseSummary ? byteLengthUtf8(responseSummary) : 0;
  const overhead = approxEntryOverhead(entry, promptLen, responseLen);
  if (overhead <= maxBytes) {
    return entry;
  }
  const slack = maxBytes - (overhead - promptLen - responseLen);
  if (slack <= 0) {
    // No room for either summary - drop both.
    return { ...entry, promptSummary: undefined, responseSummary: undefined };
  }
  // Split the budget: 40% to prompt, 60% to response (preserves
  // the existing convention where response is the larger).
  const budget = Math.max(0, slack);
  const promptBudget = Math.floor(budget * 0.4);
  const responseBudget = budget - promptBudget;
  const trimmedPrompt = promptSummary ? truncateUtf8ToBytes(promptSummary, promptBudget) : undefined;
  const trimmedResponse = responseSummary ? truncateUtf8ToBytes(responseSummary, responseBudget) : undefined;
  // If the truncations did not actually change anything, return the
  // original reference so callers can use `===` for fast-path detection.
  if (trimmedPrompt === promptSummary && trimmedResponse === responseSummary) {
    return entry;
  }
  return { ...entry, promptSummary: trimmedPrompt, responseSummary: trimmedResponse };
}
