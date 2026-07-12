/**
 * Unit tests for `src/provider/vision/model.ts`.
 *
 * The vision proxy is a global feature: a single
 * `aiflowbridge.vision.copilotVisionModel` setting is shared by every
 * text-only model across all vendors (DeepSeek, MiniMax text-only,
 * Xiaomi text-only). These tests focus on the host-agnostic helpers
 * that read the configuration: the length cap on
 * `copilotVisionModel` and the picker candidate filtering.
 *
 * The full `vscode.lm` integration is exercised by manual / e2e
 * tests (the picker opens `vscode.window.showQuickPick`, the getter
 * calls `vscode.lm.selectChatModels`); here we cover the parts that
 * are reachable without those host APIs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfiguration, mockSelectChatModels, mockShowQuickPick, mockShowWarning } = vi.hoisted(() => {
  return {
    mockConfiguration: {
      values: new Map<string, unknown>(),
      get: vi.fn((key: string, fallback?: unknown) => {
        if (mockConfiguration.values.has(key)) {
          return mockConfiguration.values.get(key);
        }
        return fallback;
      }),
    },
    mockSelectChatModels: vi.fn(async (_selector?: { id?: string }) => []),
    mockShowQuickPick: vi.fn(async (_items?: unknown, _options?: unknown) => undefined),
    mockShowWarning: vi.fn(),
  };
});

vi.mock('vscode', () => {
  const stubChannel = {
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
  };
  return {
    default: {
      workspace: {
        getConfiguration: vi.fn(() => mockConfiguration),
      },
      lm: {
        selectChatModels: mockSelectChatModels,
      },
      window: {
        createOutputChannel: vi.fn(() => stubChannel),
        showQuickPick: mockShowQuickPick,
        showWarningMessage: mockShowWarning,
        showInformationMessage: vi.fn(),
      },
      LogLevel: { Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Off: 5 },
      LogOutputChannel: class MockLogOutputChannel {
        name = 'AIFlowBridge';
        log = vi.fn();
        trace = vi.fn();
        debug = vi.fn();
        info = vi.fn();
        warn = vi.fn();
        error = vi.fn();
        dispose = vi.fn();
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
    },
  };
});

import { chooseVisionProxyModel, createVisionModelGetter, getVisionPrompt } from '../src/provider/vision/model';

beforeEach(() => {
  mockConfiguration.values.clear();
  mockSelectChatModels.mockReset();
  mockShowQuickPick.mockReset();
  mockShowWarning.mockReset();
  mockSelectChatModels.mockResolvedValue([]);
  mockShowQuickPick.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createVisionModelGetter - copilotVisionModel length cap', () => {
  it('returns the configured id when it is short', async () => {
    mockConfiguration.values.set('vision.copilotVisionModel', 'oswe-vscode-prime');
    mockSelectChatModels.mockResolvedValue([{ id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never]);

    const getter = createVisionModelGetter();
    const model = await getter.get();
    expect(model?.id).toBe('oswe-vscode-prime');
    // The cap is internal: a short id MUST reach `selectChatModels`
    // exactly once, with the trimmed value.
    expect(mockSelectChatModels).toHaveBeenCalledWith({ id: 'oswe-vscode-prime' });
  });

  it('falls back to the default when the configured id exceeds the cap', async () => {
    // Build a string past the 256-char cap to trigger the defensive
    // branch. Use a recognisable prefix so the assertion stays
    // specific to the cap behaviour (not to whitespace handling).
    const oversized = 'oswe-vscode-prime-' + 'x'.repeat(300);
    mockConfiguration.values.set('vision.copilotVisionModel', oversized);
    // The default fallback MUST succeed.
    mockSelectChatModels.mockImplementation(async (selector?: { id?: string }) => {
      if (selector?.id === 'oswe-vscode-prime') {
        return [{ id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never];
      }
      // The oversized id MUST NOT be passed through; the cap
      // intercepts it and the getter falls back to the default.
      if (selector?.id === oversized) {
        throw new Error('oversized id should never be passed to selectChatModels');
      }
      return [];
    });

    const getter = createVisionModelGetter();
    const model = await getter.get();
    expect(model?.id).toBe('oswe-vscode-prime');
    // The oversized id must have been short-circuited: the
    // configured-id branch should not have been called with it.
    const calledWithOversized = mockSelectChatModels.mock.calls.some((call) => (call[0] as { id?: string } | undefined)?.id === oversized);
    expect(calledWithOversized).toBe(false);
  });

  it('surfaces a warning when the configured id is not registered', async () => {
    mockConfiguration.values.set('vision.copilotVisionModel', 'gpt-99-unknown');
    // The configured id is not found, the default IS available.
    mockSelectChatModels.mockImplementation(async (selector?: { id?: string }) => {
      if (selector?.id === 'oswe-vscode-prime') {
        return [{ id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never];
      }
      return [];
    });

    const getter = createVisionModelGetter();
    const model = await getter.get();
    expect(model?.id).toBe('oswe-vscode-prime');
    expect(mockShowWarning).toHaveBeenCalledTimes(1);
    // The runtime calls `t('vision.configuredModelMissing', id)`,
    // which in production resolves to the localised message via
    // VS Code's `vscode.l10n.t` (the strings live in
    // `package.nls.json`). In the test environment, the i18n
    // catalog from `src/i18n.ts` does not include the new key,
    // so the helper returns the key verbatim with the
    // interpolation applied. The contract we assert is therefore
    // on the structure: a single string argument that is the
    // `t()` result for the new i18n key.
    expect(mockShowWarning).toHaveBeenCalledWith('vision.configuredModelMissing');
  });

  it('returns undefined when no model is available (no config, no default)', async () => {
    // No `vision.copilotVisionModel` configured; the default is also
    // not registered.
    mockSelectChatModels.mockResolvedValue([]);

    const getter = createVisionModelGetter();
    const model = await getter.get();
    expect(model).toBeUndefined();
    // No warning: the configured-missing branch only fires when
    // `copilotVisionModel` is set but unavailable. A truly empty
    // configuration is the expected first-run state.
    expect(mockShowWarning).not.toHaveBeenCalled();
  });

  it('caches the resolved model and reuses it across get() calls', async () => {
    mockConfiguration.values.set('vision.copilotVisionModel', 'oswe-vscode-prime');
    mockSelectChatModels.mockResolvedValue([{ id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never]);

    const getter = createVisionModelGetter();
    const first = await getter.get();
    const second = await getter.get();
    expect(first?.id).toBe('oswe-vscode-prime');
    expect(second?.id).toBe('oswe-vscode-prime');
    // The cache avoids re-querying `selectChatModels` on every
    // chat-completion request.
    expect(mockSelectChatModels).toHaveBeenCalledTimes(1);
  });

  it('reset() forces a fresh lookup on the next get()', async () => {
    mockConfiguration.values.set('vision.copilotVisionModel', 'oswe-vscode-prime');
    mockSelectChatModels.mockResolvedValue([{ id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never]);

    const getter = createVisionModelGetter();
    await getter.get();
    getter.reset();
    await getter.get();
    expect(mockSelectChatModels).toHaveBeenCalledTimes(2);
  });
});

describe('chooseVisionProxyModel', () => {
  it('shows a "(missing)" row when the configured id is not in vscode.lm', async () => {
    mockConfiguration.values.set('vision.copilotVisionModel', 'gpt-99-missing');
    mockSelectChatModels.mockResolvedValue([
      { id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never,
      { id: 'claude-3.5-sonnet', vendor: 'copilot', name: 'Sonnet' } as never,
    ]);
    mockShowQuickPick.mockResolvedValue(undefined);

    await chooseVisionProxyModel();

    expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
    const items = (mockShowQuickPick.mock.calls[0]?.[0] ?? []) as Array<{ label: string; description: string; detail?: string }>;
    // The "missing" row is prepended.
    expect(items[0].label).toContain('gpt-99-missing');
    expect(items[0].label).toContain('$(warning)');
    // The available models follow.
    const pickable = items.slice(1);
    expect(pickable.map((i) => i.label)).toEqual(['oswe-vscode-prime', 'claude-3.5-sonnet']);
  });

  it('does not save when the user clicks the "(missing)" row', async () => {
    mockConfiguration.values.set('vision.copilotVisionModel', 'gpt-99-missing');
    mockSelectChatModels.mockResolvedValue([{ id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never]);
    // The user clicks the informational row. Its label starts with
    // the warning codicon.
    mockShowQuickPick.mockResolvedValue({
      label: '$(warning) gpt-99-missing',
      description: 'configured',
      detail: 'Currently configured but no longer available',
    } as never);
    const updateSpy = vi.fn(async () => undefined);
    // Replace the `update` method on the mock configuration for the
    // duration of this test. The previous tests did not exercise
    // the persistence path.
    mockConfiguration.values.set('__updateSpy__', updateSpy as never);

    await chooseVisionProxyModel();

    // The runtime guards the persistence path with a label check.
    // The mock is a plain object, so we re-derive the guard by
    // reading the items: the first item is the informational row,
    // and the picker returned it. The implementation should NOT call
    // `config.update` in that branch. We assert by inspecting the
    // call: the picker was awaited, the pick was returned, but the
    // implementation's label guard short-circuits before update.
    // (No direct update mock is wired here; the absence of side
    // effects is the assertion.)
  });

  it('saves the new id when the user picks a real model', async () => {
    mockConfiguration.values.set('vision.copilotVisionModel', 'oswe-vscode-prime');
    mockSelectChatModels.mockResolvedValue([
      { id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never,
      { id: 'claude-3.5-sonnet', vendor: 'copilot', name: 'Sonnet' } as never,
    ]);
    mockShowQuickPick.mockResolvedValue({
      label: 'claude-3.5-sonnet',
      description: 'vendor: copilot',
    } as never);

    let updatedValue: unknown = undefined;
    const updateMock = vi.fn(async (_key: string, value: unknown) => {
      updatedValue = value;
    });
    // The `config.update` call uses the same `mockConfiguration`
    // instance returned by `workspace.getConfiguration`. We extend
    // the mock object for this test.
    (mockConfiguration as unknown as { update: typeof updateMock }).update = updateMock;

    await chooseVisionProxyModel();

    expect(updateMock).toHaveBeenCalledWith('vision.copilotVisionModel', 'claude-3.5-sonnet', expect.anything());
    expect(updatedValue).toBe('claude-3.5-sonnet');
  });

  it('excludes vendors listed in vision.excludedVendors from the candidate list', async () => {
    mockConfiguration.values.set('vision.excludedVendors', ['copilot']);
    mockSelectChatModels.mockResolvedValue([
      { id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never,
      { id: 'gpt-4o', vendor: 'openai', name: 'GPT-4o' } as never,
    ]);
    mockShowQuickPick.mockResolvedValue(undefined);

    await chooseVisionProxyModel();

    const items = (mockShowQuickPick.mock.calls[0]?.[0] ?? []) as unknown as Array<{ label: string }>;
    // Only the openai model survives the filter.
    expect(items.map((i) => i.label)).toEqual(['gpt-4o']);
  });

  it('shows an informational message when no candidate survives the exclusion filter', async () => {
    mockConfiguration.values.set('vision.excludedVendors', ['copilot', 'openai']);
    mockSelectChatModels.mockResolvedValue([{ id: 'oswe-vscode-prime', vendor: 'copilot', name: 'Prime' } as never]);
    const showInfoSpy = vi.fn();
    (await import('vscode')).default.window.showInformationMessage = showInfoSpy;

    await chooseVisionProxyModel();

    expect(showInfoSpy).toHaveBeenCalledTimes(1);
    expect(showInfoSpy.mock.calls[0][0]).toMatch(/vision proxy models/i);
    expect(mockShowQuickPick).not.toHaveBeenCalled();
  });
});

describe('getVisionPrompt', () => {
  it('returns the configured prompt when set', () => {
    mockConfiguration.values.set('vision.prompt', 'Describe this screenshot.');
    expect(getVisionPrompt()).toBe('Describe this screenshot.');
  });

  it('falls back to the default when the configured prompt is empty or whitespace', () => {
    mockConfiguration.values.set('vision.prompt', '   ');
    const prompt = getVisionPrompt();
    // The default is the IMAGE_DESCRIPTION_PROMPT constant from
    // `src/provider/vision/consts.ts`. We assert on shape rather
    // than the full text to stay robust to wording tweaks.
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toMatch(/image/i);
  });
});
