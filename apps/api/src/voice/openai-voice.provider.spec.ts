import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import { zeroUsage } from '../ai/providers/ai-provider.js';
import type { OpenAiFetch } from '../ai/providers/openai-structured.js';
import {
  interpretTranscription,
  OpenAiVoiceProvider,
  transcriptionHints,
} from './openai-voice.provider.js';
import {
  buildVoicePrompt,
  VOICE_PROMPT_INTRO,
  voicePromptIntro,
} from './voice-prompt.js';
import type { VoiceTranscribeRequest } from './voice-provider.js';

const VOCABULARY = ['Khoury', 'Labneh', 'Sofisoft'];

const REQUEST: VoiceTranscribeRequest = {
  model: 'gpt-transcribe',
  audio: {
    buffer: Buffer.from('fake-audio-bytes'),
    filename: 'voice.m4a',
    mimeType: 'audio/mp4',
  },
  vocabulary: VOCABULARY,
};

const OPTIONS = { apiKey: 'sk-test', timeoutMs: 5_000 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_7' },
  });
}

function capture(respond: (call: number) => Response): {
  fetch: OpenAiFetch;
  forms: FormData[];
  urls: string[];
} {
  const forms: FormData[] = [];
  const urls: string[] = [];
  const fetch: OpenAiFetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('data:')) {
      return new Response('');
    }
    urls.push(url);
    forms.push(
      await new Response(init?.body, {
        headers: init?.headers,
      }).formData(),
    );
    return respond(forms.length);
  };
  return { fetch, forms, urls };
}

describe('transcriptionHints', () => {
  it('names the speaker’s location in the prompt when it is known', () => {
    expect(
      transcriptionHints('gpt-transcribe', VOCABULARY, 'Beirut, Lebanon'),
    ).toEqual({
      prompt: voicePromptIntro('Beirut, Lebanon'),
      keywords: [...VOCABULARY],
    });
    expect(
      transcriptionHints('whisper-1', VOCABULARY, 'Beirut, Lebanon').prompt,
    ).toBe(buildVoicePrompt(VOCABULARY, 'Beirut, Lebanon'));
  });

  it('sends the vocabulary as keywords to models that support them', () => {
    expect(transcriptionHints('gpt-transcribe', VOCABULARY)).toEqual({
      prompt: VOICE_PROMPT_INTRO,
      keywords: VOCABULARY,
    });
  });

  it('folds the vocabulary into the prompt for other models', () => {
    expect(transcriptionHints('gpt-4o-transcribe', VOCABULARY)).toEqual({
      prompt: buildVoicePrompt(VOCABULARY),
    });
    expect(transcriptionHints('whisper-1', VOCABULARY)).not.toHaveProperty(
      'keywords',
    );
  });

  it('sends only the intro when the user has no vocabulary yet', () => {
    expect(transcriptionHints('gpt-transcribe', [])).toEqual({
      prompt: VOICE_PROMPT_INTRO,
    });
  });
});

describe('interpretTranscription', () => {
  it('reads duration usage as audio seconds', () => {
    expect(
      interpretTranscription(
        {
          text: ' 2 eggs and 150 g labneh ',
          usage: { type: 'duration', seconds: 12.5 },
          _request_id: 'req_1',
        },
        'gpt-transcribe',
        900,
      ),
    ).toEqual({
      raw: { text: ' 2 eggs and 150 g labneh ', audioSeconds: 12.5 },
      usage: zeroUsage(),
      model: 'gpt-transcribe',
      requestId: 'req_1',
      latencyMs: 900,
      serviceTier: null,
    });
  });

  it('reads token usage as input and output tokens', () => {
    const result = interpretTranscription(
      {
        text: 'manakish',
        usage: {
          type: 'tokens',
          input_tokens: 300,
          output_tokens: 12,
          total_tokens: 312,
        },
      },
      'gpt-4o-transcribe',
      700,
    );

    expect(result.raw).toEqual({ text: 'manakish', audioSeconds: null });
    expect(result.usage).toEqual({
      ...zeroUsage(),
      inputTokens: 300,
      outputTokens: 12,
    });
    expect(result.requestId).toBeNull();
  });

  it('tolerates a response without usage or text', () => {
    const result = interpretTranscription(
      {} as Parameters<typeof interpretTranscription>[0],
      'gpt-transcribe',
      10,
    );

    expect(result.raw).toEqual({ text: '', audioSeconds: null });
    expect(result.usage).toEqual(zeroUsage());
  });
});

describe('OpenAiVoiceProvider', () => {
  it('uploads the audio with the prompt and keywords and no language', async () => {
    const { fetch, forms, urls } = capture(() =>
      json({
        text: 'For lunch 2 manakish',
        usage: { type: 'duration', seconds: 6 },
      }),
    );
    const provider = new OpenAiVoiceProvider({ ...OPTIONS, fetch });

    const result = await provider.transcribe(REQUEST);

    expect(result).toMatchObject({
      raw: { text: 'For lunch 2 manakish', audioSeconds: 6 },
      model: 'gpt-transcribe',
      requestId: 'req_7',
    });
    expect(urls).toEqual(['https://api.openai.com/v1/audio/transcriptions']);
    const [form] = forms as [FormData];
    expect(form.get('model')).toBe('gpt-transcribe');
    expect(form.get('prompt')).toBe(VOICE_PROMPT_INTRO);
    expect(form.getAll('keywords[]')).toEqual(VOCABULARY);
    expect(form.has('language')).toBe(false);
    expect(form.has('languages[]')).toBe(false);
    const file = form.get('file') as File;
    expect(file.name).toBe('voice.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe(
      'fake-audio-bytes',
    );
  });

  it('puts the vocabulary in the prompt for models without keywords', async () => {
    const { fetch, forms } = capture(() => json({ text: 'ok' }));
    const provider = new OpenAiVoiceProvider({ ...OPTIONS, fetch });

    await provider.transcribe({ ...REQUEST, model: 'gpt-4o-transcribe' });

    const [form] = forms as [FormData];
    expect(form.get('prompt')).toBe(buildVoicePrompt(VOCABULARY));
    expect(form.has('keywords[]')).toBe(false);
  });

  it('retries once without vocabulary hints when OpenAI rejects them', async () => {
    const rejected: AiProviderError[] = [];
    const { fetch, forms } = capture((call) =>
      call === 1
        ? json(
            {
              error: {
                message: 'too many keywords',
                type: 'invalid_request_error',
              },
            },
            400,
          )
        : json({ text: 'labneh', usage: { type: 'duration', seconds: 3 } }),
    );
    const provider = new OpenAiVoiceProvider({
      ...OPTIONS,
      fetch,
      onHintsRejected: (error) => rejected.push(error),
    });

    const result = await provider.transcribe(REQUEST);

    expect(result.raw.text).toBe('labneh');
    expect(forms).toHaveLength(2);
    expect(forms[1]?.get('prompt')).toBe(VOICE_PROMPT_INTRO);
    expect(forms[1]?.has('keywords[]')).toBe(false);
    expect(rejected.map(({ kind }) => kind)).toEqual(['bad_request']);
  });

  it('does not repeat a rejected request that carried no vocabulary', async () => {
    const { fetch, forms } = capture(() =>
      json({ error: { message: 'audio too short' } }, 400),
    );
    const provider = new OpenAiVoiceProvider({ ...OPTIONS, fetch });

    await expect(
      provider.transcribe({ ...REQUEST, vocabulary: [] }),
    ).rejects.toMatchObject({ kind: 'bad_request', retryable: false });
    expect(forms).toHaveLength(1);
  });

  it('maps HTTP failures with the requested model and never retries itself', async () => {
    const { fetch, forms } = capture(() =>
      json({ error: { message: 'boom', type: 'server_error' } }, 503),
    );
    const provider = new OpenAiVoiceProvider({ ...OPTIONS, fetch });

    const error: unknown = await provider
      .transcribe(REQUEST)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({
      kind: 'server_error',
      retryable: true,
      details: { status: 503, model: 'gpt-transcribe' },
    });
    expect(forms).toHaveLength(1);
  });
});
