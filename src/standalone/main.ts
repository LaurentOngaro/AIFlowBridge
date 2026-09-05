/**
 * Standalone CLI entry point.
 *
 * Launches `AIFlowBridgeRuntime` in a pure-Node.js process with no VS
 * Code host. The resulting binary is the `aiflowbridge-server` command
 * declared in `package.json#bin`, built by `npm run build:standalone`
 * (`tsconfig.standalone.json` -> `dist/standalone/main.js`).
 *
 * Lifecycle:
 *   1. Resolve the storage directory (see `storage-dir.ts` for the
 *      precedence rules: env var, then VS Code ext globalStorageUri
 *      when installed, then `~/.aiflowbridge/`) and the bundled
 *      extension root (next to the running binary, where
 *      `resources/models.json` ships).
 *   2. Build the `IGatewayContext` via `createStandaloneContext`.
 *   3. Activate the runtime (starts the gateway if enabled in the
 *      standalone config file).
 *   4. Wire SIGINT / SIGTERM to `runtime.deactivate()` for clean
 *      shutdown.
 *
 * Locking:
 *   The standalone process and the VS Code extension share the same
 *   `gateway.lock` path inside `globalStorageDir`, so only ONE gateway
 *   runs at a time regardless of who started it. If the lock is held
 *   by a peer (a VS Code window or another standalone instance), the
 *   runtime joins the existing gateway instead of starting a new one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { AIFlowBridgeRuntime } from '../aiflowbridge';
import { AntigravityTokenManager } from '../aiflowbridge/antigravity';
import { loadModelRegistry } from '../aiflowbridge/modelRegistry';
import { logger } from '../logger';
import { createStandaloneContext } from './context';
import { resolveStorageDir } from './storage-dir';

async function handleAuthCommand(args: string[], globalStorageDir: string): Promise<boolean> {
  const [cmd, providerArg, ...flags] = args;
  if (cmd !== 'auth') {
    return false;
  }

  const isStatus = providerArg === '--status' || flags.includes('--status');
  const isLogout = providerArg === '--logout' || flags.includes('--logout');
  const isSetApiKey = providerArg === 'setApiKey' || flags.includes('setApiKey') || flags.includes('--set-api-key');
  const isClearApiKey = providerArg === 'clearApiKey' || flags.includes('clearApiKey');
  const isListModels = providerArg === '--list-models' || flags.includes('--list-models');
  const isProbe = providerArg === '--probe' || flags.includes('--probe');
  const apiKeyArg = flags[0];
  const provider = (providerArg && !providerArg.startsWith('--') && !isStatus && !isLogout && !isSetApiKey && !isClearApiKey && !isListModels && !isProbe && providerArg !== 'setApiKey' && providerArg !== 'clearApiKey' ? providerArg : 'googleaistudio').toLowerCase();

  if (provider !== 'googleaistudio' && provider !== 'antigravity') {
    console.error(`[AIFlowBridge auth] Unknown provider "${providerArg}". Supported: googleaistudio, antigravity`);
    process.exit(1);
  }

  // BYOK API-key route: `auth googleaistudio setApiKey <key>` /
  // `clearApiKey`. Distinct from the Antigravity OAuth route handled
  // below (that one stores OAuth tokens, not API keys). Always live on
  // `aiflowbridge.providers.googleaistudio.apiKey` so the same key
  // works for the VS Code SecretStorage adapter and the standalone
  // `~/.aiflowbridge/secrets.json` file.
  // BYOK API-key route: `auth googleaistudio setApiKey <key>` /
  // `clearApiKey`. Distinct from the Antigravity OAuth route handled
  // below (that one stores OAuth tokens, not API keys). Always live on
  // `aiflowbridge.providers.googleaistudio.apiKey` so the same key
  // works for the VS Code SecretStorage adapter and the standalone
  // `~/.aiflowbridge/secrets.json` file.
  if (isSetApiKey || isClearApiKey || provider === 'googleaistudio' && (providerArg === 'setApiKey' || providerArg === 'clearApiKey')) {
    const { createGatewaySecrets } = await import('../aiflowbridge/api-key-sources');
    const secrets = createGatewaySecrets({ secretsPath: `${globalStorageDir}/secrets.json`, logPrefix: '[Standalone]' });
    const apiKeySecret = 'aiflowbridge.providers.googleaistudio.apiKey';
    if (isClearApiKey || providerArg === 'clearApiKey') {
      await secrets.delete(apiKeySecret);
      console.log('[AIFlowBridge auth] Google AI Studio API key cleared.');
      process.exit(0);
    }
    const key = flags[0] ?? (providerArg !== 'setApiKey' ? providerArg : undefined);
    if (!key || key.startsWith('--')) {
      console.log('[AIFlowBridge auth] Usage: aiflowbridge-server auth googleaistudio setApiKey <AIzaSy...>');
      console.log('Create a key at https://aistudio.google.com/apikey. This route is independent from the Antigravity OAuth flow and works for any Google account (no Cloud Code Assist whitelist required).');
      process.exit(1);
    }
    await secrets.store(apiKeySecret, key);
    console.log('[AIFlowBridge auth] Google AI Studio API key saved.');
    process.exit(0);
  }

  const tokenManager = new AntigravityTokenManager(globalStorageDir);

  if (isStatus || isListModels || isProbe) {
    if (isListModels || isProbe) {
      await handleAntigravityProbe(tokenManager, isListModels);
      process.exit(0);
    }
    const tokens = tokenManager.getTokens();
    if (!tokens || !tokens.refreshToken) {
      console.log(`[AIFlowBridge auth] Status: Not logged in via Antigravity OAuth.`);
      console.log('Note: the Google AI Studio API-key route is independent. Check secrets.json or SecretStorage for `aiflowbridge.providers.googleaistudio.apiKey`.');
    } else {
      const isExpired = Date.now() >= tokens.expiresAt;
      console.log(`[AIFlowBridge auth] Antgravity OAuth: Logged in.`);
      if (tokens.email) console.log(`  Account: ${tokens.email}`);
      if (tokens.projectId) console.log(`  Project: ${tokens.projectId}`);
      console.log(`  Token: ${isExpired ? 'Expired (will auto-refresh on request)' : 'Active'}`);
      console.log(`  Expires at: ${new Date(tokens.expiresAt).toLocaleString()}`);
    }
    process.exit(0);
  }

  if (isLogout) {
    tokenManager.logout();
    console.log(`[AIFlowBridge auth] Successfully logged out of ${provider} (Antigravity OAuth).`);
    process.exit(0);
  }

  console.log(`[AIFlowBridge auth] Starting OAuth PKCE authentication for ${provider} (Antigravity / Cloud Code Assist).`);
  console.log('[AIFlowBridge auth] Note: this OAuth flow targets Cloud Code Assist; works only for whitelisted tenants.');
  console.log('[AIFlowBridge auth] For Google AI Studio API-key access (always available, BYOK pay-as-you-go), use: aiflowbridge-server auth googleaistudio setApiKey <AIzaSy...>');
  console.log('[AIFlowBridge auth] A browser window should open. If not, open the URL below:\n');

  try {
    const tokens = await tokenManager.startLocalOAuthFlow({
      onUrlReady: (url) => {
        // Best effort: open the consent page in the default browser.
        // Falls back to the printed URL (SSH / WSL / headless shells).
        openUrlInBrowser(url);
        console.log(`Open this URL in your browser:\n${url}\n`);
      },
    });
    console.log(`\n[AIFlowBridge auth] Authentication successful!`);
    if (tokens.email) console.log(`Account: ${tokens.email}`);
    if (tokens.projectId) console.log(`Project: ${tokens.projectId}`);
    console.log(`Tokens saved to secrets.json.`);
    process.exit(0);
  } catch (err) {
    console.error(`[AIFlowBridge auth] Authentication failed:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Diagnostic probe for the Antigravity / Google AI Studio path: resolves
 * a fresh access token, lists the Cloud-accessible models, and sends a
 * minimal non-streaming `streamGenerateContent` request. Prints the
 * upstream status + a truncated body so a `data: [DONE]`-only failure
 * can be told apart from an auth / project / model failure without
 * starting the full gateway. Invoked via
 * `aiflowbridge-server auth googleaistudio --probe` (raw envelope) or
 * `--list-models` (catalog only).
 */
async function handleAntigravityProbe(tokenManager: AntigravityTokenManager, listOnly: boolean): Promise<void> {
  const { fetchAvailableModels } = await import('../aiflowbridge/antigravity/catalog');
  const { toAntigravityEnvelope } = await import('../aiflowbridge/antigravity/envelope');
  const { DEFAULT_GOOG_API_CLIENT, DEFAULT_USER_AGENT, CLOUDCODE_STREAM_URL } = await import('../aiflowbridge/antigravity/constants');
  let accessToken: string;
  try {
    accessToken = await tokenManager.getAccessToken();
  } catch (err) {
    console.error(`[AIFlowBridge auth] Probe: no usable token: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const tokens = tokenManager.getTokens();
  console.log(`[AIFlowBridge auth] Probe: token OK${tokens?.email ? ` (${tokens.email})` : ''}${tokens?.projectId ? ` project=${tokens.projectId}` : ' (no projectId)'}.`);
  const catalog = await fetchAvailableModels(accessToken, tokens?.projectId);
  console.log(`[AIFlowBridge auth] Probe: ${catalog.models?.length ?? 0} model(s) listed:`);
  for (const m of catalog.models ?? []) {
    console.log(`  - ${m.name}${m.displayName ? ` (${m.displayName})` : ''}`);
  }
  if (listOnly || !tokens?.projectId) {
    return;
  }
  const envelope = toAntigravityEnvelope({ messages: [{ role: 'user', content: 'Hi' }] }, tokens.projectId, 'gemini-3.8-flash');
  let response: Response;
  try {
    response = await fetch(CLOUDCODE_STREAM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': DEFAULT_USER_AGENT,
        'X-Goog-Api-Client': DEFAULT_GOOG_API_CLIENT,
      },
      body: JSON.stringify(envelope),
    });
  } catch (err) {
    console.error(`[AIFlowBridge auth] Probe: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const body = await response.text().catch(() => '<unreadable body>');
  console.log(`[AIFlowBridge auth] Probe: upstream status=${response.status} content-type=${response.headers.get('content-type') ?? '?'} body-bytes=${body.length}`);
  console.log(body.length > 2000 ? `${body.slice(0, 2000)}...[truncated]` : body);
}

function resolveExtensionRoot(): string {
  // Resolve the path to the directory that contains `resources/models.json`.
  // In dev: `src/standalone/main.ts` -> project root.
  // In a packaged install: the binary sits next to `resources/models.json`.
  // We probe both locations and fall back to the project root.
  // // `__dirname` is provided by the CommonJS module wrapper emitted by
  // TypeScript when `module: "commonjs"`. This keeps the standalone
  // build compatible with the existing tsconfig setup.
  const here = __dirname;
  const candidates = [
    resolve(here, '..', '..'), // dist/standalone/main.js -> project root
    resolve(here, '..', '..', '..', '..'), // dist/standalone/bin/main.js -> project root
    resolve(process.cwd()),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'resources', 'models.json'))) {
      return candidate;
    }
  }
  // Fall back to the closest candidate (CWD-relative) so the error
  // message from `loadModelRegistry` shows the path the loader tried.
  return candidates[0];
}

/**
 * Best-effort opener for the OAuth consent URL: `xdg-open` on Linux,
 * `open` on macOS, `start` on Windows. Never throws - the caller
 * always prints the URL as fallback (SSH / WSL / headless shells).
 */
function openUrlInBrowser(url: string): void {
  const opener =
    process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '""', url] }
      : process.platform === 'darwin'
        ? { cmd: 'open', args: [url] }
        : { cmd: 'xdg-open', args: [url] };
  try {
    const child = execFile(opener.cmd, opener.args, { windowsHide: true }, () => undefined);
    child.unref?.();
  } catch {
    // ignore: the printed URL is the fallback.
  }
}

function resolveExtensionVersion(extensionRoot: string): string {
  // The runtime displays the extension version in the dashboard header
  //. In standalone mode we read it from the bundled
  // `package.json` next to the binary. Falls back to `"0.0.0"` if the
  // package is not readable.
  try {
    const raw = readFileSync(resolve(extensionRoot, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const extensionRoot = resolveExtensionRoot();
  const globalStorageDir = resolveStorageDir();
  const extensionVersion = resolveExtensionVersion(extensionRoot);

  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] === 'auth') {
    await handleAuthCommand(args, globalStorageDir);
    return;
  }

  console.log(`[AIFlowBridge standalone] Starting (version ${extensionVersion})`);
  console.log(`[AIFlowBridge standalone] Storage dir: ${globalStorageDir}`);
  console.log(`[AIFlowBridge standalone] Extension root: ${extensionRoot}`);

  const ctx = await createStandaloneContext({
    globalStorageDir,
    extensionVersion,
    extensionRootPath: extensionRoot,
  });

  // Load the 3-tier registry (bundled tier is shipped next to the
  // binary; the globalStorage / workspace tiers are skipped in
  // standalone mode - there is no project context).
  await loadModelRegistry(ctx);

  const runtime = new AIFlowBridgeRuntime(ctx);
  await runtime.activate();

  // Startup banner: tell the user what just happened and where to
  // point their OpenAI-compatible client. Three distinct cases:
  // - `isJoined`  : we are reusing a peer gateway (VS Code or
  // another standalone instance), we are not the
  // listener. Log the peer's URL so the user knows
  // where to point their client.
  // - `running`   : we started our own gateway on the configured
  // port. Log the local URL.
  // - neither     : `gateway.enabled` is false in the standalone
  // config. Log a clear "disabled" message so the
  // user does not assume a port is bound.
  const info = runtime.gatewayInfo;
  if (info.isJoined) {
    console.log(`[AIFlowBridge standalone] Joined external gateway at ${info.baseUrl}`);
  } else if (info.running) {
    console.log(`[AIFlowBridge standalone] Server started at ${info.baseUrl}`);
  } else {
    console.log(`[AIFlowBridge standalone] Server disabled (gateway.enabled = false in config)`);
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[AIFlowBridge standalone] Received ${signal}, shutting down...`);
    try {
      await runtime.deactivate();
    } catch (error) {
      logger.warn(`[AIFlowBridge standalone] Deactivation error: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  console.log('[AIFlowBridge standalone] Ready.');
}

main().catch((error: unknown) => {
  console.error('[AIFlowBridge standalone] Fatal:', error);
  process.exit(1);
});
