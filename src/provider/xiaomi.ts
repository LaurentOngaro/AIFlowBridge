import vscode from 'vscode';
import { API_KEY_SECRETS, DEFAULT_PROVIDER_URLS } from '../consts';
import { t } from '../i18n';
import { estimateTokenCount } from './tokens';
import { BaseChatProvider } from './base';

const XIAOMI_API_KEY_SECRET = API_KEY_SECRETS.xiaomi;
const XIAOMI_BASE_URL = DEFAULT_PROVIDER_URLS.xiaomi;

interface XiaomiAuthManager {
	hasApiKey(): Promise<boolean>;
	getApiKey(): Promise<string | undefined>;
	setApiKey(apiKey: string): Promise<void>;
	deleteApiKey(): Promise<void>;
	promptForApiKey(): Promise<boolean>;
}

class XiaomiAuthManagerImpl implements XiaomiAuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	async getApiKey(): Promise<string | undefined> {
		return this.secretStorage.get(XIAOMI_API_KEY_SECRET);
	}

	async setApiKey(apiKey: string): Promise<void> {
		await this.secretStorage.store(XIAOMI_API_KEY_SECRET, apiKey.trim());
	}

	async deleteApiKey(): Promise<void> {
		await this.secretStorage.delete(XIAOMI_API_KEY_SECRET);
	}

	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		return key !== undefined && key.length > 0;
	}

	async promptForApiKey(): Promise<boolean> {
		const providerName = t('provider.xiaomi.name');
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

interface XiaomiMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface XiaomiRequest {
	model: string;
	messages: XiaomiMessage[];
	stream: boolean;
	max_tokens?: number;
	thinking?: { type: 'enabled' | 'disabled' };
}

export class XiaomiChatProvider extends BaseChatProvider {
	readonly vendor = 'xiaomi';
	readonly apiKeySecret = XIAOMI_API_KEY_SECRET;
	readonly baseUrl = XIAOMI_BASE_URL;

	private readonly authManager: XiaomiAuthManager;
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		super();
		this.authManager = new XiaomiAuthManagerImpl(context);

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('aiflowbridge.providers.xiaomi')) {
					this.fireInformationChanged();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === XIAOMI_API_KEY_SECRET) {
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
		vscode.window.showInformationMessage(t('command.apiKeyRemoved', t('provider.xiaomi.name')));
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
			const providerName = t('provider.xiaomi.name');
			throw new Error(t('auth.notConfigured', providerName, providerName));
		}

		const xiaomiMessages: XiaomiMessage[] = messages.map((msg) => {
			const role = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
			let content = '';
			for (const part of msg.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					content += part.value;
				}
			}
			return { role, content };
		});

		const request: XiaomiRequest = {
			model: modelInfo.id,
			messages: xiaomiMessages,
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
				throw new Error(`Xiaomi MiMo API error: ${response.status}`);
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