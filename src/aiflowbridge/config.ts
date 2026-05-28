import * as vscode from "vscode";
import { normalizeProviderProfiles } from "./providers";
import type { AiFlowBridgeConfig, GatewaySettings, VisionProxySettings } from "./types";

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
    defaultModel: configuration.get<string>("vision.defaultModel", "oswe-vscode-prime"),
  };

  return {
    gateway,
    providers: normalizeProviderProfiles(configuration.get<unknown>("providers", [])),
    telemetryEnabled: configuration.get<boolean>("telemetry.enabled", true),
    logRequests: configuration.get<boolean>("telemetry.logRequests", true),
    visionProxy,
  };
}