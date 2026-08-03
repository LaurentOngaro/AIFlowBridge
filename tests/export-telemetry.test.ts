/**
 * Unit tests for `src/runtime/exportTelemetry.ts`.
 *
 * The command is invoked by the metrics dashboard webview when the
 * user clicks `Export CSV` / `Export JSON`. It owns the native save
 * dialog + the disk write so the export survives the default VS Code
 * webview CSP that would otherwise swallow a `blob:` URL download
 * attempt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVscode, capturedFsWrites } = vi.hoisted(() => {
  const writes: Array<{ uri: { fsPath: string }; contents: string }> = [];
  const stubChannel = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  };
  return {
    capturedFsWrites: writes,
    mockVscode: {
      Uri: {
        file: (fsPath: string) => ({ fsPath, toString: () => fsPath }),
      },
      window: {
        createOutputChannel: vi.fn(() => stubChannel),
        // Mirror the real showSaveDialog contract: takes an options
        // object (defaultUri + title + filters) and resolves to the
        // chosen URI or undefined when the user dismisses the dialog.
        showSaveDialog: vi.fn(async (_options: { defaultUri: { fsPath: string }; title?: string; filters?: Record<string, string[]> }): Promise<{ fsPath: string } | undefined> => undefined),
        showInformationMessage: vi.fn(async (_message: string) => undefined),
        showErrorMessage: vi.fn(async (_message: string) => undefined),
      },
      workspace: {
        fs: {
          writeFile: vi.fn(async (uri: { fsPath: string }, data: Uint8Array | string) => {
            writes.push({ uri, contents: typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data) });
          }),
        },
      },
    },
  };
});

vi.mock('vscode', () => {
  const mock: Record<string, unknown> = {
    Uri: mockVscode.Uri,
    window: mockVscode.window,
    workspace: mockVscode.workspace,
  };
  mock.default = mock;
  return mock;
});

vi.mock('../logger', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

import { exportTelemetryToFileCommand } from '../src/runtime/exportTelemetry';

describe('exportTelemetryToFileCommand', () => {
  beforeEach(() => {
    capturedFsWrites.length = 0;
    mockVscode.window.showSaveDialog.mockReset();
    mockVscode.window.showInformationMessage.mockReset();
    mockVscode.window.showErrorMessage.mockReset();
    mockVscode.workspace.fs.writeFile.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns { saved: false } for an invalid payload', async () => {
    const result = await exportTelemetryToFileCommand(undefined);
    expect(result).toEqual({ saved: false });
    expect(mockVscode.window.showSaveDialog).not.toHaveBeenCalled();
    expect(mockVscode.workspace.fs.writeFile).not.toHaveBeenCalled();

    const badFormat = await exportTelemetryToFileCommand({ format: 'xml' as never, filename: 'x', contents: 'y' });
    expect(badFormat).toEqual({ saved: false });
    expect(mockVscode.window.showSaveDialog).not.toHaveBeenCalled();
  });

  it('returns { saved: false } when the user dismisses the save dialog', async () => {
    mockVscode.window.showSaveDialog.mockResolvedValueOnce(undefined);
    const result = await exportTelemetryToFileCommand({ format: 'csv', filename: 'aiflowbridge-metrics-24h-2026-07-13T20-00-00-000Z.csv', contents: 'id,timestamp\n' });
    expect(result).toEqual({ saved: false });
    expect(mockVscode.window.showSaveDialog).toHaveBeenCalledTimes(1);
    expect(mockVscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(mockVscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('writes the file at the chosen URI and returns { saved: true, path }', async () => {
    const targetUri = { fsPath: '/tmp/aiflowbridge-metrics.csv' };
    mockVscode.window.showSaveDialog.mockResolvedValueOnce(targetUri);
    const contents = 'id,timestamp\nr1,2026-07-13T20:00:00.000Z\n';
    const result = await exportTelemetryToFileCommand({ format: 'csv', filename: 'aiflowbridge-metrics.csv', contents });
    expect(result).toEqual({ saved: true, path: '/tmp/aiflowbridge-metrics.csv' });
    expect(mockVscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    // The exact payload bytes must reach the disk: the dashboard
    // already escaped the CSV, we MUST NOT double-encode.
    expect(capturedFsWrites).toEqual([{ uri: targetUri, contents }]);
    expect(mockVscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(mockVscode.window.showInformationMessage.mock.calls[0][0]).toMatch(/CSV export saved to/);
  });

  it('uses the JSON format label on success', async () => {
    const targetUri = { fsPath: '/tmp/aiflowbridge-metrics.json' };
    mockVscode.window.showSaveDialog.mockResolvedValueOnce(targetUri);
    const result = await exportTelemetryToFileCommand({ format: 'json', filename: 'aiflowbridge-metrics.json', contents: '{}' });
    expect(result).toEqual({ saved: true, path: '/tmp/aiflowbridge-metrics.json' });
    expect(mockVscode.window.showInformationMessage.mock.calls[0][0]).toMatch(/JSON export saved to/);
  });

  it('strips path separators from the suggested file name (anchor to workspace folder / home)', async () => {
    const targetUri = { fsPath: '/tmp/safe-name.csv' };
    mockVscode.window.showSaveDialog.mockResolvedValueOnce(targetUri);
    // Webview-supplied filenames must not escape the suggested
    // location; the command replaces `/` and `\` with `_` so the
    // save dialog always opens in the user's workspace folder /
    // home, never at `/etc/passwd` or `C:\Windows\...`.
    await exportTelemetryToFileCommand({ format: 'csv', filename: '../../../etc/passwd.csv', contents: '' });
    expect(mockVscode.window.showSaveDialog).toHaveBeenCalledTimes(1);
    const defaultUri = mockVscode.window.showSaveDialog.mock.calls[0][0].defaultUri;
    expect(defaultUri.fsPath).not.toMatch(/[\\/]/);
    // The original extension is preserved.
    expect(defaultUri.fsPath).toMatch(/\.csv$/);
  });

  it('surfaces a write error via showErrorMessage and returns { saved: false }', async () => {
    const targetUri = { fsPath: '/tmp/locked.csv' };
    mockVscode.window.showSaveDialog.mockResolvedValueOnce(targetUri);
    mockVscode.workspace.fs.writeFile.mockRejectedValueOnce(new Error('EACCES'));
    const result = await exportTelemetryToFileCommand({ format: 'csv', filename: 'x.csv', contents: 'id\n' });
    expect(result).toEqual({ saved: false });
    expect(mockVscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(mockVscode.window.showErrorMessage.mock.calls[0][0]).toMatch(/EACCES|export failed/i);
  });
});
