import * as vscode from "vscode";
import { loadConfig } from "./config";
import { GatewayService, isPortInUse } from "./gateway/server";
import { resolveVendorApiKey } from "./api-key-resolver";
import { TelemetryStore } from "./telemetry";
import { TelemetryPersister, defaultTelemetryPaths } from "./telemetry/persistence";
import type { AiFlowBridgeConfig, GatewayStatus, TelemetrySnapshot } from "./types";
import { showMetricsDashboard } from "./ui/dashboard";
import { StatusBarController } from "./ui/statusbar";
import { logger } from "../logger";

const TELEMETRY_STORAGE_KEY = "aiflowbridge.telemetry.v1";

class AIFlowBridgeRuntime {
  private config!: AiFlowBridgeConfig;
  private gateway!: GatewayService;
  private readonly statusBar: StatusBarController;
  private telemetryFallback!: TelemetryStore;
  private persister: TelemetryPersister | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    // The gateway and config are built in `activate()` (not as class
    // fields) so the load / save callbacks can close over `this.context`,
    // which is only set by the parameter property above. Class field
    // initializers run before the parameter property assignment, so
    // wiring the gateway in the field initializer would crash with
    // `Cannot read properties of undefined (reading 'globalState')`
    // (BUG06). The `init()` call then safely wires persistence now that
    // the context exists.
    this.statusBar = new StatusBarController();
  }

  private loadPersistedTelemetry(): TelemetrySnapshot | undefined {
    // File is the source of truth (FEAT1). If the file does not exist
    // yet (e.g. first ever activation), fall back to the legacy
    // globalState slot for the one-time migration in `activate()`.
    if (this.persister) {
      const fromDisk = this.persister.loadSync();
      if (fromDisk) {
        return fromDisk;
      }
    }
    return this.context.globalState.get<TelemetrySnapshot>(TELEMETRY_STORAGE_KEY);
  }

  private savePersistedTelemetry(snapshot: TelemetrySnapshot): void {
    // No-op: the file-based persister is wired directly into the
    // TelemetryStore.record() path. The callback is preserved for the
    // GatewayService contract but does nothing when a persister is set.
    if (!this.persister) {
      void this.context.globalState.update(TELEMETRY_STORAGE_KEY, snapshot);
    }
  }

  async activate(): Promise<void> {
    logger.info("[AIFlowBridge] Activating...");

    this.config = await loadConfig(this.context);

    // FEAT1: build the file-based telemetry persister (per-OS-user,
    // per-machine, NOT per-workspace). Stored under globalStorageUri
    // so the file is independent of the current workspace and shared
    // across every VS Code window the user opens.
    const telemetryPaths = defaultTelemetryPaths(this.context.globalStorageUri.fsPath);
    this.persister = new TelemetryPersister(telemetryPaths);
    this.telemetryFallback = new TelemetryStore(this.persister);

    this.gateway = new GatewayService(
      this.config,
      (status, snapshot) => this.refreshUi(status, snapshot),
      (vendor) => resolveVendorApiKey(vendor, this.context.secrets),
      () => this.loadPersistedTelemetry(),
      (snapshot) => this.savePersistedTelemetry(snapshot),
      this.context.extension.packageJSON.version ?? "0.0.0",
      undefined,
      this.persister,
    );
    this.gateway.init();

    // One-time migration: if the user is upgrading from a version
    // older than 1.5.0, the legacy `globalState` slot has their
    // cumulative counters but the new file does not. Move them over
    // and clear the legacy slot so the file is the only source of
    // truth going forward.
    const diskEmpty = this.persister.loadSync() === undefined;
    const legacySnapshot = this.context.globalState.get<TelemetrySnapshot>(TELEMETRY_STORAGE_KEY);
    if (diskEmpty && legacySnapshot) {
      logger.info(
        `[AIFlowBridge] Migrating telemetry from globalState to ${telemetryPaths.filePath} ` +
          `(${legacySnapshot.requests} requests, ${legacySnapshot.totalTokens} tokens).`,
      );
      try {
        await this.persister.saveFull(legacySnapshot);
        await this.context.globalState.update(TELEMETRY_STORAGE_KEY, undefined);
      } catch (error) {
        logger.warn(
          `[AIFlowBridge] Telemetry migration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.context.subscriptions.push(this.statusBar);
    this.context.subscriptions.push(this.gateway);

    this.registerCommands();
    this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("aiflowbridge")) {
        void this.reloadConfiguration();
      }
    }));

    if (this.config.gateway.enabled) {
      logger.info(`[AIFlowBridge] Gateway enabled, attempting to start on port ${this.config.gateway.port}...`);
      try {
        await this.gateway.start();
        logger.info(`[AIFlowBridge] Gateway started successfully on ${this.config.gateway.baseUrl}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as NodeJS.ErrnoException).code;
        const peerPid = (error as { peerPid?: number }).peerPid;
        console.error("[AIFlowBridge] Gateway failed to start:", message);
        logger.error(`[AIFlowBridge] Gateway failed to start: ${message}`);
        const running = this.gateway.running;
        if (running) {
          logger.info(`[AIFlowBridge] Gateway already running at ${this.config.gateway.baseUrl}`);
          void vscode.window.showInformationMessage(
            `AIFlowBridge gateway is already running on ${this.config.gateway.baseUrl}`,
          );
        } else if (code === "EPEERSTALLED" && typeof peerPid === "number") {
          // The user picked "Restart" but the old peer never freed the
          // port (typical of Windows TIME_WAIT or a hung peer). Surface
          // the PID so the user can kill the stale process manually.
          logger.warn(`[AIFlowBridge] Peer gateway (pid ${peerPid}) did not free port ${this.config.gateway.port} within timeout.`);
          void vscode.window.showWarningMessage(
            `AIFlowBridge gateway could not restart: the older instance (pid ${peerPid}) did not free port ${this.config.gateway.port} within 3s. ` +
              `Stop that process manually (or wait for TIME_WAIT to clear), then reload the window.`,
          );
        } else {
          const port = this.config.gateway.port;
          const isOccupied = await isPortLikelyOccupied(port);
          if (isOccupied) {
            logger.warn(`[AIFlowBridge] Port ${port} is in use by another service`);
            void vscode.window.showWarningMessage(
              `AIFlowBridge gateway could not start: port ${port} is in use by another service. ` +
                `If another VS Code instance is running AIFlowBridge, the gateway at ${this.config.gateway.baseUrl} is still accessible.`,
            );
          } else {
            logger.error(`[AIFlowBridge] Gateway failed to start on port ${port}: ${message}`);
            vscode.window.showWarningMessage(
              `AIFlowBridge gateway failed to start on port ${port}: ${message}`,
            );
          }
        }
      }
    } else {
      logger.info("[AIFlowBridge] Gateway disabled by configuration");
    }
    this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
  }

  async deactivate(): Promise<void> {
    await this.gateway.stop();
  }

  private registerCommands(): void {
    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.refreshMetrics", async () => {
      // FEAT1: also pull the latest snapshot from disk so a non-leader
      // window picks up writes from a peer window. The local in-memory
      // store is replaced with the on-disk state (under a file lock
      // when the persister is configured), and the dashboard is then
      // re-rendered with the fresh data.
      this.gateway.refreshFromDisk();
      this.telemetryFallback.refreshFromDisk();
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      const snapshot = this.gatewaySnapshot();
      void vscode.window.showInformationMessage(`AIFlowBridge: ${snapshot.requests} request${snapshot.requests === 1 ? "" : "s"}, ${snapshot.totalTokens} tokens`);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.resetMetrics", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Reset all AIFlowBridge metrics? This clears the cumulative request / token / cost counters persisted across restarts.",
        { modal: true },
        "Reset",
      );
      if (confirm !== "Reset") {
        return;
      }
      // `gateway.resetMetrics()` delegates to `TelemetryStore.reset()`,
      // which clears the in-memory counters and schedules a
      // fire-and-forget `persister.clear()` to wipe the on-disk file
      // under a file lock (FEAT1). The legacy globalState slot is
      // cleared for the no-persister path (e.g. unit tests / older
      // builds that have not migrated yet).
      this.gateway.resetMetrics();
      if (!this.persister) {
        void this.context.globalState.update(TELEMETRY_STORAGE_KEY, undefined);
      }
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      void vscode.window.showInformationMessage("AIFlowBridge: metrics reset.");
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.showMetrics", async () => {
      showMetricsDashboard(
        () => this.config,
        () => this.gatewaySnapshot(),
        () => this.gateway.running,
        () => ({
          // AFF03: header shows the running gateway version and the
          // installed extension version. Both come from the same source
          // the gateway itself reports on GET /version, so the user
          // can tell at a glance which build produced the metrics.
          gateway: this.gateway.bundledVersion,
          extension: this.context.extension.packageJSON.version,
        }),
        (entryId) => this.gateway.removeEntry(entryId),
      );
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.startGateway", async () => {
      try {
        await this.gateway.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[AIFlowBridge] Gateway failed to start: ${message}`);
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        void vscode.window.showWarningMessage(`AIFlowBridge gateway failed to start: ${message}`);
        return;
      }
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      void vscode.window.showInformationMessage(`AIFlowBridge gateway started on ${this.config.gateway.baseUrl}`);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.stopGateway", async () => {
      await this.gateway.stop();
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      void vscode.window.showInformationMessage("AIFlowBridge gateway stopped");
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.copyGatewayUrl", async () => {
      await vscode.env.clipboard.writeText(this.config.gateway.baseUrl);
      void vscode.window.showInformationMessage("AIFlowBridge gateway URL copied to clipboard");
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.openSettings", async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "aiflowbridge");
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.setVisionModel", async () => {
      await vscode.commands.executeCommand("aiflowbridge.providers.deepseek.setVisionModel");
    }));
  }

  private async reloadConfiguration(): Promise<void> {
    const wasRunning = this.gateway.running;
    if (wasRunning) {
      await this.gateway.stop();
    }

    this.config = await loadConfig(this.context);
    this.gateway.updateConfig(this.config);

    if (this.config.gateway.enabled) {
      await this.gateway.start();
    }

    this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
  }

  private refreshUi(status: GatewayStatus, snapshot: TelemetrySnapshot): void {
    this.statusBar.update(this.config, snapshot, status.running);
  }

  private gatewayStatus(): GatewayStatus {
    return {
      running: this.gateway.running,
      port: this.config.gateway.port,
      baseUrl: this.config.gateway.baseUrl,
      providerCount: this.config.providers.filter((provider) => provider.enabled).length,
    };
  }

  private gatewaySnapshot(): TelemetrySnapshot {
    const snapshot = this.gateway.snapshot();
    if (snapshot.requests > 0) {
      return snapshot;
    }

    return this.telemetryFallback.snapshot();
  }
}

let runtime: AIFlowBridgeRuntime | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  runtime = new AIFlowBridgeRuntime(context);
  await runtime.activate();
}

export async function deactivate(): Promise<void> {
  await runtime?.deactivate();
  runtime = undefined;
}

async function isPortLikelyOccupied(port: number): Promise<boolean> {
  return isPortInUse(port);
}