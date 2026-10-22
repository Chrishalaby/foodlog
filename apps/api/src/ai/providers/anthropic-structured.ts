import Anthropic from '@anthropic-ai/sdk';
import type {
  Base64ImageSource,
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  OutputConfig,
  Usage,
} from '@anthropic-ai/sdk/resources/messages';
import type { ReasoningEffortSetting } from '../../config/settings.js';
import { findModel } from '../models.js';
import type {
  AiImageInput,
  AiStructuredResult,
  AiTokenUsage,
} from './ai-provider.js';
import {
  AiProviderError,
  type AiProviderErrorDetails,
} from './ai-provider-error.js';
import { fromAnthropicError } from './anthropic-errors.js';
import { stripJsonFence } from './openai-chat.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  type OpenAiFetch,
  type StructuredCall,
  type StructuredOutput,
} from './openai-structured.js';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

export type ClaudeEffort = NonNullable<OutputConfig['effort']>;

export interface AnthropicRequestSettings {
  reasoningEffort: ReasoningEffortSetting;
  maxOutputTokens?: number;
}

export interface AnthropicProviderOptions extends AnthropicRequestSettings {
  apiKey: string;
  timeoutMs: number;
  baseURL?: string;
  fetch?: OpenAiFetch;
}

export type AnthropicResult = Message & { _request_id?: string | null };

type JsonSchema = Record<string, unknown>;

const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set<
  Base64ImageSource['media_type']
>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/s;

const UNSUPPORTED_SCHEMA_KEYS = [
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
] as const;

const EFFORT_FOR_SETTING: Readonly<
  Record<ReasoningEffortSetting, ClaudeEffort>
> = {
  none: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapSchemas(value: unknown): unknown {
  return Array.isArray(value) ? value.map(claudeOutputSchema) : value;
}

function mapSchemaRecord(value: unknown): unknown {
  return isSchema(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, schema]) => [
          key,
          claudeOutputSchema(schema),
        ]),
      )
    : value;
}

export function claudeOutputSchema(schema: unknown): unknown {
  if (!isSchema(schema)) {
    return schema;
  }
  const result: JsonSchema = { ...schema };
  for (const key of UNSUPPORTED_SCHEMA_KEYS) {
    delete result[key];
  }
  if (typeof result.minItems === 'number' && result.minItems > 1) {
    delete result.minItems;
  }
  if ('properties' in result) {
    result.properties = mapSchemaRecord(result.properties);
  }
  for (const key of ['$defs', 'definitions'] as const) {
    if (key in result) {
      result[key] = mapSchemaRecord(result[key]);
    }
  }
  if ('items' in result) {
    result.items = claudeOutputSchema(result.items);
  }
  for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
    if (key in result) {
      result[key] = mapSchemas(result[key]);
    }
  }
  return result;
}

export function claudeEffort(
  model: string,
  configured: ReasoningEffortSetting,
): ClaudeEffort | null {
  return findModel(model)?.vendor === 'anthropic'
    ? EFFORT_FOR_SETTING[configured]
    : null;
}

export function imageBlock(image: AiImageInput): ContentBlockParam {
  const match = DATA_URL_PATTERN.exec(image.dataUrl);
  const mediaType = match?.[1]?.toLowerCase();
  if (!match?.[2] || !mediaType || !IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new AiProviderError(
      'bad_request',
      'Claude accepts JPEG, PNG, GIF or WebP images only',
      false,
    );
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType as Base64ImageSource['media_type'],
      data: match[2],
    },
  };
}

export function buildAnthropicRequest<T>(
  call: StructuredCall<T>,
  settings: AnthropicRequestSettings,
): MessageCreateParamsNonStreaming {
  const effort = claudeEffort(call.model, settings.reasoningEffort);
  return {
    model: call.model,
    max_tokens: settings.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    system: call.instructions,
    messages: [
      {
        role: 'user',
        content: [
          ...call.images.map(imageBlock),
          { type: 'text', text: call.userText },
        ],
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: claudeOutputSchema(call.output.format.schema) as JsonSchema,
      },
      ...(effort ? { effort } : {}),
    },
  };
}

export function normalizeAnthropicUsage(
  usage: Usage | null | undefined,
): AiTokenUsage {
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: (usage?.input_tokens ?? 0) + cacheRead + cacheWrite,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.thinking_tokens ?? 0,
  };
}

function responseText(response: AnthropicResult): string {
  return response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
}

export function interpretAnthropicResponse<T>(
  response: AnthropicResult,
  output: StructuredOutput<T>,
  requestedModel: string,
  latencyMs: number,
): AiStructuredResult<T> {
  const usage = normalizeAnthropicUsage(response.usage);
  const model = response.model || requestedModel;
  const requestId = response._request_id ?? null;
  const details: AiProviderErrorDetails = {
    requestId,
    usage,
    model,
    serviceTier: null,
  };
  if (response.stop_reason === 'refusal') {
    throw new AiProviderError(
      'refusal',
      response.stop_details?.explanation || 'The model refused to answer',
      false,
      details,
    );
  }
  if (
    response.stop_reason === 'max_tokens' ||
    response.stop_reason === 'model_context_window_exceeded'
  ) {
    throw new AiProviderError(
      'incomplete',
      'The model response was incomplete (max_output_tokens)',
      false,
      details,
    );
  }
  const text = responseText(response);
  if (text.trim() === '') {
    throw new AiProviderError(
      'invalid_output',
      'The model returned no answer',
      true,
      details,
    );
  }
  const parsed = output.parse(stripJsonFence(text));
  if (!parsed.ok) {
    throw new AiProviderError('invalid_output', parsed.error, true, details);
  }
  return {
    raw: parsed.data,
    usage,
    model,
    requestId,
    latencyMs,
    serviceTier: null,
  };
}

export class AnthropicStructuredClient {
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      authToken: null,
      baseURL: options.baseURL ?? ANTHROPIC_BASE_URL,
      maxRetries: 0,
      timeout: options.timeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async call<T>(call: StructuredCall<T>): Promise<AiStructuredResult<T>> {
    const body = buildAnthropicRequest(call, this.options);
    const startedAt = performance.now();
    let response: AnthropicResult;
    try {
      response = await this.client.messages.create(body);
    } catch (error) {
      throw fromAnthropicError(error, call.model);
    }
    return interpretAnthropicResponse(
      response,
      call.output,
      call.model,
      Math.round(performance.now() - startedAt),
    );
  }
}
