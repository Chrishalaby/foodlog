import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import {
  type AiFailureKind,
  AiProviderError,
  type AiProviderErrorDetails,
} from './ai-provider-error.js';
import { retryAfterMs } from './openai-errors.js';

const RETRYABLE_STATUSES = new Set([408, 409]);

function classify(error: APIError): {
  kind: AiFailureKind;
  retryable: boolean;
} {
  if (error instanceof RateLimitError) {
    return { kind: 'rate_limited', retryable: true };
  }
  if (error instanceof InternalServerError) {
    return { kind: 'server_error', retryable: true };
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    return { kind: 'auth', retryable: false };
  }
  if (error instanceof BadRequestError || error instanceof NotFoundError) {
    return { kind: 'bad_request', retryable: false };
  }
  return {
    kind: 'unknown',
    retryable: RETRYABLE_STATUSES.has(error.status ?? 0),
  };
}

export function anthropicErrorMessage(error: APIError): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  if (typeof message === 'string' && message.trim() !== '') {
    return error.status ? `${error.status} ${message}` : message;
  }
  return error.message;
}

function details(error: APIError, model: string): AiProviderErrorDetails {
  const wait = retryAfterMs(error.headers);
  return {
    ...(error.status !== undefined ? { status: error.status } : {}),
    requestId: error.requestID ?? null,
    ...(wait !== undefined ? { retryAfterMs: wait } : {}),
    model,
  };
}

export function fromAnthropicError(
  error: unknown,
  model: string,
): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }
  const options = { cause: error };
  if (error instanceof APIConnectionTimeoutError) {
    return new AiProviderError(
      'timeout',
      error.message,
      false,
      { model },
      options,
    );
  }
  if (error instanceof APIConnectionError) {
    return new AiProviderError(
      'connection',
      error.message,
      true,
      { model },
      options,
    );
  }
  if (error instanceof APIError) {
    const { kind, retryable } = classify(error);
    return new AiProviderError(
      kind,
      anthropicErrorMessage(error),
      retryable,
      details(error, model),
      options,
    );
  }
  return new AiProviderError(
    'unknown',
    error instanceof Error ? error.message : String(error),
    false,
    { model },
    options,
  );
}
