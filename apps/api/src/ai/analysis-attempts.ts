import type { FoodAnalysisOutput } from './food-analysis.schema.js';
import type {
  AiAnalyzeRequest,
  AiAnalyzeResult,
  AiProvider,
} from './providers/ai-provider.js';
import {
  callWithOneRetry,
  type StructuredAttemptRecord,
  type StructuredRetryOptions,
} from './providers/structured-attempts.js';

export {
  DEFAULT_RETRY_DELAY_MS,
  MAX_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  retryDelayMs,
} from './providers/structured-attempts.js';

export type AttemptRecord = StructuredAttemptRecord<FoodAnalysisOutput>;

export type RetryOptions = StructuredRetryOptions<FoodAnalysisOutput>;

export function analyzeWithOneRetry(
  provider: AiProvider,
  request: AiAnalyzeRequest,
  options: RetryOptions,
): Promise<AiAnalyzeResult> {
  return callWithOneRetry(() => provider.analyze(request), options);
}
