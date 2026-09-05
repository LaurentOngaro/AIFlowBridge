import { describe, expect, it } from 'vitest';
import { cleanJsonSchema, toAntigravityEnvelope } from '../src/aiflowbridge/antigravity/envelope';

describe('cleanJsonSchema', () => {
  it('strips unsupported JSON Schema validation keywords', () => {
    const rawSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        filename: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          pattern: '^.*\\.ts$',
          description: 'Target filename',
        },
        count: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
        },
      },
      required: ['filename'],
    };

    const cleaned = cleanJsonSchema(rawSchema);

    expect(cleaned.$schema).toBeUndefined();
    expect(cleaned.additionalProperties).toBeUndefined();
    expect(cleaned.type).toBe('object');
    expect(cleaned.required).toEqual(['filename']);

    const props = cleaned.properties as Record<string, { type?: string; description?: string; minLength?: number; pattern?: string; minimum?: number }> ;
    expect(props.filename.type).toBe('string');
    expect(props.filename.description).toBe('Target filename');
    expect(props.filename.minLength).toBeUndefined();
    expect(props.filename.pattern).toBeUndefined();
    expect(props.count.type).toBe('integer');
    expect(props.count.minimum).toBeUndefined();
  });

  it('recursively cleans nested array items', () => {
    const schemaWithArray = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 2,
          },
        },
      },
    };

    const cleaned = cleanJsonSchema(schemaWithArray);
    const tagsProp = (cleaned.properties as Record<string, { type?: string; items?: { type?: string; minLength?: number } }>).tags;
    expect(tagsProp.type).toBe('array');
    expect(tagsProp.items?.type).toBe('string');
    expect(tagsProp.items?.minLength).toBeUndefined();
  });
});

describe('toAntigravityEnvelope', () => {
  it('translates standard chat messages, system prompt, and parameters', () => {
    const openaiBody = {
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'system', content: 'You are a helpful coding assistant.' },
        { role: 'user', content: 'Hello Gemini' },
        { role: 'assistant', content: 'Hello! How can I help you today?' },
        { role: 'user', content: 'Explain PKCE' },
      ],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 4096,
      stop: ['\nUser:'],
    };

    const envelope = toAntigravityEnvelope(openaiBody, 'my-cloud-project-123', 'gemini-3.8-flash');

    expect(envelope.project).toBe('my-cloud-project-123');
    expect(envelope.model).toBe('gemini-3.8-flash');
    expect(envelope.requestType).toBe('agent');
    expect(envelope.userAgent).toBe('antigravity');
    expect(envelope.requestId).toMatch(/^agent-/);

    const req = envelope.request;
    expect(req.systemInstruction?.parts).toEqual([{ text: 'You are a helpful coding assistant.' }]);
    expect(req.generationConfig?.temperature).toBe(0.7);
    expect(req.generationConfig?.topP).toBe(0.95);
    expect(req.generationConfig?.maxOutputTokens).toBe(4096);
    expect(req.generationConfig?.stopSequences).toEqual(['\nUser:']);

    expect(req.contents).toHaveLength(3);
    expect(req.contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Hello Gemini' }],
    });
    expect(req.contents[1]).toEqual({
      role: 'model',
      parts: [{ text: 'Hello! How can I help you today?' }],
    });
    expect(req.contents[2]).toEqual({
      role: 'user',
      parts: [{ text: 'Explain PKCE' }],
    });
  });

  it('translates tool definitions, tool_calls, and tool responses', () => {
    const openaiBody = {
      model: 'gemini-3.7-flash',
      messages: [
        { role: 'user', content: 'Check weather in Paris' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"Paris","units":"metric"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          name: 'get_weather',
          tool_call_id: 'call_abc123',
          content: '{"temp": 22, "condition": "Sunny"}',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather for a location',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                location: { type: 'string', minLength: 2 },
                units: { type: 'string' },
              },
              required: ['location'],
            },
          },
        },
      ],
    };

    const envelope = toAntigravityEnvelope(openaiBody, 'proj-abc', 'gemini-3.7-flash');
    const req = envelope.request;

    expect(req.tools).toBeDefined();
    expect(req.tools![0].functionDeclarations).toHaveLength(1);
    const decl = req.tools![0].functionDeclarations[0];
    expect(decl.name).toBe('get_weather');
    expect(decl.parameters?.additionalProperties).toBeUndefined();

    expect(req.contents).toHaveLength(3);
    expect(req.contents[1].role).toBe('model');
    expect(req.contents[1].parts[0].functionCall).toEqual({
      name: 'get_weather',
      args: { location: 'Paris', units: 'metric' },
    });

    expect(req.contents[2].role).toBe('user');
    expect(req.contents[2].parts[0].functionResponse).toEqual({
      name: 'get_weather',
      response: { temp: 22, condition: 'Sunny' },
    });
  });

  it('translates base64 image data into inlineData parts', () => {
    const openaiBody = {
      model: 'gemini-3.7-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this image?' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
            },
          ],
        },
      ],
    };

    const envelope = toAntigravityEnvelope(openaiBody, 'proj-1', 'gemini-3.7-flash');
    const parts = envelope.request.contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ text: 'What is this image?' });
    expect(parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
  });

  it('strips exclusiveMinimum / exclusiveMaximum from tool parameters', () => {
    // Kilo Code / Continue sometimes emit OpenAPI 3.x / JSON Schema
    // draft-04+ tool schemas. The Gemini `OpenApi` dialect rejects
    // the `exclusive*` keywords with `Unknown name` 400s. Strip them
    // so the cleaned envelope survives the translation.
    const cleaned = cleanJsonSchema({
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1, maximum: 100, exclusiveMinimum: 0, exclusiveMaximum: 101 },
        q: { type: 'string', minLength: 1, maxLength: 64 },
      },
    });
    expect(cleaned.properties).toBeDefined();
    const page = (cleaned.properties as Record<string, { exclusiveMinimum?: unknown; exclusiveMaximum?: unknown }>).page;
    expect(page.exclusiveMinimum).toBeUndefined();
    expect(page.exclusiveMaximum).toBeUndefined();
  });
});
