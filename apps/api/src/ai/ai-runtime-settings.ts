import {
  AI_PROVIDER_PRESETS,
  type AiApiStyle,
  type AiConfigDto,
  type AiProviderKind,
  type AiProviderSource,
} from '@food/shared';
import type { AppConfig } from '../config/app-config.js';
import type { ModelVendor } from './models.js';

export type AiProviderState = AiConfigDto['provider'];

export interface StoredAiProvider {
  provider: AiProviderKind;
  baseUrl: string | null;
  apiStyle: AiApiStyle;
  model: string;
  preciseModel: string;
  apiKey: string | null;
  voiceEnabled: boolean;
  transcribeBaseUrl: string | null;
  transcribeModel: string | null;
  transcribeApiKey: string | null;
}

export interface AiConnection {
  provider: AiProviderState;
  apiKey: string | null;
  baseUrl: string | null;
  apiStyle: AiApiStyle;
  model: string;
  preciseModel: string;
  catalog: ModelVendor | null;
}

export interface VoiceConnection {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
}

export interface RuntimeAiSettings {
  source: AiProviderSource;
  ai: AiConnection;
  voice: VoiceConnection;
}

const CATALOG_VENDORS: Partial<Record<AiProviderKind, ModelVendor>> = {
  openai: 'openai',
  anthropic: 'anthropic',
};

export function isEnvManaged(config: AppConfig): boolean {
  return (
    config.demo.enabled ||
    config.ai.provider === 'mock' ||
    config.ai.apiKey !== null
  );
}

function serverConnection(
  config: AppConfig,
  provider: AiProviderState,
): AiConnection {
  const { ai } = config;
  return {
    provider,
    apiKey: provider === 'unconfigured' ? null : ai.apiKey,
    baseUrl: ai.baseUrl,
    apiStyle: ai.apiStyle,
    model: ai.model,
    preciseModel: ai.preciseModel,
    catalog: ai.baseUrl ? null : 'openai',
  };
}

function serverVoice(config: AppConfig): VoiceConnection {
  const { ai } = config;
  const apiKey = ai.transcribeApiKey ?? ai.apiKey;
  return {
    enabled: ai.voiceEnabled && apiKey !== null,
    apiKey,
    baseUrl: ai.transcribeBaseUrl ?? ai.baseUrl,
    model: ai.transcribeModel,
  };
}

function voiceOff(config: AppConfig): VoiceConnection {
  return {
    enabled: false,
    apiKey: null,
    baseUrl: null,
    model: config.ai.transcribeModel,
  };
}

export function isProviderReady(stored: StoredAiProvider): boolean {
  const preset = AI_PROVIDER_PRESETS[stored.provider];
  const hasKey = stored.apiKey !== null || !preset.keyRequired;
  const hasUrl = !preset.baseUrlEditable || stored.baseUrl !== null;
  return (
    hasKey &&
    hasUrl &&
    stored.model.trim() !== '' &&
    stored.preciseModel.trim() !== ''
  );
}

function appVoice(
  config: AppConfig,
  stored: StoredAiProvider,
  baseUrl: string | null,
): VoiceConnection {
  const sharesEndpoint =
    AI_PROVIDER_PRESETS[stored.provider].transcription === 'same';
  const apiKey =
    stored.transcribeApiKey ?? (sharesEndpoint ? stored.apiKey : null);
  const url = stored.transcribeBaseUrl ?? (sharesEndpoint ? baseUrl : null);
  const reachable = sharesEndpoint || url !== null || apiKey !== null;
  return {
    enabled: stored.voiceEnabled && reachable,
    apiKey,
    baseUrl: url,
    model: stored.transcribeModel ?? config.ai.transcribeModel,
  };
}

export function appConnection(stored: StoredAiProvider): AiConnection {
  const preset = AI_PROVIDER_PRESETS[stored.provider];
  return {
    provider: isProviderReady(stored) ? stored.provider : 'unconfigured',
    apiKey: stored.apiKey,
    baseUrl: preset.baseUrlEditable ? stored.baseUrl : preset.baseUrl,
    apiStyle: preset.apiStyleEditable ? stored.apiStyle : preset.apiStyle,
    model: stored.model.trim(),
    preciseModel: stored.preciseModel.trim(),
    catalog: CATALOG_VENDORS[stored.provider] ?? null,
  };
}

export function resolveRuntimeAiSettings(
  config: AppConfig,
  stored: StoredAiProvider | null,
): RuntimeAiSettings {
  if (config.demo.enabled || config.ai.provider === 'mock') {
    return {
      source: config.demo.enabled ? 'demo' : 'env',
      ai: serverConnection(config, 'mock'),
      voice: { ...voiceOff(config), enabled: true },
    };
  }
  if (config.ai.apiKey !== null) {
    return {
      source: 'env',
      ai: serverConnection(config, 'openai'),
      voice: serverVoice(config),
    };
  }
  if (stored === null) {
    return {
      source: 'none',
      ai: serverConnection(config, 'unconfigured'),
      voice: voiceOff(config),
    };
  }
  const ai = appConnection(stored);
  return {
    source: 'app',
    ai,
    voice:
      ai.provider === 'unconfigured'
        ? voiceOff(config)
        : appVoice(config, stored, ai.baseUrl),
  };
}
