/**
 * AIFlowBridge - Gemini native drain+transform integration test.
 *
 * Verifies the gateway's drain-then-transform pipeline does not lose
 * bytes (the regression observed in production on 2026-09-05). The
 * test mirrors what `forwardChatCompletion` does after my fix: drain
 * the upstream body, feed it into the SSE transform, and assert the
 * resulting OpenAI-shaped stream contains the expected frames.
 *
 * No `Readable.fromWeb`, no `pipeThrough` - those primitives were the
 * root cause of the byte loss. Just a deterministic input buffer, the
 * transform, and a manual emit loop.
 */

import { describe, expect, it } from 'vitest';
import {
  createGeminiNativeToOpenAiSseStream,
} from '../src/aiflowbridge/antigravity/gemini-native';

async function feedAndCollect(
  upstreamText: string
): Promise<string> {
  const bytes = new TextEncoder().encode(upstreamText);
  const transform = createGeminiNativeToOpenAiSseStream({ model: 'gemini-3.7-flash' });
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const collected: string[] = [];
  // Drive the upstream writer and the output reader concurrently so
  // the TransformStream's internal queue never backpresses the writer.
  const drainPromise = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) collected.push(new TextDecoder().decode(value));
    }
  })();
  await writer.write(bytes);
  await writer.close();
  await drainPromise;
  return collected.join('');
}

describe('gateway pipeline drain + transform (audit 2026-09-05 regression)', () => {
  it('emits text + finish + usage + [DONE] for a single Gemini SSE frame', async () => {
    const nativeFrame = JSON.stringify({
      candidates: [
        { content: { role: 'model', parts: [{ text: 'Hello!' }] }, finishReason: 'STOP' },
      ],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 },
    });
    const upstream = `data: ${nativeFrame}\n\n`;

    const result = await feedAndCollect(upstream);

    expect(result).toContain('"content":"Hello!"');
    expect(result).toContain('"finish_reason":"stop"');
    expect(result).toContain('"prompt_tokens":4');
    expect(result).toContain('"completion_tokens":1');
    expect(result).toContain('"total_tokens":5');
    expect(result.trim()).toMatch(/data: \[DONE\]$/);
  });

  it('emits only [DONE] for an empty upstream (degenerate but valid)', async () => {
    const result = await feedAndCollect('');
    expect(result.trim()).toBe('data: [DONE]');
  });
});
