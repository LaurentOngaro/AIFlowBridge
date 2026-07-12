/**
 * Test helpers for mocking VS Code APIs and streaming responses.
 */

/** Mock EventEmitter for VS Code API simulation */
class MockEventEmitter<T> {
  private listeners: Array<(data: T) => void> = [];

  event(callback: (data: T) => void): void {
    this.listeners.push(callback);
  }

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}

/** Mock SecretStorage */
export class MockSecretStorage {
  private _store = new Map<string, string>();
  onDidChange = new MockEventEmitter<{ key: string }>();

  async get(key: string): Promise<string | undefined> {
    return this._store.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this._store.set(key, value);
    this.onDidChange.fire({ key });
  }

  async delete(key: string): Promise<void> {
    this._store.delete(key);
    this.onDidChange.fire({ key });
  }

  /** For testing: pre-populate with a value */
  set(key: string, value: string): void {
    this._store.set(key, value);
  }

  /** For testing: clear all */
  clear(): void {
    this._store.clear();
  }
}

/** Mock CancellationToken */
export class MockCancellationToken {
  private _isCancellationRequested = false;
  private listeners: Array<() => void> = [];

  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }

  cancel(): void {
    this._isCancellationRequested = true;
    for (const listener of this.listeners) {
      listener();
    }
  }

  onCancellationRequested(listener: () => void): { dispose(): void } {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  }
}

/** Mock Progress */
export class MockProgress<T> {
  reports: T[] = [];

  report(value: T): void {
    this.reports.push(value);
  }

  clear(): void {
    this.reports = [];
  }
}

/** Build a fake SSE stream from lines */
export function buildSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const data = lines.map((line) => `data: ${line}\n\n`).join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(data));
      controller.close();
    },
  });
}

/** Build a fake SSE stream that yields chunks incrementally */
export function buildChunkedSSEStream(chunks: Array<{ lines: string[]; delayMs?: number }>): ReadableStream<Uint8Array> {
  let chunkIndex = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (chunkIndex >= chunks.length) {
        controller.close();
        return;
      }

      const chunk = chunks[chunkIndex++];
      const data = chunk.lines.map((line) => `data: ${line}\n\n`).join('');
      controller.enqueue(new TextEncoder().encode(data));

      if (chunk.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, chunk.delayMs));
      }
    },
  });
}

/** Create a mock Response for fetch with streaming body */
export function createMockFetchResponse(body: ReadableStream<Uint8Array>, status = 200, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    body,
  } as unknown as Response;
}

/** Simulate a streaming SSE response with tool calls */
export function createToolCallStream(
  partials: Array<{
    content?: string;
    reasoning_content?: string;
    tool_calls?: unknown[];
    finish_reason?: string;
  }>
): ReadableStream<Uint8Array> {
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= partials.length) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }

      const partial = partials[index++];
      const chunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'test-model',
        choices: [
          {
            index: 0,
            delta: partial,
            finish_reason: partial.finish_reason ?? null,
          },
        ],
      };

      const line = JSON.stringify(chunk).replace(/\n/g, '\\n');
      controller.enqueue(new TextEncoder().encode(`data: ${line}\n\n`));
    },
  });
}

/** Simulate a streaming response with text content only */
export function createTextStream(chunks: string[]): ReadableStream<Uint8Array> {
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= chunks.length) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }

      const content = chunks[index++];
      const chunk = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'test-model',
        choices: [
          {
            index: 0,
            delta: { content },
            finish_reason: index >= chunks.length ? 'stop' : null,
          },
        ],
      };

      const line = JSON.stringify(chunk).replace(/\n/g, '\\n');
      controller.enqueue(new TextEncoder().encode(`data: ${line}\n\n`));
    },
  });
}

/** Mock LanguageModelTextPart */
export class MockLanguageModelTextPart {
  constructor(public readonly value: string) {}
}

/** Mock LanguageModelToolCallPart */
export class MockLanguageModelToolCallPart {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: Record<string, unknown>
  ) {}
}

/** Mock LanguageModelToolResultPart */
export class MockLanguageModelToolResultPart {
  constructor(
    public readonly callId: string,
    public readonly content: unknown[]
  ) {}
}

/** Mock LanguageModelDataPart */
export class MockLanguageModelDataPart {
  constructor(
    public readonly mimeType: string,
    public readonly data: Uint8Array
  ) {}
}

/** Create a mock user message */
export function createMockUserMessage(content: string): {
  role: number;
  content: Array<{ value: string }>;
} {
  return {
    role: 2, // LanguageModelChatMessageRole.User = 2
    content: [new MockLanguageModelTextPart(content)],
  } as unknown as { role: number; content: Array<{ value: string }> };
}

/** Create a mock assistant message with tool calls */
export function createMockAssistantMessage(
  content: string,
  toolCalls?: Array<{ callId: string; name: string; input: Record<string, unknown> }>
): { role: number; content: unknown[] } {
  const parts: unknown[] = [];
  if (content) {
    parts.push(new MockLanguageModelTextPart(content));
  }
  for (const tc of toolCalls ?? []) {
    parts.push(new MockLanguageModelToolCallPart(tc.callId, tc.name, tc.input));
  }
  return { role: 1, content: parts } as unknown as { role: number; content: unknown[] };
}

/** Create a mock tool result message */
export function createMockToolResultMessage(callId: string, content: string): { role: number; content: unknown[] } {
  return {
    role: 3,
    content: [new MockLanguageModelToolResultPart(callId, [new MockLanguageModelTextPart(content)])],
  } as unknown as { role: number; content: unknown[] };
}

/** Create a mock tool result message with data */
export function createMockToolResultMessageWithData(callId: string, mimeType: string, data: Uint8Array): { role: number; content: unknown[] } {
  return {
    role: 3,
    content: [new MockLanguageModelToolResultPart(callId, [new MockLanguageModelDataPart(mimeType, data)])],
  } as unknown as { role: number; content: unknown[] };
}

/** Mock VSCode LanguageModelChatMessageRole values */
export const MockRoles = {
  System: 3,
  User: 2,
  Assistant: 1,
  Tool: 4,
} as const;
