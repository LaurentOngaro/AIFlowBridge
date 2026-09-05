import { getUserModels } from '../config';
import { logger } from '../logger';
import { loadModelRegistry } from './modelRegistry';
import type { ModelRegistry } from './modelRegistry.schema';
import { normalizeProviderProfiles, redactProvidersForLog } from './providers';
import { getLoadedPricingRegistry, loadPricingRegistry } from './pricing/loader';
import type { PricingEntry, PricingSourceLabel } from './pricing/loader';
import type { AiFlowBridgeConfig, ConfigReader, GatewaySettings, IGatewayContext, ProviderProfile, PricingConfig, VisionProxySettings } from './types';

/**
 * Well-known upstream provider profiles used as defaults when the user has not
 * explicitly configured gateway provider profiles.
 *
 * The `pricing` field is an indicative estimate of the token-plan tariff for
 * each vendor, expressed in USD per million tokens (input / output). It is
 * only used to populate the dashboard's "Estimated cost" column and the new
 * "Pricing" column. Users on a different tier, a different region, or on
 * pay-as-you-go can override it via the `aiflowbridge.providers` setting
 * (the user-configured array always wins over these defaults).
 *
 * The hand-curated gateway profiles (e.g. `deepseek-flash` with a friendly
 * label) are kept here even after the registry refactor because they are a
 * curated gateway catalog concern, not a per-model definition. The registry
 * supplies the per-model detail / capabilities / pricing that we attach to
 * the synthesized provider entries (see `synthesizeProvidersFromBuiltInModels`).
 */
interface DefaultGatewayProfileEntry {
  id: string;
  label: string;
  vendorConfigKey: string;
  model: string;
  pricing?: { inputPerMillion: number; outputPerMillion: number; currency: string };
}

const DEFAULT_GATEWAY_PROFILES: DefaultGatewayProfileEntry[] = [
  { id: 'deepseek-flash', label: 'DeepSeek V4 Flash', vendorConfigKey: 'deepseek', model: 'deepseek-v4-flash' },
  { id: 'deepseek-pro', label: 'DeepSeek V4 Pro', vendorConfigKey: 'deepseek', model: 'deepseek-v4-pro' },
  // Indicative token-plan rates (USD per 1M tokens). Override via
  // `aiflowbridge.providers[].pricing` if your tier differs. See
  // https://platform.minimax.io/user-center/payment/token-plan.
  //
  // `id` MUST match the upstream model id exactly (and equal `model`).
  // Using a vendor name (e.g. `'minimax'`) here would put a non-existent
  // id in the gateway catalog exposed to Kilo Code / Continue / Open WebUI,
  // making the picker show a fake model name that no upstream API recognises.
  // The unit test `DEFAULT_GATEWAY_PROFILES catalog ids match upstream model ids`
  // in `tests/aiflowbridge-config.test.ts` is the regression guard.
  {
    id: 'MiniMax-M2.7',
    label: 'MiniMax V2.7',
    vendorConfigKey: 'minimax',
    model: 'MiniMax-M2.7',
    pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' },
  },
  // Indicative token-plan rates (USD per 1M tokens). Override via
  // `aiflowbridge.providers[].pricing` if your tier or region differs.
  // See https://token-plan-ams.xiaomimimo.com (or -sgp / -cn).
  // Same `id == upstream model id` invariant as above; see the regression
  // test in `tests/aiflowbridge-config.test.ts`.
  {
    id: 'mimo-v2.5-pro',
    label: 'Xiaomi MiMo V2.5 Pro',
    vendorConfigKey: 'xiaomi',
    model: 'mimo-v2.5-pro',
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.3, currency: 'USD' },
  },
];

function buildDefaultGatewayProfiles(configuration: ConfigReader, registry: ModelRegistry, pricingRegistry: PricingConfig | undefined): ProviderProfile[] {
  const profiles: ProviderProfile[] = [];

  for (const entry of DEFAULT_GATEWAY_PROFILES) {
    const baseUrl = configuration.get<string>(`providers.${entry.vendorConfigKey}.baseUrl`) || registry.vendors[entry.vendorConfigKey]?.baseUrl || '';
    if (!baseUrl) {
      continue;
    }
    // Pricing precedence for the hand-curated gateway entries (action
    // plan item #1 / FEAT10):
    //   1. `entry.pricing` (the hand-curated indicative default)
    //   2. The merged pricing registry - wins over the registry's
    //      per-model block so the release-time-refreshed
    //      `resources/pricing.json` and the user's
    //      `<globalStorageUri>/pricing-override.json` propagate
    //      immediately without touching the model registry.
    //   3. The per-model pricing from the merged registry - work for
    //      hand-curated entries too: editing a model's pricing in the
    //      globalStorage override is picked up here on the next activation.
    const registryEntry = registry.models.find((model) => model.id === entry.model);
    const pricingFromRegistry = pricingRegistry?.models[entry.model];
    profiles.push({
      id: entry.id,
      label: entry.label,
      kind: 'openai-compat',
      baseUrl,
      model: entry.model,
      enabled: true,
      pricing: entry.pricing ?? toProviderPricing(pricingFromRegistry) ?? toProviderPricing(registryEntry?.pricing),
    });
  }

  return profiles;
}

/**
 * Map of `vendorConfigKey` -> indicative token-plan pricing. Used by the
 * built-in and user-model syntheses to attach a sensible default `pricing`
 * block to every DeepSeek / MiniMax / Xiaomi profile in the gateway catalog
 * (so the dashboard's "Est. cost" column is non-zero out of the box).
 */
function getFamilyPricing(): Map<string, ProviderProfile['pricing']> {
  const map = new Map<string, ProviderProfile['pricing']>();
  for (const entry of DEFAULT_GATEWAY_PROFILES) {
    if (entry.pricing) {
      map.set(entry.vendorConfigKey, entry.pricing);
    }
  }
  return map;
}

/**
 * Resolve the pricing block for a synthesized provider (action plan
 * item #1 / FEAT10). Precedence (highest first):
 *   1. The merged pricing registry (workspace > globalStorage > bundled
 *      pricing.json). The 4-tier merge in `loadPricingRegistry` already
 *      layered the per-model `models.json` blocks at the bottom; this
 *      lookup is a single `pricingRegistry.models[id]` read.
 *   2. The model's own `pricing` block from the merged registry.
 *   3. The family-level indicative `familyPricing` (the hardcoded
 *      token-plan defaults in `DEFAULT_GATEWAY_PROFILES`) so un-priced
 *      models still show a non-zero "Estimated cost" out of the box.
 *
 * Returns the matching `PricingSourceLabel` so the host-config
 * diagnostic can label each row with the active source.
 */
function resolvePricingForModel(
  modelId: string,
  modelPricing: { inputPerMillion: number; outputPerMillion: number; currency: string } | undefined,
  pricingRegistry: PricingConfig | undefined,
  familyPricing: Map<string, ProviderProfile['pricing']>,
  family: string
): { pricing: ProviderProfile['pricing']; source: PricingSourceLabel | 'family default' | 'none' } {
  const fromRegistry = pricingRegistry?.models[modelId];
  if (fromRegistry) {
    return {
      pricing: toProviderPricing(fromRegistry),
      source: pricingRegistry?.sources[modelId] ?? 'bundled (pricing.json)',
    };
  }
  if (modelPricing) {
    return {
      pricing: toProviderPricing(modelPricing),
      source: 'bundled (models.json)',
    };
  }
  const familyDefault = familyPricing.get(family);
  if (familyDefault) {
    return { pricing: familyDefault, source: 'family default' };
  }
  return { pricing: undefined, source: 'none' };
}

/**
 * Convert a pricing block (registry's `ModelPricing` or a user-model's
 * `pricing`, both shaped as `{ inputPerMillion, outputPerMillion, currency }`)
 * into the `ProviderProfile["pricing"]` shape (same fields, all optional).
 *
 * The shapes are structurally compatible; the cast is safe because the
 * registry schema validator (`validatePricing` in `modelRegistry.schema.ts`)
 * and the user-models parser (`parseUserModelPricing` in `src/config.ts`)
 * both enforce the same numeric / non-empty-currency constraints that the
 * provider profile ultimately needs.
 */
function toProviderPricing(pricing: { inputPerMillion: number; outputPerMillion: number; currency: string } | undefined): ProviderProfile['pricing'] {
  if (!pricing) {
    return undefined;
  }
  return {
    inputPerMillion: pricing.inputPerMillion,
    outputPerMillion: pricing.outputPerMillion,
    currency: pricing.currency,
  };
}

/**
 * Build a `ProviderProfile` for a given model id / name / family.
 *
 * Pricing precedence (highest first) is delegated to
 * `resolvePricingForModel` (action plan item #1 / FEAT10): merged
 * pricing registry > registry entry pricing > family default.
 *
 * Returns `undefined` when the family has no default upstream URL or when
 * the model id is already taken.
 */
function synthesizeProviderForModel(
  model: {
    id: string;
    name: string;
    family: string;
    pricing?: { inputPerMillion: number; outputPerMillion: number; currency: string };
  },
  taken: Set<string>,
  familyPricing: Map<string, ProviderProfile['pricing']>,
  configuration: ConfigReader,
  registry: ModelRegistry,
  pricingRegistry: PricingConfig | undefined
): ProviderProfile | undefined {
  if (taken.has(model.id)) {
    return undefined;
  }

  const family = model.family;
  const defaultUrl = registry.vendors[family]?.baseUrl;
  if (!defaultUrl) {
    return undefined;
  }

  const baseUrl = configuration.get<string>(`providers.${family}.baseUrl`) || defaultUrl;

  const resolved = resolvePricingForModel(model.id, model.pricing, pricingRegistry, familyPricing, family);

  taken.add(model.id);
  // The `googleaistudio` family has TWO auth routes, and only the AGY
  // OAuth one requires the `kind: 'googleaistudio'` runtime branch
  // (envelope + SSE transform). The BYOK public-API route is plain
  // OpenAI-compatible and goes through the upstream generic path.
  //
  // Synthesizing the BYOK profiles (pointed at
  // `generativelanguage.googleapis.com`) as `kind: 'googleaistudio'`
  // would route them through `buildAntigravityUpstreamRequest`, which
  // would try to use the OAuth token manager and reject the call with
  // 503. We therefore key on `family` + baseUrl host: an Antigravity
  // baseUrl (`cloudcode-pa.googleapis.com`) keeps the AGY branch; any
  // other baseUrl on the same family tags the profile `openai-compat`
  // with the BYOK billing posture (per-token).
  const upstreamHost = (() => {
    try {
      return new URL(baseUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const isAntigravityHost = upstreamHost === 'cloudcode-pa.googleapis.com';
  const kind: ProviderProfile['kind'] = isAntigravityHost ? 'googleaistudio' : 'openai-compat';
  // Billing mode:
  //   - Antigravity OAuth (`kind: 'googleaistudio'`, cloudcode-pa host)
  //     -> always plan-covered: usage is on the user's Google AI plan.
  //   - Gemini public API BYOK (`kind: 'openai-compat'`,
  //     generativelanguage host, any other googleaistudio family baseUrl)
  //     -> per-token: the API key route bills against the user's GCP
  //     project's pay-as-you-go counter. The plan-coverage flag would
  //     hide a real charge, so it must NOT be set automatically.
  const billing: ProviderProfile['billing'] = isAntigravityHost ? 'plan' : undefined;
  return {
    id: model.id,
    label: model.name,
    kind,
    baseUrl,
    model: model.id,
    enabled: true,
    pricing: resolved.pricing,
    ...(billing ? { billing } : {}),
  };
}

/**
 * Shared body of `synthesizeProvidersFromUserModels` and
 * `synthesizeProvidersFromBuiltInModels`. The only difference between the
 * two is the source list of model definitions; everything else (taken-set
 * computation, family-pricing lookup, per-model synthesis, dedupe) is
 * identical. Factored out so a future change (e.g. a third model source)
 * is a single edit instead of two near-identical blocks.
 */
function synthesizeProvidersFromModels(
  existing: ProviderProfile[],
  configuration: ConfigReader,
  registry: ModelRegistry,
  models: Parameters<typeof synthesizeProviderForModel>[0][],
  pricingRegistry: PricingConfig | undefined
): ProviderProfile[] {
  const taken = new Set<string>();
  for (const profile of existing) {
    taken.add(profile.id);
    taken.add(profile.model);
  }

  const familyPricing = getFamilyPricing();
  const synthesized: ProviderProfile[] = [];
  for (const model of models) {
    const synthesizedProfile = synthesizeProviderForModel(model, taken, familyPricing, configuration, registry, pricingRegistry);
    if (synthesizedProfile) {
      synthesized.push(synthesizedProfile);
    }
  }

  return [...existing, ...synthesized];
}

export function synthesizeProvidersFromUserModels(
  existing: ProviderProfile[],
  configuration: ConfigReader,
  registry: ModelRegistry,
  pricingRegistry?: PricingConfig
): ProviderProfile[] {
  const userModels = getUserModels();
  if (userModels.length === 0) {
    return existing;
  }
  return synthesizeProvidersFromModels(existing, configuration, registry, userModels, pricingRegistry);
}

/**
 * Synthesize gateway `ProviderProfile` entries for every model in the
 * model registry that is not already covered by an existing provider. This
 * makes the gateway catalog mirror the Copilot Chat picker (every model
 * exposed there is also reachable as a gateway model, with the correct
 * `baseUrl` and a sensible indicative `pricing` block).
 *
 * Hand-curated entries from `DEFAULT_GATEWAY_PROFILES` (e.g. `deepseek-flash`
 * with a friendly label) take precedence - the synthesis only fills in
 * models that are not already in `existing`.
 */
export function synthesizeProvidersFromBuiltInModels(
  existing: ProviderProfile[],
  configuration: ConfigReader,
  registry: ModelRegistry,
  pricingRegistry?: PricingConfig
): ProviderProfile[] {
  return synthesizeProvidersFromModels(existing, configuration, registry, registry.models, pricingRegistry);
}

/**
 * Build the gateway config from a generic `IGatewayContext`.
 *
 * The runtime (`AIFlowBridgeRuntime`) and the standalone entry point
 * (`src/standalone/main.ts`) call this function directly - there is no
 * longer a VS Code-specific wrapper, the VS Code adapter hands a
 * `createVSCodeContext(context)` `IGatewayContext` straight to this
 * function. The 3-tier model registry must already have been loaded
 * once via `loadModelRegistry(ctx)` during activation; this function
 * returns the cached registry on the implicit cache hit.
 */
export async function loadConfigFromContext(ctx: IGatewayContext): Promise<AiFlowBridgeConfig> {
  // `loadModelRegistry` accepts the same shape as `IGatewayContext`
  // (the `RegistryHost` type in `modelRegistry.ts`): it only needs
  // `extensionUri`, `globalStorageDir`, and the optional `workspaceFolder`
  // / `fs`. The standalone entry point (`src/standalone/main.ts`) calls
  // this function directly with its own `IGatewayContext`.
  const registry = await loadModelRegistry(ctx);

  // Action plan item #1 / FEAT10: load the 4-tier pricing registry.
  // `loadPricingRegistry` reads the workspace / globalStorage /
  // bundled tiers and merges them over the per-model `pricing` blocks
  // from the registry (lowest priority). Missing or malformed files
  // are logged at WARN and skipped - activation never crashes.
  // `pricingFromRegistryPerModel` is the explicit list of registry
  // entries whose `pricing` blocks participate in the lowest-priority
  // tier of the merge.
  const pricingFromRegistryPerModel: Record<string, PricingEntry> = {};
  for (const model of registry.models) {
    if (model.pricing) {
      pricingFromRegistryPerModel[model.id] = {
        inputPerMillion: model.pricing.inputPerMillion,
        outputPerMillion: model.pricing.outputPerMillion,
        currency: model.pricing.currency,
        fetchedAt: '',
      };
    }
  }
  await loadPricingRegistry(ctx, undefined, pricingFromRegistryPerModel);
  const pricingRegistryRuntime = getLoadedPricingRegistry();
  const pricingRegistry: PricingConfig = {
    models: pricingRegistryRuntime.models,
    sources: pricingRegistryRuntime.sourceByModel,
    bundledFetchedAt: pricingRegistryRuntime.bundledFetchedAt,
    bundledVersion: pricingRegistryRuntime.bundledVersion,
  };

  const configuration = ctx.getConfiguration();

  const gateway: GatewaySettings = {
    enabled: configuration.get<boolean>('gateway.enabled', true),
    port: configuration.get<number>('gateway.port', 8787),
    baseUrl: configuration.get<string>('gateway.baseUrl', 'http://127.0.0.1:8787/v1'),
    defaultModel: configuration.get<string>('gateway.defaultModel', ''),
    // 500 ms default (was 200 ms in 1.7.0). The runtime
    // applies one retry after 100 ms, so the total budget is 1.1 s.
    // Higher values are useful for slow peer startups (cold start of
    // the standalone binary on Windows).
    probeTimeoutMs: configuration.get<number>('gateway.probeTimeoutMs', 500),
    // 20 concurrent upstream requests. The gateway returns
    // 429 above this cap. Set to a high value (e.g. 1000) for local
    // development where one process is the only client; the cap is
    // mainly a protection against misbehaving test scripts.
    maxConcurrentRequests: configuration.get<number>('gateway.maxConcurrentRequests', 20),
    // cap parallel in-flight requests per upstream
    // provider. 3 agents in parallel against MiniMax-M3 used to send
    // 3 parallel thinking-mode requests + 3 parallel pre-count
    // POSTs against the same API key, which MiniMax throttled to
    // 100 s+ tail latency. A cap of 3 queues the 4th+ parallel
    // request behind the first three instead of opening more
    // upstream sockets. Set to 0 to disable (no cap).
    maxConcurrentPerProvider: configuration.get<number>('gateway.maxConcurrentPerProvider', 3),
    // idle-stream watchdog. Aborts the upstream `fetch`
    // when no bytes arrive for this many ms. Caps the "agent in
    // standby for minutes" symptom when MiniMax silently queues a
    // thinking-mode request without sending bytes. Set to 0 to
    // disable.
    upstreamIdleTimeoutMs: configuration.get<number>('gateway.upstreamIdleTimeoutMs', 90_000),
    // total-stream ceiling. Hard upper bound on the
    // upstream call duration even when bytes keep flowing. Bounded
    // safety net for the idle watchdog. Set to 0 to disable.
    streamTotalTimeoutMs: configuration.get<number>('gateway.streamTotalTimeoutMs', 300_000),
    // gate the parallel `fetchMinimaxPromptTokens`
    // pre-count on streaming requests. The MiniMax stream endpoint
    // emits usage on the final chunk; the parallel pre-count
    // doubles upstream load precisely when thinking-mode bursts
    // hurt the most. Default `false` (skip on streaming). Set to
    // `true` to restore the pre-2.5.1 behavior on streaming too.
    minimaxParallelTokenCount: configuration.get<boolean>('gateway.minimaxParallelTokenCount', false),
    // Buffered Gemini / Antigravity replay. When `true` the gateway
    // drains the full upstream SSE body before reshaping it into
    // OpenAI frames (robust on lossy links, slower TTFT). Default
    // `false` (real-time `pipeThrough` streaming, best TTFT).
    bufferGeminiStream: configuration.get<boolean>('gateway.bufferGeminiStream', false),
    // Action plan item #2: workspace-context detector / system-message
    // injector. The detector scans the workspace root for language
    // manifests (pyproject.toml, Cargo.toml, package.json, ...) and
    // prepends a short system message describing the languages /
    // package managers / linters / formatters it found. Opt-out for
    // non-code workspaces via `enabled: false` (or set
    // `aiflowbridge.gateway.workspaceContext.enabled` to false in user
    // settings). The root is resolved in this order:
    // 1. `gateway.workspaceContext.root` setting (explicit).
    // 2. `AIFLOWBRIDGE_WORKSPACE` env var (service-manager launch).
    // 3. `process.cwd()` (standalone CLI launched from project root).
    // 4. The VS Code workspace folder (handled by the host adapter,
    //    not the standalone CLI).
    workspaceContext: {
      enabled: configuration.get<boolean>('gateway.workspaceContext.enabled', true),
      root: configuration.get<string>('gateway.workspaceContext.root', ''),
      maxDepth: configuration.get<number>('gateway.workspaceContext.maxDepth', 2),
      ignoredDirs: configuration.get<string[]>('gateway.workspaceContext.ignoredDirs', [
        'node_modules',
        'target',
        'build',
        'dist',
        '.git',
        '.idea',
        '.vscode',
        '__pycache__',
        '.gradle',
        'venv',
        '.venv',
        '.next',
        '.turbo',
      ]),
    },
    // Action plan item #5: language-based routing rules. Optional
    // map of `language -> providerId` so a polyglot project's traffic
    // automatically lands on the best model for that language. The
    // `*` wildcard is the fallback for any language not explicitly
    // mapped. Empty / missing / non-object values are treated as
    // "no routing rule" (falls back to `selectProvider(model,
    // defaultModel)` unchanged). Stored as a flat string map so
    // the VS Code settings schema stays simple.
    languageRouting: configuration.get<Record<string, string>>('gateway.languageRouting', {}),
    // header-driven language routing. Default `true` for
    // backward compatibility with existing loopback clients that
    // send the explicit header. Set to `false` on shared /
    // hardened machines where peers must not be allowed to pin the
    // routing decision.
    allowLanguageHeaderOverride: configuration.get<boolean>('gateway.allowLanguageHeaderOverride', true),
    // SSE event-stream guardrails. `maxConnections`
    // caps simultaneous subscribers, `maxLifetimeMs` caps the
    // per-connection wall-clock, and `includeSummariesInEvents`
    // keeps `promptSummary` / `responseSummary` out of the
    // default event payload (the replay endpoint remains the
    // explicit way to fetch them).
    events: {
      maxConnections: configuration.get<number>('gateway.events.maxConnections', DEFAULT_EVENTS_MAX_CONNECTIONS),
      maxLifetimeMs: configuration.get<number>('gateway.events.maxLifetimeMs', DEFAULT_EVENTS_MAX_LIFETIME_MS),
      includeSummariesInEvents: configuration.get<boolean>('gateway.events.includeSummariesInEvents', false),
    },
    // Action plan item #4: zero-conf discovery. Default off so the
    // standalone CLI does not emit UDP packets on shared machines
    // unless explicitly opted in. The HTTP `/v1/discovery`
    // endpoint is also gated on this flag (turning it off makes
    // the LAN-wide path a no-op; the user can still fetch a one-
    // paste URL from the dashboard).
    discovery: {
      enabled: configuration.get<boolean>('gateway.discovery.enabled', false),
      broadcastPort: configuration.get<number>('gateway.discovery.broadcastPort', 8788),
      broadcastIntervalMs: configuration.get<number>('gateway.discovery.broadcastIntervalMs', 2_000),
    },
  };

  const visionProxy: VisionProxySettings = {
    excludedVendors: configuration.get<string[]>('vision.excludedVendors', ['aiflowbridge']),
    copilotVisionModel: configuration.get<string>('vision.copilotVisionModel', 'oswe-vscode-prime'),
  };

  const rawProfiles = configuration.get<unknown>('providers', []);
  const baseProfiles =
    Array.isArray(rawProfiles) && rawProfiles.length > 0
      ? normalizeProviderProfiles(rawProfiles)
      : buildDefaultGatewayProfiles(configuration, registry, pricingRegistry);

  // surface the common "double /v1" foot-gun. `resolveUpstreamUrl`
  // in the gateway appends a relative path to `baseUrl` via `new URL(path,
  // baseUrl)`. A `baseUrl` that already ends with `/v1` works (the path
  // is appended after the slash), but a `baseUrl` ending with `/v1/v1`
  // (or `/v1/`) routes requests to `<base>/v1/v1/chat/completions` which
  // most upstreams reject with 404. Warn instead of failing silently
  // so the misconfiguration is obvious from the logs.
  for (const provider of baseProfiles) {
    try {
      const parsed = new URL(provider.baseUrl);
      if (parsed.pathname.endsWith('/v1/v1') || parsed.pathname.endsWith('/v1/')) {
        logger.warn(
          `[AIFlowBridge] Provider "${provider.id}" baseUrl ends with a duplicated /v1 (${provider.baseUrl}); ` +
            `requests will be routed to <base>/v1/v1/chat/completions. Drop the trailing /v1 from baseUrl.`
        );
      }
    } catch {
      // Already validated upstream.
    }
  }

  // Merge user-declared models from `aiflowbridge.userModels` into the
  // gateway catalog so external clients (Kilo Code, Continue, ...) see
  // them via `GET /v1/models` and can route requests to them. `getUserModels()`
  // reads from `vscode.workspace.getConfiguration` on VS Code; in standalone
  // mode the same `getUserModels()` is wired through the `vscode` shim
  // (`src/standalone/vscode-shim.ts:64-87`) which reads `userModels`
  // from `~/.aiflowbridge/config.json`, so user-declared models are
  // honoured in both hosts.
  const withUserModels = synthesizeProvidersFromUserModels(baseProfiles, configuration, registry, pricingRegistry);

  // Synthesize gateway providers for every model in the registry that is
  // not already covered. This guarantees the gateway catalog mirrors the
  // Copilot Chat picker (MiniMax-M3, mimo-v2-omni, ...) and that each
  // model has the family-level indicative pricing attached for the
  // dashboard's "Est. cost" column.
  const providers = synthesizeProvidersFromBuiltInModels(withUserModels, configuration, registry, pricingRegistry);

  // Diagnostic: surface the final gateway provider pricing. The user can
  // diff this against the registry dump from `loadModelRegistry` to find
  // out which step drops their override. Sources are tagged so a provider
  // coming from `aiflowbridge.providers` (raw user config) is clearly
  // distinguished from one synthesized from the registry.
  //
  // `redactProvidersForLog` strips the `apiKey` field and adds
  // an `apiKeyPresent` boolean so future verbose dumps (or anyone who
  // copy-pastes this loop and changes `${provider}` to a
  // `JSON.stringify(provider)`) never leak credentials.
  const hasRawProfiles = Array.isArray(rawProfiles) && rawProfiles.length > 0;
  const redacted = redactProvidersForLog(providers);
  logger.info(
    `[AIFlowBridge] Gateway provider synthesis: ${providers.length} entries, source=${hasRawProfiles ? 'aiflowbridge.providers (raw user config)' : 'buildDefaultGatewayProfiles + synthesis'}`
  );
  for (const provider of redacted) {
    const pricingStr = provider.pricing
      ? `in=${provider.pricing.inputPerMillion}/M out=${provider.pricing.outputPerMillion}/M ${provider.pricing.currency}`
      : '<no pricing>';
    // Action plan item #1 / FEAT10: append the 4-tier pricing source
    // tag to the per-row diagnostic so the user can confirm the
    // override they expected is the one that won. For the bundled
    // file the tag also includes the `generatedAt` + AIFlowBridge
    // version stamp from `resources/pricing.json` so the freshness
    // of the rate they are looking at is visible from the log.
    const pricingSource = provider.model ? pricingRegistry.sources[provider.model] : undefined;
    const pricingTag = pricingSource
      ? `source=${pricingSource}` + (pricingSource === 'bundled (pricing.json)' && pricingRegistry.bundledFetchedAt
          ? ` (generatedAt=${pricingRegistry.bundledFetchedAt} v${pricingRegistry.bundledVersion || '<unknown>'})`
          : '')
      : '';
    logger.info(
      `[AIFlowBridge]   provider id=${provider.id.padEnd(20)} model=${provider.model.padEnd(20)} apiKey=${provider.apiKeyPresent ? '***' : '<none>'} pricing=${pricingStr}${pricingTag ? ' ' + pricingTag : ''}`
    );
  }

  return {
    gateway,
    providers,
    // Action plan item #1 / FEAT10. Snapshot of the merged pricing
    // registry, surfaced on the dashboard's `Est. cost` tooltips so
    // the user can see the freshness of the rate they are looking at.
    pricing: pricingRegistry,
    telemetryEnabled: configuration.get<boolean>('telemetry.enabled', true),
    logRequests: configuration.get<boolean>('telemetry.logRequests', true),
    // Action plan item #3: enable by default so the Shared Session
    // panel + replay + SSE work out of the box. Opt-out is a single
    // setting (`aiflowbridge.telemetry.captureSessionLog = false`).
    captureSessionLog: configuration.get<boolean>('telemetry.captureSessionLog', true),
    // bounded on-disk footprint for the session-log feature.
    // `0` disables the cap / retention entirely so a hardened
    // environment can opt out without changing defaults.
    telemetryMaxStoredRequestBytes: configuration.get<number>('telemetry.maxStoredRequestBytes', DEFAULT_TELEMETRY_MAX_STORED_BYTES),
    telemetryRetentionDays: configuration.get<number>('telemetry.retentionDays', DEFAULT_TELEMETRY_RETENTION_DAYS),
    visionProxy,
  };
}

const DEFAULT_TELEMETRY_MAX_STORED_BYTES = 8192;
const DEFAULT_TELEMETRY_RETENTION_DAYS = 90;
const DEFAULT_EVENTS_MAX_CONNECTIONS = 16;
const DEFAULT_EVENTS_MAX_LIFETIME_MS = 30 * 60 * 1000;
