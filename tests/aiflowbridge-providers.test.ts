/**
 * Unit tests for src/aiflowbridge/providers.ts
 * Tests normalizeProviderProfiles, selectProvider, buildModelCatalog.
 */

import { describe, it, expect } from 'vitest';
import {
	normalizeProviderProfiles,
	selectProvider,
	buildModelCatalog,
} from '../src/aiflowbridge/providers';

describe('normalizeProviderProfiles', () => {
	it('returns empty array for non-array input', () => {
		expect(normalizeProviderProfiles(null)).toEqual([]);
		expect(normalizeProviderProfiles(undefined)).toEqual([]);
		expect(normalizeProviderProfiles('not an array')).toEqual([]);
		expect(normalizeProviderProfiles({ id: 'p1' })).toEqual([]);
	});

	it('returns empty array for empty array', () => {
		expect(normalizeProviderProfiles([])).toEqual([]);
	});

	it('preserves valid profiles as-is', () => {
		const input = [
			{
				id: 'p1',
				label: 'Provider 1',
				kind: 'openai-compat',
				baseUrl: 'https://api.example.com/v1',
				model: 'model-1',
				apiKey: 'sk-123',
			},
		];
		const result = normalizeProviderProfiles(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: 'p1',
			label: 'Provider 1',
			kind: 'openai-compat',
			baseUrl: 'https://api.example.com/v1',
			model: 'model-1',
			apiKey: 'sk-123',
			enabled: true,
		});
	});

	it('drops profiles with missing required fields', () => {
		const input = [
			{ id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm' },
			{ id: '', label: 'L2', baseUrl: 'https://x', model: 'm' },
			{ id: 'p3', label: '', baseUrl: 'https://x', model: 'm' },
			{ id: 'p4', label: 'L4', baseUrl: '', model: 'm' },
			{ id: 'p5', label: 'L5', baseUrl: 'https://x', model: '' },
		];
		const result = normalizeProviderProfiles(input);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('p1');
	});

	it('drops non-object entries', () => {
		const input = [null, undefined, 'string', 42, true, { id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm' }];
		const result = normalizeProviderProfiles(input as unknown[]);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('p1');
	});

	it('normalizes kind to openai-compat for invalid values', () => {
		const input = [
			{ id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm', kind: 'invalid-kind' },
			{ id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', kind: undefined },
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0].kind).toBe('openai-compat');
		expect(result[1].kind).toBe('openai-compat');
	});

	it('accepts ollama as valid kind', () => {
		const input = [
			{ id: 'p1', label: 'L1', baseUrl: 'http://localhost:11434', model: 'llama3', kind: 'ollama' },
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0].kind).toBe('ollama');
	});

	it('preserves enabled=false', () => {
		const input = [
			{ id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm', enabled: false },
			{ id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', enabled: true },
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0].enabled).toBe(false);
		expect(result[1].enabled).toBe(true);
	});

	it('defaults enabled to true when missing or invalid', () => {
		const input = [
			{ id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm' },
			{ id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', enabled: 'yes' },
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0].enabled).toBe(true);
		expect(result[1].enabled).toBe(true);
	});

	it('trims whitespace from string fields', () => {
		const input = [
			{ id: '  p1  ', label: '  L1  ', baseUrl: '  https://x  ', model: '  m  ', apiKey: '  sk-1  ' },
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0]).toMatchObject({
			id: 'p1',
			label: 'L1',
			baseUrl: 'https://x',
			model: 'm',
			apiKey: 'sk-1',
		});
	});

	it('uses id as label fallback when label is missing', () => {
		const input = [{ id: 'p1', baseUrl: 'https://x', model: 'm' }];
		const result = normalizeProviderProfiles(input);
		expect(result[0].label).toBe('p1');
	});

	it('preserves pricing when valid', () => {
		const input = [
			{
				id: 'p1',
				label: 'L1',
				baseUrl: 'https://x',
				model: 'm',
				pricing: { inputPerMillion: 1.5, outputPerMillion: 2.0, currency: 'EUR' },
			},
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0].pricing).toEqual({
			inputPerMillion: 1.5,
			outputPerMillion: 2.0,
			currency: 'EUR',
		});
	});

	it('drops invalid pricing object', () => {
		const input = [
			{ id: 'p1', label: 'L1', baseUrl: 'https://x', model: 'm', pricing: 'invalid' },
			{ id: 'p2', label: 'L2', baseUrl: 'https://x', model: 'm', pricing: 42 },
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0].pricing).toBeUndefined();
		expect(result[1].pricing).toBeUndefined();
	});

	it('defaults pricing currency to USD when missing', () => {
		const input = [
			{
				id: 'p1',
				label: 'L1',
				baseUrl: 'https://x',
				model: 'm',
				pricing: { inputPerMillion: 1, outputPerMillion: 2 },
			},
		];
		const result = normalizeProviderProfiles(input);
		expect(result[0].pricing?.currency).toBe('USD');
	});
});

describe('selectProvider', () => {
	const providers = [
		{
			id: 'deepseek-flash',
			label: 'DeepSeek Flash',
			kind: 'openai-compat' as const,
			baseUrl: 'https://api.deepseek.com',
			model: 'deepseek-v4-flash',
			enabled: true,
		},
		{
			id: 'minimax',
			label: 'MiniMax',
			kind: 'openai-compat' as const,
			baseUrl: 'https://api.minimax.io/v1',
			model: 'minimax-v2.7',
			enabled: true,
		},
		{
			id: 'disabled',
			label: 'Disabled',
			kind: 'openai-compat' as const,
			baseUrl: 'https://x',
			model: 'm',
			enabled: false,
		},
	];

	it('returns undefined for empty providers', () => {
		expect(selectProvider([])).toBeUndefined();
	});

	it('returns the only enabled provider as fallback', () => {
		const onlyOne = [providers[0]];
		expect(selectProvider(onlyOne, undefined, undefined)).toBe(onlyOne[0]);
	});

	it('matches by requested model id (case-insensitive)', () => {
		expect(selectProvider(providers, 'DEEPSEEK-FLASH', undefined)).toBe(providers[0]);
	});

	it('matches by upstream model name', () => {
		expect(selectProvider(providers, 'minimax-v2.7', undefined)).toBe(providers[1]);
	});

	it('matches by label', () => {
		expect(selectProvider(providers, 'DeepSeek Flash', undefined)).toBe(providers[0]);
	});

	it('falls back to defaultModel when requestedModel has no match', () => {
		expect(selectProvider(providers, 'unknown', 'minimax')).toBe(providers[1]);
	});

	it('skips disabled providers', () => {
		const result = selectProvider(providers, 'disabled', undefined);
		expect(result).not.toBe(providers[2]);
		expect(result?.id).not.toBe('disabled');
	});

	it('returns first enabled provider when nothing matches', () => {
		const result = selectProvider(providers, 'unknown', 'also-unknown');
		expect(result).toBe(providers[0]);
	});
});

describe('buildModelCatalog', () => {
	it('returns empty array when no enabled providers', () => {
		const providers = [
			{
				id: 'p1',
				label: 'L1',
				kind: 'openai-compat' as const,
				baseUrl: 'https://x',
				model: 'm',
				enabled: false,
			},
		];
		expect(buildModelCatalog(providers)).toEqual([]);
	});

	it('returns OpenAI-compatible model entries for enabled providers', () => {
		const providers = [
			{
				id: 'p1',
				label: 'Provider 1',
				kind: 'openai-compat' as const,
				baseUrl: 'https://x',
				model: 'model-1',
				enabled: true,
			},
			{
				id: 'p2',
				label: 'Provider 2',
				kind: 'openai-compat' as const,
				baseUrl: 'https://x',
				model: 'model-2',
				enabled: true,
			},
		];
		const catalog = buildModelCatalog(providers);
		expect(catalog).toHaveLength(2);
		expect(catalog[0]).toMatchObject({
			id: 'p1',
			object: 'model',
			owned_by: 'aiflowbridge',
			name: 'Provider 1 (model-1)',
		});
		expect(catalog[1].id).toBe('p2');
		expect(typeof catalog[0].created).toBe('number');
	});

	it('skips disabled providers', () => {
		const providers = [
			{
				id: 'p1',
				label: 'L1',
				kind: 'openai-compat' as const,
				baseUrl: 'https://x',
				model: 'm',
				enabled: true,
			},
			{
				id: 'p2',
				label: 'L2',
				kind: 'openai-compat' as const,
				baseUrl: 'https://x',
				model: 'm',
				enabled: false,
			},
		];
		const catalog = buildModelCatalog(providers);
		expect(catalog).toHaveLength(1);
		expect(catalog[0].id).toBe('p1');
	});
});
