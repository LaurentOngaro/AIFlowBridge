/**
 * VS Code adapter for `IGatewayContext` (FEAT7).
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
 *   - `vscode.ExtensionContext.subscriptions` -> `ctx.subscriptions`
 *
 * The adapter also re-exposes the vscode-specific fields the model
 * registry loader needs (`fs`, `extensionUri`, `workspaceFolder`) via the
 * `IGatewayContext` fields of the same name.
 *
 * The `subscriptions` field is a real `Disposable[]` array. Each `push`
 * also mirrors the entry into the host `vscode.ExtensionContext.subscriptions`
 * so VS Code cleans it up on deactivation.
 */

import * as vscode from "vscode";
import type { ConfigReader, Disposable, FileSystemLike, IGatewayContext, UriLike } from "./types";

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
    // `vscode.FileSystem.readFile` returns a Thenable; we cast to Promise
    // (Thenable is structurally a Promise for the await / then use cases).
    return this.inner.readFile(uri as vscode.Uri) as unknown as Promise<Uint8Array>;
  }
}

class VscodeUriAdapter implements UriLike {
  constructor(private readonly inner: vscode.Uri) {}
  get fsPath(): string {
    return this.inner.fsPath;
  }
}

export function createVSCodeContext(context: vscode.ExtensionContext): IGatewayContext {
  const subscriptions: Disposable[] = [];

  // Mirror every push into the host's `context.subscriptions` so VS Code
  // disposes everything on deactivation, without forcing the runtime to
  // know about vscode.Disposable.
  const subscriptionsBag: Disposable[] = {
    length: 0,
    push(...items: Disposable[]): number {
      for (const item of items) {
        subscriptions.push(item);
        context.subscriptions.push(new VscodeDisposableAdapter(item as vscode.Disposable));
      }
      return subscriptions.length;
    },
  } as unknown as Disposable[];

  return {
    secrets: {
      get: (key) => context.secrets.get(key) as unknown as Promise<string | undefined>,
      store: (key, value) => context.secrets.store(key, value) as unknown as Promise<void>,
      delete: (key) => context.secrets.delete(key) as unknown as Promise<void>,
    },
    globalStorageDir: context.globalStorageUri.fsPath,
    extensionVersion: context.extension.packageJSON.version ?? "0.0.0",
    subscriptions: subscriptionsBag,
    onConfigChange: (cb: () => void): Disposable => {
      const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("aiflowbridge")) {
          cb();
        }
      });
      return new VscodeDisposableAdapter(disposable);
    },
    getConfiguration: (): ConfigReader => {
      return new VscodeConfigReader(vscode.workspace.getConfiguration("aiflowbridge"));
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
    fs: new VscodeFileSystemAdapter(vscode.workspace.fs),
    extensionUri: new VscodeUriAdapter(context.extensionUri),
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]
      ? new VscodeUriAdapter(vscode.workspace.workspaceFolders[0].uri)
      : undefined,
  };
}