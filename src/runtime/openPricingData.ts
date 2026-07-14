/**
 * `AIFlowBridge: Open pricing data` command.
 *
 * Opens `resources/pricing.json` (the bundled file shipped with the
 * extension) in the VS Code editor. The file is small (< 50 KB even
 * with the full OpenRouter catalog) and is a useful diagnostic
 * surface when the user wants to inspect the rates that drive the
 * dashboard's `Est. cost` column.
 *
 * The command does NOT open the globalStorage override file -
 * users can find it via the standard `AIFlowBridge: Open request
 * dumps folder`-style flow (reveal in OS) if they want to inspect
 * their last user-side refresh.
 */

import * as vscode from 'vscode';
import { logger } from '../logger';
import { BUNDLED_PRICING_RELATIVE_PATH } from '../aiflowbridge/pricing/loader';

export async function openPricingDataCommand(context: vscode.ExtensionContext): Promise<void> {
  const bundledUri = vscode.Uri.joinPath(context.extensionUri, ...BUNDLED_PRICING_RELATIVE_PATH);
  try {
    await vscode.commands.executeCommand('vscode.open', bundledUri);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[AIFlowBridge] Failed to open bundled pricing JSON at ${bundledUri.toString()}: ${message}`);
    void vscode.window.showErrorMessage(`Failed to open bundled pricing data: ${message}`);
  }
}
