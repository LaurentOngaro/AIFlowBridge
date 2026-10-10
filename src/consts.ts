/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 *
 * Vendor / model / pricing data lives in `resources/models.json` and is served by `src/aiflowbridge/modelRegistry.ts` via the`getLoadedRegistry()` cache.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'aiflowbridge';

/** URI path handled by this extension to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path handled by this extension to open API key configuration. */
export const CONFIGURE_API_KEY_URI_PATH = '/setApiKey';

// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

// ---- Secret keys ----

/** SecretStorage key for provider API keys. */
export const API_KEY_SECRETS = {
  deepseek: 'aiflowbridge.providers.deepseek.apiKey',
  minimax: 'aiflowbridge.providers.minimax.apiKey',
  xiaomi: 'aiflowbridge.providers.xiaomi.apiKey',
  openrouter: 'aiflowbridge.providers.openrouter.apiKey',
  // Google AI Studio / Gemini: BYOK API key against the public Gemini
  // API at `generativelanguage.googleapis.com`. This is now the ONLY
  // supported route for the family - the Antigravity / Cloud Code Assist
  // product OAuth transport has been retired (see
  // `src/aiflowbridge/google-transport-policy.ts`). Charges land on the
  // user's own GCP project, NOT on an AI Studio Pro subscription.
  googleaistudio: 'aiflowbridge.providers.googleaistudio.apiKey',
  // Gateway-only vendors (Path B, no `vscode.LanguageModelChatProvider`
  // class): Z.ai GLM and MoonshotAI Kimi are reached through the
  // OpenAI-compatible gateway, so the key still needs a SecretStorage
  // slot for the `Set API Key` / `Clear API Key` commands and for the
  // unified key chain (`src/aiflowbridge/api-key-sources.ts`).
  zai: 'aiflowbridge.providers.zai.apiKey',
  moonshot: 'aiflowbridge.providers.moonshot.apiKey',
} as const;

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'aiflowbridge.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'LaurentOngaro.aiflowbridge#gettingStarted';
