/**
 * Unit tests for the shared Gemini `Schema` sanitiser.
 *
 * The keyword sets are guarded against each other rather than against
 * fixtures: a keyword cannot be both documented-accepted and
 * forbidden, and the keywords that produced a real 400 in the field
 * must stay in the forbidden set so the fix cannot be undone by a
 * well-meaning edit.
 */

import { describe, expect, it } from 'vitest';
import {
  cleanJsonSchema,
  GEMINI_SCHEMA_ACCEPTED_KEYS,
  GEMINI_SCHEMA_FORBIDDEN_KEYS,
  GEMINI_SCHEMA_STRIPPED_KEYWORDS,
} from '../src/aiflowbridge/antigravity/json-schema-clean';

describe('the keyword sets stay coherent', () => {
  it('never lists a keyword as both accepted and forbidden', () => {
    // The invariant that matters: a keyword Gemini documents as
    // accepted must not sit in the forbidden set, where it would be
    // reported as an upstream rejection. The stripped set is allowed
    // to overlap on purpose and is asserted separately.
    const overlap = [...GEMINI_SCHEMA_ACCEPTED_KEYS].filter((k) => GEMINI_SCHEMA_FORBIDDEN_KEYS.has(k));
    expect(overlap).toEqual([]);
  });

  it('overlaps the accepted set only through the deliberate stripped keywords', () => {
    const overlap = [...GEMINI_SCHEMA_ACCEPTED_KEYS].filter((k) => GEMINI_SCHEMA_STRIPPED_KEYWORDS.has(k));
    expect(new Set(overlap)).toEqual(
      new Set([
        'format',
        'maxItems',
        'maxLength',
        'maxProperties',
        'maximum',
        'minItems',
        'minLength',
        'minProperties',
        'minimum',
        'pattern',
      ])
    );
  });

  it('keeps the keywords that caused a real 400 in the forbidden set', () => {
    // `propertyNames` is the keyword from the reported failure
    // (`Unknown name "propertyNames" at
    // 'tools[0].function_declarations[45].parameters.properties[3].value'`).
    // Each of the others is a sibling keyword with no Gemini
    // equivalent, so the same class of client schema breaks the same
    // way.
    for (const keyword of [
      'propertyNames',
      'additionalProperties',
      'const',
      'oneOf',
      'allOf',
      'not',
      'patternProperties',
      'prefixItems',
      'contains',
      'uniqueItems',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'multipleOf',
      '$ref',
      '$defs',
      'examples',
    ]) {
      expect(GEMINI_SCHEMA_FORBIDDEN_KEYS.has(keyword)).toBe(true);
    }
  });

  it('never forbids a keyword a nested schema still needs to describe itself', () => {
    for (const keyword of ['type', 'properties', 'items', 'required', 'description', 'anyOf', 'enum', 'nullable']) {
      expect(GEMINI_SCHEMA_FORBIDDEN_KEYS.has(keyword)).toBe(false);
      expect(GEMINI_SCHEMA_STRIPPED_KEYWORDS.has(keyword)).toBe(false);
    }
  });
});

describe('cleanJsonSchema', () => {
  it('drops propertyNames at any depth', () => {
    const cleaned = cleanJsonSchema({
      type: 'object',
      properties: {
        edits: {
          type: 'object',
          propertyNames: { pattern: '^[a-z_]+$' },
          properties: { replacement: { type: 'string' } },
        },
      },
    });
    const edits = (cleaned.properties as Record<string, Record<string, unknown>>).edits;
    expect(edits).not.toHaveProperty('propertyNames');
    expect(edits.properties).toEqual({ replacement: { type: 'string' } });
  });

  it('drops propertyNames nested in an array item schema', () => {
    const cleaned = cleanJsonSchema({
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: { type: 'string', propertyNames: { pattern: 'x' }, examples: ['a'] },
        },
      },
    });
    const items = (cleaned.properties as Record<string, { items: Record<string, unknown> }>).edits.items;
    expect(items).toEqual({ type: 'string' });
  });

  it('cleans inside anyOf, which Gemini does support', () => {
    const cleaned = cleanJsonSchema({
      anyOf: [
        { type: 'string', const: 'fixed' },
        { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false },
      ],
    });
    expect(cleaned.anyOf).toEqual([
      { type: 'string' },
      { type: 'object', properties: { a: { type: 'number' } } },
    ]);
  });

  it('keeps the accepted vocabulary intact', () => {
    const cleaned = cleanJsonSchema({
      type: 'object',
      title: 'A tool',
      description: 'd',
      properties: {
        path: { type: 'string', description: 'p' },
        mode: { type: 'string', enum: ['a', 'b'] },
        opt: { type: 'string', nullable: true },
      },
      required: ['path'],
      propertyOrdering: ['path', 'mode'],
    });
    expect(cleaned).toEqual({
      type: 'object',
      title: 'A tool',
      description: 'd',
      properties: {
        path: { type: 'string', description: 'p' },
        mode: { type: 'string', enum: ['a', 'b'] },
        opt: { type: 'string', nullable: true },
      },
      required: ['path'],
      propertyOrdering: ['path', 'mode'],
    });
  });

  it('drops a $ref schema down to a plain object rather than failing the request', () => {
    expect(cleanJsonSchema({ $ref: '#/$defs/Node' })).toEqual({ type: 'object' });
  });

  it('defaults a schema with no type to object', () => {
    expect(cleanJsonSchema({ properties: { a: { type: 'string' } } })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    });
  });

  it('returns a plain object for a non-object input', () => {
    expect(cleanJsonSchema('nope')).toEqual({ type: 'object' });
    expect(cleanJsonSchema([{ type: 'object' }])).toEqual({ type: 'object' });
    expect(cleanJsonSchema(null)).toEqual({ type: 'object' });
  });

  it('never mutates the input', () => {
    const input = {
      type: 'object',
      propertyNames: { pattern: 'x' },
      properties: { a: { type: 'string', const: 'fixed' } },
    };
    cleanJsonSchema(input);
    expect(input.propertyNames).toEqual({ pattern: 'x' });
    expect(input.properties.a).toEqual({ type: 'string', const: 'fixed' });
  });

  it('strips every keyword it declares as stripped', () => {
    const schema: Record<string, unknown> = { type: 'string' };
    for (const keyword of [...GEMINI_SCHEMA_FORBIDDEN_KEYS, ...GEMINI_SCHEMA_STRIPPED_KEYWORDS]) {
      schema[keyword] = 'sentinel';
    }
    const cleaned = cleanJsonSchema(schema);
    expect(cleaned).toEqual({ type: 'string' });
  });
});
