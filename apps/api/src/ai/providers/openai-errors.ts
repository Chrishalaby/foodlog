import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import {
  type AiFailureKind,
  AiProviderError,
  type AiProviderErrorDetails,
} from './ai-provider-error.js';

const NON_RETRYABLE_429_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

const RETRYABLE_STATUSES = new Set([408, 409]);

export function retryAfterMs(
  headers: Headers | undefined | null,
): number | undefined {
  const ms = Number(headers?.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) {
    return ms;
  }
  const seconds = Number(headers?.get('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return undefined;
}

function apiDetails(error: APIError, model: string): AiProviderErrorDetails {
  const wait = retryAfterMs(error.headers);
  return {
    ...(error.status !== undefined ? { status: error.status } : {}),
    requestId: error.requestID ?? null,
    ...(wait !== undefined ? { retryAfterMs: wait } : {}),
    model,
  };
}

function isQuotaError(error: RateLimitError): boolean {
  return (
    NON_RETRYABLE_429_CODES.has(error.code ?? '') ||
    NON_RETRYABLE_429_CODES.has(error.type ?? '')
  );
}

function classifyApiError(error: APIError): {
  kind: AiFailureKind;
  retryable: boolean;
} {
  if (error instanceof RateLimitError) {
    return isQuotaError(error)
      ? { kind: 'quota_exceeded', retryable: false }
      : { kind: 'rate_limited', retryable: true };
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
  if (error instanceof BadRequestError) {
    return { kind: 'bad_request', retryable: false };
  }
  return {
    kind: 'unknown',
    retryable: RETRYABLE_STATUSES.has(error.status ?? 0),
  };
}

export function fromOpenAiError(
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
    const { kind, retryable } = classifyApiError(error);
    return new AiProviderError(
      kind,
      error.message,
      retryable,
      apiDetails(error, model),
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
