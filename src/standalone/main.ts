/**
 * Standalone CLI entry point.
 *
 * Launches `AIFlowBridgeRuntime` in a pure-Node.js process with no VS
 * Code host. The resulting binary is the `aiflowbridge-server` command
 * declared in `package.json#bin`, built by `npm run build:standalone`
 * (`tsconfig.standalone.json` -> `dist/standalone/main.js`).
 *
 * Lifecycle:
 *   1. Resolve the storage directory (`AIFLOWBRIDGE_DATA_DIR` env var,
 *      default `~/.aiflowbridge/`) and the bundled extension root
 *      (next to the running binary, where `resources/models.json`
 *      ships).
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
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AIFlowBridgeRuntime } from '../aiflowbridge';
import { loadModelRegistry } from '../aiflowbridge/modelRegistry';
import { logger } from '../logger';
import { createStandaloneContext } from './context';

const DEFAULT_STORAGE_DIRNAME = '.aiflowbridge';

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

function resolveStorageDir(): string {
  const fromEnv = process.env.AIFLOWBRIDGE_DATA_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), DEFAULT_STORAGE_DIRNAME);
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
