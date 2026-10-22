import type {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import type { CompletionUsage } from 'openai/resources/completions';
import type { AiStructuredResult, AiTokenUsage } from './ai-provider.js';
import {
  AiProviderError,
  type AiProviderErrorDetails,
} from './ai-provider-error.js';
import type { StructuredCall, StructuredOutput } from './openai-structured.js';

export type ChatResult = ChatCompletion & { _request_id?: string | null };

function userParts<T>(call: StructuredCall<T>): ChatCompletionContentPart[] {
  return [
    { type: 'text', text: call.userText },
    ...call.images.map((image): ChatCompletionContentPart => ({
      type: 'image_url',
      image_url: { url: image.dataUrl, detail: image.detail },
    })),
  ];
}

export function buildChatRequest<T>(
  call: StructuredCall<T>,
  maxOutputTokens: number,
): ChatCompletionCreateParamsNonStreaming {
  const { format } = call.output;
  return {
    model: call.model,
    messages: [
      { role: 'system', content: call.instructions },
      {
        role: 'user',
        content: call.images.length > 0 ? userParts(call) : call.userText,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        schema: format.schema,
        strict: format.strict ?? true,
      },
    },
    max_tokens: maxOutputTokens,
  };
}

export function normalizeChatUsage(
  usage: CompletionUsage | null | undefined,
): AiTokenUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
    outputTokens: usage?.completion_tokens ?? 0,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

export function interpretChatResponse<T>(
  response: ChatResult,
  output: StructuredOutput<T>,
  requestedModel: string,
  latencyMs: number,
): AiStructuredResult<T> {
  const usage = normalizeChatUsage(response.usage);
  const model = response.model || requestedModel;
  const requestId = response._request_id ?? null;
  const serviceTier = response.service_tier ?? null;
  const details: AiProviderErrorDetails = {
    requestId,
    usage,
    model,
    serviceTier,
  };
  const choice = response.choices?.[0];
  if (!choice) {
    throw new AiProviderError(
      'server_error',
      'The model returned no answer',
      true,
      details,
    );
  }
  if (choice.finish_reason === 'content_filter') {
    throw new AiProviderError(
      'refusal',
      'The model response was filtered',
      false,
      details,
    );
  }
  if (choice.finish_reason === 'length') {
    throw new AiProviderError(
      'incomplete',
      'The model response was incomplete (max_output_tokens)',
      false,
      details,
    );
  }
  const refusal = choice.message.refusal;
  if (refusal) {
    throw new AiProviderError('refusal', refusal, false, details);
  }
  const parsed = output.parse(stripJsonFence(choice.message.content ?? ''));
  if (!parsed.ok) {
    throw new AiProviderError('invalid_output', parsed.error, true, details);
  }
  return { raw: parsed.data, usage, model, requestId, latencyMs, serviceTier };
}
