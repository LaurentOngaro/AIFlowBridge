export type BridgeMode = "proxy" | "vision" | "proxy+vision";
export type ProviderKind = "openai-compat" | "ollama";
export type OutputMode = "clipboard" | "insert" | "copilot";

export interface ProviderPricing {
  inputPerMillion?: number;
  outputPerMillion?: number;
  currency?: string;
}

export interface ProviderProfile {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  enabled: boolean;
  pricing?: ProviderPricing;
}

export interface VisionProxySettings {
  excludedVendors: string[];
  copilotVisionModel: string;
}

export interface GatewaySettings {
  enabled: boolean;
  port: number;
  baseUrl: string;
  defaultModel: string;
}

export interface AiFlowBridgeConfig {
  gateway: GatewaySettings;
  providers: ProviderProfile[];
  telemetryEnabled: boolean;
  logRequests: boolean;
  visionProxy: VisionProxySettings;
}

export interface GatewayStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  providerCount: number;
}

export interface RequestTelemetry {
  id: string;
  timestamp: string;
  providerId: string;
  providerLabel: string;
  model: string;
  status: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  estimated: boolean;
}

export interface ProviderSnapshot {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errors: number;
  averageDurationMs: number;
}

export interface TelemetrySnapshot {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  errors: number;
  averageDurationMs: number;
  p95DurationMs: number;
  recent: RequestTelemetry[];
  byProvider: Record<string, ProviderSnapshot>;
  byModel: Record<string, ProviderSnapshot>;
}