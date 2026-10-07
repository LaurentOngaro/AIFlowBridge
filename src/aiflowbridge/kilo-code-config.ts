/**
 * Kilo Code client configuration helpers (VS Code-free).
 *
 * Kilo Code renders its reasoning-effort dropdown from the model's own
 * `variants` list, and its `/models` auto-detection reads only `id` and
 * `name` from the response body. A gateway therefore cannot push the
 * levels through the catalog: the entries have to live in the Kilo
 * configuration file. Hand-editing that file is not an acceptable
 * user journey, so this module computes the change and the
 * `AIFlowBridge: Configure Kilo Code reasoning levels` command applies
 * it.
 *
 * Everything here is pure: `parseKiloConfig` is a JSONC-tolerant reader,
 * `findGatewayProviderIds` locates the provider entries that point at
 * our gateway, and `applyEffortVariants` returns the next configuration
 * plus a per-model change report. No file is touched here; the runtime
 * command owns I/O, confirmation and the atomic write.
 */

import type { ModelRegistry } from './modelRegistry.schema';

/** A registry model that exposes a tunable reasoning depth. */
export interface EffortLevelModel {
  id: string;
  name: string;
  levels: readonly string[];
}

/** What changed for one model, for the user-facing summary. */
export interface VariantsUpdate {
  provider: string;
  model: string;
  previous: string[];
  levels: string[];
}

/** Outcome of {@link applyEffortVariants}. */
export interface ApplyVariantsResult {
  config: Record<string, unknown>;
  updates: VariantsUpdate[];
  /** Provider ids that were requested but are absent from the config. */
  unknownProviders: string[];
}

/** The Kilo variants shape for one model: one entry per declared level. */
export type EffortVariants = Record<string, { reasoningEffort: string }>;

/** Candidate Kilo configuration file names, in Kilo's own discovery order. */
export const KILO_CONFIG_FILE_NAMES: readonly string[] = ['kilo.jsonc', 'kilo.json'];

/** Directories Kilo reads a global configuration from. */
export const KILO_CONFIG_DIRS: readonly string[] = [
  '.config/kilo',
  '.kilo',
  '.kilocode',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strip `//` and slash-star comments, honouring string literals so a URL
 * such as `https://example.test` survives intact.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      // keep newlines so a later parse error still points at the right line
      if (ch === '\n') {
        out += ch;
      }
      i++;
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Drop the commas that JSONC allows before a closing brace or bracket,
 * honouring string literals so a `","` inside a value is preserved.
 */
export function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += i + 1 < text.length ? text[i + 1] : '';
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j++;
      }
      if (text[j] === '}' || text[j] === ']') {
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * Parse a Kilo configuration file, tolerating JSONC (comments, trailing
 * commas). Returns `undefined` for an empty, unparseable or non-object
 * document: the caller must never overwrite a file it could not
 * understand.
 */
export function parseKiloConfig(text: string): Record<string, unknown> | undefined {
  const withoutComments = stripJsonComments(text);
  const withoutTrailingCommas = stripTrailingCommas(withoutComments);
  try {
    const parsed: unknown = JSON.parse(withoutTrailingCommas);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reduce a base URL to a comparable `host:port` so a config entry written
 * as `http://127.0.0.1:8787/v1` still matches the gateway setting, a
 * trailing slash does not matter, and `localhost` is the same endpoint as
 * the loopback literal.
 */
export function endpointKey(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase() === 'localhost' ? '127.0.0.1' : parsed.hostname.toLowerCase();
    const port = parsed.port === '' ? '' : `:${parsed.port}`;
    return `${host}${port}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Provider ids whose `options.baseURL` points at one of `baseUrls`.
 * Matched on host:port, so the `/v1` suffix (present or absent on either
 * side) does not matter.
 */
export function findGatewayProviderIds(config: Record<string, unknown>, baseUrls: readonly string[]): string[] {
  const targets = new Set(baseUrls.map(endpointKey).filter((key) => key.length > 0));
  if (targets.size === 0) {
    return [];
  }
  const providers = config.provider;
  if (!isRecord(providers)) {
    return [];
  }
  const found: string[] = [];
  for (const [providerId, entry] of Object.entries(providers)) {
    if (!isRecord(entry)) {
      continue;
    }
    const options = entry.options;
    if (!isRecord(options)) {
      continue;
    }
    const baseUrl = options.baseURL;
    if (typeof baseUrl !== 'string') {
      continue;
    }
    if (targets.has(endpointKey(baseUrl))) {
      found.push(providerId);
    }
  }
  return found.sort();
}

/** Build the Kilo variants block for a model's declared levels. */
export function buildEffortVariants(levels: readonly string[]): EffortVariants {
  const variants: EffortVariants = {};
  for (const level of levels) {
    variants[level] = { reasoningEffort: level };
  }
  return variants;
}

/**
 * Collect the registry models that declare a reasoning-depth range.
 * These are exactly the models whose Kilo dropdown should offer the
 * levels instead of a none/thinking pair.
 */
export function collectEffortLevelModels(registry: ModelRegistry | undefined): EffortLevelModel[] {
  if (!registry) {
    return [];
  }
  const out: EffortLevelModel[] = [];
  for (const model of registry.models) {
    const levels = model.reasoningEffortLevels;
    if (!levels || levels.length === 0) {
      continue;
    }
    out.push({ id: model.id, name: model.name, levels: [...levels] });
  }
  return out;
}

function readVariantsKeys(entry: Record<string, unknown>): string[] {
  const variants = entry.variants;
  if (!isRecord(variants)) {
    return [];
  }
  return Object.keys(variants);
}

/**
 * Return the configuration with the declared levels written into every
 * requested provider, plus a per-model report of what changed.
 *
 * The `variants` block of a managed model is replaced wholesale: that is
 * what removes a stale `none` / `thinking` pair left over from Kilo's own
 * documentation snippet. Every other key of the model entry is preserved.
 * `reasoning: true` is added when absent so Kilo's model card exposes the
 * reasoning toggle.
 *
 * The input is not mutated: the caller receives a new object.
 */
export function applyEffortVariants(
  config: Record<string, unknown>,
  providerIds: readonly string[],
  models: readonly EffortLevelModel[]
): ApplyVariantsResult {
  const next: Record<string, unknown> = structuredClone(config);
  const updates: VariantsUpdate[] = [];
  const unknownProviders: string[] = [];

  const providers = isRecord(next.provider) ? (next.provider as Record<string, unknown>) : undefined;
  if (!providers) {
    return { config: next, updates, unknownProviders: [...providerIds] };
  }

  for (const providerId of providerIds) {
    const provider = providers[providerId];
    if (!isRecord(provider)) {
      unknownProviders.push(providerId);
      continue;
    }
    if (!isRecord(provider.models)) {
      // The provider may rely entirely on Kilo's auto-detection and declare
      // no model of its own. The map is created so the variants land anyway;
      // Kilo merges a config entry on top of the auto-detected catalog.
      provider.models = {};
    }
    const providerModels = provider.models as Record<string, unknown>;
    for (const model of models) {
      const existing = providerModels[model.id];
      const entry: Record<string, unknown> = isRecord(existing) ? (structuredClone(existing) as Record<string, unknown>) : {};
      const previous = readVariantsKeys(entry);
      if (entry.name === undefined && model.name.length > 0) {
        entry.name = model.name;
      }
      if (entry.reasoning !== true) {
        entry.reasoning = true;
      }
      entry.variants = buildEffortVariants(model.levels);
      providerModels[model.id] = entry;
      updates.push({ provider: providerId, model: model.id, previous, levels: [...model.levels] });
    }
  }

  return { config: next, updates, unknownProviders };
}

/** True when the declared variant keys already are the declared levels, in order. */
export function variantsMatchLevels(previous: readonly string[], levels: readonly string[]): boolean {
  return previous.length === levels.length && levels.every((level, index) => previous[index] === level);
}

/** True when every update would leave the configuration byte-identical. */
export function isAlreadyConfigured(updates: readonly VariantsUpdate[]): boolean {
  return updates.every((update) => variantsMatchLevels(update.previous, update.levels));
}

/** What the activation-time offer would change, before changing anything. */
export interface OfferCheckResult {
  offer: boolean;
  providers: string[];
  models: string[];
}

/**
 * Decide whether the user should be offered the configuration, without
 * touching anything.
 *
 * The check is deliberately silent when no Kilo provider points at our
 * gateway: at activation time there is no way to know which provider id the
 * user would pick, and guessing would either prompt people who never use
 * AIFlowBridge through Kilo Code or write into an unrelated provider.
 */
export function checkEffortVariantsNeeded(
  config: Record<string, unknown>,
  providerIds: readonly string[],
  models: readonly EffortLevelModel[]
): OfferCheckResult {
  if (providerIds.length === 0 || models.length === 0) {
    return { offer: false, providers: [], models: [] };
  }
  const result = applyEffortVariants(config, providerIds, models);
  const staleProviders = new Set<string>();
  const staleModels = new Set<string>();
  for (const update of result.updates) {
    if (!variantsMatchLevels(update.previous, update.levels)) {
      staleProviders.add(update.provider);
      staleModels.add(update.model);
    }
  }
  return {
    offer: staleModels.size > 0,
    providers: [...staleProviders].sort(),
    models: [...staleModels].sort(),
  };
}