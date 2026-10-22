import { storedProvider } from '../../test/support/ai-settings.js';
import {
  resolveRuntimeAiSettings,
  type StoredAiProvider,
} from '../ai/ai-runtime-settings.js';
import { AppConfig } from '../config/app-config.js';
import { type AiSettings, parseSettings } from '../config/settings.js';
import { MOCK_TRANSCRIPT, MockVoiceProvider } from './mock-voice.provider.js';
import { OpenAiVoiceProvider } from './openai-voice.provider.js';
import {
  createVoiceProvider,
  UnconfiguredVoiceProvider,
} from './voice-provider.factory.js';
import type {
  VoiceAiProvider,
  VoiceTranscribeRequest,
} from './voice-provider.js';

const REQUEST: VoiceTranscribeRequest = {
  model: 'gpt-transcribe',
  audio: {
    buffer: Buffer.from('audio'),
    filename: 'voice.webm',
    mimeType: 'audio/webm',
  },
  vocabulary: ['Khoury', 'Labneh'],
};

function config(ai: Partial<AiSettings>): AppConfig {
  const settings = parseSettings({
    DATABASE_URL: 'postgresql://food:food@localhost:5433/food?schema=public',
    NODE_ENV: 'test',
  });
  return new AppConfig({ ...settings, ai: { ...settings.ai, ...ai } });
}

describe('MockVoiceProvider', () => {
  it('returns a fixed dictation describing two meals at zero cost', async () => {
    const result = await new MockVoiceProvider({ latencyMs: 0 }).transcribe(
      REQUEST,
    );

    expect(result).toMatchObject({
      raw: { text: MOCK_TRANSCRIPT, audioSeconds: null },
      model: 'mock',
      requestId: null,
      serviceTier: null,
    });
    expect(MOCK_TRANSCRIPT).toContain('breakfast');
    expect(MOCK_TRANSCRIPT).toContain('lunch');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});

function voiceFor(
  ai: Partial<AiSettings>,
  stored: StoredAiProvider | null = null,
): VoiceAiProvider {
  const appConfig = config(ai);
  return createVoiceProvider(
    resolveRuntimeAiSettings(appConfig, stored),
    appConfig,
  );
}

describe('createVoiceProvider', () => {
  it('uses the mock when AI_PROVIDER is mock', () => {
    expect(voiceFor({ provider: 'mock', apiKey: 'sk-ignored' })).toBeInstanceOf(
      MockVoiceProvider,
    );
  });

  it('uses OpenAI when a key is configured', () => {
    expect(voiceFor({ provider: 'openai', apiKey: 'sk-test' })).toBeInstanceOf(
      OpenAiVoiceProvider,
    );
  });

  it('rejects every call when no provider is set up', async () => {
    const provider = voiceFor({ provider: 'openai', apiKey: null });

    expect(provider).toBeInstanceOf(UnconfiguredVoiceProvider);
    await expect(provider.transcribe(REQUEST)).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
  });

  it('stays off when voice is turned off, even with a key', () => {
    expect(
      voiceFor({ provider: 'openai', apiKey: 'sk-test', voiceEnabled: false }),
    ).toBeInstanceOf(UnconfiguredVoiceProvider);
  });

  it('uses a separate transcription server and key when given', () => {
    expect(
      voiceFor({
        provider: 'openai',
        apiKey: 'sk-test',
        transcribeApiKey: 'local',
        transcribeBaseUrl: 'http://whisper.lan:8000/v1',
      }),
    ).toBeInstanceOf(OpenAiVoiceProvider);
  });

  it('has no voice for Claude until a transcription service is added', () => {
    const claude = storedProvider('anthropic', { apiKey: 'sk-ant-test-key' });
    expect(voiceFor({ apiKey: null }, claude)).toBeInstanceOf(
      UnconfiguredVoiceProvider,
    );
    expect(
      voiceFor({ apiKey: null }, { ...claude, transcribeApiKey: 'sk-openai' }),
    ).toBeInstanceOf(OpenAiVoiceProvider);
    expect(
      voiceFor(
        { apiKey: null },
        { ...claude, transcribeBaseUrl: 'http://whisper.lan:8000/v1' },
      ),
    ).toBeInstanceOf(OpenAiVoiceProvider);
  });
});
