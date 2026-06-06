import * as vscode from "vscode";
import { getUserModels } from "../config";
import { logger } from "../logger";
import { loadModelRegistry } from "./modelRegistry";
import type { ModelRegistry } from "./modelRegistry.schema";
import { normalizeProviderProfiles } from "./providers";
import type { AiFlowBridgeConfig, GatewaySettings, ProviderProfile, VisionProxySettings } from "./types";

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
	{ id: "deepseek-flash", label: "DeepSeek V4 Flash", vendorConfigKey: "deepseek", model: "deepseek-v4-flash" },
	{ id: "deepseek-pro", label: "DeepSeek V4 Pro", vendorConfigKey: "deepseek", model: "deepseek-v4-pro" },
	// Indicative token-plan rates (USD per 1M tokens). Override via
	// `aiflowbridge.providers[].pricing` if your tier differs. See
	// https://platform.minimax.io/user-center/payment/token-plan
	{
		id: "minimax",
		label: "MiniMax V2.7",
		vendorConfigKey: "minimax",
		model: "MiniMax-M2.7",
		pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: "USD" },
	},
	// Indicative token-plan rates (USD per 1M tokens). Override via
	// `aiflowbridge.providers[].pricing` if your tier or region differs.
	// See https://token-plan-ams.xiaomimimo.com (or -sgp / -cn).
	{
		id: "xiaomi",
		label: "Xiaomi MiMo V2.5 Pro",
		vendorConfigKey: "xiaomi",
		model: "mimo-v2.5-pro",
		pricing: { inputPerMillion: 0.1, outputPerMillion: 0.3, currency: "USD" },
	},
];

function buildDefaultGatewayProfiles(
	configuration: vscode.WorkspaceConfiguration,
	registry: ModelRegistry,
): ProviderProfile[] {
	const profiles: ProviderProfile[] = [];

	for (const entry of DEFAULT_GATEWAY_PROFILES) {
		const baseUrl = configuration.get<string>(`providers.${entry.vendorConfigKey}.baseUrl`)
			|| registry.vendors[entry.vendorConfigKey]?.baseUrl
			|| "";
		if (!baseUrl) {
			continue;
		}
		// Pricing precedence for the hand-curated gateway entries:
		//   1. `entry.pricing` (the hand-curated indicative default)
		//   2. The per-model pricing from the merged registry - this is what
		//      makes T3 in `_helpers/ACTION PLAN.md` work for hand-curated
		//      entries too: editing a model's pricing in the globalStorage
		//      override is picked up here on the next activation.
		const registryEntry = registry.models.find((model) => model.id === entry.model);
		profiles.push({
			id: entry.id,
			label: entry.label,
			kind: "openai-compat",
			baseUrl,
			model: entry.model,
			enabled: true,
			pricing: entry.pricing ?? toProviderPricing(registryEntry?.pricing),
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
function getFamilyPricing(): Map<string, ProviderProfile["pricing"]> {
	const map = new Map<string, ProviderProfile["pricing"]>();
	for (const entry of DEFAULT_GATEWAY_PROFILES) {
		if (entry.pricing) {
			map.set(entry.vendorConfigKey, entry.pricing);
		}
	}
	return map;
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
function toProviderPricing(
  pricing: { inputPerMillion: number; outputPerMillion: number; currency: string } | undefined,
): ProviderProfile["pricing"] {
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
 * Pricing precedence (highest first):
 *   1. The model's own `pricing` block from the merged registry or
 *      `aiflowbridge.userModels` (i.e. whatever the globalStorage /
 *      workspace override has resolved to after the 3-tier merge in
 *      `loadModelRegistry`). This is what makes T3 in
 *      `_helpers/ACTION PLAN.md` work: editing a model's pricing in
 *      `<globalStorageUri>/models.json` and reloading VS Code must surface
 *      in the dashboard.
 *   2. The family-level indicative `familyPricing` (the hardcoded token-plan
 *      defaults in `DEFAULT_GATEWAY_PROFILES`) so un-priced models still
 *      show a non-zero "Estimated cost" out of the box.
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
  familyPricing: Map<string, ProviderProfile["pricing"]>,
  configuration: vscode.WorkspaceConfiguration,
  registry: ModelRegistry,
): ProviderProfile | undefined {
  if (taken.has(model.id)) {
    return undefined;
  }

  const family = model.family;
  const defaultUrl = registry.vendors[family]?.baseUrl;
  if (!defaultUrl) {
    return undefined;
  }

  const baseUrl = configuration.get<string>(`providers.${family}.baseUrl`)
    || defaultUrl;

  taken.add(model.id);
  return {
    id: model.id,
    label: model.name,
    kind: "openai-compat",
    baseUrl,
    model: model.id,
    enabled: true,
    pricing: toProviderPricing(model.pricing) ?? familyPricing.get(family),
  };
}

/**
 * Synthesize gateway `ProviderProfile` entries from the user's
 * `aiflowbridge.userModels` list. Each user model with a known `family`
 * (deepseek / MiniMax / xiaomi) becomes a virtual provider that:
 *
 * - Exposes the model in the gateway's `GET /v1/models` catalog
 *   (so Kilo Code, Continue, and any OpenAI-compatible client see it)
 * - Routes chat-completions to the right upstream via `selectProvider`
 *   (which matches by `profile.model`)
 *
 * Skipped when:
 * - The user model `family` is not a known vendor
 * - The model id is already covered by an existing provider
 *   (either as `provider.id` or `provider.model`)
 */
export function synthesizeProvidersFromUserModels(
	existing: ProviderProfile[],
	configuration: vscode.WorkspaceConfiguration,
	registry: ModelRegistry,
): ProviderProfile[] {
	const userModels = getUserModels();
	if (userModels.length === 0) {
		return existing;
	}

	const taken = new Set<string>();
	for (const profile of existing) {
		taken.add(profile.id);
		taken.add(profile.model);
	}

	const familyPricing = getFamilyPricing();
	const synthesized: ProviderProfile[] = [];
	for (const model of userModels) {
		const synthesizedProfile = synthesizeProviderForModel(model, taken, familyPricing, configuration, registry);
		if (synthesizedProfile) {
			synthesized.push(synthesizedProfile);
		}
	}

	return [...existing, ...synthesized];
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
	configuration: vscode.WorkspaceConfiguration,
	registry: ModelRegistry,
): ProviderProfile[] {
	const taken = new Set<string>();
	for (const profile of existing) {
		taken.add(profile.id);
		taken.add(profile.model);
	}

	const familyPricing = getFamilyPricing();
	const synthesized: ProviderProfile[] = [];
	for (const model of registry.models) {
		const synthesizedProfile = synthesizeProviderForModel(model, taken, familyPricing, configuration, registry);
		if (synthesizedProfile) {
			synthesized.push(synthesizedProfile);
		}
	}

	return [...existing, ...synthesized];
}

export async function loadConfig(context: vscode.ExtensionContext): Promise<AiFlowBridgeConfig> {
  // Load the 3-tier model registry (bundled < globalStorage < workspace).
  // Idempotent: if it was already loaded during activation we get the same
  // cached object back. The async signature lets us add remote tiers later
  // (e.g. an enterprise remote registry) without breaking call sites.
  const registry = await loadModelRegistry(context);

  const configuration = vscode.workspace.getConfiguration("aiflowbridge");

  const gateway: GatewaySettings = {
    enabled: configuration.get<boolean>("gateway.enabled", true),
    port: configuration.get<number>("gateway.port", 8787),
    baseUrl: configuration.get<string>("gateway.baseUrl", "http://127.0.0.1:8787/v1"),
    defaultModel: configuration.get<string>("gateway.defaultModel", ""),
  };

  const visionProxy: VisionProxySettings = {
    excludedVendors: configuration.get<string[]>("vision.excludedVendors", ["aiflowbridge"]),
    copilotVisionModel: configuration.get<string>("vision.copilotVisionModel", "oswe-vscode-prime"),
  };

  const rawProfiles = configuration.get<unknown>("providers", []);
  const baseProfiles = Array.isArray(rawProfiles) && rawProfiles.length > 0
    ? normalizeProviderProfiles(rawProfiles)
    : buildDefaultGatewayProfiles(configuration, registry);

  // Merge user-declared models from `aiflowbridge.userModels` into the
  // gateway catalog so external clients (Kilo Code, Continue, ...) see
  // them via `GET /v1/models` and can route requests to them.
  const withUserModels = synthesizeProvidersFromUserModels(baseProfiles, configuration, registry);

  // Synthesize gateway providers for every model in the registry that is
  // not already covered. This guarantees the gateway catalog mirrors the
  // Copilot Chat picker (MiniMax-M3, mimo-v2-omni, ...) and that each
  // model has the family-level indicative pricing attached for the
  // dashboard's "Est. cost" column.
  const providers = synthesizeProvidersFromBuiltInModels(withUserModels, configuration, registry);

  // Diagnostic: surface the final gateway provider pricing. The user can
  // diff this against the registry dump from `loadModelRegistry` to find
  // out which step drops their override. Sources are tagged so a provider
  // coming from `aiflowbridge.providers` (raw user config) is clearly
  // distinguished from one synthesized from the registry.
  const hasRawProfiles = Array.isArray(rawProfiles) && rawProfiles.length > 0;
  logger.info(`[AIFlowBridge] Gateway provider synthesis: ${providers.length} entries, source=${hasRawProfiles ? "aiflowbridge.providers (raw user config)" : "buildDefaultGatewayProfiles + synthesis"}`);
  for (const provider of providers) {
    const pricingStr = provider.pricing
      ? `in=${provider.pricing.inputPerMillion}/M out=${provider.pricing.outputPerMillion}/M ${provider.pricing.currency}`
      : '<no pricing>';
    logger.info(`[AIFlowBridge]   provider id=${provider.id.padEnd(20)} model=${provider.model.padEnd(20)} pricing=${pricingStr}`);
  }

  return {
    gateway,
    providers,
    telemetryEnabled: configuration.get<boolean>("telemetry.enabled", true),
    logRequests: configuration.get<boolean>("telemetry.logRequests", true),
    visionProxy,
  };
}
