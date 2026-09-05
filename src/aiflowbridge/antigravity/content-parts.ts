/**
 * AIFlowBridge - shared OpenAI content to Gemini parts parser.
 *
 * Both upstream surfaces (BYOK native in `gemini-native.ts` and OAuth
 * AGY in `envelope.ts`) accept the same OpenAI Chat Completions
 * `messages[].content` shapes and must produce the same native
 * `parts[]`. The shared parser avoids duplication:
 *   - `string` content becomes a single `{ text }` part.
 *   - content arrays map `type: text` / `input_text` / `output_text`
 *     entries to `{ text }` parts.
 *   - `type: image_url` with a `data:<mime>;base64,<payload>` URL
 *     becomes `{ inlineData: { mimeType, data } }`.
 *   - `type: image_url` with an `http(s)` URL is dropped with a
 *     warning (the native API needs bytes, URL passthrough is not
 *     supported). The URL is never forwarded as text.
 *
 * Pure function - the caller logs the dropped-URL warning via the
 * returned `droppedImageUrls` count so this module stays free of
 * logger side effects and unit-testable in isolation.
 */

export interface GeminiContentPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface ParsedContentParts {
  parts: GeminiContentPart[];
  droppedImageUrls: number;
}

interface ContentArrayEntry {
  type?: string;
  text?: unknown;
  image_url?: unknown;
}

function parseBase64ImageUrl(url: string): { mimeType: string; data: string } | undefined {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) {
    return undefined;
  }
  const mimeType = (match[1] ?? '').trim();
  const data = (match[2] ?? '').trim();
  if (!mimeType || !data) {
    return undefined;
  }
  return { mimeType, data };
}

function extractEntryText(entry: ContentArrayEntry): string | undefined {
  if (typeof entry.text === 'string' && entry.text.length > 0) {
    return entry.text;
  }
  return undefined;
}

function extractImageUrl(entry: ContentArrayEntry): string | undefined {
  const raw = entry.image_url;
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw === 'object' && typeof (raw as { url?: unknown }).url === 'string') {
    return (raw as { url: string }).url;
  }
  return undefined;
}

/**
 * Convert OpenAI `message.content` into native Gemini parts.
 * Returns the parts plus the count of dropped remote image URLs.
 */
export function openAiContentToGeminiParts(content: unknown): ParsedContentParts {
  if (typeof content === 'string') {
    return content ? { parts: [{ text: content }], droppedImageUrls: 0 } : { parts: [], droppedImageUrls: 0 };
  }
  if (!Array.isArray(content)) {
    if (content === undefined || content === null) {
      return { parts: [], droppedImageUrls: 0 };
    }
    return { parts: [{ text: JSON.stringify(content) }], droppedImageUrls: 0 };
  }
  const parts: GeminiContentPart[] = [];
  let droppedImageUrls = 0;
  for (const rawEntry of content) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      continue;
    }
    const entry = rawEntry as ContentArrayEntry;
    const kind = entry.type;
    if (kind === 'text' || kind === 'input_text' || kind === 'output_text') {
      const text = extractEntryText(entry);
      if (text) {
        parts.push({ text });
      }
      continue;
    }
    if (kind === 'image_url') {
      const url = extractImageUrl(entry);
      if (!url) {
        continue;
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        droppedImageUrls += 1;
        continue;
      }
      const inline = parseBase64ImageUrl(url);
      if (inline) {
        parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
      } else {
        droppedImageUrls += 1;
      }
      continue;
    }
  }
  return { parts, droppedImageUrls };
}

/**
 * Log a dropped remote image URL warning once per call site.
 * The logger is injected by the caller so this module has no
 * `vscode` import and stays unit-testable (vitest has no `vscode`
 * package; only `src/logger.ts` may import it).
 */
export function logDroppedImageUrls(dropped: number, scope: string, warn: (message: string) => void): void {
  if (dropped > 0) {
    warn(`[Gemini] ${scope} dropped ${dropped} remote image_url entr${dropped === 1 ? 'y' : 'ies'} (native API needs bytes, http(s) passthrough is not supported)`);
  }
}
