/**
 * Pure sort helpers for the dashboard webview.
 *
 * Extracted from the inline `<script>` block of `buildDashboardHtml`
 * so they can be unit-tested with vitest without booting a browser
 * DOM. The dashboard HTML still embeds the equivalent logic inline
 * (the webview runs in a sandboxed context with no module loader),
 * but importing these helpers here guarantees the test suite
 * exercises the exact same comparison / sort contract that the
 * webview runs at runtime.
 *
 * Conventions:
 * - `key` is a `data-sort-key` attribute value (e.g. "timestamp",
 *   "status", "name", "requests"). Unknown keys sort as if equal to
 *   the empty string (i.e. they collapse to the natural order).
 * - `dir` is "asc" or "desc". Any other value (including null /
 *   undefined) means "no sort active": `sortRecentEntries` and
 *   `sortObjectEntries` return the input unchanged so the table
 *   keeps its natural order.
 */

export type SortDirection = "asc" | "desc";
export type SortKey = string | null;
export type SortState = { key: SortKey; dir: SortDirection | null };

export type RecentSortKey =
  | "timestamp"
  | "status"
  | "providerLabel"
  | "model"
  | "clientId"
  | "durationMs"
  | "totalTokens"
  | "estimatedCost"
  | "estimated"
  | "source";

export interface RecentEntryLike {
  timestamp?: string;
  status?: number;
  providerLabel?: string;
  model?: string;
  clientId?: string;
  durationMs?: number;
  totalTokens?: number;
  estimatedCost?: number;
  estimated?: boolean;
  source?: string;
}

export interface ProviderSnapshotLike {
  requests?: number;
  totalTokens?: number;
  averageDurationMs?: number;
  errors?: number;
  estimatedCost?: number;
}

/**
 * Generic comparator: numbers compared numerically (NaN sorted to
 * the end in ascending order), strings compared locale-aware, and
 * `null` / `undefined` coerced to the empty string so they group
 * together instead of throwing.
 */
export function compareVals(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  }
  const sa = a == null ? "" : String(a);
  const sb = b == null ? "" : String(b);
  return sa.localeCompare(sb);
}

/**
 * Extract the sort value from a recent-table entry given a sort key.
 * Unknown keys collapse to the empty string so they sort to the top
 * of ascending tables (alphabetically) without throwing.
 */
export function recentSortVal(entry: RecentEntryLike, key: string): string | number {
  switch (key) {
    case "timestamp": return entry.timestamp || "";
    case "status": return entry.status || 0;
    case "providerLabel": return entry.providerLabel || "";
    case "model": return entry.model || "";
    case "clientId": return entry.clientId || "";
    case "durationMs": return entry.durationMs || 0;
    case "totalTokens": return entry.totalTokens || 0;
    case "estimatedCost": return entry.estimatedCost || 0;
    case "estimated": return entry.estimated ? "estimated" : "usage";
    // Path column: coalesce absent to 'gateway' so older entries
    // do not sort to the top by default.
    case "source": return entry.source || "gateway";
    default: return "";
  }
}

/**
 * Extract the sort value from a model / provider snapshot entry.
 * The `id` is the model name or provider id (used for the "name"
 * column). Unknown keys collapse to the empty string.
 */
export function objSortVal(id: string, snap: ProviderSnapshotLike | null | undefined, key: string): string | number {
  if (key === "name") return id || "";
  if (typeof snap === "object" && snap !== null) {
    if (key === "requests") return snap.requests || 0;
    if (key === "totalTokens") return snap.totalTokens || 0;
    if (key === "averageDurationMs") return snap.averageDurationMs || 0;
    if (key === "errors") return snap.errors || 0;
    if (key === "estimatedCost") return snap.estimatedCost || 0;
  }
  return "";
}

/**
 * Sort a flat array of recent entries by the given key + direction.
 * Returns a NEW array (does not mutate the input). When the key or
 * direction is falsy, the input is returned unchanged so the
 * dashboard keeps its natural order.
 */
export function sortRecentEntries<T extends RecentEntryLike>(entries: readonly T[], key: SortKey, dir: SortDirection | null): T[] {
  if (!key || !dir) return entries.slice();
  const copy = entries.slice();
  copy.sort((a, b) => compareVals(recentSortVal(a, key), recentSortVal(b, key)));
  if (dir === "desc") copy.reverse();
  return copy;
}

/**
 * Sort an object map (model name -> snapshot, provider id ->
 * snapshot) by the given key + direction. Returns a NEW object
 * whose keys iterate in the sorted order (modern JS engines
 * preserve insertion order for string keys). When the key or
 * direction is falsy, the input is returned as-is.
 */
export function sortObjectEntries<T extends ProviderSnapshotLike>(data: Record<string, T>, key: SortKey, dir: SortDirection | null): Record<string, T> {
  if (!key || !dir) return { ...data };
  const entries = Object.keys(data).map((k) => [k, data[k]] as [string, T]);
  entries.sort((a, b) => compareVals(objSortVal(a[0], a[1], key), objSortVal(b[0], b[1], key)));
  if (dir === "desc") entries.reverse();
  const out: Record<string, T> = {};
  for (const [k, v] of entries) {
    out[k] = v;
  }
  return out;
}

/**
 * Default sort state for the three sortable panels.
 *
 * The recent table opens sorted by Date descending (most recent
 * first) - that is the obvious "freshest telemetry at the top"
 * expectation and is the explicit project requirement. The model
 * and provider summaries keep their natural (insertion) order
 * because the dashboard already groups them by an internal
 * aggregation that benefits from the byModel / byProvider
 * declaration order; the user can still click any header to
 * sort them on demand.
 */
export function defaultSortState(): { recent: SortState; model: SortState; provider: SortState } {
  return {
    recent: { key: "timestamp", dir: "desc" },
    model: { key: null, dir: null },
    provider: { key: null, dir: null },
  };
}

/**
 * Cycle the sort direction for an already-sorted column:
 * `null -> "asc"`, `"asc" -> "desc"`, `"desc" -> null` (cleared).
 * Switching to a different column resets the direction to "asc"
 * (handled by the click handler, not by this helper).
 */
export function cycleSortDir(current: SortState, clickedKey: string): SortState {
  if (current.key !== clickedKey) {
    return { key: clickedKey, dir: "asc" };
  }
  if (current.dir === "asc") return { key: clickedKey, dir: "desc" };
  if (current.dir === "desc") return { key: null, dir: null };
  return { key: clickedKey, dir: "asc" };
}