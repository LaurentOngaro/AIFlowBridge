/**
 * AIFlowBridge - Cloud Code Assist model catalog discovery (fetchAvailableModels).
 *
 * Discovers the Gemini and code models accessible to the authenticated account
 * and resolves fallback profiles when running offline.
 */

import {
    CLOUDCODE_MODELS_URL,
    DEFAULT_GOOG_API_CLIENT,
    DEFAULT_USER_AGENT,
} from './constants';
import type { CloudCodeModelInfo, FetchAvailableModelsResult } from './types';

export const DEFAULT_FALLBACK_MODELS: CloudCodeModelInfo[] = [
  {
    name: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash (Google AI)',
    maxInputTokens: 1048576,
    maxOutputTokens: 65536,
  },
  {
    name: 'gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash (Google AI)',
    maxInputTokens: 1048576,
    maxOutputTokens: 65536,
  },
  {
    name: 'gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash (Google AI)',
    maxInputTokens: 1048576,
    maxOutputTokens: 65536,
  },
];

export async function fetchAvailableModels(
  accessToken: string,
  projectId?: string,
  fetchFn: typeof fetch = fetch
): Promise<FetchAvailableModelsResult> {
  const body = projectId ? { project: projectId } : {};
  const response = await fetchFn(CLOUDCODE_MODELS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': DEFAULT_USER_AGENT,
      'X-Goog-Api-Client': DEFAULT_GOOG_API_CLIENT,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { models: DEFAULT_FALLBACK_MODELS };
  }

  try {
    const data = (await response.json()) as {
      models?: Array<{
        name?: string;
        id?: string;
        displayName?: string;
        maxInputTokens?: number;
        maxOutputTokens?: number;
        capabilities?: Record<string, boolean>;
      }>;
    };
    const rawModels = Array.isArray(data.models) ? data.models : [];
    const models: CloudCodeModelInfo[] = rawModels.map((m) => ({
      name: m.name || m.id || 'unknown-model',
      displayName: m.displayName || m.name,
      maxInputTokens: m.maxInputTokens || 1048576,
      maxOutputTokens: m.maxOutputTokens || 8192,
      capabilities: m.capabilities,
    }));

    return { models: models.length > 0 ? models : DEFAULT_FALLBACK_MODELS };
  } catch {
    return { models: DEFAULT_FALLBACK_MODELS };
  }
}
