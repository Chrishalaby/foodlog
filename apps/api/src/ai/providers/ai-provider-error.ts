import type { AiTokenUsage } from './ai-provider.js';

export const AI_FAILURE_KINDS = [
  'refusal',
  'incomplete',
  'invalid_output',
  'timeout',
  'connection',
  'rate_limited',
  'quota_exceeded',
  'server_error',
  'bad_request',
  'auth',
  'unknown',
] as const;

export type AiFailureKind = (typeof AI_FAILURE_KINDS)[number];

export interface AiProviderErrorDetails {
  status?: number;
  requestId?: string | null;
  retryAfterMs?: number;
  usage?: AiTokenUsage;
  model?: string;
  serviceTier?: string | null;
}

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    message: string,
    readonly retryable: boolean,
    readonly details: AiProviderErrorDetails = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiProviderError';
  }
}

export function toAiProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }
  return new AiProviderError(
    'unknown',
    error instanceof Error ? error.message : String(error),
    false,
    {},
    { cause: error },
  );
}
