/**
 * AIFlowBridge - OpenAI to Cloud Code Assist (Gemini) request envelope translation.
 *
 * Translates standard OpenAI Chat Completion request bodies into the structured
 * envelope expected by Cloud Code Assist (Antigravity / Google AI Studio).
 * Pure translation module, no network calls, fully unit-testable.
 */

import { randomBytes } from 'node:crypto';
import { DEFAULT_USER_AGENT } from './constants';
import type {
    CloudCodeContent,
    CloudCodeEnvelope,
    CloudCodeFunctionDeclaration,
    CloudCodeGenerationConfig,
    CloudCodePart,
    CloudCodeRequest,
} from './types';

const FORBIDDEN_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'examples',
  'patternProperties',
  'additionalProperties',
  // Numeric bounds: `exclusiveMinimum` / `exclusiveMaximum` are OpenAPI
  // 3.0+ / JSON Schema draft-04+ keywords, but the Gemini
  // `OpenApi` schema dialect rejects them with
  // `Unknown name "exclusiveMinimum" at ...`. Strip them alongside the
  // inclusive versions so Kilo Code / Continue tool schemas (which use
  // exclusive variants in the OpenAI-compatible path) survive the
  // translation.
  'exclusiveMinimum',
  'exclusiveMaximum',
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

/**
 * Recursively cleans a JSON schema to ensure compatibility with Gemini tool definitions.
 * Strips unsupported validation keywords while preserving object shapes and properties.
 */
export function cleanJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object' };
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(schema as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (FORBIDDEN_SCHEMA_KEYS.has(key)) {
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const cleanedProperties: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        cleanedProperties[propName] = cleanJsonSchema(propSchema);
      }
      result.properties = cleanedProperties;
    } else if (key === 'items' && value) {
      result.items = cleanJsonSchema(value);
    } else {
      result[key] = value;
    }
  }

  if (!result.type) {
    result.type = 'object';
  }

  return result;
}

export interface ToEnvelopeOptions {
  userAgent?: string;
  requestId?: string;
}

export interface OpenAiChatMessage {
  role?: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<{
    function?: { name?: string; arguments?: unknown };
  }>;
}

export interface OpenAiChatBody {
  messages?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
  stop?: unknown;
  tools?: unknown;
}

/**
 * Converts an OpenAI Chat Completions payload into the Cloud Code Assist envelope.
 *
 * @param openaiBody The incoming OpenAI request body.
 * @param projectId The Google Cloud project ID associated with the user account.
 * @param modelId The target model ID (e.g. 'gemini-3.8-flash').
 * @param options Optional userAgent and requestId overrides.
 */
export function toAntigravityEnvelope(
  openaiBody: OpenAiChatBody,
  projectId: string,
  modelId: string,
  options?: ToEnvelopeOptions
): CloudCodeEnvelope {
  const messages: OpenAiChatMessage[] = Array.isArray(openaiBody.messages) ? (openaiBody.messages as OpenAiChatMessage[]) : [];
  const contents: CloudCodeContent[] = [];
  const systemParts: Array<{ text: string }> = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;

    const role = msg.role;
    if (role === 'system' || role === 'developer') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
      if (text) {
        systemParts.push({ text });
      }
      continue;
    }

    if (role === 'user') {
      const parts: CloudCodePart[] = [];
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (!item) continue;
          if (item.type === 'text' && typeof item.text === 'string') {
            parts.push({ text: item.text });
          } else if (item.type === 'image_url' && item.image_url?.url) {
            const url: string = item.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }
      if (parts.length > 0) {
        contents.push({ role: 'user', parts });
      }
      continue;
    }

    if (role === 'assistant') {
      const parts: CloudCodePart[] = [];
      if (typeof msg.content === 'string' && msg.content.length > 0) {
        parts.push({ text: msg.content });
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          if (typeof tc.function?.arguments === 'string') {
            try {
              const parsedArgs: unknown = JSON.parse(tc.function.arguments);
              args = typeof parsedArgs === 'object' && parsedArgs !== null ? (parsedArgs as Record<string, unknown>) : { raw: tc.function.arguments };
            } catch {
              args = { raw: tc.function.arguments };
            }
          } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
            args = tc.function.arguments as Record<string, unknown>;
          }
          parts.push({
            functionCall: {
              name: tc.function?.name ?? 'unknown_function',
              args,
            },
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
      continue;
    }

    if (role === 'tool') {
      const toolName = msg.name || 'tool_response';
      let parsedResponse: Record<string, unknown>;
      if (typeof msg.content === 'string') {
        try {
          const parsed: unknown = JSON.parse(msg.content);
          parsedResponse = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { result: msg.content };
        } catch {
          parsedResponse = { result: msg.content };
        }
      } else if (msg.content && typeof msg.content === 'object') {
        parsedResponse = msg.content as Record<string, unknown>;
      } else {
        parsedResponse = { result: String(msg.content ?? '') };
      }

      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: toolName,
              response: parsedResponse,
            },
          },
        ],
      });
      continue;
    }
  }

  const generationConfig: CloudCodeGenerationConfig = {};
  if (typeof openaiBody.temperature === 'number') {
    generationConfig.temperature = openaiBody.temperature;
  }
  if (typeof openaiBody.top_p === 'number') {
    generationConfig.topP = openaiBody.top_p;
  }
  const maxTokens = openaiBody.max_tokens ?? openaiBody.max_completion_tokens;
  if (typeof maxTokens === 'number') {
    generationConfig.maxOutputTokens = maxTokens;
  }
  if (openaiBody.stop) {
    generationConfig.stopSequences = Array.isArray(openaiBody.stop)
      ? openaiBody.stop
      : [String(openaiBody.stop)];
  }

  const cloudCodeRequest: CloudCodeRequest = { contents };
  if (systemParts.length > 0) {
    cloudCodeRequest.systemInstruction = { parts: systemParts };
  }
  if (Object.keys(generationConfig).length > 0) {
    cloudCodeRequest.generationConfig = generationConfig;
  }

  if (Array.isArray(openaiBody.tools) && openaiBody.tools.length > 0) {
    const declarations: CloudCodeFunctionDeclaration[] = [];
    for (const tool of openaiBody.tools) {
      if (tool && tool.type === 'function' && tool.function) {
        declarations.push({
          name: tool.function.name,
          description: tool.function.description,
          parameters: cleanJsonSchema(tool.function.parameters),
        });
      }
    }
    if (declarations.length > 0) {
      cloudCodeRequest.tools = [{ functionDeclarations: declarations }];
    }
  }

  const userAgent = options?.userAgent || DEFAULT_USER_AGENT;
  const requestId =
    options?.requestId || `agent-${Date.now()}-${randomBytes(6).toString('hex')}`;

  return {
    project: projectId,
    model: modelId,
    request: cloudCodeRequest,
    requestType: 'agent',
    userAgent,
    requestId,
  };
}
