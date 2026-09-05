/**
 * AIFlowBridge - Antigravity / Google AI Studio provider types.
 *
 * Defines token models, PKCE structures, Cloud Code Assist request envelopes,
 * Gemini contents, tool call declarations, and SSE event shapes.
 */

export interface AntigravityTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  projectId?: string;
  email?: string;
  scopes?: string[];
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface CloudCodePart {
  text?: string;
  thought?: boolean;
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

export interface LoadCodeAssistResult {
  cloudaicompanionProject?: string;
  currentTier?: {
    id?: string;
    name?: string;
  };
  allowedTiers?: Array<{
    id?: string;
    name?: string;
  }>;
}

export interface CloudCodeModelInfo {
  name: string;
  displayName?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  capabilities?: Record<string, boolean>;
}

export interface FetchAvailableModelsResult {
  models?: CloudCodeModelInfo[];
}
