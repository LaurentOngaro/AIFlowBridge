/**
 * Kilo Code client configuration: reasoning-effort variant generation.
 *
 * The user report behind this file: with MiniMax M3.1 Flash reached
 * through the AIFlowBridge gateway, Kilo Code offered a `None` / `Thinking`
 * pair instead of the five levels the model declares. Kilo renders that
 * dropdown from the model's `variants`, and its `/models` auto-detection
 * reads only `id` and `name`, so the gateway cannot carry the levels. These
 * tests pin the pure half of the fix: what goes into the file.
 */

import { describe, expect, it } from 'vitest';
import {
  applyEffortVariants,
  buildEffortVariants,
  checkEffortVariantsNeeded,
  collectEffortLevelModels,
  endpointKey,
  findGatewayProviderIds,
  isAlreadyConfigured,
  parseKiloConfig,
  stripJsonComments,
  stripTrailingCommas,
  variantsMatchLevels,
  type EffortLevelModel,
} from '../src/aiflowbridge/kilo-code-config';
import type { ModelRegistry } from '../src/aiflowbridge/modelRegistry.schema';

const M31: EffortLevelModel = {
  id: 'MiniMax-M3.1-Flash',
  name: 'MiniMax M3.1 Flash',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
};

const gatewayConfig = {
  $schema: 'https://app.kilo.ai/config.json',
  provider: {
    aiflowbridge: {
      options: { baseURL: 'http://127.0.0.1:8787/v1', apiKey: 'sk-aiflowbridge-local' },
      models: {
        'MiniMax-M3.1-Flash': {
          name: 'MiniMax M3.1 Flash',
          reasoning: true,
          variants: { none: { reasoning_split: false }, thinking: { reasoning_split: true } },
        },
      },
    },
    other: { options: { baseURL: 'https://api.example.test/v1' } },
  },
} as unknown as Record<string, unknown>;

describe('JSONC reader', () => {
  it('keeps a URL intact while stripping a line comment', () => {
    const stripped = stripJsonComments('{"baseURL": "https://example.test/v1"} // trailing note');
    expect(JSON.parse(stripped).baseURL).toBe('https://example.test/v1');
  });

  it('ignores a comment marker inside a string value', () => {
    const stripped = stripJsonComments('{ "note": "a /* not a comment */ b" }');
    expect(JSON.parse(stripped).note).toBe('a /* not a comment */ b');
  });

  it('drops block comments and keeps line numbering readable', () => {
    const stripped = stripJsonComments('{\n/* one\n   two */\n"a": 1\n}');
    expect(JSON.parse(stripped).a).toBe(1);
    expect(stripped.split('\n').length).toBe(5);
  });

  it('removes trailing commas before a closing bracket', () => {
    expect(JSON.parse(stripTrailingCommas('[1, 2, ]'))).toEqual([1, 2]);
    expect(JSON.parse(stripTrailingCommas('{ "a": 1, }'))).toEqual({ a: 1 });
  });

  it('parses a JSONC configuration with comments and trailing commas', () => {
    const parsed = parseKiloConfig(`{
      // the gateway
      "provider": {
        "aiflowbridge": {
          "options": { "baseURL": "http://127.0.0.1:8787/v1", },
        },
      },
    }`);
    expect(parsed).toBeDefined();
    expect(findGatewayProviderIds(parsed as Record<string, unknown>, ['http://127.0.0.1:8787/v1'])).toEqual(['aiflowbridge']);
  });

  it('refuses a broken document rather than guessing', () => {
    expect(parseKiloConfig('{ "provider": ')).toBeUndefined();
    expect(parseKiloConfig('[]')).toBeUndefined();
    expect(parseKiloConfig('')).toBeUndefined();
  });
});

describe('gateway provider detection', () => {
  it('matches on host and port, so a missing /v1 suffix does not matter', () => {
    expect(endpointKey('http://127.0.0.1:8787/v1')).toBe('127.0.0.1:8787');
    expect(endpointKey('http://127.0.0.1:8787/')).toBe('127.0.0.1:8787');
    expect(endpointKey('http://localhost:8787/v1')).toBe('127.0.0.1:8787');
  });

  it('finds the provider that points at the gateway and leaves the others alone', () => {
    expect(findGatewayProviderIds(gatewayConfig, ['http://127.0.0.1:8787/v1'])).toEqual(['aiflowbridge']);
  });

  it('finds nothing when no provider points at the gateway', () => {
    expect(findGatewayProviderIds(gatewayConfig, ['http://127.0.0.1:9999/v1'])).toEqual([]);
    expect(findGatewayProviderIds({}, ['http://127.0.0.1:8787/v1'])).toEqual([]);
    expect(findGatewayProviderIds(gatewayConfig, [])).toEqual([]);
  });

  it('survives a provider entry with no options block', () => {
    const config = { provider: { broken: {}, alsoBroken: { options: { baseURL: 42 } } } };
    expect(findGatewayProviderIds(config, ['http://127.0.0.1:8787/v1'])).toEqual([]);
  });
});

describe('variant generation', () => {
  it('maps every declared level to a reasoningEffort of the same name', () => {
    expect(buildEffortVariants(M31.levels)).toEqual({
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      high: { reasoningEffort: 'high' },
      xhigh: { reasoningEffort: 'xhigh' },
      max: { reasoningEffort: 'max' },
    });
  });

  it('replaces the stale none/thinking pair documented by Kilo itself', () => {
    const result = applyEffortVariants(gatewayConfig, ['aiflowbridge'], [M31]);
    const model = (
      (result.config as { provider: { aiflowbridge: { models: Record<string, Record<string, unknown>> } } }).provider
        .aiflowbridge.models
    )['MiniMax-M3.1-Flash'];
    expect(Object.keys(model.variants as Record<string, unknown>)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(model.variants).not.toHaveProperty('none');
    expect(model.variants).not.toHaveProperty('thinking');
    expect(result.updates[0].previous).toEqual(['none', 'thinking']);
    expect(result.updates[0].levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('preserves the sibling provider, the api key and the other model fields', () => {
    const result = applyEffortVariants(gatewayConfig, ['aiflowbridge'], [M31]);
    const provider = (result.config as { provider: Record<string, Record<string, unknown>> }).provider;
    expect(provider.other).toEqual({ options: { baseURL: 'https://api.example.test/v1' } });
    expect((provider.aiflowbridge.options as { apiKey: string }).apiKey).toBe('sk-aiflowbridge-local');
    expect((provider.aiflowbridge.models as Record<string, { name: string }>)['MiniMax-M3.1-Flash'].name).toBe(
      'MiniMax M3.1 Flash'
    );
  });

  it('does not mutate the configuration it was given', () => {
    const before = JSON.stringify(gatewayConfig);
    applyEffortVariants(gatewayConfig, ['aiflowbridge'], [M31]);
    expect(JSON.stringify(gatewayConfig)).toBe(before);
  });

  it('creates the model map when the provider relies on Kilo auto-detection', () => {
    const config = { provider: { aiflowbridge: { options: { baseURL: 'http://127.0.0.1:8787/v1' } } } };
    const result = applyEffortVariants(config, ['aiflowbridge'], [M31]);
    const models = (result.config as { provider: { aiflowbridge: { models: Record<string, Record<string, unknown>> } } })
      .provider.aiflowbridge.models;
    expect(models['MiniMax-M3.1-Flash']).toEqual({
      name: 'MiniMax M3.1 Flash',
      reasoning: true,
      variants: buildEffortVariants(M31.levels),
    });
  });

  it('turns reasoning on for a model that declares levels', () => {
    const config = {
      provider: { aiflowbridge: { models: { 'MiniMax-M3.1-Flash': { reasoning: false, limit: { context: 1 } } } } },
    };
    const model = (applyEffortVariants(config, ['aiflowbridge'], [M31]).config as {
      provider: { aiflowbridge: { models: Record<string, Record<string, unknown>> } };
    }).provider.aiflowbridge.models['MiniMax-M3.1-Flash'];
    expect(model.reasoning).toBe(true);
    expect(model.limit).toEqual({ context: 1 });
  });

  it('reports an unknown provider instead of inventing one', () => {
    const result = applyEffortVariants(gatewayConfig, ['not-there'], [M31]);
    expect(result.unknownProviders).toEqual(['not-there']);
    expect(result.updates).toEqual([]);
  });

  it('is idempotent, so a second run reports nothing to do', () => {
    const first = applyEffortVariants(gatewayConfig, ['aiflowbridge'], [M31]);
    expect(isAlreadyConfigured(first.updates)).toBe(false);
    const second = applyEffortVariants(first.config, ['aiflowbridge'], [M31]);
    expect(isAlreadyConfigured(second.updates)).toBe(true);
    expect(second.config).toEqual(first.config);
  });
});

describe('registry projection', () => {
  it('keeps only the models that declare a level range', () => {
    const registry = {
      models: [
        { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', reasoningEffortLevels: ['low', 'max'] },
        { id: 'MiniMax-M3', name: 'MiniMax M3' },
        { id: 'mimo-v2.6-pro', name: 'MiMo V2.6 Pro', reasoningEffortLevels: [] },
      ],
    } as unknown as ModelRegistry;
    expect(collectEffortLevelModels(registry)).toEqual([
      { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', levels: ['low', 'max'] },
    ]);
    expect(collectEffortLevelModels(undefined)).toEqual([]);
  });
});
describe('activation-time offer', () => {
  it('compares the declared variant keys with the levels, order included', () => {
    expect(variantsMatchLevels(['low', 'max'], ['low', 'max'])).toBe(true);
    expect(variantsMatchLevels(['max', 'low'], ['low', 'max'])).toBe(false);
    expect(variantsMatchLevels(['none', 'thinking'], ['low', 'max'])).toBe(false);
    expect(variantsMatchLevels([], ['low'])).toBe(false);
  });

  it('offers the configuration when Kilo still shows the stale pair', () => {
    const check = checkEffortVariantsNeeded(gatewayConfig, ['aiflowbridge'], [M31]);
    expect(check.offer).toBe(true);
    expect(check.providers).toEqual(['aiflowbridge']);
    expect(check.models).toEqual(['MiniMax-M3.1-Flash']);
  });

  it('stays silent once the configuration matches', () => {
    const configured = applyEffortVariants(gatewayConfig, ['aiflowbridge'], [M31]).config;
    expect(checkEffortVariantsNeeded(configured, ['aiflowbridge'], [M31]).offer).toBe(false);
  });

  it('stays silent when no Kilo provider points at the gateway', () => {
    // The user does not reach AIFlowBridge through Kilo Code, or uses a
    // provider id we cannot guess: prompting would be noise, and a silent
    // write would land in the wrong provider.
    expect(checkEffortVariantsNeeded(gatewayConfig, [], [M31]).offer).toBe(false);
  });

  it('stays silent when the provider id is absent from the file', () => {
    // There is nothing to update, so there is nothing to offer: the manual
    // command reports the missing provider instead.
    expect(checkEffortVariantsNeeded(gatewayConfig, ['not-declared'], [M31]).offer).toBe(false);
  });

  it('stays silent when no model declares a level range', () => {
    expect(checkEffortVariantsNeeded(gatewayConfig, ['aiflowbridge'], []).offer).toBe(false);
  });

  it('offers when the provider relies on auto-detection and declares no model', () => {
    const config = { provider: { aiflowbridge: { options: { baseURL: 'http://127.0.0.1:8787/v1' } } } };
    expect(checkEffortVariantsNeeded(config, ['aiflowbridge'], [M31]).offer).toBe(true);
  });
});
