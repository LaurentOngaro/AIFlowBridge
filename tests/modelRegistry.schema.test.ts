/**
 * Unit tests for `src/aiflowbridge/modelRegistry.schema.ts`:
 *  - `validateRegistryStructure()` (fail-hard)
 *  - `validateRegistryContent()` / `validateModelEntry()` / `validateVendorEntry()` (fail-soft)
 *  - Field helpers (nonEmptyString, booleanField, positiveInt, nonNegativeNumber, toolCallingField)
 *  - Deep-merge helpers (deepMergeModel, deepMergeVendor, mergeTiers)
 *
 * The schema module is intentionally VS Code-free so it can be tested here
 * without mocking the host.
 */

import { describe, it, expect } from 'vitest';
import {
	RegistryStructureError,
	booleanField,
	deepMergeModel,
	deepMergeVendor,
	mergeTiers,
	nonEmptyString,
	nonNegativeNumber,
	positiveInt,
	toolCallingField,
	validateModelEntry,
	validateRegistryContent,
	validateRegistryStructure,
	validateVendorEntry,
	type ModelDefinition,
	type RegistryFile,
	type RegistryModelDefinition,
	type VendorDefinition,
} from '../src/aiflowbridge/modelRegistry.schema';

describe('validateRegistryStructure (fail-hard)', () => {
	it('accepts a valid registry', () => {
		const raw = {
			version: 1,
			vendors: { deepseek: { baseUrl: 'https://x', apiKeySecret: 'k' } },
			models: [
				{
					id: 'm1',
					name: 'M1',
					family: 'deepseek',
					version: '1',
					detail: 'd',
					maxInputTokens: 1,
					maxOutputTokens: 1,
					capabilities: { toolCalling: true, imageInput: false, thinking: false },
					requiresThinkingParam: false,
				},
			],
		};
		expect(() => validateRegistryStructure(raw)).not.toThrow();
	});

	it('accepts a registry without vendors', () => {
		const raw = { version: 1, models: [] };
		expect(() => validateRegistryStructure(raw)).not.toThrow();
	});

	it('rejects non-object root', () => {
		expect(() => validateRegistryStructure('not json')).toThrow(RegistryStructureError);
		expect(() => validateRegistryStructure(null)).toThrow(RegistryStructureError);
		expect(() => validateRegistryStructure(undefined)).toThrow(RegistryStructureError);
		expect(() => validateRegistryStructure([])).toThrow(RegistryStructureError);
		expect(() => validateRegistryStructure(42)).toThrow(RegistryStructureError);
	});

	it('rejects non-integer version', () => {
		expect(() => validateRegistryStructure({ version: '1', models: [] })).toThrow(/version/);
		expect(() => validateRegistryStructure({ version: 1.5, models: [] })).toThrow(/version/);
	});

	it('rejects unsupported version', () => {
		expect(() => validateRegistryStructure({ version: 0, models: [] })).toThrow(/unsupported version/);
		expect(() => validateRegistryStructure({ version: 99, models: [] })).toThrow(/unsupported version/);
	});

	it('rejects missing or non-array models', () => {
		expect(() => validateRegistryStructure({ version: 1 })).toThrow(/"models"/);
		expect(() => validateRegistryStructure({ version: 1, models: 'oops' })).toThrow(/"models"/);
		expect(() => validateRegistryStructure({ version: 1, models: null })).toThrow(/"models"/);
	});

	it('rejects vendors that is not an object', () => {
		expect(() => validateRegistryStructure({ version: 1, models: [], vendors: 'oops' })).toThrow(/vendors/);
		expect(() => validateRegistryStructure({ version: 1, models: [], vendors: [] })).toThrow(/vendors/);
		expect(() => validateRegistryStructure({ version: 1, models: [], vendors: null })).toThrow(/vendors/);
	});
});

describe('validateModelEntry (fail-soft)', () => {
	function validEntry(overrides: Partial<RegistryModelDefinition> = {}): RegistryModelDefinition {
		return {
			id: 'm1',
			name: 'M1',
			family: 'minimax',
			version: '1',
			detail: 'd',
			maxInputTokens: 1024,
			maxOutputTokens: 512,
			capabilities: { toolCalling: true, imageInput: false, thinking: false },
			requiresThinkingParam: false,
			...overrides,
		};
	}

	it('accepts a valid entry', () => {
		const result = validateModelEntry(validEntry());
		expect(result).not.toBeNull();
		expect(result?.id).toBe('m1');
	});

	it('rejects non-object entry', () => {
		expect(validateModelEntry(null)).toBeNull();
		expect(validateModelEntry('oops')).toBeNull();
		expect(validateModelEntry([])).toBeNull();
	});

	it('rejects missing id / name / family / version / detail', () => {
		const log = { skipped: [] };
		expect(validateModelEntry({ ...validEntry(), id: '' }, 0, log)).toBeNull();
		expect(validateModelEntry({ ...validEntry(), id: '   ' }, 0, log)).toBeNull();
		expect(log.skipped.length).toBeGreaterThan(0);
	});

	it('rejects unknown family', () => {
		const log = { skipped: [] };
		expect(validateModelEntry(validEntry({ family: 'made-up' }), 0, log)).toBeNull();
		expect(log.skipped[0].reason).toMatch(/unknown "family"/);
	});

	it('rejects zero/negative token counts', () => {
		const log = { skipped: [] };
		expect(validateModelEntry(validEntry({ maxInputTokens: 0 }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ maxInputTokens: -1 }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ maxOutputTokens: 0 }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ maxOutputTokens: 1.5 }), 0, log)).toBeNull();
	});

	it('rejects non-boolean requiresThinkingParam', () => {
		const log = { skipped: [] };
		expect(validateModelEntry(validEntry({ requiresThinkingParam: 'yes' }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ requiresThinkingParam: 1 }), 0, log)).toBeNull();
	});

	it('rejects capabilities that is not an object', () => {
		const log = { skipped: [] };
		expect(validateModelEntry(validEntry({ capabilities: null as never }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ capabilities: [] as never }), 0, log)).toBeNull();
	});

	it('rejects non-boolean / non-integer toolCalling', () => {
		const log = { skipped: [] };
		expect(validateModelEntry(validEntry({ capabilities: { toolCalling: -1, imageInput: false, thinking: false } }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ capabilities: { toolCalling: 'yes', imageInput: false, thinking: false } }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ capabilities: { toolCalling: 1.5, imageInput: false, thinking: false } }), 0, log)).toBeNull();
	});

	it('rejects non-boolean imageInput / thinking', () => {
		const log = { skipped: [] };
		expect(validateModelEntry(validEntry({ capabilities: { toolCalling: true, imageInput: 1, thinking: false } }), 0, log)).toBeNull();
		expect(validateModelEntry(validEntry({ capabilities: { toolCalling: true, imageInput: false, thinking: 'maybe' } }), 0, log)).toBeNull();
	});

	it('accepts numeric toolCalling (DeepSeek limit)', () => {
		const result = validateModelEntry(
			validEntry({
				family: 'deepseek',
				capabilities: { toolCalling: 128, imageInput: true, thinking: true },
			}),
		);
		expect(result?.capabilities.toolCalling).toBe(128);
	});

	it('accepts a valid pricing block', () => {
		const result = validateModelEntry(
			validEntry({
				pricing: { inputPerMillion: 0.27, outputPerMillion: 1.1, currency: 'USD' },
			}),
		);
		expect(result?.pricing).toEqual({ inputPerMillion: 0.27, outputPerMillion: 1.1, currency: 'USD' });
	});

	it('rejects unsupported pricing currency', () => {
		const log = { skipped: [] };
		expect(
			validateModelEntry(
				validEntry({ pricing: { inputPerMillion: 0.27, outputPerMillion: 1.1, currency: 'EUR' } }),
				0,
				log,
			),
		).toBeNull();
		expect(log.skipped[0].reason).toMatch(/unsupported "pricing.currency"/);
	});

	it('rejects negative pricing numbers', () => {
		const log = { skipped: [] };
		expect(
			validateModelEntry(
				validEntry({ pricing: { inputPerMillion: -1, outputPerMillion: 1.1, currency: 'USD' } }),
				0,
				log,
			),
		).toBeNull();
		expect(
			validateModelEntry(
				validEntry({ pricing: { inputPerMillion: 0.27, outputPerMillion: -1, currency: 'USD' } }),
				0,
				log,
			),
		).toBeNull();
	});
});

describe('validateModelEntry (partial mode - override tiers)', () => {
	// Override tiers (globalStorage, workspace) are expected to provide only
	// the fields the user wants to override. Missing fields are filled in
	// by the deep merge with the bundled entry. Without this mode, a user
	// who only wants to change `pricing` for one model would have to
	// reproduce the entire entry, and any mistake in the rest of the entry
	// would be silently dropped, which is the T3 bug.

	it('accepts an entry that only sets pricing (the canonical T3 user scenario)', () => {
		const log = { skipped: [] };
		const result = validateModelEntry(
			{
				id: 'MiniMax-M2.7',
				pricing: { inputPerMillion: 0.99, outputPerMillion: 4.2, currency: 'USD' },
			},
			0,
			log,
			'partial',
		);
		expect(result).not.toBeNull();
		expect(result).toEqual({
			id: 'MiniMax-M2.7',
			pricing: { inputPerMillion: 0.99, outputPerMillion: 4.2, currency: 'USD' },
		});
		expect(log.skipped).toHaveLength(0);
	});

	it('accepts an entry that only sets id (workspace-only model)', () => {
		const log = { skipped: [] };
		const result = validateModelEntry({ id: 'm1' }, 0, log, 'partial');
		expect(result).toEqual({ id: 'm1' });
		expect(log.skipped).toHaveLength(0);
	});

	it('still requires id in partial mode', () => {
		const log = { skipped: [] };
		expect(validateModelEntry({ pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } }, 0, log, 'partial')).toBeNull();
		expect(log.skipped.some((entry) => /missing\/invalid "id"/.test(entry.reason))).toBe(true);
	});

	it('still rejects unknown family when explicitly provided', () => {
		const log = { skipped: [] };
		expect(validateModelEntry({ id: 'm1', family: 'made-up' }, 0, log, 'partial')).toBeNull();
		expect(log.skipped.some((entry) => /unknown "family"/.test(entry.reason))).toBe(true);
	});

	it('still rejects invalid pricing when explicitly provided', () => {
		const log = { skipped: [] };
		expect(
			validateModelEntry(
				{ id: 'm1', pricing: { inputPerMillion: -1, outputPerMillion: 1, currency: 'USD' } },
				0,
				log,
				'partial',
			),
		).toBeNull();
		expect(log.skipped.some((entry) => /inputPerMillion/.test(entry.reason))).toBe(true);
	});

	it('rejects a partial entry with non-object content (parity with strict mode)', () => {
		expect(validateModelEntry(null, 0, undefined, 'partial')).toBeNull();
		expect(validateModelEntry('oops', 0, undefined, 'partial')).toBeNull();
	});
});

describe('validateVendorEntry (fail-soft)', () => {
	it('accepts a minimal valid vendor', () => {
		expect(validateVendorEntry({ baseUrl: 'https://x', apiKeySecret: 'k' })).toEqual({
			baseUrl: 'https://x',
			apiKeySecret: 'k',
		});
	});

	it('preserves externalUrls when valid', () => {
		const result = validateVendorEntry({
			baseUrl: 'https://x',
			apiKeySecret: 'k',
			externalUrls: { apiKeys: 'https://k', usage: '  https://u  ' },
		}) as VendorDefinition;
		expect(result.externalUrls).toEqual({ apiKeys: 'https://k', usage: 'https://u' });
	});

	it('rejects non-object entries', () => {
		expect(validateVendorEntry(null)).toBeNull();
		expect(validateVendorEntry('oops')).toBeNull();
		expect(validateVendorEntry([])).toBeNull();
	});

	it('rejects entries missing baseUrl or apiKeySecret', () => {
		expect(validateVendorEntry({ apiKeySecret: 'k' })).toBeNull();
		expect(validateVendorEntry({ baseUrl: 'https://x' })).toBeNull();
		expect(validateVendorEntry({ baseUrl: '', apiKeySecret: 'k' })).toBeNull();
	});

	it('rejects invalid externalUrls', () => {
		expect(
			validateVendorEntry({ baseUrl: 'https://x', apiKeySecret: 'k', externalUrls: 'oops' }),
		).toBeNull();
		expect(
			validateVendorEntry({ baseUrl: 'https://x', apiKeySecret: 'k', externalUrls: null }),
		).toBeNull();
	});
});

describe('validateRegistryContent', () => {
	function model(id: string, family: 'deepseek' | 'minimax' | 'xiaomi' = 'minimax'): ModelDefinition {
		return {
			id,
			name: id,
			family,
			version: '1',
			detail: 'd',
			maxInputTokens: 1,
			maxOutputTokens: 1,
			capabilities: { toolCalling: true, imageInput: false, thinking: false },
			requiresThinkingParam: false,
		};
	}

	it('returns validated vendors and models with empty log', () => {
		const raw: RegistryFile = {
			version: 1,
			vendors: { deepseek: { baseUrl: 'https://x', apiKeySecret: 'k' } },
			models: [model('a')],
		};
		const result = validateRegistryContent(raw);
		expect(result.log.skipped).toEqual([]);
		expect(Object.keys(result.vendors)).toEqual(['deepseek']);
		expect(result.models.map((m) => m.id)).toEqual(['a']);
	});

	it('drops invalid entries and logs reasons', () => {
		const raw: RegistryFile = {
			version: 1,
			vendors: { good: { baseUrl: 'https://x', apiKeySecret: 'k' }, bad: { baseUrl: 'https://x' } },
			models: [model('good'), model('bad', 'made-up' as 'minimax')],
		};
		const result = validateRegistryContent(raw);
		expect(Object.keys(result.vendors)).toEqual(['good']);
		expect(result.models.map((m) => m.id)).toEqual(['good']);
		expect(result.log.skipped.length).toBe(2);
	});
});

describe('Field helpers', () => {
	it('nonEmptyString trims and rejects empty', () => {
		expect(nonEmptyString('a')).toBe('a');
		expect(nonEmptyString('  a  ')).toBe('a');
		expect(nonEmptyString('')).toBeUndefined();
		expect(nonEmptyString('   ')).toBeUndefined();
		expect(nonEmptyString(123 as never)).toBeUndefined();
		expect(nonEmptyString(null)).toBeUndefined();
	});

	it('booleanField accepts only booleans', () => {
		expect(booleanField(true)).toBe(true);
		expect(booleanField(false)).toBe(false);
		expect(booleanField('true' as never)).toBeUndefined();
		expect(booleanField(0 as never)).toBeUndefined();
	});

	it('positiveInt accepts strictly positive integers', () => {
		expect(positiveInt(1)).toBe(1);
		expect(positiveInt(1000)).toBe(1000);
		expect(positiveInt(0)).toBeUndefined();
		expect(positiveInt(-1)).toBeUndefined();
		expect(positiveInt(1.5)).toBeUndefined();
		expect(positiveInt('1' as never)).toBeUndefined();
	});

	it('nonNegativeNumber accepts zero and positive finite numbers', () => {
		expect(nonNegativeNumber(0)).toBe(0);
		expect(nonNegativeNumber(0.5)).toBe(0.5);
		expect(nonNegativeNumber(1.5)).toBe(1.5);
		expect(nonNegativeNumber(-1)).toBeUndefined();
		expect(nonNegativeNumber(NaN)).toBeUndefined();
		expect(nonNegativeNumber(Infinity)).toBeUndefined();
	});

	it('toolCallingField accepts boolean or non-negative integer', () => {
		expect(toolCallingField(true)).toBe(true);
		expect(toolCallingField(false)).toBe(false);
		expect(toolCallingField(0)).toBe(0);
		expect(toolCallingField(128)).toBe(128);
		expect(toolCallingField(-1)).toBeUndefined();
		expect(toolCallingField(1.5)).toBeUndefined();
		expect(toolCallingField('yes' as never)).toBeUndefined();
	});
});

describe('Deep merge', () => {
	function baseModel(): RegistryModelDefinition {
		return {
			id: 'm1',
			name: 'M1',
			family: 'minimax',
			version: '1',
			detail: 'base detail',
			maxInputTokens: 100,
			maxOutputTokens: 50,
			capabilities: { toolCalling: true, imageInput: false, thinking: false },
			requiresThinkingParam: false,
			pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' },
		};
	}

	it('deepMergeModel: override wins per field, capabilities shallow-merged', () => {
		const merged = deepMergeModel(baseModel(), {
			id: 'm1', name: 'M1', family: 'minimax', version: '1', detail: 'override', maxInputTokens: 100, maxOutputTokens: 50,
			capabilities: { toolCalling: true, imageInput: true, thinking: false },
			requiresThinkingParam: false,
		});
		expect(merged.detail).toBe('override');
		expect(merged.capabilities).toEqual({ toolCalling: true, imageInput: true, thinking: false });
	});

	it('deepMergeModel: pricing fields fall through when absent in override', () => {
		const override: Partial<RegistryModelDefinition> = {
			capabilities: { toolCalling: true, imageInput: false, thinking: false },
		};
		const merged = deepMergeModel(baseModel(), override as RegistryModelDefinition);
		expect(merged.pricing).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
	});

	it('deepMergeModel: override can add pricing on a model without one', () => {
		const base = baseModel();
		const withoutPricing: RegistryModelDefinition = { ...base, pricing: undefined };
		const merged = deepMergeModel(withoutPricing, {
			...base, pricing: { inputPerMillion: 0.1, outputPerMillion: 0.3, currency: 'USD' },
		});
		expect(merged.pricing).toEqual({ inputPerMillion: 0.1, outputPerMillion: 0.3, currency: 'USD' });
	});

	it('deepMergeVendor: externalUrls shallow-merged', () => {
		const base: VendorDefinition = {
			baseUrl: 'https://base',
			apiKeySecret: 'k',
			externalUrls: { apiKeys: 'https://k', usage: 'https://u' },
		};
		const override: VendorDefinition = {
			baseUrl: 'https://override',
			apiKeySecret: 'k',
			externalUrls: { tokenPlanCn: 'https://cn' },
		};
		expect(deepMergeVendor(base, override)).toEqual({
			baseUrl: 'https://override',
			apiKeySecret: 'k',
			externalUrls: { apiKeys: 'https://k', usage: 'https://u', tokenPlanCn: 'https://cn' },
		});
	});

	it('mergeTiers: later tier wins, fields not overridden fall through', () => {
		const t1: ReturnType<typeof validateRegistryContent> = {
			vendors: { deepseek: { baseUrl: 'https://base', apiKeySecret: 'k' } },
			models: [baseModel()],
			log: { skipped: [] },
		};
		const t2: ReturnType<typeof validateRegistryContent> = {
			vendors: { deepseek: { baseUrl: 'https://override', apiKeySecret: 'k' } },
			models: [
				{
					...baseModel(),
					detail: 'override',
				},
			],
			log: { skipped: [] },
		};
		const merged = mergeTiers(t1, t2);
		expect(merged.vendors.deepseek.baseUrl).toBe('https://override');
		const m = merged.models.find((x) => x.id === 'm1');
		expect(m?.detail).toBe('override');
		// pricing should still come from t1
		expect(m?.pricing).toEqual({ inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' });
	});

	it('mergeTiers: workspace-only model is preserved', () => {
		const merged = mergeTiers(undefined, undefined, {
			vendors: {},
			models: [{ ...baseModel(), id: 'workspace-only' }],
			log: { skipped: [] },
		});
		expect(merged.models.find((m) => m.id === 'workspace-only')).toBeDefined();
	});

	it('mergeTiers: empty yields empty registry', () => {
		expect(mergeTiers()).toEqual({ version: 1, vendors: {}, models: [] });
	});
});
