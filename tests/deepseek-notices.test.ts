/**
 * Unit tests for src/provider/tools/notices.ts
 * Tests tool drift notice creation and provider notice filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- VSCode mock ---
vi.mock('vscode', () => {
  return {
    default: {
      LanguageModelChatMessageRole: {
        User: 2,
        Assistant: 1,
      },
      LanguageModelTextPart: class MockLanguageModelTextPart {
        constructor(public value: string) {}
      },
    },
  };
});

// Mock i18n
vi.mock('../src/i18n', () => ({
  t: (_key: string, ...args: unknown[]) => (args.length > 0 ? args.join(' ') : _key),
}));

// Mock consts
vi.mock('../src/provider/tools/consts', () => ({
  TOOL_DRIFT_NOTICE_START: '[deepseek-copilot-tool-drift-notice-start]: #',
  TOOL_DRIFT_NOTICE_END: '[deepseek-copilot-tool-drift-notice-end]: #',
  DEEPSEEK_TOOLS_LIMIT: 128,
}));

import vscode from 'vscode';
import { createToolDriftNotice, filterProviderNotices } from '../src/provider/tools/notices';

describe('notices.ts - createToolDriftNotice', () => {
  it('should return a string containing start and end markers', () => {
    const notice = createToolDriftNotice();
    expect(typeof notice).toBe('string');
    expect(notice).toContain('[deepseek-copilot-tool-drift-notice-start]: #');
    expect(notice).toContain('[deepseek-copilot-tool-drift-notice-end]: #');
  });

  it('should have blockquote formatting', () => {
    const notice = createToolDriftNotice();
    expect(notice).toContain('> ');
  });
});

describe('notices.ts - filterProviderNotices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass through non-assistant messages unchanged', () => {
    const messages = [{ role: 2, content: [new vscode.LanguageModelTextPart('Hello')] }] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = filterProviderNotices(messages);
    expect(result).toBe(messages); // same reference = no change
  });

  it('should pass through assistant messages without notices', () => {
    const messages = [{ role: 1, content: [new vscode.LanguageModelTextPart('Hello there')] }] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = filterProviderNotices(messages);
    expect(result).toBe(messages); // same reference = no change
  });

  it('should strip notices from assistant messages', () => {
    const noticeContent = '[deepseek-copilot-tool-drift-notice-start]: #\nSome notice\n[deepseek-copilot-tool-drift-notice-end]: #';
    const messages = [
      {
        role: 1,
        content: [new vscode.LanguageModelTextPart(`Hello\n\n${noticeContent}\n\nGoodbye`)],
      },
    ] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = filterProviderNotices(messages);
    expect(result).not.toBe(messages); // different reference = changed
    // The notice should be stripped, leaving "Hello" and "Goodbye"
    const textParts = result[0].content as vscode.LanguageModelTextPart[];
    const combinedText = textParts.map((p: any) => p.value).join('');
    expect(combinedText).not.toContain('[deepseek-copilot-tool-drift-notice-start]');
    expect(combinedText).not.toContain('[deepseek-copilot-tool-drift-notice-end]');
  });

  it('should remove assistant message entirely if only notice remains', () => {
    const noticeContent = '[deepseek-copilot-tool-drift-notice-start]: #\nNotice only\n[deepseek-copilot-tool-drift-notice-end]: #';
    const messages = [
      {
        role: 1,
        content: [new vscode.LanguageModelTextPart(noticeContent)],
      },
    ] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = filterProviderNotices(messages);
    expect(result).toHaveLength(0);
  });

  it('should handle messages with no text parts', () => {
    const messages = [{ role: 1, content: [] }] as unknown as vscode.LanguageModelChatRequestMessage[];

    const result = filterProviderNotices(messages);
    expect(result).toBe(messages);
  });
});
