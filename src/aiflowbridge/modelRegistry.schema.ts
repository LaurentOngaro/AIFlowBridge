/**
 * Model registry schema - types, hand-rolled validators, and merge helpers.
 *
 * The registry is a small JSON file that lives in three tiers:
 *   - bundled   (resources/models.json, shipped with the extension)
 *   - globalStorage (<globalStorageUri>/models.json, user override)
 *   - workspace  (<workspaceFolder>/.vscode/aiflowbridge.models.json, project override)
 *
 * Tiers are merged in priority order bundled < globalStorage < workspace.
 * Per-model-id and per-vendor-key deep merge: any field absent from a higher
 * tier falls through to the lower tier.
 *
 * Validation is split in two:
 *   - validateRegistryStructure()  FAIL-HARD on the registry root
 *     (asserts root shape, version, models/vendor containers). Throws
 *     `RegistryStructureError` on failure. Called once per tier.
 *   - validateModelEntry() / validateVendorEntry()  FAIL-SOFT on individual
 *     entries. Return `null` on failure and append a structured reason to
 *     the `ValidationLog` so the loader can emit a single grouped warning.
 *
 * Validators do NOT import from `vscode` (no `logger`, no `console`) - they
 * collect skip reasons in a passed-in `ValidationLog`. This keeps them
 * importable from vitest tests without mocking the VS Code host.
 */

import type { ModelDefinition } from '../types';

// ---- Types ----

/** ISO 4217 currency code. The schema currently only knows about USD. */
export type CurrencyCode = 'USD';

/** Token-plan tariff, USD per million tokens. */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: CurrencyCode;
}

/**
 * Vendor definition: upstream connection settings + external URLs.
 * Keyed by vendor config key (`deepseek`, `minimax`, `xiaomi`).
 */
export interface VendorDefinition {
  baseUrl: string;
  apiKeySecret: string;
  externalUrls?: Record<string, string>;
}

/**
 * Model definition as stored in the registry. Superset of `ModelDefinition`
 * (from `src/types.ts`) - adds an optional `pricing` block.
 *
 * Assignable to `ModelDefinition` because `pricing` is optional. The provider
 * layer in `src/provider/*.ts` can therefore consume `RegistryModelDefinition[]`
 * without any conversion.
 */
export interface RegistryModelDefinition extends ModelDefinition {
  pricing?: ModelPricing;
}

/** Raw registry file as parsed from disk. */
export interface RegistryFile {
  version: number;
  vendors?: Record<string, VendorDefinition>;
  models: RegistryModelDefinition[];
}

/** Final merged registry consumed by the rest of the extension. */
export interface ModelRegistry {
  version: number;
  vendors: Record<string, VendorDefinition>;
  models: RegistryModelDefinition[];
  sources: RegistrySources;
}

/** Diagnostics about where each tier was loaded from, for the dashboard. */
export interface RegistrySources {
  bundled: { exists: boolean; path: string };
  globalStorage: { exists: boolean; path: string };
  workspace: { exists: boolean; path: string };
}

// ---- Validation log ----

/** One structured skip reason. The loader turns these into logger.warn() calls. */
export interface ValidationSkip {
  kind: 'model' | 'vendor' | 'capability' | 'pricing';
  key: string;
  reason: string;
}

export interface ValidationLog {
  skipped: ValidationSkip[];
}

export function emptyValidationLog(): ValidationLog {
  return { skipped: [] };
}

// ---- Fail-hard structure validator ----

const SUPPORTED_VERSIONS = new Set<number>([1]);
const KNOWN_FAMILIES = new Set<string>(['deepseek', 'minimax', 'xiaomi', 'openrouter', 'antigravity', 'googleaistudio']);
const KNOWN_CURRENCIES = new Set<string>(['USD']);

export class RegistryStructureError extends Error {
  constructor(message: string) {
    super(`Invalid model registry: ${message}`);
    this.name = 'RegistryStructureError';
  }
}

/**
 * Asserts that `raw` is a structurally valid registry file (root object,
 * numeric `version`, `models` array, optional `vendors` object). Throws
 * `RegistryStructureError` on the first failure. Per-entry content
 * validation is done separately via `validateModelEntry` /
 * `validateVendorEntry`.
 */
export function validateRegistryStructure(raw: unknown): asserts raw is RegistryFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RegistryStructureError('root must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
    throw new RegistryStructureError('"version" must be an integer');
  }
  if (!SUPPORTED_VERSIONS.has(obj.version)) {
    throw new RegistryStructureError(`unsupported version ${obj.version} (expected one of: ${[...SUPPORTED_VERSIONS].join(', ')})`);
  }

  if (obj.models === undefined || !Array.isArray(obj.models)) {
    throw new RegistryStructureError('"models" must be an array');
  }

  if (obj.vendors !== undefined && (obj.vendors === null || typeof obj.vendors !== 'object' || Array.isArray(obj.vendors))) {
    throw new RegistryStructureError('"vendors" must be an object when present');
  }
}

// ---- Fail-soft content validators ----

/**
 * Result of validating the content of one registry tier.
 *
 * The `M` parameter is `RegistryModelDefinition` for the `'strict'` mode
 * (every field is required and the returned entries are complete) and
 * `Partial<RegistryModelDefinition>` for the `'partial'` mode (only `id`
 * is required; other fields are present iff the source file provided
 * them). The TypeScript overloads on `validateRegistryContent` pin the
 * return type so callers don't have to cast.
 */
export interface ValidatedContent<M = RegistryModelDefinition> {
  vendors: Record<string, VendorDefinition>;
  models: M[];
  log: ValidationLog;
}

/**
 * Validate the content of one registry tier (already structure-validated).
 * Fail-soft: drops invalid entries, accumulates skip reasons in `log`.
 *
 * `mode` is forwarded to `validateModelEntry`:
 *   - `'strict'` for the bundled tier (all fields required). Returned
 *     `models` are `RegistryModelDefinition[]` - every field is non-null
 *     and the entries can be assigned to a `ModelRegistry.models` slot
 *     without a cast.
 *   - `'partial'` for the globalStorage / workspace overrides (only `id`
 *     required; other fields are validated if present and deep-merged
 *     over the lower-priority tier). Returned `models` are
 *     `Partial<RegistryModelDefinition>[]` - they MUST be deep-merged
 *     over a strict entry before they are usable.
 */
export function validateRegistryContent(raw: RegistryFile, mode: 'strict'): ValidatedContent<RegistryModelDefinition>;
export function validateRegistryContent(raw: RegistryFile, mode: 'partial'): ValidatedContent<Partial<RegistryModelDefinition>>;
export function validateRegistryContent(
  raw: RegistryFile,
  mode?: 'strict' | 'partial'
): ValidatedContent<RegistryModelDefinition> | ValidatedContent<Partial<RegistryModelDefinition>>;
export function validateRegistryContent(
  raw: RegistryFile,
  mode: 'strict' | 'partial' = 'strict'
): ValidatedContent<RegistryModelDefinition> | ValidatedContent<Partial<RegistryModelDefinition>> {
  const log = emptyValidationLog();
  const vendors: Record<string, VendorDefinition> = {};
  if (raw.vendors) {
    for (const [key, value] of Object.entries(raw.vendors)) {
      const v = validateVendorEntry(value);
      if (v) {
        vendors[key] = v;
      } else {
        log.skipped.push({ kind: 'vendor', key, reason: 'entry did not pass vendor validation' });
      }
    }
  }
  const models: Partial<RegistryModelDefinition>[] = [];
  raw.models.forEach((entry, index) => {
    const m = validateModelEntry(entry, index, log, mode);
    if (m) {
      models.push(m);
    }
  });
  // In strict mode the runtime invariant (every required field present) is
  // enforced by `validateModelEntry`, so the array of partials IS an array
  // of complete entries. In partial mode the array stays partial. The
  // overloads above are the source of truth for the call-site types; this
  // cast is the only place that bridges runtime and types.
  return { vendors, models: models as never, log };
}

/**
 * Validate one model entry. Returns `null` on failure and appends a skip
 * reason to `log` if provided.
 *
 * `mode`:
 *   - `'strict'` (default) - used for the bundled tier. All fields are
 *     required and must be valid. A missing or invalid field rejects the
 *     whole entry, because the bundled file ships with the extension and
 *     a broken bundled entry is a programming error.
 *   - `'partial'` - used for the globalStorage / workspace override tiers.
 *     Only `id` is required (we need it to identify the entry for the
 *     deep-merge). Other fields are validated ONLY if present; a missing
 *     field means "inherit from a lower-priority tier" and is accepted.
 *     An invalid value (e.g. `pricing: { inputPerMillion: -1 }`) still
 *     rejects the entry - the user explicitly typed something wrong and
 *     we should drop the whole override rather than silently keep stale
 *     data. The returned shape is a `Partial<RegistryModelDefinition>`
 *     that `deepMergeModel` composes over the lower-priority entry.
 */
export function validateModelEntry(
  entry: unknown,
  index: number,
  log?: ValidationLog,
  mode: 'strict' | 'partial' = 'strict'
): Partial<RegistryModelDefinition> | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    log?.skipped.push({ kind: 'model', key: `[${index}]`, reason: 'not an object' });
    return null;
  }
  const e = entry as Record<string, unknown>;

  const id = nonEmptyString(e.id);
  if (!id) {
    log?.skipped.push({ kind: 'model', key: `[${index}]`, reason: 'missing/invalid "id"' });
    return null;
  }

  const result: Partial<RegistryModelDefinition> = { id };

  // name
  if (e.name !== undefined) {
    const name = nonEmptyString(e.name);
    if (!name) {
      log?.skipped.push({ kind: 'model', key: id, reason: 'invalid "name"' });
      return null;
    }
    result.name = name;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: 'missing/invalid "name"' });
    return null;
  }

  // family
  if (e.family !== undefined) {
    const family = nonEmptyString(e.family);
    if (!family) {
      log?.skipped.push({ kind: 'model', key: id, reason: 'invalid "family"' });
      return null;
    }
    if (!KNOWN_FAMILIES.has(family)) {
      log?.skipped.push({
        kind: 'model',
        key: id,
        reason: `unknown "family" "${family}" (expected one of: ${[...KNOWN_FAMILIES].join(', ')})`,
      });
      return null;
    }
    result.family = family;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: 'missing/invalid "family"' });
    return null;
  }

  // version
  if (e.version !== undefined) {
    const version = nonEmptyString(e.version);
    if (!version) {
      log?.skipped.push({ kind: 'model', key: id, reason: 'invalid "version"' });
      return null;
    }
    result.version = version;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: 'missing/invalid "version"' });
    return null;
  }

  // detail
  if (e.detail !== undefined) {
    const detail = nonEmptyString(e.detail);
    if (!detail) {
      log?.skipped.push({ kind: 'model', key: id, reason: 'invalid "detail"' });
      return null;
    }
    result.detail = detail;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: 'missing/invalid "detail"' });
    return null;
  }

  // maxInputTokens
  if (e.maxInputTokens !== undefined) {
    const maxInputTokens = positiveInt(e.maxInputTokens);
    if (maxInputTokens === undefined) {
      log?.skipped.push({ kind: 'model', key: id, reason: '"maxInputTokens" must be a positive integer' });
      return null;
    }
    result.maxInputTokens = maxInputTokens;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: '"maxInputTokens" must be a positive integer' });
    return null;
  }

  // maxOutputTokens
  if (e.maxOutputTokens !== undefined) {
    const maxOutputTokens = positiveInt(e.maxOutputTokens);
    if (maxOutputTokens === undefined) {
      log?.skipped.push({ kind: 'model', key: id, reason: '"maxOutputTokens" must be a positive integer' });
      return null;
    }
    result.maxOutputTokens = maxOutputTokens;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: '"maxOutputTokens" must be a positive integer' });
    return null;
  }

  // requiresThinkingParam
  if (e.requiresThinkingParam !== undefined) {
    const requiresThinkingParam = booleanField(e.requiresThinkingParam);
    if (requiresThinkingParam === undefined) {
      log?.skipped.push({ kind: 'model', key: id, reason: '"requiresThinkingParam" must be a boolean' });
      return null;
    }
    result.requiresThinkingParam = requiresThinkingParam;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: '"requiresThinkingParam" must be a boolean' });
    return null;
  }

  // capabilities
  if (e.capabilities !== undefined) {
    const capabilities = validateCapabilities(e.capabilities, id, log);
    if (!capabilities) {
      return null;
    }
    result.capabilities = capabilities;
  } else if (mode === 'strict') {
    log?.skipped.push({ kind: 'model', key: id, reason: 'missing "capabilities"' });
    return null;
  }

  // pricing (always optional, even in strict mode - the registry's pricing
  // is informative, not contractual, and the synthesis falls back to the
  // family-level default when absent).
  if (e.pricing !== undefined) {
    const pricing = validatePricing(e.pricing, id, log);
    if (!pricing) {
      return null;
    }
    result.pricing = pricing;
  }

  return result;
}

function validateCapabilities(value: unknown, modelId: string, log?: ValidationLog): RegistryModelDefinition['capabilities'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    log?.skipped.push({ kind: 'capability', key: modelId, reason: '"capabilities" must be an object' });
    return null;
  }
  const c = value as Record<string, unknown>;

  const toolCalling = toolCallingField(c.toolCalling);
  if (toolCalling === undefined) {
    log?.skipped.push({
      kind: 'capability',
      key: modelId,
      reason: '"capabilities.toolCalling" must be a boolean or a non-negative integer',
    });
    return null;
  }

  const imageInput = booleanField(c.imageInput);
  if (imageInput === undefined) {
    log?.skipped.push({ kind: 'capability', key: modelId, reason: '"capabilities.imageInput" must be a boolean' });
    return null;
  }

  const thinking = booleanField(c.thinking);
  if (thinking === undefined) {
    log?.skipped.push({ kind: 'capability', key: modelId, reason: '"capabilities.thinking" must be a boolean' });
    return null;
  }

  return { toolCalling, imageInput, thinking };
}

function validatePricing(value: unknown, modelId: string, log?: ValidationLog): ModelPricing | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    log?.skipped.push({ kind: 'pricing', key: modelId, reason: '"pricing" must be an object' });
    return null;
  }
  const p = value as Record<string, unknown>;

  const inputPerMillion = nonNegativeNumber(p.inputPerMillion);
  if (inputPerMillion === undefined) {
    log?.skipped.push({ kind: 'pricing', key: modelId, reason: '"pricing.inputPerMillion" must be a non-negative number' });
    return null;
  }

  const outputPerMillion = nonNegativeNumber(p.outputPerMillion);
  if (outputPerMillion === undefined) {
    log?.skipped.push({ kind: 'pricing', key: modelId, reason: '"pricing.outputPerMillion" must be a non-negative number' });
    return null;
  }

  const currency = nonEmptyString(p.currency);
  if (!currency) {
    log?.skipped.push({ kind: 'pricing', key: modelId, reason: '"pricing.currency" must be a non-empty string' });
    return null;
  }
  if (!KNOWN_CURRENCIES.has(currency)) {
    log?.skipped.push({
      kind: 'pricing',
      key: modelId,
      reason: `unsupported "pricing.currency" "${currency}" (expected one of: ${[...KNOWN_CURRENCIES].join(', ')})`,
    });
    return null;
  }

  return { inputPerMillion, outputPerMillion, currency: currency as CurrencyCode };
}

/**
 * Validate one vendor entry. Returns `null` on failure. The caller decides
 * whether to log; this keeps the validator pure.
 */
export function validateVendorEntry(value: unknown): VendorDefinition | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;

  const baseUrl = nonEmptyString(v.baseUrl);
  if (!baseUrl) {
    return null;
  }
  const apiKeySecret = nonEmptyString(v.apiKeySecret);
  if (!apiKeySecret) {
    return null;
  }

  let externalUrls: Record<string, string> | undefined;
  if (v.externalUrls !== undefined) {
    if (v.externalUrls === null || typeof v.externalUrls !== 'object' || Array.isArray(v.externalUrls)) {
      return null;
    }
    const filtered: Record<string, string> = {};
    for (const [k, raw] of Object.entries(v.externalUrls)) {
      const val = nonEmptyString(raw);
      if (val) {
        filtered[k] = val;
      }
    }
    externalUrls = filtered;
  }

  return { baseUrl, apiKeySecret, externalUrls };
}

// ---- Field-level helpers (exported for tests) ----

export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function toolCallingField(value: unknown): boolean | number | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return undefined;
}

// ---- Deep merge ----

/**
 * Merge two model definitions, with `override` winning on each field.
 * `capabilities` and `pricing` are themselves deep-merged per key, so an
 * override that only specifies `pricing` keeps the base's other fields.
 *
 * For a field to fall through to the base, the override must OMIT the key
 * (i.e. `undefined`). A field present but `undefined` is treated the same
 * way (JSON parsing can't produce explicit `undefined`, but the type allows
 * callers to pass partial models).
 */
export function deepMergeModel(base: RegistryModelDefinition, override: Partial<RegistryModelDefinition>): RegistryModelDefinition {
  return {
    id: override.id ?? base.id,
    name: override.name ?? base.name,
    family: override.family ?? base.family,
    version: override.version ?? base.version,
    detail: override.detail ?? base.detail,
    maxInputTokens: override.maxInputTokens ?? base.maxInputTokens,
    maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
    capabilities: { ...base.capabilities, ...(override.capabilities ?? {}) },
    requiresThinkingParam: override.requiresThinkingParam ?? base.requiresThinkingParam,
    pricing: mergePricing(base.pricing, override.pricing),
  };
}

function mergePricing(base: ModelPricing | undefined, override: Partial<ModelPricing> | undefined): ModelPricing | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (!override) {
    return base;
  }
  if (!base) {
    // Override must be complete (already validated upstream).
    return override as ModelPricing;
  }
  return {
    inputPerMillion: override.inputPerMillion ?? base.inputPerMillion,
    outputPerMillion: override.outputPerMillion ?? base.outputPerMillion,
    currency: override.currency ?? base.currency,
  };
}

/**
 * Merge two vendor definitions, with `override` winning on top-level fields
 * and `externalUrls` being deep-merged per key.
 */
export function deepMergeVendor(base: VendorDefinition, override: Partial<VendorDefinition>): VendorDefinition {
  return {
    baseUrl: override.baseUrl ?? base.baseUrl,
    apiKeySecret: override.apiKeySecret ?? base.apiKeySecret,
    externalUrls: { ...(base.externalUrls ?? {}), ...(override.externalUrls ?? {}) },
  };
}

/**
 * Merge an ordered list of tiers into a single `ModelRegistry`-shaped result.
 * Earlier tiers are the base, later tiers are the overrides. The last tier
 * (typically workspace) wins on conflicts. Tiers that are `undefined`
 * (e.g. globalStorage not present) are skipped.
 *
 * Invariant: the first non-empty tier in the argument list MUST be a
 * `'strict'` tier (the bundled registry). The override tiers are
 * `'partial'` and are deep-merged over the complete bundled entry. After
 * the first insertion, every map value is a complete `RegistryModelDefinition`.
 *
 * The returned object has no `sources` field - the loader is responsible for
 * adding it.
 */
export function mergeTiers(
  ...tiers: Array<ValidatedContent<RegistryModelDefinition | Partial<RegistryModelDefinition>> | undefined>
): Pick<ModelRegistry, 'version' | 'vendors' | 'models'> {
  const vendors: Record<string, VendorDefinition> = {};
  const models = new Map<string, RegistryModelDefinition>();

  for (const tier of tiers) {
    if (!tier) {
      continue;
    }
    for (const [key, vendor] of Object.entries(tier.vendors)) {
      const existing = vendors[key];
      vendors[key] = existing ? deepMergeVendor(existing, vendor) : { ...vendor };
    }
    for (const model of tier.models) {
      // `id` is always populated by `validateModelEntry` (it rejects
      // entries without a non-empty id in both `'strict'` and
      // `'partial'` modes). The non-null assertion is safe.
      const id = model.id as string;
      const existing = models.get(id);
      if (existing) {
        models.set(id, deepMergeModel(existing, model));
      } else {
        // First tier containing this id is the bundled (strict) tier,
        // so the entry is guaranteed to be complete.
        models.set(id, model as RegistryModelDefinition);
      }
    }
  }

  return {
    version: 1,
    vendors,
    models: Array.from(models.values()),
  };
}
