import { tryGetLoadedRegistry } from '../../aiflowbridge/modelRegistry';

export const REPLAY_MARKER_MIME = 'stateful_marker';
export const REPLAY_MARKER_WRITER_ID = 'deepseek-copilot';
export const ENCODED_JSON_MARKER_PREFIX = 'json:';
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
export const LEGACY_SEGMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Allowed marker prefixes (`writer-id` plus every built-in model id).
 *
 * Computed lazily from the model registry. The Set is cached after the
 * first call so subsequent lookups stay O(1) and we don't re-walk the
 * registry on every marker parse.
 */
let cachedPrefixes: Set<string> | undefined;
export function getReplayMarkerPrefixes(): Set<string> {
  if (!cachedPrefixes) {
    const models = tryGetLoadedRegistry()?.models ?? [];
    cachedPrefixes = new Set([REPLAY_MARKER_WRITER_ID, ...models.map((m) => m.id)]);
  }
  return cachedPrefixes;
}
