/**
 * VS Code adapter for `IGatewayContext`.
 *
 * Wraps a `vscode.ExtensionContext` into the runtime-agnostic
 * `IGatewayContext` interface consumed by `AIFlowBridgeRuntime`. The
 * adapter owns the wiring between the runtime and the VS Code host:
 *   - `vscode.ExtensionContext.secrets`     -> `ctx.secrets`
 *   - `vscode.ExtensionContext.globalStorageUri.fsPath` -> `ctx.globalStorageDir`
 *   - `vscode.ExtensionContext.extension.packageJSON.version` -> `ctx.extensionVersion`
 *   - `vscode.workspace.getConfiguration("aiflowbridge")` -> `ctx.getConfiguration()`
 *   - `vscode.workspace.onDidChangeConfiguration` -> `ctx.onConfigChange()`
 *   - `vscode.commands.registerCommand`     -> `ctx.registerCommand()`
 *   - `vscode.window.showInformationMessage` -> `ctx.showInformation()`
 *   - `vscode.window.showWarningMessage`     -> `ctx.showWarning()`
 *   - `vscode.window.showWarningMessage` (modal) -> `ctx.confirm`
 *   - `vscode.env.clipboard.writeText`       -> `ctx.clipboardWrite`
 *   - `workbench.action.openSettings`        -> `ctx.openSettings`
 *   - `vscode.commands.executeCommand`       -> `ctx.executeCommand`
 *   - `vscode.ExtensionContext.globalState`  -> `ctx.globalState`
 *   - `vscode.ExtensionContext.subscriptions` -> `ctx.subscriptions`
 *
 * The adapter also re-exposes the vscode-specific fields the model
 * registry loader needs (`fs`, `extensionUri`, `workspaceFolder`) via the
 * `IGatewayContext` fields of the same name.
 *
 * The `subscriptions` field is a real `Disposable[]` array. Each `push`
 * also mirrors the entry into the host `vscode.ExtensionContext.subscriptions`
 * so VS Code cleans it up on deactivation. The extensions to the
 * standard `Array` (forEach, filter, map, length, index access) are
 * implemented via a Proxy so callers can iterate over the bag without
 * crashing (B-04: a hand-rolled object cast to `Disposable[]` had
 * `length: 0` and no iteration methods).
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import { createGatewaySecrets } from './api-key-sources';
import type { ConfigReader, Disposable, FileSystemLike, GlobalStateLike, IGatewayContext, UriLike } from './types';

class VscodeDisposableAdapter implements Disposable {
  constructor(private readonly inner: vscode.Disposable) {}
  dispose(): void {
    this.inner.dispose();
  }
}

class VscodeConfigReader implements ConfigReader {
  constructor(private readonly inner: vscode.WorkspaceConfiguration) {}
  get<T>(key: string, fallback?: T): T {
    // `vscode.WorkspaceConfiguration.get<T>` returns `T | undefined`,
    // while our `ConfigReader` contract returns `T` (fallback is always
    // applied). The fallback is enforced here so the rest of the code can
    // stay strict-null-safe.
    if (fallback === undefined) {
      const value = this.inner.get<T>(key);
      return value as T;
    }
    const value = this.inner.get<T>(key, fallback);
    return value === undefined ? fallback : value;
  }
}

class VscodeFileSystemAdapter implements FileSystemLike {
  constructor(private readonly inner: vscode.FileSystem) {}
  readFile(uri: UriLike): Promise<Uint8Array> {
    // The `UriLike` reaching this adapter is one of two shapes:
    // 1. A `VscodeUriAdapter` wrapping a real `vscode.Uri` (when the
    // caller passed `host.extensionUri` straight through).
    // 2. A plain `{ fsPath, toString }` object produced by
    // `joinPath()` in `modelRegistry.ts` (path-string concatenation,
    // no `scheme` / `authority`).
    // `vscode.workspace.fs.readFile` requires a real `vscode.Uri` - the
    // internal `FileSystemProvider` looks up `scheme` + `authority` to
    // resolve the right provider, and a plain object triggers
    // "Unable to resolve filesystem provider with relative file path ''"
    // at activation. Convert via `vscode.Uri.file()` (all our paths are
    // filesystem paths, never `vscode://` / `git://` / etc.).
    const vscodeUri = uri instanceof vscode.Uri ? uri : vscode.Uri.file((uri as { fsPath: string }).fsPath);
    // `vscode.FileSystem.readFile` returns a Thenable; we cast to Promise
    // (Thenable is structurally a Promise for the await / then use cases).
    return this.inner.readFile(vscodeUri) as unknown as Promise<Uint8Array>;
  }
}

class VscodeUriAdapter implements UriLike {
  constructor(private readonly inner: vscode.Uri) {}
  get fsPath(): string {
    return this.inner.fsPath;
  }
  toString(): string {
    return this.inner.toString();
  }
}

class VscodeGlobalStateAdapter implements GlobalStateLike {
  // `globalState` is not part of the standalone `vscode-shim`'s
  // `ExtensionContext` shape (the standalone CLI never persists
  // state across runs in the same way), so we accept the structural
  // shape here instead of indexing into the imported namespace.
  constructor(private readonly inner: { get<T>(key: string): T | undefined; update(key: string, value: unknown): unknown }) {}
  get<T>(key: string): T | undefined {
    return this.inner.get<T>(key);
  }
  update(key: string, value: unknown): Promise<void> {
    const result = this.inner.update(key, value);
    return Promise.resolve(result as Promise<void> | void).then(() => undefined);
  }
}

export function createVSCodeContext(context: vscode.ExtensionContext): IGatewayContext {
  // Real Array, mirrored into the host's `context.subscriptions` on every
  // push. The Proxy forward keeps `length` / `forEach` / `filter` / `map`
  // / index access fully functional for callers that iterate the bag
  // (B-04 - the previous hand-rolled object was a frozen `length: 0`
  // and had no iteration methods).
  const subscriptionsBag: Disposable[] = new Proxy([] as Disposable[], {
    get(target, prop, receiver) {
      if (prop === 'push') {
        return (...items: Disposable[]): number => {
          for (const item of items) {
            (target as Disposable[]).push(item);
            context.subscriptions.push(new VscodeDisposableAdapter(item as vscode.Disposable));
          }
          return (target as Disposable[]).length;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return {
    // Unified env -> secrets.json -> SecretStorage chain (same ordering
    // as the standalone CLI). Writes still go to VS Code SecretStorage
    // so the "Set API Key" commands keep using the OS keychain.
    secrets: createGatewaySecrets({
      secretsPath: join(context.globalStorageUri.fsPath, 'secrets.json'),
      fallback: {
        get: (key) => context.secrets.get(key) as unknown as Promise<string | undefined>,
        store: (key, value) => context.secrets.store(key, value) as unknown as Promise<void>,
        delete: (key) => context.secrets.delete(key) as unknown as Promise<void>,
      },
      fallbackLabel: 'SecretStorage (VS Code)',
    }),
    globalStorageDir: context.globalStorageUri.fsPath,
    extensionVersion: context.extension.packageJSON.version ?? '0.0.0',
    subscriptions: subscriptionsBag,
    onConfigChange: (cb: (event?: { affectsGateway: boolean }) => void): Disposable => {
      const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('aiflowbridge')) {
          cb({ affectsGateway: e.affectsConfiguration('aiflowbridge.gateway') });
        }
      });
      return new VscodeDisposableAdapter(disposable);
    },
    getConfiguration: (): ConfigReader => {
      return new VscodeConfigReader(vscode.workspace.getConfiguration('aiflowbridge'));
    },
    registerCommand: (command: string, callback: (...args: unknown[]) => unknown): Disposable => {
      const disposable = vscode.commands.registerCommand(command, callback);
      return new VscodeDisposableAdapter(disposable);
    },
    showInformation: (message: string): void => {
      // `showInformationMessage` returns a Thenable; we discard the result.
      // The Thenable is structurally compatible with Promise for our use
      // (we don't await / chain), so the cast is safe.
      void (vscode.window.showInformationMessage(message) as unknown as Promise<void>);
    },
    showWarning: (message: string): void => {
      void (vscode.window.showWarningMessage(message) as unknown as Promise<void>);
    },
    confirm: async (message: string, ...buttons: string[]): Promise<string | undefined> => {
      // The standalone `vscode-shim` types `showWarningMessage` with the
      // legacy `(message,...items)` signature; the real VS Code API
      // accepts the modal options object as the second argument. Cast
      // through `unknown` to bridge the two without losing the option
      // at runtime.
      const result = await (
        vscode.window.showWarningMessage as unknown as (m: string, o: { modal: boolean }, ...b: string[]) => Promise<string | undefined>
      )(message, { modal: true }, ...buttons);
      return result;
    },
    clipboardWrite: (text: string): void => {
      void vscode.env.clipboard.writeText(text);
    },
    openSettings: (query?: string): void => {
      void vscode.commands.executeCommand('workbench.action.openSettings', query);
    },
    executeCommand: async (command: string, ...args: unknown[]): Promise<unknown> => {
      return await vscode.commands.executeCommand(command, ...args);
    },
    fs: new VscodeFileSystemAdapter(vscode.workspace.fs),
    extensionUri: new VscodeUriAdapter(context.extensionUri),
    workspaceFolder: vscode.workspace.workspaceFolders?.[0] ? new VscodeUriAdapter(vscode.workspace.workspaceFolders[0].uri) : undefined,
    globalState: new VscodeGlobalStateAdapter(
      // The standalone shim does not declare `globalState` on
      // `ExtensionContext`; cast through `unknown` to reach the real
      // VS Code Memento at runtime.
      (context as unknown as { globalState: { get<T>(key: string): T | undefined; update(key: string, value: unknown): unknown } }).globalState
    ),
  };
}
