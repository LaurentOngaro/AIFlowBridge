import { rename as renameAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { join } from 'node:path';
import { API_KEY_SECRETS } from '../consts';
import { logger } from '../logger';
import { resolveVendorApiKey } from './api-key-resolver';
import { describeApiKeySource } from './api-key-sources';
import { AntigravityTokenManager } from './antigravity/auth';
import { GatewayService, isPortInUse } from './gateway/server';
import { loadConfigFromContext } from './host-config';
import { GLOBAL_STORAGE_PRICING_RELATIVE_PATH, replacePricingEntries } from './pricing/loader';
import { fetchOpenRouterModels, parseOpenRouterPricing, type PricingEntry } from './pricing/openrouter-fetch';
import { TelemetryStore } from './telemetry';
import { TelemetryPersister, defaultTelemetryPaths } from './telemetry/persistence';
import type { AiFlowBridgeConfig, Disposable, GatewayStatus, IGatewayContext, TelemetrySnapshot } from './types';
import { showMetricsDashboard } from './ui/dashboard';
import { StatusBarController } from './ui/statusbar';

class AIFlowBridgeRuntime implements Disposable {
  private config!: AiFlowBridgeConfig;
  private gateway!: GatewayService;
  private readonly statusBar: StatusBarController;
  private telemetryFallback!: TelemetryStore;
  private persister: TelemetryPersister | undefined;
  private tokenManager: AntigravityTokenManager | undefined;

  constructor(private readonly ctx: IGatewayContext) {
    // The gateway and config are built in `activate()` (not as class
    // fields) so the load / save callbacks can close over `this.ctx`,
    // which is only set by the parameter property above. Class field
    // initializers run before the parameter property assignment, so
    // wiring the gateway in the field initializer would crash with
    // `Cannot read properties of undefined`. The `init()` call
    // then safely wires persistence now that the context exists.
    this.statusBar = new StatusBarController();
  }

  /**
   * Public read-only snapshot of the gateway state for the standalone
   * CLI startup banner and external consumers (status checks, health
   * endpoints,...). Returns the same shape as the private
   * `gatewayStatus()` but with `isJoined` added so the CLI can
   * distinguish "started our own gateway" from "joined an external
   * peer" in the startup log.
   *
   * **Always safe to call.** Before `activate()` resolves (or after
   * it threw), `config` and `gateway` are still undefined; this
   * getter returns a sensible "all disabled" stub so test harnesses
   * and any future early-startup consumer can peek at the state
   * without crashing on missing fields.
   */
  public get gatewayInfo(): {
    running: boolean;
    port: number;
    baseUrl: string;
    isJoined: boolean;
    providerCount: number;
  } {
    if (!this.config || !this.gateway) {
      return {
        running: false,
        port: 0,
        baseUrl: '',
        isJoined: false,
        providerCount: 0,
      };
    }
    return {
      running: this.gateway.running,
      port: this.config.gateway.port,
      baseUrl: this.config.gateway.baseUrl,
      isJoined: this.gateway.isJoined,
      providerCount: this.config.providers.filter((provider) => provider.enabled).length,
    };
  }

  /**
   * Record a request driven by VS Code Copilot Chat. Action plan
   * item #6: routes the call through the gateway's TelemetryStore so
   * Copilot Chat traffic lands in the same `byProvider` / `byModel` /
   * `byClient` maps as gateway traffic, and gains a new `bySource`
   * split (`'gateway'` vs `'copilot-chat'`).
   *
   * Safe to call before `activate()` (no-op when the gateway has
   * not been built yet, e.g. when the activation lock is held by a
   * peer activation - the unified provider is still constructed and
   * would otherwise record into a void).
   */
  public recordFromCopilotChat(options: {
    providerId: string;
    providerLabel: string;
    model: string;
    status: number;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCost?: number;
    estimated?: boolean;
    errorMessage?: string;
    billedTo?: 'token' | 'plan';
  }): void {
    if (!this.gateway) {
      return;
    }
    this.gateway.recordFromCopilotChat(options);
  }

  /**
   * Log where each vendor's API key is currently read from, so the
   * operator can tell at a glance whether the gateway uses the env var,
   * the `secrets.json` file, or the host storage. The source is named
   * (env var name / file path / storage label) but never the key value
   * itself. OAuth vendors (Google AI Studio / Antigravity) have no
   * API-key slot - their line reports the OAuth login state instead,
   * so a successful `Connect to Google AI Studio` never shows a
   * confusing `not configured` key line.
   */
  private async logApiKeySources(): Promise<void> {
    for (const [vendor, secretKey] of Object.entries(API_KEY_SECRETS)) {
      const source = await describeApiKeySource(secretKey, this.ctx.secrets);
      logger.info(`[AIFlowBridge] API key for ${vendor}: ${source}`);
    }
    const googleLabel = 'googleaistudio';
    if (this.tokenManager) {
      const tokens = this.tokenManager.getTokens();
      if (tokens) {
        const who = tokens.email ?? 'authenticated account';
        const project = tokens.projectId ? ` (project ${tokens.projectId})` : '';
        const expiry = tokens.expiresAt > Date.now() ? 'token valid' : 'token expired (auto-refresh on next request)';
        logger.info(`[AIFlowBridge] Google AI Studio OAuth for ${googleLabel}: connected as ${who}${project} - ${expiry}`);
      } else {
        logger.info(`[AIFlowBridge] Google AI Studio OAuth for ${googleLabel}: not connected (run "AIFlowBridge: Connect to Google AI Studio")`);
      }
    }
  }

  private loadPersistedTelemetry(): TelemetrySnapshot | undefined {
    // File is the source of truth. If the file does not exist
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
   * in the  refactor, which silently reset every user's
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
    if (state.get<boolean>('telemetry.legacyMigrated') === true) {
      return undefined;
    }
    const legacy = state.get<TelemetrySnapshot>('telemetry.snapshot');
    if (!legacy) {
      // No legacy data + no flag yet: mark the migration as done so we
      // don't keep re-trying the read on every reload.
      void state.update('telemetry.legacyMigrated', true);
      return undefined;
    }
    logger.info('[AIFlowBridge] Migrating legacy 1.6.x globalState telemetry to the new file-based store...');
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
      logger.warn(`[AIFlowBridge] Legacy telemetry migration write failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    void state.update('telemetry.snapshot', undefined);
    void state.update('telemetry.legacyMigrated', true);
    return legacy;
  }

  async activate(): Promise<void> {
    logger.info('[AIFlowBridge] Activating...');

    this.config = await loadConfigFromContext(this.ctx);

    // The OAuth / Antigravity token manager is instantiated BEFORE the
    // startup log runs so `logApiKeySources()` can read the token state
    // (audit BUG-09). The persister uses the same globalStorageDir so
    // both files stay in sync.
    this.tokenManager = new AntigravityTokenManager(this.ctx.globalStorageDir);

    await this.logApiKeySources();

    // build the file-based telemetry persister (per-OS-user,
    // per-machine, NOT per-workspace). Stored under the context's
    // globalStorageDir so the file is independent of the current workspace
    // and shared across every VS Code window / standalone instance the user
    // opens.
    const telemetryPaths = defaultTelemetryPaths(this.ctx.globalStorageDir);
    this.persister = new TelemetryPersister({
      ...telemetryPaths,
      // forward the user-configured byte cap (8 KiB by
      // default) and retention window (90 days by default). Both
      // settings accept `0` to disable; the persister also defaults
      // to 8 KiB / 90 days when `undefined`.
      capBytes: this.config.telemetryMaxStoredRequestBytes,
      retentionMs: this.config.telemetryRetentionDays > 0 ? this.config.telemetryRetentionDays * 24 * 60 * 60 * 1000 : 0,
    });
    this.telemetryFallback = new TelemetryStore(this.persister);

    // No `saveState` callback is wired here: persistence is handled
    // directly by the file-based persister (TelemetryStore.record()
    // writes through it on every snapshot change). The GatewayService
    // contract still accepts an optional saveState hook for tests and
    // non-VS Code hosts that rely on the legacy globalState path,
    // but the production runtime does not need it.
    //
    // The Google AI Studio / Antigravity OAuth token manager shares
    // the same globalStorageDir as the telemetry persister so the
    // standalone CLI (`aiflowbridge-server auth googleaistudio`) and
    // the VS Code extension read the same `secrets.json`.
    // The `AntigravityTokenManager` is instantiated above (before
    // `logApiKeySources`) so the startup log can read OAuth token state.
    this.gateway = new GatewayService(
      this.config,
      (status, snapshot) => this.refreshUi(status, snapshot),
      (vendor) => resolveVendorApiKey(vendor, this.ctx.secrets),
      () => this.loadPersistedTelemetry(),
      undefined,
      this.ctx.extensionVersion,
      undefined,
      this.persister,
      this.tokenManager
    );
    this.gateway.init();

    this.ctx.subscriptions.push(this.statusBar);
    this.ctx.subscriptions.push(this.gateway);

    if (this.ctx.registerCommand) {
      this.registerCommands();
    }
    if (this.ctx.onConfigChange) {
      this.ctx.subscriptions.push(
        this.ctx.onConfigChange((event) => {
          void this.reloadConfiguration(event);
        })
      );
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
        } else if (code === 'EPEERSTALLED' && typeof peerPid === 'number') {
          // The user picked "Restart" but the old peer never freed the
          // port (typical of Windows TIME_WAIT or a hung peer). Surface
          // the PID so the user can kill the stale process manually.
          logger.warn(`[AIFlowBridge] Peer gateway (pid ${peerPid}) did not free port ${this.config.gateway.port} within timeout.`);
          this.ctx.showWarning?.(
            `AIFlowBridge gateway could not restart: the older instance (pid ${peerPid}) did not free port ${this.config.gateway.port} within 3s. ` +
              `Stop that process manually (or wait for TIME_WAIT to clear), then reload the window.`
          );
        } else {
          const port = this.config.gateway.port;
          const isOccupied = await isPortInUse(port);
          if (isOccupied) {
            logger.warn(`[AIFlowBridge] Port ${port} is in use by another service`);
            this.ctx.showWarning?.(
              `AIFlowBridge gateway could not start: port ${port} is in use by another service. ` +
                `If another VS Code instance is running AIFlowBridge, the gateway at ${this.config.gateway.baseUrl} is still accessible.`
            );
          } else {
            logger.error(`[AIFlowBridge] Gateway failed to start on port ${port}: ${message}`);
            this.ctx.showWarning?.(`AIFlowBridge gateway failed to start on port ${port}: ${message}`);
          }
        }
      }
    } else {
      logger.info('[AIFlowBridge] Gateway disabled by configuration');
    }
    this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
  }

  async deactivate(): Promise<void> {
    // The runtime may be disposed before `activate()` resolves
    // (e.g. an immediate deactivation right after install, a test
    // harness that never awaits the activation promise, or a
    // hot-reload race). `this.gateway` is declared with the
    // definite-assignment operator because the construction site
    // lives inside `activate()`, so the field is genuinely
    // `undefined` in that window. Calling `stop()` on
    // `undefined` would throw `TypeError: Cannot read properties
    // of undefined (reading 'stop')`. Guard at the boundary.
    if (!this.gateway) {
      return;
    }
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

    this.ctx.subscriptions.push(
      register('aiflowbridge.connectGoogleAIStudio', async () => {
        if (!this.tokenManager) {
          this.ctx.showWarning?.('AIFlowBridge: Google AI Studio auth is unavailable (token manager not initialized).');
          return;
        }
        try {
          let browserOpened = false;
          const tokens = await this.tokenManager.startLocalOAuthFlow({
            onUrlReady: (url) => {
              // Open the Google consent page in the default browser
              // immediately; the clipboard copy + notification are the
              // fallback for locked-down environments where the opener
              // fails (remote SSH, containers without xdg-open).
              try {
                this.ctx.openExternal?.(url);
                browserOpened = true;
              } catch {
                browserOpened = false;
              }
              if (!browserOpened) {
                this.ctx.showInformation?.(`AIFlowBridge: open this URL to connect Google AI Studio: ${url}`);
              }
              void this.ctx.clipboardWrite?.(url);
            },
          });
          logger.info('[AIFlowBridge] Google AI Studio connected.');
          this.ctx.showInformation?.(
            `AIFlowBridge: Google AI Studio connected${tokens.email ? ` as ${tokens.email}` : ''}${tokens.projectId ? ` (project ${tokens.projectId})` : ''}.`
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`[AIFlowBridge] Google AI Studio connect failed: ${message}`);
          this.ctx.showWarning?.(`AIFlowBridge: Google AI Studio connection failed: ${message}`);
        }
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.disconnectGoogleAIStudio', async () => {
        if (!this.tokenManager) {
          return;
        }
        this.tokenManager.logout();
        logger.info('[AIFlowBridge] Google AI Studio disconnected.');
        this.ctx.showInformation?.('AIFlowBridge: Google AI Studio disconnected.');
      })
    );

    // Switch Google AI Studio route between the BYOK native surface
    // (`generativelanguage.googleapis.com/v1beta`) and the Antigravity
    // OAuth surface (`cloudcode-pa.googleapis.com`). Toggle persists
    // the new baseUrl in `settings.json` and clears the stale credentials
    // of the inactive route so a leftover OAuth token cannot answer a
    // request meant for the BYOK path (and vice-versa). See
    // `docs/providers.md` for the rationale.
    this.ctx.subscriptions.push(
      register('aiflowbridge.switchGoogleAIStudioRoute', async () => {
        const { decideGoogleAIStudioRouteSwitch, describeCurrentRoute } = await import('./googleai-studio-route');
        if (!this.ctx.writeConfiguration) {
          this.ctx.showWarning?.('AIFlowBridge: switching the Google AI Studio route is supported in the VS Code extension only. Edit "aiflowbridge.providers.googleaistudio.baseUrl" in settings.json manually.');
          return;
        }
        const currentConfig = this.ctx.getConfiguration();
        const currentBaseUrl = currentConfig.get<string>('providers.googleaistudio.baseUrl');
        const decision = decideGoogleAIStudioRouteSwitch(currentBaseUrl);
        if (!decision) {
          this.ctx.showInformation?.(`AIFlowBridge: Google AI Studio is already on the ${describeCurrentRoute(currentBaseUrl)} route.`);
          return;
        }
        try {
          await this.ctx.writeConfiguration('providers.googleaistudio.baseUrl', decision.nextBaseUrl);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.ctx.showWarning?.(`AIFlowBridge: failed to write the new baseUrl: ${message}`);
          return;
        }
        // Audit BUG-02: the `globalStorage/models.json` registry
        // override is higher-priority than the bundled registry and the
        // `providers.*.baseUrl` setting. A stale override here would
        // silently re-route the request to the previous surface and
        // reproduce the failure we just toggled away from. Strip any
        // `vendors.googleaistudio` entry from the override file before
        // it can override the new bundled default. The next
        // `Developer: Reload Window` re-runs the registry loader
        // automatically (the loader caches per activation).
        try {
          const { GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH } = await import('./modelRegistry');
          const { resetGlobalStorageRegistryOverride } = await import('./modelRegistryOverride');
          const stripped = await resetGlobalStorageRegistryOverride(
            this.ctx.globalStorageDir,
            GLOBAL_STORAGE_REGISTRY_RELATIVE_PATH,
            (registry) => {
              if (registry.vendors?.googleaistudio) {
                delete registry.vendors.googleaistudio;
              }
              return registry;
            }
          );
          if (stripped) {
            logger.info('[AIFlowBridge] Switch Google AI Studio route: cleared stale vendors.googleaistudio from globalStorage override.');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`[AIFlowBridge] Could not clear the globalStorage vendors.googleaistudio override: ${message}`);
        }
        if (decision.cleanup.revokeOAuthTokens && this.tokenManager) {
          this.tokenManager.logout();
          logger.info('[AIFlowBridge] Switch Google AI Studio route -> BYOK: cleared stale OAuth tokens.');
        }
        if (decision.cleanup.revokeApiKey) {
          try {
            await this.ctx.secrets.delete('aiflowbridge.providers.googleaistudio.apiKey');
            logger.info('[AIFlowBridge] Switch Google AI Studio route -> OAuth: cleared stale API key.');
          } catch {
            // ignore: the API key may not be set.
          }
        }
        logger.info(`[AIFlowBridge] Google AI Studio baseUrl -> ${decision.nextBaseUrl}`);
        this.ctx.showInformation?.(`AIFlowBridge: ${decision.message} Reload Window to pick up the new route.`);
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.refreshMetrics', async () => {
        // also pull the latest snapshot from disk so a non-leader
        // window picks up writes from a peer window. The local in-memory
        // store is replaced with the on-disk state (under a file lock
        // when the persister is configured), and the dashboard is then
        // re-rendered with the fresh data.
        this.gateway.refreshFromDisk();
        this.telemetryFallback.refreshFromDisk();
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        const snapshot = this.gatewaySnapshot();
        this.ctx.showInformation?.(`AIFlowBridge: ${snapshot.requests} request${snapshot.requests === 1 ? '' : 's'}, ${snapshot.totalTokens} tokens`);
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.resetMetrics', async () => {
        // a single click on the command would otherwise wipe every
        // request log with no guard. Reintroduce the modal confirmation
        // (removed in the  refactor). When the host has no modal
        // (standalone CLI), fall back to a non-modal warning; data is
        // preserved on cancel.
        const confirmed = await this.ctx.confirm?.('Reset all AIFlowBridge metrics? This cannot be undone.', 'Reset', 'Cancel');
        if (confirmed !== 'Reset') {
          return;
        }
        // `gateway.resetMetrics()` delegates to `TelemetryStore.reset()`,
        // which clears the in-memory counters and schedules a
        // fire-and-forget `persister.clear()` to wipe the on-disk file
        // under a file lock.
        this.gateway.resetMetrics();
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        this.ctx.showInformation?.('AIFlowBridge: metrics reset.');
      })
    );

    // dedicated command for privacy-driven purge. Distinct
    // from `resetMetrics` (which wipes everything including the
    // request counts): the user keeps their usage stats but drops
    // every captured prompt / response summary. A typical use case
    // is "I'm done with this project, I want the totals to stay
    // but I don't want the prompts on disk anymore."
    this.ctx.subscriptions.push(
      register('aiflowbridge.purgeSessionLog', async () => {
        const confirmed = await this.ctx.confirm?.(
          'Purge all captured prompt / response summaries? Usage totals (requests, tokens, cost) are kept; only the replay text is wiped. This cannot be undone.',
          'Purge',
          'Cancel'
        );
        if (confirmed !== 'Purge') {
          return;
        }
        const { inMemory, onDisk } = this.gateway.purgeSessionLog();
        const onDiskCleared = await onDisk;
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        const total = inMemory + onDiskCleared;
        this.ctx.showInformation?.(`AIFlowBridge: ${total} session log entr${total === 1 ? 'y' : 'ies'} purged.`);
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.showMetrics', async () => {
        showMetricsDashboard(
          () => this.config,
          () => this.gatewaySnapshot(),
          () => this.gateway.running,
          () => ({
            // header shows the running gateway version and the
            // installed extension version. Both come from the same source
            // the gateway itself reports on GET /version, so the user
            // can tell at a glance which build produced the metrics.
            gateway: this.gateway.bundledVersion,
            extension: this.ctx.extensionVersion,
          }),
          (entryId) => this.gateway.removeEntry(entryId),
          // Action plan item #1 / FEAT10: wire the dashboard
          // `Refresh prices` button. The callback fetches the live
          // OpenRouter rates, writes the override file, updates
          // the in-memory pricing registry, and re-runs the config
          // synthesis so the next call to `getConfig()` (which
          // drives the dashboard re-render) picks up the new rates
          // without the user having to close and reopen the panel.
          () => this.dashboardRefreshPricing()
        );
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.startGateway', async () => {
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
      })
    );

    // Debug-host escape hatch: when a debug session (F5) joins the
    // already-running gateway owned by the launching VS Code window
    // (lock held by the peer, port owned by the peer), the debug
    // session's own freshly compiled code never serves traffic - every
    // request lands on the stale peer. Restarting VS Code works but
    // kills the debug loop. This command shuts the peer down
    // cooperatively (same shutdown-token flow as the version-aware
    // restart) and starts a fresh local gateway from THIS session's
    // code, so F5 iterations take effect without a full restart.
    //
    // Precondition: this command is only meaningful when the local
    // runtime did NOT start the gateway (joined-peer case). When the
    // local gateway owns the port, the version-aware prompt at
    // `GatewayService.start()` time already handled the restart
    // decision, and re-running it here would kill a healthy gateway
    // for no reason - refuse with a clear message instead.
    this.ctx.subscriptions.push(
      register('aiflowbridge.restartGatewayHere', async () => {
        if (this.gateway.running && !this.gateway.isJoined) {
          this.ctx.showInformation?.(
            `AIFlowBridge gateway already runs here (v${this.gateway.bundledVersion}, not joined) - nothing to restart. Use this command from a debug session that joined a stale peer.`
          );
          return;
        }
        try {
          await this.gateway.stop();
        } catch {
          // ignore: we may not own any socket (joined peer case).
        }
        const { probeServerVersion, requestPeerShutdown, waitUntilPortFree } = await import('./gateway/probe');
        const port = this.config.gateway.port;
        const peer = await probeServerVersion(port, { timeoutMs: this.config.gateway.probeTimeoutMs });
        if (peer && peer.name === 'aiflowbridge-gateway' && peer.shutdownToken) {
          logger.info(`[AIFlowBridge] Restart-here: asking peer gateway v${peer.version} (pid ${peer.pid}) to shut down.`);
          const accepted = await requestPeerShutdown(port, { shutdownToken: peer.shutdownToken });
          if (!accepted) {
            this.ctx.showWarning?.('AIFlowBridge: peer gateway refused the shutdown request. Close the other VS Code window (or stop its gateway) and retry.');
            return;
          }
          const freed = await waitUntilPortFree(port, { timeoutMs: 3000, intervalMs: 100 });
          if (!freed) {
            this.ctx.showWarning?.('AIFlowBridge: peer gateway did not free the port in time. Retry in a few seconds.');
            return;
          }
        }
        try {
          await this.gateway.start();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`[AIFlowBridge] Gateway restart-here failed: ${message}`);
          this.ctx.showWarning?.(`AIFlowBridge gateway restart failed: ${message}`);
          return;
        }
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        this.ctx.showInformation?.(`AIFlowBridge gateway restarted here on ${this.config.gateway.baseUrl}`);
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.stopGateway', async () => {
        await this.gateway.stop();
        this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
        this.ctx.showInformation?.('AIFlowBridge gateway stopped');
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.copyGatewayUrl', async () => {
        // the package.json title says "Copy gateway URL", so the
        // command must actually copy. The VS Code adapter delegates to
        // `vscode.env.clipboard.writeText`; the standalone adapter (no
        // clipboard) writes the URL to stdout so a CLI user running the
        // command can still capture it.
        const url = this.config.gateway.baseUrl;
        if (this.ctx.clipboardWrite) {
          this.ctx.clipboardWrite(url);
          this.ctx.showInformation?.(`AIFlowBridge gateway URL copied: ${url}`);
        } else {
          process.stdout.write(url + '\n');
          this.ctx.showInformation?.(`AIFlowBridge gateway URL printed to stdout: ${url}`);
        }
      })
    );

    this.ctx.subscriptions.push(
      register('aiflowbridge.openSettings', async () => {
        // open the VS Code settings page scoped to `aiflowbridge`.
        // Standalone: settings live at ~/.aiflowbridge/config.json, surface
        // the path so the user can open it in their editor.
        if (this.ctx.openSettings) {
          this.ctx.openSettings('aiflowbridge');
        } else {
          this.ctx.showInformation?.(`AIFlowBridge config file: ${this.ctx.globalStorageDir}/config.json`);
        }
      })
    );

    // The vision proxy is a global feature of the extension: one
    // `aiflowbridge.vision.copilotVisionModel` setting, shared by
    // every text-only model across all vendors (DeepSeek, MiniMax
    // text-only variants, Xiaomi text-only variants). The picker
    // implementation lives in `src/provider/vision/model.ts` and
    // is registered as a command from `src/runtime/provider.ts` so
    // it sits next to the VS Code adapter (`vscode.lm` lives
    // there). This runtime-level handler is the user-facing
    // command palette entry ("AIFlowBridge: Set vision proxy
    // model") and forwards to the picker command by name; the
    // indirection keeps the runtime host-agnostic (the picker
    // itself imports `vscode.lm` directly and cannot live here).
    this.ctx.subscriptions.push(
      register('aiflowbridge.setVisionModel', async () => {
        await this.ctx.executeCommand?.('aiflowbridge.chooseVisionProxyModel');
      })
    );

    // manually force the "joined" mode. Useful
    // when the user wants to delegate the gateway to a standalone process
    // that they have already started themselves, without relying on the
    // automatic lock-based detection.
    this.ctx.subscriptions.push(
      register('aiflowbridge.joinExternalGateway', async () => {
        try {
          await this.gateway.start();
          this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());
          this.ctx.showInformation?.(`AIFlowBridge: joined external gateway at ${this.config.gateway.baseUrl}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`[AIFlowBridge] Failed to join external gateway: ${message}`);
          this.ctx.showWarning?.(`AIFlowBridge: failed to join external gateway: ${message}`);
        }
      })
    );
  }

  private async reloadConfiguration(event?: { affectsGateway: boolean }): Promise<void> {
    // a full stop/start cycle is expensive (port rebind,
    // peer probe, dashboard reset). For non-gateway config edits
    // (providers, vision, telemetry,...) a hot `updateConfig()` is
    // enough. Only restart the gateway when the change actually
    // affects it. The VS Code adapter sets `event.affectsGateway` from
    // `affectsConfiguration("aiflowbridge.gateway")`; the standalone
    // adapter leaves it `undefined`, which we treat as a gateway change
    // (the standalone config is a single file with no per-section
    // granularity).
    const restartGateway = event?.affectsGateway ?? true;
    if (!restartGateway) {
      logger.info('[AIFlowBridge] Config change does not affect the gateway; applying hot update only.');
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
        // The user-facing message differs between a first-time start
        // (wasRunning was false; nothing was "restarted") and a real
        // restart (wasRunning was true; the user reloaded the config
        // over a running gateway). The two paths have different
        // remediations so we surface the right label.
        const actionLabel = wasRunning ? 'restart' : 'start';
        logger.error(`[AIFlowBridge] Gateway failed to ${actionLabel} after config reload: ${message}`);
        if (code === 'EPEERSTALLED' && typeof peerPid === 'number') {
          this.ctx.showWarning?.(
            `AIFlowBridge gateway could not ${actionLabel}: the older instance (pid ${peerPid}) did not free port ${this.config.gateway.port} within the timeout. ` +
              `Stop that process manually (or wait for TIME_WAIT to clear), then reload the window.`
          );
        } else {
          this.ctx.showWarning?.(`AIFlowBridge gateway failed to ${actionLabel} after config reload: ${message}`);
        }
      }
    } else if (wasRunning) {
      // The gateway was running and is now disabled by the new
      // config. `wasRunning` is true but we deliberately did not
      // call `stop()` in the branch above (the gateway is no
      // longer desired). The user has implicitly stopped it by
      // toggling `gateway.enabled` to false; surface an info
      // message so the status bar transition is not silent.
      logger.info('[AIFlowBridge] Gateway disabled by new configuration; previously running gateway remains stopped.');
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
    // from the previous session as if it were live.
    // // The persisted snapshot is now only consulted when the gateway
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

  /**
   * Action plan item #1 / FEAT10. The dashboard `Refresh prices`
   * button's callback. Fetches the live OpenRouter rates, writes
   * the globalStorage override file, updates the in-memory pricing
   * registry in place, then re-runs the config synthesis so the
   * next `getConfig()` call returns the refreshed rates. Returns
   * the number of models that landed in the override file so the
   * dashboard can show a transient toast.
   *
   * Errors propagate to the caller; the dashboard shows them via
   * the standard `showWarning` channel and the failure does not
   * touch the cached registry.
   */
  private async dashboardRefreshPricing(): Promise<{ updated: number; source: string } | undefined> {
    try {
      logger.info('[AIFlowBridge] Pricing refresh (dashboard): fetching live OpenRouter /v1/models ...');
      const raw = await fetchOpenRouterModels();
      const fetchedAt = new Date().toISOString();
      const entries = parseOpenRouterPricing(raw, fetchedAt);
      const modelIds = Object.keys(entries);
      if (modelIds.length === 0) {
        throw new Error('OpenRouter returned zero metered models - refusing to update the override.');
      }

      const overridePath = join(this.ctx.globalStorageDir, ...GLOBAL_STORAGE_PRICING_RELATIVE_PATH);
      const file = {
        schemaVersion: 1,
        generatedAt: fetchedAt,
        source: 'openrouter',
        sourceUrl: 'https://openrouter.ai/api/v1/models',
        userFetchedAt: fetchedAt,
        models: entries,
      };
      const tmpPath = `${overridePath}.tmp-${process.pid}-${Date.now()}`;
      await writeFileAsync(tmpPath, JSON.stringify(file, null, 2), 'utf8');
      await renameAsync(tmpPath, overridePath);
      logger.info(`[AIFlowBridge] Pricing refresh (dashboard): wrote ${modelIds.length} model(s) to ${overridePath}`);

      // Update the in-memory pricing registry in place. The dashboard
      // re-renders from `getConfig()`, which itself reads the registry,
      // so the next render carries the new rates without a window
      // reload. The 4-tier merge (workspace > globalStorage > bundled
      // pricing.json > models.json) is preserved - the override file
      // just landed on disk, so the next `loadPricingRegistry()` call
      // would already see it. We avoid re-reading it: the cached
      // registry is updated in place via `replacePricingEntries` so the
      // active config object remains the source of truth for the
      // running session.
      replacePricingEntries(entries as Record<string, PricingEntry>, 'override (globalStorage)');

      // Re-run the synthesis so the returned `AiFlowBridgeConfig`
      // carries the freshly-loaded pricing registry. The dashboard
      // re-renders against this new config.
      this.config = await loadConfigFromContext(this.ctx);
      this.gateway.updateConfig(this.config);
      this.refreshUi(this.gatewayStatus(), this.gatewaySnapshot());

      return { updated: modelIds.length, source: 'openrouter' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[AIFlowBridge] Pricing refresh (dashboard) failed: ${message}`);
      this.ctx.showWarning?.(`AIFlowBridge pricing refresh failed: ${message}`);
      return undefined;
    }
  }
}

export { AIFlowBridgeRuntime };
