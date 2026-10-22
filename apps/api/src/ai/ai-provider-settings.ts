import {
  AI_API_STYLES,
  AI_PROVIDER_KINDS,
  AI_PROVIDER_PRESETS,
  type AiApiStyle,
  type AiProviderKind,
  type AiProviderServerDto,
  type AiProviderSettingsDto,
  type UpdateAiProviderRequest,
} from '@food/shared';
import type { AppConfig } from '../config/app-config.js';
import type { StoredAiProvider } from './ai-runtime-settings.js';

export const KEY_HINT_MIN_LENGTH = 12;

export interface SavedAiProviderMeta {
  apiKeyLast4: string | null;
  transcribeApiKeyLast4: string | null;
  updatedAt: Date;
}

export function isAiProviderKind(value: string): value is AiProviderKind {
  return AI_PROVIDER_KINDS.includes(value as AiProviderKind);
}

export function isAiApiStyle(value: string): value is AiApiStyle {
  return AI_API_STYLES.includes(value as AiApiStyle);
}

export function keyLast4(key: string | null): string | null {
  return key !== null && key.length >= KEY_HINT_MIN_LENGTH
    ? key.slice(-4)
    : null;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function cleanUrl(value: string | null | undefined): string | null {
  return cleanText(value)?.replace(/\/+$/, '') ?? null;
}

function nextKey(
  submitted: string | null | undefined,
  saved: string | null,
): string | null {
  return submitted === undefined ? saved : cleanText(submitted);
}

export function mergeAiProviderRequest(
  request: UpdateAiProviderRequest,
  previous: StoredAiProvider | null,
): StoredAiProvider {
  const preset = AI_PROVIDER_PRESETS[request.provider];
  const sameProvider = previous?.provider === request.provider;
  return {
    provider: request.provider,
    baseUrl: preset.baseUrlEditable
      ? (cleanUrl(request.baseUrl) ?? preset.baseUrl)
      : null,
    apiStyle: preset.apiStyleEditable
      ? (request.apiStyle ?? preset.apiStyle)
      : preset.apiStyle,
    model: request.model.trim(),
    preciseModel: request.preciseModel.trim(),
    apiKey: nextKey(request.apiKey, sameProvider ? previous.apiKey : null),
    voiceEnabled: request.voiceEnabled,
    transcribeBaseUrl: cleanUrl(request.transcribeBaseUrl),
    transcribeModel: cleanText(request.transcribeModel),
    transcribeApiKey: nextKey(
      request.transcribeApiKey,
      previous?.transcribeApiKey ?? null,
    ),
  };
}

export function aiProviderProblems(candidate: StoredAiProvider): string[] {
  const preset = AI_PROVIDER_PRESETS[candidate.provider];
  const problems: string[] = [];
  if (preset.baseUrlEditable && candidate.baseUrl === null) {
    problems.push('baseUrl is required for this provider');
  }
  if (preset.keyRequired && candidate.apiKey === null) {
    problems.push(`apiKey is required for ${preset.label}`);
  }
  if (candidate.model === '') {
    problems.push('model must not be empty');
  }
  if (candidate.preciseModel === '') {
    problems.push('preciseModel must not be empty');
  }
  return problems;
}

export function toSettingsDto(
  stored: StoredAiProvider,
  meta: SavedAiProviderMeta,
): AiProviderSettingsDto {
  return {
    provider: stored.provider,
    baseUrl: stored.baseUrl,
    apiStyle: stored.apiStyle,
    model: stored.model,
    preciseModel: stored.preciseModel,
    hasApiKey: stored.apiKey !== null,
    apiKeyLast4: stored.apiKey === null ? null : meta.apiKeyLast4,
    voiceEnabled: stored.voiceEnabled,
    transcribeBaseUrl: stored.transcribeBaseUrl,
    transcribeModel: stored.transcribeModel,
    hasTranscribeApiKey: stored.transcribeApiKey !== null,
    transcribeApiKeyLast4:
      stored.transcribeApiKey === null ? null : meta.transcribeApiKeyLast4,
    updatedAt: meta.updatedAt.toISOString(),
  };
}

export function toServerDto(config: AppConfig): AiProviderServerDto {
  const { ai } = config;
  return {
    provider: ai.provider,
    baseUrl: ai.baseUrl,
    apiStyle: ai.apiStyle,
    model: ai.model,
    preciseModel: ai.preciseModel,
  };
}
