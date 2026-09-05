/**
 * AIFlowBridge - TransformStream for Antigravity / Cloud Code SSE to OpenAI SSE.
 *
 * Converts Cloud Code Assist streaming SSE frames into OpenAI-compatible
 * chat.completion.chunk event stream frames (Uint8Array -> Uint8Array).
 * Pure transformation module, no network calls, fully unit-testable.
 */

import { randomBytes } from 'node:crypto';
import type { CloudCodeStreamEvent } from './types';

export interface SseTransformOptions {
  model: string;
  id?: string;
  created?: number;
}

/**
 * Creates a TransformStream that converts Cloud Code SSE chunks to standard
 * OpenAI chat.completion.chunk SSE frames ending with `data: [DONE]\n\n`.
 */
export function createAntigravityToOpenAiTransformStream(options: SseTransformOptions): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf8');
  let buffer = '';
  const completionId = options.id || `chatcmpl-${randomBytes(12).toString('hex')}`;
  const created = options.created || Math.floor(Date.now() / 1000);
  const model = options.model;
  let toolCallIndex = 0;
  let sawToolCall = false;
  const resolveFinishReason = (geminiReason: string): string => {
    const mapped = mapFinishReason(geminiReason);
    return mapped === 'stop' && sawToolCall ? 'tool_calls' : mapped;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n\r?\n/);
      // The last element is either empty (if ended on \n\n) or the incomplete chunk.
      buffer = lines.pop() ?? '';

      for (const block of lines) {
        const trimmed = block.trim();
        if (!trimmed) continue;

        for (const line of trimmed.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          let parsed: CloudCodeStreamEvent;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (parsed.error) {
            const errorFrame = {
              error: {
                message: parsed.error.message || 'Upstream Cloud Code error',
                type: 'upstream_error',
                code: parsed.error.code || 500,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorFrame)}\n\n`));
            continue;
          }

          const candidates = parsed.response?.candidates ?? [];
          const usage = parsed.response?.usageMetadata;

          for (const cand of candidates) {
            const parts = cand.content?.parts ?? [];

            for (const part of parts) {
              if (typeof part.text === 'string' && part.text.length > 0) {
                const chunkPayload = {
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: part.text },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkPayload)}\n\n`));
              }

              if (part.functionCall) {
                sawToolCall = true;
                // Stable id per tool-call index: OpenAI clients accumulate
                // chunked `arguments` by (index, id). A random id per
                // chunk would break accumulation, so the id is derived
                // once per index and reused for every chunk of that call.
                const callIndex = toolCallIndex++;
                const toolCallEntry: {
                  index: number;
                  id: string;
                  type: 'function';
                  function: { name?: string; arguments?: string };
                  extra_signature?: string;
                } = {
                  index: callIndex,
                  id: `call_${completionId.replace(/^chatcmpl-/, '').slice(0, 12)}_${callIndex}`,
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args ?? {}),
                  },
                };
                // Transparent pass-through of the upstream
                // thought_signature. Echo it back on the next turn
                // via `extra_signature` so the AGY Cloud Code
                // envelope can keep the same reasoning state across
                // tool turns (otherwise the next functionCall
                // round-trip fails with `400 Function call is
                // missing a thought_signature`).
                if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0) {
                  toolCallEntry.extra_signature = part.thoughtSignature;
                }
                const toolChunkPayload = {
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { tool_calls: [toolCallEntry] },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolChunkPayload)}\n\n`));
              }
            }

            const finishReason = cand.finishReason ? resolveFinishReason(cand.finishReason) : null;
            if (finishReason) {
              const finishPayload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: finishReason,
                  },
                ],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishPayload)}\n\n`));
            }
          }

          if (usage) {
            const usagePayload = {
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [],
              usage: {
                prompt_tokens: usage.promptTokenCount ?? 0,
                completion_tokens: usage.candidatesTokenCount ?? 0,
                total_tokens: usage.totalTokenCount ?? 0,
              },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(usagePayload)}\n\n`));
          }
        }
      }
    },

    flush(controller) {
      // Process remaining buffer if it contains a data line. The
      // residual frame goes through the same candidate emission as
      // `transform()` (text + tool calls + finish reason) so a
      // truncated final frame is not silently downgraded to text-only.
      if (buffer.trim()) {
        for (const line of buffer.trim().split(/\r?\n/)) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (jsonStr && jsonStr !== '[DONE]') {
              try {
                const parsed: CloudCodeStreamEvent = JSON.parse(jsonStr);
                if (parsed.error) {
                  const errorFrame = {
                    error: {
                      message: parsed.error.message || 'Upstream Cloud Code error',
                      type: 'upstream_error',
                      code: parsed.error.code || 500,
                    },
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorFrame)}\n\n`));
                  continue;
                }
                const candidates = parsed.response?.candidates ?? [];
                for (const cand of candidates) {
                  for (const part of cand.content?.parts ?? []) {
                    if (typeof part.text === 'string' && part.text.length > 0) {
                      const chunkPayload = {
                        id: completionId,
                        object: 'chat.completion.chunk',
                        created,
                        model,
                        choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }],
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkPayload)}\n\n`));
                    }
                    if (part.functionCall) {
                      sawToolCall = true;
                      const callIndex = toolCallIndex++;
                      const residualToolCallEntry: {
                        index: number;
                        id: string;
                        type: 'function';
                        function: { name?: string; arguments?: string };
                        extra_signature?: string;
                      } = {
                        index: callIndex,
                        id: `call_${completionId.replace(/^chatcmpl-/, '').slice(0, 12)}_${callIndex}`,
                        type: 'function',
                        function: {
                          name: part.functionCall.name,
                          arguments: JSON.stringify(part.functionCall.args ?? {}),
                        },
                      };
                      if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0) {
                        residualToolCallEntry.extra_signature = part.thoughtSignature;
                      }
                      const toolChunkPayload = {
                        id: completionId,
                        object: 'chat.completion.chunk',
                        created,
                        model,
                        choices: [
                          {
                            index: 0,
                            delta: { tool_calls: [residualToolCallEntry] },
                            finish_reason: null,
                          },
                        ],
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolChunkPayload)}\n\n`));
                    }
                  }
                  const finishReason = cand.finishReason ? resolveFinishReason(cand.finishReason) : null;
                  if (finishReason) {
                    const finishPayload = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created,
                      model,
                      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishPayload)}\n\n`));
                  }
                }
                const flushUsage = parsed.response?.usageMetadata;
                if (flushUsage) {
                  const usagePayload = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created,
                    model,
                    choices: [],
                    usage: {
                      prompt_tokens: flushUsage.promptTokenCount ?? 0,
                      completion_tokens: flushUsage.candidatesTokenCount ?? 0,
                      total_tokens: flushUsage.totalTokenCount ?? 0,
                    },
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(usagePayload)}\n\n`));
                }
              } catch {
                // Ignore parse errors on trailing flush
              }
            }
          }
        }
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });
}

function mapFinishReason(geminiReason: string): string {
  switch (geminiReason.toUpperCase()) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter';
    default:
      return geminiReason.toLowerCase();
  }
}

export interface AccumulatedToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  /**
   * Transparent pass-through of the upstream `thought_signature`.
   * The client echoes it back on the next turn via `extra_signature`
   * so the AGY envelope keeps the same reasoning state across
   * tool rounds (otherwise the upstream rejects the next
   * functionCall round with `400 Function call is missing a
   * thought_signature`).
   */
  extra_signature?: string;
}

export interface AccumulatedChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: { role: 'assistant'; content: string | null; tool_calls?: AccumulatedToolCall[] };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Accumulates Cloud Code SSE chunks into a single standard non-streamed OpenAI ChatCompletion response.
 */
export async function accumulateAntigravityResponse(
  stream: ReadableStream<Uint8Array>,
  options: SseTransformOptions
): Promise<AccumulatedChatCompletion> {
  const completionId = options.id || `chatcmpl-${randomBytes(12).toString('hex')}`;
  const created = options.created || Math.floor(Date.now() / 1000);
  const model = options.model;

  let combinedText = '';
  const toolCalls: AccumulatedToolCall[] = [];
  let finishReason = 'stop';
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let toolCallIndex = 0;

  const transformed = stream.pipeThrough(createAntigravityToOpenAiTransformStream(options));
  const reader = transformed.getReader();
  const decoder = new TextDecoder('utf8');
  let sseBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split(/\r?\n\r?\n/);
      sseBuffer = lines.pop() ?? '';

      for (const block of lines) {
        for (const line of block.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          try {
            const chunk = JSON.parse(dataStr) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string }; extra_signature?: string }>;
                };
                finish_reason?: string;
              }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            if (chunk.choices && chunk.choices[0]) {
              const choice = chunk.choices[0];
              if (choice.delta?.content) {
                combinedText += choice.delta.content;
              }
              if (Array.isArray(choice.delta?.tool_calls)) {
                for (const tc of choice.delta.tool_calls) {
                  const accumulated: AccumulatedToolCall = {
                    id: tc.id || `call_${toolCallIndex++}`,
                    type: 'function',
                    function: {
                      name: tc.function?.name ?? 'unknown_function',
                      arguments: tc.function?.arguments ?? '{}',
                    },
                  };
                  if (typeof tc.extra_signature === 'string' && tc.extra_signature.length > 0) {
                    accumulated.extra_signature = tc.extra_signature;
                  }
                  toolCalls.push(accumulated);
                }
              }
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            }
            if (chunk.usage) {
              usage = {
                prompt_tokens: chunk.usage.prompt_tokens ?? usage.prompt_tokens,
                completion_tokens: chunk.usage.completion_tokens ?? usage.completion_tokens,
                total_tokens: chunk.usage.total_tokens ?? usage.total_tokens,
              };
            }
          } catch {
            // ignore chunk parse errors during accumulation
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Antigravity stream accumulation failed: ${message}`);
  } finally {
    reader.releaseLock();
  }

  // OpenAI contract: a completion carrying `tool_calls` must report
  // `finish_reason: tool_calls`, even when the upstream terminal
  // reason mapped to plain `stop`.
  const resolvedFinishReason = finishReason === 'stop' && toolCalls.length > 0 ? 'tool_calls' : finishReason;

  return {
    id: completionId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: combinedText.length > 0 ? combinedText : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage,
  };
}
