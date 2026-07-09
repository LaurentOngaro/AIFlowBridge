import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { addCustomModelCommand } from './addCustomModel';
import { editModelRegistryCommand } from './editModelRegistry';
import { resetModelRegistryCommand } from './resetModelRegistry';

export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('aiflowbridge.showLogs', () => logger.show()),
		vscode.commands.registerCommand('aiflowbridge.openRequestDumpsFolder', () =>
			openRequestDumpsFolder(context),
		),
		vscode.commands.registerCommand('aiflowbridge.addCustomModel', () =>
			addCustomModelCommand(context),
		),
		vscode.commands.registerCommand('aiflowbridge.editModelRegistry', () =>
			editModelRegistryCommand(context),
		),
		vscode.commands.registerCommand('aiflowbridge.resetModelRegistry', () =>
			resetModelRegistryCommand(context),
		),
	);

	registerInstallStandaloneCommand(context);
}

async function openRequestDumpsFolder(context: vscode.ExtensionContext): Promise<void> {
	try {
		const root = await ensureRequestDumpRoot(context.globalStorageUri);
		logger.info(`Opening request dumps folder: ${root.toString(true)}`);
		await vscode.commands.executeCommand('revealFileInOS', root);
	} catch (error) {
		logger.warn('Failed to open request dumps folder', error);
		void vscode.window.showErrorMessage(t('extension.openRequestDumpsFolderFailed'));
	}
}

function registerInstallStandaloneCommand(context: vscode.ExtensionContext): void {
	try {
		const { installStandaloneCommand } = require('./installStandalone') as typeof import('./installStandalone');
		context.subscriptions.push(
			vscode.commands.registerCommand('aiflowbridge.installStandalone', () =>
				installStandaloneCommand(context),
			),
		);
	} catch (error) {
		logger.warn('Failed to register installStandalone command (missing dependencies)', error);
	}
}
