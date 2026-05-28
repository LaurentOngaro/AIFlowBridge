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
				const id = getConfiguredVisionModelId() ?? DEFAULT_VISION_MODEL_ID;
				const models = await vscode.lm.selectChatModels({ id });
				if (models.length > 0) {
					logger.info(t('vision.proxyUsing', models[0].id));
					visionModel = models[0];
					return models[0];
				}
				logger.warn(t('vision.notFound', id));
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

export async function setVisionProxyModel(): Promise<void> {
	const allModels = await vscode.lm.selectChatModels();
	const excludedVendors = getExcludedVendors();
	const candidates = allModels.filter((m) => !excludedVendors.includes(m.vendor.toLowerCase()));

	if (candidates.length === 0) {
		vscode.window.showInformationMessage(t('vision.noModel'));
		return;
	}

	const currentId = getConfiguredVisionModelId();

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
		await config.update('vision.model', picked.label, vscode.ConfigurationTarget.Global);
	}
}

export function getVisionPrompt(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return (
		config.get<string>('vision.prompt', IMAGE_DESCRIPTION_PROMPT).trim() || IMAGE_DESCRIPTION_PROMPT
	);
}

function getConfiguredVisionModelId(): string | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const id = config.get<string>('vision.model', '');
	return id.trim() || undefined;
}