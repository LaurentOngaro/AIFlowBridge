import vscode from 'vscode';
import { API_KEY_SECRETS, DEFAULT_PROVIDER_URLS } from '../consts';
import { t } from '../i18n';
import { estimateTokenCount } from './tokens';
import { BaseChatProvider } from './base';

const MINIMAX_API_KEY_SECRET = API_KEY_SECRETS.minimax;
const MINIMAX_BASE_URL = DEFAULT_PROVIDER_URLS.minimax;

interface MiniMaxAuthManager {
	hasApiKey(): Promise<boolean>;
	getApiKey(): Promise<string | undefined>;
	setApiKey(apiKey: string): Promise<void>;
	deleteApiKey(): Promise<void>;
	promptForApiKey(): Promise<boolean>;
}

class MiniMaxAuthManagerImpl implements MiniMaxAuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	async getApiKey(): Promise<string | undefined> {
		return this.secretStorage.get(MINIMAX_API_KEY_SECRET);
	}

	async setApiKey(apiKey: string): Promise<void> {
		await this.secretStorage.store(MINIMAX_API_KEY_SECRET, apiKey.trim());
	}

	async deleteApiKey(): Promise<void> {
		await this.secretStorage.delete(MINIMAX_API_KEY_SECRET);
	}

	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		return key !== undefined && key.length > 0;
	}

	async promptForApiKey(): Promise<boolean> {
		const providerName = t('provider.minimax.name');
		const apiKey = await vscode.window.showInputBox({
			prompt: t('command.apiKeyPrompt', providerName),
			placeHolder: t('command.apiKeyPlaceholder', providerName),
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return t('command.apiKeyEmptyValidation');
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(apiKey);
			vscode.window.showInformationMessage(t('command.apiKeySaved', providerName));
			return true;
		}
		return false;
	}
}

interface MiniMaxMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface MiniMaxRequest {
	model: string;
	messages: MiniMaxMessage[];
	stream: boolean;
	max_tokens?: number;
}

export class MiniMaxChatProvider extends BaseChatProvider {
	readonly vendor = 'minimax';
	readonly apiKeySecret = MINIMAX_API_KEY_SECRET;
	readonly baseUrl = MINIMAX_BASE_URL;

	private readonly authManager: MiniMaxAuthManager;
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		super();
		this.authManager = new MiniMaxAuthManagerImpl(context);

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('aiflowbridge.providers.minimax')) {
					this.fireInformationChanged();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === MINIMAX_API_KEY_SECRET) {
					this.fireInformationChanged();
				}
			}),
		);
	}

	getAuthManager(): { hasApiKey(): Promise<boolean>; getApiKey(): Promise<string | undefined> } {
		return this.authManager;
	}

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.fireInformationChanged();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.fireInformationChanged();
		vscode.window.showInformationMessage(t('command.apiKeyRemoved', t('provider.minimax.name')));
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		_options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			const providerName = t('provider.minimax.name');
			throw new Error(t('auth.notConfigured', providerName, providerName));
		}

		const minimaxMessages: MiniMaxMessage[] = messages.map((msg) => {
			const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
			let content = '';
			for (const part of msg.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					content += part.value;
				}
			}
			return { role, content };
		});

		const request: MiniMaxRequest = {
			model: modelInfo.id,
			messages: minimaxMessages,
			stream: true,
		};

		const controller = new AbortController();
		const cancelListener = token.onCancellationRequested(() => controller.abort());

		try {
			const response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(request),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`MiniMax API error: ${response.status}`);
			}

			if (!response.body) {
				throw new Error('No response body');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				if (token.isCancellationRequested) {
					break;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === 'data: [DONE]') {
						continue;
					}

					if (!trimmed.startsWith('data: ')) {
						continue;
					}

					const jsonStr = trimmed.slice(6);
					try {
						const chunk = JSON.parse(jsonStr);
						const content = chunk.choices?.[0]?.delta?.content;
						if (content) {
							progress.report(new vscode.LanguageModelTextPart(content));
						}
					} catch {
						// Skip invalid JSON
					}
				}
			}
		} finally {
			cancelListener.dispose();
		}
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}
}