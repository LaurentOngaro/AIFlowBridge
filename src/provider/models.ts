import vscode from 'vscode';
import { t } from '../i18n';
import type { ModelDefinition } from '../types';

/**
 * NOTE: Non-public API surface.
 *
 * The fields below (`configurationSchema` on chat info, `modelConfiguration`
 * on response options, plus `isUserSelectable` / `statusIcon`) are not part
 * of the stable `vscode.LanguageModelChat*` typings yet. They are the same
 * shape currently consumed by GitHub Copilot Chat to render a per-model
 * config dropdown in the model picker.
 */

export type ThinkingEffort = 'none' | 'high' | 'max';

/**
 * Upstream reasoning-effort level read from the model configuration
 * dropdown (Copilot Chat's `modelConfiguration.reasoningEffort`). For a
 * model that declares `reasoningEffortLevels`, the value is one of those
 * levels (`low`, `medium`, `high`, `xhigh`, `max` for MiniMax M3.1 Flash
 * Preview) and is forwarded verbatim upstream.
 */
export type ReasoningEffortLevel = string;

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly configuration?: Record<string, unknown>;
};

type ThinkingEffortConfigurationSchema = ReturnType<typeof buildThinkingEffortSchema>;

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
  readonly isUserSelectable: boolean;
  readonly statusIcon?: vscode.ThemeIcon;
  readonly configurationSchema?: ThinkingEffortConfigurationSchema;
};

export function toChatInfo(m: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation {
  const detailKey = resolveDetailKey(m);
  const modelDetail = detailKey ? t(detailKey) : m.detail;
  return {
    id: m.id,
    name: m.name,
    family: m.family,
    version: m.version,
    detail: hasApiKey ? modelDetail : t('auth.apiKeyRequiredDetail'),
    tooltip: hasApiKey ? undefined : t('auth.apiKeyRequiredDetail'),
    statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
    maxInputTokens: m.maxInputTokens,
    maxOutputTokens: m.maxOutputTokens,
    isUserSelectable: true,
    capabilities: {
      toolCalling: m.capabilities.toolCalling,
      imageInput: m.capabilities.imageInput,
    },
    ...(m.capabilities.thinking
      ? { configurationSchema: buildThinkingEffortSchema(m.reasoningEffortLevels) }
      : {}),
  };
}

/**
 * Raw `reasoningEffort` value sent by the picker, whatever the model's
 * level set is. Returns `undefined` when the client did not send the
 * field, so the caller can fall back to its own default. The historical
 * `none` / `high` / `max` triple is normalized by
 * `getConfiguredThinkingEffort`; a per-model level list is validated
 * against the declared levels by `resolveEffortLevel`.
 */
export function getRawConfiguredReasoningEffort(options: ModelConfigurationOptions): ReasoningEffortLevel | undefined {
  const configured = options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;
  return typeof configured === 'string' && configured.length > 0 ? configured : undefined;
}

/**
 * Resolve the upstream effort level to send for a model that declares
 * `reasoningEffortLevels`.
 *
 * Order: the picker's value when it is one of the declared levels, then
 * the `aiflowbridge.providers.<vendor>.reasoningEffort` setting when it
 * is one of them, then the highest declared level (the upstream default
 * when the field is omitted, `max` for MiniMax M3.1 Flash).
 *
 * `none` is never returned: a level list without `none` models an
 * always-reasoning upstream, and `reasoning_effort: "none"` is rejected
 * with HTTP 400 there. Pure function - the caller supplies the setting
 * value so it stays unit-testable.
 */
export function resolveEffortLevel(
  levels: readonly string[],
  pickerValue: ReasoningEffortLevel | undefined,
  settingValue: ReasoningEffortLevel | undefined
): string {
  if (levels.length === 0) {
    return 'high';
  }
  if (pickerValue && levels.includes(pickerValue)) {
    return pickerValue;
  }
  if (settingValue && levels.includes(settingValue)) {
    return settingValue;
  }
  return levels[levels.length - 1];
}

export function getConfiguredThinkingEffort(options: ModelConfigurationOptions): ThinkingEffort {
  const configuredEffort = options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;

  if (configuredEffort === 'none') {
    return 'none';
  }

  if (configuredEffort === 'high') {
    return 'high';
  }

  return configuredEffort === 'max' ? 'max' : 'high';
}

/**
 * Build the "Thinking Effort" dropdown schema for a model.
 *
 * With `levels` (a model that declares `reasoningEffortLevels`), the
 * dropdown lists exactly those levels in order, with a per-level label
 * and description resolved from the i18n table and a capitalized
 * fallback. Without it, the historical `none` / `high` / `max` triple is
 * kept, which the provider maps to MiniMax's `reasoning_split` boolean.
 *
 * A declared level list defaults to its highest level, which is the
 * upstream default when `reasoning_effort` is omitted (`max` for
 * MiniMax M3.1 Flash). The historical triple keeps its `high`
 * default, which is what the DeepSeek and MiniMax providers already
 * send when the client picked nothing.
 */
function buildThinkingEffortSchema(levels?: readonly string[]) {
  const values: readonly string[] = levels && levels.length > 0 ? levels : ['none', 'high', 'max'];
  return {
    properties: {
      reasoningEffort: {
        type: 'string',
        title: t('status.thinking'),
        enum: [...values],
        enumItemLabels: values.map(labelForEffortLevel),
        enumDescriptions: values.map(descriptionForEffortLevel),
        default: levels && levels.length > 0 ? values[values.length - 1] : 'high',
        group: 'navigation',
      },
    },
  } as const;
}

function labelForEffortLevel(level: string): string {
  const key = `thinking.${level}`;
  const translated = t(key);
  return translated !== key ? translated : capitalize(level);
}

function descriptionForEffortLevel(level: string): string {
  const key = `thinking.${level}.desc`;
  const translated = t(key);
  return translated !== key ? translated : '';
}

function capitalize(level: string): string {
  return level.length === 0 ? level : level[0].toUpperCase() + level.slice(1);
}

/**
 * Resolve the `model.<id>.detail` translation key for a model.
 *
 * The key is built from the upstream API id verbatim: `deepseek-flash`
 * resolves `model.deepseek-flash.detail`, `MiniMax-M3` resolves
 * `model.MiniMax-M3.detail`. A previous version stripped a `deepseek-v4-`
 * prefix first, which was an id alias map and contradicted the registry
 * rule that the id IS the upstream id. Returns `undefined` when no key
 * exists, which lets the caller fall back to the registry `detail`.
 */
function resolveDetailKey(m: ModelDefinition): string | undefined {
  const key = `model.${m.id}.detail`;
  const translated = t(key);
  return translated !== key ? key : undefined;
}
