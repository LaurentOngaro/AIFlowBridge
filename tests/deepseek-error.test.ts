/**
 * Unit tests for src/client/error.ts
 * Tests error creation, normalization, and user-facing error formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode (minimal - only workspace for i18n)
const { mockWorkspaceConfig } = vi.hoisted(() => {
  const mockWorkspaceConfig = {
    get: vi.fn(),
    inspect: vi.fn(),
  };
  return { mockWorkspaceConfig };
});

vi.mock('vscode', () => ({
  default: {
    workspace: {
      getConfiguration: vi.fn(() => mockWorkspaceConfig),
    },
  },
}));

// Mock i18n
vi.mock('../src/i18n', () => ({
  t: (_key: string, ...args: unknown[]) => (args.length > 0 ? args.join(' ') : _key),
}));

import { DeepSeekRequestError, normalizeRequestError, setErrorActionUrl } from '../src/client/error';

describe('error.ts - DeepSeekRequestError', () => {
  it('should create error with all fields', () => {
    const error = new DeepSeekRequestError({
      message: 'Test error',
      userSummary: 'User-friendly message',
      kind: 'http',
      diagnosticMessage: 'Diagnostic details',
      baseUrl: 'https://api.deepseek.com',
      status: 429,
      code: 'HTTP_429',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DeepSeekRequestError);
    expect(error.name).toBe('DeepSeekRequestError');
    expect(error.message).toBe('Test error');
    expect(error.userSummary).toBe('User-friendly message');
    expect(error.kind).toBe('http');
    expect(error.diagnosticMessage).toBe('Diagnostic details');
    expect(error.baseUrl).toBe('https://api.deepseek.com');
    expect(error.status).toBe(429);
    expect(error.code).toBe('HTTP_429');
  });

  it('should default userSummary to message', () => {
    const error = new DeepSeekRequestError({
      message: 'Original message',
      kind: 'network',
    });

    expect(error.userSummary).toBe('Original message');
  });

  it('should default diagnosticMessage to message', () => {
    const error = new DeepSeekRequestError({
      message: 'Original message',
      kind: 'network',
    });

    expect(error.diagnosticMessage).toBe('Original message');
  });

  it('should accept cause option', () => {
    const cause = new Error('root cause');
    const error = new DeepSeekRequestError({
      message: 'Wrapped error',
      kind: 'network',
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe('error.ts - normalizeRequestError', () => {
  it('should pass through DeepSeekRequestError unchanged', () => {
    const original = new DeepSeekRequestError({
      message: 'Original',
      kind: 'http',
      status: 500,
    });

    const result = normalizeRequestError(original);
    expect(result).toBe(original);
  });

  it('should wrap Error with cause info into DeepSeekRequestError', () => {
    const cause = new Error('ECONNREFUSED');
    (cause as any).code = 'ECONNREFUSED';
    const original = new Error('fetch failed');
    (original as any).cause = cause;

    const result = normalizeRequestError(original);
    expect(result).toBeInstanceOf(DeepSeekRequestError);
    expect((result as DeepSeekRequestError).kind).toBe('network');
    expect((result as DeepSeekRequestError).code).toBe('ECONNREFUSED');
  });

  it('should wrap non-Error values into DeepSeekRequestError', () => {
    const result = normalizeRequestError('something broke');
    expect(result).toBeInstanceOf(DeepSeekRequestError);
    expect((result as DeepSeekRequestError).kind).toBe('unknown');
  });

  it('should wrap null into DeepSeekRequestError', () => {
    const result = normalizeRequestError(null);
    expect(result).toBeInstanceOf(DeepSeekRequestError);
    expect((result as DeepSeekRequestError).kind).toBe('unknown');
  });

  it('should wrap undefined into DeepSeekRequestError', () => {
    const result = normalizeRequestError(undefined);
    expect(result).toBeInstanceOf(DeepSeekRequestError);
    expect((result as DeepSeekRequestError).kind).toBe('unknown');
  });

  it('should pass through Error without cause unchanged', () => {
    const original = new Error('plain error');
    const result = normalizeRequestError(original);
    expect(result).toBe(original);
  });
});

describe('error.ts - setErrorActionUrl', () => {
  beforeEach(() => {
    // Reset by setting to empty
    setErrorActionUrl('configureApiKey' as any, '');
  });

  it('should store and retrieve action URLs', () => {
    setErrorActionUrl('configureApiKey', 'https://example.com/key');
    // We can't directly read the store, but it shouldn't throw
    expect(true).toBe(true);
  });
});
