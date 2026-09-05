/**
 * AIFlowBridge - Gemini thought_signature round-trip tests.
 *
 * Covers the bug surfaced in production: the native Gemini and
 * Antigravity surfaces require every `functionCall` part to carry
 * the opaque `thought_signature` from the previous turn (`400
 * Function call is missing a thought_signature`). The gateway
 * propagates the signature transparently between the native
 * `thoughtSignature` field and the OpenAI `extra_signature`
 * extension, on the request side (client -> upstream) and on the
 * response side (upstream -> client). Pure unit tests, no network.
 */

import { describe, expect, it } from 'vitest';
import { toAntigravityEnvelope } from '../src/aiflowbridge/antigravity/envelope';
import {
  createGeminiNativeToOpenAiSseStream,
  fromGeminiNativeResponse,
  toGeminiNativeRequest,
} from '../src/aiflowbridge/antigravity/gemini-native';
import { createAntigravityToOpenAiTransformStream } from '../src/aiflowbridge/antigravity/sse-transform';

const SIGNATURE_A = 'sig-assistant-turn';
const SIGNATURE_B = 'sig-tool-result-turn';

describe('thought_signature round-trip on the BYOK native path', () => {
  it('propagates extra_signature into functionCall.thoughtSignature', () => {
    const out = toGeminiNativeRequest({
      messages: [
        { role: 'user', content: 'read the file' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              function: { name: 'default_api:read', arguments: '{"path":"/tmp/x"}' },
              extra_signature: SIGNATURE_A,
            },
          ],
        },
      ],
    });
    const modelEntry = out.contents.find((c) => c.parts.some((p) => 'functionCall' in p));
    const callPart = modelEntry?.parts.find((p) => 'functionCall' in p);
    if (!callPart || !('functionCall' in callPart)) {
      throw new Error('expected a functionCall part');
    }
    expect(callPart.thoughtSignature).toBe(SIGNATURE_A);
  });

  it('propagates the tool result extra_signature into functionResponse.thoughtSignature', () => {
    const out = toGeminiNativeRequest({
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'tool',
          name: 'default_api:read',
          tool_call_id: 'call_1',
          content: '{"ok":true}',
          extra_signature: SIGNATURE_B,
        },
      ],
    });
    const responsePart = out.contents[0]?.parts.find((p) => 'functionResponse' in p);
    if (!responsePart || !('functionResponse' in responsePart)) {
      throw new Error('expected a functionResponse part');
    }
    expect(responsePart.thoughtSignature).toBe(SIGNATURE_B);
  });

  it('omits the signature field when extra_signature is missing', () => {
    const out = toGeminiNativeRequest({
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'read', arguments: '{}' } }],
        },
      ],
    });
    const callPart = out.contents[0]?.parts.find((p) => 'functionCall' in p);
    if (!callPart || !('functionCall' in callPart)) {
      throw new Error('expected a functionCall part');
    }
    expect(callPart.thoughtSignature).toBeUndefined();
  });

  it('re-injects the cached signature when the client replayed the turn without extra_signature', () => {
    const out = toGeminiNativeRequest(
      {
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_abc', function: { name: 'default_api:read', arguments: '{"path":"/tmp/x"}' } }],
          },
        ],
      },
      undefined,
      (toolCallId: string) => (toolCallId === 'call_abc' ? SIGNATURE_A : undefined)
    );
    const callPart = out.contents[0]?.parts.find((p) => 'functionCall' in p);
    if (!callPart || !('functionCall' in callPart)) {
      throw new Error('expected a functionCall part');
    }
    expect(callPart.thoughtSignature).toBe(SIGNATURE_A);
  });

  it('prefers client-supplied extra_signature over the cache', () => {
    const out = toGeminiNativeRequest(
      {
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                function: { name: 'default_api:read', arguments: '{"path":"/tmp/x"}' },
                extra_signature: SIGNATURE_B,
              },
            ],
          },
        ],
      },
      undefined,
      () => SIGNATURE_A
    );
    const callPart = out.contents[0]?.parts.find((p) => 'functionCall' in p);
    if (!callPart || !('functionCall' in callPart)) {
      throw new Error('expected a functionCall part');
    }
    expect(callPart.thoughtSignature).toBe(SIGNATURE_B);
  });

  it('returns extra_signature on tool_calls[i] in the non-streaming OpenAI shape', () => {
    const native = {
      candidates: [
        {
          content: {
            role: 'model' as const,
            parts: [{ functionCall: { name: 'default_api:read', args: { path: '/tmp/x' } }, thoughtSignature: SIGNATURE_A }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
    };
    const out = fromGeminiNativeResponse(native, { model: 'gemini-3.8-flash' });
    expect(out.choices[0]?.message.tool_calls?.[0]?.extra_signature).toBe(SIGNATURE_A);
  });

  it('returns extra_signature on the streaming tool_call chunk', async () => {
    const transform = createGeminiNativeToOpenAiSseStream({ model: 'gemini-3.8-flash' });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf8');
    const sseFrame =
      `data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"default_api:read","args":{"path":"/tmp/x"}},"thoughtSignature":"${SIGNATURE_A}"}]},"finishReason":"STOP"}]}\n\n`;
    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseFrame));
        controller.close();
      },
    });
    const transformed = inputStream.pipeThrough(transform);
    const reader = transformed.getReader();
    let collected = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      collected += decoder.decode(value, { stream: true });
    }
    expect(collected).toContain(SIGNATURE_A);
  });
});

describe('thought_signature round-trip on the OAuth AGY path', () => {
  it('propagates extra_signature into the AGY CloudCodePart.thoughtSignature on functionCall', () => {
    const envelope = toAntigravityEnvelope(
      {
        messages: [
          { role: 'user', content: 'read' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'default_api:read', arguments: '{"path":"/tmp/x"}' },
                extra_signature: SIGNATURE_A,
              },
            ],
          },
        ],
      },
      'proj-1',
      'gemini-3.8-flash'
    );
    const callPart = envelope.request.contents
      .flatMap((c) => c.parts)
      .find((p) => p.functionCall);
    expect(callPart?.thoughtSignature).toBe(SIGNATURE_A);
  });

  it('propagates extra_signature into CloudCodePart.thoughtSignature on functionResponse', () => {
    const envelope = toAntigravityEnvelope(
      {
        messages: [
          { role: 'user', content: 'go' },
          {
            role: 'tool',
            name: 'default_api:read',
            tool_call_id: 'call_1',
            content: '{"ok":true}',
            extra_signature: SIGNATURE_B,
          },
        ],
      },
      'proj-1',
      'gemini-3.8-flash'
    );
    const responsePart = envelope.request.contents
      .flatMap((c) => c.parts)
      .find((p) => p.functionResponse);
    expect(responsePart?.thoughtSignature).toBe(SIGNATURE_B);
  });

  it('returns extra_signature on the streaming AGY tool_call chunk', async () => {
    const transform = createAntigravityToOpenAiTransformStream({ model: 'gemini-3.8-flash' });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf8');
    // The AGY Cloud Code envelope uses the same `parts[i]` shape as
    // the native surface: the `thought_signature` is a sibling field
    // of `functionCall`, not a child of it.
    const sseFrame =
      `data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"default_api:read","args":{"path":"/tmp/x"}},"thoughtSignature":"${SIGNATURE_A}"}]},"finishReason":"STOP"}]}}\n\n`;
    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseFrame));
        controller.close();
      },
    });
    const transformed = inputStream.pipeThrough(transform);
    const reader = transformed.getReader();
    let collected = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      collected += decoder.decode(value, { stream: true });
    }
    expect(collected).toContain(SIGNATURE_A);
  });

  it('re-injects the cached signature on the AGY envelope when the client dropped it', () => {
    const envelope = toAntigravityEnvelope(
      {
        messages: [
          { role: 'user', content: 'read' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'default_api:read', arguments: '{"path":"/tmp/x"}' },
              },
            ],
          },
        ],
      },
      'proj-1',
      'gemini-3.8-flash',
      undefined,
      undefined,
      (toolCallId: string) => (toolCallId === 'call_abc' ? SIGNATURE_A : undefined)
    );
    const callPart = envelope.request.contents
      .flatMap((c) => c.parts)
      .find((p) => p.functionCall);
    expect(callPart?.thoughtSignature).toBe(SIGNATURE_A);
  });
});
