/**
 * AIFlowBridge - Antigravity / Google AI Studio provider constants.
 *
 * Centralizes OAuth endpoints, public client credentials, Cloud Code Assist API
 * URLs, scopes, default headers, and token refresh safety margins.
 *
 * SECURITY: the OAuth client_id and client_secret below are the well-known
 * public Antigravity CLI credentials - they are bundled in the official
 * Google Antigravity binary and are intentionally public so anyone can build
 * a compatible client. They are kept here as defaults so the OAuth route
 * works out-of-the-box without forcing every operator to extract them from
 * their Antigravity install. Users who want to use their own Google Cloud
 * OAuth client can override both via `AIFLOWBRIDGE_GOOGLE_CLIENT_ID` and
 * `AIFLOWBRIDGE_GOOGLE_CLIENT_SECRET` env vars.
 *
 * The constants file is whitelisted in `.github/secret_scanning.yml`
 * (`paths-ignore` for this exact path) so the GitHub push protection does
 * not block on this public-but-pattern-matching secret. Reviewers MUST
 * still treat these two values as the same fixed strings shipped by the
 * official Antigravity binary - any change risks breaking every install.
 */

export const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';

export const CLOUDCODE_BASE_URL = 'https://cloudcode-pa.googleapis.com';
export const CLOUDCODE_LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
export const CLOUDCODE_MODELS_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
export const CLOUDCODE_STREAM_URL = 'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse';

export const DEFAULT_CLIENT_ID =
  process.env.AIFLOWBRIDGE_GOOGLE_CLIENT_ID ||
  '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

export const DEFAULT_CLIENT_SECRET =
  process.env.AIFLOWBRIDGE_GOOGLE_CLIENT_SECRET ||
  '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';

export const CLOUDCODE_SCOPES: readonly string[] = Object.freeze([
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
]);

export const DEFAULT_USER_AGENT = 'antigravity';
export const DEFAULT_GOOG_API_CLIENT = 'gl-kiloCode/10.4.1';
export const DEFAULT_CLIENT_METADATA = JSON.stringify({
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
});

/** Margin before actual token expiry to trigger a proactive refresh (60 seconds). */
export const TOKEN_EXPIRATION_SAFETY_MARGIN_MS = 60_000;

/** Key used to persist tokens in secrets.json. */
export const ANTIGRAVITY_SECRET_KEY = 'antigravity';

/** Default callback server port range or fallback. */
export const DEFAULT_CALLBACK_PORT = 51121;
