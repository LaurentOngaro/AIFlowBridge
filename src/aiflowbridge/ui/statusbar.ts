import * as vscode from "vscode";
import type { AiFlowBridgeConfig, TelemetrySnapshot } from "../types.js";

export class StatusBarController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.command = "aiflowbridge.showMetrics";
    this.item.tooltip = "AIFlowBridge metrics dashboard";
    this.item.show();
  }

  update(config: AiFlowBridgeConfig, snapshot: TelemetrySnapshot, running: boolean): void {
    const providerCount = config.providers.filter((provider) => provider.enabled).length;
    const requestCount = snapshot.requests;
    const duration = snapshot.averageDurationMs ? `${Math.round(snapshot.averageDurationMs)}ms avg` : "idle";
    const prefix = running ? "$(pulse)" : "$(circle-slash)";

    this.item.text = `${prefix} AIFlowBridge ${requestCount} req | ${providerCount} provider${providerCount === 1 ? "" : "s"} | ${duration}`;
    this.item.tooltip = `Gateway ${running ? "running" : "stopped"} - ${config.gateway.baseUrl}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}