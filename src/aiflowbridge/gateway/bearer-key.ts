/**
 * Defense-in-depth validation for resolved upstream API keys before
 * they are injected into the `Authorization: Bearer <key>` header.
 *
 * The audit (audit 04, section 2.2) flagged the absence of any
 * shape check on `resolvedKey`: a local attacker who could write to
 * the VS Code `SecretStorage` (the same store that holds the user's
 * legitimate upstream key) could plant an arbitrary string that the
 * gateway would then splice verbatim into the upstream header. The
 * usual upstream providers reject the resulting 400+ response, but
 * the gateway also forwards a sanitized error body back to the
 * client - which can echo attacker-controlled fragments to the
 * caller's logs.
 *
 * Validation rules (chosen to accept every legitimate provider key
 * the project ships with and reject anything that looks hostile):
 *   - Length must be 1..512 characters. 512 is comfortably above the
 *     longest shipped key (typical 32-128 chars) and well below any
 *     payload that would inflate the upstream header.
 *   - All characters must be printable ASCII (`U+0021`..`U+007E`).
 *     Excludes control characters, newlines, the space character,
 *     and any non-ASCII byte. A `CRLF` injection is therefore
 *     impossible from the start of the value.
 *
 * Returns `true` for the empty string (the helper is meant to be
 * called with a non-empty `resolvedKey`; an empty value means "no
 * auth" and the upstream request is sent without the header).
 */

const MAX_BEARER_KEY_LENGTH = 512;

/**
 * Printable ASCII (0x21..0x7E) excludes space and control chars,
 * which makes it safe to splice into an HTTP header value without
 * any further escaping. The character class is intentionally
 * anchored - `^...$` - so a partial match (e.g. a valid prefix
 * followed by a `CRLF`) cannot pass.
 */
const BEARER_KEY_PRINTABLE_ASCII = /^[\x21-\x7E]+$/;

export function isValidBearerKey(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  if (value.length === 0 || value.length > MAX_BEARER_KEY_LENGTH) {
    return false;
  }
  return BEARER_KEY_PRINTABLE_ASCII.test(value);
}

export const __testing__ = {
  MAX_BEARER_KEY_LENGTH,
  BEARER_KEY_PRINTABLE_ASCII,
};
