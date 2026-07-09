/**
 * `AIFlowBridge: Reset model registry to bundled defaults` command.
 *
 * Removes `<globalStorageUri>/models.json` after a confirmation dialog, so
 * the next `loadModelRegistry()` call falls back to the bundled defaults.
 * Because the registry is loaded once at activation, the change only takes
 * effect after a window reload - we offer that as a follow-up action.
 */

import * as vscode from 'vscode';
import { logger } from '../logger';
import { GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH } from '../aiflowbridge/modelRegistry';

export async function resetModelRegistryCommand(context: vscode.ExtensionContext): Promise<void> {
  const globalStorageUri = vscode.Uri.joinPath(context.globalStorageUri, ...GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH);

  if (!(await fileExists(globalStorageUri))) {
    void vscode.window.showInformationMessage('No model registry override to reset - the bundled defaults are already in effect.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Reset the model registry override to bundled defaults? Your customizations will be lost.',
    { modal: true },
    'Reset'
  );
  if (confirm !== 'Reset') {
    return;
  }

  try {
    await vscode.workspace.fs.delete(globalStorageUri);
  } catch (err) {
    logger.error('[AIFlowBridge] Failed to delete model registry override', err);
    void vscode.window.showErrorMessage(`Failed to delete model registry override: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  logger.info(`[AIFlowBridge] Removed model registry override at ${globalStorageUri.toString()}`);

  const reload = await vscode.window.showInformationMessage(
    'Model registry override removed. Reload the window to apply the bundled defaults?',
    'Reload Window'
  );
  if (reload === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (err) {
    if (isFileNotFoundError(err)) {
      return false;
    }
    throw err;
  }
}

function isFileNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  if (code === 'FileNotFound') {
    return true;
  }
  const name = (err as { name?: unknown }).name;
  if (name === 'EntryNotFound' || name === 'FileNotFound') {
    return true;
  }
  return false;
}
