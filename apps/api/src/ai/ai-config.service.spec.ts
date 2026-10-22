import {
  fixedAiSettings,
  storedProvider,
} from '../../test/support/ai-settings.js';
import { buildConfig } from '../../test/support/config.js';
import type { EnvRecord } from '../config/env-files.js';
import { AiConfigService } from './ai-config.service.js';
import type { StoredAiProvider } from './ai-runtime-settings.js';
import { MODEL_CATALOG } from './models.js';

function serviceFor(
  env: EnvRecord,
  stored: StoredAiProvider | null = null,
): AiConfigService {
  const config = buildConfig(env);
  return new AiConfigService(config, fixedAiSettings(config, stored));
}

describe('AiConfigService', () => {
  it('offers the OpenAI catalog by default', () => {
    const service = serviceFor({ OPENAI_API_KEY: 'sk-test' });
    const dto = service.describe(null, 5);
    expect(dto).toMatchObject({
      provider: 'openai',
      voice: true,
      customEndpoint: false,
      defaultModel: 'gpt-5.6-sol',
    });
    expect(dto.availableModels.map((model) => model.id)).toEqual(
      MODEL_CATALOG.filter(
        (entry) => entry.selectable && entry.vendor === 'openai',
      ).map((entry) => entry.id),
    );
    expect(service.isSelectableModel('llama3.2-vision')).toBe(false);
    expect(service.isSelectableModel('claude-opus-5-5')).toBe(false);
  });

  it('offers only the configured models of a custom server and accepts their ids as typed', () => {
    const service = serviceFor({
      OPENAI_API_KEY: 'ollama',
      OPENAI_BASE_URL: 'http://ollama.lan:11434/v1',
      AI_API_STYLE: 'chat',
      OPENAI_MODEL: 'qwen2.5vl:7b',
      OPENAI_PRECISE_MODEL: 'qwen2.5vl:32b',
    });
    const dto = service.describe('qwen2.5vl:32b', null);
    expect(dto.customEndpoint).toBe(true);
    expect(dto.availableModels).toEqual([
      {
        id: 'qwen2.5vl:7b',
        label: 'qwen2.5vl:7b',
        description: 'From your AI server',
        estCostPerRequestUsd: 0,
        recommended: true,
      },
      {
        id: 'qwen2.5vl:32b',
        label: 'qwen2.5vl:32b',
        description: 'Precise re-check model',
        estCostPerRequestUsd: 0,
        recommended: false,
      },
    ]);
    expect(dto.activeModel).toBe('qwen2.5vl:32b');
    expect(service.resolveModel('gpt-5.6-sol', false)).toBe('qwen2.5vl:7b');
    expect(service.resolveModel(null, true)).toBe('qwen2.5vl:32b');
  });

  it('lists one model once when default and precise are the same', () => {
    const service = serviceFor({
      OPENAI_API_KEY: 'x',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENAI_MODEL: 'google/gemini-2.5-flash',
      OPENAI_PRECISE_MODEL: 'google/gemini-2.5-flash',
    });
    expect(service.availableModels()).toHaveLength(1);
  });

  it('reports voice as off when it is disabled or has no key', () => {
    expect(
      serviceFor({ OPENAI_API_KEY: 'sk', VOICE_ENABLED: 'false' }).describe(
        null,
        null,
      ).voice,
    ).toBe(false);
    expect(serviceFor({}).describe(null, null)).toMatchObject({
      provider: 'unconfigured',
      voice: false,
    });
    expect(serviceFor({ AI_PROVIDER: 'mock' }).describe(null, null).voice).toBe(
      true,
    );
  });

  it('offers the Claude catalog when Claude is set up in the app', () => {
    const service = serviceFor(
      {},
      storedProvider('anthropic', { apiKey: 'sk-ant-test-key-1234' }),
    );
    const dto = service.describe('claude-haiku-5-5', null);
    expect(dto).toMatchObject({
      provider: 'anthropic',
      customEndpoint: false,
      defaultModel: 'claude-sonnet-5-5',
      preciseModel: 'claude-opus-5-5',
      activeModel: 'claude-haiku-5-5',
      voice: false,
    });
    expect(dto.availableModels.map((model) => model.id)).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
    ]);
    expect(dto.availableModels[0]?.estCostPerRequestUsd).toBeGreaterThan(0);
    expect(service.isSelectableModel('gpt-6-astra')).toBe(false);
    expect(service.resolveModel('gpt-6-astra', false)).toBe(
      'claude-sonnet-5-5',
    );
  });

  it('treats in-app Gemini, OpenRouter and local servers as custom endpoints', () => {
    const service = serviceFor({}, storedProvider('local'));
    expect(service.describe(null, null)).toMatchObject({
      provider: 'local',
      customEndpoint: true,
      defaultModel: 'qwen3-vl:8b',
      voice: false,
    });
    expect(service.isSelectableModel('qwen3-vl:32b')).toBe(true);
    expect(
      serviceFor({}, storedProvider('gemini', { apiKey: 'AIza-test-key' }))
        .customEndpoint,
    ).toBe(true);
  });

  it('stays unconfigured when an in-app provider is missing its key', () => {
    expect(serviceFor({}, storedProvider('openai')).provider).toBe(
      'unconfigured',
    );
  });

  it('lets the server environment win over in-app settings', () => {
    const service = serviceFor(
      { OPENAI_API_KEY: 'sk-env' },
      storedProvider('anthropic', { apiKey: 'sk-ant-test-key-1234' }),
    );
    expect(service.provider).toBe('openai');
    expect(service.defaultModel).toBe('gpt-5.6-sol');
  });
});
