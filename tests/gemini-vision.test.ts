/**
 * AIFlowBridge - Gemini vision (inlineData) translation tests.
 *
 * Covers BUG-14: OpenAI content arrays (`type: text` plus
 * `type: image_url`) must map to native Gemini parts. Base64
 * `data:<mime>;base64,<payload>` URLs become
 * `{ inlineData: { mimeType, data } }` on both the BYOK native path
 * (`toGeminiNativeRequest`) and the OAuth AGY path
 * (`toAntigravityEnvelope`). Remote `http(s)` URLs are dropped with a
 * warning - the native API needs bytes, URL passthrough is not
 * supported. Pure unit tests, no network.
 */

import { describe, expect, it } from 'vitest';
import { openAiContentToGeminiParts } from '../src/aiflowbridge/antigravity/content-parts';
import { toAntigravityEnvelope } from '../src/aiflowbridge/antigravity/envelope';
import { toGeminiNativeRequest } from '../src/aiflowbridge/antigravity/gemini-native';

const BASE64_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('openAiContentToGeminiParts', () => {
  it('converts text plus base64 image content into text plus inlineData parts', () => {
    const parsed = openAiContentToGeminiParts([
      { type: 'text', text: 'What is this image?' },
      { type: 'image_url', image_url: { url: BASE64_URL } },
    ]);
    expect(parsed.droppedImageUrls).toBe(0);
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts[0]).toEqual({ text: 'What is this image?' });
    expect(parsed.parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
  });

  it('drops remote http image URLs instead of forwarding them as text', () => {
    const parsed = openAiContentToGeminiParts([
      { type: 'text', text: 'Describe this' },
      { type: 'image_url', image_url: { url: 'https://example.com/photo.png' } },
    ]);
    expect(parsed.droppedImageUrls).toBe(1);
    expect(parsed.parts).toEqual([{ text: 'Describe this' }]);
  });

  it('maps input_text and output_text aliases to text parts', () => {
    const parsed = openAiContentToGeminiParts([
      { type: 'input_text', text: 'hello' },
      { type: 'output_text', text: 'world' },
    ]);
    expect(parsed.parts).toEqual([{ text: 'hello' }, { text: 'world' }]);
    expect(parsed.droppedImageUrls).toBe(0);
  });

  it('keeps plain string content unchanged', () => {
    const parsed = openAiContentToGeminiParts('just text');
    expect(parsed).toEqual({ parts: [{ text: 'just text' }], droppedImageUrls: 0 });
  });
});

describe('Gemini vision on both upstream surfaces', () => {
  it('produces inlineData on the BYOK native path', () => {
    const out = toGeminiNativeRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this image?' },
            { type: 'image_url', image_url: { url: BASE64_URL } },
          ],
        },
      ],
    });
    expect(out.contents).toHaveLength(1);
    expect(out.contents[0]?.parts).toHaveLength(2);
    expect(out.contents[0]?.parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
  });

  it('drops remote http image URLs on the BYOK native path', () => {
    const out = toGeminiNativeRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image_url', image_url: { url: 'https://example.com/photo.png' } },
          ],
        },
      ],
    });
    expect(out.contents).toHaveLength(1);
    expect(out.contents[0]?.parts).toEqual([{ text: 'Describe this' }]);
  });

  it('produces inlineData on the OAuth envelope path', () => {
    const envelope = toAntigravityEnvelope(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this image?' },
              { type: 'image_url', image_url: { url: BASE64_URL } },
            ],
          },
        ],
      },
      'proj-1',
      'gemini-3.8-flash'
    );
    const parts = envelope.request.contents[0]?.parts ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
  });
});
