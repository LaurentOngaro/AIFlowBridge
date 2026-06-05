import vscode from 'vscode';
import { getLoadedRegistry } from '../aiflowbridge/modelRegistry';
import { getUserModels } from '../config';
import type { ModelDefinition } from '../types';
import { toChatInfo } from './models';

export interface BaseProviderConfig {
	vendor: string;
	apiKeySecret: string;
	baseUrl: string;
}

export abstract class BaseChatProvider implements vscode.LanguageModelChatProvider {
	protected readonly onDidChangeLanguageModelChatInformationEmitter =
		new vscode.EventEmitter<void>();

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	protected isActive = true;

	abstract readonly vendor: string;
	abstract readonly apiKeySecret: string;
	abstract readonly baseUrl: string;

	abstract getAuthManager(): { hasApiKey(): Promise<boolean>; getApiKey(): Promise<string | undefined> };

	getModelsForVendor(): ModelDefinition[] {
		const builtIn = getLoadedRegistry().models.filter((m) => m.family === this.vendor);
		const userModelsRaw = getUserModels().filter((m) => m.family === this.vendor);
		if (userModelsRaw.length === 0) {
			return builtIn;
		}
		// Merge: user models override built-in ones with the same id; user models are appended otherwise.
		const userModels: ModelDefinition[] = userModelsRaw.map((m) => ({
			id: m.id,
			name: m.name,
			family: m.family,
			version: m.version,
			detail: m.detail ?? `User-defined ${m.family} model`,
			maxInputTokens: m.maxInputTokens ?? 128000,
			maxOutputTokens: m.maxOutputTokens ?? 8192,
			capabilities: {
				toolCalling: m.capabilities?.toolCalling ?? false,
				imageInput: m.capabilities?.imageInput ?? false,
				thinking: m.capabilities?.thinking ?? false,
			},
			requiresThinkingParam: m.requiresThinkingParam ?? false,
		}));
		return [
			...builtIn.filter((m) => !userModels.some((u) => u.id === m.id)),
			...userModels,
		];
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		const hasKey = await this.getAuthManager().hasApiKey();
		return this.getModelsForVendor().map((model) => toChatInfo(model, hasKey));
	}

	abstract provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void>;

	abstract provideTokenCount(
		modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		token: vscode.CancellationToken,
	): Promise<number>;

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	protected fireInformationChanged(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}
}