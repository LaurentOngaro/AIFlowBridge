/**
 * Vendor-prefixed API key resolution for gateway upstream profiles.
 *
 * The runtime registers auto-generated profiles for DeepSeek, MiniMax, and
 * Xiaomi under lowercase vendor ids ("deepseek-flash", "minimax",...).
 * User-declared models synthesized from `aiflowbridge.userModels` keep
 * their upstream id verbatim ("MiniMax-M3", "mimo-v2.5-pro",...), which
 * can include capitals and a different separator ("mimo-" for Xiaomi
 * MiMo). The resolver must therefore be case-insensitive and accept the
 * upstream-style alias for each vendor.
 */

import { API_KEY_SECRETS } from '../consts';
import type { SecretStorageLike } from './types';

export type KnownVendor = keyof typeof API_KEY_SECRETS;

/**
 * Minimal `get`-only contract kept for backward compatibility with the
 * existing test suite (`tests/api-key-resolver.test.ts`), which passes
 * synchronous mocks that throw or return raw values. Production callers
 * pass the wider `SecretStorageLike` (VS Code `SecretStorage` or the
 * standalone adapter) and the resolver awaits the Promise transparently.
 */
export type SecretsLike = {
  get(key: string): unknown;
};

/**
 * Source of secrets for `resolveVendorApiKey`. Accepts either the full
 * `SecretStorageLike` (VS Code `SecretStorage` and the standalone adapter
 * both implement it) or the get-only `SecretsLike` used by the unit
 * tests. The resolver only ever calls `.get()`, so the wider shape
 * carries no extra risk.
 */
export type ResolveSecretSource = SecretStorageLike | SecretsLike;

/**
 * Known id aliases (lowercased) for each vendor. The first entry is the
 * canonical vendor id used by the default auto-generated profiles; the
 * other entries are upstream-style prefixes that the gateway may encounter
 * on requests for user-added models.
 */
const VENDOR_ALIASES: Record<KnownVendor | 'antigravity' | 'googleaistudio', readonly string[]> = {
  deepseek: ['deepseek'],
  minimax: ['minimax'],
  xiaomi: ['xiaomi', 'mimo'],
  openrouter: ['openrouter'],
  antigravity: ['antigravity'],
  googleaistudio: ['googleaistudio', 'gemini'],
};

/**
 * Map a gateway provider id to the API key secret to use.
 *
 * The match is case-insensitive and looks for either an exact vendor id
 * ("minimax"), a vendor-prefixed id ("minimax-anything",
 * "MiniMax-M3", "DEEPSEEK-pro"), or a known alias like "mimo-..." for
 * Xiaomi MiMo. Returns the matching secret's value, or `undefined` if
 * no vendor matches or the secret is not set.
 */
export async function resolveVendorApiKey(vendor: string, secrets: ResolveSecretSource): Promise<string | undefined> {
  if (!vendor) {
    return undefined;
  }
  const lowered = vendor.toLowerCase();
  const knownVendors = Object.keys(API_KEY_SECRETS) as KnownVendor[];

  const matched = knownVendors.find((kv) => {
    for (const alias of VENDOR_ALIASES[kv]) {
      if (lowered === alias || lowered.startsWith(`${alias}-`)) {
        return true;
      }
    }
    return false;
  });

  if (!matched) {
    return undefined;
  }
  try {
    const value = await secrets.get(API_KEY_SECRETS[matched]);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
