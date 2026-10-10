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
import { join, resolve } from 'node:path';
import { AIFlowBridgeRuntime } from '../aiflowbridge';
import { loadModelRegistry } from '../aiflowbridge/modelRegistry';
import { logger } from '../logger';
import { createStandaloneContext } from './context';
import { resolveStorageDir } from './storage-dir';

/**
 * `aiflowbridge-server auth ...`
 *
 * Sub-commands:
 *   - `setApiKey <AIzaSy...>` / `clearApiKey`  : the supported Gemini API
 *     (BYOK) route. Unchanged by the retirement of the product OAuth
 *     transport.
 *   - `--status`   : local read of the legacy secrets file. Never
 *     refreshes a token, never contacts Google.
 *   - `--logout`   : local, idempotent deletion of the legacy secrets
 *     slots. Not a remote revocation: nothing is sent to Google.
 *   - login / `--probe` / `--list-models` : REFUSED with a non-zero exit
 *     code and an explanation. They used to drive the Antigravity /
 *     Cloud Code Assist product OAuth transport, which is retired.
 *
 * The refusal is local and total: no browser opens, no callback server
 * binds, no token is refreshed, no probe is sent.
 */
async function handleAuthCommand(args: string[], globalStorageDir: string): Promise<boolean> {
  const [, providerArg, ...flags] = args;

  const isStatus = providerArg === '--status' || flags.includes('--status');
  const isLogout = providerArg === '--logout' || flags.includes('--logout');
  const isSetApiKey = providerArg === 'setApiKey' || flags.includes('setApiKey') || flags.includes('--set-api-key');
  const isClearApiKey = providerArg === 'clearApiKey' || flags.includes('clearApiKey');
  const isListModels = providerArg === '--list-models' || flags.includes('--list-models');
  const isProbe = providerArg === '--probe' || flags.includes('--probe');
  const isFlag = (value: string | undefined): boolean => value === undefined || value.startsWith('--');

  // BYOK API-key route: `auth googleaistudio setApiKey <key>` /
  // `clearApiKey`. Always lives on
  // `aiflowbridge.providers.googleaistudio.apiKey` so the same key
  // works for the VS Code SecretStorage adapter and the standalone
  // `~/.aiflowbridge/secrets.json` file.
  if (isSetApiKey || isClearApiKey) {
    const { createGatewaySecrets } = await import('../aiflowbridge/api-key-sources');
    const secrets = createGatewaySecrets({ secretsPath: `${globalStorageDir}/secrets.json`, logPrefix: '[Standalone]' });
    const apiKeySecret = 'aiflowbridge.providers.googleaistudio.apiKey';
    if (isClearApiKey) {
      await secrets.delete(apiKeySecret);
      console.log('[AIFlowBridge auth] Google AI Studio API key cleared.');
      process.exit(0);
    }
    const key = isFlag(providerArg) ? flags[0] : providerArg;
    if (!key) {
      console.log('[AIFlowBridge auth] Usage: aiflowbridge-server auth googleaistudio setApiKey <AIzaSy...>');
      console.log('Create a key at https://aistudio.google.com/apikey. This is the Gemini API route and is independent from the retired Google product OAuth transport.');
      process.exit(1);
    }
    await secrets.store(apiKeySecret, key);
    console.log('[AIFlowBridge auth] Google AI Studio API key saved.');
    process.exit(0);
  }

  if (isStatus) {
    // Pure local read. A legacy token on disk is reported as such, and
    // as USELESS: the route it unlocked no longer exists.
    const { hasRetiredGoogleOAuthSecrets, retiredGoogleSecretsPath } = await import('../aiflowbridge/retired-google-oauth-secrets');
    if (hasRetiredGoogleOAuthSecrets(globalStorageDir)) {
      console.log('[AIFlowBridge auth] Google product OAuth: retired transport, local credentials still present.');
      console.log(`  File: ${retiredGoogleSecretsPath(globalStorageDir)}`);
      console.log('  These credentials cannot be used. Delete them locally with: aiflowbridge-server auth googleaistudio --logout');
    } else {
      console.log('[AIFlowBridge auth] Google product OAuth: retired transport, no local credentials present.');
    }
    console.log('[AIFlowBridge auth] Gemini API (BYOK): configured separately. Check "aiflowbridge.providers.googleaistudio.apiKey" in secrets.json or the VS Code SecretStorage.');
    process.exit(0);
  }

  if (isLogout) {
    const { purgeRetiredGoogleOAuthSecrets, retiredGoogleSecretsPath } = await import('../aiflowbridge/retired-google-oauth-secrets');
    const result = purgeRetiredGoogleOAuthSecrets(globalStorageDir);
    if (!result.changed) {
      console.log('[AIFlowBridge auth] Nothing to clear: no local Google product OAuth credentials were present.');
    } else {
      console.log(`[AIFlowBridge auth] Local Google product OAuth credentials deleted from ${result.filePath}.`);
      console.log('[AIFlowBridge auth] This was a LOCAL deletion only. No token was sent to Google, so it is not a remote revocation of the grant.');
    }
    process.exit(0);
  }

  // Everything else used to start the retired OAuth flow (login) or
  // probe the retired backend (--probe / --list-models).
  console.error('[AIFlowBridge auth] Google product OAuth (Antigravity / Cloud Code Assist) has been retired and is no longer supported by AIFlowBridge.');
  console.error('[AIFlowBridge auth] Google AI Pro/Ultra entitlements cannot be used through this transport. No network request was sent.');
  console.error('[AIFlowBridge auth] Login, --probe and --list-models are unavailable. Creating or linking a GCP project does not make this integration supported.');
  console.error('[AIFlowBridge auth] For Gemini API access, use: aiflowbridge-server auth googleaistudio setApiKey <AIzaSy...>  (separate route, may incur API charges)');
  if (isProbe || isListModels) {
    console.error(`[AIFlowBridge auth] Refused: ${providerArg ?? ''} targets the retired backend.`);
  }
  process.exit(1);
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
