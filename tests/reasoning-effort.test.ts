/**
 * Reasoning-effort levels declared per model in the registry
 * (`reasoningEffortLevels`).
 *
 * MiniMax M3.1 Flash always thinks and cannot be switched off,
 * but its depth is tunable through the upstream `reasoning_effort` field
 * with 5 levels. The registry declares that range, the Copilot Chat
 * picker renders it, and the provider forwards the selection verbatim.
 * Every model without such a range keeps the historical
 * none / high / max dropdown mapped to the `reasoning_split` boolean.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  return {
    default: {
      ThemeIcon: class MockThemeIcon {
        constructor(public id: string) {}
      },
      workspace: {
        getConfiguration: vi.fn(() => ({ get: vi.fn(), inspect: vi.fn() })),
      },
    },
  };
});

import { getRawConfiguredReasoningEffort, resolveEffortLevel, toChatInfo } from '../src/provider/models';
import type { ModelConfigurationOptions } from '../src/provider/models';
import { en } from '../src/i18n';
import type { ModelDefinition } from '../src/types';

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Build the provider options object. `toolMode` is required by the stable
 * `vscode.ProvideLanguageModelChatResponseOptions` type but is not read by
 * the helpers under test, so the cast keeps the fixtures readable.
 */
function options(config: Record<string, unknown> = {}): ModelConfigurationOptions {
  return { modelConfiguration: config, toolMode: 1 } as unknown as ModelConfigurationOptions;
}

function model(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: 'MiniMax-M3.1-Flash',
    name: 'MiniMax M3.1 Flash',
    family: 'minimax',
    version: 'm3.1-flash',
    detail: 'd',
    maxInputTokens: 1000,
    maxOutputTokens: 500,
    capabilities: { toolCalling: true, imageInput: true, thinking: true },
    requiresThinkingParam: true,
    ...overrides,
  };
}

function effortSchema(modelDef: ModelDefinition) {
  const info = toChatInfo(modelDef, true) as unknown as {
    configurationSchema: { properties: { reasoningEffort: Record<string, unknown> } };
  };
  return info.configurationSchema.properties.reasoningEffort;
}

describe('Copilot Chat thinking-effort dropdown', () => {
  it('lists exactly the levels the registry declares, in order', () => {
    expect(effortSchema(model({ reasoningEffortLevels: EFFORT_LEVELS })).enum).toEqual(EFFORT_LEVELS);
  });

  it('defaults to the highest declared level, which is the upstream default when the field is omitted', () => {
    expect(effortSchema(model({ reasoningEffortLevels: EFFORT_LEVELS })).default).toBe('max');
  });

  it('never offers none for a model that cannot think less than its lowest level', () => {
    expect(effortSchema(model({ reasoningEffortLevels: EFFORT_LEVELS })).enum).not.toContain('none');
  });

  it('labels and describes every declared level', () => {
    const schema = effortSchema(model({ reasoningEffortLevels: EFFORT_LEVELS }));
    const labels = schema.enumItemLabels as string[];
    const descriptions = schema.enumDescriptions as string[];
    expect(labels).toHaveLength(EFFORT_LEVELS.length);
    expect(descriptions).toHaveLength(EFFORT_LEVELS.length);
    for (const [index, level] of EFFORT_LEVELS.entries()) {
      expect(labels[index]).toBe(en[`thinking.${level}`]);
      expect(descriptions[index]).toBe(en[`thinking.${level}.desc`]);
      expect(labels[index]).not.toBe(`thinking.${level}`);
    }
  });

  it('falls back to a capitalized level when the i18n table has no entry for it', () => {
    const schema = effortSchema(model({ reasoningEffortLevels: ['turbo'] }));
    expect(schema.enumItemLabels).toEqual(['Turbo']);
    expect(schema.enumDescriptions).toEqual(['']);
  });

  it('keeps the historical none / high / max dropdown for a model that declares no range', () => {
    const schema = effortSchema(model({ id: 'MiniMax-M3' }));
    expect(schema.enum).toEqual(['none', 'high', 'max']);
    expect(schema.default).toBe('high');
  });

  it('keeps the historical dropdown for an empty level list', () => {
    const schema = effortSchema(model({ reasoningEffortLevels: [] }));
    expect(schema.enum).toEqual(['none', 'high', 'max']);
  });

  it('exposes no dropdown at all for a model that is not thinking-capable', () => {
    const info = toChatInfo(model({ capabilities: { toolCalling: true, imageInput: false, thinking: false } }), true);
    expect(info).not.toHaveProperty('configurationSchema');
  });
});

describe('resolveEffortLevel', () => {
  it('uses the picker value when it is a declared level', () => {
    expect(resolveEffortLevel(EFFORT_LEVELS, 'low', undefined)).toBe('low');
    expect(resolveEffortLevel(EFFORT_LEVELS, 'xhigh', 'low')).toBe('xhigh');
  });

  it('falls back to the setting when the picker sent nothing usable', () => {
    expect(resolveEffortLevel(EFFORT_LEVELS, undefined, 'medium')).toBe('medium');
    expect(resolveEffortLevel(EFFORT_LEVELS, 'ultra', 'medium')).toBe('medium');
  });

  it('falls back to the highest declared level when neither input applies', () => {
    expect(resolveEffortLevel(EFFORT_LEVELS, undefined, undefined)).toBe('max');
    expect(resolveEffortLevel(EFFORT_LEVELS, 'none', 'none')).toBe('max');
  });

  it('never returns none, which the upstream rejects on an always-thinking model', () => {
    expect(resolveEffortLevel(EFFORT_LEVELS, 'none', undefined)).toBe('max');
  });

  it('returns high for a model that declares no range, the historical neutral value', () => {
    expect(resolveEffortLevel([], 'low', 'max')).toBe('high');
  });
});

describe('getRawConfiguredReasoningEffort', () => {
  it('reads the picker value from modelConfiguration, and from configuration as a fallback host', () => {
    expect(getRawConfiguredReasoningEffort(options({ reasoningEffort: 'xhigh' }))).toBe('xhigh');
    // Older hosts put the same field under `configuration`.
    const legacy = { configuration: { reasoningEffort: 'low' }, toolMode: 1 } as unknown as ModelConfigurationOptions;
    expect(getRawConfiguredReasoningEffort(legacy)).toBe('low');
  });

  it('returns undefined when the client sent no usable value', () => {
    expect(getRawConfiguredReasoningEffort(options())).toBeUndefined();
    expect(getRawConfiguredReasoningEffort(options({ reasoningEffort: '' }))).toBeUndefined();
    expect(getRawConfiguredReasoningEffort(options({ reasoningEffort: 3 }))).toBeUndefined();
  });
});
