import OpenAI, { toFile } from 'openai';
import type {
  Transcription,
  TranscriptionCreateParamsNonStreaming,
} from 'openai/resources/audio/transcriptions';
import { supportsTranscriptionKeywords } from '../ai/models.js';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import { fromOpenAiError } from '../ai/providers/openai-errors.js';
import type { OpenAiFetch } from '../ai/providers/openai-structured.js';
import { buildVoicePrompt, voicePromptIntro } from './voice-prompt.js';
import type {
  VoiceAiProvider,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from './voice-provider.js';
import { normalizeTranscriptionUsage } from './voice-usage.js';

export interface OpenAiVoiceOptions {
  apiKey: string;
  timeoutMs: number;
  baseURL?: string;
  fetch?: OpenAiFetch;
  onHintsRejected?: (error: AiProviderError) => void;
}

export type TranscriptionHints = Pick<
  TranscriptionCreateParamsNonStreaming<'json'>,
  'prompt' | 'keywords'
>;

export type TranscriptionResult = Transcription & {
  _request_id?: string | null;
};

export function transcriptionHints(
  model: string,
  vocabulary: readonly string[],
  location: string | null = null,
): TranscriptionHints {
  if (vocabulary.length > 0 && supportsTranscriptionKeywords(model)) {
    return { prompt: voicePromptIntro(location), keywords: [...vocabulary] };
  }
  return { prompt: buildVoicePrompt(vocabulary, location) };
}

export function interpretTranscription(
  response: TranscriptionResult,
  requestedModel: string,
  latencyMs: number,
): VoiceTranscribeResult {
  const { tokens, audioSeconds } = normalizeTranscriptionUsage(response.usage);
  return {
    raw: {
      text: typeof response.text === 'string' ? response.text : '',
      audioSeconds,
    },
    usage: tokens,
    model: requestedModel,
    requestId: response._request_id ?? null,
    latencyMs,
    serviceTier: null,
  };
}

export class OpenAiVoiceProvider implements VoiceAiProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAiVoiceOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 0,
      timeout: options.timeoutMs,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async transcribe(
    request: VoiceTranscribeRequest,
  ): Promise<VoiceTranscribeResult> {
    const hints = transcriptionHints(
      request.model,
      request.vocabulary,
      request.location ?? null,
    );
    try {
      return await this.call(request, hints);
    } catch (error) {
      if (
        request.vocabulary.length === 0 ||
        !(error instanceof AiProviderError) ||
        error.kind !== 'bad_request'
      ) {
        throw error;
      }
      this.options.onHintsRejected?.(error);
      return this.call(request, {
        prompt: voicePromptIntro(request.location),
      });
    }
  }

  private async call(
    request: VoiceTranscribeRequest,
    hints: TranscriptionHints,
  ): Promise<VoiceTranscribeResult> {
    const { audio, model } = request;
    const startedAt = performance.now();
    let response: TranscriptionResult;
    try {
      response = await this.client.audio.transcriptions.create({
        file: await toFile(audio.buffer, audio.filename, {
          type: audio.mimeType,
        }),
        model,
        ...hints,
      });
    } catch (error) {
      throw fromOpenAiError(error, model);
    }
    return interpretTranscription(
      response,
      model,
      Math.round(performance.now() - startedAt),
    );
  }
}
