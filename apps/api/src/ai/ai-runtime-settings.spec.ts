import { storedProvider } from '../../test/support/ai-settings.js';
import { buildConfig } from '../../test/support/config.js';
import {
  isEnvManaged,
  resolveRuntimeAiSettings,
} from './ai-runtime-settings.js';

const CLAUDE = storedProvider('anthropic', { apiKey: 'sk-ant-test-key-1234' });

describe('resolveRuntimeAiSettings', () => {
  it('uses the in-app provider when the server sets no AI key', () => {
    const settings = resolveRuntimeAiSettings(buildConfig(), CLAUDE);

    expect(settings.source).toBe('app');
    expect(settings.ai).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-1234',
      baseUrl: null,
      apiStyle: 'chat',
      model: 'claude-sonnet-5-5',
      preciseModel: 'claude-opus-5-5',
      catalog: 'anthropic',
    });
  });

  it('lets OPENAI_API_KEY on the server win over in-app settings', () => {
    const config = buildConfig({ OPENAI_API_KEY: 'sk-env' });
    const settings = resolveRuntimeAiSettings(config, CLAUDE);

    expect(isEnvManaged(config)).toBe(true);
    expect(settings.source).toBe('env');
    expect(settings.ai).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-env',
      model: 'gpt-5.6-sol',
      catalog: 'openai',
    });
  });

  it('keeps AI_PROVIDER=mock and DEMO_MODE on the mock', () => {
    expect(
      resolveRuntimeAiSettings(buildConfig({ AI_PROVIDER: 'mock' }), CLAUDE),
    ).toMatchObject({ source: 'env', ai: { provider: 'mock' } });
    expect(
      resolveRuntimeAiSettings(buildConfig({ DEMO_MODE: 'true' }), CLAUDE),
    ).toMatchObject({
      source: 'demo',
      ai: { provider: 'mock' },
      voice: { enabled: true },
    });
  });

  it('is unconfigured with nothing set anywhere', () => {
    const config = buildConfig();
    expect(isEnvManaged(config)).toBe(false);
    expect(resolveRuntimeAiSettings(config, null)).toMatchObject({
      source: 'none',
      ai: { provider: 'unconfigured', apiKey: null },
      voice: { enabled: false },
    });
  });

  it('uses the preset address for hosted OpenAI-compatible providers', () => {
    const gemini = resolveRuntimeAiSettings(
      buildConfig(),
      storedProvider('gemini', {
        apiKey: 'AIza-test-key',
        baseUrl: 'https://evil.example/v1',
      }),
    );
    expect(gemini.ai).toMatchObject({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiStyle: 'chat',
      catalog: null,
    });
  });

  it('runs a local server without a key and a custom server only with an address', () => {
    expect(
      resolveRuntimeAiSettings(buildConfig(), storedProvider('local')).ai,
    ).toMatchObject({
      provider: 'local',
      apiKey: null,
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(
      resolveRuntimeAiSettings(
        buildConfig(),
        storedProvider('custom', { model: 'm', preciseModel: 'm' }),
      ).ai.provider,
    ).toBe('unconfigured');
  });

  it('turns voice on for OpenAI and needs a transcription service for others', () => {
    const openai = resolveRuntimeAiSettings(
      buildConfig(),
      storedProvider('openai', { apiKey: 'sk-test-key-0001' }),
    );
    expect(openai.voice).toEqual({
      enabled: true,
      apiKey: 'sk-test-key-0001',
      baseUrl: null,
      model: 'gpt-transcribe',
    });

    expect(resolveRuntimeAiSettings(buildConfig(), CLAUDE).voice.enabled).toBe(
      false,
    );
    expect(
      resolveRuntimeAiSettings(buildConfig(), {
        ...CLAUDE,
        transcribeBaseUrl: 'http://whisper.lan:8000/v1',
        transcribeModel: 'whisper-large-v3',
      }).voice,
    ).toEqual({
      enabled: true,
      apiKey: null,
      baseUrl: 'http://whisper.lan:8000/v1',
      model: 'whisper-large-v3',
    });
    expect(
      resolveRuntimeAiSettings(buildConfig(), {
        ...CLAUDE,
        transcribeApiKey: 'sk-openai-voice',
        voiceEnabled: false,
      }).voice.enabled,
    ).toBe(false);
  });
});
