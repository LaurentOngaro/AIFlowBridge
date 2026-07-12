/**
 * Unit tests for src/provider/errors.ts
 * Tests shared error handling for non-DeepSeek providers.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  default: {
    workspace: { getConfiguration: vi.fn(() => ({})) },
  },
}));

import { ProviderRequestError, createHttpProviderError, normalizeProviderError } from '../src/provider/errors';

describe('errors.ts - ProviderRequestError', () => {
  it('should create error with all fields', () => {
    const error = new ProviderRequestError({
      message: 'Test error',
      userSummary: 'User message',
      kind: 'http',
      diagnosticMessage: 'Diagnostic details',
      baseUrl: 'https://api.example.com',
      status: 429,
      provider: 'MiniMax',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error.name).toBe('ProviderRequestError');
    expect(error.message).toBe('Test error');
    expect(error.userSummary).toBe('User message');
    expect(error.kind).toBe('http');
    expect(error.diagnosticMessage).toBe('Diagnostic details');
    expect(error.baseUrl).toBe('https://api.example.com');
    expect(error.status).toBe(429);
    expect(error.provider).toBe('MiniMax');
  });

  it('should default userSummary to message', () => {
    const error = new ProviderRequestError({
      message: 'Original message',
      kind: 'network',
      provider: 'Xiaomi',
    });

    expect(error.userSummary).toBe('Original message');
  });

  it('should default diagnosticMessage to message', () => {
    const error = new ProviderRequestError({
      message: 'Original message',
      kind: 'network',
      provider: 'Xiaomi',
    });

    expect(error.diagnosticMessage).toBe('Original message');
  });

  it('should accept cause option', () => {
    const cause = new Error('root cause');
    const error = new ProviderRequestError({
      message: 'Wrapped error',
      kind: 'network',
      provider: 'MiniMax',
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe('errors.ts - createHttpProviderError', () => {
  function mockResponse(status: number, statusText = 'Error'): Response {
    return {
      ok: false,
      status,
      statusText,
    } as unknown as Response;
  }

  it('should create error for 401 status', () => {
    const error = createHttpProviderError(mockResponse(401), 'https://api.example.com', 'MiniMax');
    expect(error.kind).toBe('http');
    expect(error.status).toBe(401);
    expect(error.provider).toBe('MiniMax');
    expect(error.userSummary).toContain('Authentication failed');
    expect(error.userSummary).toContain('401');
  });

  it('should create error for 429 status', () => {
    const error = createHttpProviderError(mockResponse(429), 'https://api.example.com', 'Xiaomi');
    expect(error.kind).toBe('http');
    expect(error.status).toBe(429);
    expect(error.userSummary).toContain('Rate limited');
  });

  it('should create error for 500 status', () => {
    const error = createHttpProviderError(mockResponse(500), 'https://api.example.com', 'MiniMax');
    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.userSummary).toContain('Server error');
  });

  it('should create error for 402 status', () => {
    const error = createHttpProviderError(mockResponse(402), 'https://api.example.com', 'Xiaomi');
    expect(error.userSummary).toContain('Payment required');
  });

  it('should create error for 503 status', () => {
    const error = createHttpProviderError(mockResponse(503), 'https://api.example.com', 'MiniMax');
    expect(error.userSummary).toContain('Service unavailable');
  });

  it('should create error for unknown status', () => {
    const error = createHttpProviderError(mockResponse(418), 'https://api.example.com', 'Xiaomi');
    expect(error.userSummary).toContain('HTTP error 418');
  });
});

describe('errors.ts - normalizeProviderError', () => {
  it('should pass through ProviderRequestError unchanged', () => {
    const original = new ProviderRequestError({
      message: 'Original',
      kind: 'http',
      provider: 'MiniMax',
    });

    const result = normalizeProviderError(original, 'MiniMax');
    expect(result).toBe(original);
  });

  it('should wrap Error with 401 in auth kind', () => {
    const original = new Error('Request failed with status 401');
    const result = normalizeProviderError(original, 'Xiaomi');
    expect(result).toBeInstanceOf(ProviderRequestError);
    expect(result.kind).toBe('auth');
    expect(result.userSummary).toContain('Xiaomi');
    expect(result.userSummary).toContain('API key');
  });

  it('should wrap Error with "unauthorized" in auth kind', () => {
    const original = new Error('Unauthorized access');
    const result = normalizeProviderError(original, 'MiniMax');
    expect(result).toBeInstanceOf(ProviderRequestError);
    expect(result.kind).toBe('auth');
  });

  it('should wrap generic Error in unknown kind', () => {
    const original = new Error('Something broke');
    const result = normalizeProviderError(original, 'Xiaomi');
    expect(result).toBeInstanceOf(ProviderRequestError);
    expect(result.kind).toBe('unknown');
    expect(result.message).toBe('Something broke');
  });

  it('should wrap non-Error values', () => {
    const result = normalizeProviderError('string error', 'MiniMax');
    expect(result).toBeInstanceOf(ProviderRequestError);
    expect(result.kind).toBe('unknown');
    expect(result.message).toContain('non-Error');
  });

  it('should wrap null', () => {
    const result = normalizeProviderError(null, 'Xiaomi');
    expect(result).toBeInstanceOf(ProviderRequestError);
    expect(result.kind).toBe('unknown');
  });

  it('should wrap undefined', () => {
    const result = normalizeProviderError(undefined, 'MiniMax');
    expect(result).toBeInstanceOf(ProviderRequestError);
    expect(result.kind).toBe('unknown');
  });
});
