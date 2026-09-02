/**
 * Convert an Antigravity / Cloud Code Assist SSE stream into the OpenAI
 * `chat.completion.chunk` SSE dialect served by the gateway.
 *
 * Pure module: no network, no filesystem. Covered by
 * tests/antigravity-sse-transform.test.ts.
 */

import type {
  OpenAiChatChunk,
  OpenAiChatCompletion,
  OpenAiToolCall,
  OpenAiUsage,
} from './types';

interface AntigravityFramePart {
  text?: string;
  thought?: boolean;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

interface AntigravityFrame {
  response?: {
    candidates?: Array<{
      content?: { parts?: AntigravityFramePart[] };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
}

export interface AntigravitySseConverterOptions {
  /** Stable id reused on every emitted chunk (`chatcmpl-…`-style). */
  requestId: string;
  /** Model id echoed on every emitted chunk. */
  model: string;
  /** Called with the raw payload of any frame that fails to parse. */
  onParseError?: (rawPayload: string) => void;
  /** Deterministic `created` timestamp (seconds) for tests. */
  createdSeconds?: number;
}

const FINISH_REASON_MAP: Record<string, string> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  OTHER: 'stop',
};

function mapFinishReason(finishReason: string | undefined): string | null {
  if (finishReason === undefined) {
    return null;
  }
  return FINISH_REASON_MAP[finishReason] ?? 'stop';
}

/**
 * Incremental converter. Feed raw upstream bytes with `push()`, drain OpenAI
 * SSE frames, and finalize with `flush()` which appends the `[DONE]` marker.
 */
export class AntigravitySseConverter {
  private readonly options: AntigravitySseConverterOptions;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private toolCallIndex = 0;
  private emittedOutput = false;
  private doneEmitted = false;

  constructor(options: AntigravitySseConverterOptions) {
    this.options = options;
  }

  /** True once at least one content or tool-call chunk has been emitted. */
  get sawOutput(): boolean {
    return this.emittedOutput;
  }

  push(chunk: Uint8Array): string[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drainBuffer(false);
  }

  flush(): string[] {
    this.buffer += this.decoder.decode();
    const frames = this.drainBuffer(true);
    if (!this.doneEmitted) {
      this.doneEmitted = true;
      frames.push('data: [DONE]\n\n');
    }
    return frames;
  }

  private drainBuffer(final: boolean): string[] {
    const frames: string[] = [];
    const segments = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = final ? '' : (segments.pop() ?? '');
    if (final) {
      segments.push(this.buffer);
    }
    for (const segment of segments) {
      if (segment.length === 0) {
        continue;
      }
      this.handleSegment(segment, frames);
    }
    return frames;
  }

  private handleSegment(segment: string, frames: string[]): void {
    const payload = segment
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
      .join('\n');
    if (payload.length === 0 || payload === '[DONE]') {
      return; // comments / heartbeats / upstream terminator
    }
    let parsed: AntigravityFrame;
    try {
      parsed = JSON.parse(payload) as AntigravityFrame;
    } catch {
      this.options.onParseError?.(payload);
      return;
    }
    const response = parsed.response;
    if (response === undefined) {
      return;
    }
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    for (const part of parts) {
      if (part.thought === true) {
        continue; // thinking blocks are not surfaced in the MVP dialect
      }
      if (typeof part.text === 'string' && part.text.length > 0) {
        this.emittedOutput = true;
        frames.push(this.encodeChunk({ content: part.text }, null));
      }
      if (part.functionCall !== undefined) {
        this.emittedOutput = true;
        const index = this.toolCallIndex;
        this.toolCallIndex += 1;
        frames.push(
          this.encodeChunk(
            {
              tool_calls: [
                {
                  index,
                  id: `call_${this.options.requestId}_${index}`,
                  type: 'function',
                  function: {
                    name: part.functionCall.name ?? 'unknown_tool',
                    arguments: JSON.stringify(part.functionCall.args ?? {}),
                  },
                },
              ],
            },
            null,
          ),
        );
      }
    }
    const finishReason = mapFinishReason(candidate?.finishReason);
    if (finishReason !== null) {
      frames.push(this.encodeChunk({}, finishReason));
    }
    if (response.usageMetadata !== undefined) {
      frames.push(this.encodeUsageChunk(response.usageMetadata));
    }
  }

  private encodeChunk(delta: OpenAiChatChunk['choices'][0]['delta'], finishReason: string | null): string {
    const chunk: OpenAiChatChunk = {
      id: this.options.requestId,
      object: 'chat.completion.chunk',
      created: this.options.createdSeconds ?? Math.floor(Date.now() / 1000),
      model: this.options.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  private encodeUsageChunk(usage: NonNullable<AntigravityFrame['response']>['usageMetadata']): string {
    const chunk: OpenAiChatChunk = {
      id: this.options.requestId,
      object: 'chat.completion.chunk',
      created: this.options.createdSeconds ?? Math.floor(Date.now() / 1000),
      model: this.options.model,
      choices: [],
      usage: {
        prompt_tokens: usage?.promptTokenCount ?? 0,
        completion_tokens: usage?.candidatesTokenCount ?? 0,
        total_tokens: usage?.totalTokenCount ?? 0,
      },
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }
}

/** Web TransformStream wrapper, inserted before `Readable.fromWeb().pipe()`. */
export function createAntigravitySseTransform(
  options: AntigravitySseConverterOptions,
): TransformStream<Uint8Array, Uint8Array> {
  const converter = new AntigravitySseConverter(options);
  const encoder = new TextEncoder();
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      for (const frame of converter.push(chunk)) {
        controller.enqueue(encoder.encode(frame));
      }
    },
    flush(controller) {
      for (const frame of converter.flush()) {
        controller.enqueue(encoder.encode(frame));
      }
    },
  });
}

/**
 * Assemble a non-streaming `chat.completion` from converter output frames.
 * Used when the downstream client asked for `stream: false`.
 */
export function mergeFramesToCompletion(frames: string[]): OpenAiChatCompletion {
  let content = '';
  const toolCalls = new Map<number, OpenAiToolCall>();
  let usage: OpenAiUsage | undefined;
  let finishReason: string | null = null;
  let id = '';
  let model = '';
  let created = 0;

  for (const frame of frames) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice('data:'.length).trim();
      if (payload === '[DONE]') {
        continue;
      }
      const chunk = JSON.parse(payload) as OpenAiChatChunk;
      id = chunk.id;
      model = chunk.model;
      created = chunk.created;
      if (chunk.usage !== undefined) {
        usage = chunk.usage;
      }
      const choice = chunk.choices[0];
      if (choice === undefined) {
        continue;
      }
      if (typeof choice.delta.content === 'string') {
        content += choice.delta.content;
      }
      for (const call of choice.delta.tool_calls ?? []) {
        const existing = toolCalls.get(call.index);
        if (existing === undefined) {
          toolCalls.set(call.index, {
            id: call.id,
            type: 'function',
            function: { name: call.function.name, arguments: call.function.arguments },
          });
        } else {
          existing.function.arguments += call.function.arguments;
        }
      }
      if (choice.finish_reason !== null) {
        finishReason = choice.finish_reason;
      }
    }
  }

  const orderedToolCalls = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call);

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content.length > 0 ? content : null,
          ...(orderedToolCalls.length > 0 ? { tool_calls: orderedToolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    ...(usage !== undefined ? { usage } : {}),
  };
}
