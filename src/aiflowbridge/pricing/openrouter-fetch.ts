/**
 * Shared OpenRouter `GET /api/v1/models` fetch + pricing parser.
 *
 * The OpenRouter public listing (`https://openrouter.ai/api/v1/models`,
 * no auth required) is the only upstream pricing source the project can
 * automate (DeepSeek / MiniMax / Xiaomi do not expose a pricing API).
 * This helper is used by:
 *
 *   - `scripts/refresh-bundled-pricing.mjs` (release-time, regenerates
 *     `resources/pricing.json` so every shipped version carries a fresh
 *     date stamp).
 *   - `src/aiflowbridge/pricing/loader.ts` (user-side, on demand from
 *     the command palette or the dashboard's `Refresh prices` button;
 *     writes `<globalStorageUri>/pricing-override.json`).
 *
 * No dependency on `vscode`, on `node:https`, or on the workspace. Both
 * call sites use the same parser so a schema change is a single edit.
 *
 * The pricing fields from OpenRouter (`pricing.prompt` / `pricing.completion`)
 * are USD per token (string-encoded, scientific notation possible).
 * The bundled JSON stores them multiplied by 1,000,000 to align with the
 * dashboard's `inputPerMillion` / `outputPerMillion` shape. Free or
 * unmetered models (`prompt === "0"`, or missing pricing keys) are dropped.
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export interface OpenRouterRawPricing {
  /** USD per token (string). May be `"0"` for free / unmetered. */
  prompt?: string;
  /** USD per token (string). May be `"0"` for free / unmetered. */
  completion?: string;
  /** USD per request (string). Kept for the schema, not converted. */
  request?: string;
  /** USD per image (string). Kept for the schema, not converted. */
  image?: string;
}

export interface OpenRouterRawModel {
  id: string;
  name?: string;
  pricing?: OpenRouterRawPricing;
}

export interface OpenRouterRawResponse {
  data: OpenRouterRawModel[];
}

/** Pricing block in the bundled JSON / override file (USD per million tokens). */
export interface PricingEntry {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: 'USD';
  /** ISO 8601 timestamp of when the rate was fetched. */
  fetchedAt: string;
}

/** Headers exposed for unit testing the HTTP path without booting `fetch`. */
export interface FetchLike {
  (input: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    text(): Promise<string>;
  }>;
}

export interface FetchOptions {
  /** Injectable `fetch` for unit tests. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** HTTP request timeout (ms). Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Optional `AbortSignal` forwarded to `fetch`. */
  signal?: AbortSignal;
}

export class OpenRouterFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'OpenRouterFetchError';
  }
}

/**
 * Fetch the OpenRouter public model listing and return the parsed JSON.
 * Throws `OpenRouterFetchError` on HTTP failure, JSON parse error, or
 * schema drift (no `data` array). Pure HTTP layer; pricing conversion
 * lives in `parseOpenRouterPricing()`.
 */
export async function fetchOpenRouterModels(options: FetchOptions = {}): Promise<OpenRouterRawResponse> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new OpenRouterFetchError('No fetch implementation available (Node 18+ provides a global fetch).');
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal ?? controller.signal;
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, { signal });
    if (!response.ok) {
      throw new OpenRouterFetchError(`OpenRouter /v1/models returned HTTP ${response.status} ${response.statusText}`, response.status);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new OpenRouterFetchError(`OpenRouter /v1/models returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { data?: unknown }).data)) {
      throw new OpenRouterFetchError('OpenRouter /v1/models response missing top-level "data" array (schema drift).');
    }
    return parsed as OpenRouterRawResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse the OpenRouter response into a `{ modelId -> PricingEntry }`
 * map. Drops free / unmetered models (prompt === "0" or missing keys)
 * so the bundled JSON only carries metered models. Output values are
 * rounded to 6 decimals (sub-cent precision is preserved; larger
 * rounding would discard the difference between models like Gemini Pro
 * and Flash).
 *
 * Invalid entries (non-numeric strings, negative numbers) are dropped
 * silently - the next release's refresh will pick the schema back up.
 * The drift table at the end of `scripts/refresh-bundled-pricing.mjs`
 * surfaces the diff vs the previous bundled file so the maintainer can
 * eyeball what changed.
 */
export function parseOpenRouterPricing(raw: OpenRouterRawResponse, fetchedAt: string): Record<string, PricingEntry> {
  const out: Record<string, PricingEntry> = {};
  if (!raw || !Array.isArray(raw.data)) {
    return out;
  }
  for (const model of raw.data) {
    if (!model || typeof model !== 'object' || typeof model.id !== 'string' || model.id.length === 0) {
      continue;
    }
    const pricing = model.pricing;
    if (!pricing || typeof pricing !== 'object') {
      continue;
    }
    const inputPerToken = parsePriceString(pricing.prompt);
    const outputPerToken = parsePriceString(pricing.completion);
    if (inputPerToken === undefined || outputPerToken === undefined) {
      continue;
    }
    // Drop free / unmetered models. OpenRouter reports `"0"` for both
    // fields when the model is on the free tier. The bundled
    // `models.json` already lists seven free-tier flagships with
    // `pricing: $0 / $0`; the bundled pricing JSON must NOT duplicate
    // them (the per-model pricing block in `resources/models.json`
    // remains the source of truth for free models).
    if (inputPerToken === 0 && outputPerToken === 0) {
      continue;
    }
    out[model.id] = {
      inputPerMillion: roundTo(inputPerToken * 1_000_000, 6),
      outputPerMillion: roundTo(outputPerToken * 1_000_000, 6),
      currency: 'USD',
      fetchedAt,
    };
  }
  return out;
}

function parsePriceString(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Constant exported for tests so the URL is not hard-coded in two
 * places. Changing the upstream URL is a one-line edit here.
 */
export const OPENROUTER_MODELS_URL_CONSTANT = OPENROUTER_MODELS_URL;
