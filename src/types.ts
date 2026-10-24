/**
 * Shared types for the DeepSeek Copilot extension.
 */

// ---- API request/response types ----

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: DeepSeekToolCall[];
  reasoning_content?: string;
}

export interface DeepSeekToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface DeepSeekTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface DeepSeekRequest {
  model: string;
  messages: DeepSeekMessage[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: DeepSeekTool[];
  tool_choice?: 'none' | 'auto' | 'required';
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: 'high' | 'max';
  stream_options?: {
    include_usage: boolean;
  };
}

export interface DeepSeekStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: DeepSeekUsage;
}

// ---- Stream callbacks ----

export interface StreamCallbacks {
  onContent: (content: string) => void;
  onThinking: (text: string) => void;
  onToolCall: (toolCall: DeepSeekToolCall) => void;
  onError: (error: Error) => void;
  onDone: () => void;
  onUsage?: (usage: DeepSeekUsage) => void;
}

// ---- Model definitions ----

export interface ModelDefinition {
  id: string;
  name: string;
  family: string;
  version: string;
  detail: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: {
    toolCalling: boolean | number;
    imageInput: boolean;
    thinking: boolean;
  };
  requiresThinkingParam: boolean;
  /**
   * Upstream reasoning-effort levels offered by the Copilot Chat
   * "Thinking Effort" dropdown, in ascending order. When present, the
   * dropdown lists exactly these values and the provider forwards the
   * selected one verbatim as the upstream `reasoning_effort` field
   * (MiniMax M3.1 Flash: `low`, `medium`, `high`, `xhigh`,
   * `max`). When absent, the dropdown keeps the historical
   * `none` / `high` / `max` triple, which maps to the MiniMax
   * `reasoning_split` boolean.
   *
   * A level list without `none` means thinking cannot be switched off,
   * which is the usual case for an always-reasoning upstream.
   */
  reasoningEffortLevels?: string[];
}
