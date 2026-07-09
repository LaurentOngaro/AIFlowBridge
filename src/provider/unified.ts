import vscode from 'vscode';
import { getLoadedRegistry } from '../aiflowbridge/modelRegistry';
import type { ModelDefinition } from '../types';
import { toChatInfo } from './models';
import type { DeepSeekChatProvider } from './index';
import type { MiniMaxChatProvider } from './minimax';
import type { XiaomiChatProvider } from './xiaomi';

type AnyProvider = DeepSeekChatProvider | MiniMaxChatProvider | XiaomiChatProvider;

interface ProviderEntry {
	provider: AnyProvider;
	modelIds: Set<string>;
	hasApiKey: () => Promise<boolean>;
}

/**
 * Unified provider that delegates to the correct sub-provider based on model ID.
 * Registered once under the 'aiflowbridge' vendor.
 */
export class UnifiedChatProvider implements vscode.LanguageModelChatProvider {
	private readonly onDidChangeLanguageModelChatInformationEmitter =
		new vscode.EventEmitter<void>();

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private readonly entries: ProviderEntry[] = [];

	constructor(providers: AnyProvider[]) {
		for (const provider of providers) {
			const models = this.getModelsForProvider(provider);
			this.entries.push({
				provider,
				modelIds: new Set(models.map((m) => m.id)),
				hasApiKey: () => this.resolveHasApiKey(provider),
			});
		}
	}

	dispose(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.dispose();
	}

	refreshAll(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const results: vscode.LanguageModelChatInformation[] = [];

		for (const entry of this.entries) {
			const hasKey = await entry.hasApiKey();
			const models = this.getModelsForProvider(entry.provider);
			for (const model of models) {
				results.push(toChatInfo(model, hasKey));
			}
		}

		return results;
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const entry = this.findEntry(modelInfo.id);
		if (!entry) {
			throw new Error(`No provider found for model: ${modelInfo.id}`);
		}
		return entry.provider.provideLanguageModelChatResponse(
			modelInfo,
			messages,
			options,
			progress,
			token,
		);
	}

	async provideTokenCount(
		modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		token: vscode.CancellationToken,
	): Promise<number> {
		const entry = this.findEntry(modelInfo.id);
		if (!entry) {
			// Fallback: rough estimate
			const chars = typeof text === 'string' ? text.length : JSON.stringify(text).length;
			return Math.max(1, Math.ceil(chars / 4));
		}
		return entry.provider.provideTokenCount(modelInfo, text, token);
	}

	async prepareForDeactivate(): Promise<void> {
		for (const entry of this.entries) {
			await entry.provider.prepareForDeactivate();
		}
	}

	private findEntry(modelId: string): ProviderEntry | undefined {
		return this.entries.find((e) => e.modelIds.has(modelId));
	}

	private getModelsForProvider(provider: AnyProvider): ModelDefinition[] {
		// Each provider exposes its models via the family filter
		const vendor = this.getProviderVendor(provider);
		return getLoadedRegistry().models.filter((m) => m.family === vendor);
	}

	private getProviderVendor(provider: AnyProvider): string {
		// DeepSeekChatProvider doesn't extend BaseChatProvider, so check explicitly
		if ('family' in provider && typeof (provider as { family?: string }).family === 'string') {
			return (provider as { family: string }).family;
		}
		// For BaseChatProvider subclasses, vendor is the family
		if ('vendor' in provider && typeof (provider as { vendor?: string }).vendor === 'string') {
			return (provider as { vendor: string }).vendor;
		}
		// DeepSeekChatProvider: hardcode
		return 'deepseek';
	}

	private async resolveHasApiKey(provider: AnyProvider): Promise<boolean> {
		// DeepSeekChatProvider has hasApiKey()
		if (typeof (provider as { hasApiKey?: () => Promise<boolean> }).hasApiKey === 'function') {
			return (provider as { hasApiKey: () => Promise<boolean> }).hasApiKey();
		}
		// BaseChatProvider subclasses have getAuthManager()
		if (
			typeof (provider as { getAuthManager?: () => { hasApiKey(): Promise<boolean> } }).getAuthManager === 'function'
		) {
			return (
				provider as { getAuthManager: () => { hasApiKey(): Promise<boolean> } }
			).getAuthManager().hasApiKey();
		}
		return false;
	}
}
