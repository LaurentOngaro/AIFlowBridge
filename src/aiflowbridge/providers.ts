import type { ProviderProfile } from "./types.js";

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeProviderProfiles(rawProfiles: unknown): ProviderProfile[] {
  if (!Array.isArray(rawProfiles)) {
    return [];
  }

  return rawProfiles
    .map((entry): ProviderProfile | undefined => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }

      const candidate = entry as Record<string, unknown>;
      const id = toString(candidate.id);
      const label = toString(candidate.label, id);
      const kind = candidate.kind === "ollama" ? "ollama" : "openai-compat";
      const baseUrl = toString(candidate.baseUrl);
      const model = toString(candidate.model);

      if (!id || !label || !baseUrl || !model) {
        return undefined;
      }

      const pricing = candidate.pricing && typeof candidate.pricing === "object" ? candidate.pricing as Record<string, unknown> : undefined;

      return {
        id,
        label,
        kind,
        baseUrl,
        model,
        apiKey: toString(candidate.apiKey),
        enabled: toBoolean(candidate.enabled, true),
        pricing: pricing
          ? {
              inputPerMillion: toNumber(pricing.inputPerMillion, 0) || undefined,
              outputPerMillion: toNumber(pricing.outputPerMillion, 0) || undefined,
              currency: toString(pricing.currency, "USD") || "USD",
            }
          : undefined,
      };
    })
    .filter((profile): profile is ProviderProfile => Boolean(profile));
}

export function selectProvider(
  providers: ProviderProfile[],
  requestedModel?: string,
  defaultModel?: string,
): ProviderProfile | undefined {
  const normalizedRequestedModel = requestedModel?.trim().toLowerCase();
  const normalizedDefaultModel = defaultModel?.trim().toLowerCase();
  const enabledProviders = providers.filter((profile) => profile.enabled);

  const matchingProfile = [normalizedRequestedModel, normalizedDefaultModel]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => enabledProviders.filter((profile) => {
      const aliases = [profile.id, profile.model, profile.label].map((entry) => entry.toLowerCase());
      return aliases.includes(value);
    }))
    .at(0);

  return matchingProfile ?? enabledProviders[0];
}

export function buildModelCatalog(providers: ProviderProfile[]): Array<{
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  name: string;
}> {
  const created = Math.floor(Date.now() / 1000);

  return providers
    .filter((profile) => profile.enabled)
    .map((profile) => ({
      id: profile.id,
      object: "model" as const,
      created,
      owned_by: "aiflowbridge",
      name: `${profile.label} (${profile.model})`,
    }));
}
