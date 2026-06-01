/**
 * Unit tests for src/provider/xiaomi.ts
 * Tests tool call handling, reasoning replay, vision messages, and helper functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- VSCode mock ---
const { mockWorkspaceConfig } = vi.hoisted(() => {
  const mockWorkspaceConfig = {
    get: vi.fn(),
    inspect: vi.fn(),
  };

  return { mockWorkspaceConfig };
});

vi.mock('vscode', () => {
  return {
    default: {
      workspace: {
        getConfiguration: vi.fn(() => mockWorkspaceConfig),
      },
      LanguageModelChatMessageRole: {
        User: 2,
        Assistant: 1,
        System: 3,
        Tool: 4,
      },
      LanguageModelTextPart: class MockLanguageModelTextPart {
        constructor(public value: string) {}
      },
      LanguageModelDataPart: class MockLanguageModelDataPart {
        constructor(public mimeType: string, public data: Uint8Array) {}
      },
      LanguageModelToolCallPart: class MockLanguageModelToolCallPart {
        constructor(
          public callId: string,
          public name: string,
          public input: Record<string, unknown>,
        ) {}
      },
      LanguageModelToolResultPart: class MockLanguageModelToolResultPart {
        constructor(
          public callId: string,
          public content: unknown[],
        ) {}
      },
    },
  };
});

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking
import vscode from 'vscode';
import {
  resolveXiaomiModelId,
  parseToolArguments,
  accumulateToolCalls,
  isToolCallFinish,
  convertXiaomiTools,
  convertXiaomiMessages,
  concatToolResultContent,
  safeJson,
  findReasoningForToolCalls,
  pruneReasoningCache,
} from '../src/provider/xiaomi';

import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE, MODELS } from '../src/consts';

// Helper functions to create mock messages
function createUserMessage(content: string, imageData?: Uint8Array, mimeType = 'image/png') {
  const parts: vscode.LanguageModelTextPart[] = [new vscode.LanguageModelTextPart(content)];
  if (imageData) {
    parts.push(new vscode.LanguageModelDataPart(mimeType, imageData) as unknown as vscode.LanguageModelTextPart);
  }
  return { role: 2 as const, content: parts };
}

function createAssistantMessage(
  content: string,
  toolCalls?: { callId: string; name: string; input: Record<string, unknown> }[],
  reasoningContent?: string,
) {
  const parts: vscode.LanguageModelTextPart[] = [];
  if (content) {
    parts.push(new vscode.LanguageModelTextPart(content));
  }
  for (const tc of toolCalls ?? []) {
    parts.push(new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input) as unknown as vscode.LanguageModelTextPart);
  }
  const msg: { role: number; content: vscode.LanguageModelTextPart[]; reasoning_content?: string } = {
    role: 1,
    content: parts,
  };
  if (reasoningContent) {
    msg.reasoning_content = reasoningContent;
  }
  return msg;
}

function createToolResultMessage(callId: string, content: string) {
  return {
    role: 4 as const, // Tool
    content: [new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart(content)])],
  };
}

describe('xiaomi.ts - resolveXiaomiModelId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceConfig.get.mockReturnValue({});
  });

  it('should strip xiaomi- prefix if present', () => {
    const result = resolveXiaomiModelId('xiaomi-mimo-v2.5');
    expect(result).toBe('mimo-v2.5');
  });

  it('should return original if no prefix', () => {
    const result = resolveXiaomiModelId('mimo-v2.5');
    expect(result).toBe('mimo-v2.5');
  });

  it('should return override if modelIdOverrides is set', () => {
    mockWorkspaceConfig.get.mockReturnValue({
      'xiaomi-mimo-v2.5': 'MiMo-V2.5-Custom',
    });

    const result = resolveXiaomiModelId('xiaomi-mimo-v2.5');
    expect(result).toBe('MiMo-V2.5-Custom');
  });
});

describe('xiaomi.ts - parseToolArguments', () => {
  it('should parse valid JSON object', () => {
    const result = parseToolArguments('{"name": "test", "value": 123}');
    expect(result).toEqual({ name: 'test', value: 123 });
  });

  it('should return empty object for empty string', () => {
    const result = parseToolArguments('');
    expect(result).toEqual({});
  });

  it('should return rawArguments for invalid JSON', () => {
    const result = parseToolArguments('not valid json');
    expect(result).toEqual({ rawArguments: 'not valid json' });
  });

  it('should wrap non-object JSON in value property', () => {
    const result = parseToolArguments('"just a string"');
    expect(result).toEqual({ value: 'just a string' });
  });
});

describe('xiaomi.ts - accumulateToolCalls', () => {
  it('should accumulate tool calls by index', () => {
    const pending = new Map();

    accumulateToolCalls(
      [
        { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city": ' } },
        { index: 1, id: 'call_2', function: { name: 'get_time', arguments: '{}' } },
      ],
      pending,
    );

    expect(pending.size).toBe(2);
    expect(pending.get(0)?.id).toBe('call_1');
    expect(pending.get(0)?.arguments).toBe('{"city": ');
  });

  it('should merge arguments across multiple chunks', () => {
    const pending = new Map();

    accumulateToolCalls([{ index: 0, function: { arguments: '{"city": "Tokyo", ' } }], pending);
    accumulateToolCalls([{ index: 0, function: { arguments: '"unit": "C"}' } }], pending);

    expect(pending.get(0)?.arguments).toBe('{"city": "Tokyo", "unit": "C"}');
  });

  it('should ignore non-array input', () => {
    const pending = new Map();

    accumulateToolCalls('not an array' as unknown as unknown[], pending);
    accumulateToolCalls(null as unknown as unknown[], pending);

    expect(pending.size).toBe(0);
  });
});

describe('xiaomi.ts - isToolCallFinish', () => {
  it('should return true for tool_calls', () => {
    expect(isToolCallFinish('tool_calls')).toBe(true);
  });

  it('should return true for function_call', () => {
    expect(isToolCallFinish('function_call')).toBe(true);
  });

  it('should return false for stop', () => {
    expect(isToolCallFinish('stop')).toBe(false);
  });
});

describe('xiaomi.ts - convertXiaomiTools', () => {
  it('should return undefined for empty tools', () => {
    expect(convertXiaomiTools([])).toBeUndefined();
  });

  it('should return undefined for undefined tools', () => {
    expect(convertXiaomiTools(undefined)).toBeUndefined();
  });

  it('should convert tools to Xiaomi format', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ] as unknown as readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];

    const result = convertXiaomiTools(tools);
    expect(result).toEqual([
      {
        type: 'function' as const,
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
  });
});

describe('xiaomi.ts - concatToolResultContent', () => {
  it('should concatenate text parts', () => {
    const parts = [
      new vscode.LanguageModelTextPart('The weather is '),
      new vscode.LanguageModelTextPart('sunny.'),
    ];

    const result = concatToolResultContent(parts as unknown as readonly unknown[]);
    expect(result).toBe('The weather is sunny.');
  });

  it('should return "{}" for empty content', () => {
    const parts: unknown[] = [];
    const result = concatToolResultContent(parts as unknown as readonly unknown[]);
    expect(result).toBe('{}');
  });
});

describe('xiaomi.ts - safeJson', () => {
  it('should stringify objects', () => {
    expect(safeJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });
});

describe('xiaomi.ts - findReasoningForToolCalls', () => {
  it('should find cached reasoning by tool call id', () => {
    const cache = new Map<string, { text: string; timestamp: number }>();
    cache.set('call_1', { text: 'Thinking about weather...', timestamp: Date.now() });

    const toolCalls = [
      { id: 'call_1', type: 'function' as const, function: { name: 'get_weather', arguments: '{}' } },
    ];

    const result = findReasoningForToolCalls(cache, toolCalls);
    expect(result).toBe('Thinking about weather...');
  });

  it('should return undefined if no reasoning cached', () => {
    const cache = new Map<string, { text: string; timestamp: number }>();

    const toolCalls = [
      { id: 'call_1', type: 'function' as const, function: { name: 'get_weather', arguments: '{}' } },
    ];

    const result = findReasoningForToolCalls(cache, toolCalls);
    expect(result).toBeUndefined();
  });
});

describe('xiaomi.ts - pruneReasoningCache', () => {
  it('should clear cache when forceClear is true', () => {
    const cache = new Map<string, { text: string; timestamp: number }>();
    cache.set('call_1', { text: 'test', timestamp: 1000 });
    cache.set('call_2', { text: 'test2', timestamp: 2000 });

    pruneReasoningCache(cache, true);

    expect(cache.size).toBe(0);
  });

  it('should prune oldest entries when cache exceeds max size', () => {
    const cache = new Map<string, { text: string; timestamp: number }>();

    for (let i = 0; i < 250; i++) {
      cache.set(`call_${i}`, { text: `reasoning ${i}`, timestamp: i });
    }

    pruneReasoningCache(cache, false);

    expect(cache.size).toBe(200);
    expect(cache.has('call_0')).toBe(false);
    expect(cache.has('call_249')).toBe(true);
  });

  it('should not prune when cache is under max size', () => {
    const cache = new Map<string, { text: string; timestamp: number }>();

    for (let i = 0; i < 50; i++) {
      cache.set(`call_${i}`, { text: `reasoning ${i}`, timestamp: i });
    }

    pruneReasoningCache(cache, false);

    expect(cache.size).toBe(50);
  });
});

describe('xiaomi.ts - convertXiaomiMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const options = {
    isThinkingModel: false,
    supportsVision: false,
    reasoningCache: new Map<string, { text: string; timestamp: number }>(),
    reasoningReplayRequired: false,
  };

  it('should convert user message with text', () => {
    const messages = [createUserMessage('Hello')];
    const result = convertXiaomiMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[], options);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should NOT include image when vision not supported', () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const messages = [createUserMessage('What is this?', imageData)];

    const result = convertXiaomiMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[], options);
    expect(result).toHaveLength(1);

    const content = result[0].content;
    if (typeof content === 'string') {
      expect(content).toBe('What is this?');
    } else {
      expect(content.some((c: unknown) => (c as { text?: string }).text === 'What is this?')).toBe(true);
      expect(content.some((c: unknown) => (c as { type?: string }).type === 'image_url')).toBe(false);
    }
  });

  it('should convert assistant message with reasoning_content', () => {
    const messages = [
      createAssistantMessage('Final answer', undefined, 'Reasoning process...'),
    ];

    const result = convertXiaomiMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[], options);

    // reasoning_content is NOT copied from input when there are no tool calls
    // It's only set from the reasoning cache for tool call replay
    expect(result[0]).toMatchObject({
      role: 'assistant',
      content: 'Final answer',
    });
    expect(result[0].reasoning_content).toBeUndefined();
  });

  it('should skip assistant messages with no content and no tool calls', () => {
    const messages = [createAssistantMessage('')];
    const result = convertXiaomiMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[], options);
    expect(result).toHaveLength(0);
  });

  it('should handle system messages', () => {
    const messages = [
      {
        role: LANGUAGE_MODEL_CHAT_SYSTEM_ROLE,
        content: [new vscode.LanguageModelTextPart('You are helpful.')],
      },
    ];
    const result = convertXiaomiMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[], options);
    expect(result).toEqual([{ role: 'system', content: 'You are helpful.' }]);
  });
});

describe('xiaomi.ts - Model capabilities', () => {
  it('should have correct capabilities for xiaomi-mimo-v2.5', () => {
    const model = MODELS.find((m) => m.id === 'xiaomi-mimo-v2.5');
    expect(model?.capabilities.thinking).toBe(true);
    expect(model?.capabilities.imageInput).toBe(true);
    expect(model?.capabilities.toolCalling).toBe(true);
    expect(model?.requiresThinkingParam).toBe(false);
  });

  it('should have correct capabilities for xiaomi-mimo-v2.5-pro', () => {
    const model = MODELS.find((m) => m.id === 'xiaomi-mimo-v2.5-pro');
    expect(model?.capabilities.thinking).toBe(true);
    expect(model?.capabilities.imageInput).toBe(true);
    expect(model?.capabilities.toolCalling).toBe(true);
    expect(model?.requiresThinkingParam).toBe(false);
  });
});