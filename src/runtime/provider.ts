import { t } from '../i18n';
import vscode from 'vscode';
import { logger } from '../logger';
import { AuthManager } from '../auth';
import { DeepSeekChatProvider } from '../provider';
import { MiniMaxChatProvider } from '../provider/minimax';
import { UnifiedChatProvider } from '../provider/unified';
import { chooseVisionProxyModel } from '../provider/vision';
import { XiaomiChatProvider } from '../provider/xiaomi';

export interface RegisteredProvider {
  name: string;
  provider: DeepSeekChatProvider | MiniMaxChatProvider | XiaomiChatProvider;
}

/**
 * Register the `Set API Key` / `Clear API Key` command pair for a vendor
 * that has an `API_KEY_SECRETS` slot but no
 * `vscode.LanguageModelChatProvider` class (the Path B "gateway-only"
 * vendors: `googleaistudio` on the BYOK route, `zai`, `moonshot`).
 *
 * Without this pair, a gateway-only vendor would only be configurable
 * through `secrets.json` or the `AIFLOWBRIDGE_<VENDOR>_API_KEY`
 * environment variable, with no UI entry point.
 */
function registerApiKeyCommands(
  context: vscode.ExtensionContext,
  vendor: 'googleaistudio' | 'zai' | 'moonshot',
  labelKey: 'provider.googleaistudio.name' | 'provider.zai.name' | 'provider.moonshot.name'
): vscode.Disposable[] {
  const providerName = t(labelKey);
  return [
    vscode.commands.registerCommand(`aiflowbridge.providers.${vendor}.setApiKey`, async () => {
      const authManager = new AuthManager(context);
      const saved = await authManager.promptForApiKey(
        vendor,
        t('command.apiKeyPrompt', providerName),
        t('command.apiKeyPlaceholder', providerName)
      );
      if (saved) {
        vscode.window.showInformationMessage(
          t('command.apiKeySaved', providerName)
        );
      }
    }),
    vscode.commands.registerCommand(`aiflowbridge.providers.${vendor}.clearApiKey`, async () => {
      const authManager = new AuthManager(context);
      await authManager.deleteApiKey(vendor);
      vscode.window.showInformationMessage(
        t('command.apiKeyRemoved', providerName)
      );
    }),
  ];
}

/** Disposables for the three vendors that have an API-key command pair but no provider class. */
function googleaistudioAndGatewayOnlyCommandDisposables(context: vscode.ExtensionContext): vscode.Disposable[] {
  return [
    ...registerApiKeyCommands(context, 'googleaistudio', 'provider.googleaistudio.name'),
    ...registerApiKeyCommands(context, 'zai', 'provider.zai.name'),
    ...registerApiKeyCommands(context, 'moonshot', 'provider.moonshot.name'),
  ];
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

export async function registerAllProviders(context: vscode.ExtensionContext): Promise<RegisteredProviders> {
  const perVendor: RegisteredProvider[] = [];

  const deepseekProvider = new DeepSeekChatProvider(context);
  perVendor.push({ name: 'deepseek', provider: deepseekProvider });

  const minimaxProvider = new MiniMaxChatProvider(context);
  perVendor.push({ name: 'minimax', provider: minimaxProvider });

  const xiaomiProvider = new XiaomiChatProvider(context);
  perVendor.push({ name: 'xiaomi', provider: xiaomiProvider });

  // Single unified provider registered under 'aiflowbridge' vendor
  const unifiedProvider = new UnifiedChatProvider([deepseekProvider, minimaxProvider, xiaomiProvider]);

  context.subscriptions.push(
    vscode.commands.registerCommand('aiflowbridge.providers.deepseek.setApiKey', () => deepseekProvider.configureApiKey()),
    vscode.commands.registerCommand('aiflowbridge.providers.deepseek.clearApiKey', () => deepseekProvider.clearApiKey()),

    vscode.commands.registerCommand('aiflowbridge.providers.minimax.setApiKey', () => minimaxProvider.configureApiKey()),
    vscode.commands.registerCommand('aiflowbridge.providers.minimax.clearApiKey', () => minimaxProvider.clearApiKey()),

    vscode.commands.registerCommand('aiflowbridge.providers.xiaomi.setApiKey', () => xiaomiProvider.configureApiKey()),
    vscode.commands.registerCommand('aiflowbridge.providers.xiaomi.clearApiKey', () => xiaomiProvider.clearApiKey()),

    // Google AI Studio (BYOK, pay-as-you-go): prompt for an `AIzaSy...`
    // API key and persist it to `SecretStorage` under
    // `API_KEY_SECRETS.googleaistudio`. The runtime shares the same
    // `secrets.json` file / SecretStorage slot as the standalone CLI's
    // `auth googleaistudio setApiKey`, so a key set in one place is
    // seen by the other. The OAuth / Antigravity route lives on
    // `aiflowbridge.connectGoogleAIStudio` (registered separately in
    // `src/aiflowbridge/index.ts`) and uses the OAuth token manager.
    // Z.ai and MoonshotAI reuse the same pattern (Path B, gateway-only).
    ...googleaistudioAndGatewayOnlyCommandDisposables(context),

    // Vision proxy picker. Registered here (next to the VS Code
    // adapter) because the implementation imports `vscode.lm`
    // directly to list available models. The picker is global:
    // it writes the shared `aiflowbridge.vision.copilotVisionModel`
    // setting, used by every text-only model across all vendors
    // (DeepSeek, MiniMax text-only, Xiaomi text-only). The user-
    // facing command palette entry is `aiflowbridge.setVisionModel`,
    // registered in `src/aiflowbridge/index.ts` and forwarded
    // here by name to keep the runtime host-agnostic.
    vscode.commands.registerCommand('aiflowbridge.chooseVisionProxyModel', () => chooseVisionProxyModel()),

    // Single registration - unified provider handles all models
    vscode.lm.registerLanguageModelChatProvider('aiflowbridge', unifiedProvider),
    unifiedProvider
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
