/**
 * Google Antigravity / Cloud Code Assist endpoints and OAuth settings.
 *
 * These endpoints are INTERNAL to Google's tooling and may change without
 * notice. Every reference MUST live here so a breaking change upstream is a
 * one-file fix. Never scatter URLs or scopes through the codebase.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL =
  'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';

export const CLOUDCODE_BASE_URL = 'https://cloudcode-pa.googleapis.com';
export const CLOUDCODE_LOAD_CODE_ASSIST_URL = `${CLOUDCODE_BASE_URL}/v1internal:loadCodeAssist`;
export const CLOUDCODE_FETCH_MODELS_URL = `${CLOUDCODE_BASE_URL}/v1internal:fetchAvailableModels`;
export const CLOUDCODE_STREAM_URL = `${CLOUDCODE_BASE_URL}/v1internal:streamGenerateContent?alt=sse`;

/** OAuth scopes requested for Antigravity / Cloud Code Assist access. */
export const ANTIGRAVITY_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

/**
 * Name of the environment variable holding the OAuth installed-app client id.
 * A real client id must come from the operator's local configuration (never
 * committed to this public repository).
 */
export const ANTIGRAVITY_OAUTH_CLIENT_ID_ENV = 'AIFLOWBRIDGE_ANTIGRAVITY_CLIENT_ID';

/** User-Agent expected by the Cloud Code Assist endpoints. */
export const ANTIGRAVITY_USER_AGENT = 'antigravity';

/** X-Goog-Api-Client header value observed on official clients. */
export const GOOGLE_API_CLIENT_HEADER = 'google-cloud-sdk vscode_cloudshelleditor/0.1';

/** Client-Metadata payload sent to loadCodeAssist. */
export const ANTIGRAVITY_CLIENT_METADATA = {
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
} as const;

/** Re-request an access token this long before its nominal expiry. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/** secrets.json key holding the Antigravity OAuth token bundle. */
export const ANTIGRAVITY_SECRETS_KEY = 'antigravity';
