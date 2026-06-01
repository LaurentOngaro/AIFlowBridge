import vscode from 'vscode';
import { DEFAULT_VISION_MODEL_ID, IMAGE_DESCRIPTION_PROMPT } from './consts';
import { CONFIG_SECTION } from '../../consts';
import { t } from '../../i18n';
import { logger } from '../../logger';

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
					logger.warn(`[Vision] Configured model "${id}" not found in vscode.lm`);
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
	return id.trim() || undefined;
}

export async function setVisionProxyModel(): Promise<void> {
	const allModels = await vscode.lm.selectChatModels();
	const excludedVendors = getExcludedVendors();
	const candidates = allModels.filter((m) => !excludedVendors.includes(m.vendor.toLowerCase()));

	if (candidates.length === 0) {
		vscode.window.showInformationMessage(t('vision.noModel'));
		return;
	}

	const currentId = getVisionModelId();

	const items = candidates.map((m) => ({
		label: m.id,
		description: t('vision.vendorLabel', m.vendor),
		detail: m.id === currentId ? t('vision.current') : undefined,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: t('vision.pickPlaceholder', DEFAULT_VISION_MODEL_ID),
		matchOnDescription: true,
	});

	if (picked) {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await config.update('vision.copilotVisionModel', picked.label, vscode.ConfigurationTarget.Global);
	}
}

export function getVisionPrompt(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return (
		config.get<string>('vision.prompt', IMAGE_DESCRIPTION_PROMPT).trim() || IMAGE_DESCRIPTION_PROMPT
	);
}