/**
 * AIFlowBridge - Cloud Code Assist project discovery (loadCodeAssist).
 *
 * Resolves the user's assigned Google Cloud project ID (cloudaicompanionProject)
 * and plan tier using the authenticated Cloud Code Assist API.
 */

import {
    CLOUDCODE_LOAD_CODE_ASSIST_URL,
    DEFAULT_CLIENT_METADATA,
    DEFAULT_GOOG_API_CLIENT,
    DEFAULT_USER_AGENT,
} from './constants';
import type { LoadCodeAssistResult } from './types';

export async function fetchCodeAssistProject(
  accessToken: string,
  fetchFn: typeof fetch = fetch
): Promise<LoadCodeAssistResult> {
  const response = await fetchFn(CLOUDCODE_LOAD_CODE_ASSIST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': DEFAULT_USER_AGENT,
      'X-Goog-Api-Client': DEFAULT_GOOG_API_CLIENT,
      'Client-Metadata': DEFAULT_CLIENT_METADATA,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const statusText = response.statusText;
    let detail = '';
    try {
      const bodyText = await response.text();
      try {
        const errJson = JSON.parse(bodyText) as { error?: { message?: string } };
        detail = errJson?.error?.message || bodyText;
      } catch {
        detail = bodyText;
      }
    } catch {
      detail = '<unreadable response body>';
    }
    throw new Error(`Cloud Code loadCodeAssist failed (${response.status} ${statusText}): ${detail}`);
  }

  const data = (await response.json()) as {
    cloudaicompanionProject?: string | { id?: string; name?: string };
    currentTier?: LoadCodeAssistResult['currentTier'];
    allowedTiers?: LoadCodeAssistResult['allowedTiers'];
  };
  let projectId: string | undefined;

  if (typeof data.cloudaicompanionProject === 'string') {
    projectId = data.cloudaicompanionProject;
  } else if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject === 'object') {
    projectId = data.cloudaicompanionProject.id || data.cloudaicompanionProject.name;
  }

  return {
    cloudaicompanionProject: projectId,
    currentTier: data.currentTier,
    allowedTiers: data.allowedTiers,
  };
}
