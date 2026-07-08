/**
 * Standalone-only helpers shared between the context adapter and the
 * config loader.
 *
 * These helpers intentionally have no dependency on `vscode` so the
 * standalone build (`tsconfig.standalone.json`) can import them
 * directly without pulling in the shim.
 */

/**
 * Look up a dotted config key (e.g. `"providers.minimax.baseUrl"`) in a
 * nested JSON object. Returns `undefined` if any segment of the path is
 * missing or if the traversal hits a non-object / array boundary.
 *
 * Pure function - safe to call from any code path that needs to read a
 * flattened setting out of the parsed `~/.aiflowbridge/config.json` map.
 *
 * @param root Parsed JSON object (the result of `JSON.parse` on the
 *   config file, validated to be a plain object).
 * @param key Dotted path. Empty string returns `root` itself; a single
 *   segment behaves like `root[key]`.
 */
export function getNestedValue(root: Record<string, unknown>, key: string): unknown {
  const segments = key.split(".");
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}