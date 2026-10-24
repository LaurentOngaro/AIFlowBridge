/**
 * Unit tests for src/provider/minimax.ts
 * Tests tool call handling, message conversion, streaming, and helper functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- VScode mock ---
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
        constructor(
          public mimeType: string,
          public data: Uint8Array
        ) {}
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
    },
  };
});

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking
import vscode from 'vscode';
import {
  resolveMiniMaxModelId,
  parseToolArguments,
  accumulateToolCalls,
  isToolCallFinish,
  convertMiniMaxTools,
  convertMiniMaxMessages,
  concatToolResultContent,
  safeJson,
  resolveMiniMaxReasoning,
} from '../src/provider/minimax';
import type { RegistryModelDefinition } from '../src/aiflowbridge/modelRegistry.schema';
import type { ModelConfigurationOptions } from '../src/provider/models';

import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../src/consts';

// Helper functions to create mock messages
function createUserMessage(content: string) {
  return {
    role: 2 as const, // User
    content: [new vscode.LanguageModelTextPart(content)],
  };
}

function createAssistantMessage(content: string, toolCalls?: { callId: string; name: string; input: Record<string, unknown> }[]) {
  const parts: vscode.LanguageModelTextPart[] = [];
  if (content) {
    parts.push(new vscode.LanguageModelTextPart(content));
  }
  for (const tc of toolCalls ?? []) {
    parts.push(new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input) as unknown as vscode.LanguageModelTextPart);
  }
  return { role: 1 as const, content: parts };
}

function createToolResultMessage(callId: string, content: string) {
  return {
    role: 4 as const, // Tool
    content: [new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart(content)])],
  };
}

function createSystemMessage(content: string) {
  return {
    role: LANGUAGE_MODEL_CHAT_SYSTEM_ROLE,
    content: [new vscode.LanguageModelTextPart(content)],
  };
}

describe('minimax.ts - resolveMiniMaxModelId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceConfig.get.mockReturnValue({});
  });

  it('should return MiniMax-M3 unchanged (id is the API id)', () => {
    const result = resolveMiniMaxModelId('MiniMax-M3');
    expect(result).toBe('MiniMax-M3');
  });

  it('should return original if no override and not a known model', () => {
    const result = resolveMiniMaxModelId('some-other-model');
    expect(result).toBe('some-other-model');
  });

  it('should return override if modelIdOverrides is set', () => {
    mockWorkspaceConfig.get.mockReturnValue({
      'MiniMax-M3': 'MiniMax-Custom-Model',
    });

    const result = resolveMiniMaxModelId('MiniMax-M3');
    expect(result).toBe('MiniMax-Custom-Model');
  });
});

describe('minimax.ts - parseToolArguments', () => {
  it('should parse valid JSON object', () => {
    const result = parseToolArguments('{"name": "test", "value": 123}');
    expect(result).toEqual({ name: 'test', value: 123 });
  });

  it('should return empty object for empty string', () => {
    const result = parseToolArguments('');
    expect(result).toEqual({});
  });

  it('should return empty object for whitespace only', () => {
    const result = parseToolArguments('   ');
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

describe('minimax.ts - accumulateToolCalls', () => {
  it('should accumulate tool calls by index', () => {
    const pending = new Map();

    accumulateToolCalls(
      [
        { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city": ' } },
        { index: 1, id: 'call_2', function: { name: 'get_time', arguments: '{}' } },
      ],
      pending
    );

    expect(pending.size).toBe(2);
    expect(pending.get(0)?.id).toBe('call_1');
    expect(pending.get(0)?.name).toBe('get_weather');
    expect(pending.get(0)?.arguments).toBe('{"city": ');
  });

  it('should merge arguments across multiple chunks', () => {
    const pending = new Map();

    accumulateToolCalls([{ index: 0, function: { arguments: '{"city": "Paris", ' } }], pending);
    accumulateToolCalls([{ index: 0, function: { arguments: '"unit": "C"}' } }], pending);

    expect(pending.get(0)?.arguments).toBe('{"city": "Paris", "unit": "C"}');
  });

  it('should ignore non-array input', () => {
    const pending = new Map();

    accumulateToolCalls('not an array' as unknown as unknown[], pending);
    accumulateToolCalls(null as unknown as unknown[], pending);

    expect(pending.size).toBe(0);
  });
});

describe('minimax.ts - isToolCallFinish', () => {
  it('should return true for tool_calls finish reason', () => {
    expect(isToolCallFinish('tool_calls')).toBe(true);
  });

  it('should return true for function_call finish reason', () => {
    expect(isToolCallFinish('function_call')).toBe(true);
  });

  it('should return false for stop finish reason', () => {
    expect(isToolCallFinish('stop')).toBe(false);
  });
});

describe('minimax.ts - convertMiniMaxTools', () => {
  it('should return undefined for empty tools array', () => {
    const result = convertMiniMaxTools([]);
    expect(result).toBeUndefined();
  });

  it('should return undefined for undefined tools', () => {
    const result = convertMiniMaxTools(undefined);
    expect(result).toBeUndefined();
  });

  it('should convert tools to MiniMax format', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get weather for a city',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    ] as unknown as readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];

    const result = convertMiniMaxTools(tools);

    expect(result).toEqual([
      {
        type: 'function' as const,
        function: {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
  });
});

describe('minimax.ts - concatToolResultContent', () => {
  it('should concatenate text parts', () => {
    const parts = [new vscode.LanguageModelTextPart('Hello '), new vscode.LanguageModelTextPart('World')];

    const result = concatToolResultContent(parts as unknown as readonly unknown[]);
    expect(result).toBe('Hello World');
  });

  it('should return "{}" for empty content', () => {
    const parts: unknown[] = [];
    const result = concatToolResultContent(parts as unknown as readonly unknown[]);
    expect(result).toBe('{}');
  });
});

describe('minimax.ts - safeJson', () => {
  it('should stringify objects', () => {
    expect(safeJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it('should return string for non-stringifiable values', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const result = safeJson(cyclic);
    expect(result).toBe('[object Object]');
  });

  it('should return string representation for primitives', () => {
    expect(safeJson(42)).toBe('42');
    expect(safeJson(true)).toBe('true');
    expect(safeJson(null)).toBe('null');
    expect(safeJson(undefined)).toBeUndefined(); // JSON.stringify(undefined) returns undefined
  });
});

describe('minimax.ts - convertMiniMaxMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert user message', () => {
    const messages = [createUserMessage('Hello')];
    const result = convertMiniMaxMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[]);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should convert assistant message with content', () => {
    const messages = [createAssistantMessage('Hello there')];
    const result = convertMiniMaxMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[]);
    expect(result).toEqual([{ role: 'assistant', content: 'Hello there' }]);
  });

  it('should convert tool result messages', () => {
    const messages = [
      createUserMessage('What is the weather?'),
      createAssistantMessage('', [{ callId: 'call_1', name: 'get_weather', input: {} }]),
      createToolResultMessage('call_1', 'Sunny, 25°C'),
    ];

    const result = convertMiniMaxMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[]);
    const toolResult = result.find((m) => m.role === 'tool');
    expect(toolResult?.content).toBe('Sunny, 25°C');
  });

  it('should skip empty assistant messages', () => {
    const messages = [createAssistantMessage('')];
    const result = convertMiniMaxMessages(messages as unknown as readonly vscode.LanguageModelChatRequestMessage[]);
    expect(result).toHaveLength(0);
  });
});

describe('minimax.ts - streaming tool call flow', () => {
  it('should accumulate and emit tool calls correctly', () => {
    const pending = new Map<number, { index: number; id?: string; name?: string; arguments: string }>();

    accumulateToolCalls([{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"city": ' } }], pending);
    expect(pending.get(0)?.arguments).toBe('{"city": ');

    accumulateToolCalls([{ index: 0, function: { arguments: '"Paris"}' } }], pending);
    expect(pending.get(0)?.arguments).toBe('{"city": "Paris"}');

    expect(isToolCallFinish('tool_calls')).toBe(true);
  });
});

describe('minimax.ts - resolveMiniMaxReasoning', () => {
  const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

  /** `toolMode` is required by the stable VS Code options type but unused here. */
  function options(config: Record<string, unknown> = {}): ModelConfigurationOptions {
    return { modelConfiguration: config, toolMode: 1 } as unknown as ModelConfigurationOptions;
  }

  function entry(overrides: Partial<RegistryModelDefinition> = {}) {
    return {
      capabilities: { toolCalling: true, imageInput: true, thinking: true },
      requiresThinkingParam: false,
      ...overrides,
    } as Pick<RegistryModelDefinition, 'capabilities' | 'requiresThinkingParam' | 'reasoningEffortLevels'>;
  }

  it('forwards the picked level verbatim for a model that declares a range, with reasoning_split pinned on', () => {
    for (const level of EFFORT_LEVELS) {
      const result = resolveMiniMaxReasoning(
        entry({ requiresThinkingParam: true, reasoningEffortLevels: EFFORT_LEVELS }),
        options({ reasoningEffort: level }),
        undefined,
        undefined
      );
      expect(result.reasoningEffort).toBe(level);
      expect(result.reasoningSplit).toBe(true);
      expect(result.warnForcedThinking).toBe(false);
    }
  });

  it('defaults to the highest declared level when the picker sent nothing', () => {
    const result = resolveMiniMaxReasoning(entry({ reasoningEffortLevels: EFFORT_LEVELS }), options(), undefined, undefined);
    expect(result.reasoningEffort).toBe('max');
  });

  it('honours the reasoningEffort setting when the picker is untouched', () => {
    const result = resolveMiniMaxReasoning(entry({ reasoningEffortLevels: EFFORT_LEVELS }), options(), undefined, 'low');
    expect(result.reasoningEffort).toBe('low');
  });

  it('lets the picker win over the setting', () => {
    const result = resolveMiniMaxReasoning(entry({ reasoningEffortLevels: EFFORT_LEVELS }), options({ reasoningEffort: 'xhigh' }), undefined, 'low');
    expect(result.reasoningEffort).toBe('xhigh');
  });

  it('ignores a level the model does not declare and falls back to the setting', () => {
    const result = resolveMiniMaxReasoning(entry({ reasoningEffortLevels: EFFORT_LEVELS }), options({ reasoningEffort: 'ultra' }), undefined, 'medium');
    expect(result.reasoningEffort).toBe('medium');
  });

  it('sends no reasoning_effort at all for a model without a declared range', () => {
    const result = resolveMiniMaxReasoning(entry(), options({ reasoningEffort: 'low' }), true, 'low');
    expect(result.reasoningEffort).toBeUndefined();
    expect(result.reasoningSplit).toBe(true);
  });

it('maps the picker to reasoning_split for a model without a declared range', () => {
    expect(resolveMiniMaxReasoning(entry(), options({ reasoningEffort: 'none' }), true, undefined).reasoningSplit).toBe(false);
    expect(resolveMiniMaxReasoning(entry(), options({ reasoningEffort: 'max' }), true, undefined).reasoningSplit).toBe(true);
    expect(resolveMiniMaxReasoning(entry(), options(), true, undefined).reasoningSplit).toBe(true);
  });

  it('ignores the reasoningSplit setting on a thinking-capable model, where the picker decides', () => {
    // Historical behaviour: a thinking-capable model without a declared
    // level range is driven by the picker, whose untouched value is
    // `high`, so `reasoningSplit: false` has no effect on it.
    expect(resolveMiniMaxReasoning(entry(), options(), false, undefined).reasoningSplit).toBe(true);
  });

  it('falls back to the reasoningSplit setting for a non-thinking model', () => {
    const notThinking = entry({ capabilities: { toolCalling: true, imageInput: true, thinking: false } });
    expect(resolveMiniMaxReasoning(notThinking, options({ reasoningEffort: 'none' }), true, undefined).reasoningSplit).toBe(true);
    expect(resolveMiniMaxReasoning(notThinking, options(), false, undefined).reasoningSplit).toBe(false);
  });

  it('forces reasoning on and asks for a log line when a model cannot disable reasoning', () => {
    const result = resolveMiniMaxReasoning(entry({ requiresThinkingParam: true }), options({ reasoningEffort: 'none' }), true, undefined);
    expect(result.reasoningSplit).toBe(true);
    expect(result.warnForcedThinking).toBe(true);
    expect(result.forcedFrom).toBe('none');
  });

  it('does not warn when the caller already asked for reasoning', () => {
    const result = resolveMiniMaxReasoning(entry({ requiresThinkingParam: true }), options({ reasoningEffort: 'max' }), true, undefined);
    expect(result.warnForcedThinking).toBe(false);
  });

  it('treats a model missing from the registry as non-thinking', () => {
    expect(resolveMiniMaxReasoning(undefined, options(), true, 'low')).toEqual({ reasoningSplit: true, warnForcedThinking: false });
  });
});
