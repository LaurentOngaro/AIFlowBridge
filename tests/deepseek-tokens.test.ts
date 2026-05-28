/**
 * Unit tests for src/provider/tokens.ts
 * Tests token estimation for strings and messages.
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
    },
  };
});

// Mock replay marker MIME
vi.mock('../src/provider/replay', () => ({
  REPLAY_MARKER_MIME: 'application/vnd.deepseek.replay-marker',
}));

import vscode from 'vscode';
import { estimateTokenCount } from '../src/provider/tokens';

describe('tokens.ts - estimateTokenCount (string)', () => {
  it('should estimate token count for empty string', () => {
    expect(estimateTokenCount('', 4)).toBe(1); // Math.max(1, ceil(0/4))
  });

  it('should estimate token count for short string', () => {
    expect(estimateTokenCount('Hello', 4)).toBe(2); // ceil(5/4)
  });

  it('should estimate token count for longer string', () => {
    expect(estimateTokenCount('Hello World', 4)).toBe(3); // ceil(11/4)
  });

  it('should handle charsPerToken = 1', () => {
    expect(estimateTokenCount('Hello', 1)).toBe(5);
  });

  it('should handle large strings', () => {
    const longString = 'a'.repeat(10000);
    expect(estimateTokenCount(longString, 4)).toBe(2500);
  });
});

describe('tokens.ts - estimateTokenCount (message)', () => {
  it('should estimate token count for text-only message', () => {
    const message = {
      content: [new vscode.LanguageModelTextPart('Hello World')],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // 11 chars / 4 = 2.75, ceil = 3
    expect(estimateTokenCount(message, 4)).toBe(3);
  });

  it('should estimate token count for tool call message', () => {
    const message = {
      content: [
        new vscode.LanguageModelToolCallPart('call_1', 'get_weather', { city: 'Paris' }),
      ],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // callId (6) + name (11) + JSON input (19) = 36 chars, ceil(36/4) = 9
    const result = estimateTokenCount(message, 4);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('should estimate token count for tool result message', () => {
    const message = {
      content: [
        new vscode.LanguageModelToolResultPart('call_1', [
          new vscode.LanguageModelTextPart('Sunny'),
        ]),
      ],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // callId (6) + 'Sunny' (5) = 11 chars, ceil(11/4) = 3
    expect(estimateTokenCount(message, 4)).toBe(3);
  });

  it('should handle empty content array', () => {
    const message = { content: [] } as unknown as vscode.LanguageModelChatRequestMessage;
    expect(estimateTokenCount(message, 4)).toBe(1); // Math.max(1, ...)
  });

  it('should handle message with no content', () => {
    const message = { content: null } as unknown as vscode.LanguageModelChatRequestMessage;
    expect(estimateTokenCount(message, 4)).toBe(1);
  });

  it('should handle image data parts', () => {
    const message = {
      content: [
        new vscode.LanguageModelDataPart(new Uint8Array(100), 'image/png'),
      ],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // Image = 1020 chars, ceil(1020/4) = 255
    expect(estimateTokenCount(message, 4)).toBe(255);
  });

  it('should handle replay marker data parts as 0 chars', () => {
    const message = {
      content: [
        new vscode.LanguageModelDataPart(new Uint8Array(100), 'application/vnd.deepseek.replay-marker'),
      ],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // Replay marker = 0 chars, ceil(0/4) = 0, Math.max(1, 0) = 1
    expect(estimateTokenCount(message, 4)).toBe(1);
  });

  it('should handle PDF data parts with capped heuristic', () => {
    const message = {
      content: [
        new vscode.LanguageModelDataPart(new Uint8Array(50000), 'application/pdf'),
      ],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // PDF = min(50000, 10000) = 10000 chars, ceil(10000/4) = 2500
    expect(estimateTokenCount(message, 4)).toBe(2500);
  });

  it('should sum multiple parts', () => {
    const message = {
      content: [
        new vscode.LanguageModelTextPart('Hello'),    // 5 chars
        new vscode.LanguageModelTextPart('World'),    // 5 chars
      ],
    } as unknown as vscode.LanguageModelChatRequestMessage;

    // 10 chars / 4 = 2.5, ceil = 3
    expect(estimateTokenCount(message, 4)).toBe(3);
  });
});
