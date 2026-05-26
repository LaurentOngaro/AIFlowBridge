import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { DeepSeekChatProvider } from '../provider';
import { registerAllProviders, type RegisteredProvider } from './provider';
import { registerActionUrls } from './actions';
import { registerCommands } from './commands';
import { initializeDiagnostics } from './diagnostics';
import { showWelcomeIfNeeded } from './welcome';
import { activate as activateAIFlowBridge, deactivate as deactivateAIFlowBridge } from '../aiflowbridge';

let activeProviders: RegisteredProvider[] = [];
let deepseekProvider: DeepSeekChatProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await initializeDiagnostics(context);
	registerCommands(context);
	registerActionUrls(context);

	try {
		activeProviders = await registerAllProviders(context);
		deepseekProvider = activeProviders.find((p) => p.name === 'deepseek')?.provider as DeepSeekChatProvider;

		if (deepseekProvider) {
			void showWelcomeIfNeeded(context, deepseekProvider).catch((error) => {
				logger.warn(t('extension.welcomeFailed'), error);
			});
		}

		await activateAIFlowBridge(context);

		logger.info(`Extension activated version=${context.extension.packageJSON.version}`);
	} catch (error) {
		logger.error('Failed to activate extension', error);
		void vscode.window.showErrorMessage(t('extension.activateFailed'));
		throw error;
	}
}

export async function deactivate(): Promise<void> {
	try {
		await deactivateAIFlowBridge();
		for (const { provider } of activeProviders) {
			await provider.prepareForDeactivate();
		}
	} catch (error) {
		logger.warn(t('extension.deactivateFailed'), error);
	} finally {
		activeProviders = [];
		deepseekProvider = undefined;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}