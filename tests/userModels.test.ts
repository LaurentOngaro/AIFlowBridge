/**
 * Unit tests for user-defined models handling.
 * Covers getUserModels() validation and the merge logic in BaseChatProvider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUserModels } = vi.hoisted(() => ({
	mockUserModels: { value: [] as unknown },
}));

vi.mock('vscode', () => {
	return {
		default: {
			workspace: {
				getConfiguration: vi.fn(() => ({
					get: vi.fn((key: string, fallback?: unknown) => {
						if (key === 'userModels') {
							return mockUserModels.value;
						}
						return fallback;
					}),
				})),
			},
			window: {
				createOutputChannel: vi.fn(() => ({
					name: 'AIFlowBridge',
					log: vi.fn(),
					trace: vi.fn(),
					debug: vi.fn(),
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					dispose: vi.fn(),
					append: vi.fn(),
					appendLine: vi.fn(),
					clear: vi.fn(),
					show: vi.fn(),
					hide: vi.fn(),
				})),
			},
		},
	};
});

describe('getUserModels', () => {
	beforeEach(() => {
		mockUserModels.value = [];
	});

	it('returns empty array when setting is missing', async () => {
		mockUserModels.value = undefined;
		const { getUserModels } = await import('../src/config');
		expect(getUserModels()).toEqual([]);
	});

	it('returns empty array for non-array setting', async () => {
		mockUserModels.value = 'not an array';
		const { getUserModels } = await import('../src/config');
		expect(getUserModels()).toEqual([]);
	});

	it('skips entries with missing required fields', async () => {
		mockUserModels.value = [
			{ id: 'a', name: 'A', family: 'minimax', version: '1' }, // valid
			{ id: '', name: 'X', family: 'minimax', version: '1' }, // empty id
			{ name: 'X', family: 'minimax', version: '1' }, // missing id
			{ id: 'c', family: 'minimax', version: '1' }, // missing name
			{ id: 'd', name: 'D', version: '1' }, // missing family
			{ id: 'e', name: 'E', family: 'minimax' }, // missing version
			null, // null entry
			'string', // non-object
		];
		const { getUserModels } = await import('../src/config');
		const result = getUserModels();
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('a');
	});

	it('trims whitespace from string fields', async () => {
		mockUserModels.value = [
			{ id: '  a  ', name: '  A  ', family: '  minimax  ', version: '  1  ' },
		];
		const { getUserModels } = await import('../src/config');
		const result = getUserModels();
		expect(result[0]).toMatchObject({
			id: 'a',
			name: 'A',
			family: 'minimax',
			version: '1',
		});
	});

	it('preserves optional fields when valid', async () => {
		mockUserModels.value = [
			{
				id: 'm3',
				name: 'MiniMax M3',
				family: 'minimax',
				version: 'm3',
				detail: 'New MiniMax model',
				maxInputTokens: 256000,
				maxOutputTokens: 16000,
				capabilities: { toolCalling: true, imageInput: true, thinking: true },
				requiresThinkingParam: false,
			},
		];
		const { getUserModels } = await import('../src/config');
		const result = getUserModels();
		expect(result[0]).toMatchObject({
			id: 'm3',
			name: 'MiniMax M3',
			detail: 'New MiniMax model',
			maxInputTokens: 256000,
			maxOutputTokens: 16000,
			capabilities: { toolCalling: true, imageInput: true, thinking: true },
			requiresThinkingParam: false,
		});
	});

	it('drops invalid token counts (zero/negative/non-number)', async () => {
		mockUserModels.value = [
			{ id: 'a', name: 'A', family: 'minimax', version: '1', maxInputTokens: 0 },
			{ id: 'b', name: 'B', family: 'minimax', version: '1', maxInputTokens: -100 },
			{ id: 'c', name: 'C', family: 'minimax', version: '1', maxInputTokens: 'big' },
		];
		const { getUserModels } = await import('../src/config');
		const result = getUserModels();
		expect(result[0].maxInputTokens).toBeUndefined();
		expect(result[1].maxInputTokens).toBeUndefined();
		expect(result[2].maxInputTokens).toBeUndefined();
	});
});
