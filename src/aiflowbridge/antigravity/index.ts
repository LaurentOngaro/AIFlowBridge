/**
 * AIFlowBridge - shared Gemini translation module index.
 *
 * The Antigravity / Cloud Code Assist product OAuth transport is retired
 * (see `src/aiflowbridge/google-transport-policy.ts`). What remains here
 * are the pure, credential-free translation helpers shared by the Gemini
 * surfaces: the Cloud Code envelope translator, the SSE transforms, the
 * native-surface request/response conversion, the content-part and JSON
 * Schema helpers, and the thought-signature cache.
 *
 * Authentication, token storage, project discovery and model discovery are
 * intentionally NOT re-exported: they belonged to the removed transport.
 */

export * from './constants';
export * from './envelope';
export * from './sse-transform';
export * from './types';