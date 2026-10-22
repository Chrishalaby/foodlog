import type { AiProviderSettingsDto } from '@food/shared';
import {
  draftFromSettings,
  draftProblems,
  hasSavedKey,
  maskedKey,
  showsKeyInput,
  switchProvider,
  toUpdateRequest,
} from './ai-provider-model';

const CLAUDE: AiProviderSettingsDto = {
  provider: 'anthropic',
  baseUrl: null,
  apiStyle: 'chat',
  model: 'claude-sonnet-5-5',
  preciseModel: 'claude-opus-5-5',
  hasApiKey: true,
  apiKeyLast4: '1a2b',
  voiceEnabled: true,
  transcribeBaseUrl: null,
  transcribeModel: null,
  hasTranscribeApiKey: false,
  transcribeApiKeyLast4: null,
  updatedAt: '2026-10-22T10:00:00.000Z',
};

describe('AI provider draft', () => {
  it('starts with the OpenAI defaults when nothing is saved', () => {
    const draft = draftFromSettings(null);
    expect(draft).toMatchObject({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      preciseModel: 'gpt-6-astra',
      apiKey: '',
      voiceEnabled: true,
    });
    expect(draftProblems(draft, null)).toEqual({ apiKey: 'Paste your OpenAI API key.' });
  });

  it('prefills the address and models when the provider changes', () => {
    const local = switchProvider(draftFromSettings(CLAUDE), 'local', CLAUDE);
    expect(local).toMatchObject({
      provider: 'local',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3-vl:8b',
      preciseModel: 'qwen3-vl:32b',
    });
    expect(draftProblems(local, CLAUDE)).toEqual({});
    const back = switchProvider({ ...local, voiceEnabled: false }, 'anthropic', CLAUDE);
    expect(back).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(back.voiceEnabled).toBe(false);
  });

  it('shows the saved key only for the provider it belongs to', () => {
    const draft = draftFromSettings(CLAUDE);
    expect(hasSavedKey(draft, CLAUDE)).toBe(true);
    expect(showsKeyInput(draft, CLAUDE)).toBe(false);
    expect(showsKeyInput({ ...draft, replaceKey: true }, CLAUDE)).toBe(true);
    const openai = switchProvider(draft, 'openai', CLAUDE);
    expect(hasSavedKey(openai, CLAUDE)).toBe(false);
    expect(draftProblems(openai, CLAUDE).apiKey).toBe('Paste your OpenAI API key.');
    expect(maskedKey('1a2b')).toBe('•••• 1a2b');
    expect(maskedKey(null)).toBe('••••');
  });

  it('keeps the saved key by leaving it out of the request', () => {
    const request = toUpdateRequest(draftFromSettings(CLAUDE), CLAUDE);
    expect(request).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      preciseModel: 'claude-opus-5-5',
      voiceEnabled: true,
      transcribeBaseUrl: null,
      transcribeModel: null,
    });
    expect(request).not.toHaveProperty('apiKey');
  });

  it('sends a replaced key and trims the fields', () => {
    const request = toUpdateRequest(
      {
        ...switchProvider(draftFromSettings(null), 'custom', null),
        baseUrl: ' http://vllm.lan:8000/v1 ',
        apiStyle: 'responses',
        model: ' vision ',
        preciseModel: 'vision-xl',
        apiKey: ' sk-new ',
        transcribeApiKey: ' sk-voice ',
      },
      null,
    );
    expect(request).toMatchObject({
      provider: 'custom',
      baseUrl: 'http://vllm.lan:8000/v1',
      apiStyle: 'responses',
      model: 'vision',
      apiKey: 'sk-new',
      transcribeApiKey: 'sk-voice',
    });
  });

  it('removes the saved transcription key on request', () => {
    const settings = { ...CLAUDE, hasTranscribeApiKey: true, transcribeApiKeyLast4: '9999' };
    const request = toUpdateRequest(
      { ...draftFromSettings(settings), removeTranscribeKey: true },
      settings,
    );
    expect(request.transcribeApiKey).toBeNull();
  });

  it('flags missing models and bad addresses', () => {
    const custom = switchProvider(draftFromSettings(null), 'custom', null);
    expect(draftProblems(custom, null)).toEqual({
      baseUrl: 'Enter the server address.',
      model: 'Enter a model name.',
      preciseModel: 'Enter a model name.',
    });
    expect(
      draftProblems(
        {
          ...custom,
          baseUrl: 'ollama:11434',
          model: 'a',
          preciseModel: 'b',
          transcribeBaseUrl: 'whisper',
        },
        null,
      ),
    ).toEqual({
      baseUrl: 'Use an address that starts with http:// or https://.',
      transcribeBaseUrl: 'Use an address that starts with http:// or https://.',
    });
  });
});
