/**
 * Types for the Antigravity / Cloud Code Assist provider kind.
 *
 * The OpenAI-side input shapes are intentionally redeclared here (minimal
 * and dependency-free) so this module stays pure and reusable from both the
 * VS Code host and the standalone gateway build.
 */

// ---------------------------------------------------------------------------
// OAuth / account
// ---------------------------------------------------------------------------

export interface AntigravityTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
  tokenType: string;
  scope?: string;
  email?: string;
  projectId?: string;
}

export interface LoadCodeAssistResult {
  projectId: string;
  /** Human-readable plan label when the endpoint exposes one. */
  plan?: string;
}

export interface AntigravityModelInfo {
  id: string;
  displayName?: string;
  /** Seconds until quota reset, when the catalog exposes it. */
  quotaResetDelaySeconds?: number;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible input (minimal)
// ---------------------------------------------------------------------------

export interface OpenAiContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAiContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  tools?: OpenAiTool[];
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// Antigravity envelope (outgoing)
// ---------------------------------------------------------------------------

export interface AntigravityPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
}

export interface AntigravityContent {
  role: 'user' | 'model';
  parts: AntigravityPart[];
}

export interface AntigravityGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface AntigravityTool {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
}

export interface AntigravityEnvelope {
  project: string;
  model: string;
  request: {
    contents: AntigravityContent[];
    systemInstruction?: { parts: Array<{ text: string }> };
    generationConfig?: AntigravityGenerationConfig;
    tools?: AntigravityTool[];
  };
  requestType: 'agent';
  userAgent: string;
  requestId: string;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible output (chunks and final completion)
// ---------------------------------------------------------------------------

export interface OpenAiChunkDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: Array<{
    index: number;
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAiChatChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: OpenAiChunkDelta;
    finish_reason: string | null;
  }>;
  usage?: OpenAiUsage;
}

export interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: OpenAiUsage;
}
