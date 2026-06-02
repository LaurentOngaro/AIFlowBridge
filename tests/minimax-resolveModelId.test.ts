/**
 * Unit tests for resolveMiniMaxModelId.
 * Since the VS Code id IS the API id, resolveMiniMaxModelId is a passthrough
 * (modulo the user override setting).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet } = vi.hoisted(() => ({
	mockGet: vi.fn(),
}));

vi.mock('vscode', () => {
	return {
		default: {
			workspace: {
				getConfiguration: vi.fn(() => ({
					get: mockGet,
				})),
			},
		},
	};
});

import { resolveMiniMaxModelId } from '../src/provider/minimax';

describe('resolveMiniMaxModelId', () => {
	beforeEach(() => {
		mockGet.mockReset();
	});

	it('returns the id unchanged when no override is set', () => {
		mockGet.mockReturnValue(undefined);
		expect(resolveMiniMaxModelId('MiniMax-M2.5')).toBe('MiniMax-M2.5');
		expect(resolveMiniMaxModelId('MiniMax-M3')).toBe('MiniMax-M3');
	});

	it('uses user override from settings when present', () => {
		mockGet.mockReturnValue({ 'MiniMax-M2.7': 'custom-override' });
		expect(resolveMiniMaxModelId('MiniMax-M2.7')).toBe('custom-override');
	});

	it('returns original id when override is an empty record', () => {
		mockGet.mockReturnValue({});
		expect(resolveMiniMaxModelId('MiniMax-M2.7')).toBe('MiniMax-M2.7');
	});

	it('handles unknown model ids as passthrough', () => {
		mockGet.mockReturnValue(undefined);
		expect(resolveMiniMaxModelId('unknown-model')).toBe('unknown-model');
	});
});
