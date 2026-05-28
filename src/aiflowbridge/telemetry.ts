import type { ProviderProfile, ProviderSnapshot, RequestTelemetry, TelemetrySnapshot } from "./types";

function emptyProviderSnapshot(): ProviderSnapshot {
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

function updateProviderSnapshot(snapshot: ProviderSnapshot, entry: RequestTelemetry): void {
  snapshot.requests += 1;
  snapshot.promptTokens += entry.promptTokens;
  snapshot.completionTokens += entry.completionTokens;
  snapshot.totalTokens += entry.totalTokens;
  snapshot.estimatedCost += entry.estimatedCost;
  snapshot.errors += entry.status >= 400 ? 1 : 0;
  snapshot.averageDurationMs = ((snapshot.averageDurationMs * (snapshot.requests - 1)) + entry.durationMs) / snapshot.requests;
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

export function estimateCostFromProfile(
  profile: ProviderProfile,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = profile.pricing;
  if (!pricing) {
    return 0;
  }

  const inputPerMillion = pricing.inputPerMillion ?? 0;
  const outputPerMillion = pricing.outputPerMillion ?? 0;
  return safeCost(((promptTokens * inputPerMillion) + (completionTokens * outputPerMillion)) / 1_000_000);
}

export function collectTextFragments(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectTextFragments(item));
  }

  return [];
}

export function estimatePromptTokensFromPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") {
    return 0;
  }

  const body = payload as Record<string, unknown>;
  const fragments: string[] = [];

  if (typeof body.prompt === "string") {
    fragments.push(body.prompt);
  }

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== "object") {
        continue;
      }

      const candidate = message as Record<string, unknown>;
      fragments.push(...collectTextFragments(candidate.content));
      fragments.push(...collectTextFragments(candidate.name));
      fragments.push(...collectTextFragments(candidate.role));
    }
  }

  if (typeof body.input === "string") {
    fragments.push(body.input);
  }

  return estimateTokensFromText(fragments.join(" "));
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
  private readonly durations: number[] = [];
  private static readonly MAX_DURATIONS = 1000;

  record(entry: RequestTelemetry): void {
    this.totalRequests += 1;
    this.totalPromptTokens += entry.promptTokens;
    this.totalCompletionTokens += entry.completionTokens;
    this.totalTokens += entry.totalTokens;
    this.totalEstimatedCost += entry.estimatedCost;
    this.totalErrors += entry.status >= 400 ? 1 : 0;
    this.durations.push(entry.durationMs);
    if (this.durations.length > TelemetryStore.MAX_DURATIONS) {
      this.durations.shift();
    }

    if (this.recent.length >= 20) {
      this.recent.shift();
    }

    this.recent.push(entry);

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
      averageDurationMs: this.totalRequests === 0 ? 0 : this.durations.reduce((sum, value) => sum + value, 0) / this.totalRequests,
      p95DurationMs: percentile(this.durations, 0.95),
      recent: [...this.recent].reverse(),
      byProvider: Object.fromEntries(this.byProvider.entries()),
      byModel: Object.fromEntries(this.byModel.entries()),
    };
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}
