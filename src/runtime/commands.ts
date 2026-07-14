import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { addCustomModelCommand } from './addCustomModel';
import { editModelRegistryCommand } from './editModelRegistry';
import { exportTelemetryToFileCommand } from './exportTelemetry';
import { openPricingDataCommand } from './openPricingData';
import { refreshPricingCommand } from './refreshPricing';
import { resetModelRegistryCommand } from './resetModelRegistry';

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('aiflowbridge.showLogs', () => logger.show()),
    vscode.commands.registerCommand('aiflowbridge.openRequestDumpsFolder', () => openRequestDumpsFolder(context)),
    vscode.commands.registerCommand('aiflowbridge.addCustomModel', () => addCustomModelCommand(context)),
    vscode.commands.registerCommand('aiflowbridge.editModelRegistry', () => editModelRegistryCommand(context)),
    vscode.commands.registerCommand('aiflowbridge.resetModelRegistry', () => resetModelRegistryCommand(context)),
    // Action plan item #1 / FEAT10: dynamic pricing refresh + open
    // pricing data commands. The dashboard `Refresh prices` button
    // is wired through the runtime (see
    // `src/aiflowbridge/index.ts:registerCommands`), not through
    // this VS Code-only command file, because the dashboard's
    // message handler needs the in-memory registry update to land
    // before the panel re-renders.
    vscode.commands.registerCommand('aiflowbridge.refreshPricing', () => refreshPricingCommand(context)),
    vscode.commands.registerCommand('aiflowbridge.openPricingData', () => openPricingDataCommand(context)),
    // AFF07: internal command invoked by the dashboard webview when
    // the user clicks the `Export CSV` / `Export JSON` button. The
    // webview builds the export payload client-side (so the
    // download honors every active filter) then ships it to the host
    // via `vscode.commands.executeCommand` - the host owns the
    // save dialog + disk write because the default VS Code webview
    // CSP blocks the `blob:` URL a synthetic anchor download would
    // need. The command name is internal (no `contributes.commands`
    // entry) so the user only ever reaches it through the
    // dashboard's Export buttons.
    vscode.commands.registerCommand('aiflowbridge.exportToFile', (payload: unknown) => exportTelemetryToFileCommand(payload as Parameters<typeof exportTelemetryToFileCommand>[0]))
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
    context.subscriptions.push(vscode.commands.registerCommand('aiflowbridge.installStandalone', () => installStandaloneCommand(context)));
  } catch (error) {
    logger.warn('Failed to register installStandalone command (missing dependencies)', error);
  }
}
