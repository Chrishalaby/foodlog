import { toAnalyzeHttpException } from './analysis-errors.js';
import {
  AI_FAILURE_KINDS,
  type AiFailureKind,
  AiProviderError,
} from './providers/ai-provider-error.js';

function statusFor(kind: AiFailureKind): number {
  return toAnalyzeHttpException(
    new AiProviderError(kind, 'raw', false),
  ).getStatus();
}

describe('toAnalyzeHttpException', () => {
  it.each<[AiFailureKind, number]>([
    ['quota_exceeded', 503],
    ['auth', 503],
    ['rate_limited', 429],
    ['timeout', 504],
    ['refusal', 502],
    ['invalid_output', 502],
    ['incomplete', 502],
    ['server_error', 502],
    ['connection', 502],
    ['bad_request', 502],
    ['unknown', 502],
  ])('maps %s to HTTP %i', (kind, status) => {
    expect(statusFor(kind)).toBe(status);
  });

  it('uses friendly messages instead of raw provider errors', () => {
    for (const kind of AI_FAILURE_KINDS) {
      const response = toAnalyzeHttpException(
        new AiProviderError(kind, 'sk-secret raw detail', false),
      ).getResponse() as { message: string };
      expect(response.message).not.toContain('sk-secret');
      expect(response.message.length).toBeGreaterThan(10);
    }
    expect(
      (
        toAnalyzeHttpException(
          new AiProviderError('quota_exceeded', 'x', false),
        ).getResponse() as { message: string }
      ).message,
    ).toBe('OpenAI quota or billing limit reached');
    expect(
      (
        toAnalyzeHttpException(
          new AiProviderError('auth', 'x', false),
        ).getResponse() as {
          message: string;
        }
      ).message,
    ).toBe('OpenAI rejected the API key');
  });
});
