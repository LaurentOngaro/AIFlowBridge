import { DEEPSEEK_TOOLS_LIMIT } from './provider/tools/consts';
import type { ModelDefinition } from './types';

/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'aiflowbridge';

export const EXTERNAL_URLS = {
  deepseek: {
    apiKeys: 'https://platform.deepseek.com/api_keys',
    usage: 'https://platform.deepseek.com/usage',
    status: 'https://status.deepseek.com',
  },
  minimax: {
    apiKeys: 'https://platform.minimax.io/user-center/payment/token-plan',
    usage: 'https://platform.minimax.chat/usage',
  },
  xiaomi: {
    apiKeys: 'https://platform.xiaomimimo.com/console/api-keys',
    // Regional Token Plan endpoints (use instead of pay-as-you-go for tp-* keys):
    //   China:    https://token-plan-cn.xiaomimimo.com
    //   Singapore: https://token-plan-sgp.xiaomimimo.com
    //   Europe:    https://token-plan-ams.xiaomimimo.com
    tokenPlanAms: 'https://token-plan-ams.xiaomimimo.com/v1',
    tokenPlanSgp: 'https://token-plan-sgp.xiaomimimo.com/v1',
    tokenPlanCn: 'https://token-plan-cn.xiaomimimo.com/v1',
  },
} as const;

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
} as const;

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'aiflowbridge.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'LaurentOngaro.aiflowbridge#gettingStarted';

// ---- Default provider URLs ----

export const DEFAULT_PROVIDER_URLS = {
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimax.io/v1',
  // Token Plan Europe cluster (default). For pay-as-you-go (sk-* keys) or other regions:
  //   Pay-as-you-go: https://api.xiaomimimo.com/v1
  //   Token Plan Singapore: https://token-plan-sgp.xiaomimimo.com/v1
  //   Token Plan China:     https://token-plan-cn.xiaomimimo.com/v1
  xiaomi: 'https://token-plan-ams.xiaomimimo.com/v1',
} as const;

// ---- Model registry ----

/**
 * Available models exposed through the language model provider.
 *
 * IMPORTANT: `id` is the upstream API model id (what gets sent in the
 * `model` field of the request body). It is NOT a kebab-case VS Code id.
 * This avoids the need for a translation map between VS Code and upstream.
 *
 * The `name` field is the human-readable display name shown in the Copilot
 * Chat model picker.
 *
 * When adding a new model, fetch the official id from the provider's
 * `/v1/models` endpoint (e.g. via `AIFlowBridge: Add a custom model`).
 */
export const MODELS: ModelDefinition[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    family: 'deepseek',
    version: 'v4',
    detail: 'Fast, general-purpose model',
    maxInputTokens: 655360,
    maxOutputTokens: 393216,
    capabilities: {
      toolCalling: DEEPSEEK_TOOLS_LIMIT,
      imageInput: true,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    family: 'deepseek',
    version: 'v4',
    detail: 'Most capable reasoning model',
    maxInputTokens: 655360,
    maxOutputTokens: 393216,
    capabilities: {
      toolCalling: DEEPSEEK_TOOLS_LIMIT,
      imageInput: true,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
	{
		id: 'MiniMax-M2',
		name: 'MiniMax M2',
		family: 'minimax',
		version: 'm2',
		detail: 'MiniMax first-generation reasoning model',
		maxInputTokens: 204800,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			// imageInput=true enables the paste-image button in Copilot Chat;
			// the vision proxy transparently converts images to text descriptions.
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'MiniMax-M2.1',
		name: 'MiniMax M2.1',
		family: 'minimax',
		version: 'm2.1',
		detail: 'MiniMax second-generation reasoning model',
		maxInputTokens: 204800,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'MiniMax-M2.1-highspeed',
		name: 'MiniMax M2.1 Highspeed',
		family: 'minimax',
		version: 'm2.1-highspeed',
		detail: 'MiniMax M2.1 optimized for low latency',
		maxInputTokens: 204800,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'MiniMax-M2.5',
		name: 'MiniMax M2.5',
		family: 'minimax',
		version: 'm2.5',
		detail: 'MiniMax third-generation model',
		maxInputTokens: 204800,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'MiniMax-M2.5-highspeed',
		name: 'MiniMax M2.5 Highspeed',
		family: 'minimax',
		version: 'm2.5-highspeed',
		detail: 'MiniMax M2.5 optimized for low latency',
		maxInputTokens: 204800,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'MiniMax-M2.7',
		name: 'MiniMax M2.7',
		family: 'minimax',
		version: 'm2.7',
		detail: 'MiniMax fourth-generation model',
		maxInputTokens: 204800,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'MiniMax-M2.7-highspeed',
		name: 'MiniMax M2.7 Highspeed',
		family: 'minimax',
		version: 'm2.7-highspeed',
		detail: 'MiniMax M2.7 optimized for low latency',
		maxInputTokens: 204800,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'MiniMax-M3',
		name: 'MiniMax M3',
		family: 'minimax',
		version: 'm3',
		detail: 'MiniMax latest generation model with extended context',
		maxInputTokens: 1000000,
		maxOutputTokens: 128000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'mimo-v2-omni',
		name: 'Xiaomi MiMo V2 Omni',
		family: 'xiaomi',
		version: 'v2-omni',
		detail: 'Xiaomi MiMo multimodal omni model',
		maxInputTokens: 917504,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'mimo-v2-pro',
		name: 'Xiaomi MiMo V2 Pro',
		family: 'xiaomi',
		version: 'v2-pro',
		detail: 'Xiaomi MiMo V2 Pro reasoning model',
		maxInputTokens: 917504,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'mimo-v2.5',
		name: 'Xiaomi MiMo V2.5',
		family: 'xiaomi',
		version: 'v2.5',
		detail: 'Xiaomi MiMo multimodal model with vision support',
		maxInputTokens: 917504,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'mimo-v2.5-pro',
		name: 'Xiaomi MiMo V2.5 Pro',
		family: 'xiaomi',
		version: 'v2.5-pro',
		detail: 'Xiaomi MiMo V2.5 Pro reasoning model',
		maxInputTokens: 917504,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: false,
	},
];
