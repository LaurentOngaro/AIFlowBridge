/**
 * AIFlowBridge - OpenAI to Cloud Code Assist (Gemini) request envelope translation.
 *
 * Translates standard OpenAI Chat Completion request bodies into the structured
 * envelope expected by Cloud Code Assist (Antigravity / Google AI Studio).
 * Pure translation module, no network calls, fully unit-testable.
 */

import { randomBytes } from 'node:crypto';
import { DEFAULT_USER_AGENT } from './constants';
import { logDroppedImageUrls, openAiContentToGeminiParts, toFunctionResponseValue } from './content-parts';
import { cleanJsonSchema } from './json-schema-clean';
import type {
    CloudCodeContent,
    CloudCodeEnvelope,
    CloudCodeFunctionDeclaration,
    CloudCodeGenerationConfig,
    CloudCodePart,
    CloudCodeRequest,
} from './types';

// The sanitiser and its two keyword sets live in `json-schema-clean.ts`
// and are shared with the BYOK native surface. The copy that used to
// sit here had already drifted from the one in `gemini-native.ts`.
// Re-exported so the module's public surface is unchanged.
export { cleanJsonSchema };

export interface ToEnvelopeOptions {
  userAgent?: string;
  requestId?: string;
}

export interface OpenAiChatMessage {
  role?: string;
  content?: unknown;
  name?: string;
  /**
   * Optional opaque `extra_signature` echoed back on a tool result
   * message. The gateway propagates it as
   * `functionResponse.thoughtSignature` on the AGY envelope (and as
   * `functionResponse.thoughtSignature` on the BYOK native surface),
   * so the upstream can pair the response with the functionCall that
   * produced it. Without it some Gemini deployments reject the next
   * `functionCall` round with `400 Function call is missing a
   * thought_signature`.
   */
  extra_signature?: string;
  /**
   * OpenAI identifier of the `tool_calls` entry this result answers.
   * Used to resolve the native `functionResponse.name` when the client
   * omits `name`.
   */
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: unknown };
    /**
     * Optional opaque `extra_signature` echoed back on each
     * `tool_calls[i]` of an assistant turn. The gateway propagates
     * it as `functionCall.thoughtSignature` on the AGY envelope
     * and on the BYOK native surface.
     */
    extra_signature?: string;
  }>;
}

export interface OpenAiChatBody {
  messages?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
  stop?: unknown;
  tools?: unknown;
}

/**
 * Converts an OpenAI Chat Completions payload into the Cloud Code Assist envelope.
 *
 * @param openaiBody The incoming OpenAI request body.
 * @param projectId The Google Cloud project ID associated with the user account.
 * @param modelId The target model ID (e.g. 'gemini-3.8-flash').
 * @param options Optional userAgent and requestId overrides.
 * @param warn Optional sink for dropped remote `image_url` warnings.
 *   The gateway passes `logger.warn`; unit tests omit it (no
 *   `vscode` import in this call chain).
 * @param signatureLookup Optional cache lookup for the server-side
 *   thought_signature gap-filler (see
 *   `thought-signature-cache.ts`). Same contract as the BYOK native
 *   surface: client-supplied `extra_signature` wins, the lookup only
 *   fires when the client replayed the turn without the signature.
 *   Omit to disable the gap-filler.
 */
export function toAntigravityEnvelope(
  openaiBody: OpenAiChatBody,
  projectId: string,
  modelId: string,
  options?: ToEnvelopeOptions,
  warn?: (message: string) => void,
  signatureLookup?: (toolCallId: string) => string | undefined
): CloudCodeEnvelope {
  const messages: OpenAiChatMessage[] = Array.isArray(openaiBody.messages) ? (openaiBody.messages as OpenAiChatMessage[]) : [];
  const contents: CloudCodeContent[] = [];
  const systemParts: Array<{ text: string }> = [];
  // `tool_call_id` -> function name, filled while scanning assistant
  // turns, so a tool result that omits `name` still pairs with its
  // `functionCall` on the Cloud Code envelope.
  const toolNameByCallId = new Map<string, string>();

  const pushMerged = (role: 'user' | 'model', parts: CloudCodePart[]): void => {
    if (parts.length === 0) {
      return;
    }
    const last = contents.length > 0 ? contents[contents.length - 1] : undefined;
    if (last && last.role === role) {
      last.parts.push(...parts);
      return;
    }
    contents.push({ role, parts: [...parts] });
  };

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;

    const role = msg.role;
    if (role === 'system' || role === 'developer') {
      const parsed = openAiContentToGeminiParts(msg.content);
      for (const part of parsed.parts) {
        if (part.text) {
          systemParts.push({ text: part.text });
        }
      }
      logDroppedImageUrls(parsed.droppedImageUrls, 'AGY system message', warn ?? (() => undefined));
      continue;
    }

    if (role === 'user') {
      const parts: CloudCodePart[] = [];
      const parsed = openAiContentToGeminiParts(msg.content);
      for (const part of parsed.parts) {
        if (part.text) {
          parts.push({ text: part.text });
        } else if (part.inlineData) {
          parts.push({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
        }
      }
      logDroppedImageUrls(parsed.droppedImageUrls, 'AGY user message', warn ?? (() => undefined));
      pushMerged('user', parts);
      continue;
    }

    if (role === 'assistant') {
      const parts: CloudCodePart[] = [];
      const parsed = openAiContentToGeminiParts(msg.content);
      for (const part of parsed.parts) {
        if (part.text) {
          parts.push({ text: part.text });
        } else if (part.inlineData) {
          parts.push({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
        }
      }
      logDroppedImageUrls(parsed.droppedImageUrls, 'AGY assistant message', warn ?? (() => undefined));
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          if (typeof tc.function?.arguments === 'string') {
            try {
              const parsedArgs: unknown = JSON.parse(tc.function.arguments);
              args = typeof parsedArgs === 'object' && parsedArgs !== null ? (parsedArgs as Record<string, unknown>) : { raw: tc.function.arguments };
            } catch {
              args = { raw: tc.function.arguments };
            }
          } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
            args = tc.function.arguments as Record<string, unknown>;
          }
          const functionCallPart: CloudCodePart = {
            functionCall: {
              name: tc.function?.name ?? 'unknown_function',
              args,
            },
          };
          if (typeof tc.id === 'string' && tc.id.length > 0 && tc.function?.name) {
            toolNameByCallId.set(tc.id, tc.function.name);
          }
          // Transparent pass-through of `extra_signature` -> AGY
          // `thoughtSignature` part. The AGY Cloud Code envelope
          // reuses the same part shape as the native surface, so the
          // upstream can keep the same reasoning state across turns.
          // Same gap-filler contract as the BYOK native surface:
          // client-supplied wins, cache lookup only fires when the
          // client replayed the turn without the signature.
          if (typeof tc.extra_signature === 'string' && tc.extra_signature.length > 0) {
            functionCallPart.thoughtSignature = tc.extra_signature;
          } else if (signatureLookup && typeof tc.id === 'string' && tc.id.length > 0) {
            const cached = signatureLookup(tc.id);
            if (cached) {
              functionCallPart.thoughtSignature = cached;
            }
          }
          parts.push(functionCallPart);
        }
      }
      pushMerged('model', parts);
      continue;
    }

    if (role === 'tool') {
      // `functionResponse.response` is a protobuf Struct upstream, so it
      // must be a JSON object. A content-parts array (or a JSON array in a
      // string) is normalized by the shared helper - forwarding it as-is
      // returns 400 `Proto field is not repeating, cannot start list`.
      const parsedResponse = toFunctionResponseValue(msg.content, warn) ?? { result: String(msg.content ?? '') };
      // Prefer the client-supplied name, fall back to the name of the
      // `tool_calls` entry this result answers, then to a placeholder.
      const toolName =
        msg.name ||
        (typeof msg.tool_call_id === 'string' ? toolNameByCallId.get(msg.tool_call_id) : undefined) ||
        'tool_response';

      const functionResponsePart: CloudCodePart = {
        functionResponse: {
          name: toolName,
          response: parsedResponse,
        },
      };
      // Transparent pass-through of `extra_signature` -> AGY
      // `thoughtSignature` on `functionResponse`, same as the BYOK
      // native surface.
      if (typeof msg.extra_signature === 'string' && msg.extra_signature.length > 0) {
        functionResponsePart.thoughtSignature = msg.extra_signature;
      }
      pushMerged('user', [functionResponsePart]);
      continue;
    }
  }

  const generationConfig: CloudCodeGenerationConfig = {};
  if (typeof openaiBody.temperature === 'number') {
    generationConfig.temperature = openaiBody.temperature;
  }
  if (typeof openaiBody.top_p === 'number') {
    generationConfig.topP = openaiBody.top_p;
  }
  const maxTokens = openaiBody.max_tokens ?? openaiBody.max_completion_tokens;
  if (typeof maxTokens === 'number') {
    generationConfig.maxOutputTokens = maxTokens;
  }
  if (openaiBody.stop) {
    generationConfig.stopSequences = Array.isArray(openaiBody.stop)
      ? openaiBody.stop
      : [String(openaiBody.stop)];
  }

  const cloudCodeRequest: CloudCodeRequest = { contents };
  if (systemParts.length > 0) {
    cloudCodeRequest.systemInstruction = { parts: systemParts };
  }
  if (Object.keys(generationConfig).length > 0) {
    cloudCodeRequest.generationConfig = generationConfig;
  }

  if (Array.isArray(openaiBody.tools) && openaiBody.tools.length > 0) {
    const declarations: CloudCodeFunctionDeclaration[] = [];
    for (const tool of openaiBody.tools) {
      if (tool && tool.type === 'function' && tool.function) {
        declarations.push({
          name: tool.function.name,
          description: tool.function.description,
          parameters: cleanJsonSchema(tool.function.parameters),
        });
      }
    }
    if (declarations.length > 0) {
      cloudCodeRequest.tools = [{ functionDeclarations: declarations }];
    }
  }

  const userAgent = options?.userAgent || DEFAULT_USER_AGENT;
  const requestId =
    options?.requestId || `agent-${Date.now()}-${randomBytes(6).toString('hex')}`;

  return {
    project: projectId,
    model: modelId,
    request: cloudCodeRequest,
    requestType: 'agent',
    userAgent,
    requestId,
  };
}
