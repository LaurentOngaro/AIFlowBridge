/**
 * Shared error handling for non-DeepSeek providers (MiniMax, Xiaomi, etc.).
 * Provides typed errors with user-facing messages and diagnostic info.
 */

export type ProviderRequestErrorKind = 'http' | 'network' | 'auth' | 'unknown';

export class ProviderRequestError extends Error {
	readonly kind: ProviderRequestErrorKind;
	readonly userSummary: string;
	readonly diagnosticMessage: string;
	readonly baseUrl?: string;
	readonly status?: number;
	readonly provider: string;

	constructor(options: {
		message: string;
		userSummary?: string;
		kind: ProviderRequestErrorKind;
		diagnosticMessage?: string;
		baseUrl?: string;
		status?: number;
		provider: string;
		cause?: unknown;
	}) {
		super(options.message, { cause: options.cause });
		this.name = 'ProviderRequestError';
		this.kind = options.kind;
		this.userSummary = options.userSummary ?? options.message;
		this.diagnosticMessage = options.diagnosticMessage ?? options.message;
		this.baseUrl = options.baseUrl;
		this.status = options.status;
		this.provider = options.provider;
	}
}

/**
 * Create an HTTP error with user-facing message based on status code.
 */
export function createHttpProviderError(
	response: Response,
	baseUrl: string,
	provider: string,
): ProviderRequestError {
	const status = response.status;
	const userSummary = getHttpErrorMessage(status);
	const diagnosticMessage = `kind=http provider=${provider} status=${status} baseUrl=${baseUrl} statusText=${response.statusText || 'unknown'}`;

	return new ProviderRequestError({
		message: `${provider} API request failed with HTTP ${status}`,
		userSummary,
		kind: 'http',
		baseUrl,
		status,
		provider,
		diagnosticMessage,
	});
}

/**
 * Normalize an unknown error into a ProviderRequestError.
 */
export function normalizeProviderError(
	error: unknown,
	provider: string,
	baseUrl?: string,
): ProviderRequestError {
	if (error instanceof ProviderRequestError) {
		return error;
	}

	if (error instanceof Error) {
		// Check for auth-related errors
		if (error.message.includes('401') || error.message.toLowerCase().includes('unauthorized')) {
			return new ProviderRequestError({
				message: error.message,
				userSummary: `Authentication failed. Please check your ${provider} API key.`,
				kind: 'auth',
				provider,
				baseUrl,
				cause: error,
			});
		}

		return new ProviderRequestError({
			message: error.message,
			kind: 'unknown',
			provider,
			baseUrl,
			cause: error,
		});
	}

	const value = String(error);
	return new ProviderRequestError({
		message: `${provider} request failed with non-Error value: ${value}`,
		kind: 'unknown',
		provider,
		diagnosticMessage: `kind=unknown provider=${provider} error=${value}`,
	});
}

function getHttpErrorMessage(status: number): string {
	switch (status) {
		case 400:
			return `Bad request (${status}). The request was malformed.`;
		case 401:
			return `Authentication failed (${status}). Please check your API key.`;
		case 402:
			return `Payment required (${status}). Your account may have insufficient credits.`;
		case 403:
			return `Forbidden (${status}). You don't have permission to access this resource.`;
		case 404:
			return `Not found (${status}). The requested resource doesn't exist.`;
		case 422:
			return `Unprocessable entity (${status}). The request was well-formed but invalid.`;
		case 429:
			return `Rate limited (${status}). Too many requests. Please wait and try again.`;
		case 500:
			return `Server error (${status}). The server encountered an internal error.`;
		case 502:
			return `Bad gateway (${status}). The server received an invalid response.`;
		case 503:
			return `Service unavailable (${status}). The server is temporarily overloaded.`;
		default:
			return `HTTP error ${status}.`;
	}
}
