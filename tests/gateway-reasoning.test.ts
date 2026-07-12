/**
 * Unit tests for `translatePayloadForUpstream` in src/aiflowbridge/gateway/server.ts
 *
 * The translator is a pure function that converts AIFB-specific body fields
 * (e.g. Kilo Code's `reasoning` checkbox) into the upstream MiniMax API's
 * expected shape (`reasoning_split`). It is called by `forwardChatCompletion`
 * before re-serializing the upstream body.
 *
 * These tests are pure unit tests - no HTTP server, no fetch mocking needed.
 */

import { describe, expect, it, vi } from 'vitest';

// --- VSCode mock (server.ts imports UserPrompt which uses vscode) ---
vi.mock('vscode', () => {
  return {
    default: {
      window: {
        showInformationMessage: vi.fn(),
      },
    },
  };
});

import { translatePayloadForUpstream } from '../src/aiflowbridge/gateway/server';
import type { ProviderProfile } from '../src/aiflowbridge/types';

function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'minimax-m3',
    label: 'MiniMax M3',
    kind: 'openai-compat',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    apiKey: 'sk-test',
    enabled: true,
    ...overrides,
  };
}

describe('translatePayloadForUpstream - MiniMax provider', () => {
  it('translates reasoning: true into reasoning_split: true and strips reasoning', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning: true }, provider);
    expect(result.reasoning_split).toBe(true);
    expect(result).not.toHaveProperty('reasoning');
  });

  it('translates reasoning: false into reasoning_split: false and strips reasoning', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning: false }, provider);
    expect(result.reasoning_split).toBe(false);
    expect(result).not.toHaveProperty('reasoning');
  });

  it('preserves all other payload fields during translation', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream(
      {
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        temperature: 0.7,
        reasoning: true,
      },
      provider
    );
    expect(result.model).toBe('MiniMax-M3');
    expect(result.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(result.stream).toBe(true);
    expect(result.temperature).toBe(0.7);
    expect(result.reasoning_split).toBe(true);
    expect(result).not.toHaveProperty('reasoning');
  });

  it('does not mutate the input payload', () => {
    const provider = makeProvider();
    const input: Record<string, unknown> = {
      model: 'MiniMax-M3',
      messages: [],
      reasoning: true,
    };
    const inputCopy = JSON.parse(JSON.stringify(input));
    translatePayloadForUpstream(input, provider);
    expect(input).toEqual(inputCopy);
  });

  it('passes the payload through unchanged when reasoning is not a boolean', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning: 'true' }, provider);
    expect(result).toEqual({ model: 'MiniMax-M3', messages: [], reasoning: 'true' });
    expect(result).not.toHaveProperty('reasoning_split');
  });

  it('passes the payload through unchanged when reasoning is absent', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [] }, provider);
    expect(result).toEqual({ model: 'MiniMax-M3', messages: [] });
    expect(result).not.toHaveProperty('reasoning_split');
  });

  it('passes the payload through unchanged when reasoning is null', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning: null }, provider);
    expect(result).not.toHaveProperty('reasoning_split');
  });

  it('passes the payload through unchanged when reasoning is a number', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning: 1 }, provider);
    expect(result).not.toHaveProperty('reasoning_split');
  });
});

describe('translatePayloadForUpstream - Kilo Code reasoning_effort dropdown (MiniMax)', () => {
  // Kilo Code's "Reasoning Effort" dropdown in the chat input sends
  // `reasoning_effort: "none" | "high" | "max"` - the DeepSeek-style
  // field. For MiniMax upstreams, the gateway translates it to
  // `reasoning_split` so the dropdown works for MiniMax models too.
  it('translates reasoning_effort: "high" into reasoning_split: true', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning_effort: 'high' }, provider);
    expect(result.reasoning_split).toBe(true);
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('translates reasoning_effort: "max" into reasoning_split: true', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning_effort: 'max' }, provider);
    expect(result.reasoning_split).toBe(true);
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('translates reasoning_effort: "none" into reasoning_split: false', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning_effort: 'none' }, provider);
    expect(result.reasoning_split).toBe(false);
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('unknown reasoning_effort values default to reasoning_split: true (defensive)', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning_effort: 'ultra' }, provider);
    expect(result.reasoning_split).toBe(true);
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('does not mutate the input payload when translating reasoning_effort', () => {
    const provider = makeProvider();
    const input: Record<string, unknown> = {
      model: 'MiniMax-M3',
      messages: [],
      reasoning_effort: 'high',
    };
    const inputCopy = JSON.parse(JSON.stringify(input));
    translatePayloadForUpstream(input, provider);
    expect(input).toEqual(inputCopy);
  });

  it('explicit reasoning: false wins over reasoning_effort: "high" (checkbox overrides dropdown)', () => {
    // A client that sends both signals is using the checkbox as the
    // authoritative override; the dropdown value is just a default.
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning: false, reasoning_effort: 'high' }, provider);
    expect(result.reasoning_split).toBe(false);
    // Both AIFB-specific fields are stripped from the upstream body.
    expect(result).not.toHaveProperty('reasoning');
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('explicit reasoning: true wins over reasoning_effort: "none" (checkbox overrides dropdown)', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning: true, reasoning_effort: 'none' }, provider);
    expect(result.reasoning_split).toBe(true);
    expect(result).not.toHaveProperty('reasoning');
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('strips a pre-existing reasoning_split when reasoning_effort: "none" is supplied', () => {
    // Defensive: if a client sends BOTH reasoning_split and
    // reasoning_effort, the translator must still apply the dropdown
    // value (it is the more recent signal from the chat input).
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'MiniMax-M3', messages: [], reasoning_effort: 'none', reasoning_split: true }, provider);
    expect(result.reasoning_split).toBe(false);
    expect(result).not.toHaveProperty('reasoning_effort');
  });
});

describe('translatePayloadForUpstream - non-MiniMax provider', () => {
  it('passes the payload through unchanged for a DeepSeek provider', () => {
    const provider = makeProvider({
      id: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });
    const result = translatePayloadForUpstream({ model: 'deepseek-v4-flash', messages: [], reasoning: true }, provider);
    // reasoning is NOT translated - DeepSeek uses thinking/reasoning_effort
    expect(result).toEqual({ model: 'deepseek-v4-flash', messages: [], reasoning: true });
    expect(result).not.toHaveProperty('reasoning_split');
  });

  it('passes the payload through unchanged for a Xiaomi provider', () => {
    const provider = makeProvider({
      id: 'xiaomi',
      baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
      model: 'mimo-v2.5',
    });
    const result = translatePayloadForUpstream({ model: 'mimo-v2.5', messages: [], reasoning: true }, provider);
    expect(result).toEqual({ model: 'mimo-v2.5', messages: [], reasoning: true });
    expect(result).not.toHaveProperty('reasoning_split');
  });

  it('detects MiniMax by baseUrl host (minimax.io)', () => {
    const provider = makeProvider({
      id: 'custom-alias',
      baseUrl: 'https://api.minimax.io/v1',
    });
    const result = translatePayloadForUpstream({ model: 'm', messages: [], reasoning: true }, provider);
    expect(result.reasoning_split).toBe(true);
  });

  it('detects MiniMax by baseUrl host (minimaxi.com)', () => {
    const provider = makeProvider({
      id: 'custom-alias',
      baseUrl: 'https://api.minimaxi.com/v1',
    });
    const result = translatePayloadForUpstream({ model: 'm', messages: [], reasoning: true }, provider);
    expect(result.reasoning_split).toBe(true);
  });

  it('detects MiniMax by id prefix (case-insensitive)', () => {
    const provider = makeProvider({
      id: 'MiniMax-custom',
      baseUrl: 'https://other-host.example.com',
    });
    const result = translatePayloadForUpstream({ model: 'm', messages: [], reasoning: true }, provider);
    expect(result.reasoning_split).toBe(true);
  });
});

describe('translatePayloadForUpstream - edge cases', () => {
  it('returns empty object for undefined payload', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream(undefined, provider);
    expect(result).toEqual({});
  });

  it('returns empty object for null payload (defensive)', () => {
    const provider = makeProvider();
    // parseJson returns undefined for null inputs, but we still guard
    // against a null call site for safety.
    const result = translatePayloadForUpstream(null as unknown as Record<string, unknown> | undefined, provider);
    expect(result).toEqual({});
  });

  it('handles an empty payload object', () => {
    const provider = makeProvider();
    const result = translatePayloadForUpstream({}, provider);
    expect(result).toEqual({});
  });

  it('strips reasoning even if reasoning_split is already present (client overrides)', () => {
    // If the client sends BOTH, we trust the AIFB `reasoning` field
    // (the picker value) and override any pre-existing reasoning_split.
    const provider = makeProvider();
    const result = translatePayloadForUpstream({ model: 'm', messages: [], reasoning: false, reasoning_split: true }, provider);
    expect(result.reasoning_split).toBe(false);
    expect(result).not.toHaveProperty('reasoning');
  });
});
