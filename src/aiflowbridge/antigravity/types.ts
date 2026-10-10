/**
 * AIFlowBridge - shared Gemini translation types.
 *
 * Defines the Cloud Code request/response shapes used by the pure
 * envelope translator and the SSE transforms, plus the Gemini content,
 * tool-call and usage shapes both surfaces share.
 *
 * The OAuth token and PKCE types that used to live here are gone: they
 * belonged to the retired Antigravity / Cloud Code Assist product
 * transport (see `src/aiflowbridge/google-transport-policy.ts`).
 */

export interface CloudCodePart {
  text?: string;
  thought?: boolean;
  /**
   * Opaque `thought_signature` returned by the upstream on the
   * previous turn. Echoed back on the next request so the upstream
   * keeps the same internal reasoning state across the conversation.
   * Required on `functionCall` parts for tool use to work
   * (`400 Function call is missing a thought_signature`); propagated
   * through `extra_signature` in the OpenAI-shape message so clients
   * (Kilo Code, Continue, custom SDK calls) can round-trip the
   * signature without inspecting native shapes.
   */
  thoughtSignature?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface CloudCodeContent {
  role: 'user' | 'model';
  parts: CloudCodePart[];
}

export interface CloudCodeFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface CloudCodeGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface CloudCodeRequest {
  contents: CloudCodeContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: CloudCodeGenerationConfig;
  tools?: Array<{
    functionDeclarations: CloudCodeFunctionDeclaration[];
  }>;
}

export interface CloudCodeEnvelope {
  project: string;
  model: string;
  request: CloudCodeRequest;
  requestType: string;
  userAgent: string;
  requestId: string;
}

export interface CloudCodeCandidate {
  content?: {
    parts?: CloudCodePart[];
    role?: string;
  };
  finishReason?: string;
}

export interface CloudCodeUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface CloudCodeStreamEvent {
  response?: {
    candidates?: CloudCodeCandidate[];
    usageMetadata?: CloudCodeUsageMetadata;
  };
  error?: {
    code: number;
    message: string;
    status?: string;
  };
}


