import { Logger } from '@nestjs/common';
import type { RuntimeAiSettings } from '../ai/ai-runtime-settings.js';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import {
  KEYLESS_API_KEY,
  OPENAI_BASE_URL,
} from '../ai/providers/provider.factory.js';
import type { AppConfig } from '../config/app-config.js';
import {
  MOCK_VOICE_LATENCY_MS,
  MockVoiceProvider,
} from './mock-voice.provider.js';
import { OpenAiVoiceProvider } from './openai-voice.provider.js';
import type {
  VoiceAiProvider,
  VoiceTranscribeResult,
} from './voice-provider.js';

export class UnconfiguredVoiceProvider implements VoiceAiProvider {
  readonly name = 'openai';

  transcribe(): Promise<VoiceTranscribeResult> {
    return Promise.reject(
      new AiProviderError(
        'auth',
        'No transcription service is configured',
        false,
      ),
    );
  }
}

export function createVoiceProvider(
  settings: RuntimeAiSettings,
  config: AppConfig,
): VoiceAiProvider {
  const { ai, voice } = settings;
  if (ai.provider === 'mock') {
    return new MockVoiceProvider({
      latencyMs: config.nodeEnv === 'test' ? 0 : MOCK_VOICE_LATENCY_MS,
    });
  }
  if (ai.provider === 'unconfigured' || !voice.enabled) {
    return new UnconfiguredVoiceProvider();
  }
  const logger = new Logger(OpenAiVoiceProvider.name);
  return new OpenAiVoiceProvider({
    apiKey: voice.apiKey ?? KEYLESS_API_KEY,
    timeoutMs: config.ai.timeoutMs,
    baseURL: voice.baseUrl ?? OPENAI_BASE_URL,
    onHintsRejected: (error) =>
      logger.warn(
        `Transcription vocabulary hints were rejected (${error.message}); retrying without them`,
      ),
  });
}
