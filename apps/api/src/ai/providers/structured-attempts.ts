import { setTimeout as delay } from 'node:timers/promises';
import type { AiStructuredResult } from './ai-provider.js';
import {
  type AiProviderError,
  toAiProviderError,
} from './ai-provider-error.js';

export const MAX_ATTEMPTS = 2;
export const MAX_RETRY_DELAY_MS = 5_000;
export const DEFAULT_RETRY_DELAY_MS = 1_000;

export type StructuredAttemptRecord<T> =
  | {
      attempt: number;
      durationMs: number;
      ok: true;
      result: AiStructuredResult<T>;
    }
  | { attempt: number; durationMs: number; ok: false; error: AiProviderError };

export interface RetryDelayOptions {
  maxRetryDelayMs?: number;
  defaultRetryDelayMs?: number;
}

export interface StructuredRetryOptions<T> extends RetryDelayOptions {
  onAttempt: (record: StructuredAttemptRecord<T>) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export type StructuredAttempt<T> = () => Promise<AiStructuredResult<T>>;

async function runAttempt<T>(
  call: StructuredAttempt<T>,
  attempt: number,
): Promise<StructuredAttemptRecord<T>> {
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);
  try {
    const result = await call();
    return { attempt, durationMs: elapsed(), ok: true, result };
  } catch (error) {
    return {
      attempt,
      durationMs: elapsed(),
      ok: false,
      error: toAiProviderError(error),
    };
  }
}

export function retryDelayMs(
  error: AiProviderError,
  options: RetryDelayOptions = {},
): number | null {
  if (!error.retryable) {
    return null;
  }
  const wait =
    error.details.retryAfterMs ??
    options.defaultRetryDelayMs ??
    DEFAULT_RETRY_DELAY_MS;
  return wait > (options.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS) ? null : wait;
}

export async function callWithOneRetry<T>(
  call: StructuredAttempt<T>,
  options: StructuredRetryOptions<T>,
): Promise<AiStructuredResult<T>> {
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  for (let attempt = 1; ; attempt += 1) {
    const record = await runAttempt(call, attempt);
    await options.onAttempt(record);
    if (record.ok) {
      return record.result;
    }
    const wait = retryDelayMs(record.error, options);
    if (attempt >= MAX_ATTEMPTS || wait === null) {
      throw record.error;
    }
    await sleep(wait);
  }
}
