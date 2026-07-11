import vscode from 'vscode';
import { getLoadedRegistry } from '../aiflowbridge/modelRegistry';
import type { ModelDefinition } from '../types';
import { toChatInfo } from './models';
import type { DeepSeekChatProvider } from './index';
import type { MiniMaxChatProvider } from './minimax';
import type { XiaomiChatProvider } from './xiaomi';

type AnyProvider = DeepSeekChatProvider | MiniMaxChatProvider | XiaomiChatProvider;

interface ProviderEntry {
	provider: AnyProvider;
	modelIds: Set<string>;
	hasApiKey: () => Promise<boolean>;
}

/**
 * Telemetry sink for Copilot Chat requests. The provider calls this
 * AFTER each `provideLanguageModelChatResponse` (success or error)
 * with a fully-formed summary so the dashboard sees Copilot Chat
 * traffic in the same place as gateway traffic.
 *
 * Action plan item #6: closes the historical blind spot in the
 * metrics view where ~50% of usage (the Copilot Chat path) was
 * invisible because the gateway only ever saw its own traffic.
 */
export interface CopilotChatTelemetrySink {
	recordFromCopilotChat(options: {
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
	}): void;
}

/**
 * Unified provider that delegates to the correct sub-provider based on model ID.
 * Registered once under the 'aiflowbridge' vendor.
 */
export class UnifiedChatProvider implements vscode.LanguageModelChatProvider {
	private readonly onDidChangeLanguageModelChatInformationEmitter =
		new vscode.EventEmitter<void>();

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private readonly entries: ProviderEntry[] = [];
	private telemetrySink: CopilotChatTelemetrySink | undefined;

	constructor(providers: AnyProvider[]) {
		for (const provider of providers) {
			const models = this.getModelsForProvider(provider);
			this.entries.push({
				provider,
				modelIds: new Set(models.map((m) => m.id)),
				hasApiKey: () => this.resolveHasApiKey(provider),
			});
		}
	}

	dispose(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.dispose();
	}

	refreshAll(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	/**
	 * Wire a telemetry sink for Copilot Chat traffic. The sink is
	 * resolved lazily (after the runtime builds its `TelemetryStore`)
	 * because the runtime and the provider live in separate modules
	 * with no shared construction order. A no-op when never called
	 * (the unified provider keeps working without telemetry).
	 */
	setTelemetrySink(sink: CopilotChatTelemetrySink | undefined): void {
		this.telemetrySink = sink;
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const results: vscode.LanguageModelChatInformation[] = [];

		for (const entry of this.entries) {
			const hasKey = await entry.hasApiKey();
			const models = this.getModelsForProvider(entry.provider);
			for (const model of models) {
				results.push(toChatInfo(model, hasKey));
			}
		}

		return results;
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const entry = this.findEntry(modelInfo.id);
		if (!entry) {
			throw new Error(`No provider found for model: ${modelInfo.id}`);
		}
		// Time the wrapped call so the dashboard can show the same
		// end-to-end latency for Copilot Chat traffic as for gateway
		// traffic. Errors are caught and routed to telemetry with the
		// matching status / error message, then re-thrown so the
		// caller (VS Code Copilot Chat) sees the original failure
		// semantics unchanged.
		const startedAt = Date.now();
		let status = 200;
		let errorMessage: string | undefined;
		try {
			await entry.provider.provideLanguageModelChatResponse(
				modelInfo,
				messages,
				options,
				progress,
				token,
			);
		} catch (error) {
			// Map a few known error shapes to HTTP-ish status codes
			// so the dashboard's "errors" counter and the by-source
			// status breakdown stay meaningful. Anything else lands
			// as 500.
			status = this.classifyError(error);
			errorMessage = error instanceof Error ? error.message : String(error);
			this.recordTelemetry(entry, modelInfo, status, startedAt, { errorMessage });
			throw error;
		}
		this.recordTelemetry(entry, modelInfo, status, startedAt, { errorMessage });
	}

	private recordTelemetry(
		entry: ProviderEntry,
		modelInfo: vscode.LanguageModelChatInformation,
		status: number,
		startedAt: number,
		extra: { errorMessage?: string },
	): void {
		const sink = this.telemetrySink;
		if (!sink) {
			return;
		}
		const vendor = this.getProviderVendor(entry.provider);
		try {
			sink.recordFromCopilotChat({
				providerId: vendor,
				providerLabel: this.providerLabel(vendor),
				model: modelInfo.id,
				status,
				durationMs: Date.now() - startedAt,
				// Token counts are not currently exposed by the
				// per-provider streaming pipeline (the
				// `streamUsage` object is captured locally but not
				// returned). Set to 0 and flag the entry as
				// `estimated: false` so the dashboard Token source
				// column reads "usage" (truthful: no estimate was
				// computed). A future change can plumb the real
				// counts through without touching the dashboard.
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				estimated: false,
				errorMessage: extra.errorMessage,
			});
		} catch {
			// Telemetry failures must never break the provider
			// pipeline. The dashboard would be missing a single
			// row; the upstream call is unaffected.
		}
	}

	private providerLabel(vendor: string): string {
		switch (vendor) {
			case 'deepseek':
				return 'DeepSeek';
			case 'minimax':
				return 'MiniMax';
			case 'xiaomi':
				return 'Xiaomi MiMo';
			default:
				return vendor;
		}
	}

	private classifyError(error: unknown): number {
		// `ProviderRequestError` (provider/errors.ts) carries an
		// upstream HTTP status when the upstream returned a non-2xx
		// response. Forward it so the dashboard error counter
		// reflects what actually happened.
		const status = (error as { status?: unknown })?.status;
		if (typeof status === 'number' && status >= 400 && status < 600) {
			return status;
		}
		return 500;
	}

	async provideTokenCount(
		modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		token: vscode.CancellationToken,
	): Promise<number> {
		const entry = this.findEntry(modelInfo.id);
		if (!entry) {
			// Fallback: rough estimate
			const chars = typeof text === 'string' ? text.length : JSON.stringify(text).length;
			return Math.max(1, Math.ceil(chars / 4));
		}
		return entry.provider.provideTokenCount(modelInfo, text, token);
	}

	async prepareForDeactivate(): Promise<void> {
		for (const entry of this.entries) {
			await entry.provider.prepareForDeactivate();
		}
	}

	private findEntry(modelId: string): ProviderEntry | undefined {
		return this.entries.find((e) => e.modelIds.has(modelId));
	}

	private getModelsForProvider(provider: AnyProvider): ModelDefinition[] {
		// Each provider exposes its models via the family filter
		const vendor = this.getProviderVendor(provider);
		return getLoadedRegistry().models.filter((m) => m.family === vendor);
	}

	private getProviderVendor(provider: AnyProvider): string {
		// DeepSeekChatProvider doesn't extend BaseChatProvider, so check explicitly
		if ('family' in provider && typeof (provider as { family?: string }).family === 'string') {
			return (provider as { family: string }).family;
		}
		// For BaseChatProvider subclasses, vendor is the family
		if ('vendor' in provider && typeof (provider as { vendor?: string }).vendor === 'string') {
			return (provider as { vendor: string }).vendor;
		}
		// DeepSeekChatProvider: hardcode
		return 'deepseek';
	}

	private async resolveHasApiKey(provider: AnyProvider): Promise<boolean> {
		// DeepSeekChatProvider has hasApiKey()
		if (typeof (provider as { hasApiKey?: () => Promise<boolean> }).hasApiKey === 'function') {
			return (provider as { hasApiKey: () => Promise<boolean> }).hasApiKey();
		}
		// BaseChatProvider subclasses have getAuthManager()
		if (
			typeof (provider as { getAuthManager?: () => { hasApiKey(): Promise<boolean> } }).getAuthManager === 'function'
		) {
			return (
				provider as { getAuthManager: () => { hasApiKey(): Promise<boolean> } }
			).getAuthManager().hasApiKey();
		}
		return false;
	}
}

