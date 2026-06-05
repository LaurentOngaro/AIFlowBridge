/**
 * `AIFlowBridge: Edit model registry` command.
 *
 * Opens `<globalStorageUri>/models.json` in the VS Code editor. If the file
 * does not exist yet, initializes it by copying the bundled registry so the
 * user has a valid starting point (with the `$schema` reference and all
 * required fields) and can edit it safely.
 *
 * Edits take effect on the next window reload (the registry is loaded once
 * during `activate()`; we do not hot-reload). The companion
 * `AIFlowBridge: Reset model registry to bundled defaults` command removes
 * this override.
 */

import * as vscode from 'vscode';
import { logger } from '../logger';
import {
	BUNDLED_REGISTRY_RELATIVE_PATH,
	GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH,
} from '../aiflowbridge/modelRegistry';

export async function editModelRegistryCommand(context: vscode.ExtensionContext): Promise<void> {
	const globalStorageUri = vscode.Uri.joinPath(
		context.globalStorageUri,
		...GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH,
	);
	const bundledUri = vscode.Uri.joinPath(
		context.extensionUri,
		...BUNDLED_REGISTRY_RELATIVE_PATH,
	);

	if (!(await fileExists(globalStorageUri))) {
		try {
			const bundledBytes = await vscode.workspace.fs.readFile(bundledUri);
			await vscode.workspace.fs.writeFile(globalStorageUri, bundledBytes);
			logger.info(
				`[AIFlowBridge] Initialized model registry override at ${globalStorageUri.toString()} from bundled defaults`,
			);
		} catch (err) {
			logger.error('[AIFlowBridge] Failed to initialize model registry override', err);
			void vscode.window.showErrorMessage(
				`Failed to initialize model registry override: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}
	}

	await vscode.commands.executeCommand('vscode.open', globalStorageUri);
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
