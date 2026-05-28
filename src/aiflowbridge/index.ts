import * as vscode from "vscode";
import { loadConfig } from "./config";
import { GatewayService } from "./gateway/server";
import { TelemetryStore } from "./telemetry";
import type { GatewayStatus, TelemetrySnapshot } from "./types";
import { showMetricsDashboard } from "./ui/dashboard";
import { StatusBarController } from "./ui/statusbar";

class AIFlowBridgeRuntime {
  private config = loadConfig();
  private readonly gateway = new GatewayService(this.config, (status, snapshot) => this.refreshUi(status, snapshot));
  private readonly statusBar = new StatusBarController();
  private readonly telemetryFallback = new TelemetryStore();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async activate(): Promise<void> {
    this.context.subscriptions.push(this.statusBar);
    this.context.subscriptions.push(this.gateway);

    this.registerCommands();
    this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("aiflowbridge")) {
        void this.reloadConfiguration();
      }
    }));

    if (this.config.gateway.enabled) {
      try {
        await this.gateway.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[AIFlowBridge] Gateway failed to start:", message);
        vscode.window.showWarningMessage(`AIFlowBridge gateway failed to start on port ${this.config.gateway.port}: ${message}`);
      }
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

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.showMetrics", async () => {
      showMetricsDashboard(this.config, this.gatewaySnapshot(), this.gateway.running);
    }));

    this.context.subscriptions.push(vscode.commands.registerCommand("aiflowbridge.startGateway", async () => {
      await this.gateway.start();
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

    this.config = loadConfig();
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