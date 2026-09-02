/**
 * Antigravity / Cloud Code Assist provider module.
 *
 * Pure building blocks live here (constants, types, pkce, envelope,
 * sse-transform). Network-facing pieces (OAuth flow, token store,
 * loadCodeAssist, catalog) land in a follow-up iteration — see
 * docs/plans/antigravity-gateway-integration-spec.md.
 */

export * from './constants';
export type * from './types';
export { generateCodeChallenge, generateCodeVerifier, generateOAuthState } from './pkce';
export {
  EnvelopeConversionError,
  sanitizeJsonSchema,
  toAntigravityEnvelope,
  type ToEnvelopeOptions,
} from './envelope';
export {
  AntigravitySseConverter,
  createAntigravitySseTransform,
  mergeFramesToCompletion,
  type AntigravitySseConverterOptions,
} from './sse-transform';
