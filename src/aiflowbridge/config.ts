import * as vscode from "vscode";
import { normalizeProviderProfiles } from "./providers";
import type { AiFlowBridgeConfig, GatewaySettings, ProviderProfile, VisionProxySettings } from "./types";
import { DEFAULT_PROVIDER_URLS } from "../consts";

/**
 * Well-known upstream provider profiles used as defaults when the user has not
 * explicitly configured gateway provider profiles.
 */
const DEFAULT_GATEWAY_PROFILES: Array<{ id: string; label: string; vendorConfigKey: string; model: string }> = [
	{ id: "deepseek-flash", label: "DeepSeek V4 Flash", vendorConfigKey: "deepseek", model: "deepseek-v4-flash" },
	{ id: "deepseek-pro", label: "DeepSeek V4 Pro", vendorConfigKey: "deepseek", model: "deepseek-v4-pro" },
	{ id: "minimax", label: "MiniMax V2.7", vendorConfigKey: "minimax", model: "MiniMax-M2.7" },
	{ id: "xiaomi", label: "Xiaomi MiMo V2.5 Pro", vendorConfigKey: "xiaomi", model: "mimo-v2.5-pro" },
];

function buildDefaultGatewayProfiles(configuration: vscode.WorkspaceConfiguration): ProviderProfile[] {
	const profiles: ProviderProfile[] = [];

	for (const entry of DEFAULT_GATEWAY_PROFILES) {
		const baseUrl = configuration.get<string>(`providers.${entry.vendorConfigKey}.baseUrl`)
			|| DEFAULT_PROVIDER_URLS[entry.vendorConfigKey as keyof typeof DEFAULT_PROVIDER_URLS]
			|| "";
		if (!baseUrl) {
			continue;
		}
		profiles.push({
			id: entry.id,
			label: entry.label,
			kind: "openai-compat",
			baseUrl,
			model: entry.model,
			enabled: true,
		});
	}

	return profiles;
}

export function loadConfig(): AiFlowBridgeConfig {
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
  const profiles = Array.isArray(rawProfiles) && rawProfiles.length > 0
    ? normalizeProviderProfiles(rawProfiles)
    : buildDefaultGatewayProfiles(configuration);

  return {
    gateway,
    providers: profiles,
    telemetryEnabled: configuration.get<boolean>("telemetry.enabled", true),
    logRequests: configuration.get<boolean>("telemetry.logRequests", true),
    visionProxy,
  };
}