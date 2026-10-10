/**
 * AIFlowBridge - registry override read helpers.
 *
 * The 3-tier model registry merge (`resources/models.json` <
 * `<globalStorageDir>/models.json` < `.vscode/aiflowbridge.models.json`)
 * is silent: a stale override in globalStorage can hijack a provider
 * without any user-visible signal. Audit BUG-02 surfaced exactly that
 * failure mode on the Google AI Studio integration: the user toggled
 * the route via the setting, but the globalStorage override still
 * pointed at the retired OAuth upstream and silently re-routed the
 * request.
 *
 * The Google AI Studio migration command uses `readRegistryVendorBaseUrl`
 * to resolve which tier of that chain still carries a retired `baseUrl`,
 * so the message can name the exact file the user has to edit.
 *
 * The read is pure: never writes, never throws. A missing, unparseable
 * or non-matching file yields `undefined`.
 */

import { join } from 'node:path';

interface RegistryVendorFile {
  vendors?: Record<string, { baseUrl?: unknown }>;
}

function extractVendorBaseUrl(parsed: unknown, vendorKeys: readonly string[]): string | undefined {
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const vendors = (parsed as RegistryVendorFile).vendors;
  if (!vendors || typeof vendors !== 'object') {
    return undefined;
  }
  for (const key of vendorKeys) {
    const entry = vendors[key];
    if (entry && typeof entry.baseUrl === 'string' && entry.baseUrl.trim().length > 0) {
      return entry.baseUrl;
    }
  }
  return undefined;
}

interface RegistryFileReader {
  readFile(uri: { fsPath: string }): Promise<Uint8Array>;
}

/**
 * Best-effort read of the first matching vendor `baseUrl` from a
 * registry override file (`vendors.<key>.baseUrl` for any of
 * `vendorKeys`). Returns `undefined` when the file is missing,
 * unparseable, or carries no matching vendor entry. Pure read - never
 * writes, never throws. The Google AI Studio migration command uses it
 * to resolve the effective baseUrl from the workspace and globalStorage
 * tiers.
 */
export async function readRegistryVendorBaseUrl(
  fs: RegistryFileReader,
  baseDir: string,
  relativePath: readonly string[],
  vendorKeys: readonly string[]
): Promise<string | undefined> {
  const filePath = join(baseDir, ...relativePath);
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile({ fsPath: filePath });
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    return extractVendorBaseUrl(parsed, vendorKeys);
  } catch {
    return undefined;
  }
}