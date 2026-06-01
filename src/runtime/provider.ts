import vscode from 'vscode';
import { logger } from '../logger';
import { DeepSeekChatProvider } from '../provider';
import { MiniMaxChatProvider } from '../provider/minimax';
import { UnifiedChatProvider } from '../provider/unified';
import { XiaomiChatProvider } from '../provider/xiaomi';

export interface RegisteredProvider {
	name: string;
	provider: DeepSeekChatProvider | MiniMaxChatProvider | XiaomiChatProvider;
}

export async function registerAllProviders(
	context: vscode.ExtensionContext,
): Promise<RegisteredProvider[]> {
	const providers: RegisteredProvider[] = [];

	const deepseekProvider = new DeepSeekChatProvider(context);
	providers.push({ name: 'deepseek', provider: deepseekProvider });

	const minimaxProvider = new MiniMaxChatProvider(context);
	providers.push({ name: 'minimax', provider: minimaxProvider });

	const xiaomiProvider = new XiaomiChatProvider(context);
	providers.push({ name: 'xiaomi', provider: xiaomiProvider });

	// Single unified provider registered under 'aiflowbridge' vendor
	const unifiedProvider = new UnifiedChatProvider([
		deepseekProvider,
		minimaxProvider,
		xiaomiProvider,
	]);

	context.subscriptions.push(
		vscode.commands.registerCommand('aiflowbridge.providers.deepseek.setApiKey', () =>
			deepseekProvider.configureApiKey(),
		),
		vscode.commands.registerCommand('aiflowbridge.providers.deepseek.clearApiKey', () =>
			deepseekProvider.clearApiKey(),
		),
		vscode.commands.registerCommand('aiflowbridge.providers.deepseek.setVisionModel', () =>
			deepseekProvider.chooseVisionProxyModel(),
		),

		vscode.commands.registerCommand('aiflowbridge.providers.minimax.setApiKey', () =>
			minimaxProvider.configureApiKey(),
		),
		vscode.commands.registerCommand('aiflowbridge.providers.minimax.clearApiKey', () =>
			minimaxProvider.clearApiKey(),
		),

		vscode.commands.registerCommand('aiflowbridge.providers.xiaomi.setApiKey', () =>
			xiaomiProvider.configureApiKey(),
		),
		vscode.commands.registerCommand('aiflowbridge.providers.xiaomi.clearApiKey', () =>
			xiaomiProvider.clearApiKey(),
		),

		// Single registration - unified provider handles all models
		vscode.lm.registerLanguageModelChatProvider('aiflowbridge', unifiedProvider),
		unifiedProvider,
	);

	await activateCopilotChat();
	deepseekProvider.refreshModelPicker();
	minimaxProvider.refreshModelPicker();
	xiaomiProvider.refreshModelPicker();

	return providers;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
