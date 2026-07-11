import vscode from 'vscode';
import { logger } from '../logger';
import { DeepSeekChatProvider } from '../provider';
import { MiniMaxChatProvider } from '../provider/minimax';
import { UnifiedChatProvider } from '../provider/unified';
import { chooseVisionProxyModel } from '../provider/vision';
import { XiaomiChatProvider } from '../provider/xiaomi';

export interface RegisteredProvider {
	name: string;
	provider: DeepSeekChatProvider | MiniMaxChatProvider | XiaomiChatProvider;
}

export interface RegisteredProviders {
	/**
	 * One entry per underlying vendor. Mirrors the historical
	 * return type of `registerAllProviders(context)` so callers
	 * that only care about per-vendor providers (e.g. the welcome
	 * prompt) keep working unchanged.
	 */
	perVendor: RegisteredProvider[];
	/**
	 * The single unified provider registered under the
	 * `'aiflowbridge'` vendor via
	 * `vscode.lm.registerLanguageModelChatProvider`. Exposed so the
	 * runtime can wire a telemetry sink for Copilot Chat traffic
	 * once the `TelemetryStore` is built (action plan item #6).
	 */
	unified: UnifiedChatProvider;
}

export async function registerAllProviders(
	context: vscode.ExtensionContext,
): Promise<RegisteredProviders> {
	const perVendor: RegisteredProvider[] = [];

	const deepseekProvider = new DeepSeekChatProvider(context);
	perVendor.push({ name: 'deepseek', provider: deepseekProvider });

	const minimaxProvider = new MiniMaxChatProvider(context);
	perVendor.push({ name: 'minimax', provider: minimaxProvider });

	const xiaomiProvider = new XiaomiChatProvider(context);
	perVendor.push({ name: 'xiaomi', provider: xiaomiProvider });

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

		// Vision proxy picker. Registered here (next to the VS Code
		// adapter) because the implementation imports `vscode.lm`
		// directly to list available models. The picker is global:
		// it writes the shared `aiflowbridge.vision.copilotVisionModel`
		// setting, used by every text-only model across all vendors
		// (DeepSeek, MiniMax text-only, Xiaomi text-only). The user-
		// facing command palette entry is `aiflowbridge.setVisionModel`,
		// registered in `src/aiflowbridge/index.ts` and forwarded
		// here by name to keep the runtime host-agnostic.
		vscode.commands.registerCommand('aiflowbridge.chooseVisionProxyModel', () =>
			chooseVisionProxyModel(),
		),

		// Single registration - unified provider handles all models
		vscode.lm.registerLanguageModelChatProvider('aiflowbridge', unifiedProvider),
		unifiedProvider,
	);

	await activateCopilotChat();
	deepseekProvider.refreshModelPicker();
	minimaxProvider.refreshModelPicker();
	xiaomiProvider.refreshModelPicker();

	return { perVendor, unified: unifiedProvider };
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
