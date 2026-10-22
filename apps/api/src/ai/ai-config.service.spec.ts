import { buildConfig } from '../../test/support/config.js';
import { AiConfigService } from './ai-config.service.js';
import { MODEL_CATALOG } from './models.js';

describe('AiConfigService', () => {
  it('offers the OpenAI catalog by default', () => {
    const service = new AiConfigService(
      buildConfig({ OPENAI_API_KEY: 'sk-test' }),
    );
    const dto = service.describe(null, 5);
    expect(dto).toMatchObject({
      provider: 'openai',
      voice: true,
      customEndpoint: false,
      defaultModel: 'gpt-5.6-sol',
    });
    expect(dto.availableModels.map((model) => model.id)).toEqual(
      MODEL_CATALOG.filter((entry) => entry.selectable).map(
        (entry) => entry.id,
      ),
    );
    expect(service.isSelectableModel('llama3.2-vision')).toBe(false);
  });

  it('offers only the configured models of a custom server and accepts their ids as typed', () => {
    const service = new AiConfigService(
      buildConfig({
        OPENAI_API_KEY: 'ollama',
        OPENAI_BASE_URL: 'http://ollama.lan:11434/v1',
        AI_API_STYLE: 'chat',
        OPENAI_MODEL: 'qwen2.5vl:7b',
        OPENAI_PRECISE_MODEL: 'qwen2.5vl:32b',
      }),
    );
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
    const service = new AiConfigService(
      buildConfig({
        OPENAI_API_KEY: 'x',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
        OPENAI_MODEL: 'google/gemini-2.5-flash',
        OPENAI_PRECISE_MODEL: 'google/gemini-2.5-flash',
      }),
    );
    expect(service.availableModels()).toHaveLength(1);
  });

  it('reports voice as off when it is disabled or has no key', () => {
    expect(
      new AiConfigService(
        buildConfig({ OPENAI_API_KEY: 'sk', VOICE_ENABLED: 'false' }),
      ).describe(null, null).voice,
    ).toBe(false);
    expect(
      new AiConfigService(buildConfig({})).describe(null, null),
    ).toMatchObject({
      provider: 'unconfigured',
      voice: false,
    });
    expect(
      new AiConfigService(buildConfig({ AI_PROVIDER: 'mock' })).describe(
        null,
        null,
      ).voice,
    ).toBe(true);
  });
});
