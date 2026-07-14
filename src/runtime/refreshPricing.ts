/**
 * `AIFlowBridge: Refresh pricing now` command + dashboard helper.
 *
 * Fetches the live OpenRouter `/v1/models` public listing, writes the
 * result to `<globalStorageUri>/pricing-override.json`, and updates
 * the in-memory pricing registry so the dashboard tooltips, the
 * `Est. cost` card, and the next request all pick up the new rates
 * without a window reload.
 *
 * The bundled `resources/pricing.json` is NEVER updated by this path;
 * that is reserved for the release-time `scripts/refresh-bundled-pricing.mjs`
 * so the bundled date stamp always tracks a release.
 *
 * Two surfaces, one implementation (action plan item #1 / FEAT10):
 *   - Command palette: `AIFlowBridge: Refresh pricing now`
 *   - Dashboard: `Refresh prices` button (in the Gateway panel)
 *
 * Both call `refreshPricing(context)`. The dashboard pass returns a
 * `{ updated, source }` payload so the toast can quote the exact
 * number of models that changed. The command pass uses the same
 * helper and surfaces the result via `showInformation`.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger } from '../logger';
import { GLOBAL_STORAGE_PRICING_RELATIVE_PATH } from '../aiflowbridge/pricing/loader';
import { fetchOpenRouterModels, parseOpenRouterPricing, type PricingEntry } from '../aiflowbridge/pricing/openrouter-fetch';

export interface RefreshPricingResult {
  /** Number of model entries the in-memory pricing registry accepted. */
  updated: number;
  /** ISO 8601 timestamp of the refresh (for the toast / log line). */
  fetchedAt: string;
  /** Source label for diagnostics. Currently always `openrouter`. */
  source: 'openrouter';
}

export async function refreshPricingCommand(context: vscode.ExtensionContext): Promise<void> {
  try {
    const result = await refreshPricing(context);
    void vscode.window.showInformationMessage(
      `Pricing refreshed: ${result.updated} model${result.updated === 1 ? '' : 's'} updated at ${formatLocalTime(result.fetchedAt)} (source: ${result.source}).`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[AIFlowBridge] Pricing refresh failed: ${message}`);
    void vscode.window.showErrorMessage(`Pricing refresh failed: ${message}`);
  }
}

/**
 * Core refresh path: shared between the command palette and the
 * dashboard `Refresh prices` button. Returns `{ updated, source }`
 * on success; throws on network / parse / write failure so the
 * caller can show the right toast.
 */
export async function refreshPricing(context: vscode.ExtensionContext): Promise<RefreshPricingResult> {
  logger.info('[AIFlowBridge] Pricing refresh: fetching live OpenRouter /v1/models ...');
  const raw = await fetchOpenRouterModels();
  const fetchedAt = new Date().toISOString();
  const entries = parseOpenRouterPricing(raw, fetchedAt);
  const modelIds = Object.keys(entries);
  if (modelIds.length === 0) {
    throw new Error('OpenRouter returned zero metered models - refusing to write an empty override.');
  }

  // Write the override file so a reload picks up the same rates
  // without having to re-hit the network. Atomic write through a
  // `.tmp` sibling so a mid-write crash never leaves the user with
  // a half-written JSON file.
  const overrideUri = vscode.Uri.joinPath(context.globalStorageUri, ...GLOBAL_STORAGE_PRICING_RELATIVE_PATH);
  const file = {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    source: 'openrouter',
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    userFetchedAt: fetchedAt,
    models: entries,
  };
  await writeJsonAtomic(overrideUri, file);
  logger.info(`[AIFlowBridge] Pricing refresh: wrote ${modelIds.length} model(s) to ${overrideUri.toString()}`);

  return { updated: modelIds.length, fetchedAt, source: 'openrouter' };
}

async function writeJsonAtomic(uri: vscode.Uri, payload: unknown): Promise<void> {
  const tmpPath = `${uri.fsPath}.tmp-${process.pid}-${Date.now()}`;
  const json = JSON.stringify(payload, null, 2);
  await fs.writeFile(tmpPath, json, 'utf8');
  try {
    await fs.rename(tmpPath, path.normalize(uri.fsPath));
  } catch (err) {
    // Best-effort cleanup of the tmp file if the rename failed.
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

function formatLocalTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return date.toLocaleString();
  } catch {
    return iso;
  }
}
