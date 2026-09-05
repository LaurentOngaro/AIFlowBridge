/**
 * AIFlowBridge - Gemini public API native-surface translator.
 *
 * The Gemini public API (`generativelanguage.googleapis.com`) exposes two
 * surfaces:
 *
 *   - Native: `/v1beta/models/{model}:generateContent` and the streaming
 *     variant `:streamGenerateContent?alt=sse`. This is the canonical
 *     surface, with a generous free tier on most GCP projects.
 *   - OpenAI-compatible: `/v1beta/openai/chat/completions`. Available
 *     only on GCP projects where the OpenAI-compat feature is enabled
 *     (sometimes 0-quota on newer projects).
 *
 * For projects where the OpenAI-compat surface returns 429 with no
 * usage (the surface is just not enabled), the gateway falls back to
 * the native surface: the upstream URL is rewritten to
 * `.../models/{model}:generateContent` (or `:streamGenerateContent?alt=sse`
 * for streaming), the OpenAI-shaped body is translated into the Gemini
 * native envelope, and the streaming response is reshaped into OpenAI
 * SSE frames so the rest of the gateway pipeline stays unchanged.
 *
 * Translation rules (per Google's Gemini API REST reference):
 *
 *   - OpenAI `messages` (system / user / assistant / developer / tool)
 *     becomes Gemini `contents` (user / model roles only).
 *     - `system` and `developer` concatenate into a single
 *       `systemInstruction` (parts.text joined).
 *     - `assistant` becomes `role: 'model'`.
 *     - `tool` becomes `role: 'user'` with a `functionResponse` part.
 *     - `assistant` with `tool_calls` becomes `role: 'model'` with one
 *       `functionCall` part per call.
 *   - OpenAI `tools[].function` becomes Gemini
 *     `tools[].functionDeclarations[]`.
 *   - OpenAI `temperature` / `top_p` / `max_tokens` /
 *     `max_completion_tokens` / `stop` / `response_format` map to
 *     Gemini `generationConfig`.
 *   - Streaming chunks are converted from the native
 *     `{candidates:[{content:{parts:[{text}]}}]}` JSON objects to the
 *     OpenAI `{choices:[{delta:{content}}]}` SSE frames via the same
 *     pipeline as the Antigravity OAuth route.
 *
 * This module is pure translation - no network calls, fully unit-testable
 * via vitest with fixture JSON inputs.
 */

import { randomBytes } from 'node:crypto';
import { logDroppedImageUrls, openAiContentToGeminiParts } from './content-parts';

/** Native Gemini request body for `:generateContent` and `:streamGenerateContent?alt=sse`. */
export interface GeminiNativeRequest {
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
      | {
          functionCall: {
            name: string;
            args: Record<string, unknown>;
          };
        }
      | {
          functionResponse: {
            name: string;
            response: Record<string, unknown>;
          };
        }
    >;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    candidateCount?: number;
    responseMimeType?: 'text/plain' | 'application/json';
  };
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  }>;
}

/** Native Gemini response (non-streaming and per-chunk shape are similar). */
export interface GeminiNativeResponse {
  candidates?: Array<{
    content?: {
      role?: 'model';
      parts?: Array<{ text?: string } | { functionCall?: unknown }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code: number;
    message: string;
    status?: string;
  };
}

const FORBIDDEN_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'examples',
  'patternProperties',
  'additionalProperties',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

/**
 * Recursively strips JSON-Schema keywords the Gemini `OpenApi` dialect
 * rejects (see `src/aiflowbridge/antigravity/envelope.ts` for the same
 * logic on the AGY OAuth surface). The native surface accepts more
 * keywords than the AGY one, but the high-risk overlap is the same.
 */
function cleanJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object' };
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (FORBIDDEN_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const cleaned: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        cleaned[propName] = cleanJsonSchema(propSchema);
      }
      result.properties = cleaned;
    } else if (key === 'items') {
      result.items = cleanJsonSchema(value);
    } else {
      result[key] = value;
    }
  }
  if (!result.type) result.type = 'object';
  return result;
}

interface OpenAiChatMessage {
  role?: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: unknown };
  }>;
}

interface OpenAiChatBody {
  messages?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
  stop?: unknown;
  tools?: unknown;
  response_format?: { type?: 'text' | 'json_object' | 'json_schema' };
}

/**
 * Convert an OpenAI Chat Completions payload into the Gemini native
 * surface body. Pure function - no network calls.
 *
 * Role alternation: the native API rejects consecutive turns with the
 * same role, so same-role turns are merged into a single entry. An
 * assistant turn carrying both text and `tool_calls` produces exactly
 * one `{ role: model }` entry holding both the text and the
 * `functionCall` parts. Consecutive `tool` messages merge into a
 * single `{ role: user }` entry holding every `functionResponse`
 * part. Upstream model ids are kept verbatim, no alias map.
 *
 * @param warn Optional sink for dropped remote `image_url` warnings.
 *   The gateway passes `logger.warn`; unit tests omit it (no `vscode`
 *   import in this call chain).
 */
export function toGeminiNativeRequest(openaiBody: OpenAiChatBody, warn?: (message: string) => void): GeminiNativeRequest {
  const messages: OpenAiChatMessage[] = Array.isArray(openaiBody.messages)
    ? (openaiBody.messages as OpenAiChatMessage[])
    : [];

  const systemParts: Array<{ text: string }> = [];
  const contents: GeminiNativeRequest['contents'] = [];

  const pushMerged = (role: 'user' | 'model', parts: GeminiNativeRequest['contents'][number]['parts']): void => {
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
    const role = msg.role;
    if (role === 'system' || role === 'developer') {
      const parsed = openAiContentToGeminiParts(msg.content);
      for (const part of parsed.parts) {
        if (part.text) {
          systemParts.push({ text: part.text });
        }
      }
      logDroppedImageUrls(parsed.droppedImageUrls, 'system message', warn ?? (() => undefined));
      continue;
    }
    if (role === 'assistant') {
      const parts: GeminiNativeRequest['contents'][number]['parts'] = [];
      const parsed = openAiContentToGeminiParts(msg.content);
      for (const part of parsed.parts) {
        if (part.text) {
          parts.push({ text: part.text });
        } else if (part.inlineData) {
          parts.push({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
        }
      }
      logDroppedImageUrls(parsed.droppedImageUrls, 'assistant message', warn ?? (() => undefined));
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name;
          if (!name) continue;
          let args: Record<string, unknown> = {};
          if (typeof tc.function?.arguments === 'string') {
            try {
              const parsedArgs: unknown = JSON.parse(tc.function.arguments);
              args = typeof parsedArgs === 'object' && parsedArgs !== null ? (parsedArgs as Record<string, unknown>) : { raw: tc.function.arguments };
            } catch {
              args = { raw: tc.function.arguments };
            }
          }
          void tc.id;
          parts.push({ functionCall: { name, args } });
        }
      }
      pushMerged('model', parts);
      continue;
    }
    if (role === 'tool') {
      let response: Record<string, unknown> = {};
      if (typeof msg.content === 'string') {
        try {
          const parsed: unknown = JSON.parse(msg.content);
          response = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { result: msg.content };
        } catch {
          response = { result: msg.content };
        }
      } else if (msg.content && typeof msg.content === 'object') {
        response = msg.content as Record<string, unknown>;
      }
      pushMerged('user', [{ functionResponse: { name: msg.name ?? 'tool', response } }]);
      continue;
    }
    // Default: user role. Content arrays (text plus image_url) map
    // to native parts via the shared parser. Remote http(s) image
    // URLs are dropped with a warning, never forwarded as text.
    const parsed = openAiContentToGeminiParts(msg.content);
    const parts: GeminiNativeRequest['contents'][number]['parts'] = [];
    for (const part of parsed.parts) {
      if (part.text) {
        parts.push({ text: part.text });
      } else if (part.inlineData) {
        parts.push({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
      }
    }
    logDroppedImageUrls(parsed.droppedImageUrls, 'user message', warn ?? (() => undefined));
    if (parts.length === 0) {
      continue;
    }
    pushMerged('user', parts);
  }

  const generationConfig: GeminiNativeRequest['generationConfig'] = {};
  if (typeof openaiBody.temperature === 'number') generationConfig.temperature = openaiBody.temperature;
  if (typeof openaiBody.top_p === 'number') generationConfig.topP = openaiBody.top_p;
  const maxTokens = openaiBody.max_tokens ?? openaiBody.max_completion_tokens;
  if (typeof maxTokens === 'number') generationConfig.maxOutputTokens = maxTokens;
  if (openaiBody.stop) {
    generationConfig.stopSequences = Array.isArray(openaiBody.stop)
      ? openaiBody.stop.map((s) => String(s))
      : [String(openaiBody.stop)];
  }
  if (openaiBody.response_format?.type === 'json_object') {
    generationConfig.responseMimeType = 'application/json';
  }

  const request: GeminiNativeRequest = { contents };
  if (systemParts.length > 0) request.systemInstruction = { parts: systemParts };
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
  if (Array.isArray(openaiBody.tools) && openaiBody.tools.length > 0) {
    type Declaration = { name: string; description?: string; parameters?: Record<string, unknown> };
    const declarations: Declaration[] = [];
    for (const tool of openaiBody.tools) {
      if (tool && typeof tool === 'object' && (tool as { type?: string }).type === 'function') {
        const fn = (tool as { function?: { name?: string; description?: string; parameters?: unknown } }).function;
        if (fn?.name) {
          declarations.push({
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters ? cleanJsonSchema(fn.parameters) : undefined,
          });
        }
      }
    }
    if (declarations.length > 0) {
      request.tools = [{ functionDeclarations: declarations }];
    }
  }
  return request;
}

/**
 * Convert a native Gemini response (non-streaming JSON object or a
 * streaming chunk JSON object) into an OpenAI Chat Completions JSON
 * object suitable for the gateway to relay back to the client.
 *
 * Tool calls: maps `candidates[].content.parts[].functionCall` into
 * `choices[0].message.tool_calls` with stable per-call ids derived from
 * the completionId + index (audit BUG-04). Without this, Gemini
 * tool-using answers arrive with `content: null` and no `tool_calls`,
 * which clients like Kilo Code treat as an empty response.
 */
export function fromGeminiNativeResponse(
  raw: GeminiNativeResponse,
  options: { model: string; completionId?: string; created?: number }
): {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
} {
  const completionId = options.completionId ?? `chatcmpl-${randomBytes(12).toString('hex')}`;
  const cand = raw.candidates?.[0];
  type Part = { text?: string } | { functionCall?: { name?: string; args?: Record<string, unknown> } };
  const parts: Part[] = Array.isArray(cand?.content?.parts) ? (cand?.content?.parts as Part[]) : [];
  let textBuffer = '';
  let toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  let callIndex = 0;
  for (const part of parts) {
    if ('text' in part && typeof part.text === 'string') {
      textBuffer += part.text;
    } else if ('functionCall' in part && part.functionCall?.name) {
      const id = `call_${completionId.replace(/^chatcmpl-/, '').slice(0, 12)}_${callIndex++}`;
      toolCalls.push({
        id,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    }
  }
  const text = textBuffer;
  // OpenAI contract: when `tool_calls` are present the finish reason
  // must be `tool_calls`, not `stop`. A native `STOP` with at least
  // one `functionCall` part means the model wants to call tools.
  const mappedReason = (() => {
    const reason = cand?.finishReason;
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
        return 'content_filter';
      default:
        return 'stop';
    }
  })();
  const finishReason = mappedReason === 'stop' && toolCalls.length > 0 ? 'tool_calls' : mappedReason;
  const message: { role: 'assistant'; content: string | null; tool_calls?: typeof toolCalls } = {
    role: 'assistant',
    content: text || null,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    id: completionId,
    object: 'chat.completion',
    created: options.created ?? Math.floor(Date.now() / 1000),
    model: options.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: raw.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: raw.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

/**
 * Map Gemini native finishReason values to the OpenAI `finish_reason`
 * vocabulary that Kilo / Continue / the OpenAI SDK consume natively.
 * Audit BUG-10. The original implementation hardcoded `stop`, which
 * masked `MAX_TOKENS` truncation and `SAFETY` content filters.
 */
function mapGeminiFinishReason(reason: string | undefined): 'stop' | 'length' | 'content_filter' {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/**
 * Transform a Gemini native SSE stream (one JSON object per `data:`
 * frame) into OpenAI Chat Completions streaming chunks. Audit BUG-03 + BUG-10.
 *
 * Stable per-call id (derived from `completionId + toolCallIndex`) lets
 * clients accumulate chunked tool-call argument fragments without
 * collisions. The `[DONE]` terminator is emitted exactly once, in
 * `flush()` - never per-frame - so a chat UI does not see spurious
 * "stream ended" notifications.
 */
export function createGeminiNativeToOpenAiSseStream(options: { model: string; completionId?: string }): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const completionId = options.completionId ?? `chatcmpl-${randomBytes(12).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);
  let outputBuf = '';
  let toolCallIndex = 0;
  let sawFinish = false;
  let sawToolCall = false;
  const resolveStreamFinishReason = (reason: string | undefined): 'stop' | 'length' | 'content_filter' | 'tool_calls' => {
    const mapped = mapGeminiFinishReason(reason);
    return mapped === 'stop' && sawToolCall ? 'tool_calls' : mapped;
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      outputBuf += new TextDecoder('utf8').decode(chunk, { stream: true });
      let boundary: number;
      while ((boundary = outputBuf.indexOf('\n\n')) !== -1) {
        const block = outputBuf.slice(0, boundary);
        outputBuf = outputBuf.slice(boundary + 2);
        for (const line of block.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<
                    | { text?: string }
                    | { functionCall?: { name?: string; args?: Record<string, unknown> } }
                  >;
                };
                finishReason?: string;
              }>;
              usageMetadata?: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                totalTokenCount?: number;
              };
            };
            const cand = parsed.candidates?.[0];
            const parts = cand?.content?.parts ?? [];

            // Text content: emit a `delta.content` chunk.
            const text = parts.map((p) => ('text' in p ? p.text ?? '' : '')).join('');
            if (text) {
              const frame = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
            }

            // Tool calls: emit one OpenAI-style `delta.tool_calls` chunk
            // per `functionCall` part. Any emitted call flips the
            // terminal `stop` into `tool_calls` per the OpenAI contract.
            for (const part of parts) {
              if ('functionCall' in part && part.functionCall?.name) {
                sawToolCall = true;
                const callIndex = toolCallIndex++;
                const toolChunk = {
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created,
                  model: options.model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: callIndex,
                            id: `call_${completionId.replace(/^chatcmpl-/, '').slice(0, 12)}_${callIndex}`,
                            type: 'function',
                            function: {
                              name: part.functionCall.name,
                              arguments: JSON.stringify(part.functionCall.args ?? {}),
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolChunk)}\n\n`));
              }
            }

            // OpenAI streaming protocol ordering: text/tool chunks
            // first, then `finish_reason` on its own chunk, then the
            // optional `usage` chunk, then `[DONE]`. The OpenAI Python
            // SDK and Kilo Code both expect this order and complain
            // "response ended unexpectedly" when usage is emitted
            // before finish_reason.
            if (cand?.finishReason) {
              const finishPayload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [{ index: 0, delta: {}, finish_reason: resolveStreamFinishReason(cand.finishReason) }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishPayload)}\n\n`));
              sawFinish = true;
            }
            if (parsed.usageMetadata) {
              const frame = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [],
                usage: {
                  prompt_tokens: parsed.usageMetadata.promptTokenCount ?? 0,
                  completion_tokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
                  total_tokens: parsed.usageMetadata.totalTokenCount ?? 0,
                },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
            }
          } catch {
            // ignore malformed chunk; upstream may send keep-alive comments
          }
        }
      }
    },
    flush(controller) {
      // Flush any partial SSE block left in the buffer when the
      // upstream closes. The chunked-transfer encoding can end
      // exactly after the last byte of a frame, with no trailing
      // `\n\n` - dropping the residue would silently lose the final
      // text/tool/finish/usage payload (audit finding from the
      // 2026-09-05 Gemini integration audit).
      const residual = outputBuf.trim();
      if (residual) {
        for (const line of residual.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<
                    | { text?: string }
                    | { functionCall?: { name?: string; args?: Record<string, unknown> } }
                  >;
                };
                finishReason?: string;
              }>;
              usageMetadata?: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                totalTokenCount?: number;
              };
            };
            const cand = parsed.candidates?.[0];
            const parts = cand?.content?.parts ?? [];
            const text = parts.map((p) => ('text' in p ? p.text ?? '' : '')).join('');
            if (text) {
              const frame = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
            }
            for (const part of parts) {
              if ('functionCall' in part && part.functionCall?.name) {
                sawToolCall = true;
                const callIndex = toolCallIndex++;
                const toolChunk = {
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created,
                  model: options.model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: callIndex,
                            id: `call_${completionId.replace(/^chatcmpl-/, '').slice(0, 12)}_${callIndex}`,
                            type: 'function',
                            function: {
                              name: part.functionCall.name,
                              arguments: JSON.stringify(part.functionCall.args ?? {}),
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolChunk)}\n\n`));
              }
            }
            if (cand?.finishReason) {
              const finishPayload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [{ index: 0, delta: {}, finish_reason: resolveStreamFinishReason(cand.finishReason) }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishPayload)}\n\n`));
              sawFinish = true;
            }
            if (parsed.usageMetadata) {
              const frame = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [],
                usage: {
                  prompt_tokens: parsed.usageMetadata.promptTokenCount ?? 0,
                  completion_tokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
                  total_tokens: parsed.usageMetadata.totalTokenCount ?? 0,
                },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
            }
          } catch {
            // ignore malformed chunk on the residual flush path.
          }
        }
      }
      // Always emit the [DONE] terminator exactly once.
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      void sawFinish;
    },
  });
}
