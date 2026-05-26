import vscode from 'vscode';
import { API_KEY_SECRETS } from './consts';

export function getApiKeySecret(vendor: string): string {
	return API_KEY_SECRETS[vendor as keyof typeof API_KEY_SECRETS] || `aiflowbridge.providers.${vendor}.apiKey`;
}

export class AuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	async getApiKey(vendor: string = 'deepseek'): Promise<string | undefined> {
		const secretKey = await this.secretStorage.get(getApiKeySecret(vendor));
		if (secretKey) {
			return secretKey;
		}
		return undefined;
	}

	async setApiKey(vendor: string, apiKey: string): Promise<void> {
		await this.secretStorage.store(getApiKeySecret(vendor), apiKey.trim());
	}

	async deleteApiKey(vendor: string): Promise<void> {
		await this.secretStorage.delete(getApiKeySecret(vendor));
	}

	async hasApiKey(vendor: string): Promise<boolean> {
		const key = await this.getApiKey(vendor);
		return key !== undefined && key.length > 0;
	}

	async promptForApiKey(
		vendor: string,
		prompt: string,
		placeHolder: string,
	): Promise<boolean> {
		const apiKey = await vscode.window.showInputBox({
			prompt,
			placeHolder,
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return 'API key cannot be empty';
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(vendor, apiKey);
			return true;
		}
		return false;
	}
}