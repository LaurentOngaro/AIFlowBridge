import vscode from 'vscode';
import { tryGetLoadedRegistry } from './aiflowbridge/modelRegistry';
import { CONFIG_SECTION } from './consts';
import { logger } from './logger';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

export function getProviderBaseUrl(vendor: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const key = `providers.${vendor}.baseUrl` as const;
	return config.get<string>(key) || tryGetLoadedRegistry()?.vendors[vendor]?.baseUrl || '';
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

/**
 * Picker-driven reasoning effort values emitted by the Copilot Chat model
 * picker's "Thinking Effort" dropdown (see `buildThinkingEffortSchema` in
 * `src/provider/models.ts`). Mirrored here to avoid an import cycle between
 * `config.ts` and the provider layer.
 */
export type PickerReasoningEffort = 'none' | 'high' | 'max';

/**
 * Resolve the effective `reasoning_split` value sent to the MiniMax API for
 * a given request.
 *
 * Resolution order:
 *   1. If the model does NOT advertise `capabilities.thinking`, the picker
 *      has no effect - fall through to the global `reasoningSplit` setting.
 *   2. Otherwise, if the user picked a value in the model picker, it wins:
 *      - `'none'`  -> reasoning OFF  (no reasoning tokens in the response)
 *      - `'high'`  -> reasoning ON   (full reasoning split, the MiniMax default)
 *      - `'max'`   -> reasoning ON   (MiniMax API does not expose a higher
 *                                    effort; treated as "on" for parity with
 *                                    the DeepSeek `Thinking Effort` UI)
 *   3. If the picker value is absent/unknown, fall back to the global
 *      `reasoningSplit` setting (default: `true` for backward compatibility).
 *
 * Pure function - the caller resolves the model definition, picker value,
 * and global setting. Kept separate from VS Code so it is unit-testable.
 */
export function resolveReasoningSplit(
	thinkingCapable: boolean,
	pickerReasoningEffort: PickerReasoningEffort | undefined,
	globalReasoningSplit: boolean | undefined,
): boolean {
	if (!thinkingCapable) {
		return globalReasoningSplit ?? true;
	}
	if (pickerReasoningEffort === 'none') {
		return false;
	}
	if (pickerReasoningEffort === 'high' || pickerReasoningEffort === 'max') {
		return true;
	}
	return globalReasoningSplit ?? true;
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
	pricing?: { inputPerMillion: number; outputPerMillion: number; currency: string };
}> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const raw = config.get<unknown[]>('userModels', []);
	if (!Array.isArray(raw)) {
		return [];
	}
	const result: ReturnType<typeof getUserModels> = [];
	raw.forEach((entry, index) => {
		if (!entry || typeof entry !== 'object') return;
		const e = entry as Record<string, unknown>;
		const id = typeof e.id === 'string' ? e.id.trim() : '';
		const name = typeof e.name === 'string' ? e.name.trim() : '';
		const family = typeof e.family === 'string' ? e.family.trim() : '';
		const version = typeof e.version === 'string' ? e.version.trim() : '';
		const missing: string[] = [];
		if (!id) missing.push('id');
		if (!name) missing.push('name');
		if (!family) missing.push('family');
		if (!version) missing.push('version');
		if (missing.length > 0) {
			logger.warn(
				`[AIFlowBridge] Skipping invalid aiflowbridge.userModels entry #${index + 1}` +
				(id ? ` (id="${id}")` : '') +
				`: missing required field(s): ${missing.join(', ')}`
			);
			return;
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
			pricing: parseUserModelPricing(e.pricing),
		});
	});
	return result;
}

function normalizeDebugMode(value: unknown): DebugMode | undefined {
	if (value === 'minimal' || value === 'metadata' || value === 'verbose') {
		return value;
	}
	return undefined;
}

/**
 * Parse the optional `pricing` block of a user-declared model from the
 * `aiflowbridge.userModels` setting. Same shape as the registry's
 * `ModelPricing` (input/output per million tokens + currency). Loose
 * validation: missing or invalid fields are dropped silently, mirroring the
 * behavior of the other user-model fields.
 */
function parseUserModelPricing(raw: unknown): { inputPerMillion: number; outputPerMillion: number; currency: string } | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const p = raw as Record<string, unknown>;
	if (typeof p.inputPerMillion !== 'number' || !Number.isFinite(p.inputPerMillion) || p.inputPerMillion < 0) {
		return undefined;
	}
	if (typeof p.outputPerMillion !== 'number' || !Number.isFinite(p.outputPerMillion) || p.outputPerMillion < 0) {
		return undefined;
	}
	const currency = typeof p.currency === 'string' && p.currency.trim().length > 0
		? p.currency.trim()
		: 'USD';
	return { inputPerMillion: p.inputPerMillion, outputPerMillion: p.outputPerMillion, currency };
}