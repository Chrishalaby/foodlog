import OpenAI from 'openai';
import type {
  Response as OpenAiResponse,
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextJSONSchemaConfig,
  ResponseInputContent,
  ResponseInputText,
  ResponseOutputItem,
  ResponseUsage,
} from 'openai/resources/responses/responses';
import type {
  ReasoningEffortSetting,
  ServiceTierSetting,
} from '../../config/settings.js';
import {
  effectiveReasoningEffort,
  supportsReasoning,
  usesExplicitPromptCache,
} from '../models.js';
import type {
  AiImageInput,
  AiStructuredResult,
  AiTokenUsage,
} from './ai-provider.js';
import {
  AiProviderError,
  type AiProviderErrorDetails,
} from './ai-provider-error.js';
import {
  buildChatRequest,
  type ChatResult,
  interpretChatResponse,
} from './openai-chat.js';
import { fromOpenAiError } from './openai-errors.js';

export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export type OpenAiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAiRequestSettings {
  reasoningEffort: ReasoningEffortSetting;
  serviceTier: ServiceTierSetting;
  maxOutputTokens?: number;
}

export type OpenAiApiStyle = 'responses' | 'chat';

export interface OpenAiProviderOptions extends OpenAiRequestSettings {
  apiKey: string;
  timeoutMs: number;
  baseURL?: string;
  apiStyle?: OpenAiApiStyle;
  fetch?: OpenAiFetch;
}

export type OpenAiResult = OpenAiResponse & { _request_id?: string | null };

export type StructuredParseResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

export interface StructuredOutput<T> {
  format: ResponseFormatTextJSONSchemaConfig;
  parse: (text: string) => StructuredParseResult<T>;
}

export interface StructuredCall<T> {
  model: string;
  instructions: string;
  userText: string;
  images: readonly AiImageInput[];
  output: StructuredOutput<T>;
}

function developerMessage(
  instructions: string,
  explicitCache: boolean,
): ResponseInputText {
  return {
    type: 'input_text',
    text: instructions,
    ...(explicitCache ? { prompt_cache_breakpoint: { mode: 'explicit' } } : {}),
  };
}

function userContent<T>(call: StructuredCall<T>): ResponseInputContent[] {
  return [
    { type: 'input_text', text: call.userText },
    ...call.images.map((image): ResponseInputContent => ({
      type: 'input_image',
      image_url: image.dataUrl,
      detail: image.detail,
    })),
  ];
}

export function buildStructuredRequest<T>(
  call: StructuredCall<T>,
  settings: OpenAiRequestSettings,
): ResponseCreateParamsNonStreaming {
  const explicitCache = usesExplicitPromptCache(call.model);
  const effort = effectiveReasoningEffort(call.model, settings.reasoningEffort);
  return {
    model: call.model,
    input: [
      {
        role: 'developer',
        content: [developerMessage(call.instructions, explicitCache)],
      },
      { role: 'user', content: userContent(call) },
    ],
    text: {
      format: call.output.format,
      ...(supportsReasoning(call.model) ? { verbosity: 'low' } : {}),
    },
    ...(effort ? { reasoning: { effort } } : {}),
    ...(settings.serviceTier !== 'default'
      ? { service_tier: settings.serviceTier }
      : {}),
    ...(explicitCache ? { prompt_cache_options: { mode: 'explicit' } } : {}),
    max_output_tokens: settings.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    store: false,
  };
}

export function normalizeOpenAiUsage(
  usage: ResponseUsage | null | undefined,
): AiTokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

function findRefusal(output: readonly ResponseOutputItem[]): string | null {
  for (const item of output) {
    if (item.type !== 'message') {
      continue;
    }
    const refusal = item.content.find((part) => part.type === 'refusal');
    if (refusal) {
      return refusal.refusal;
    }
  }
  return null;
}

function outputText(output: readonly ResponseOutputItem[]): string {
  return output
    .flatMap((item) => (item.type === 'message' ? item.content : []))
    .flatMap((part) => (part.type === 'output_text' ? [part.text] : []))
    .join('');
}

export function interpretStructuredResponse<T>(
  response: OpenAiResult,
  output: StructuredOutput<T>,
  requestedModel: string,
  latencyMs: number,
): AiStructuredResult<T> {
  const usage = normalizeOpenAiUsage(response.usage);
  const model = response.model || requestedModel;
  const requestId = response._request_id ?? null;
  const serviceTier = response.service_tier ?? null;
  const details: AiProviderErrorDetails = {
    requestId,
    usage,
    model,
    serviceTier,
  };
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason ?? 'unknown';
    throw new AiProviderError(
      reason === 'content_filter' ? 'refusal' : 'incomplete',
      `The model response was incomplete (${reason})`,
      false,
      details,
    );
  }
  if (response.status === 'failed') {
    throw new AiProviderError(
      'server_error',
      response.error?.message ?? 'The model response failed',
      true,
      details,
    );
  }
  const refusal = findRefusal(response.output);
  if (refusal !== null) {
    throw new AiProviderError(
      'refusal',
      refusal || 'The model refused to answer',
      false,
      details,
    );
  }
  const parsed = output.parse(outputText(response.output));
  if (!parsed.ok) {
    throw new AiProviderError('invalid_output', parsed.error, true, details);
  }
  return { raw: parsed.data, usage, model, requestId, latencyMs, serviceTier };
}

export class OpenAiStructuredClient {
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAiProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 0,
      timeout: options.timeoutMs,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async call<T>(call: StructuredCall<T>): Promise<AiStructuredResult<T>> {
    if (this.options.apiStyle === 'chat') {
      return this.callChat(call);
    }
    const body = buildStructuredRequest(call, this.options);
    const startedAt = performance.now();
    let response: OpenAiResult;
    try {
      response = await this.client.responses.create(body);
    } catch (error) {
      throw fromOpenAiError(error, call.model);
    }
    return interpretStructuredResponse(
      response,
      call.output,
      call.model,
      Math.round(performance.now() - startedAt),
    );
  }

  private async callChat<T>(
    call: StructuredCall<T>,
  ): Promise<AiStructuredResult<T>> {
    const body = buildChatRequest(
      call,
      this.options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    );
    const startedAt = performance.now();
    let response: ChatResult;
    try {
      response = await this.client.chat.completions.create(body);
    } catch (error) {
      throw fromOpenAiError(error, call.model);
    }
    return interpretChatResponse(
      response,
      call.output,
      call.model,
      Math.round(performance.now() - startedAt),
    );
  }
}
