import vscode from 'vscode';
import { CONFIG_SECTION } from '../../consts';
import { t } from '../../i18n';
import { logger } from '../../logger';
import { DEFAULT_VISION_MODEL_ID, IMAGE_DESCRIPTION_PROMPT } from './consts';

/**
 * Hard cap on the `aiflowbridge.vision.copilotVisionModel` setting value.
 * VS Code model ids are short (`vendor-family-version` shape, typically
 * <64 chars), so 256 is a generous ceiling. Anything past that is
 * treated as if the user had not configured a value at all (the getter
 * falls back to the default `oswe-vscode-prime`). The cap defends
 * against a hostile or hand-edited `settings.json` that points the
 * vision proxy at a multi-MB string and forces the runtime to
 * allocate a buffer for the `selectChatModels({ id })` call on every
 * chat-completion. Mirrors the same defensive cap used in the
 * gateway HTTP `X-AIFlowBridge-Language` header
 * (`MAX_LANGUAGE_HINT_HEADER_LENGTH` in `gateway/server.ts`).
 */
const MAX_VISION_MODEL_ID_LENGTH = 256;

function getExcludedVendors(): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const excluded = config.get<string[]>('vision.excludedVendors', ['aiflowbridge']);
  return excluded.map((v) => v.toLowerCase().trim()).filter(Boolean);
}

export function createVisionModelGetter(): {
  get: () => Promise<vscode.LanguageModelChat | undefined>;
  reset: () => void;
} {
  let visionModel: vscode.LanguageModelChat | undefined;
  let visionModelPromise: Promise<vscode.LanguageModelChat | undefined> | undefined;

  return {
    async get() {
      if (visionModel) {
        return visionModel;
      }
      if (visionModelPromise) {
        return visionModelPromise;
      }

      visionModelPromise = (async () => {
        const id = getVisionModelId();
        if (id) {
          const models = await vscode.lm.selectChatModels({ id });
          if (models.length > 0) {
            logger.info(`[Vision] Using configured model: ${models[0].id}`);
            visionModel = models[0];
            return models[0];
          }
          // The user explicitly configured a model that is not
          // currently registered with VS Code (e.g. they removed
          // the Copilot subscription, or the model id changed in
          // a VS Code update). Surface a one-time notification so
          // the user knows their setting is being ignored instead
          // of silently falling back. The notification is throttled
          // by VS Code's own deduplication of identical messages
          // within the same session.
          logger.warn(`[Vision] Configured model "${id}" not found in vscode.lm, falling back to default`);
          void vscode.window.showWarningMessage(t('vision.configuredModelMissing', id));
        }

        const fallbackModels = await vscode.lm.selectChatModels({ id: DEFAULT_VISION_MODEL_ID });
        if (fallbackModels.length > 0) {
          logger.info(`[Vision] Using default model: ${fallbackModels[0].id}`);
          visionModel = fallbackModels[0];
          return fallbackModels[0];
        }

        logger.warn(`[Vision] No vision model available (tried configured="${id ?? 'none'}", default="${DEFAULT_VISION_MODEL_ID}")`);
        return undefined;
      })();

      return visionModelPromise;
    },

    reset() {
      visionModel = undefined;
      visionModelPromise = undefined;
    },
  };
}

function getVisionModelId(): string | undefined {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const id = config.get<string>('vision.copilotVisionModel', '');
  const trimmed = id.trim();
  if (!trimmed) {
    return undefined;
  }
  // Cap the length BEFORE returning the id, so `vscode.lm.selectChatModels`
  // is never called with a multi-MB string. See
  // `MAX_VISION_MODEL_ID_LENGTH` for the rationale.
  if (trimmed.length > MAX_VISION_MODEL_ID_LENGTH) {
    logger.warn(
      `[Vision] Configured vision model id is ${trimmed.length} chars, exceeds the ${MAX_VISION_MODEL_ID_LENGTH}-char cap; falling back to default`
    );
    return undefined;
  }
  return trimmed;
}

export async function chooseVisionProxyModel(): Promise<void> {
  const allModels = await vscode.lm.selectChatModels();
  const excludedVendors = getExcludedVendors();
  const candidates = allModels.filter((m) => !excludedVendors.includes(m.vendor.toLowerCase()));

  if (candidates.length === 0) {
    vscode.window.showInformationMessage(t('vision.noModel'));
    return;
  }

  const currentId = getVisionModelId();
  // If the user already configured an id that does not exist in the
  // current `vscode.lm` registry, surface a "(missing)" badge on
  // the picker so they understand why the value is not shown as
  // "current". Without this hint, the picker shows no entry
  // flagged as current and the user wonders whether the value was
  // saved.
  const currentIdIsMissing = currentId !== undefined && !candidates.some((m) => m.id === currentId);

  const items = candidates.map((m) => ({
    label: m.id,
    description: t('vision.vendorLabel', m.vendor),
    detail: m.id === currentId ? t('vision.current') : undefined,
  }));

  if (currentIdIsMissing) {
    // Prepend a non-pickable informational row so the user sees
    // the configured id AND the warning without having to open
    // the developer tools. `picked: false` keeps it inert; the
    // `description` carries the warning. The label uses the
    // `$(warning)` codicon so it is visually distinct from the
    // pickable rows.
    items.unshift({
      label: `$(warning) ${currentId}`,
      description: t('vision.vendorLabel', t('vision.configuredMissingVendor')),
      detail: t('vision.configuredMissing'),
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t('vision.pickPlaceholder', DEFAULT_VISION_MODEL_ID),
    matchOnDescription: true,
  });

  if (picked) {
    // The informational "missing" row uses the warning codicon
    // prefix; ignore the selection when the user clicks it.
    if (picked.label.startsWith('$(warning)')) {
      return;
    }
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await config.update('vision.copilotVisionModel', picked.label, vscode.ConfigurationTarget.Global);
  }
}

export function getVisionPrompt(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<string>('vision.prompt', IMAGE_DESCRIPTION_PROMPT).trim() || IMAGE_DESCRIPTION_PROMPT;
}
