import * as vscode from 'vscode';
import type { AiFlowBridgeConfig, TelemetrySnapshot } from '../types';

export class StatusBarController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor() {
    this.item.command = 'aiflowbridge.showMetrics';
    this.item.tooltip = 'AIFlowBridge metrics dashboard';
    this.item.show();
  }

  /**
   * Update the status bar text + tooltip.
   *
   * `joined` is `true` when the gateway is reachable through an external
   * peer (the standalone gateway, or another VS Code window). In that
   * case the indicator becomes `AIFlowBridge ↗ external` and the tooltip
   * points the user at the URL of the owning peer.
   */
  update(config: AiFlowBridgeConfig, snapshot: TelemetrySnapshot, running: boolean, joined: boolean = false): void {
    const providerCount = config.providers.filter((provider) => provider.enabled).length;
    const requestCount = snapshot.requests;
    const duration = snapshot.averageDurationMs ? `${Math.round(snapshot.averageDurationMs)}ms avg` : 'idle';
    const prefix = joined ? '$(arrow-up-right)' : running ? '$(pulse)' : '$(circle-slash)';

    this.item.text = `${prefix} AIFlowBridge ${requestCount} req | ${providerCount} provider${providerCount === 1 ? '' : 's'} | ${duration}`;
    if (joined) {
      this.item.tooltip = `Gateway running externally (standalone mode) - ${config.gateway.baseUrl}`;
    } else {
      this.item.tooltip = `Gateway ${running ? 'running' : 'stopped'} - ${config.gateway.baseUrl}`;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
