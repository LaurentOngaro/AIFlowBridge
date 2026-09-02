import { describe, expect, it, vi } from 'vitest';
import {
  AntigravitySseConverter,
  mergeFramesToCompletion,
} from '../src/aiflowbridge/antigravity/sse-transform';
import type { OpenAiChatChunk } from '../src/aiflowbridge/antigravity/types';

const OPTIONS = {
  requestId: 'chatcmpl-test',
  model: 'gemini-test-model',
  createdSeconds: 1_700_000_000,
} as const;

const encoder = new TextEncoder();

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function parseChunk(frameText: string): OpenAiChatChunk {
  const line = frameText.split('\n').find((entry) => entry.startsWith('data:'));
  return JSON.parse((line ?? '').slice(5)) as OpenAiChatChunk;
}

describe('antigravity sse converter', () => {
  it('converts a text part into a delta.content chunk', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    const frames = converter.push(
      encoder.encode(
        frame({
          response: { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] },
        }),
      ),
    );
    expect(frames).toHaveLength(1);
    const chunk = parseChunk(frames[0] ?? '');
    expect(chunk.object).toBe('chat.completion.chunk');
    expect(chunk.choices[0]?.delta.content).toBe('Hello');
    expect(chunk.choices[0]?.finish_reason).toBeNull();
    expect(converter.sawOutput).toBe(true);
  });

  it('reassembles a frame split across two network chunks', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    const payload = frame({
      response: { candidates: [{ content: { parts: [{ text: 'split' }] } }] },
    });
    const cut = Math.floor(payload.length / 2);
    expect(converter.push(encoder.encode(payload.slice(0, cut)))).toHaveLength(0);
    const frames = converter.push(encoder.encode(payload.slice(cut)));
    expect(frames).toHaveLength(1);
    expect(parseChunk(frames[0] ?? '').choices[0]?.delta.content).toBe('split');
  });

  it('maps functionCall parts to tool_calls with incrementing indices', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    const frames = converter.push(
      encoder.encode(
        frame({
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    { functionCall: { name: 'read_file', args: { path: 'a.ts' } } },
                    { functionCall: { name: 'write_file', args: { path: 'b.ts' } } },
                  ],
                },
              },
            ],
          },
        }),
      ),
    );
    expect(frames).toHaveLength(2);
    const first = parseChunk(frames[0] ?? '').choices[0]?.delta.tool_calls?.[0];
    const second = parseChunk(frames[1] ?? '').choices[0]?.delta.tool_calls?.[0];
    expect(first?.index).toBe(0);
    expect(first?.function.name).toBe('read_file');
    expect(first?.function.arguments).toBe('{"path":"a.ts"}');
    expect(second?.index).toBe(1);
    expect(second?.function.name).toBe('write_file');
  });

  it('maps finish reasons and usage metadata', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    const frames = converter.push(
      encoder.encode(
        frame({
          response: {
            candidates: [
              { content: { parts: [{ text: 'done' }] }, finishReason: 'MAX_TOKENS' },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
          },
        }),
      ),
    );
    const chunks = frames.map(parseChunk);
    expect(chunks.some((chunk) => chunk.choices[0]?.finish_reason === 'length')).toBe(true);
    const usage = chunks.find((chunk) => chunk.usage !== undefined)?.usage;
    expect(usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
  });

  it('skips thought parts without flagging output', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    const frames = converter.push(
      encoder.encode(
        frame({
          response: {
            candidates: [{ content: { parts: [{ text: 'secret think', thought: true }] } }],
          },
        }),
      ),
    );
    expect(frames).toHaveLength(0);
    expect(converter.sawOutput).toBe(false);
  });

  it('reports malformed frames and keeps going', () => {
    const onParseError = vi.fn();
    const converter = new AntigravitySseConverter({ ...OPTIONS, onParseError });
    const frames = converter.push(
      encoder.encode('data: {not json}\n\n' + frame({
        response: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      })),
    );
    expect(onParseError).toHaveBeenCalledWith('{not json}');
    expect(frames).toHaveLength(1);
  });

  it('ignores comment/heartbeat segments and ends with [DONE] on flush', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    expect(converter.push(encoder.encode(': heartbeat 123\n\n'))).toHaveLength(0);
    const tail = converter.flush();
    expect(tail).toEqual(['data: [DONE]\n\n']);
  });

  it('processes a trailing partial frame on flush', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    converter.push(
      encoder.encode(
        `data: ${JSON.stringify({
          response: { candidates: [{ content: { parts: [{ text: 'tail' }] } }] } },
        })}`,
      ),
    );
    const frames = converter.flush();
    expect(parseChunk(frames[0] ?? '').choices[0]?.delta.content).toBe('tail');
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n');
  });

  it('mergeFramesToCompletion assembles text, tool calls and usage', () => {
    const converter = new AntigravitySseConverter(OPTIONS);
    const frames = converter.push(
      encoder.encode(
        frame({
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'answer' },
                    { functionCall: { name: 'run', args: { cmd: 'ls' } } },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 7, totalTokenCount: 10 },
          },
        }),
      ),
    );
    frames.push(...converter.flush());
    const completion = mergeFramesToCompletion(frames);
    expect(completion.object).toBe('chat.completion');
    expect(completion.choices[0]?.message.content).toBe('answer');
    expect(completion.choices[0]?.message.tool_calls?.[0]?.function.name).toBe('run');
    expect(completion.choices[0]?.finish_reason).toBe('stop');
    expect(completion.usage?.total_tokens).toBe(10);
  });
});
