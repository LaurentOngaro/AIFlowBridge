/**
 * Convert an OpenAI chat-completion request body into the Antigravity /
 * Cloud Code Assist envelope (`{ project, model, request, ... }`).
 *
 * Pure module: no network, no filesystem. Covered by
 * tests/antigravity-envelope.test.ts.
 */

import { randomBytes } from 'node:crypto';
import { ANTIGRAVITY_USER_AGENT } from './constants';
import type {
  AntigravityContent,
  AntigravityEnvelope,
  AntigravityGenerationConfig,
  AntigravityPart,
  AntigravityTool,
  OpenAiChatMessage,
  OpenAiChatRequest,
  OpenAiContentPart,
} from './types';

/** JSON Schema keywords not accepted by the Gemini-side tool schema. */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'examples',
  'patternProperties',
  'additionalProperties',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

/** Raised when a request cannot be represented in the Antigravity shape. */
export class EnvelopeConversionError extends Error {
  readonly reason: 'unsupported-image-url' | 'empty-messages';

  constructor(reason: EnvelopeConversionError['reason'], detail: string) {
    super(`[antigravity] envelope conversion failed (${reason}): ${detail}`);
    this.name = 'EnvelopeConversionError';
    this.reason = reason;
  }
}

/**
 * Recursively strip JSON Schema keywords the Gemini tool schema rejects.
 * `anyOf` / `oneOf` combinators are collapsed to their first branch —
 * documented MVP behaviour, good enough for the tool shapes Kilo sends.
 */
export function sanitizeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) => sanitizeJsonSchema(entry));
  }
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }
  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    if (key === 'anyOf' || key === 'oneOf') {
      const branches = Array.isArray(value) ? value : [];
      const first = branches.length > 0 ? sanitizeJsonSchema(branches[0]) : undefined;
      if (first !== undefined && typeof first === 'object' && first !== null) {
        Object.assign(output, first as Record<string, unknown>);
      }
      continue;
    }
    output[key] = sanitizeJsonSchema(value);
  }
  return output;
}

/** Gemini function parameters must be rooted at `type: "object"`. */
function sanitizeToolParameters(
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (parameters === undefined) {
    return undefined;
  }
  const cleaned = sanitizeJsonSchema(parameters) as Record<string, unknown>;
  if (cleaned.type === undefined && cleaned.properties !== undefined) {
    cleaned.type = 'object';
  }
  return cleaned;
}

function toInlineData(part: OpenAiContentPart): AntigravityPart {
  const url = part.image_url?.url ?? '';
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) {
    throw new EnvelopeConversionError(
      'unsupported-image-url',
      `only base64 data URLs are supported, got: ${url.slice(0, 64)}…`,
    );
  }
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

function contentPartsOf(message: OpenAiChatMessage): AntigravityPart[] {
  const { content } = message;
  if (content === undefined || content === null) {
    return [];
  }
  if (typeof content === 'string') {
    return content.length > 0 ? [{ text: content }] : [];
  }
  const parts: AntigravityPart[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text !== undefined) {
      parts.push({ text: part.text });
    } else if (part.type === 'image_url') {
      parts.push(toInlineData(part));
    }
  }
  return parts;
}

function tryParseJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: text };
  }
}

function toContents(messages: OpenAiChatMessage[]): AntigravityContent[] {
  const contents: AntigravityContent[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue; // handled separately as systemInstruction
    }
    let role: AntigravityContent['role'];
    let parts: AntigravityPart[];
    if (message.role === 'tool') {
      role = 'user';
      const name = message.name ?? message.tool_call_id ?? 'unknown_tool';
      parts = [
        {
          functionResponse: {
            name,
            response: tryParseJson(
              typeof message.content === 'string' ? message.content : '',
            ),
          },
        },
      ];
    } else if (message.role === 'assistant') {
      role = 'model';
      parts = contentPartsOf(message);
      for (const call of message.tool_calls ?? []) {
        parts.push({
          functionCall: { name: call.function.name, args: tryParseJson(call.function.arguments) },
        });
      }
    } else {
      role = 'user';
      parts = contentPartsOf(message);
    }
    if (parts.length === 0) {
      continue;
    }
    // Gemini requires strictly alternating roles: fold consecutive same-role
    // contents (notably consecutive tool responses) into a single entry.
    const previous = contents[contents.length - 1];
    if (previous !== undefined && previous.role === role) {
      previous.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }
  return contents;
}

function toSystemInstruction(
  messages: OpenAiChatMessage[],
): AntigravityEnvelope['request']['systemInstruction'] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== 'system') {
      continue;
    }
    if (typeof message.content === 'string') {
      texts.push(message.content);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text' && part.text !== undefined) {
          texts.push(part.text);
        }
      }
    }
  }
  const joined = texts.filter((text) => text.length > 0).join('\n\n');
  return joined.length > 0 ? { parts: [{ text: joined }] } : undefined;
}

function toGenerationConfig(
  request: OpenAiChatRequest,
): AntigravityGenerationConfig | undefined {
  const config: AntigravityGenerationConfig = {};
  if (request.temperature !== undefined) {
    config.temperature = request.temperature;
  }
  if (request.top_p !== undefined) {
    config.topP = request.top_p;
  }
  if (request.max_tokens !== undefined) {
    config.maxOutputTokens = request.max_tokens;
  }
  if (request.stop !== undefined) {
    config.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function toTools(request: OpenAiChatRequest): AntigravityTool[] | undefined {
  if (request.tools === undefined || request.tools.length === 0) {
    return undefined;
  }
  return [
    {
      functionDeclarations: request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: sanitizeToolParameters(tool.function.parameters),
      })),
    },
  ];
}

export interface ToEnvelopeOptions {
  projectId: string;
  /** Overrides `request.model` when the provider profile pins a model. */
  model?: string;
  /** Deterministic request id for tests; generated when omitted. */
  requestId?: string;
  /** Deterministic timestamp (ms) for tests; `Date.now()` when omitted. */
  now?: number;
}

export function toAntigravityEnvelope(
  request: OpenAiChatRequest,
  options: ToEnvelopeOptions,
): AntigravityEnvelope {
  const contents = toContents(request.messages);
  if (contents.length === 0) {
    throw new EnvelopeConversionError(
      'empty-messages',
      'no user/model/tool content after system extraction',
    );
  }
  const now = options.now ?? Date.now();
  const requestId =
    options.requestId ?? `agent-${now}-${randomBytes(4).toString('hex')}`;
  const envelope: AntigravityEnvelope = {
    project: options.projectId,
    model: options.model ?? request.model,
    request: { contents },
    requestType: 'agent',
    userAgent: ANTIGRAVITY_USER_AGENT,
    requestId,
  };
  const systemInstruction = toSystemInstruction(request.messages);
  if (systemInstruction !== undefined) {
    envelope.request.systemInstruction = systemInstruction;
  }
  const generationConfig = toGenerationConfig(request);
  if (generationConfig !== undefined) {
    envelope.request.generationConfig = generationConfig;
  }
  const tools = toTools(request);
  if (tools !== undefined) {
    envelope.request.tools = tools;
  }
  return envelope;
}
