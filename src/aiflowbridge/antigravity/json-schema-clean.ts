/**
 * JSON Schema sanitiser for the Gemini `Schema` dialect.
 *
 * Gemini does not accept arbitrary JSON Schema. It accepts a fixed,
 * small vocabulary (the fields of the `Schema` protobuf), and answers
 * HTTP 400 `INVALID_ARGUMENT` with `Unknown name "<keyword>" at ...`
 * for anything else. Clients (Kilo Code, Continue) send plain JSON
 * Schema tools, so the gateway has to project them onto that
 * vocabulary before forwarding.
 *
 * This module is the single source of truth for that projection, shared
 * by the BYOK native surface (`gemini-native.ts`) and the AGY OAuth
 * surface (`envelope.ts`). It used to be duplicated in both, and the
 * copies had already drifted apart, which is how
 * `propertyNames` (a draft-06+ keyword that a Kilo Code tool schema
 * used) reached the upstream and produced
 * `Unknown name "propertyNames" at 'tools[0].function_declarations[45]...'`.
 */

/**
 * The only keys the Gemini `Schema` type is documented to accept.
 * Taken verbatim from the official discovery document, identical on v1
 * and v1beta:
 *
 *   GET https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta
 *   -> schemas.Schema.properties
 *
 * Kept as an explicit list rather than being used as the accept filter,
 * because `GEMINI_SCHEMA_STRIPPED_KEYWORDS` deliberately overlaps it
 * (see that constant). It is the reference the stripping decisions are
 * argued against, and `tests/gemini-json-schema.test.ts` asserts it
 * never overlaps the forbidden set.
 */
export const GEMINI_SCHEMA_ACCEPTED_KEYS: ReadonlySet<string> = new Set([
  'anyOf',
  'default',
  'description',
  'enum',
  'example',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'nullable',
  'pattern',
  'properties',
  'propertyOrdering',
  'required',
  'title',
  'type',
]);

/**
 * Keywords Gemini documents as accepted but that AIFlowBridge still
 * strips on purpose.
 *
 * This is a conservative choice carried over from the original
 * sanitiser, kept deliberately rather than "fixed": the discovery
 * document is the *documented* surface, and a keyword is not worth the
 * risk of a whole-request HTTP 400 for a marginal gain in how well a
 * model honours a tool constraint. Losing `minimum: 0` on a tool
 * argument costs a less precise tool call; a rejected request costs the
 * call entirely. Any change here needs a live call against
 * `generativelanguage.googleapis.com` to confirm, so it is not
 * something to do from the discovery document alone.
 */
export const GEMINI_SCHEMA_STRIPPED_KEYWORDS: ReadonlySet<string> = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
]);

/**
 * JSON Schema keywords Gemini does not know, so it rejects the whole
 * request with `Unknown name "<keyword>"`. This is the set the fix
 * actually turns on: a stripped keyword costs precision, a forbidden
 * one costs the request.
 *
 * Composition keywords are dropped rather than translated: Gemini
 * supports `anyOf` only, so a `oneOf` / `allOf` / `not` schema is
 * forwarded without its composition. The request still goes through
 * with the remaining constraints instead of failing outright, which is
 * the same trade-off already made for `$ref` (dropped, so a recursive
 * schema degrades to `{ type: 'object' }`).
 */
export const GEMINI_SCHEMA_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  // Structural / identification
  '$schema',
  '$id',
  '$anchor',
  '$comment',
  '$ref',
  '$defs',
  '$vocabulary',
  'definitions',
  // Composition (anyOf is accepted and therefore absent here)
  'allOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
  // Applicators Gemini has no equivalent for
  'additionalProperties',
  'additionalItems',
  'unevaluatedItems',
  'unevaluatedProperties',
  'patternProperties',
  'prefixItems',
  'contains',
  'maxContains',
  'minContains',
  // The keyword that broke tool calls: a draft-06+ validation keyword
  // present in Kilo Code tool schemas, absent from Gemini's `Schema`.
  'propertyNames',
  // Validation Gemini has no equivalent for
  'const',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'multipleOf',
  'uniqueItems',
  // Metadata / annotations that are not part of the tool contract
  'deprecated',
  'readOnly',
  'writeOnly',
  'examples',
  // Content vocabularies
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
]);

/** Every keyword `cleanJsonSchema` drops, whatever the reason. */
const STRIPPED_KEYS: ReadonlySet<string> = new Set([
  ...GEMINI_SCHEMA_FORBIDDEN_KEYS,
  ...GEMINI_SCHEMA_STRIPPED_KEYWORDS,
]);

/** Keys whose value is a nested schema that must be cleaned too. */
const NESTED_SCHEMA_KEYS: ReadonlySet<string> = new Set(['items', 'anyOf']);

/**
 * Recursively project a JSON Schema onto the Gemini `Schema` dialect:
 * forbidden keywords are dropped, and every nested schema
 * (`properties.*`, `items`, `anyOf[]`) is cleaned in turn.
 *
 * Pure and side-effect free, so it stays trivially testable. Never
 * mutates the input. Returns `{ type: 'object' }` for a non-object
 * input, which is the safe shape for Gemini when a client sends a
 * schema it cannot express.
 */
export function cleanJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object' };
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (STRIPPED_KEYS.has(key)) {
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const cleanedProperties: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        cleanedProperties[propName] = cleanJsonSchema(propSchema);
      }
      result.properties = cleanedProperties;
    } else if (key === 'anyOf' && Array.isArray(value)) {
      result.anyOf = value.map((entry) => cleanJsonSchema(entry));
    } else if (NESTED_SCHEMA_KEYS.has(key) && value) {
      result[key] = cleanJsonSchema(value);
    } else {
      result[key] = value;
    }
  }

  // Gemini needs a `type` on every node it receives. A schema that
  // relies on inference (or that had its only type-adjacent keyword
  // stripped) is a plain object as far as the tool contract goes.
  if (!result.type) {
    result.type = 'object';
  }

  return result;
}
