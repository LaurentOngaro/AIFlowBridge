import { logger } from "../logger";
import { resolveVendorApiKey } from "./api-key-resolver";
import { loadConfigFromContext } from "./config";
import { GatewayService, isPortInUse } from "./gateway/server";
import { TelemetryStore } from "./telemetry";
import { TelemetryPersister, defaultTelemetryPaths } from "./telemetry/persistence";
import type { AiFlowBridgeConfig, Disposable, GatewayStatus, IGatewayContext, TelemetrySnapshot } from "./types";
import { showMetricsDashboard } from "./ui/dashboard";
import { StatusBarController } from "./ui/statusbar";

class AIFlowBridgeRuntime implements Disposable {
  private config!: AiFlowBridgeConfig;
  private gateway!: GatewayService;
  private readonly statusBar: StatusBarController;
  private telemetryFallback!: TelemetryStore;
  private persister: TelemetryPersister | undefined;

  constructor(private readonly ctx: IGatewayContext) {
    // The gateway and config are built in `activate()` (not as class
    // fields) so the load / save callbacks can close over `this.ctx`,
    // which is only set by the parameter property above. Class field
    // initializers run before the parameter property assignment, so
    // wiring the gateway in the field initializer would crash with
    // `Cannot read properties of undefined` (BUG06). The `init()` call
    // then safely wires persistence now that the context exists.
    this.statusBar = new StatusBarController();
  }

  private loadPersistedTelemetry(): TelemetrySnapshot | undefined {
    // File is the source of truth (FEAT1). If the file does not exist
    // yet (e.g. first ever activation), still attempt the one-shot
    // legacy migration from `globalState` (B-01) so that 1.6.x -> 1.7.0
    // users keep their cumulative counters.
    if (this.persister) {
      const fromDisk = this.persister.loadSync();
      if (fromDisk) {
        return fromDisk;
      }
      const migrated = this.migrateLegacyGlobalState();
      if (migrated) {
        return migrated;
      }
    }
    return undefined;
  }

  /**
   * One-shot migration from the legacy 1.6.x `globalState` slot to the
   * 1.7.0 file-based telemetry store. B-01: the migration was removed
   * in the FEAT7 refactor, which silently reset every user's
   * cumulative counters on upgrade.
   *
   * Guarded by a `migrated` flag in `globalState` so it runs at most
   * once per user. After a successful migration the legacy key is
   * cleared so the next activation skips the read. The standalone
   * adapter does not expose `globalState`, so the migration is a
   * no-op in CLI mode (the standalone binary never ran in 1.6.x).
   */
  private migrateLegacyGlobalState(): TelemetrySnapshot | undefined {
    const state = this.ctx.globalState;
    if (!state) {
      return undefined;
    }
    if (state.get<boolean>("telemetry.legacyMigrated") === true) {
      return undefined;
    }
    const legacy = state.get<TelemetrySnapshot>("telemetry.snapshot");
    if (!legacy) {
      // No legacy data + no flag yet: mark the migration as done so we
      // don't keep re-trying the read on every reload.
      void state.update("telemetry.legacyMigrated", true);
      return undefined;
    }
    logger.info("[AIFlowBridge] Migrating legacy 1.6.x globalState telemetry to the new file-based store...");
    // Seed the in-memory store from the legacy snapshot so the first
    // dashboard render after activation shows the migrated counts
    // (otherwise the in-memory store starts empty and only the
    // on-disk file is correct, which the dashboard does not read
    // until the in-memory snapshot has a request).
    this.telemetryFallback?.restore(legacy);
    // Persist the legacy snapshot through the file persister (synchronous
    // atomic write under the file lock), then drop both the legacy key
    // and the sentinel so this never runs again.
    this.persister?.saveFull(legacy).catch((error) => {
      logger.warn(
        `[AIFlowBridge] Legacy telemetry migration write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    void state.update("telemetry.snapshot", undefined);
    void state.update("telemetry.legacyMigrated", true);
    return legacy;
  }

  private savePersistedTelemetry(_snapshot: TelemetrySnapshot): void {
    // No-op: the file-based persister is wired directly into the
    // TelemetryStore.record() path. The callback is preserved for the
    // GatewayService contract but does nothing when a persister is set.
  }

  async activate(): Promise<void> {
    logger.info("[AIFlowBridge] Activating...");

    this.config = await loadConfigFromContext(this.ctx);

    // FEAT1: build the file-based telemetry persister (per-OS-user,
    // per-machine, NOT per-workspace). Stored under the context's
    // globalStorageDir so the file is independent of the current workspace
    // and shared across every VS Code window / standalone instance the user
    // opens.
    const telemetryPaths = defaultTelemetryPaths(this.ctx.globalStorageDir);
    this.persister = new TelemetryPersister(telemetryPaths);
    this.telemetryFallback = new TelemetryStore(this.persister);

    this.gateway = new GatewayService(
      this.config,
      (status, snapshot) => this.refreshUi(status, snapshot),
      (vendor) => resolveVendorApiKey(vendor, this.ctx.secrets),
      () => this.loadPersistedTelemetry(),
      (snapshot) => this.savePersistedTelemetry(snapshot),
      this.ctx.extensionVersion,
      undefined,
      this.persister,
    );
    this.gateway.init();

    this.ctx.subscriptions.push(this.statusBar);
    this.ctx.subscriptions.push(this.gateway);

    if (this.ctx.registerCommand) {
      this.registerCommands();
    }
    if (this.ctx.onConfigChange) {
      this.ctx.subscriptions.push(this.ctx.onConfigChange((event) => {
        void this.reloadConfiguration(event);
      }));
    }

    if (this.config.gateway.enabled) {
      logger.info(`[AIFlowBridge] Gateway enabled, attempting to start on port ${this.config.gateway.port}...`);
      try {
        await this.gateway.start();
        logger.info(`[AIFlowBridge] Gateway started successfully on ${this.config.gateway.baseUrl}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as NodeJS.ErrnoException).code;
        const peerPid = (error as { peerPid?: number }).peerPid;
        logger.error(`[AIFlowBridge] Gateway failed to start: ${message}`);
        const running = this.gateway.running;
        if (running) {
          logger.info(`[AIFlowBridge] Gateway already running at ${this.config.gateway.baseUrl}`);
          this.ctx.showInformation?.(`AIFlowBridge gateway is already running on ${this.config.gateway.baseUrl}`);
        } else if (code === "EPEERSTALLED" && typeof peerPid === "number") {
          // The user picked "Restart" but the old peer never freed the
          // port (typical of Windows TIME_WAIT or a hung peer). Surface
          // the PID so the user can kill the stale process manually.
          logger.warn(`[AIFlowBridge] Peer gateway (pid ${peerPid}) did not free port ${this.config.gateway.port} within timeout.`);
          this.ctx.showWarning?.(
            `AIFlowBridge gateway could not restart: the older instance (pid ${peerPid}) did not free port ${this.config.gateway.port} within 3s. ` +
              `Stop that process manually (or wait for TIME_WAIT to clear), then reload the window.`,
          );
        } else {
          const port = this.config.gateway.port;
          const isOccupied = await isPortInUse(port);
          if (isOccupied) {
            logger.warn(`[AIFlowBridge] Port ${port} is in use by another service`);
            this.ctx.showWarning?.(
              `AIFlowBridge gateway could not start: port ${port} is in use by another service. ` +
                `If another VS Code instance is running AIFlowBridge, the gateway at ${this.config.gateway.baseUrl} is still accessible.`,
            );
          } else {
            logger.error(`[AIFlowBridge] Gateway failed to start on port ${port}: ${message}`);
            this.ctx.showWarning?.(
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

  dispose(): void {
    void this.deactivate();
  }

  private registerCommands(): void {
    const register = this.ctx.registerCommand;
    if (!register) {
      return;
    }

    this.ctx.subscriptions.push(register("aiflowbridge.refreshMetrics", async () => {
      // FEAT1: also pull the latest snapshot from disk so a non-leader
      // window picks up writes from a peer window. The local in-memory
      // store is replaced with the on-disk state (under a file lock
      // when the persister is configured), and the dashboard is then
      // re-rendered with the fresh data.
      this.gateway.refreshFromDisk();
      this.telemetryFallback.refreshFromDisk();
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      const snapshot = this.gatewaySnapshot();
      this.ctx.showInformation?.(`AIFlowBridge: ${snapshot.requests} request${snapshot.requests === 1 ? "" : "s"}, ${snapshot.totalTokens} tokens`);
    }));

    this.ctx.subscriptions.push(register("aiflowbridge.resetMetrics", async () => {
      // R-01: a single click on the command would otherwise wipe every
      // request log with no guard. Reintroduce the modal confirmation
      // (removed in the FEAT7 refactor). When the host has no modal
      // (standalone CLI), fall back to a non-modal warning; data is
      // preserved on cancel.
      const confirmed = await this.ctx.confirm?.(
        "Reset all AIFlowBridge metrics? This cannot be undone.",
        "Reset",
        "Cancel",
      );
      if (confirmed !== "Reset") {
        return;
      }
      // `gateway.resetMetrics()` delegates to `TelemetryStore.reset()`,
      // which clears the in-memory counters and schedules a
      // fire-and-forget `persister.clear()` to wipe the on-disk file
      // under a file lock (FEAT1).
      this.gateway.resetMetrics();
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      this.ctx.showInformation?.("AIFlowBridge: metrics reset.");
    }));

    this.ctx.subscriptions.push(register("aiflowbridge.showMetrics", async () => {
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
          extension: this.ctx.extensionVersion,
        }),
        (entryId) => this.gateway.removeEntry(entryId),
      );
    }));

    this.ctx.subscriptions.push(register("aiflowbridge.startGateway", async () => {
      try {
        await this.gateway.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[AIFlowBridge] Gateway failed to start: ${message}`);
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        this.ctx.showWarning?.(`AIFlowBridge gateway failed to start: ${message}`);
        return;
      }
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      this.ctx.showInformation?.(`AIFlowBridge gateway started on ${this.config.gateway.baseUrl}`);
    }));

    this.ctx.subscriptions.push(register("aiflowbridge.stopGateway", async () => {
      await this.gateway.stop();
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      this.ctx.showInformation?.("AIFlowBridge gateway stopped");
    }));

    this.ctx.subscriptions.push(register("aiflowbridge.copyGatewayUrl", async () => {
      // R-02: the package.json title says "Copy gateway URL", so the
      // command must actually copy. The VS Code adapter delegates to
      // `vscode.env.clipboard.writeText`; the standalone adapter (no
      // clipboard) writes the URL to stdout so a CLI user running the
      // command can still capture it.
      const url = this.config.gateway.baseUrl;
      if (this.ctx.clipboardWrite) {
        this.ctx.clipboardWrite(url);
        this.ctx.showInformation?.(`AIFlowBridge gateway URL copied: ${url}`);
      } else {
        process.stdout.write(url + "\n");
        this.ctx.showInformation?.(`AIFlowBridge gateway URL printed to stdout: ${url}`);
      }
    }));

    this.ctx.subscriptions.push(register("aiflowbridge.openSettings", async () => {
      // R-03: open the VS Code settings page scoped to `aiflowbridge`.
      // Standalone: settings live at ~/.aiflowbridge/config.json, surface
      // the path so the user can open it in their editor.
      if (this.ctx.openSettings) {
        this.ctx.openSettings("aiflowbridge");
      } else {
        this.ctx.showInformation?.(`AIFlowBridge config file: ${this.ctx.globalStorageDir}/config.json`);
      }
    }));

    // R-04: the `aiflowbridge.setVisionModel` command is declared in
    // package.json (line 113) but the handler was removed in the FEAT7
    // refactor, so VS Code displayed "command not found". Re-register
    // it as a thin alias that delegates to the per-provider command.
    this.ctx.subscriptions.push(register("aiflowbridge.setVisionModel", async () => {
      await this.ctx.executeCommand?.("aiflowbridge.providers.deepseek.setVisionModel");
    }));

    // FEAT7: manually force the "joined" mode. Useful
    // when the user wants to delegate the gateway to a standalone process
    // that they have already started themselves, without relying on the
    // automatic lock-based detection.
    this.ctx.subscriptions.push(register("aiflowbridge.joinExternalGateway", async () => {
      try {
        await this.gateway.start();
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        this.ctx.showInformation?.(
          `AIFlowBridge: joined external gateway at ${this.config.gateway.baseUrl}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[AIFlowBridge] Failed to join external gateway: ${message}`);
        this.ctx.showWarning?.(`AIFlowBridge: failed to join external gateway: ${message}`);
      }
    }));
  }

  private async reloadConfiguration(event?: { affectsGateway: boolean }): Promise<void> {
    // IMPROV-C06: a full stop/start cycle is expensive (port rebind,
    // peer probe, dashboard reset). For non-gateway config edits
    // (providers, vision, telemetry, ...) a hot `updateConfig()` is
    // enough. Only restart the gateway when the change actually
    // affects it. The VS Code adapter sets `event.affectsGateway` from
    // `affectsConfiguration("aiflowbridge.gateway")`; the standalone
    // adapter leaves it `undefined`, which we treat as a gateway change
    // (the standalone config is a single file with no per-section
    // granularity).
    const restartGateway = event?.affectsGateway ?? true;
    if (!restartGateway) {
      logger.info("[AIFlowBridge] Config change does not affect the gateway; applying hot update only.");
      this.config = await loadConfigFromContext(this.ctx);
      this.gateway.updateConfig(this.config);
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
      return;
    }

    // `running` is true whenever the service owns a local socket OR
    // has joined an existing peer. In the joined case, `stop()` just
    // clears the join flag (the peer stays alive) and the subsequent
    // `start()` will probe the port again and re-join if the peer is
    // still there. This mirrors the activate() path.
    const wasRunning = this.gateway.running;
    if (wasRunning) {
      await this.gateway.stop();
    }

    this.config = await loadConfigFromContext(this.ctx);
    this.gateway.updateConfig(this.config);

    if (this.config.gateway.enabled) {
      // `start()` may throw EPEERSTALLED when the peer on the configured
      // port refused to shut down within the timeout. Surface a
      // targeted warning so the user knows what to do (stop the peer
      // manually, or wait for TIME_WAIT to clear on Windows).
      try {
        await this.gateway.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as NodeJS.ErrnoException).code;
        const peerPid = (error as { peerPid?: number }).peerPid;
        logger.error(`[AIFlowBridge] Gateway failed to restart after config reload: ${message}`);
        if (code === "EPEERSTALLED" && typeof peerPid === "number") {
          this.ctx.showWarning?.(
            `AIFlowBridge gateway could not restart: the older instance (pid ${peerPid}) did not free port ${this.config.gateway.port} within the timeout. ` +
              `Stop that process manually (or wait for TIME_WAIT to clear), then reload the window.`,
          );
        } else {
          this.ctx.showWarning?.(`AIFlowBridge gateway failed to restart: ${message}`);
        }
      }
    }

    this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
  }

  private refreshUi(status: GatewayStatus, snapshot: TelemetrySnapshot): void {
    this.statusBar.update(this.config, snapshot, status.running, this.gateway.isJoined);
  }

  private gatewayStatus(): GatewayStatus {
    return {
      running: this.gateway.running,
      port: this.config.gateway.port,
      baseUrl: this.config.gateway.baseUrl,
      providerCount: this.config.providers.filter((provider) => provider.enabled).length,
      inFlightRequests: this.gateway.inFlightRequests,
      maxConcurrentRequests: this.config.gateway.maxConcurrentRequests,
    };
  }

  private gatewaySnapshot(): TelemetrySnapshot {
    // The live gateway snapshot is the source of truth whenever it
    // has processed at least one request in this session, OR the
    // gateway is currently running. The previous implementation
    // fell back to the persisted snapshot whenever `requests === 0`,
    // which made a freshly-started gateway appear to display data
    // from the previous session as if it were live (BUG 2.1).
    //
    // The persisted snapshot is now only consulted when the gateway
    // is NOT running AND has not processed any request - i.e. the
    // dashboard is being shown immediately after activation, before
    // the first request lands. In that case the persisted data is
    // genuinely the only thing available.
    const snapshot = this.gateway.snapshot();
    if (this.gateway.running || snapshot.requests > 0) {
      return snapshot;
    }
    return this.telemetryFallback.snapshot();
  }
}

export { AIFlowBridgeRuntime };
