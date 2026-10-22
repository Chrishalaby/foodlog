import { AppConfig } from '../config/app-config.js';
import { type AiSettings, parseSettings } from '../config/settings.js';
import { MOCK_TRANSCRIPT, MockVoiceProvider } from './mock-voice.provider.js';
import { OpenAiVoiceProvider } from './openai-voice.provider.js';
import {
  createVoiceProvider,
  UnconfiguredVoiceProvider,
} from './voice-provider.factory.js';
import type { VoiceTranscribeRequest } from './voice-provider.js';

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

describe('createVoiceProvider', () => {
  it('uses the mock when AI_PROVIDER is mock', () => {
    expect(
      createVoiceProvider(config({ provider: 'mock', apiKey: 'sk-ignored' })),
    ).toBeInstanceOf(MockVoiceProvider);
  });

  it('uses OpenAI when a key is configured', () => {
    expect(
      createVoiceProvider(config({ provider: 'openai', apiKey: 'sk-test' })),
    ).toBeInstanceOf(OpenAiVoiceProvider);
  });

  it('rejects every call when OpenAI is selected without a key', async () => {
    const provider = createVoiceProvider(
      config({ provider: 'openai', apiKey: null }),
    );

    expect(provider).toBeInstanceOf(UnconfiguredVoiceProvider);
    await expect(provider.transcribe(REQUEST)).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
  });

  it('stays off when voice is turned off, even with a key', () => {
    expect(
      createVoiceProvider(
        config({ provider: 'openai', apiKey: 'sk-test', voiceEnabled: false }),
      ),
    ).toBeInstanceOf(UnconfiguredVoiceProvider);
  });

  it('uses a separate transcription server and key when given', () => {
    expect(
      createVoiceProvider(
        config({
          provider: 'openai',
          apiKey: null,
          transcribeApiKey: 'local',
          transcribeBaseUrl: 'http://whisper.lan:8000/v1',
        }),
      ),
    ).toBeInstanceOf(OpenAiVoiceProvider);
  });
});
