import type { TestAiProviderResponse } from '@food/shared';
import type { AppConfig } from '../config/app-config.js';
import type { AiConnection } from './ai-runtime-settings.js';
import {
  type AiProviderError,
  toAiProviderError,
} from './providers/ai-provider-error.js';
import type {
  OpenAiFetch,
  StructuredCall,
  StructuredOutput,
  StructuredParseResult,
} from './providers/openai-structured.js';
import { ANTHROPIC_BASE_URL } from './providers/anthropic-structured.js';
import {
  createStructuredClient,
  OPENAI_BASE_URL,
} from './providers/provider.factory.js';

export const CONNECTION_TEST_MAX_OUTPUT_TOKENS = 2048;

export interface ConnectionCheck {
  ok: boolean;
}

function parseConnectionCheck(
  text: string,
): StructuredParseResult<ConnectionCheck> {
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { ok?: unknown }).ok === 'boolean'
    ) {
      return { ok: true, data: { ok: (value as ConnectionCheck).ok } };
    }
  } catch {
    return { ok: false, error: 'The answer was not valid JSON' };
  }
  return { ok: false, error: 'The answer did not match the requested format' };
}

export const CONNECTION_TEST_OUTPUT: StructuredOutput<ConnectionCheck> = {
  format: {
    type: 'json_schema',
    name: 'connection_check',
    strict: true,
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
  },
  parse: parseConnectionCheck,
};

export function connectionTestCall(
  model: string,
): StructuredCall<ConnectionCheck> {
  return {
    model,
    instructions:
      'You are a connection check for a food tracker. Answer only with the requested JSON.',
    userText: 'Reply with {"ok": true}.',
    images: [],
    output: CONNECTION_TEST_OUTPUT,
  };
}

export function redactSecrets(
  message: string,
  secrets: readonly (string | null)[],
): string {
  let redacted = message.replace(/(API key provided:?)\s*\S+/gi, '$1 [hidden]');
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      redacted = redacted.split(secret).join('[hidden]');
    }
  }
  return redacted;
}

function serverName(connection: AiConnection): string {
  const url =
    connection.baseUrl ??
    (connection.provider === 'anthropic'
      ? ANTHROPIC_BASE_URL
      : OPENAI_BASE_URL);
  return URL.parse(url)?.host ?? url;
}

export function describeConnectionFailure(
  error: AiProviderError,
  connection: AiConnection,
): string {
  const detail = error.message.trim();
  switch (error.kind) {
    case 'auth':
      return `The API key was rejected. ${detail}`;
    case 'connection':
      return `Could not reach ${serverName(connection)}. Check the address and that the server is running. ${detail}`;
    case 'timeout':
      return `${serverName(connection)} did not answer in time.`;
    case 'rate_limited':
    case 'quota_exceeded':
      return `The provider refused the request because of rate or spending limits. ${detail}`;
    case 'bad_request':
      return `The provider rejected the request. Check the model name. ${detail}`;
    case 'invalid_output':
    case 'incomplete':
      return `The model answered, but not in the structured format FoodLog needs. Try a model that supports JSON schema output. ${detail}`;
    default:
      return detail || 'The connection test failed.';
  }
}

export async function testAiConnection(
  connection: AiConnection,
  config: AppConfig,
  fetch?: OpenAiFetch,
): Promise<TestAiProviderResponse> {
  const client = createStructuredClient(connection, config, {
    maxOutputTokens: CONNECTION_TEST_MAX_OUTPUT_TOKENS,
    ...(fetch ? { fetch } : {}),
  });
  const startedAt = performance.now();
  try {
    const result = await client.call(connectionTestCall(connection.model));
    return {
      ok: true,
      model: result.model,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `Connected. ${result.model} answered.`,
    };
  } catch (error) {
    const failure = toAiProviderError(error);
    return {
      ok: false,
      model: connection.model,
      latencyMs: null,
      message: redactSecrets(describeConnectionFailure(failure, connection), [
        connection.apiKey,
      ]),
    };
  }
}
