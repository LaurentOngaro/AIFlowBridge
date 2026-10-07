/**
 * `AIFlowBridge: Configure Kilo Code reasoning levels` command.
 *
 * Kilo Code builds its reasoning dropdown from the `variants` declared for
 * each of its provider models, and reads only `id` and `name` from
 * `GET /v1/models`. The levels therefore have to be written in the Kilo
 * configuration file, which the user should not have to edit by hand.
 *
 * This command locates the Kilo configuration, detects the provider entries
 * pointing at our gateway, writes one variant per registry-declared
 * reasoning level, and reports what changed.
 *
 * Safety rules, in order of importance:
 *
 * - A file we cannot parse is never overwritten. The command stops and
 *   reports the path instead.
 * - The write is atomic (tmp file + rename) and lands with mode 600, since
 *   the same file usually holds a provider API key.
 * - The whole file is rewritten, so a `.jsonc` file loses its comments.
 *   That is stated in the confirmation modal before anything is written.
 */

import { chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { tryGetLoadedRegistry } from '../aiflowbridge/modelRegistry';
import {
  applyEffortVariants,
  checkEffortVariantsNeeded,
  collectEffortLevelModels,
  findGatewayProviderIds,
  isAlreadyConfigured,
  KILO_CONFIG_DIRS,
  KILO_CONFIG_FILE_NAMES,
  parseKiloConfig,
  type EffortLevelModel,
  type VariantsUpdate,
} from '../aiflowbridge/kilo-code-config';

const FILE_MODE = 0o600;
const SCHEMA_URL = 'https://app.kilo.ai/config.json';

/** Set once the offer has been evaluated, so one window offers at most once. */
let offerEvaluated = false;

interface ConfigLocation {
  path: string;
  existed: boolean;
}

/** Every path Kilo may already use, in Kilo's own discovery order. */
export function candidatePaths(home: string, join: (...segments: string[]) => string): string[] {
  const out: string[] = [];
  for (const dir of KILO_CONFIG_DIRS) {
    for (const name of KILO_CONFIG_FILE_NAMES) {
      out.push(join(...dir.split('/'), name));
    }
  }
  return out;
}

async function locateConfig(): Promise<ConfigLocation> {
  const home = homedir();
  for (const path of candidatePaths(home, (...segments) => vscode.Uri.joinPath(vscode.Uri.file(home), ...segments).fsPath)) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(path));
      return { path, existed: true };
    } catch {
      // not there: try the next candidate
    }
  }
  // nothing on disk yet: the XDG location Kilo always reads
  const created = vscode.Uri.joinPath(
    vscode.Uri.file(home),
    ...KILO_CONFIG_DIRS[0].split('/'),
    KILO_CONFIG_FILE_NAMES[1]
  ).fsPath;
  return { path: created, existed: false };
}

async function readText(path: string): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return undefined;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const uri = vscode.Uri.file(path);
  const tmp = vscode.Uri.parse(`${uri.toString()}.${process.pid}.${Date.now()}.tmp`);
  await vscode.workspace.fs.writeFile(tmp, new TextEncoder().encode(content));
  try {
    await vscode.workspace.fs.rename(tmp, uri, { overwrite: true });
  } catch (err) {
    await vscode.workspace.fs.delete(tmp, { useTrash: false }).then(undefined, () => undefined);
    throw err;
  }
  try {
    await chmod(path, FILE_MODE);
  } catch {
    // chmod is a no-op on Windows and unsupported on some remote file systems
  }
}

/** Gateway base URLs a Kilo provider may point at, including the default port. */
function gatewayBaseUrls(): string[] {
  const config = vscode.workspace.getConfiguration('aiflowbridge');
  const configured = config.get<string>('gateway.baseUrl', '').trim();
  const port = config.get<number>('gateway.port', 8787);
  const urls = new Set<string>();
  if (configured.length > 0) {
    urls.add(configured);
  }
  urls.add(`http://127.0.0.1:${port}/v1`);
  urls.add(`http://localhost:${port}/v1`);
  return [...urls];
}

async function pickProvider(detected: readonly string[]): Promise<string | undefined> {
  if (detected.length === 1) {
    return detected[0];
  }
  if (detected.length > 1) {
    return vscode.window.showQuickPick([...detected], {
      title: t('command.configureKiloCodePickProvider'),
      placeHolder: t('command.configureKiloCodePickProviderPlaceholder'),
    });
  }
  const entered = await vscode.window.showInputBox({
    title: t('command.configureKiloCodeAskProvider'),
    prompt: t('command.configureKiloCodeAskProviderPrompt'),
    placeHolder: t('command.configureKiloCodeAskProviderPlaceholder'),
    ignoreFocusOut: true,
  });
  return entered?.trim() || undefined;
}

function summarize(updates: readonly VariantsUpdate[]): string {
  return updates
    .map((update) => {
      const before = update.previous.length > 0 ? update.previous.join(', ') : t('command.configureKiloCodeNoEntry');
      return `${update.model}: ${before} -> ${update.levels.join(', ')}`;
    })
    .join('\n');
}

/** Put `$schema` first, the way Kilo's own documentation writes it. */
function withSchemaFirst(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.$schema === 'string') {
    return config;
  }
  const ordered: Record<string, unknown> = { $schema: SCHEMA_URL };
  for (const [key, value] of Object.entries(config)) {
    if (key !== '$schema') {
      ordered[key] = value;
    }
  }
  return ordered;
}

export async function configureKiloCodeCommand(models?: readonly EffortLevelModel[]): Promise<void> {
  const targets = models ?? collectEffortLevelModels(tryGetLoadedRegistry());
  if (targets.length === 0) {
    void vscode.window.showInformationMessage(t('command.configureKiloCodeNoLevels'));
    return;
  }

  const location = await locateConfig();
  logger.info(`[AIFlowBridge] Configuring Kilo Code reasoning levels in ${location.path}`);

  const raw = location.existed ? await readText(location.path) : undefined;
  const config = parseKiloConfig(raw ?? '');
  if (!config) {
    void vscode.window.showErrorMessage(t('command.configureKiloCodeUnparseable', location.path));
    logger.warn(`[AIFlowBridge] Refusing to rewrite an unparseable Kilo config at ${location.path}`);
    return;
  }

  const providerId = await pickProvider(findGatewayProviderIds(config, gatewayBaseUrls()));
  if (!providerId) {
    return;
  }

  const result = applyEffortVariants(config, [providerId], targets);
  if (result.unknownProviders.length > 0) {
    void vscode.window.showErrorMessage(t('command.configureKiloCodeUnknownProvider', providerId, location.path));
    logger.warn(`[AIFlowBridge] Kilo provider "${providerId}" is absent from ${location.path}`);
    return;
  }
  if (result.updates.length === 0) {
    void vscode.window.showInformationMessage(t('command.configureKiloCodeNoModels'));
    return;
  }
  if (isAlreadyConfigured(result.updates)) {
    void vscode.window.showInformationMessage(t('command.configureKiloCodeUpToDate'));
    return;
  }

  const apply = t('command.configureKiloCodeApply');
  const confirmation = await vscode.window.showWarningMessage(
    t('command.configureKiloCodeConfirm', location.path, String(result.updates.length)),
    { modal: true, detail: summarize(result.updates) },
    apply
  );
  if (confirmation !== apply) {
    return;
  }

  const content = JSON.stringify(withSchemaFirst(result.config), null, 2) + '\n';
  try {
    await writeAtomic(location.path, content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(t('command.configureKiloCodeFailed', message));
    logger.error('[AIFlowBridge] Failed to write the Kilo configuration', err);
    return;
  }
  logger.info(`[AIFlowBridge] Kilo Code reasoning levels updated in ${location.path}: ${summarize(result.updates)}`);
  const reveal = t('command.configureKiloCodeOpen');
  const choice = await vscode.window.showInformationMessage(
    t('command.configureKiloCodeDone', String(result.updates.length)),
    reveal
  );
  if (choice === reveal) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(location.path));
  }
}

/**
 * Offer the configuration once per window when Kilo Code is set up against
 * our gateway but does not yet offer the declared reasoning levels.
 *
 * Activation time is the trigger rather than request time. Kilo Code builds
 * the dropdown when a session starts, so a write triggered by a request would
 * arrive too late to fix the session that produced it; the check here also
 * covers the next session without the user having to remember the command.
 *
 * The check stays silent unless it is certain to be useful: no level-declaring
 * model, no Kilo file, an unparseable file, no provider pointing at the
 * gateway, or an already-correct configuration all produce nothing. The offer
 * is a question, never a silent write, since a rewrite drops the comments of a
 * `.jsonc` file.
 */
export async function maybeOfferKiloConfiguration(): Promise<void> {
  if (offerEvaluated) {
    return;
  }
  offerEvaluated = true;
  if (!vscode.workspace.getConfiguration('aiflowbridge').get<boolean>('kiloCode.promptReasoningLevels', true)) {
    return;
  }
  const models = collectEffortLevelModels(tryGetLoadedRegistry());
  if (models.length === 0) {
    return;
  }
  const location = await locateConfig();
  if (!location.existed) {
    return;
  }
  const raw = await readText(location.path);
  const config = parseKiloConfig(raw ?? '');
  if (!config) {
    return;
  }
  const check = checkEffortVariantsNeeded(config, findGatewayProviderIds(config, gatewayBaseUrls()), models);
  if (!check.offer) {
    return;
  }

  logger.info(
    `[AIFlowBridge] Offering Kilo Code reasoning levels for ${check.models.join(', ')} (${check.providers.join(', ')} in ${location.path})`
  );
  const configure = t('command.configureKiloCodeOfferConfigure');
  const never = t('command.configureKiloCodeOfferNever');
  const choice = await vscode.window.showInformationMessage(
    t('command.configureKiloCodeOffer', check.models.join(', ')),
    configure,
    t('command.configureKiloCodeOfferLater'),
    never
  );
  if (choice === configure) {
    await configureKiloCodeCommand(models);
    return;
  }
  if (choice === never) {
    await vscode.workspace
      .getConfiguration('aiflowbridge')
      .update('kiloCode.promptReasoningLevels', false, vscode.ConfigurationTarget.Global);
  }
}