import vscode from 'vscode';
import { CONFIG_SECTION, DEFAULT_PROVIDER_URLS } from './consts';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

export function getProviderBaseUrl(vendor: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.baseUrl` as const;
	return config.get<string>(key) || DEFAULT_PROVIDER_URLS[vendor as keyof typeof DEFAULT_PROVIDER_URLS] || '';
}

export function getProviderApiModelId(vendor: string, vscodeModelId: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.modelIdOverrides` as const;
	const overrides = config.get<Record<string, string>>(key);
	const override = overrides?.[vscodeModelId]?.trim();
	return override || vscodeModelId;
}

export function getApiModelId(vscodeModelId: string): string {
	return getProviderApiModelId('deepseek', vscodeModelId);
}

export function getProviderMaxTokens(vendor: string): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.maxTokens` as const;
	const value = config.get<number>(key, 0);
	return value > 0 ? value : undefined;
}

export function getProviderTemperature(vendor: string): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.temperature` as const;
	const value = config.get<number>(key, 1);
	return typeof value === 'number' && value >= 0 && value <= 2 ? value : undefined;
}

export function getProviderTopP(vendor: string): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.topP` as const;
	const value = config.get<number>(key, 1);
	return typeof value === 'number' && value > 0 && value <= 1 ? value : undefined;
}

export function getProviderReasoningSplit(vendor: string): boolean | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.reasoningSplit` as const;
	const value = config.get<boolean>(key, true);
	return typeof value === 'boolean' ? value : undefined;
}

export function getProviderReasoningRequiredForToolCalls(vendor: string): boolean {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.reasoningRequiredForToolCalls` as const;
	return config.get<boolean>(key, true);
}

export function getMaxTokens(): number | undefined {
	return getProviderMaxTokens('deepseek');
}

export function getDebugMode(): DebugMode {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const mode = config.inspect<unknown>('debugMode');
	return normalizeDebugMode(mode?.workspaceValue) ?? normalizeDebugMode(mode?.globalValue) ?? 'minimal';
}

export function getDebugLoggingEnabled(): boolean {
	return getDebugMode() !== 'minimal';
}

export function getRequestDumpEnabled(): boolean {
	return getDebugMode() === 'verbose';
}

export function getStabilizeToolListEnabled(): boolean {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<boolean>('experimental.stabilizeToolList', false);
}

/**
 * Read user-defined models from `aiflowbridge.userModels`.
 * Returns an empty array if the setting is missing or malformed.
 * Skips invalid entries (missing required fields) and logs a warning.
 */
export function getUserModels(): Array<{
	id: string;
	name: string;
	family: string;
	version: string;
	detail?: string;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	capabilities?: {
		toolCalling?: boolean | number;
		imageInput?: boolean;
		thinking?: boolean;
	};
	requiresThinkingParam?: boolean;
}> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const raw = config.get<unknown[]>('userModels', []);
	if (!Array.isArray(raw)) {
		return [];
	}
	const result: ReturnType<typeof getUserModels> = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		const id = typeof e.id === 'string' ? e.id.trim() : '';
		const name = typeof e.name === 'string' ? e.name.trim() : '';
		const family = typeof e.family === 'string' ? e.family.trim() : '';
		const version = typeof e.version === 'string' ? e.version.trim() : '';
		if (!id || !name || !family || !version) {
			console.warn('[AIFlowBridge] Skipping invalid userModels entry: missing required field (id/name/family/version)');
			continue;
		}
		result.push({
			id,
			name,
			family,
			version,
			detail: typeof e.detail === 'string' ? e.detail : undefined,
			maxInputTokens: typeof e.maxInputTokens === 'number' && e.maxInputTokens > 0 ? e.maxInputTokens : undefined,
			maxOutputTokens: typeof e.maxOutputTokens === 'number' && e.maxOutputTokens > 0 ? e.maxOutputTokens : undefined,
			capabilities: e.capabilities && typeof e.capabilities === 'object'
				? (e.capabilities as { toolCalling?: boolean | number; imageInput?: boolean; thinking?: boolean })
				: undefined,
			requiresThinkingParam: typeof e.requiresThinkingParam === 'boolean' ? e.requiresThinkingParam : undefined,
		});
	}
	return result;
}

function normalizeDebugMode(value: unknown): DebugMode | undefined {
	if (value === 'minimal' || value === 'metadata' || value === 'verbose') {
		return value;
	}
	return undefined;
}