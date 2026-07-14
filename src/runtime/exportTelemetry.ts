/**
 * `AIFlowBridge: Export telemetry to file` (internal command).
 *
 * Called by the metrics dashboard webview via
 * `vscode.commands.executeCommand('aiflowbridge.exportToFile', payload)`
 * when the user clicks the `Export CSV` / `Export JSON` button.
 * The webview builds the export payload client-side (so the download
 * honors every active dashboard filter - preset / provider / dates /
 * search / inactivity gap) then ships it to the host; the host owns
 * the save dialog + disk write because the default VS Code webview
 * CSP blocks the `blob:` URL a synthetic anchor download would need.
 *
 * The command:
 *   1. Shows a native `vscode.window.showSaveDialog` with the
 *      payload filename as default.
 *   2. Writes the file via `vscode.workspace.fs.writeFile`.
 *   3. Shows a brief information toast on success (or no-op if the
 *      user dismissed the dialog).
 *
 * Returns `{ saved: boolean }` so the dashboard can post a transient
 * toast via `exportResult`.
 */

import * as vscode from 'vscode';
import { logger } from '../logger';

export interface ExportTelemetryPayload {
  format: 'csv' | 'json';
  filename: string;
  /** The serialized file contents (UTF-8). The host writes them verbatim. */
  contents: string;
}

export interface ExportTelemetryResult {
  saved: boolean;
  /** Absolute path of the saved file (when `saved = true`). */
  path?: string;
}

export async function exportTelemetryToFileCommand(
  payload: ExportTelemetryPayload | undefined,
): Promise<ExportTelemetryResult> {
  if (!payload || (payload.format !== 'csv' && payload.format !== 'json')) {
    return { saved: false };
  }

  // Strip any directory components the webview might have smuggled in -
  // we always anchor the save dialog to the user's workspace folder (or
  // home) and use only the basename as the suggested file name.
  const basename = payload.filename.replace(/[\\/]/g, '_');
  const defaultUri = vscode.Uri.file(basename);

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    title: payload.format === 'csv' ? 'Export metrics as CSV' : 'Export metrics as JSON',
    filters: payload.format === 'csv'
      ? { 'CSV files': ['csv'] }
      : { 'JSON files': ['json'] },
  });
  if (!saveUri) {
    // User dismissed the dialog: silent no-op (no toast, no error).
    return { saved: false };
  }

  try {
    // WriteFile accepts a Uint8Array or string; UTF-8 encoding is the
    // default for the JSON payload (we ship the literal `\n` already
    // escaped by the dashboard's buildJsonExport helper) and the
    // correct charset for CSV.
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(payload.contents, 'utf8'));
    logger.info(`[AIFlowBridge] Wrote ${payload.format} export to ${saveUri.fsPath}`);
    void vscode.window.showInformationMessage(
      `AIFlowBridge: ${payload.format.toUpperCase()} export saved to ${saveUri.fsPath}`
    );
    return { saved: true, path: saveUri.fsPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[AIFlowBridge] ${payload.format.toUpperCase()} export failed: ${message}`);
    void vscode.window.showErrorMessage(`AIFlowBridge export failed: ${message}`);
    return { saved: false };
  }
}
