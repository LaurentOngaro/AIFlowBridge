/**
 * AIFlowBridge - Gemini public API native-surface translator tests.
 *
 * Covers the OpenAI -> Gemini native envelope translation
 * (`toGeminiNativeRequest`) and the response reshaper
 * (`fromGeminiNativeResponse`). Pure unit tests, no network.
 */

import { describe, expect, it } from 'vitest';
import {
  createGeminiNativeToOpenAiSseStream,
  fromGeminiNativeResponse,
  toGeminiNativeRequest,
  type GeminiNativeResponse,
} from '../src/aiflowbridge/antigravity/gemini-native';

describe('toGeminiNativeRequest', () => {
  it('translates a minimal user message into a single native contents entry', () => {
    const out = toGeminiNativeRequest({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    expect(out.systemInstruction).toBeUndefined();
    expect(out.generationConfig).toBeUndefined();
    expect(out.tools).toBeUndefined();
  });

  it('joins system + developer messages into a single systemInstruction', () => {
    const out = toGeminiNativeRequest({
      messages: [
        { role: 'system', content: 'be concise' },
        { role: 'developer', content: 'be technical' },
        { role: 'user', content: 'go' },
      ],
    });
    expect(out.systemInstruction?.parts.map((p) => p.text)).toEqual(['be concise', 'be technical']);
    expect(out.contents).toEqual([{ role: 'user', parts: [{ text: 'go' }] }]);
  });

  it('maps OpenAI generation config into the Gemini generationConfig shape', () => {
    const out = toGeminiNativeRequest({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.5,
      top_p: 0.9,
      max_tokens: 256,
      stop: ['\n\n'],
    });
    expect(out.generationConfig).toEqual({
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 256,
      stopSequences: ['\n\n'],
    });
  });

  it('flattens OpenAI tool definitions into Gemini functionDeclarations and cleans the schema', () => {
    const out = toGeminiNativeRequest({
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Lookup current weather',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string', exclusiveMinimum: 0, exclusiveMaximum: 1000000 },
              },
              required: ['city'],
            },
          },
        },
      ],
    });
    expect(out.tools).toBeDefined();
    const decl = out.tools?.[0]?.functionDeclarations?.[0];
    expect(decl?.name).toBe('get_weather');
    const params = decl?.parameters as { properties?: { city?: { exclusiveMinimum?: unknown; exclusiveMaximum?: unknown } } };
    // The Gemini native surface accepts more keywords than the AGY
    // envelope, but `exclusiveMinimum` / `exclusiveMaximum` are
    // always rejected. The translator must strip them so Kilo Code /
    // Continue tool schemas (OpenAPI 3.x) survive translation.
    expect(params.properties?.city?.exclusiveMinimum).toBeUndefined();
    expect(params.properties?.city?.exclusiveMaximum).toBeUndefined();
  });

  it('translates assistant tool_calls into model + functionCall parts', () => {
    const out = toGeminiNativeRequest({
      messages: [
        { role: 'user', content: 'weather in Paris?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', name: 'get_weather', content: '{"temp":18}' },
      ],
    });
    expect(out.contents).toHaveLength(3);
    expect(out.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'get_weather', args: { city: 'Paris' } } }],
    });
    expect(out.contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'get_weather', response: { temp: 18 } } }],
    });
  });

  it('merges same-role turns so the native contents strictly alternate', () => {
    const out = toGeminiNativeRequest({
      messages: [
        { role: 'user', content: 'weather in Paris?' },
        { role: 'assistant', content: 'checking now' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', name: 'get_weather', content: '{"temp":18}' },
        { role: 'tool', tool_call_id: 'call_2', name: 'get_time', content: '{"tz":"Paris"}' },
        { role: 'user', content: 'and tomorrow?' },
      ],
    });
    const roles = out.contents.map((c) => c.role);
    expect(roles).toEqual(['user', 'model', 'user', 'model', 'user'].slice(0, roles.length));
    for (let i = 1; i < roles.length; i += 1) {
      expect(roles[i]).not.toBe(roles[i - 1]);
    }
    // The merged assistant turn holds both text and the functionCall.
    expect(out.contents[1]?.parts).toHaveLength(2);
    // The two parallel tool responses merge into a single user entry.
    const toolEntry = out.contents.find((c) => c.parts.some((p) => 'functionResponse' in p));
    const toolParts = toolEntry?.parts.filter((p) => 'functionResponse' in p) ?? [];
    expect(toolParts).toHaveLength(2);
  });

  it('keeps assistant text and parallel tool_calls in a single model entry', () => {
    const out = toGeminiNativeRequest({
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: 'calling two tools',
          tool_calls: [
            { id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
            { id: 'call_2', function: { name: 'get_time', arguments: '{"tz":"Paris"}' } },
          ],
        },
      ],
    });
    expect(out.contents).toHaveLength(2);
    expect(out.contents[1]?.role).toBe('model');
    const hasText = out.contents[1]?.parts.some((p) => 'text' in p) ?? false;
    const callParts = out.contents[1]?.parts.filter((p) => 'functionCall' in p) ?? [];
    expect(hasText).toBe(true);
    expect(callParts).toHaveLength(2);
  });
});

describe('fromGeminiNativeResponse', () => {
  it('reshapes a single native response into the OpenAI non-streaming shape', () => {
    const native: GeminiNativeResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'hello' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 4,
        totalTokenCount: 16,
      },
    };
    const out = fromGeminiNativeResponse(native, { model: 'gemini-3.8-flash' });
    expect(out.model).toBe('gemini-3.8-flash');
    expect(out.choices).toEqual([
      { index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' },
    ]);
    expect(out.usage).toEqual({ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });
    expect(out.object).toBe('chat.completion');
  });

  it('returns null content and zero usage when the upstream returns no candidates', () => {
    const out = fromGeminiNativeResponse({}, { model: 'gemini-3.8-flash' });
    expect(out.choices[0]?.message.content).toBeNull();
    expect(out.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it('maps native functionCall parts to OpenAI tool_calls (audit BUG-04)', () => {
    const native: GeminiNativeResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { functionCall: { name: 'get_weather', args: { city: 'Paris' } } },
              { functionCall: { name: 'get_time', args: { tz: 'Europe/Paris' } } },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
    const out = fromGeminiNativeResponse(native, { model: 'gemini-3.8-flash' });
    expect(out.choices[0]?.message.tool_calls).toHaveLength(2);
    expect(out.choices[0]?.message.content).toBeNull();
    expect(out.choices[0]?.message.tool_calls?.[0]?.function.name).toBe('get_weather');
    expect(JSON.parse(out.choices[0]?.message.tool_calls?.[0]?.function.arguments ?? '{}')).toEqual({ city: 'Paris' });
    expect(out.choices[0]?.message.tool_calls?.[1]?.function.name).toBe('get_time');
    // Stable, distinct ids per call.
    expect(out.choices[0]?.message.tool_calls?.[0]?.id).not.toBe(out.choices[0]?.message.tool_calls?.[1]?.id);
  });

  it('maps MAX_TOKENS to OpenAI finish_reason "length" (audit BUG-10)', () => {
    const out = fromGeminiNativeResponse(
      { candidates: [{ content: { parts: [{ text: '...' }] }, finishReason: 'MAX_TOKENS' }] },
      { model: 'gemini-3.8-flash' }
    );
    expect(out.choices[0]?.finish_reason).toBe('length');
  });

  it('maps SAFETY to OpenAI finish_reason "content_filter" (audit BUG-10)', () => {
    const out = fromGeminiNativeResponse(
      { candidates: [{ content: { parts: [{ text: '...' }] }, finishReason: 'SAFETY' }] },
      { model: 'gemini-3.8-flash' }
    );
    expect(out.choices[0]?.finish_reason).toBe('content_filter');
  });

  it('reports tool_calls when STOP arrives with functionCall parts', () => {
    const native: GeminiNativeResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'calling now' }, { functionCall: { name: 'get_weather', args: { city: 'Paris' } } }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
    const out = fromGeminiNativeResponse(native, { model: 'gemini-3.8-flash' });
    expect(out.choices[0]?.message.tool_calls).toHaveLength(1);
    expect(out.choices[0]?.finish_reason).toBe('tool_calls');
  });

  it('reports stop when STOP arrives without functionCall parts', () => {
    const native: GeminiNativeResponse = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
    const out = fromGeminiNativeResponse(native, { model: 'gemini-3.8-flash' });
    expect(out.choices[0]?.message.tool_calls).toBeUndefined();
    expect(out.choices[0]?.finish_reason).toBe('stop');
  });

  it('emits tool_calls finish reason on the native streaming path', async () => {
    const transform = createGeminiNativeToOpenAiSseStream({ model: 'gemini-3.8-flash' });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf8');
    const inputData =
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"Paris"}}}]},"finishReason":"STOP"}]}\n\n';
    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(inputData));
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
    const chunks = collected
      .split(/\r?\n\r?\n/)
      .filter((block) => block.trim().length > 0 && block.trim() !== 'data: [DONE]')
      .map((block) => JSON.parse(block.replace(/^data:\s*/, '')) as { choices: Array<{ finish_reason?: string | null }> });
    const terminal = chunks.find((c) => c.choices[0]?.finish_reason);
    expect(terminal?.choices[0]?.finish_reason).toBe('tool_calls');
  });
});
