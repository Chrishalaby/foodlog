import type { UpdateAiProviderRequest } from '@food/shared';
import { storedProvider } from '../../test/support/ai-settings.js';
import {
  aiProviderProblems,
  keyLast4,
  mergeAiProviderRequest,
  toSettingsDto,
} from './ai-provider-settings.js';
import { isHttpBaseUrl } from './ai-provider-settings.dto.js';

const SAVED = storedProvider('anthropic', {
  apiKey: 'sk-ant-saved-key-9z9z',
  transcribeApiKey: 'sk-voice-key-0000',
});

function request(
  overrides: Partial<UpdateAiProviderRequest> = {},
): UpdateAiProviderRequest {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    preciseModel: 'claude-opus-5-5',
    voiceEnabled: true,
    ...overrides,
  };
}

describe('mergeAiProviderRequest', () => {
  it('keeps the saved keys when none are sent for the same provider', () => {
    const merged = mergeAiProviderRequest(request(), SAVED);
    expect(merged.apiKey).toBe('sk-ant-saved-key-9z9z');
    expect(merged.transcribeApiKey).toBe('sk-voice-key-0000');
  });

  it('replaces or removes a key when one is sent', () => {
    expect(
      mergeAiProviderRequest(request({ apiKey: '  sk-ant-new  ' }), SAVED)
        .apiKey,
    ).toBe('sk-ant-new');
    expect(
      mergeAiProviderRequest(request({ transcribeApiKey: null }), SAVED)
        .transcribeApiKey,
    ).toBeNull();
    expect(
      mergeAiProviderRequest(request({ apiKey: '   ' }), SAVED).apiKey,
    ).toBeNull();
  });

  it('never carries a key over to a different provider', () => {
    const merged = mergeAiProviderRequest(
      request({ provider: 'openai', model: 'gpt-5.6-sol' }),
      SAVED,
    );
    expect(merged.apiKey).toBeNull();
    expect(aiProviderProblems(merged)).toEqual([
      'apiKey is required for OpenAI',
    ]);
  });

  it('applies preset addresses and API styles that cannot be edited', () => {
    expect(
      mergeAiProviderRequest(
        request({
          provider: 'gemini',
          baseUrl: 'https://elsewhere.example/v1',
          apiStyle: 'responses',
        }),
        null,
      ),
    ).toMatchObject({ baseUrl: null, apiStyle: 'chat' });
    expect(
      mergeAiProviderRequest(
        request({ provider: 'local', baseUrl: '', model: 'qwen3-vl:8b' }),
        null,
      ).baseUrl,
    ).toBe('http://localhost:11434/v1');
    expect(
      mergeAiProviderRequest(
        request({
          provider: 'custom',
          baseUrl: 'http://vllm.lan:8000/v1/',
          apiStyle: 'responses',
        }),
        null,
      ),
    ).toMatchObject({
      baseUrl: 'http://vllm.lan:8000/v1',
      apiStyle: 'responses',
    });
  });

  it('lists what is missing', () => {
    expect(
      aiProviderProblems(
        mergeAiProviderRequest(
          request({ provider: 'custom', model: ' ', preciseModel: '' }),
          null,
        ),
      ),
    ).toEqual([
      'baseUrl is required for this provider',
      'model must not be empty',
      'preciseModel must not be empty',
    ]);
    expect(
      aiProviderProblems(
        mergeAiProviderRequest(
          request({ provider: 'local', model: 'a', preciseModel: 'b' }),
          null,
        ),
      ),
    ).toEqual([]);
  });
});

describe('toSettingsDto', () => {
  it('exposes only whether a key is saved and its last four characters', () => {
    const dto = toSettingsDto(SAVED, {
      apiKeyLast4: '9z9z',
      transcribeApiKeyLast4: '0000',
      updatedAt: new Date('2026-10-22T10:00:00.000Z'),
    });

    expect(dto).toMatchObject({
      provider: 'anthropic',
      hasApiKey: true,
      apiKeyLast4: '9z9z',
      hasTranscribeApiKey: true,
      transcribeApiKeyLast4: '0000',
      updatedAt: '2026-10-22T10:00:00.000Z',
    });
    expect(JSON.stringify(dto)).not.toContain('sk-ant-saved-key');
    expect(JSON.stringify(dto)).not.toContain('sk-voice-key');
  });

  it('shows no hint for short keys', () => {
    expect(keyLast4('sk-ant-saved-key-9z9z')).toBe('9z9z');
    expect(keyLast4('ollama')).toBeNull();
    expect(keyLast4(null)).toBeNull();
  });
});

describe('isHttpBaseUrl', () => {
  it('accepts http(s) server addresses, including LAN and Docker names', () => {
    expect(isHttpBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isHttpBaseUrl('http://ollama:11434/v1')).toBe(true);
    expect(isHttpBaseUrl('https://openrouter.ai/api/v1')).toBe(true);
  });

  it('rejects other schemes, credentials, queries and fragments', () => {
    expect(isHttpBaseUrl('ftp://example.com')).toBe(false);
    expect(isHttpBaseUrl('http://user:pass@example.com/v1')).toBe(false);
    expect(isHttpBaseUrl('https://example.com/v1?key=x')).toBe(false);
    expect(isHttpBaseUrl('https://example.com/v1#x')).toBe(false);
    expect(isHttpBaseUrl('not a url')).toBe(false);
  });
});
