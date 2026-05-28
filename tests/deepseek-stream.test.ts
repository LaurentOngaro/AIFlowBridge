/**
 * Unit tests for src/provider/stream.ts
 * Tests updateCharsPerToken EMA calibration.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock vscode - required because stream.ts imports vscode
vi.mock('vscode', () => {
  return {
    default: {
      workspace: {
        getConfiguration: vi.fn(() => ({})),
      },
    },
  };
});

// Mock dependencies of stream.ts
vi.mock('../src/json', () => ({
  safeStringify: (v: unknown) => JSON.stringify(v),
}));

vi.mock('../src/provider/replay', () => ({
  parseFirstReplayMarker: () => null,
  REPLAY_MARKER_MIME: 'application/vnd.deepseek.replay-marker',
}));

vi.mock('../src/provider/debug/diagnostics', () => ({
  createCacheDiagnosticsRecorder: () => ({
    onDone: vi.fn(),
  }),
}));

import { updateCharsPerToken } from '../src/provider/stream';

describe('stream.ts - updateCharsPerToken', () => {
  it('should return current ratio when totalRequestChars is 0', () => {
    const result = updateCharsPerToken(0, { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, 4.0);
    expect(result).toBe(4.0);
  });

  it('should return current ratio when prompt_tokens is 0', () => {
    const result = updateCharsPerToken(1000, { prompt_tokens: 0, completion_tokens: 50, total_tokens: 50 }, 4.0);
    expect(result).toBe(4.0);
  });

  it('should apply EMA when both values are positive', () => {
    // 4000 chars / 1000 tokens = 4.0 observed ratio
    // EMA: 4.0 * 0.7 + 4.0 * 0.3 = 4.0
    const result = updateCharsPerToken(4000, { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }, 4.0);
    expect(result).toBeCloseTo(4.0);
  });

  it('should shift ratio toward observed value', () => {
    // 10000 chars / 1000 tokens = 10.0 observed ratio
    // EMA: 4.0 * 0.7 + 10.0 * 0.3 = 2.8 + 3.0 = 5.8
    const result = updateCharsPerToken(10000, { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }, 4.0);
    expect(result).toBeCloseTo(5.8);
  });

  it('should handle small observed ratios', () => {
    // 500 chars / 1000 tokens = 0.5 observed ratio
    // EMA: 4.0 * 0.7 + 0.5 * 0.3 = 2.8 + 0.15 = 2.95
    const result = updateCharsPerToken(500, { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }, 4.0);
    expect(result).toBeCloseTo(2.95);
  });

  it('should handle zero charsPerToken input', () => {
    const result = updateCharsPerToken(4000, { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 }, 0);
    expect(result).toBeCloseTo(1.2); // 0 * 0.7 + 4.0 * 0.3
  });
});
