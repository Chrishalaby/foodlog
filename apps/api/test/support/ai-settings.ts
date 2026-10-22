import type { AiProviderKind } from '@food/shared';
import { AI_PROVIDER_PRESETS } from '@food/shared';
import type { AiProviderSettingsService } from '../../src/ai/ai-provider-settings.service.js';
import {
  resolveRuntimeAiSettings,
  type StoredAiProvider,
} from '../../src/ai/ai-runtime-settings.js';
import type { AppConfig } from '../../src/config/app-config.js';

export function storedProvider(
  provider: AiProviderKind,
  overrides: Partial<StoredAiProvider> = {},
): StoredAiProvider {
  const preset = AI_PROVIDER_PRESETS[provider];
  return {
    provider,
    baseUrl: preset.baseUrlEditable ? preset.baseUrl : null,
    apiStyle: preset.apiStyle,
    model: preset.model,
    preciseModel: preset.preciseModel,
    apiKey: null,
    voiceEnabled: true,
    transcribeBaseUrl: null,
    transcribeModel: null,
    transcribeApiKey: null,
    ...overrides,
  };
}

export function fixedAiSettings(
  config: AppConfig,
  stored: StoredAiProvider | null = null,
): AiProviderSettingsService {
  const settings = resolveRuntimeAiSettings(config, stored);
  return { snapshot: () => settings } as unknown as AiProviderSettingsService;
}
