import vscode from 'vscode';
import { MODELS } from '../consts';
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
		return MODELS.filter((m) => m.family === this.vendor);
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