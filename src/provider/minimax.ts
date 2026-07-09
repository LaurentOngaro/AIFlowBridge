import vscode from 'vscode';
import { tryGetLoadedRegistry } from '../aiflowbridge/modelRegistry';
import {
  getProviderApiModelId,
  getProviderBaseUrl,
  getProviderMaxTokens,
  getProviderReasoningSplit,
  getProviderTemperature,
  getProviderTopP,
  resolveReasoningSplit,
} from '../config';
import { API_KEY_SECRETS, LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { BaseChatProvider } from './base';
import { createHttpProviderError, ProviderRequestError } from './errors';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import { updateCharsPerToken } from './stream';
import { estimateTokenCount } from './tokens';
import { createVisionModelGetter, resolveImageMessages } from './vision/index';

const MINIMAX_API_KEY_SECRET = API_KEY_SECRETS.minimax;
const MINIMAX_BASE_URL = tryGetLoadedRegistry()?.vendors.minimax?.baseUrl ?? '';

interface MiniMaxAuthManager {
  hasApiKey(): Promise<boolean>;
  getApiKey(): Promise<string | undefined>;
  setApiKey(apiKey: string): Promise<void>;
  deleteApiKey(): Promise<void>;
  promptForApiKey(): Promise<boolean>;
}

class MiniMaxAuthManagerImpl implements MiniMaxAuthManager {
  private readonly secretStorage: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
  }

  async getApiKey(): Promise<string | undefined> {
    return this.secretStorage.get(MINIMAX_API_KEY_SECRET);
  }

  async setApiKey(apiKey: string): Promise<void> {
    await this.secretStorage.store(MINIMAX_API_KEY_SECRET, apiKey.trim());
  }

  async deleteApiKey(): Promise<void> {
    await this.secretStorage.delete(MINIMAX_API_KEY_SECRET);
  }

  async hasApiKey(): Promise<boolean> {
    const key = await this.getApiKey();
    return key !== undefined && key.length > 0;
  }

  async promptForApiKey(): Promise<boolean> {
    const providerName = t('provider.minimax.name');
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

interface MiniMaxMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: MiniMaxToolCall[];
}

interface MiniMaxToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface MiniMaxTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface MiniMaxRequest {
  model: string;
  messages: MiniMaxMessage[];
  stream: boolean;
  max_tokens?: number;
  tools?: MiniMaxTool[];
  tool_choice?: 'auto' | 'none';
  temperature?: number;
  top_p?: number;
  extra_body?: {
    reasoning_split?: boolean;
  };
}

export class MiniMaxChatProvider extends BaseChatProvider {
  readonly vendor = 'minimax';
  readonly apiKeySecret = MINIMAX_API_KEY_SECRET;
  readonly baseUrl = MINIMAX_BASE_URL;

  private readonly authManager: MiniMaxAuthManager;
  private readonly vision: ReturnType<typeof createVisionModelGetter>;
  private charsPerToken = 4.0;

  constructor(context: vscode.ExtensionContext) {
    super();
    this.authManager = new MiniMaxAuthManagerImpl(context);

    this.vision = createVisionModelGetter();

    context.subscriptions.push(
      this.onDidChangeLanguageModelChatInformationEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('aiflowbridge.providers.minimax') || e.affectsConfiguration('aiflowbridge.userModels')) {
          this.fireInformationChanged();
        }
        if (e.affectsConfiguration('aiflowbridge.vision')) {
          this.vision.reset();
        }
      }),
      context.secrets.onDidChange((e) => {
        if (e.key === MINIMAX_API_KEY_SECRET) {
          this.fireInformationChanged();
        }
      })
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
    vscode.window.showInformationMessage(t('command.apiKeyRemoved', t('provider.minimax.name')));
  }

  async provideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
      const providerName = t('provider.minimax.name');
      throw new Error(t('auth.notConfigured', providerName, providerName));
    }

    // Resolve images via vision proxy before conversion
    const visionModel = await this.vision.get();
    if (!visionModel) {
      logger.warn(`[MiniMax] Vision model unavailable - images will not be processed`);
    } else {
      logger.info(`[MiniMax] Using vision model: ${visionModel.id}`);
    }
    const visionResolution = await resolveImageMessages(messages, token, () => this.vision.get());
    const resolvedMessages = visionResolution.messages;

    const minimaxMessages = convertMiniMaxMessages(resolvedMessages);
    const tools = convertMiniMaxTools(_options.tools);
    const maxTokens = getProviderMaxTokens(this.vendor);
    // MiniMax API accepts temperature in (0.0, 1.0]; clamp values outside this range
    const temperature = clampTemperature(getProviderTemperature(this.vendor));
    const topP = getProviderTopP(this.vendor);
    // Resolve reasoning_split: the Copilot Chat model picker wins for
    // thinking-capable models (currently MiniMax M3), otherwise fall back
    // to the global `aiflowbridge.providers.minimax.reasoningSplit` setting.
    const thinkingCapable = tryGetLoadedRegistry()?.models.find((m) => m.id === modelInfo.id)?.capabilities.thinking ?? false;
    const pickerReasoningEffort = thinkingCapable ? getConfiguredThinkingEffort(_options as ModelConfigurationOptions) : undefined;
    const reasoningSplit = resolveReasoningSplit(thinkingCapable, pickerReasoningEffort, getProviderReasoningSplit(this.vendor));
    const modelId = resolveMiniMaxModelId(modelInfo.id);

    // MiniMax OpenAI-compatible API expects reasoning_split at the top level,
    // NOT wrapped in extra_body (extra_body is an OpenAI Python SDK parameter only).
    const request: MiniMaxRequest = {
      model: modelId,
      messages: minimaxMessages,
      stream: true,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(typeof topP === 'number' ? { top_p: topP } : {}),
      ...(typeof reasoningSplit === 'boolean' ? { reasoning_split: reasoningSplit } : {}),
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
        throw createHttpProviderError(response, getProviderBaseUrl(this.vendor), 'MiniMax', detail);
      }

      if (!response.body) {
        throw new ProviderRequestError({
          message: 'MiniMax API returned no response body',
          kind: 'network',
          provider: 'MiniMax',
          baseUrl: getProviderBaseUrl(this.vendor),
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const pendingToolCalls = new Map<number, PendingToolCall>();
      let toolCallsEmitted = false;
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
              reportThinking(progress, delta.reasoning_content);
            }
            if (content) {
              progress.report(new vscode.LanguageModelTextPart(content));
            }
            accumulateToolCalls(delta.tool_calls, pendingToolCalls);
            if (!toolCallsEmitted && isToolCallFinish(choice?.finish_reason)) {
              emitToolCalls(progress, pendingToolCalls);
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
        emitToolCalls(progress, pendingToolCalls);
      }

      // Adaptive token calibration from API usage
      if (streamUsage && streamUsage.prompt_tokens) {
        const totalChars = countMessageChars(minimaxMessages);
        this.charsPerToken = updateCharsPerToken(
          totalChars,
          {
            prompt_tokens: streamUsage.prompt_tokens,
            completion_tokens: streamUsage.completion_tokens ?? 0,
            total_tokens: streamUsage.total_tokens ?? 0,
          },
          this.charsPerToken
        );
      }
    } finally {
      cancelListener.dispose();
    }
  }

  async provideTokenCount(
    _modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
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

/**
 * Clamp temperature to MiniMax's accepted range (0.0, 1.0].
 * Values <= 0 are set to 0.1; values > 1.0 are set to 1.0.
 */
export function clampTemperature(temp: number | undefined): number | undefined {
  if (typeof temp !== 'number') {
    return temp;
  }
  if (temp <= 0) {
    return 0.1;
  }
  if (temp > 1.0) {
    return 1.0;
  }
  return temp;
}

// Since the VS Code model id IS the upstream API model id (see `MODELS` in
// src/consts.ts), no translation is needed. The only override is the user's
// `aiflowbridge.providers.minimax.modelIdOverrides` setting.
export function resolveMiniMaxModelId(vscodeModelId: string): string {
  return getProviderApiModelId('minimax', vscodeModelId);
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

export function convertMiniMaxMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): MiniMaxMessage[] {
  const result: MiniMaxMessage[] = [];
  for (const message of messages) {
    const role = mapRole(message.role);
    let content = '';
    const toolCalls: MiniMaxToolCall[] = [];
    const toolResults: Array<{ callId: string; content: string }> = [];

    for (const part of message.content ?? []) {
      if (part instanceof vscode.LanguageModelTextPart) {
        content += part.value;
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
      if (content || toolCalls.length > 0) {
        const msg: MiniMaxMessage = { role, content: content || '' };
        if (toolCalls.length > 0) {
          msg.tool_calls = toolCalls;
        }
        result.push(msg);
      }
    } else if (content) {
      result.push({ role, content });
    }

    for (const tr of toolResults) {
      result.push({ role: 'tool', content: tr.content, tool_call_id: tr.callId });
    }
  }
  return result;
}

export function convertMiniMaxTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): MiniMaxTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const result: MiniMaxTool[] = [];
  for (const tool of tools) {
    // MiniMax rejects tools with empty names or empty parameters (error code 2013)
    if (!tool.name || tool.name.trim().length === 0) {
      continue;
    }
    result.push({
      type: 'function' as const,
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: (tool.inputSchema as Record<string, unknown>) || {},
      },
    });
  }
  return result.length > 0 ? result : undefined;
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
    const index = typeof call.index === 'number' && Number.isInteger(call.index) && call.index >= 0 ? call.index : pending.size;
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

function emitToolCalls(progress: vscode.Progress<vscode.LanguageModelResponsePart>, pending: Map<number, PendingToolCall>): void {
  [...pending.values()]
    .sort((a, b) => a.index - b.index)
    .forEach((call) => {
      if (!call.id || !call.name) {
        return;
      }
      try {
        const args = parseToolArguments(call.arguments);
        progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, args));
      } catch {
        progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, {}));
      }
    });
}

function countMessageChars(messages: MiniMaxMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += (msg.content as string)?.length ?? 0;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += tc.function?.name?.length ?? 0;
        total += tc.function?.arguments?.length ?? 0;
      }
    }
  }
  return total;
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

function reportThinking(progress: vscode.Progress<vscode.LanguageModelResponsePart>, text: string): void {
  if (typeof (vscode as Record<string, unknown>).LanguageModelThinkingPart === 'function') {
    progress.report(new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart);
    return;
  }
  progress.report(new vscode.LanguageModelTextPart(`[thinking]${text}[/thinking]`));
}
