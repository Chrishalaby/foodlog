import {
  AI_PROVIDER_PRESETS,
  type AiApiStyle,
  type AiProviderKind,
  type AiProviderPreset,
  type AiProviderSettingsDto,
  type UpdateAiProviderRequest,
} from '@food/shared';

export interface ProviderDraft {
  provider: AiProviderKind;
  baseUrl: string;
  apiStyle: AiApiStyle;
  model: string;
  preciseModel: string;
  apiKey: string;
  replaceKey: boolean;
  voiceEnabled: boolean;
  transcribeBaseUrl: string;
  transcribeModel: string;
  transcribeApiKey: string;
  replaceTranscribeKey: boolean;
  removeTranscribeKey: boolean;
}

export type DraftField = 'apiKey' | 'baseUrl' | 'model' | 'preciseModel' | 'transcribeBaseUrl';

export type DraftProblems = Partial<Record<DraftField, string>>;

export const DEFAULT_PROVIDER: AiProviderKind = 'openai';

export const API_STYLE_LABELS: Readonly<Record<AiApiStyle, string>> = {
  chat: 'Chat Completions',
  responses: 'Responses',
};

export const TRANSCRIPTION_HINTS: Readonly<Record<'same' | 'separate', string>> = {
  same: 'Leave these empty to use the same server and key.',
  separate:
    'This provider cannot turn speech into text. Add an OpenAI key, or the address of a Whisper-compatible server.',
};

function presetDraft(preset: AiProviderPreset): ProviderDraft {
  return {
    provider: preset.kind,
    baseUrl: preset.baseUrl ?? '',
    apiStyle: preset.apiStyle,
    model: preset.model,
    preciseModel: preset.preciseModel,
    apiKey: '',
    replaceKey: false,
    voiceEnabled: true,
    transcribeBaseUrl: '',
    transcribeModel: '',
    transcribeApiKey: '',
    replaceTranscribeKey: false,
    removeTranscribeKey: false,
  };
}

export function draftFromSettings(settings: AiProviderSettingsDto | null): ProviderDraft {
  if (!settings) {
    return presetDraft(AI_PROVIDER_PRESETS[DEFAULT_PROVIDER]);
  }
  const preset = AI_PROVIDER_PRESETS[settings.provider];
  return {
    ...presetDraft(preset),
    baseUrl: settings.baseUrl ?? preset.baseUrl ?? '',
    apiStyle: settings.apiStyle,
    model: settings.model,
    preciseModel: settings.preciseModel,
    voiceEnabled: settings.voiceEnabled,
    transcribeBaseUrl: settings.transcribeBaseUrl ?? '',
    transcribeModel: settings.transcribeModel ?? '',
  };
}

export function switchProvider(
  draft: ProviderDraft,
  provider: AiProviderKind,
  settings: AiProviderSettingsDto | null,
): ProviderDraft {
  if (provider === draft.provider) {
    return draft;
  }
  const next =
    settings?.provider === provider
      ? draftFromSettings(settings)
      : presetDraft(AI_PROVIDER_PRESETS[provider]);
  return {
    ...next,
    voiceEnabled: draft.voiceEnabled,
    transcribeBaseUrl: draft.transcribeBaseUrl,
    transcribeModel: draft.transcribeModel,
    transcribeApiKey: draft.transcribeApiKey,
    replaceTranscribeKey: draft.replaceTranscribeKey,
    removeTranscribeKey: draft.removeTranscribeKey,
  };
}

export function hasSavedKey(draft: ProviderDraft, settings: AiProviderSettingsDto | null): boolean {
  return settings?.provider === draft.provider && settings.hasApiKey;
}

export function showsKeyInput(
  draft: ProviderDraft,
  settings: AiProviderSettingsDto | null,
): boolean {
  return !hasSavedKey(draft, settings) || draft.replaceKey;
}

export function hasSavedTranscribeKey(
  draft: ProviderDraft,
  settings: AiProviderSettingsDto | null,
): boolean {
  return settings?.hasTranscribeApiKey === true && !draft.removeTranscribeKey;
}

export function maskedKey(last4: string | null): string {
  return last4 ? `•••• ${last4}` : '••••';
}

function isHttpUrl(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  );
}

export function draftProblems(
  draft: ProviderDraft,
  settings: AiProviderSettingsDto | null,
): DraftProblems {
  const preset = AI_PROVIDER_PRESETS[draft.provider];
  const problems: DraftProblems = {};
  const typedKey = draft.apiKey.trim();
  if (preset.keyRequired && typedKey === '' && showsKeyInput(draft, settings)) {
    problems.apiKey = `Paste your ${preset.label} API key.`;
  }
  const baseUrl = draft.baseUrl.trim();
  if (preset.baseUrlEditable && baseUrl === '') {
    problems.baseUrl = 'Enter the server address.';
  } else if (preset.baseUrlEditable && !isHttpUrl(baseUrl)) {
    problems.baseUrl = 'Use an address that starts with http:// or https://.';
  }
  if (draft.model.trim() === '') {
    problems.model = 'Enter a model name.';
  }
  if (draft.preciseModel.trim() === '') {
    problems.preciseModel = 'Enter a model name.';
  }
  const transcribeUrl = draft.transcribeBaseUrl.trim();
  if (draft.voiceEnabled && transcribeUrl !== '' && !isHttpUrl(transcribeUrl)) {
    problems.transcribeBaseUrl = 'Use an address that starts with http:// or https://.';
  }
  return problems;
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function toUpdateRequest(
  draft: ProviderDraft,
  settings: AiProviderSettingsDto | null,
): UpdateAiProviderRequest {
  const preset = AI_PROVIDER_PRESETS[draft.provider];
  const apiKey = draft.apiKey.trim();
  const transcribeApiKey = draft.transcribeApiKey.trim();
  return {
    provider: draft.provider,
    ...(preset.baseUrlEditable ? { baseUrl: optional(draft.baseUrl) } : {}),
    ...(preset.apiStyleEditable ? { apiStyle: draft.apiStyle } : {}),
    model: draft.model.trim(),
    preciseModel: draft.preciseModel.trim(),
    ...(apiKey !== '' && showsKeyInput(draft, settings) ? { apiKey } : {}),
    voiceEnabled: draft.voiceEnabled,
    transcribeBaseUrl: optional(draft.transcribeBaseUrl),
    transcribeModel: optional(draft.transcribeModel),
    ...(draft.removeTranscribeKey
      ? { transcribeApiKey: null }
      : transcribeApiKey !== ''
        ? { transcribeApiKey }
        : {}),
  };
}
