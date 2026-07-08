import path from 'node:path';
import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { loadModelRegistry } from '../aiflowbridge/modelRegistry';
import { acquireGatewayLock, releaseGatewayLock, type GatewayLockHandle } from '../aiflowbridge/gateway/lock';
import { DeepSeekChatProvider } from '../provider';
import { registerAllProviders, type RegisteredProvider } from './provider';
import { registerActionUrls } from './actions';
import { registerCommands } from './commands';
import { initializeDiagnostics } from './diagnostics';
import { showWelcomeIfNeeded } from './welcome';
import { createVSCodeContext } from '../aiflowbridge/vscode-context-adapter';
import { AIFlowBridgeRuntime } from '../aiflowbridge';

let activeProviders: RegisteredProvider[] = [];
let deepseekProvider: DeepSeekChatProvider | undefined;
let gatewayLock: GatewayLockHandle | null = null;
let ownsGatewayLock = false;
let aiflowbridgeRuntime: AIFlowBridgeRuntime | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await initializeDiagnostics(context);
	// Acquire the gateway restart lock first: when a debug session reloads
	// the extension while an old gateway is still running, this serializes
	// the version-aware restart decision (see ACTION PLAN.md "Server
	// singleton (version-aware cooperative restart)").
	//
	// If the lock is held by a peer activation OR by a stale lock left
	// over from a crashed previous run, we do NOT start the gateway: the
	// holding activation (or the next activation after the stale lock
	// ages out) will own the restart decision. This is what actually
	// prevents the ping-pong loop the lock was added for.
	const lockPath = path.join(context.globalStorageUri.fsPath, 'gateway.lock');
	const result = acquireGatewayLock(lockPath);
	if (result.ok) {
		gatewayLock = result.handle;
		ownsGatewayLock = true;
	} else if (result.reason === 'held') {
		logger.warn('[AIFlowBridge] Gateway restart lock is held by another activation (or stale from a previous crash); skipping gateway start to avoid a restart ping-pong.');
	} else {
		logger.warn(`[AIFlowBridge] Gateway restart lock is not acquirable (${result.error ?? 'unknown reason'}); skipping gateway start.`);
	}

	// Load the 3-tier model registry before any code that reads MODELS,
	// DEFAULT_PROVIDER_URLS or EXTERNAL_URLS (now sourced from the registry).
	// This must happen before registerCommands / registerAllProviders /
	// activateAIFlowBridge, all of which depend on the cache.
	await loadModelRegistry(context);
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

		// Only the lock-owning activation may start the gateway. Otherwise
		// we would race with the holding activation and both could decide
		// to restart the peer at the same time.
		if (ownsGatewayLock) {
			// FEAT6: wrap the vscode.ExtensionContext into the runtime-agnostic
			// IGatewayContext adapter so the runtime has no direct `vscode`
			// dependency.
			const gatewayContext = createVSCodeContext(context);
			aiflowbridgeRuntime = new AIFlowBridgeRuntime(gatewayContext);
			await aiflowbridgeRuntime.activate();
		} else {
			logger.info('[AIFlowBridge] Skipping gateway start (lock not owned). The holding activation will own the gateway for this session.');
		}

		logger.info(`Extension activated version=${context.extension.packageJSON.version}`);
	} catch (error) {
		logger.error('Failed to activate extension', error);
		void vscode.window.showErrorMessage(t('extension.activateFailed'));
		throw error;
	}
}

export async function deactivate(): Promise<void> {
	try {
		await aiflowbridgeRuntime?.deactivate();
		aiflowbridgeRuntime = undefined;
		for (const { provider } of activeProviders) {
			await provider.prepareForDeactivate();
		}
	} catch (error) {
		logger.warn(t('extension.deactivateFailed'), error);
	} finally {
		activeProviders = [];
		deepseekProvider = undefined;
		releaseGatewayLock(gatewayLock);
		gatewayLock = null;
		ownsGatewayLock = false;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}