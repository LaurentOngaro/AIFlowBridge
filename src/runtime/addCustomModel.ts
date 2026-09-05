/**
 * "Add a custom model" command: discover models from the configured upstream
 * and let the user add one to `aiflowbridge.userModels` without editing JSON.
 */

import vscode from 'vscode';
import { tryGetLoadedRegistry } from '../aiflowbridge/modelRegistry';
import { CONFIG_SECTION } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';

interface UpstreamModelEntry {
  id: string;
  owned_by?: string;
}

interface AddCustomModelResult {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: { toolCalling: boolean; imageInput: boolean; thinking: boolean };
}

const VENDOR_CHOICES = [
  { id: 'minimax', label: 'MiniMax' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'xiaomi', label: 'Xiaomi MiMo' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'googleaistudio', label: 'Google AI Studio' },
] as const;

type VendorId = (typeof VENDOR_CHOICES)[number]['id'];

const VENDOR_LABELS: Record<VendorId, string> = {
  minimax: 'MiniMax',
  deepseek: 'DeepSeek',
  xiaomi: 'Xiaomi MiMo',
  openrouter: 'OpenRouter',
  googleaistudio: 'Google AI Studio',
};

export async function addCustomModelCommand(context: vscode.ExtensionContext): Promise<void> {
  try {
    // 1. Pick the vendor
    const vendorPick = await vscode.window.showQuickPick(
      VENDOR_CHOICES.map((v) => ({ label: v.label, id: v.id })),
      { placeHolder: 'Which provider do you want to discover models from?', title: 'AIFlowBridge: Add custom model' }
    );
    if (!vendorPick) return;
    const vendor = vendorPick.id as VendorId;
    const registryBaseUrl = tryGetLoadedRegistry()?.vendors[vendor]?.baseUrl ?? '';
    const baseUrl = registryBaseUrl.replace(/\/+$/, '');

    // 2. Read API key from SecretStorage (best-effort, fetch works without for some vendors)
    const apiKey = await Promise.resolve(context.secrets.get(`aiflowbridge.providers.${vendor}.apiKey`)).catch(() => undefined);

    // 3. Fetch /v1/models
    const rawModels = await fetchUpstreamModels(baseUrl, apiKey);
    if (rawModels.length === 0) {
      void vscode.window.showWarningMessage(`No models returned by ${VENDOR_LABELS[vendor]} (${baseUrl}/models). Check your API key and try again.`);
      return;
    }

    // Deduplicate by id (some providers return the same id twice in their list)
    const seen = new Set<string>();
    const upstreamModels: UpstreamModelEntry[] = [];
    for (const m of rawModels) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        upstreamModels.push(m);
      }
    }

    // Log the full list to the output channel so users can copy/paste or grep it.
    const listLines = upstreamModels.map((m) => `  - ${m.id}${m.owned_by ? ` (owned_by: ${m.owned_by})` : ''}`);
    logger.info(
      `[AIFlowBridge] Discovered ${upstreamModels.length} model(s) from ${VENDOR_LABELS[vendor]} (${baseUrl}/models):\n${listLines.join('\n')}`
    );

    // 4. Pick a model
    const existingIds = new Set(getExistingUserModelIds());
    const candidates = upstreamModels.filter((m) => !existingIds.has(m.id));
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(`All models from ${VENDOR_LABELS[vendor]} are already in your userModels.`);
      return;
    }
    const modelPick = await vscode.window.showQuickPick(
      candidates.map((m) => ({ label: m.id, id: m.id })),
      { placeHolder: 'Select a model to add', title: `AIFlowBridge: ${VENDOR_LABELS[vendor]} models` }
    );
    if (!modelPick) return;

    // 5. Pick capabilities (multi-select). The "picked" key is non-standard; we use a per-key ask.
    const toolCalling = await vscode.window.showQuickPick([{ label: 'Yes' }, { label: 'No' }], {
      title: 'AIFlowBridge: Tool calling support?',
      placeHolder: 'Does this model support tool calling?',
    });
    if (!toolCalling) return;
    const imageInput = await vscode.window.showQuickPick([{ label: 'Yes' }, { label: 'No' }], {
      title: 'AIFlowBridge: Vision support?',
      placeHolder: 'Does this model support image input?',
    });
    if (!imageInput) return;
    const thinking = await vscode.window.showQuickPick([{ label: 'Yes' }, { label: 'No' }], {
      title: 'AIFlowBridge: Thinking support?',
      placeHolder: 'Does this model support thinking / reasoning?',
    });
    if (!thinking) return;
    const capabilities = {
      toolCalling: toolCalling.label === 'Yes',
      imageInput: imageInput.label === 'Yes',
      thinking: thinking.label === 'Yes',
    };

    // 6. Confirm and save
    const confirm = await vscode.window.showInformationMessage(
      `Add "${modelPick.id}" to userModels for ${VENDOR_LABELS[vendor]}?`,
      { modal: true },
      'Add'
    );
    if (confirm !== 'Add') return;

    const newEntry: AddCustomModelResult = {
      id: modelPick.id,
      name: modelPick.id,
      family: vendor,
      version: modelPick.id,
      maxInputTokens: 128000,
      maxOutputTokens: 8192,
      capabilities,
    };
    await appendUserModel(newEntry);
    logger.info(`[AIFlowBridge] Added custom model ${modelPick.id} (${vendor})`);
    void vscode.window.showInformationMessage(
      `Added "${modelPick.id}" to userModels. ` +
        `Reload the window (Developer: Reload Window) to see it in the Copilot Chat picker, ` +
        `and refresh the model list in your OpenAI-compatible client (Kilo Code, Continue,...) to fetch it from the gateway.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[AIFlowBridge] Failed to add custom model', error);
    void vscode.window.showErrorMessage(`Failed to add custom model: ${message}`);
  }
}

async function fetchUpstreamModels(baseUrl: string, apiKey: string | undefined): Promise<UpstreamModelEntry[]> {
  const url = `${baseUrl}/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${url}`);
  }
  const body = (await response.json()) as { data?: unknown };
  if (!body || !Array.isArray(body.data)) {
    return [];
  }
  const result: UpstreamModelEntry[] = [];
  for (const entry of body.data) {
    if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      result.push({
        id: (entry as { id: string }).id,
        owned_by: typeof (entry as { owned_by?: unknown }).owned_by === 'string' ? (entry as { owned_by: string }).owned_by : undefined,
      });
    }
  }
  return result;
}

function getExistingUserModelIds(): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const raw = config.get<unknown[]>('userModels', []);
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      ids.push((entry as { id: string }).id);
    }
  }
  return ids;
}

async function appendUserModel(entry: AddCustomModelResult): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = config.get<unknown[]>('userModels', []);
  const next = Array.isArray(current) ? [...current, entry] : [entry];

  // Try Global first, then fall back to Workspace if the user has no
  // User Settings file yet (which makes Global writes fail with
  // "aiflowbridge.userModels is not a registered configuration").
  const targets: vscode.ConfigurationTarget[] = [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace];
  let lastError: unknown;
  for (const target of targets) {
    try {
      await config.update('userModels', next, target);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  throw new Error(`Could not persist userModels to User or Workspace settings: ${message}`);
}
