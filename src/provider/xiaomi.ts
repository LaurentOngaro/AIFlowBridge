import vscode from 'vscode';
import {
  getProviderApiModelId,
  getProviderBaseUrl,
  getProviderMaxTokens,
  getProviderReasoningRequiredForToolCalls,
  getProviderTemperature,
  getProviderTopP,
} from '../config';
import { API_KEY_SECRETS, DEFAULT_PROVIDER_URLS, LANGUAGE_MODEL_CHAT_SYSTEM_ROLE, MODELS } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { BaseChatProvider } from './base';
import { createHttpProviderError, ProviderRequestError } from './errors';
import { updateCharsPerToken } from './stream';
import { estimateTokenCount } from './tokens';
import { createVisionModelGetter, resolveImageMessages } from './vision/index';

const XIAOMI_API_KEY_SECRET = API_KEY_SECRETS.xiaomi;
const XIAOMI_BASE_URL = DEFAULT_PROVIDER_URLS.xiaomi;

interface XiaomiAuthManager {
	hasApiKey(): Promise<boolean>;
	getApiKey(): Promise<string | undefined>;
	setApiKey(apiKey: string): Promise<void>;
	deleteApiKey(): Promise<void>;
	promptForApiKey(): Promise<boolean>;
}

class XiaomiAuthManagerImpl implements XiaomiAuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	async getApiKey(): Promise<string | undefined> {
		return this.secretStorage.get(XIAOMI_API_KEY_SECRET);
	}

	async setApiKey(apiKey: string): Promise<void> {
		await this.secretStorage.store(XIAOMI_API_KEY_SECRET, apiKey.trim());
	}

	async deleteApiKey(): Promise<void> {
		await this.secretStorage.delete(XIAOMI_API_KEY_SECRET);
	}

	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		return key !== undefined && key.length > 0;
	}

	async promptForApiKey(): Promise<boolean> {
		const providerName = t('provider.xiaomi.name');
		const apiKey = await vscode.window.showInputBox({
			prompt: t('command.apiKeyPrompt', providerName),
			placeHolder: t('command.apiKeyPlaceholder', providerName),
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return t('command.apiKeyEmptyValidation');
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(apiKey);
			vscode.window.showInformationMessage(t('command.apiKeySaved', providerName));
			return true;
		}
		return false;
	}
}

interface XiaomiContentPart {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

interface XiaomiMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | XiaomiContentPart[];
	tool_call_id?: string;
	tool_calls?: XiaomiToolCall[];
	reasoning_content?: string;
}

interface XiaomiToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

interface XiaomiTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

interface XiaomiRequest {
	model: string;
	messages: XiaomiMessage[];
	stream: boolean;
	max_tokens?: number;
	tools?: XiaomiTool[];
	tool_choice?: 'auto' | 'none';
	temperature?: number;
	top_p?: number;
}

export class XiaomiChatProvider extends BaseChatProvider {
	readonly vendor = 'xiaomi';
	readonly apiKeySecret = XIAOMI_API_KEY_SECRET;
	readonly baseUrl = XIAOMI_BASE_URL;

	private readonly authManager: XiaomiAuthManager;
	private readonly vision: ReturnType<typeof createVisionModelGetter>;
	private charsPerToken = 4.0;
	private readonly reasoningCache = new Map<string, ReasoningEntry>();

	constructor(context: vscode.ExtensionContext) {
		super();
		this.authManager = new XiaomiAuthManagerImpl(context);

		this.vision = createVisionModelGetter();

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('aiflowbridge.providers.xiaomi')) {
					this.fireInformationChanged();
				}
				if (e.affectsConfiguration('aiflowbridge.vision')) {
					this.vision.reset();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === XIAOMI_API_KEY_SECRET) {
					this.fireInformationChanged();
				}
			}),
		);
	}

	getAuthManager(): { hasApiKey(): Promise<boolean>; getApiKey(): Promise<string | undefined> } {
		return this.authManager;
	}

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.fireInformationChanged();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.fireInformationChanged();
		vscode.window.showInformationMessage(t('command.apiKeyRemoved', t('provider.xiaomi.name')));
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		_options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			const providerName = t('provider.xiaomi.name');
			throw new Error(t('auth.notConfigured', providerName, providerName));
		}

		const modelDef = MODELS.find((m) => m.id === modelInfo.id);
		const isThinkingModel = modelDef?.capabilities.thinking ?? false;
		// imageInput in the model definition controls the VS Code paste-image button.
		// Native vision support depends on the actual model ID — V2.5 (non-pro) supports
		// images natively, V2.5 Pro does not and requires the vision proxy.
		const hasNativeVision = modelInfo.id === 'xiaomi-mimo-v2.5';
		const requiresReasoningReplay = getProviderReasoningRequiredForToolCalls(this.vendor);
		if (messages.length <= 2) {
			pruneReasoningCache(this.reasoningCache, true);
		}

		// Resolve images via vision proxy for models without native vision support
		let resolvedMessages: readonly vscode.LanguageModelChatRequestMessage[] = messages;
		if (!hasNativeVision) {
			const visionResolution = await resolveImageMessages(messages, token, () => this.vision.get());
			resolvedMessages = visionResolution.messages;
		}

		const xiaomiMessages = convertXiaomiMessages(resolvedMessages, {
			isThinkingModel,
			supportsVision: hasNativeVision,
			reasoningCache: this.reasoningCache,
			reasoningReplayRequired: requiresReasoningReplay,
		});
		const tools = convertXiaomiTools(_options.tools);
		const maxTokens = getProviderMaxTokens(this.vendor);
		const temperature = getProviderTemperature(this.vendor);
		const topP = getProviderTopP(this.vendor);
		const modelId = resolveXiaomiModelId(modelInfo.id);

		const request: XiaomiRequest = {
			model: modelId,
			messages: xiaomiMessages,
			stream: true,
			...(maxTokens ? { max_tokens: maxTokens } : {}),
			...(typeof temperature === 'number' ? { temperature } : {}),
			...(typeof topP === 'number' ? { top_p: topP } : {}),
			...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
		};

		const controller = new AbortController();
		const cancelListener = token.onCancellationRequested(() => controller.abort());

		try {
			const response = await fetch(`${getProviderBaseUrl(this.vendor)}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(request),
				signal: controller.signal,
			});

			if (!response.ok) {
				// Try to read response body for detailed error message
				let detail = '';
				try {
					const errorBody = await response.text();
					if (errorBody) {
						detail = `: ${errorBody.slice(0, 500)}`;
					}
				} catch {
					// Ignore read errors
				}
				throw createHttpProviderError(response, getProviderBaseUrl(this.vendor), 'Xiaomi MiMo', detail);
			}

			if (!response.body) {
				throw new ProviderRequestError({
					message: 'Xiaomi MiMo API returned no response body',
					kind: 'network',
					provider: 'Xiaomi MiMo',
					baseUrl: getProviderBaseUrl(this.vendor),
				});
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			const pendingToolCalls = new Map<number, PendingToolCall>();
			let toolCallsEmitted = false;
			let accumulatedReasoning = '';
			let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

			while (true) {
				if (token.isCancellationRequested) {
					break;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === 'data: [DONE]') {
						continue;
					}

					if (!trimmed.startsWith('data: ')) {
						continue;
					}

					const jsonStr = trimmed.slice(6);
					try {
						const chunk = JSON.parse(jsonStr);
						const choice = chunk.choices?.[0];
						const delta = choice?.delta ?? {};
						const content = delta.content;
						if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
							accumulatedReasoning += delta.reasoning_content;
							reportThinking(progress, delta.reasoning_content);
						}
						if (content) {
							progress.report(new vscode.LanguageModelTextPart(content));
						}
						accumulateToolCalls(delta.tool_calls, pendingToolCalls);
						if (!toolCallsEmitted && isToolCallFinish(choice?.finish_reason)) {
							emitToolCalls(progress, pendingToolCalls, this.reasoningCache, accumulatedReasoning);
							toolCallsEmitted = true;
						}
						// Capture usage if present in stream
						if (chunk.usage && !streamUsage) {
							streamUsage = chunk.usage;
						}
					} catch {
						// Skip invalid JSON
					}
				}
			}

			if (!toolCallsEmitted && pendingToolCalls.size > 0) {
				emitToolCalls(progress, pendingToolCalls, this.reasoningCache, accumulatedReasoning);
			}

			// Adaptive token calibration from API usage
			if (streamUsage && streamUsage.prompt_tokens) {
				const totalChars = countMessageChars(xiaomiMessages);
				this.charsPerToken = updateCharsPerToken(totalChars, {
					prompt_tokens: streamUsage.prompt_tokens,
					completion_tokens: streamUsage.completion_tokens ?? 0,
					total_tokens: streamUsage.total_tokens ?? 0,
				}, this.charsPerToken);
			}

			pruneReasoningCache(this.reasoningCache, false);
		} finally {
			cancelListener.dispose();
		}
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}
}

export interface PendingToolCall {
	index: number;
	id?: string;
	name?: string;
	arguments: string;
}

export interface ReasoningEntry {
	text: string;
	timestamp: number;
}

export function resolveXiaomiModelId(vscodeModelId: string): string {
	const overridden = getProviderApiModelId('xiaomi', vscodeModelId);
	if (overridden !== vscodeModelId) {
		return overridden;
	}
	if (vscodeModelId.startsWith('xiaomi-')) {
		return vscodeModelId.slice('xiaomi-'.length);
	}
	return vscodeModelId;
}

export function mapRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
	if ((role as unknown as number) === LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) {
		return 'system';
	}
	if (role === vscode.LanguageModelChatMessageRole.Assistant) {
		return 'assistant';
	}
	return 'user';
}

export function convertXiaomiMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: {
		isThinkingModel: boolean;
		supportsVision: boolean;
		reasoningCache: Map<string, ReasoningEntry>;
		reasoningReplayRequired: boolean;
	},
): XiaomiMessage[] {
	const result: XiaomiMessage[] = [];
	for (const message of messages) {
		const role = mapRole(message.role);
		let textContent = '';
		const imageParts: XiaomiContentPart[] = [];
		const toolCalls: XiaomiToolCall[] = [];
		const toolResults: Array<{ callId: string; content: string }> = [];

		for (const part of message.content ?? []) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textContent += part.value;
			} else if (part instanceof vscode.LanguageModelDataPart) {
				if (part.mimeType.startsWith('image/') && options.supportsVision) {
					const base64 = Buffer.from(part.data).toString('base64');
					imageParts.push({
						type: 'image_url',
						image_url: { url: `data:${part.mimeType};base64,${base64}` },
					});
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: JSON.stringify(part.input ?? {}),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				toolResults.push({
					callId: part.callId,
					content: concatToolResultContent(part.content),
				});
			}
		}

		if (role === 'assistant') {
			if (textContent || toolCalls.length > 0) {
				const msg: XiaomiMessage = { role, content: textContent || '' };
				if (toolCalls.length > 0) {
					msg.tool_calls = toolCalls;
					if (options.isThinkingModel && options.reasoningReplayRequired) {
						const cached = findReasoningForToolCalls(options.reasoningCache, toolCalls);
						msg.reasoning_content = cached ?? '';
						if (!cached) {
							logger.warn('MiMo reasoning_content missing for tool call replay; sending empty reasoning_content.');
						}
					}
				}
				result.push(msg);
			}
		} else if (textContent || imageParts.length > 0) {
			const content: XiaomiMessage['content'] =
				imageParts.length > 0
					? [
						...(textContent ? [{ type: 'text' as const, text: textContent }] : []),
						...imageParts,
					]
					: textContent;
			result.push({ role, content });
		}

		for (const tr of toolResults) {
			result.push({ role: 'tool', content: tr.content, tool_call_id: tr.callId });
		}
	}
	return result;
}

export function convertXiaomiTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): XiaomiTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema as Record<string, unknown> | undefined,
		},
	}));
}

export function concatToolResultContent(parts: readonly unknown[]): string {
	let text = '';
	for (const part of parts) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		} else if (part instanceof vscode.LanguageModelDataPart) {
			text += `[data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}]`;
		} else if (part && typeof part === 'object' && 'value' in part && typeof (part as { value?: unknown }).value === 'string') {
			text += (part as { value: string }).value;
		} else {
			text += safeJson(part);
		}
	}
	const normalized = text.trim();
	return normalized.length > 0 ? normalized : '{}';
}

export function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function accumulateToolCalls(rawCalls: unknown, pending: Map<number, PendingToolCall>): void {
	if (!Array.isArray(rawCalls)) {
		return;
	}
	for (const raw of rawCalls) {
		if (!raw || typeof raw !== 'object') {
			continue;
		}
		const call = raw as {
			index?: unknown;
			id?: unknown;
			function?: { name?: unknown; arguments?: unknown };
		};
		const index =
			typeof call.index === 'number' && Number.isInteger(call.index) && call.index >= 0
				? call.index
				: pending.size;
		const current = pending.get(index) ?? { index, arguments: '' };
		if (typeof call.id === 'string' && call.id.length > 0) {
			current.id = call.id;
		}
		if (typeof call.function?.name === 'string' && call.function.name.length > 0) {
			current.name = call.function.name;
		}
		if (typeof call.function?.arguments === 'string' && call.function.arguments.length > 0) {
			current.arguments += call.function.arguments;
		}
		pending.set(index, current);
	}
}

export function isToolCallFinish(finishReason: unknown): boolean {
	return finishReason === 'tool_calls' || finishReason === 'function_call';
}

export function emitToolCalls(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	pending: Map<number, PendingToolCall>,
	reasoningCache?: Map<string, ReasoningEntry>,
	reasoningText?: string,
): void {
	const ordered = [...pending.values()].sort((a, b) => a.index - b.index);
	for (const call of ordered) {
		if (!call.id || !call.name) {
			continue;
		}
		progress.report(
			new vscode.LanguageModelToolCallPart(call.id, call.name, parseToolArguments(call.arguments)),
		);
		if (reasoningCache && reasoningText && reasoningText.length > 0) {
			reasoningCache.set(call.id, { text: reasoningText, timestamp: Date.now() });
		}
	}
}

export function parseToolArguments(raw: string): object {
	const text = raw.trim();
	if (!text) {
		return {};
	}
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as object;
		}
		return { value: parsed };
	} catch {
		return { rawArguments: raw };
	}
}

function reportThinking(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	text: string,
): void {
	if (typeof (vscode as Record<string, unknown>).LanguageModelThinkingPart === 'function') {
		progress.report(
			new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart,
		);
		return;
	}
	progress.report(new vscode.LanguageModelTextPart(`[thinking]${text}[/thinking]`));
}

export function findReasoningForToolCalls(
	cache: Map<string, ReasoningEntry>,
	toolCalls: XiaomiToolCall[],
): string | undefined {
	for (const call of toolCalls) {
		const cached = cache.get(call.id);
		if (cached?.text) {
			return cached.text;
		}
	}
	return undefined;
}

export function pruneReasoningCache(cache: Map<string, ReasoningEntry>, forceClear: boolean): void {
	if (forceClear) {
		cache.clear();
		return;
	}
	const maxSize = 200;
	if (cache.size <= maxSize) {
		return;
	}
	const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
	for (const [key] of entries.slice(0, cache.size - maxSize)) {
		cache.delete(key);
	}
}

export function countMessageChars(messages: XiaomiMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		if (typeof msg.content === 'string') {
			total += msg.content.length;
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === 'text') {
					total += part.text?.length ?? 0;
				}
			}
		}
		total += msg.reasoning_content?.length ?? 0;
		if (msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				total += tc.function?.name?.length ?? 0;
				total += tc.function?.arguments?.length ?? 0;
			}
		}
	}
	return total;
}