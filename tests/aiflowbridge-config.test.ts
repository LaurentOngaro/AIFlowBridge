/**
 * Unit tests for src/aiflowbridge/config.ts
 * Focus: synthesizeProvidersFromUserModels() - merging user-declared models
 * into the gateway provider list so OpenAI-compatible clients (Kilo Code,
 * Continue, ...) see them via GET /v1/models.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUserModels, mockConfiguration } = vi.hoisted(() => {
	const mockUserModels = { value: [] as unknown[] };
	const mockConfiguration = {
		get: vi.fn((key: string, fallback?: unknown) => {
			if (key.startsWith('providers.') && key.endsWith('.baseUrl')) {
				return undefined;
			}
			return fallback;
		}),
	};
	return { mockUserModels, mockConfiguration };
});

vi.mock('vscode', () => {
	return {
		default: {
			workspace: {
				getConfiguration: vi.fn(() => ({
					get: vi.fn((key: string, fallback?: unknown) => {
						if (key === 'userModels') return mockUserModels.value;
						return mockConfiguration.get(key, fallback);
					}),
				})),
			},
		},
	};
});

import { synthesizeProvidersFromUserModels } from '../src/aiflowbridge/config';
import { selectProvider, buildModelCatalog } from '../src/aiflowbridge/providers';
import type { ProviderProfile } from '../src/aiflowbridge/types';
import { DEFAULT_PROVIDER_URLS } from '../src/consts';

function baseProvider(): ProviderProfile {
	return {
		id: 'minimax',
		label: 'MiniMax V2.7',
		kind: 'openai-compat',
		baseUrl: DEFAULT_PROVIDER_URLS.minimax,
		model: 'MiniMax-M2.7',
		enabled: true,
	};
}

function fakeConfig(): unknown {
	return {
		get: (key: string, fallback?: unknown) => {
			if (key.startsWith('providers.') && key.endsWith('.baseUrl')) {
				return undefined;
			}
			return fallback;
		},
	};
}

describe('synthesizeProvidersFromUserModels', () => {
	beforeEach(() => {
		mockUserModels.value = [];
	});

	it('returns existing providers unchanged when userModels is empty', () => {
		const existing = [baseProvider()];
		const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);
		expect(result).toEqual(existing);
	});

	it('adds a synthesized provider for a MiniMax M3 user model', () => {
		mockUserModels.value = [
			{ id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' },
		];
		const existing = [baseProvider()];
		const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);

		expect(result).toHaveLength(2);
		const m3 = result.find((p) => p.model === 'MiniMax-M3');
		expect(m3).toBeDefined();
		expect(m3).toMatchObject({
			id: 'MiniMax-M3',
			label: 'MiniMax M3',
			kind: 'openai-compat',
			baseUrl: DEFAULT_PROVIDER_URLS.minimax,
			model: 'MiniMax-M3',
			enabled: true,
		});
	});

	it('does not duplicate a model already covered by an existing provider', () => {
		mockUserModels.value = [
			{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7', family: 'minimax', version: 'm2.7' },
		];
		const existing = [baseProvider()];
		const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);
		expect(result).toHaveLength(1);
		expect(result[0].model).toBe('MiniMax-M2.7');
	});

	it('does not duplicate a model whose id collides with an existing provider id', () => {
		mockUserModels.value = [
			{ id: 'minimax', name: 'MiniMax (duplicate)', family: 'minimax', version: 'x' },
		];
		const existing = [baseProvider()];
		const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);
		expect(result).toHaveLength(1);
	});

	it('skips user models with an unknown family', () => {
		mockUserModels.value = [
			{ id: 'mystery-1', name: 'Mystery', family: 'unknown-vendor', version: '1' },
		];
		const existing = [baseProvider()];
		const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);
		expect(result).toHaveLength(1);
	});

	it('handles multiple user models across vendors', () => {
		mockUserModels.value = [
			{ id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' },
			{ id: 'mimo-v2-omni', name: 'MiMo V2 Omni', family: 'xiaomi', version: 'v2' },
			{ id: 'deepseek-v4-turbo', name: 'DeepSeek V4 Turbo', family: 'deepseek', version: 'v4' },
		];
		const existing: ProviderProfile[] = [];
		const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);

		expect(result).toHaveLength(3);
		expect(result.find((p) => p.model === 'MiniMax-M3')?.baseUrl).toBe(DEFAULT_PROVIDER_URLS.minimax);
		expect(result.find((p) => p.model === 'mimo-v2-omni')?.baseUrl).toBe(DEFAULT_PROVIDER_URLS.xiaomi);
		expect(result.find((p) => p.model === 'deepseek-v4-turbo')?.baseUrl).toBe(DEFAULT_PROVIDER_URLS.deepseek);
	});

	it('preserves the order: existing providers first, then synthesized ones', () => {
		mockUserModels.value = [
			{ id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' },
		];
		const existing = [baseProvider()];
		const result = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);
		expect(result[0].id).toBe('minimax');
		expect(result[1].id).toBe('MiniMax-M3');
	});
});

describe('integration with selectProvider and buildModelCatalog', () => {
	beforeEach(() => {
		mockUserModels.value = [
			{ id: 'MiniMax-M3', name: 'MiniMax M3', family: 'minimax', version: 'm3' },
		];
	});

	it('synthesized provider is routable via selectProvider by model name', () => {
		const existing = [baseProvider()];
		const providers = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);
		const routed = selectProvider(providers, 'MiniMax-M3', '');
		expect(routed).toBeDefined();
		expect(routed?.model).toBe('MiniMax-M3');
		expect(routed?.baseUrl).toBe(DEFAULT_PROVIDER_URLS.minimax);
	});

	it('synthesized provider appears in the /v1/models catalog', () => {
		const existing = [baseProvider()];
		const providers = synthesizeProvidersFromUserModels(existing, fakeConfig() as never);
		const catalog = buildModelCatalog(providers);
		const ids = catalog.map((m) => m.id);
		expect(ids).toContain('MiniMax-M3');
	});
});
