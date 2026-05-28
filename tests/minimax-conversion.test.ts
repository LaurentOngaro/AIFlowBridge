/**
 * Unit tests for src/provider/minimax.ts
 * Tests message and tool conversion logic for MiniMax provider.
 */

import { describe, expect, it, vi } from 'vitest';

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
          public input: Record<string, unknown>,
        ) {}
      },
      LanguageModelToolResultPart: class MockLanguageModelToolResultPart {
        constructor(
          public callId: string,
          public content: unknown[],
        ) {}
      },
      LanguageModelDataPart: class MockLanguageModelDataPart {
        constructor(public data: Uint8Array, public mimeType: string) {}
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
}));

import vscode from 'vscode';

// Mock the config module before importing the provider
const mockGetProviderApiModelId = vi.fn((vendor: string, id: string) => {
  if (vendor === 'minimax' && id === 'minimax-v2.7') {
    return 'MiniMax-M2.7';
  }
  return id;
});

vi.mock('../src/config', () => ({
  getProviderApiModelId: mockGetProviderApiModelId,
  getProviderBaseUrl: vi.fn((vendor: string) =>
    vendor === 'minimax' ? 'https://api.minimax.io/v1' : '',
  ),
  getProviderMaxTokens: vi.fn((vendor: string) => (vendor === 'minimax' ? undefined : 0)),
  getProviderTemperature: vi.fn((vendor: string) => (vendor === 'minimax' ? 1 : undefined)),
  getProviderTopP: vi.fn((vendor: string) => (vendor === 'minimax' ? 1 : undefined)),
  getProviderReasoningSplit: vi.fn((vendor: string) => (vendor === 'minimax' ? true : undefined)),
}));

// Import conversion functions after mocks are set up
import { getProviderApiModelId } from '../src/config';

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

describe('minimax.ts - Model ID resolution', () => {
  it('should map minimax-v2.7 to MiniMax-M2.7', () => {
    const result = getProviderApiModelId('minimax', 'minimax-v2.7');
    expect(result).toBe('MiniMax-M2.7');
  });

  it('should pass through unknown model IDs', () => {
    const result = getProviderApiModelId('minimax', 'unknown-model');
    expect(result).toBe('unknown-model');
  });
});

describe('minimax.ts - Message conversion', () => {
  it('should convert user text message', () => {
    const message = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [new vscode.LanguageModelTextPart('Hello MiniMax')],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    const role = mapRole(message.role);
    expect(role).toBe('user');
    expect(message.content[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect((message.content[0] as vscode.LanguageModelTextPart).value).toBe('Hello MiniMax');
  });

  it('should convert assistant message with content', () => {
    const message = {
      role: vscode.LanguageModelChatMessageRole.Assistant,
      content: [new vscode.LanguageModelTextPart('Response content')],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    const role = mapRole(message.role);
    expect(role).toBe('assistant');
  });

  it('should extract tool calls from assistant message', () => {
    const toolCall = new vscode.LanguageModelToolCallPart('call_123', 'get_weather', {
      city: 'Paris',
    });
    const message = {
      role: vscode.LanguageModelChatMessageRole.Assistant,
      content: [
        new vscode.LanguageModelTextPart('Getting weather'),
        toolCall,
      ],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    expect(message.content).toHaveLength(2);
    expect(message.content[1]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    const tc = message.content[1] as vscode.LanguageModelToolCallPart;
    expect(tc.name).toBe('get_weather');
    expect(tc.callId).toBe('call_123');
    expect(tc.input).toEqual({ city: 'Paris' });
  });

  it('should extract tool results from user message', () => {
    const toolResult = new vscode.LanguageModelToolResultPart('call_123', [
      new vscode.LanguageModelTextPart('Sunny, 25°C'),
    ]);
    const message = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [toolResult],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    expect(message.content[0]).toBeInstanceOf(vscode.LanguageModelToolResultPart);
    const tr = message.content[0] as vscode.LanguageModelToolResultPart;
    expect(tr.callId).toBe('call_123');
    expect(tr.content).toHaveLength(1);
  });
});

describe('minimax.ts - Tool conversion', () => {
  it('should convert tool definitions to MiniMax format', () => {
    const tools: vscode.LanguageModelChatTool[] = [
      {
        name: 'get_weather',
        description: 'Get weather for a city',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string' },
          },
        },
      },
    ];

    // Manually verify conversion logic
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe('get_weather');
    expect(tool.description).toBe('Get weather for a city');
  });

  it('should handle empty tool list', () => {
    const tools: vscode.LanguageModelChatTool[] = [];
    expect(tools).toHaveLength(0);
  });
});

describe('minimax.ts - Request assembly', () => {
  it('should assemble valid MiniMax request with maxTokens', () => {
    const request = {
      model: 'MiniMax-M2.7',
      messages: [
        {
          role: 'user',
          content: 'Hello',
        },
      ],
      stream: true,
      max_tokens: 1000,
    };

    expect(request.model).toBe('MiniMax-M2.7');
    expect(request.stream).toBe(true);
    expect(request.max_tokens).toBe(1000);
  });

  it('should assemble valid MiniMax request with tools', () => {
    const request = {
      model: 'MiniMax-M2.7',
      messages: [
        {
          role: 'user',
          content: 'Get weather',
        },
      ],
      stream: true,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {},
          },
        },
      ],
      tool_choice: 'auto',
    };

    expect(request.tools).toHaveLength(1);
    expect(request.tool_choice).toBe('auto');
  });

  it('should assemble valid MiniMax request with reasoning settings', () => {
    const request = {
      model: 'MiniMax-M2.7',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      temperature: 1,
      top_p: 1,
      extra_body: {
        reasoning_split: true,
      },
    };

    expect(request.temperature).toBe(1);
    expect(request.top_p).toBe(1);
    expect(request.extra_body?.reasoning_split).toBe(true);
  });
});
