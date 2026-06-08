/**
 * Unit tests for src/config.ts
 * Tests the configuration getter functions for all providers.
 *
 * The model registry is populated from the bundled `resources/models.json`
 * via a `setLoadedRegistry()` call in `beforeAll`. This replaces the
 * previous static import of `DEFAULT_PROVIDER_URLS` from `src/consts.ts`
 * (now removed - see ACTION PLAN.md step 3).
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- VScode mock - must include default export for "import vscode from 'vscode'" ---
const { mockWorkspaceConfig } = vi.hoisted(() => {
  const mockWorkspaceConfig = {
    get: vi.fn(),
    inspect: vi.fn(),
  };

  return { mockWorkspaceConfig };
});

vi.mock('vscode', () => {
  return {
    default: {
      workspace: {
        getConfiguration: vi.fn(() => mockWorkspaceConfig),
      },
    },
  };
});

// Import after mocking
import {
  getProviderBaseUrl,
  getProviderApiModelId,
  getProviderMaxTokens,
  getProviderTemperature,
  getProviderTopP,
  getProviderReasoningSplit,
  getProviderReasoningRequiredForToolCalls,
  getDebugMode,
  getDebugLoggingEnabled,
  getRequestDumpEnabled,
  getStabilizeToolListEnabled,
} from '../src/config';
import { setLoadedRegistry } from '../src/aiflowbridge/modelRegistry';
import {
 validateRegistryStructure,
	validateRegistryContent,
} from '../src/aiflowbridge/modelRegistry.schema';

const BUNDLED_REGISTRY_PATH = resolve(__dirname, '..', 'resources', 'models.json');

function loadBundledVendors(): { deepseek: string; minimax: string; xiaomi: string } {
	const raw = JSON.parse(readFileSync(BUNDLED_REGISTRY_PATH, 'utf8'));
	validateRegistryStructure(raw);
	const content = validateRegistryContent(raw, 'strict');
	return {
		deepseek: content.vendors.deepseek.baseUrl,
		minimax: content.vendors.minimax.baseUrl,
		xiaomi: content.vendors.xiaomi.baseUrl,
	};
}

let VENDOR_URLS: { deepseek: string; minimax: string; xiaomi: string };

beforeAll(() => {
	VENDOR_URLS = loadBundledVendors();
	setLoadedRegistry({
		version: 1,
		vendors: {
			deepseek: { baseUrl: VENDOR_URLS.deepseek, apiKeySecret: 'aiflowbridge.providers.deepseek.apiKey' },
			minimax: { baseUrl: VENDOR_URLS.minimax, apiKeySecret: 'aiflowbridge.providers.minimax.apiKey' },
			xiaomi: { baseUrl: VENDOR_URLS.xiaomi, apiKeySecret: 'aiflowbridge.providers.xiaomi.apiKey' },
		},
		models: [],
		sources: {
			bundled: { exists: true, path: BUNDLED_REGISTRY_PATH },
			globalStorage: { exists: false, path: '' },
			workspace: { exists: false, path: '' },
		},
	});
});

describe('config.ts - Provider URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default URL when not configured', () => {
    mockWorkspaceConfig.get.mockReturnValue(undefined);

    const url = getProviderBaseUrl('deepseek');
    expect(url).toBe(VENDOR_URLS.deepseek);
  });

  it('should return default URL for minimax', () => {
    mockWorkspaceConfig.get.mockReturnValue(undefined);

    const url = getProviderBaseUrl('minimax');
    expect(url).toBe(VENDOR_URLS.minimax);
  });

  it('should return default URL for xiaomi', () => {
    mockWorkspaceConfig.get.mockReturnValue(undefined);

    const url = getProviderBaseUrl('xiaomi');
    expect(url).toBe(VENDOR_URLS.xiaomi);
  });

  it('should return workspace value when set', () => {
    mockWorkspaceConfig.get.mockReturnValue('https://custom.api.com');

    const url = getProviderBaseUrl('deepseek');
    expect(url).toBe('https://custom.api.com');
  });

  it('should return empty string for unknown vendor', () => {
    mockWorkspaceConfig.get.mockReturnValue(undefined);

    const url = getProviderBaseUrl('unknown-vendor');
    expect(url).toBe('');
  });
});

describe('config.ts - Model ID Overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return vscodeModelId when no override exists', () => {
    mockWorkspaceConfig.get.mockReturnValue({});

    const modelId = getProviderApiModelId('minimax', 'MiniMax-M2.7');
    expect(modelId).toBe('MiniMax-M2.7');
  });

  it('should return overridden value when override exists', () => {
    mockWorkspaceConfig.get.mockReturnValue({
      'MiniMax-M2.7': 'MiniMax-M2.7-Custom',
    });

    const modelId = getProviderApiModelId('minimax', 'MiniMax-M2.7');
    expect(modelId).toBe('MiniMax-M2.7-Custom');
  });

  it('should trim whitespace from override', () => {
    mockWorkspaceConfig.get.mockReturnValue({
      'MiniMax-M2.7': '  MiniMax-M2.7-Custom  ',
    });

    const modelId = getProviderApiModelId('minimax', 'MiniMax-M2.7');
    expect(modelId).toBe('MiniMax-M2.7-Custom');
  });

  it('should return original when override is only whitespace', () => {
    mockWorkspaceConfig.get.mockReturnValue({
      'MiniMax-M2.7': '   ',
    });

    const modelId = getProviderApiModelId('minimax', 'MiniMax-M2.7');
    expect(modelId).toBe('MiniMax-M2.7');
  });

  it('should handle nested vendor keys', () => {
    mockWorkspaceConfig.get.mockReturnValue({
      'mimo-v2.5': 'MiMo-V2.5',
    });

    const modelId = getProviderApiModelId('xiaomi', 'mimo-v2.5');
    expect(modelId).toBe('MiMo-V2.5');
  });
});

describe('config.ts - Max Tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined when maxTokens is 0', () => {
    mockWorkspaceConfig.get.mockReturnValue(0);

    const maxTokens = getProviderMaxTokens('minimax');
    expect(maxTokens).toBeUndefined();
  });

  it('should return undefined when maxTokens is negative', () => {
    mockWorkspaceConfig.get.mockReturnValue(-1);

    const maxTokens = getProviderMaxTokens('minimax');
    expect(maxTokens).toBeUndefined();
  });

  it('should return value when maxTokens is positive', () => {
    mockWorkspaceConfig.get.mockReturnValue(4096);

    const maxTokens = getProviderMaxTokens('minimax');
    expect(maxTokens).toBe(4096);
  });
});

describe('config.ts - Temperature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined when temperature is out of range (> 2)', () => {
    mockWorkspaceConfig.get.mockReturnValue(3.0);

    const temp = getProviderTemperature('minimax');
    expect(temp).toBeUndefined();
  });

  it('should return undefined when temperature is out of range (< 0)', () => {
    mockWorkspaceConfig.get.mockReturnValue(-0.5);

    const temp = getProviderTemperature('minimax');
    expect(temp).toBeUndefined();
  });

  it('should return value when temperature is in valid range', () => {
    mockWorkspaceConfig.get.mockReturnValue(0.7);

    const temp = getProviderTemperature('minimax');
    expect(temp).toBe(0.7);
  });

  it('should return value at boundary (0)', () => {
    mockWorkspaceConfig.get.mockReturnValue(0);

    const temp = getProviderTemperature('minimax');
    expect(temp).toBe(0);
  });

  it('should return value at boundary (2)', () => {
    mockWorkspaceConfig.get.mockReturnValue(2);

    const temp = getProviderTemperature('minimax');
    expect(temp).toBe(2);
  });
});

describe('config.ts - Top P', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined when topP is out of range (> 1)', () => {
    mockWorkspaceConfig.get.mockReturnValue(1.5);

    const topP = getProviderTopP('minimax');
    expect(topP).toBeUndefined();
  });

  it('should return undefined when topP is out of range (< 0)', () => {
    mockWorkspaceConfig.get.mockReturnValue(-0.1);

    const topP = getProviderTopP('minimax');
    expect(topP).toBeUndefined();
  });

  it('should return value when topP is in valid range', () => {
    mockWorkspaceConfig.get.mockReturnValue(0.9);

    const topP = getProviderTopP('minimax');
    expect(topP).toBe(0.9);
  });

  it('should return undefined at boundary (0) - not > 0', () => {
    mockWorkspaceConfig.get.mockReturnValue(0);

    const topP = getProviderTopP('minimax');
    expect(topP).toBeUndefined();
  });

  it('should return value at boundary (1)', () => {
    mockWorkspaceConfig.get.mockReturnValue(1);

    const topP = getProviderTopP('minimax');
    expect(topP).toBe(1);
  });
});

describe('config.ts - Reasoning Split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true by default', () => {
    mockWorkspaceConfig.get.mockReturnValue(true);

    const reasoningSplit = getProviderReasoningSplit('minimax');
    expect(reasoningSplit).toBe(true);
  });

  it('should return false when configured', () => {
    mockWorkspaceConfig.get.mockReturnValue(false);

    const reasoningSplit = getProviderReasoningSplit('minimax');
    expect(reasoningSplit).toBe(false);
  });

  it('should return undefined for non-boolean values', () => {
    mockWorkspaceConfig.get.mockReturnValue('true');

    const reasoningSplit = getProviderReasoningSplit('minimax');
    expect(reasoningSplit).toBeUndefined();
  });
});

describe('config.ts - Reasoning Required For Tool Calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true by default', () => {
    mockWorkspaceConfig.get.mockReturnValue(true);

    const required = getProviderReasoningRequiredForToolCalls('xiaomi');
    expect(required).toBe(true);
  });

  it('should return false when configured', () => {
    mockWorkspaceConfig.get.mockReturnValue(false);

    const required = getProviderReasoningRequiredForToolCalls('xiaomi');
    expect(required).toBe(false);
  });
});

describe('config.ts - Debug Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return minimal by default', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({});

    const mode = getDebugMode();
    expect(mode).toBe('minimal');
  });

  it('should return workspace value when set', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: 'verbose',
    });

    const mode = getDebugMode();
    expect(mode).toBe('verbose');
  });

  it('should return global value when workspace value is not set', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: undefined,
      globalValue: 'metadata',
    });

    const mode = getDebugMode();
    expect(mode).toBe('metadata');
  });

  it('should return minimal for invalid values', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: 'invalid',
    });

    const mode = getDebugMode();
    expect(mode).toBe('minimal');
  });

  it('should return minimal when inspect returns undefined', () => {
    mockWorkspaceConfig.inspect.mockReturnValue(undefined);

    const mode = getDebugMode();
    expect(mode).toBe('minimal');
  });
});

describe('config.ts - Debug Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when debug mode is minimal', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: 'minimal',
    });

    expect(getDebugLoggingEnabled()).toBe(false);
  });

  it('should return true when debug mode is metadata', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: 'metadata',
    });

    expect(getDebugLoggingEnabled()).toBe(true);
  });

  it('should return true when debug mode is verbose', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: 'verbose',
    });

    expect(getDebugLoggingEnabled()).toBe(true);
  });
});

describe('config.ts - Request Dump', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when debug mode is not verbose', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: 'metadata',
    });

    expect(getRequestDumpEnabled()).toBe(false);
  });

  it('should return true when debug mode is verbose', () => {
    mockWorkspaceConfig.inspect.mockReturnValue({
      workspaceValue: 'verbose',
    });

    expect(getRequestDumpEnabled()).toBe(true);
  });
});

describe('config.ts - Stabilize Tool List', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false by default', () => {
    mockWorkspaceConfig.get.mockReturnValue(false);

    const enabled = getStabilizeToolListEnabled();
    expect(enabled).toBe(false);
  });

  it('should return true when enabled', () => {
    mockWorkspaceConfig.get.mockReturnValue(true);

    const enabled = getStabilizeToolListEnabled();
    expect(enabled).toBe(true);
  });
});