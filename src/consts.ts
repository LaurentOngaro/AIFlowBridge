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
		apiKeys: 'https://platform.minimax.chat/api_keys',
		usage: 'https://platform.minimax.chat/usage',
	},
	xiaomi: {
		apiKeys: 'https://api.xiaomi.com/api_keys',
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
	minimax: 'https://api.minimax.chat/v1',
	xiaomi: 'https://api.xiaomi.com/v1',
} as const;

// ---- Model registry ----

/** Available models exposed through the language model provider. */
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
		id: 'minimax-v2.7',
		name: 'MiniMax V2.7',
		family: 'minimax',
		version: '2.7',
		detail: 'MiniMax latest generation model',
		maxInputTokens: 1000000,
		maxOutputTokens: 327680,
		capabilities: {
			toolCalling: true,
			imageInput: false,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
	{
		id: 'xiaomi-mimo-v2.5',
		name: 'Xiaomi MiMo V2.5',
		family: 'xiaomi',
		version: 'v2.5',
		detail: 'Multimodal model with vision support',
		maxInputTokens: 1000000,
		maxOutputTokens: 327680,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
	{
		id: 'xiaomi-mimo-v2.5-pro',
		name: 'Xiaomi MiMo V2.5 Pro',
		family: 'xiaomi',
		version: 'v2.5-pro',
		detail: 'Reasoning model without vision',
		maxInputTokens: 1000000,
		maxOutputTokens: 327680,
		capabilities: {
			toolCalling: true,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
];