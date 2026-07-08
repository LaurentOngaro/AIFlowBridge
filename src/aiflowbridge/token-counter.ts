/**
 * MiniMax-specific token counting via the upstream `/v1/responses/input_tokens`
 * endpoint. Returns the actual tokenizer count (not the length/4 heuristic).
 *
 * Only MiniMax exposes a preprocessing token-count API; DeepSeek and Xiaomi
 * MiMo do not. DeepSeek offers a downloadable offline tokenizer zip, and
 * Xiaomi calibrates the chars/token ratio from real `usage` data in the
 * streamed response (see xiaomi.ts → updateCharsPerToken).
 */

export interface MinimaxInputTokensRequest {
	model: string;
	input: unknown[];
	instructions?: string;
}

export interface MinimaxInputTokensResponse {
	object: "response.input_tokens";
	input_tokens: number;
}

export interface FetchMinimaxPromptTokensOptions {
	baseUrl?: string;
	apiKey: string;
	model: string;
	messages: unknown[];
	signal?: AbortSignal;
	timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.minimaxi.com";
const DEFAULT_TIMEOUT_MS = 2000;

export async function fetchMinimaxPromptTokens(
	options: FetchMinimaxPromptTokensOptions,
): Promise<number | undefined> {
	if (!options.apiKey || !options.model) {
		return undefined;
	}

	const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
	const url = `${baseUrl}/v1/responses/input_tokens`;

	const controller = new AbortController();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
	// IMPROV-C02: clear the timeout in the abort handler too, not only
	// in `finally`. The `finally` branch is reached after `await fetch`
	// settles, but a host that drops the connection before the fetch
	// resolves can leave the timer firing `controller.abort()` on an
	// already-settled request. The `cleared` flag prevents
	// `clearTimeout` from racing with the `finally` cleanup.
	let cleared = false;
	const clearTimer = (): void => {
		if (cleared) {
			return;
		}
		cleared = true;
		clearTimeout(timeoutId);
	};

	if (options.signal) {
		if (options.signal.aborted) {
			clearTimer();
			return undefined;
		}
		options.signal.addEventListener(
			"abort",
			() => {
				clearTimer();
				controller.abort();
			},
			{ once: true },
		);
	}

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${options.apiKey}`,
			},
			body: JSON.stringify({ model: options.model, input: options.messages }),
			signal: controller.signal,
		});
		if (!response.ok) {
			return undefined;
		}
		const data = (await response.json()) as Partial<MinimaxInputTokensResponse>;
		return typeof data.input_tokens === "number" ? data.input_tokens : undefined;
	} catch {
		return undefined;
	} finally {
		clearTimer();
	}
}
