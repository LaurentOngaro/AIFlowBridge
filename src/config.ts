import vscode from 'vscode';
import { CONFIG_SECTION, DEFAULT_PROVIDER_URLS } from './consts';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

export function getProviderBaseUrl(vendor: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.baseUrl` as const;
	return config.get<string>(key) || DEFAULT_PROVIDER_URLS[vendor as keyof typeof DEFAULT_PROVIDER_URLS] || '';
}

export function getApiModelId(vscodeModelId: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const overrides = config.get<Record<string, string>>('providers.deepseek.modelIdOverrides');
	const override = overrides?.[vscodeModelId]?.trim();
	return override || vscodeModelId;
}

export function getProviderMaxTokens(vendor: string): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.maxTokens` as const;
	const value = config.get<number>(key, 0);
	return value > 0 ? value : undefined;
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

function normalizeDebugMode(value: unknown): DebugMode | undefined {
	if (value === 'minimal' || value === 'metadata' || value === 'verbose') {
		return value;
	}
	return undefined;
}