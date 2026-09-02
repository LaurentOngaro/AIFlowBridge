import { describe, expect, it } from 'vitest';
import {
  EnvelopeConversionError,
  sanitizeJsonSchema,
  toAntigravityEnvelope,
} from '../src/aiflowbridge/antigravity/envelope';
import type { OpenAiChatRequest } from '../src/aiflowbridge/antigravity/types';

const BASE_OPTIONS = {
  projectId: 'test-project',
  requestId: 'agent-0-test',
  now: 1_700_000_000_000,
} as const;

function makeRequest(overrides: Partial<OpenAiChatRequest> = {}): OpenAiChatRequest {
  return {
    model: 'gemini-test-model',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

describe('antigravity envelope', () => {
  it('maps system to systemInstruction and keeps user content', () => {
    const envelope = toAntigravityEnvelope(
      makeRequest({
        messages: [
          { role: 'system', content: 'You are careful.' },
          { role: 'user', content: 'Hi' },
        ],
      }),
      BASE_OPTIONS,
    );
    expect(envelope.request.systemInstruction).toEqual({
      parts: [{ text: 'You are careful.' }],
    });
    expect(envelope.request.contents).toEqual([{ role: 'user', parts: [{ text: 'Hi' }] }]);
  });

  it('joins multiple system messages with a blank line', () => {
    const envelope = toAntigravityEnvelope(
      makeRequest({
        messages: [
          { role: 'system', content: 'one' },
          { role: 'system', content: 'two' },
          { role: 'user', content: 'q' },
        ],
      }),
      BASE_OPTIONS,
    );
    expect(envelope.request.systemInstruction?.parts[0]?.text).toBe('one\n\ntwo');
  });

  it('maps assistant to role model and tool_calls to functionCall parts', () => {
    const envelope = toAntigravityEnvelope(
      makeRequest({
        messages: [
          { role: 'user', content: 'run it' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
              },
            ],
          },
        ],
      }),
      BASE_OPTIONS,
    );
    const modelTurn = envelope.request.contents[1];
    expect(modelTurn?.role).toBe('model');
    expect(modelTurn?.parts[0]).toEqual({
      functionCall: { name: 'read_file', args: { path: 'a.ts' } },
    });
  });

  it('merges consecutive tool responses into a single user content (role alternation)', () => {
    const envelope = toAntigravityEnvelope(
      makeRequest({
        messages: [
          { role: 'user', content: 'go' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'a', arguments: '{}' } },
              { id: 'c2', type: 'function', function: { name: 'b', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', name: 'a', content: '{"ok":true}' },
          { role: 'tool', tool_call_id: 'c2', name: 'b', content: 'plain text' },
        ],
      }),
      BASE_OPTIONS,
    );
    const toolTurn = envelope.request.contents[2];
    expect(toolTurn?.role).toBe('user');
    expect(toolTurn?.parts).toHaveLength(2);
    expect(toolTurn?.parts[0]?.functionResponse?.name).toBe('a');
    expect(toolTurn?.parts[0]?.functionResponse?.response).toEqual({ ok: true });
    expect(toolTurn?.parts[1]?.functionResponse?.response).toEqual({ result: 'plain text' });
  });

  it('maps generation parameters and omits absent ones', () => {
    const withParams = toAntigravityEnvelope(
      makeRequest({ temperature: 0.2, top_p: 0.9, max_tokens: 1024, stop: ['END'] }),
      BASE_OPTIONS,
    );
    expect(withParams.request.generationConfig).toEqual({
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 1024,
      stopSequences: ['END'],
    });
    const withoutParams = toAntigravityEnvelope(makeRequest(), BASE_OPTIONS);
    expect(withoutParams.request.generationConfig).toBeUndefined();
  });

  it('converts base64 image parts and rejects external URLs', () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8=';
    const ok = toAntigravityEnvelope(
      makeRequest({
        messages: [
          { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] },
        ],
      }),
      BASE_OPTIONS,
    );
    expect(ok.request.contents[0]?.parts[0]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' },
    });
    expect(() =>
      toAntigravityEnvelope(
        makeRequest({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
              ],
            },
          ],
        }),
        BASE_OPTIONS,
      ),
    ).toThrow(EnvelopeConversionError);
  });

  it('sanitizes tool schemas and forces an object root', () => {
    const envelope = toAntigravityEnvelope(
      makeRequest({
        tools: [
          {
            type: 'function',
            function: {
              name: 'search',
              description: 'search files',
              parameters: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                additionalProperties: false,
                properties: {
                  query: { type: 'string', minLength: 1, format: 'uri' },
                  mode: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                },
              },
            },
          },
        ],
      }),
      BASE_OPTIONS,
    );
    const declaration = envelope.request.tools?.[0]?.functionDeclarations[0];
    expect(declaration?.parameters?.type).toBe('object');
    expect(declaration?.parameters?.$schema).toBeUndefined();
    expect(declaration?.parameters?.additionalProperties).toBeUndefined();
    const query = (declaration?.parameters?.properties as Record<string, unknown>)
      .query as Record<string, unknown>;
    expect(query.minLength).toBeUndefined();
    expect(query.format).toBeUndefined();
    const mode = (declaration?.parameters?.properties as Record<string, unknown>)
      .mode as Record<string, unknown>;
    expect(mode).toEqual({ type: 'string' });
  });

  it('honours the provider-pinned model and deterministic request id', () => {
    const envelope = toAntigravityEnvelope(makeRequest(), {
      ...BASE_OPTIONS,
      model: 'pinned-model',
    });
    expect(envelope.model).toBe('pinned-model');
    expect(envelope.requestId).toBe('agent-0-test');
    expect(envelope.requestType).toBe('agent');
    expect(envelope.userAgent).toBe('antigravity');
  });

  it('throws on a conversation with no non-system content', () => {
    expect(() =>
      toAntigravityEnvelope(
        makeRequest({ messages: [{ role: 'system', content: 'only system' }] }),
        BASE_OPTIONS,
      ),
    ).toThrow(EnvelopeConversionError);
  });

  it('sanitizeJsonSchema leaves scalars and arrays intact', () => {
    expect(sanitizeJsonSchema('x')).toBe('x');
    expect(sanitizeJsonSchema(null)).toBeNull();
    expect(sanitizeJsonSchema([{ $id: 'a', type: 'string' }])).toEqual([{ type: 'string' }]);
  });
});
