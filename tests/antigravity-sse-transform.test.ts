import { describe, expect, it } from 'vitest';
import {
    accumulateAntigravityResponse,
    createAntigravityToOpenAiTransformStream,
} from '../src/aiflowbridge/antigravity/sse-transform';

describe('createAntigravityToOpenAiTransformStream', () => {
  it('converts Cloud Code SSE frames to OpenAI chat.completion.chunk format', async () => {
    const transform = createAntigravityToOpenAiTransformStream({ model: 'gemini-3.8-flash' });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf8');

    const inputData =
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":null}]}}\n\n' +
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":" world!"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":5,"totalTokenCount":17}}}\n\n';

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(inputData));
        controller.close();
      },
    });

    const transformed = inputStream.pipeThrough(transform);
    const reader = transformed.getReader();
    let collectedOutput = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      collectedOutput += decoder.decode(value, { stream: true });
    }

    expect(collectedOutput).toContain('data: [DONE]\n\n');

    const chunks = collectedOutput
      .split(/\r?\n\r?\n/)
      .filter((block) => block.trim().length > 0 && block.trim() !== 'data: [DONE]')
      .map((block) => JSON.parse(block.replace(/^data:\s*/, '')));

    expect(chunks.length).toBeGreaterThanOrEqual(3);

    expect(chunks[0].object).toBe('chat.completion.chunk');
    expect(chunks[0].model).toBe('gemini-3.8-flash');
    expect(chunks[0].choices[0].delta.content).toBe('Hello');

    expect(chunks[1].choices[0].delta.content).toBe(' world!');

    const finishChunk = chunks.find((c) => c.choices[0]?.finish_reason === 'stop');
    expect(finishChunk).toBeDefined();

    const usageChunk = chunks.find((c) => c.usage?.total_tokens === 17);
    expect(usageChunk).toBeDefined();
    expect(usageChunk.usage.prompt_tokens).toBe(12);
  });

  it('correctly handles SSE frames fragmented across incoming buffer chunks', async () => {
    const transform = createAntigravityToOpenAiTransformStream({ model: 'gemini-3.8-flash' });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf8');

    const part1 = 'data: {"response":{"candidates":[{"content":{"parts":[{"te';
    const part2 = 'xt":"Fragmented text"}]}}]}}\n\n';

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.close();
      },
    });

    const transformed = inputStream.pipeThrough(transform);
    const reader = transformed.getReader();
    let collectedOutput = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      collectedOutput += decoder.decode(value, { stream: true });
    }

    expect(collectedOutput).toContain('"Fragmented text"');
  });
});

describe('accumulateAntigravityResponse', () => {
  it('accumulates streamed chunks into a single OpenAI chat.completion response', async () => {
    const encoder = new TextEncoder();
    const sseContent =
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Part 1 "}]}}]}}\n\n' +
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Part 2"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":4,"totalTokenCount":9}}}\n\n';

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseContent));
        controller.close();
      },
    });

    const fullResponse = await accumulateAntigravityResponse(inputStream, { model: 'gemini-3.8-flash' });

    expect(fullResponse.object).toBe('chat.completion');
    expect(fullResponse.model).toBe('gemini-3.8-flash');
    expect(fullResponse.choices[0].message.role).toBe('assistant');
    expect(fullResponse.choices[0].message.content).toBe('Part 1 Part 2');
    expect(fullResponse.choices[0].finish_reason).toBe('stop');
    expect(fullResponse.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 4,
      total_tokens: 9,
    });
  });
});
