import * as vscode from "vscode";
import { loadConfig } from "./config";
import { GatewayService, isPortInUse } from "./gateway/server";
import { resolveVendorApiKey } from "./api-key-resolver";
import { TelemetryStore } from "./telemetry";
import type { AiFlowBridgeConfig, GatewayStatus, TelemetrySnapshot } from "./types";
import { showMetricsDashboard } from "./ui/dashboard";
import { StatusBarController } from "./ui/statusbar";
import { logger } from "../logger";

const TELEMETRY_STORAGE_KEY = "aiflowbridge.telemetry.v1";

class AIFlowBridgeRuntime {
  private config!: AiFlowBridgeConfig;
  private gateway!: GatewayService;
  private readonly statusBar: StatusBarController;
  private readonly telemetryFallback = new TelemetryStore();

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
    return this.context.globalState.get<TelemetrySnapshot>(TELEMETRY_STORAGE_KEY);
  }

  private savePersistedTelemetry(snapshot: TelemetrySnapshot): void {
    void this.context.globalState.update(TELEMETRY_STORAGE_KEY, snapshot);
  }

  async activate(): Promise<void> {
    logger.info("[AIFlowBridge] Activating...");

    this.config = await loadConfig(this.context);
    this.gateway = new GatewayService(
      this.config,
      (status, snapshot) => this.refreshUi(status, snapshot),
      (vendor) => resolveVendorApiKey(vendor, this.context.secrets),
      () => this.loadPersistedTelemetry(),
      (snapshot) => this.savePersistedTelemetry(snapshot),
      this.context.extension.packageJSON.version ?? "0.0.0",
    );
    this.gateway.init();

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
      this.gateway.resetMetrics();
      void this.context.globalState.update(TELEMETRY_STORAGE_KEY, undefined);
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      void vscode.window.showInformationMessage("AIFlowBridge: metrics reset.");
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.showMetrics", async () => {
      showMetricsDashboard(
        this.config,
        () => this.gatewaySnapshot(),
        () => this.gateway.running,
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