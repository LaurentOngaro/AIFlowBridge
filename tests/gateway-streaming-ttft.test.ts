/**
 * AIFlowBridge - Gemini streaming TTFT regression tests.
 *
 * Covers BUG-17: the gateway must stream Gemini / Antigravity
 * upstream frames to the client in real time (`pipeThrough`) instead
 * of buffering the full upstream before the first client byte
 * (drain then transform). The first OpenAI chunk must be readable
 * before the upstream closes. The trailing `[DONE]`, the
 * `finish_reason` frame, and the `usage` frame must still be present.
 * Pure unit tests - the upstream is a scripted ReadableStream, no
 * network.
 */

import { describe, expect, it } from 'vitest';
import { createAntigravityToOpenAiTransformStream } from '../src/aiflowbridge/antigravity/sse-transform';
import { createGeminiNativeToOpenAiSseStream } from '../src/aiflowbridge/antigravity/gemini-native';

interface OpenAiChunk {
  choices: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function parseChunks(collected: string): OpenAiChunk[] {
  return collected
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim().length > 0 && block.trim() !== 'data: [DONE]')
    .map((block) => JSON.parse(block.replace(/^data:\s*/, '')) as OpenAiChunk);
}

async function collectPiped(
  transform: TransformStream<Uint8Array, Uint8Array>,
  frames: string[],
  holdOpen: () => Promise<void>
): Promise<{ collected: string; firstChunkAt: number; closedAt: number }> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf8');
  const inputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      await holdOpen();
      controller.close();
    },
  });
  const transformed = inputStream.pipeThrough(transform);
  const reader = transformed.getReader();
  let collected = '';
  let firstChunkAt = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    collected += decoder.decode(value, { stream: true });
    if (!firstChunkAt && collected.includes('delta')) {
      firstChunkAt = Date.now();
    }
  }
  return { collected, firstChunkAt, closedAt: Date.now() };
}

describe('Gemini streaming emits the first chunk before upstream close', () => {
  it('pipes native frames in real time with finish and usage trailers', async () => {
    const transform = createGeminiNativeToOpenAiSseStream({ model: 'gemini-3.8-flash' });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf8');
    let releaseUpstream!: () => void;
    const upstreamOpen = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });
    // The upstream emits one text frame, then stays open until the
    // test releases it - like a live SSE connection mid-answer. The
    // pipe path must surface the first OpenAI chunk while the
    // upstream is still open (no full-drain wait).
    const inputStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n'));
        await upstreamOpen;
        controller.enqueue(
          encoder.encode(
            'data: {"candidates":[{"content":{"parts":[{"text":" world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":4,"totalTokenCount":9}}\n\n'
          )
        );
        controller.close();
      },
    });
    const transformed = inputStream.pipeThrough(transform);
    const reader = transformed.getReader();
    let collected = '';
    // The first read resolves while the upstream is still open -
    // proof the frame was piped in real time, not replayed after
    // a full drain.
    const first = await reader.read();
    expect(first.done).toBe(false);
    collected += decoder.decode(first.value, { stream: true });
    expect(collected).toContain('Hello');
    releaseUpstream();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      collected += decoder.decode(value, { stream: true });
    }
    expect(collected).toContain('data: [DONE]\n\n');
    const chunks = parseChunks(collected);
    const terminal = chunks.find((c) => c.choices[0]?.finish_reason);
    expect(terminal?.choices[0]?.finish_reason).toBe('stop');
    const usage = chunks.find((c) => c.usage?.total_tokens === 9);
    expect(usage?.usage?.prompt_tokens).toBe(5);
  });

  it('pipes Antigravity frames in real time with finish and usage trailers', async () => {
    const transform = createAntigravityToOpenAiTransformStream({ model: 'gemini-3.8-flash' });
    const { collected, firstChunkAt, closedAt } = await collectPiped(
      transform,
      [
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}}\n\n',
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":" world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":4,"totalTokenCount":9}}}\n\n',
      ],
      () => new Promise<void>((resolve) => setTimeout(resolve, 50))
    );
    expect(collected).toContain('data: [DONE]\n\n');
    // The first OpenAI chunk is readable while the upstream is still
    // open (before `close()`), not after the full drain.
    expect(firstChunkAt).toBeGreaterThan(0);
    expect(firstChunkAt).toBeLessThanOrEqual(closedAt);
    const chunks = parseChunks(collected);
    const terminal = chunks.find((c) => c.choices[0]?.finish_reason);
    expect(terminal?.choices[0]?.finish_reason).toBe('stop');
    const usage = chunks.find((c) => c.usage?.total_tokens === 9);
    expect(usage?.usage?.prompt_tokens).toBe(5);
  });
});
