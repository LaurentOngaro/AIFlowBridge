import type { ProviderProfile, ProviderSnapshot, RequestTelemetry, TelemetrySnapshot } from './types';
import { logger } from '../logger';

/**
 * Minimal interface required by `TelemetryStore` to schedule a delta
 * write on every `record()` call. Decouples `TelemetryStore` from the
 * concrete `TelemetryPersister` class (which lives in
 * `./telemetry/persistence.ts`) so the in-memory store remains unit-
 * testable without a real file system, and so the persister can grow
 * (e.g. add a retry queue) without touching the store.
 */
export interface TelemetryPersisterLike {
  loadSync(): TelemetrySnapshot | undefined;
  appendDelta(entry: RequestTelemetry, baseline: TelemetrySnapshot): Promise<void>;
  removeEntry(entryId: string): Promise<boolean>;
  clear(): Promise<void>;
}

export function emptyProviderSnapshot(): ProviderSnapshot {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    errors: 0,
    averageDurationMs: 0,
  };
}

export function emptyTelemetrySnapshot(): TelemetrySnapshot {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    errors: 0,
    averageDurationMs: 0,
    p95DurationMs: 0,
    recent: [],
    byProvider: {},
    byModel: {},
  };
}

function updateProviderSnapshot(snapshot: ProviderSnapshot, entry: RequestTelemetry): void {
  snapshot.requests += 1;
  snapshot.promptTokens += entry.promptTokens;
  snapshot.completionTokens += entry.completionTokens;
  snapshot.totalTokens += entry.totalTokens;
  snapshot.estimatedCost += entry.estimatedCost;
  snapshot.errors += entry.status >= 400 ? 1 : 0;
  snapshot.averageDurationMs = (snapshot.averageDurationMs * (snapshot.requests - 1) + entry.durationMs) / snapshot.requests;
}

/**
 * Apply a single request entry to a snapshot in place. Mutates the
 * supplied snapshot (totals, recent list, byProvider / byModel maps).
 * Exported so the file-based persister can apply the same merge rules
 * when re-hydrating on-disk state under a lock.
 */
export function applyEntryToSnapshot(snapshot: TelemetrySnapshot, entry: RequestTelemetry): void {
  snapshot.requests += 1;
  snapshot.promptTokens += entry.promptTokens;
  snapshot.completionTokens += entry.completionTokens;
  snapshot.totalTokens += entry.totalTokens;
  snapshot.estimatedCost += entry.estimatedCost;
  snapshot.errors += entry.status >= 400 ? 1 : 0;
  snapshot.averageDurationMs =
    snapshot.requests === 1 ? entry.durationMs : (snapshot.averageDurationMs * (snapshot.requests - 1) + entry.durationMs) / snapshot.requests;

  // No cap on `recent` in the snapshot returned to the dashboard: the
  // full history is paginated (page size up to 500). The in-memory
  // store does enforce a cap (`memoryCap`, default 10 000) to keep
  // memory bounded at high request rates; the on-disk persister still
  // stores the full history. The p95 is derived lazily from `recent`
  // on a sliding window of `MAX_P95_SAMPLE` entries.

  snapshot.recent.push(entry);

  const providerSnapshot = snapshot.byProvider[entry.providerId] ?? emptyProviderSnapshot();
  updateProviderSnapshot(providerSnapshot, entry);
  snapshot.byProvider[entry.providerId] = providerSnapshot;

  const modelSnapshot = snapshot.byModel[entry.model] ?? emptyProviderSnapshot();
  updateProviderSnapshot(modelSnapshot, entry);
  snapshot.byModel[entry.model] = modelSnapshot;
}

function safeCost(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function estimateTokensFromText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function estimateCostFromProfile(profile: ProviderProfile, promptTokens: number, completionTokens: number): number {
  const pricing = profile.pricing;
  if (!pricing) {
    return 0;
  }

  const inputPerMillion = pricing.inputPerMillion ?? 0;
  const outputPerMillion = pricing.outputPerMillion ?? 0;
  return safeCost((promptTokens * inputPerMillion + completionTokens * outputPerMillion) / 1_000_000);
}

export function collectTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectTextFragments(item));
  }

  return [];
}

export function estimatePromptTokensFromPayload(payload: unknown): number {
  if (!payload || typeof payload !== 'object') {
    return 0;
  }

  const body = payload as Record<string, unknown>;
  const fragments: string[] = [];

  if (typeof body.prompt === 'string') {
    fragments.push(body.prompt);
  }

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object') {
        continue;
      }

      const candidate = message as Record<string, unknown>;
      fragments.push(...collectTextFragments(candidate.content));
      fragments.push(...collectTextFragments(candidate.name));
      fragments.push(...collectTextFragments(candidate.role));
    }
  }

  if (typeof body.input === 'string') {
    fragments.push(body.input);
  }

  return estimateTokensFromText(fragments.join(' '));
}

export type TelemetryListener = (snapshot: TelemetrySnapshot) => void;

export interface TelemetryStoreOptions {
  /**
   * Maximum number of entries kept in memory (`recent` list). When the
   * store grows past this cap, the oldest entries are dropped first.
   * The on-disk persister still receives every entry, so no data is
   * lost across reloads - only the in-memory list is bounded to keep
   * long-running sessions from leaking memory at high request rates
   *. Defaults to 10 000.
   */
  memoryCap?: number;
}

export class TelemetryStore {
  private readonly recent: RequestTelemetry[] = [];
  private readonly byProvider = new Map<string, ProviderSnapshot>();
  private readonly byModel = new Map<string, ProviderSnapshot>();
  private totalRequests = 0;
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;
  private totalTokens = 0;
  private totalEstimatedCost = 0;
  private totalErrors = 0;
  private totalDurationMs = 0;
  /**
   * Sorted ascending cache of the last `MAX_P95_SAMPLE` duration values
   * drawn from `recent`. Invalidated on every `record()` /
   * `removeEntry()` / `restore()` / `reset()` (avoid
   * re-sorting the entire ring on every `snapshot()` call).
   * fixes the desync that the old `durations` ring + index-based
   * splice used to cause after `removeEntry()`: the cache is rebuilt
   * from `recent` (the source of truth), so it can never disagree
   * with the underlying entries.
   */
  private p95Cache: number[] | undefined;
  private static readonly MAX_P95_SAMPLE = 1000;
  private readonly memoryCap: number;
  private listeners: TelemetryListener[] = [];

  /**
   * Optional file-based persister. When set, `record()` will schedule a
   * `persister.appendDelta()` call (fire-and-forget) so the on-disk
   * snapshot stays in sync across VS Code windows. When unset, the
   * legacy `saveState` callback (wired in `GatewayService.init()`) is
   * responsible for persistence.
   */
  constructor(
    private readonly persister?: TelemetryPersisterLike,
    options: TelemetryStoreOptions = {}
  ) {
    this.memoryCap = Math.max(1, options.memoryCap ?? TelemetryStore.DEFAULT_MEMORY_CAP);
  }

  static readonly DEFAULT_MEMORY_CAP = 10_000;

  private invalidateP95Cache(): void {
    this.p95Cache = undefined;
  }

  record(entry: RequestTelemetry): void {
    // Update the in-memory counters synchronously so a subsequent
    // `snapshot()` call sees the new request immediately. The persister
    // hook is fire-and-forget; it must never block the caller.
    this.applyEntryInMemory(entry);

    if (this.persister) {
      const baseline = this.snapshot();
      void this.persister.appendDelta(entry, baseline).catch((error: unknown) => {
        logger.warn(`[Telemetry] Failed to persist entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch {
        // Listeners must not break recording.
      }
    }
  }

  private applyEntryInMemory(entry: RequestTelemetry): void {
    this.totalRequests += 1;
    this.totalPromptTokens += entry.promptTokens;
    this.totalCompletionTokens += entry.completionTokens;
    this.totalTokens += entry.totalTokens;
    this.totalEstimatedCost += entry.estimatedCost;
    this.totalErrors += entry.status >= 400 ? 1 : 0;
    this.totalDurationMs += entry.durationMs;

    // cap the in-memory `recent` list. Drop oldest first.
    this.recent.push(entry);
    if (this.recent.length > this.memoryCap) {
      this.recent.shift();
    }
    this.invalidateP95Cache();

    const providerSnapshot = this.byProvider.get(entry.providerId) ?? emptyProviderSnapshot();
    updateProviderSnapshot(providerSnapshot, entry);
    this.byProvider.set(entry.providerId, providerSnapshot);

    const modelSnapshot = this.byModel.get(entry.model) ?? emptyProviderSnapshot();
    updateProviderSnapshot(modelSnapshot, entry);
    this.byModel.set(entry.model, modelSnapshot);
  }

  snapshot(): TelemetrySnapshot {
    return {
      requests: this.totalRequests,
      promptTokens: this.totalPromptTokens,
      completionTokens: this.totalCompletionTokens,
      totalTokens: this.totalTokens,
      estimatedCost: this.totalEstimatedCost,
      errors: this.totalErrors,
      averageDurationMs: this.totalRequests === 0 ? 0 : this.totalDurationMs / this.totalRequests,
      p95DurationMs: this.computeP95(),
      recent: [...this.recent].reverse(),
      byProvider: Object.fromEntries(this.byProvider.entries()),
      byModel: Object.fromEntries(this.byModel.entries()),
    };
  }

  /**
   * Compute the 95th-percentile duration from the last
   * `MAX_P95_SAMPLE` entries of `recent`. The result is cached and
   * invalidated by every mutation (`record`, `removeEntry`, `restore`,
   * `reset`). this no longer relies on a separate `durations`
   * ring kept in parallel with `recent`, which used to desync after a
   * `removeEntry()` / `restore()` cycle and silently skew the p95.
   */
  private computeP95(): number {
    if (this.recent.length === 0) {
      return 0;
    }
    if (!this.p95Cache) {
      const sample = this.recent.length > TelemetryStore.MAX_P95_SAMPLE ? this.recent.slice(-TelemetryStore.MAX_P95_SAMPLE) : this.recent;
      this.p95Cache = sample.map((entry) => entry.durationMs).sort((left, right) => left - right);
    }
    const sorted = this.p95Cache;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    return sorted[index];
  }

  /**
   * Restore cumulative state from a previously persisted snapshot.
   * Restores the totals, per-provider / per-model maps, and the
   * `recent` list. The p95 cache is rebuilt lazily from `recent` on
   * the next `snapshot()` call (no parallel ring to keep in
   * sync). If `state` is `undefined` and a `persister` is configured,
   * the on-disk snapshot is loaded instead.
   */
  restore(state: TelemetrySnapshot | undefined): void {
    this.clearInMemory();

    if (!state && this.persister) {
      try {
        state = this.persister.loadSync();
      } catch (error) {
        logger.warn(`[Telemetry] Failed to read persisted snapshot during restore: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!state) {
      return;
    }

    this.totalRequests = state.requests;
    this.totalPromptTokens = state.promptTokens;
    this.totalCompletionTokens = state.completionTokens;
    this.totalTokens = state.totalTokens;
    this.totalEstimatedCost = state.estimatedCost;
    this.totalErrors = state.errors;
    this.totalDurationMs = Math.round(state.averageDurationMs * state.requests);

    for (const [id, snapshot] of Object.entries(state.byProvider)) {
      this.byProvider.set(id, { ...snapshot });
    }
    for (const [model, snapshot] of Object.entries(state.byModel)) {
      this.byModel.set(model, { ...snapshot });
    }

    // The snapshot stores `recent` in reverse-chronological order. Reverse
    // it back to insertion order before pushing. The `memoryCap` drops
    // the oldest entries if the persisted list exceeds the in-memory
    // bound - the on-disk file still has the full history for the next
    // reload.
    for (const entry of [...state.recent].reverse()) {
      this.recent.push(entry);
      if (this.recent.length > this.memoryCap) {
        this.recent.shift();
      }
    }
    this.invalidateP95Cache();
  }

  /**
   * Reload the in-memory state from the on-disk snapshot. Returns
   * `true` if a snapshot was loaded, `false` if the persister is not
   * configured or the disk file is missing. Used by the dashboard
   * Refresh button to pick up changes from a peer VS Code window
   * without requiring a window reload.
   */
  refreshFromDisk(): boolean {
    if (!this.persister) {
      return false;
    }
    const state = this.persister.loadSync();
    this.restore(state);
    return state !== undefined;
  }

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Wipe all cumulative state and notify listeners. Used by the
   * "AIFlowBridge: Reset metrics" command.
   *
   * Note: this does NOT go through `restore(undefined)`. The restore
   * fallback to the on-disk persister exists for the activation
   * path ("if you don't have a state to load, try the disk"), which
   * is the wrong semantics for reset ("clear everything, do NOT
   * re-load from the disk"). Going through `restore(undefined)` here
   * would reload the just-cleared disk state into the in-memory
   * store, making the reset look broken.
   *
   * The on-disk file is cleared through the persister (fire-and-
   * forget, under a file lock) so the reset is visible to every
   * other window on the next refresh.
   */
  reset(): void {
    this.clearInMemory();

    if (this.persister) {
      void this.persister.clear().catch((error: unknown) => {
        logger.warn(`[Telemetry] Failed to clear telemetry file: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch {
        // Listeners must not break reset.
      }
    }
  }

  /**
   * Zero every cumulative counter and clear every map. Shared by
   * `restore` (which then loads fresh state) and `reset` (which then
   * wipes the on-disk file). Kept private so external callers cannot
   * accidentally leave the store in a half-cleared state.
   */
  private clearInMemory(): void {
    this.recent.length = 0;
    this.byProvider.clear();
    this.byModel.clear();
    this.p95Cache = undefined;
    this.totalRequests = 0;
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalTokens = 0;
    this.totalEstimatedCost = 0;
    this.totalErrors = 0;
    this.totalDurationMs = 0;
  }

  /**
   * Remove a single request entry from the cumulative state. Returns
   * `true` if the entry was found and removed, `false` otherwise.
   * The in-memory counters are reversed (totals, per-provider /
   * per-model maps, durations array) and the persister is asked to
   * remove the same entry from the on-disk file under a file lock.
   *
   * The p95 duration is automatically recomputed on the next
   * `snapshot()` because it is derived from the (now-shrunk)
   * `durations` array.
   */
  removeEntry(entryId: string): boolean {
    const idx = this.recent.findIndex((entry) => entry.id === entryId);
    if (idx === -1) {
      return false;
    }
    const entry = this.recent[idx];
    this.recent.splice(idx, 1);
    // p95 is now derived from `recent` lazily. Invalidate the
    // cached sorted sample so the next `snapshot()` recomputes it
    // against the (now smaller) source of truth.
    this.invalidateP95Cache();

    this.totalRequests = Math.max(0, this.totalRequests - 1);
    this.totalPromptTokens = Math.max(0, this.totalPromptTokens - entry.promptTokens);
    this.totalCompletionTokens = Math.max(0, this.totalCompletionTokens - entry.completionTokens);
    this.totalTokens = Math.max(0, this.totalTokens - entry.totalTokens);
    this.totalEstimatedCost = Math.max(0, this.totalEstimatedCost - entry.estimatedCost);
    if (entry.status >= 400) {
      this.totalErrors = Math.max(0, this.totalErrors - 1);
    }
    this.totalDurationMs = Math.max(0, this.totalDurationMs - entry.durationMs);

    const providerSnapshot = this.byProvider.get(entry.providerId);
    if (providerSnapshot) {
      providerSnapshot.requests = Math.max(0, providerSnapshot.requests - 1);
      providerSnapshot.promptTokens = Math.max(0, providerSnapshot.promptTokens - entry.promptTokens);
      providerSnapshot.completionTokens = Math.max(0, providerSnapshot.completionTokens - entry.completionTokens);
      providerSnapshot.totalTokens = Math.max(0, providerSnapshot.totalTokens - entry.totalTokens);
      providerSnapshot.estimatedCost = Math.max(0, providerSnapshot.estimatedCost - entry.estimatedCost);
      if (entry.status >= 400) {
        providerSnapshot.errors = Math.max(0, providerSnapshot.errors - 1);
      }
      if (providerSnapshot.requests <= 0) {
        this.byProvider.delete(entry.providerId);
      }
    }

    const modelSnapshot = this.byModel.get(entry.model);
    if (modelSnapshot) {
      modelSnapshot.requests = Math.max(0, modelSnapshot.requests - 1);
      modelSnapshot.promptTokens = Math.max(0, modelSnapshot.promptTokens - entry.promptTokens);
      modelSnapshot.completionTokens = Math.max(0, modelSnapshot.completionTokens - entry.completionTokens);
      modelSnapshot.totalTokens = Math.max(0, modelSnapshot.totalTokens - entry.totalTokens);
      modelSnapshot.estimatedCost = Math.max(0, modelSnapshot.estimatedCost - entry.estimatedCost);
      if (entry.status >= 400) {
        modelSnapshot.errors = Math.max(0, modelSnapshot.errors - 1);
      }
      if (modelSnapshot.requests <= 0) {
        this.byModel.delete(entry.model);
      }
    }

    if (this.persister) {
      void this.persister.removeEntry(entryId).catch((error: unknown) => {
        logger.warn(`[Telemetry] Failed to remove entry ${entryId} from disk: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch {
        // Listeners must not break removal.
      }
    }
    return true;
  }
}
