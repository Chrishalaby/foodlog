import { Logger } from '@nestjs/common';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
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
      new AiProviderError('auth', 'OPENAI_API_KEY is not set', false),
    );
  }
}

export function createVoiceProvider(config: AppConfig): VoiceAiProvider {
  const { ai } = config;
  if (ai.provider === 'mock') {
    return new MockVoiceProvider({
      latencyMs: config.nodeEnv === 'test' ? 0 : MOCK_VOICE_LATENCY_MS,
    });
  }
  const apiKey = ai.transcribeApiKey ?? ai.apiKey;
  if (!ai.voiceEnabled || !apiKey) {
    return new UnconfiguredVoiceProvider();
  }
  const baseURL = ai.transcribeBaseUrl ?? ai.baseUrl;
  const logger = new Logger(OpenAiVoiceProvider.name);
  return new OpenAiVoiceProvider({
    apiKey,
    timeoutMs: ai.timeoutMs,
    ...(baseURL ? { baseURL } : {}),
    onHintsRejected: (error) =>
      logger.warn(
        `Transcription vocabulary hints were rejected (${error.message}); retrying without them`,
      ),
  });
}
