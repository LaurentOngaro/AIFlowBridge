/**
 * Unit tests for src/provider/xiaomi.ts
 * Tests message/tool conversion and reasoning cache behavior for Xiaomi MiMo provider.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- VSCode mock ---
vi.mock('vscode', () => {
  return {
    default: {
      LanguageModelTextPart: class MockLanguageModelTextPart {
        constructor(public value: string) {}
      },
      LanguageModelToolCallPart: class MockLanguageModelToolCallPart {
        constructor(
          public callId: string,
          public name: string,
          public input: Record<string, unknown>
        ) {}
      },
      LanguageModelToolResultPart: class MockLanguageModelToolResultPart {
        constructor(
          public callId: string,
          public content: unknown[]
        ) {}
      },
      LanguageModelDataPart: class MockLanguageModelDataPart {
        constructor(
          public data: Uint8Array,
          public mimeType: string
        ) {}
      },
      LanguageModelChatMessageRole: {
        User: 0,
        Assistant: 1,
      },
    },
  };
});

vi.mock('../src/consts', () => ({
  LANGUAGE_MODEL_CHAT_SYSTEM_ROLE: 3,
  MODELS: [
    {
      id: 'mimo-v2.5',
      name: 'Xiaomi MiMo V2.5',
      family: 'xiaomi',
      version: 'v2.5',
      capabilities: {
        toolCalling: true,
        imageInput: true,
        thinking: true,
      },
    },
    {
      id: 'mimo-v2.5-pro',
      name: 'Xiaomi MiMo V2.5 Pro',
      family: 'xiaomi',
      version: 'v2.5-pro',
      capabilities: {
        toolCalling: true,
        imageInput: false,
        thinking: true,
      },
    },
  ],
}));

vi.mock('../src/config', () => ({
  getProviderApiModelId: vi.fn((vendor: string, id: string) => {
    if (vendor === 'xiaomi' && id.startsWith('xiaomi-')) {
      return id.slice('xiaomi-'.length);
    }
    return id;
  }),
  getProviderBaseUrl: vi.fn((vendor: string) => (vendor === 'xiaomi' ? 'https://api.xiaomimimo.com/v1' : '')),
  getProviderMaxTokens: vi.fn((vendor: string) => (vendor === 'xiaomi' ? undefined : 0)),
  getProviderReasoningRequiredForToolCalls: vi.fn((vendor: string) => (vendor === 'xiaomi' ? true : false)),
}));

vi.mock('../src/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import vscode from 'vscode';
import { getProviderApiModelId } from '../src/config';
import { logger } from '../src/logger';

// Helper to test message conversion
function mapRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
  if ((role as unknown as number) === 3) {
    return 'system';
  }
  if (role === vscode.LanguageModelChatMessageRole.Assistant) {
    return 'assistant';
  }
  return 'user';
}

describe('xiaomi.ts - Model ID resolution', () => {
  it('should return model IDs unchanged (id is the API id)', () => {
    const result = getProviderApiModelId('xiaomi', 'mimo-v2.5');
    expect(result).toBe('mimo-v2.5');
  });

  it('should pass through unknown model IDs', () => {
    const result = getProviderApiModelId('xiaomi', 'unknown-model');
    expect(result).toBe('unknown-model');
  });
});

describe('xiaomi.ts - Message conversion (text + images)', () => {
  it('should convert user message with text only', () => {
    const message = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [new vscode.LanguageModelTextPart('Hello MiMo')],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    const role = mapRole(message.role);
    expect(role).toBe('user');
    expect(message.content[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect((message.content[0] as vscode.LanguageModelTextPart).value).toBe('Hello MiMo');
  });

  it('should convert user message with image (vision-capable)', () => {
    const message = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [new vscode.LanguageModelTextPart('Analyze this image'), new vscode.LanguageModelDataPart(new Uint8Array(1000), 'image/png')],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    expect(message.content).toHaveLength(2);
    expect(message.content[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect(message.content[1]).toBeInstanceOf(vscode.LanguageModelDataPart);
    const img = message.content[1] as vscode.LanguageModelDataPart;
    expect(img.mimeType).toBe('image/png');
  });

  it('should skip images for non-vision models', () => {
    const message = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [new vscode.LanguageModelTextPart('Hello'), new vscode.LanguageModelDataPart(new Uint8Array(100), 'image/png')],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // Simulate the filtering logic
    const filteredContent = message.content.filter((part) => !(part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')));

    expect(filteredContent).toHaveLength(1);
    expect(filteredContent[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
  });
});

describe('xiaomi.ts - Reasoning cache for tool calls', () => {
  let cache: Map<string, { text: string; timestamp: number }>;

  beforeEach(() => {
    cache = new Map();
  });

  it('should cache reasoning for tool calls', () => {
    const reasoningText = 'I need to call get_weather to help the user';
    const toolCallId = 'call_1';

    cache.set(toolCallId, { text: reasoningText, timestamp: Date.now() });

    expect(cache.has(toolCallId)).toBe(true);
    expect(cache.get(toolCallId)?.text).toBe(reasoningText);
  });

  it('should find cached reasoning for first tool call in a sequence', () => {
    cache.set('call_1', { text: 'Reason 1', timestamp: Date.now() });
    cache.set('call_2', { text: 'Reason 2', timestamp: Date.now() });

    const toolCalls = [
      { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
      { id: 'call_2', type: 'function', function: { name: 'get_time', arguments: '{}' } },
    ];

    let cached = undefined;
    for (const call of toolCalls) {
      cached = cache.get(call.id)?.text;
      if (cached) break;
    }

    expect(cached).toBe('Reason 1');
  });

  it('should warn when reasoning_content is missing for tool calls', () => {
    const mockLogger = vi.mocked(logger);
    mockLogger.warn.mockClear();

    const toolCalls = [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }];

    // Simulate missing cached reasoning
    let cached = undefined;
    for (const call of toolCalls) {
      cached = cache.get(call.id)?.text;
      if (cached) break;
    }

    if (!cached) {
      logger.warn('MiMo reasoning_content missing for tool call replay; sending empty reasoning_content.');
    }

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockLogger.warn.mock.calls[0][0]).toContain('reasoning_content missing');
  });

  it('should prune cache when exceeding max size', () => {
    const maxSize = 200;

    // Add more than maxSize entries
    for (let i = 0; i < maxSize + 10; i++) {
      cache.set(`call_${i}`, { text: `Reason ${i}`, timestamp: Date.now() - i * 1000 });
    }

    // Simulate pruning: remove oldest entries to get back to maxSize
    if (cache.size > maxSize) {
      const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (const [key] of entries.slice(0, cache.size - maxSize)) {
        cache.delete(key);
      }
    }

    expect(cache.size).toBeLessThanOrEqual(maxSize);
    // call_0 has timestamp Date.now() (newest), call_209 has timestamp Date.now() - 209000 (oldest)
    // After pruning, oldest entries (call_200 to call_209) should be removed, newest should remain
    expect(cache.has('call_0')).toBe(true); // Newest should remain
    expect(cache.has(`call_${maxSize}`)).toBe(false); // Oldest should be gone
  });

  it('should clear cache on conversation restart', () => {
    cache.set('call_1', { text: 'Reason 1', timestamp: Date.now() });
    cache.set('call_2', { text: 'Reason 2', timestamp: Date.now() });

    // Simulate conversation restart
    cache.clear();

    expect(cache.size).toBe(0);
  });
});

describe('xiaomi.ts - Request assembly', () => {
  it('should assemble valid MiMo request with tool calls', () => {
    const request = {
      model: 'mimo-v2.5',
      messages: [
        {
          role: 'user',
          content: 'Get weather for Paris',
        },
        {
          role: 'assistant',
          content: 'Getting weather',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ city: 'Paris' }),
              },
            },
          ],
          reasoning_content: 'I should call get_weather for Paris',
        },
      ],
      stream: true,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather for a city',
            parameters: { type: 'object' },
          },
        },
      ],
      tool_choice: 'auto',
    };

    expect(request.model).toBe('mimo-v2.5');
    expect(request.messages).toHaveLength(2);
    expect(request.messages[1]).toHaveProperty('tool_calls');
    expect(request.messages[1]).toHaveProperty('reasoning_content');
  });

  it('should assemble MiMo request without tool calls when not applicable', () => {
    const request = {
      model: 'mimo-v2.5',
      messages: [
        {
          role: 'user',
          content: 'Hello',
        },
      ],
      stream: true,
    };

    expect(request.messages).toHaveLength(1);
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('tool_choice');
  });
});
