/**
 * Unit tests for src/provider/convert.ts
 * Tests message conversion, tool conversion, and character counting.
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

// Mock safeStringify
vi.mock('../src/json', () => ({
  safeStringify: (v: unknown) => JSON.stringify(v),
}));

// Mock parseFirstReplayMarker
vi.mock('../src/provider/replay', () => ({
  parseFirstReplayMarker: () => null,
  REPLAY_MARKER_MIME: 'application/vnd.deepseek.replay-marker',
}));

// Import after mocking - vscode mock is defined above via vi.mock
import vscode from 'vscode';
import { convertMessages, convertTools, countMessageChars } from '../src/provider/convert';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../src/consts';

function textPart(value: string) {
  return new vscode.LanguageModelTextPart(value);
}

function toolCallPart(callId: string, name: string, input: Record<string, unknown>) {
  return new vscode.LanguageModelToolCallPart(callId, name, input);
}

function toolResultPart(callId: string, content: string) {
  return new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart(content)]);
}

describe('convert.ts - convertMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert user message', () => {
    const messages = [{ role: 2, content: [textPart('Hello')] }] as unknown as vscode.LanguageModelChatRequestMessage[];
    const result = convertMessages(messages, false);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should convert assistant message', () => {
    const messages = [{ role: 1, content: [textPart('Hi there')] }] as unknown as vscode.LanguageModelChatRequestMessage[];
    const result = convertMessages(messages, false);
    expect(result).toEqual([{ role: 'assistant', content: 'Hi there' }]);
  });

  it('should convert tool calls', () => {
    const messages = [
      {
        role: 1,
        content: [toolCallPart('call_1', 'get_weather', { city: 'Paris' })],
      },
    ] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = convertMessages(messages, false);
    expect(result[0]).toMatchObject({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather' },
        },
      ],
    });
  });

  it('should convert tool results', () => {
    const messages = [
      {
        role: 4,
        content: [toolResultPart('call_1', 'Sunny')],
      },
    ] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = convertMessages(messages, false);
    expect(result).toEqual([
      {
        role: 'tool',
        content: 'Sunny',
        tool_call_id: 'call_1',
      },
    ]);
  });

  it('should skip empty assistant messages', () => {
    const messages = [{ role: 1, content: [] }] as unknown as vscode.LanguageModelChatRequestMessage[];
    const result = convertMessages(messages, false);
    expect(result).toHaveLength(0);
  });

  it('should handle system messages as user', () => {
    const messages = [
      {
        role: LANGUAGE_MODEL_CHAT_SYSTEM_ROLE,
        content: [textPart('You are helpful')],
      },
    ] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = convertMessages(messages, false);
    expect(result).toEqual([{ role: 'user', content: 'You are helpful' }]);
  });
});

describe('convert.ts - convertTools', () => {
  it('should return undefined for empty tools', () => {
    expect(convertTools([])).toBeUndefined();
  });

  it('should return undefined for undefined tools', () => {
    expect(convertTools(undefined)).toBeUndefined();
  });

  it('should convert tools to DeepSeek format', () => {
    const tools = [
      {
        name: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ] as unknown as readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];

    const result = convertTools(tools);
    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
  });
});

describe('convert.ts - countMessageChars', () => {
  it('should count content length', () => {
    const messages = [{ role: 'user' as const, content: 'Hello World' }];
    expect(countMessageChars(messages)).toBe(11);
  });

  it('should count reasoning_content length', () => {
    const messages = [{ role: 'assistant' as const, content: 'Answer', reasoning_content: 'Thinking...' }];
    expect(countMessageChars(messages)).toBe(17); // 'Answer'.length + 'Thinking...'.length
  });

  it('should count tool call name + arguments', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
    ];
    // 'weather'.length (7) + '{"city":"Paris"}'.length (16) = 23
    expect(countMessageChars(messages)).toBe(23);
  });

  it('should sum across multiple messages', () => {
    const messages = [
      { role: 'user' as const, content: 'Hi' }, // 2
      { role: 'assistant' as const, content: 'Hello' }, // 5
    ];
    expect(countMessageChars(messages)).toBe(7);
  });

  it('should handle messages with no content', () => {
    const messages = [{ role: 'user' as const, content: '' }];
    expect(countMessageChars(messages)).toBe(0);
  });
});
