/**
 * AIFlowBridge - shared Gemini translation constants.
 *
 * The Antigravity / Cloud Code Assist product OAuth transport has been
 * retired (see `src/aiflowbridge/google-transport-policy.ts`). Nothing in
 * this module performs authentication any more: there is no client_id, no
 * client_secret, no scope list and no token endpoint here. What remains is
 * the pair of headers the Gemini surface expects on a request carrying a
 * BYOK API key, plus the user-agent string the pure envelope translator
 * stamps into its (now unused) Cloud Code request shape.
 *
 * The OAuth client credentials that used to live in this file were removed
 * from the distributed product. The corresponding
 * `.github/secret_scanning.yml` exceptions were removed with them.
 */

/**
 * Product string stamped into the Cloud Code envelope and sent as the
 * upstream `User-Agent`. Kept because the pure translator still asserts
 * on it in unit tests; it carries no credential.
 */
export const DEFAULT_USER_AGENT = 'antigravity';

/**
 * `X-Goog-Api-Client` value the Gemini surface uses to identify the
 * calling client family. Public, non-secret.
 */
export const DEFAULT_GOOG_API_CLIENT = 'gl-kiloCode/10.4.1';