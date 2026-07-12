/**
 * Unit tests for src/provider/debug/classifier.ts
 * Tests request classification and formatting.
 */

import { describe, it, expect, vi } from 'vitest';

// --- VSCode mock ---
vi.mock('vscode', () => {
  return {
    default: {
      workspace: {
        getConfiguration: vi.fn(() => ({})),
      },
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

import vscode from 'vscode';
import { formatModelFields, formatRequestLogLine, classifyProviderRequest, classifyDeepSeekRequest } from '../src/provider/debug/classifier';

function msg(text: string, role: number = 2, name: string = 'test') {
  return {
    role,
    name,
    content: [new vscode.LanguageModelTextPart(text)],
  };
}

describe('classifier.ts - formatModelFields', () => {
  it('should return model= only when no apiModelId', () => {
    expect(formatModelFields('deepseek-v4-pro')).toBe('model=deepseek-v4-pro');
  });

  it('should include apiModel when different from vscodeModelId', () => {
    expect(formatModelFields('deepseek-v4-pro', 'DeepSeek-V4-Pro')).toBe('model=deepseek-v4-pro apiModel=DeepSeek-V4-Pro');
  });

  it('should omit apiModel when same as vscodeModelId', () => {
    expect(formatModelFields('deepseek-v4-pro', 'deepseek-v4-pro')).toBe('model=deepseek-v4-pro');
  });
});

describe('classifier.ts - formatRequestLogLine', () => {
  it('should format with kind prefix', () => {
    expect(formatRequestLogLine('main-agent', 'test message')).toBe('[main-agent] test message');
  });

  it('should format with unknown kind', () => {
    expect(formatRequestLogLine('unknown', 'something')).toBe('[unknown] something');
  });
});

describe('classifier.ts - classifyProviderRequest', () => {
  it('should classify main-agent request', () => {
    const result = classifyProviderRequest({
      messages: [msg('You are an expert AI programming assistant')],
    });
    expect(result).toBe('main-agent');
  });

  it('should classify todo-tracker request', () => {
    const result = classifyProviderRequest({
      messages: [msg('You are a background task tracker')],
    });
    expect(result).toBe('todo-tracker');
  });

  it('should classify todo-tracker by tool name', () => {
    const result = classifyProviderRequest({
      messages: [msg('Hello')],
      tools: [{ name: 'manage_todo_list' } as any],
    });
    expect(result).toBe('todo-tracker');
  });

  it('should classify settings-resolver request', () => {
    const result = classifyProviderRequest({
      messages: [msg('You are a Visual Studio Code assistant. Your job is to assist users in using Visual Studio Code by returning settings')],
    });
    expect(result).toBe('settings-resolver');
  });

  it('should classify terminal-steering request', () => {
    const result = classifyProviderRequest({
      messages: [msg('[Terminal Powershell notification: something happened')],
    });
    expect(result).toBe('terminal-steering');
  });

  it('should classify main-agent with <skills> tag', () => {
    const result = classifyProviderRequest({
      messages: [msg('System prompt with <skills> enabled')],
    });
    expect(result).toBe('main-agent');
  });

  it('should classify main-agent with <agents> tag', () => {
    const result = classifyProviderRequest({
      messages: [msg('System prompt with <agents> enabled')],
    });
    expect(result).toBe('main-agent');
  });

  it('should classify background request with tools', () => {
    const result = classifyProviderRequest({
      messages: [msg('Hello')],
      tools: [{ name: 'some_tool' } as any],
    });
    expect(result).toBe('background');
  });

  it('should classify background request with text', () => {
    const result = classifyProviderRequest({
      messages: [msg('Hello')],
    });
    expect(result).toBe('background');
  });

  it('should classify unknown request', () => {
    const result = classifyProviderRequest({
      messages: [{ role: 2, content: [] } as any],
    });
    expect(result).toBe('unknown');
  });
});

describe('classifier.ts - classifyDeepSeekRequest', () => {
  it('should classify main-agent from DeepSeek request', () => {
    const result = classifyDeepSeekRequest({
      request: {
        messages: [{ role: 'system', content: 'You are an expert AI programming assistant' }],
      } as any,
    });
    expect(result).toBe('main-agent');
  });

  it('should classify todo-tracker from DeepSeek request', () => {
    const result = classifyDeepSeekRequest({
      request: {
        messages: [{ role: 'system', content: 'You are a background task tracker' }],
        tools: [{ function: { name: 'manage_todo_list' } }],
      } as any,
    });
    expect(result).toBe('todo-tracker');
  });

  it('should classify from inputMessages when available', () => {
    const result = classifyDeepSeekRequest({
      request: {
        messages: [{ role: 'user', content: '' }],
      } as any,
      inputMessages: [msg('[Terminal Powershell notification: something')],
    });
    expect(result).toBe('terminal-steering');
  });
});
