/**
 * `vscode` module shim for the standalone build.
 *
 * The standalone entry point (`src/standalone/main.ts`) imports the same
 * gateway code as the VS Code extension. That code still references
 * `vscode.workspace.getConfiguration`, `vscode.window.createOutputChannel`,
 * etc. - primarily through `src/logger.ts` and `src/config.ts` which the
 * standalone build still includes.
 *
 * The standalone build does not have access to the real `vscode` module
 * (there is no extension host). This shim provides the bare minimum the
 * included files need, wired to `node:fs`, `process.stdout`, and the
 * standalone `~/.aiflowbridge/` config file.
 *
 * The shim is selected via TypeScript path mapping in
 * `tsconfig.standalone.json` (`paths: { "vscode": ["./src/standalone/vscode-shim.ts"] }`).
 * The main extension build does NOT use this shim - it imports the real
 * `vscode` module from `@types/vscode`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const FALLBACK_CONFIG_PATH = join(homedir(), '.aiflowbridge', 'config.json');

function getConfigurationFromEnv(): Record<string, unknown> {
  // The standalone config is loaded by `src/standalone/context.ts` and
  // exposed through `IGatewayContext.getConfiguration()`. The shim
  // returns a `WorkspaceConfiguration`-shaped wrapper that reads from
  // the same JSON file via `process.env.AIFLOWBRIDGE_CONFIG_PATH` (set
  // by `main.ts` before any module imports the logger).
  const configPath = process.env.AIFLOWBRIDGE_CONFIG_PATH || FALLBACK_CONFIG_PATH;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // File missing or unreadable - fall through to empty.
  }
  return {};
}

function getNestedValue(root: Record<string, unknown>, key: string): unknown {
  const segments = key.split('.');
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

const configCache = getConfigurationFromEnv();

class WorkspaceConfigurationShim {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = getNestedValue(configCache, key);
    if (value === undefined) {
      return defaultValue as T | undefined;
    }
    return value as T;
  }
  has(key: string): boolean {
    return getNestedValue(configCache, key) !== undefined;
  }
  inspect<T>(key: string): { workspaceValue?: T; globalValue?: T } | undefined {
    const value = getNestedValue(configCache, key);
    if (value === undefined) {
      return undefined;
    }
    return { globalValue: value as T };
  }
  update(): Promise<void> {
    return Promise.resolve();
  }
}

class LogOutputChannelShim {
  constructor(
    public readonly name: string,
    private readonly options?: { log?: boolean }
  ) {}
  append(text: string): void {
    process.stdout.write(text + '\n');
  }
  appendLine(text: string): void {
    process.stdout.write(text + '\n');
  }
  info(text: string): void {
    process.stdout.write(`[INFO]  ${text}\n`);
  }
  warn(text: string): void {
    process.stderr.write(`[WARN]  ${text}\n`);
  }
  error(text: string): void {
    process.stderr.write(`[ERROR] ${text}\n`);
  }
  debug(text: string): void {
    if (this.options?.log) {
      process.stdout.write(`[DEBUG] ${text}\n`);
    }
  }
  show(): void {
    /* no-op in standalone mode */
  }
  hide(): void {
    /* no-op in standalone mode */
  }
  clear(): void {
    /* no-op in standalone mode */
  }
  dispose(): void {
    /* no-op in standalone mode */
  }
}

// ---- No-op stubs for VS Code UI APIs not available in standalone mode ----
//
// The UI files (`src/aiflowbridge/ui/statusbar.ts`, `.../ui/dashboard.ts`)
// still import these names from `vscode`. The standalone build wires
// them to no-op stubs so the runtime can be activated without a webview
// host. The actual `StatusBarController.update()` becomes a no-op because
// the shimmed status bar item has no real backing, and `showMetricsDashboard`
// throws when called (the dashboard is VS Code-only).

const NOOP_STATUS_BAR_ITEM = {
  text: '',
  tooltip: undefined as string | undefined,
  command: undefined as string | undefined,
  show() {
    /* no-op */
  },
  hide() {
    /* no-op */
  },
  dispose() {
    /* no-op */
  },
};

const NOOP_WEBVIEW = {
  html: '',
  options: { enableScripts: true },
  cspSource: '',
  onDidReceiveMessage(_listener: (msg: unknown) => void): { dispose: () => void } {
    return { dispose: () => undefined };
  },
  postMessage(_msg: unknown): Promise<boolean> {
    return Promise.resolve(true);
  },
  asWebviewUri(_uri: { fsPath: string }): { fsPath: string; toString(): string } {
    return { fsPath: '', toString: () => '' };
  },
};

const NOOP_WEBVIEW_PANEL = {
  viewType: '',
  title: '',
  webview: NOOP_WEBVIEW,
  visible: false,
  reveal(_column?: unknown): void {
    /* no-op */
  },
  dispose(): void {
    /* no-op */
  },
  onDidDispose(_listener: () => void): { dispose: () => void } {
    return { dispose: () => undefined };
  },
};

const noopThenable = Promise.resolve();

export const workspace = {
  getConfiguration(_section?: string): WorkspaceConfigurationShim {
    return new WorkspaceConfigurationShim();
  },
  onDidChangeConfiguration(_listener: (e: { affectsConfiguration: (s: string) => boolean }) => void): { dispose: () => void } {
    // No-op: standalone config reload is wired through IGatewayContext.onConfigChange.
    return { dispose: () => undefined };
  },
  workspaceFolders: undefined as Array<{ uri: { fsPath: string }; name: string; index: number }> | undefined,
  fs: {
    async readFile(uri: { fsPath: string }): Promise<Uint8Array> {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs/promises') as typeof import('node:fs/promises');
      const buffer = await fs.readFile(uri.fsPath);
      return new Uint8Array(buffer);
    },
    async writeFile(): Promise<void> {
      throw new Error('[vscode-shim] vscode.workspace.fs.writeFile is not supported in standalone mode');
    },
  },
};

export const window = {
  createOutputChannel(name: string, options?: { log?: boolean }): LogOutputChannelShim {
    return new LogOutputChannelShim(name, options);
  },
  createStatusBarItem(_alignment?: unknown, _priority?: number) {
    return NOOP_STATUS_BAR_ITEM;
  },
  createWebviewPanel(_viewType: string, _title: string, _column?: unknown, _options?: unknown) {
    return NOOP_WEBVIEW_PANEL;
  },
  showInformationMessage(_message: string, ..._items: string[]): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },
  showWarningMessage(_message: string, ..._items: string[]): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },
  showErrorMessage(_message: string, ..._items: string[]): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
} as const;

export const commands = {
  registerCommand(_command: string, _callback: (...args: unknown[]) => unknown): { dispose: () => void } {
    return { dispose: () => undefined };
  },
  executeCommand(_command: string, ..._args: unknown[]): Promise<unknown> {
    return noopThenable;
  },
};

export const env = {
  clipboard: {
    writeText(_text: string): Promise<void> {
      return Promise.resolve();
    },
  },
  openExternal(_target: unknown): Promise<boolean> {
    return Promise.resolve(false);
  },
};

export const Uri = {
  joinPath(base: { fsPath: string }, ...segments: string[]): { fsPath: string; toString(): string } {
    const fsPath = [base.fsPath.replace(/\/+$/, ''), ...segments].join('/');
    return { fsPath, toString: () => fsPath };
  },
  file(path: string): { fsPath: string; toString(): string } {
    return { fsPath: path, toString: () => path };
  },
};

export const SecretStorageShim = class {
  secrets = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }
};

// Types-only exports so the rest of the gateway code can keep its
// `vscode.ExtensionContext` / `vscode.SecretStorage` / `vscode.Uri`
// annotations. These are erased at compile time.
export interface ExtensionContext {
  extensionUri: { fsPath: string };
  globalStorageUri: { fsPath: string };
  subscriptions: Array<{ dispose: () => void }>;
  secrets: SecretStorage;
  extension: { packageJSON: { version?: string } };
}
export interface FileSystem {
  readFile(uri: Uri): Promise<Uint8Array>;
}
export interface Uri {
  fsPath: string;
  toString(): string;
}
export interface WorkspaceConfiguration {
  get<T>(section: string): T | undefined;
  get<T>(section: string, defaultValue: T): T;
  has(section: string): boolean;
  inspect<T>(section: string): { workspaceValue?: T; globalValue?: T } | undefined;
  update(section: string, value: unknown): Promise<void>;
}
export interface LogOutputChannel {
  name: string;
  append(text: string): void;
  appendLine(text: string): void;
  info(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  debug(text: string): void;
  show(): void;
  hide(): void;
  clear(): void;
  dispose(): void;
}
export interface SecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface Disposable {
  dispose(): void;
}
export interface Webview {
  html: string;
  options: { enableScripts: boolean };
  onDidReceiveMessage(listener: (msg: unknown) => void): { dispose: () => void };
  postMessage(msg: unknown): Promise<boolean>;
  asWebviewUri(uri: Uri): Uri;
  cspSource: string;
}
export interface WebviewPanel {
  viewType: string;
  title: string;
  webview: Webview;
  visible: boolean;
  reveal(column?: unknown): void;
  dispose(): void;
  onDidDispose(listener: () => void): { dispose: () => void };
}
export interface WebviewOptions {
  enableScripts: boolean;
  retainContextWhenHidden?: boolean;
}
export interface WorkspaceFolder {
  uri: Uri;
  name: string;
  index: number;
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

const defaultExport = {
  workspace,
  window,
  commands,
  env,
  Uri,
  ConfigurationTarget,
};
export default defaultExport;
