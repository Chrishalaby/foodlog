import { APIConnectionTimeoutError } from 'openai';
import type { Prisma } from '../generated/prisma/client.js';
import { buildUsageRow } from './ai-usage.recorder.js';
import {
  analyzeWithOneRetry,
  type AttemptRecord,
  retryDelayMs,
} from './analysis-attempts.js';
import type {
  AiAnalyzeRequest,
  AiAnalyzeResult,
  AiProvider,
} from './providers/ai-provider.js';
import { AiProviderError } from './providers/ai-provider-error.js';
import { fromOpenAiError } from './providers/openai-errors.js';

const REQUEST: AiAnalyzeRequest = {
  model: 'gpt-5.6-sol',
  images: [],
  prompt: {
    mode: 'text',
    imageRoles: [],
    description: '2 eggs',
    localTime: null,
    mealType: null,
    location: null,
    answeredQuestions: [],
    followUp: null,
  },
};

const USAGE = {
  inputTokens: 2000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 800,
  reasoningTokens: 400,
};

const SUCCESS: AiAnalyzeResult = {
  raw: {
    input_type: 'text',
    meal_name: 'Eggs',
    portion: null,
    scale_cues: 'none',
    items: [],
    label: null,
    assumptions: [],
    follow_up_question: null,
    follow_up_options: [],
  },
  usage: USAGE,
  model: 'gpt-5.6-sol',
  requestId: 'req_ok',
  latencyMs: 10,
  serviceTier: 'default',
};

function serverError(retryAfterMs?: number): AiProviderError {
  return new AiProviderError('server_error', 'boom', true, {
    status: 500,
    requestId: 'req_fail',
    model: 'gpt-5.6-sol',
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

function scriptedProvider(
  outcomes: ReadonlyArray<AiAnalyzeResult | Error>,
): AiProvider & { calls: number } {
  const provider = {
    name: 'openai' as const,
    calls: 0,
    analyze(): Promise<AiAnalyzeResult> {
      const outcome = outcomes[Math.min(provider.calls, outcomes.length - 1)];
      provider.calls += 1;
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome as AiAnalyzeResult);
    },
  };
  return provider;
}

interface Harness {
  records: AttemptRecord[];
  rows: Prisma.AiUsageUncheckedCreateInput[];
  sleeps: number[];
  run: (provider: AiProvider) => Promise<AiAnalyzeResult>;
}

function harness(): Harness {
  const records: AttemptRecord[] = [];
  const rows: Prisma.AiUsageUncheckedCreateInput[] = [];
  const sleeps: number[] = [];
  const context = {
    userId: 'user-1',
    mode: 'text' as const,
    detail: null,
    requestedModel: REQUEST.model,
  };
  return {
    records,
    rows,
    sleeps,
    run: (provider) =>
      analyzeWithOneRetry(provider, REQUEST, {
        onAttempt: (record) => {
          records.push(record);
          rows.push(buildUsageRow(context, record, () => undefined));
          return Promise.resolve();
        },
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      }),
  };
}

describe('analyzeWithOneRetry', () => {
  it('returns the first success without retrying', async () => {
    const h = harness();
    const provider = scriptedProvider([SUCCESS]);

    await expect(h.run(provider)).resolves.toBe(SUCCESS);

    expect(provider.calls).toBe(1);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ attempt: 1, success: true });
    expect(h.sleeps).toEqual([]);
  });

  it('retries a retryable failure once after about a second', async () => {
    const h = harness();
    const provider = scriptedProvider([serverError(), SUCCESS]);

    await expect(h.run(provider)).resolves.toBe(SUCCESS);

    expect(provider.calls).toBe(2);
    expect(h.sleeps).toEqual([1000]);
    expect(
      h.rows.map((row) => [row.attempt, row.success, row.errorKind]),
    ).toEqual([
      [1, false, 'server_error'],
      [2, true, null],
    ]);
  });

  it('makes at most two attempts and records one usage row per attempt', async () => {
    const h = harness();
    const provider = scriptedProvider([serverError(), serverError(), SUCCESS]);

    await expect(h.run(provider)).rejects.toMatchObject({
      kind: 'server_error',
    });

    expect(provider.calls).toBe(2);
    expect(h.rows).toHaveLength(2);
    expect(h.rows.map((row) => row.attempt)).toEqual([1, 2]);
    expect(h.rows.every((row) => row.success === false)).toBe(true);
    expect(h.rows[1]).toMatchObject({
      userId: 'user-1',
      model: 'gpt-5.6-sol',
      mode: 'text',
      errorKind: 'server_error',
      errorMessage: 'boom',
      requestId: 'req_fail',
      costUsd: 0,
    });
  });

  it('does not retry a non-retryable failure', async () => {
    const h = harness();
    const quota = new AiProviderError('quota_exceeded', 'quota', false);
    const provider = scriptedProvider([quota, SUCCESS]);

    await expect(h.run(provider)).rejects.toBe(quota);

    expect(provider.calls).toBe(1);
    expect(h.rows).toHaveLength(1);
  });

  it('never repeats an attempt that timed out and charges it an estimate', async () => {
    const h = harness();
    const provider = scriptedProvider([
      fromOpenAiError(new APIConnectionTimeoutError(), 'gpt-5.6-sol'),
      SUCCESS,
    ]);

    await expect(h.run(provider)).rejects.toMatchObject({ kind: 'timeout' });

    expect(provider.calls).toBe(1);
    expect(h.sleeps).toEqual([]);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ ok: false, attempt: 1 });
    expect(h.rows[0]).toMatchObject({ success: false, errorKind: 'timeout' });
    expect(h.rows[0]?.costUsd).toBeGreaterThan(0);
  });

  it('honours retry-after up to 5 s and gives up beyond it', async () => {
    const quick = harness();
    await quick.run(scriptedProvider([serverError(2500), SUCCESS]));
    expect(quick.sleeps).toEqual([2500]);

    const slow = harness();
    const provider = scriptedProvider([serverError(30_000), SUCCESS]);
    await expect(slow.run(provider)).rejects.toMatchObject({
      kind: 'server_error',
    });
    expect(provider.calls).toBe(1);
    expect(slow.sleeps).toEqual([]);
  });

  it('wraps unexpected provider errors as unknown, non-retryable failures', async () => {
    const h = harness();
    const provider = scriptedProvider([new Error('kaboom'), SUCCESS]);

    await expect(h.run(provider)).rejects.toMatchObject({
      kind: 'unknown',
      retryable: false,
      message: 'kaboom',
    });
    expect(provider.calls).toBe(1);
  });
});

describe('retryDelayMs', () => {
  it('uses the default delay, the server hint, or refuses', () => {
    expect(retryDelayMs(serverError())).toBe(1000);
    expect(retryDelayMs(serverError(5000))).toBe(5000);
    expect(retryDelayMs(serverError(5001))).toBeNull();
    expect(
      retryDelayMs(new AiProviderError('refusal', 'no', false)),
    ).toBeNull();
    expect(retryDelayMs(serverError(), { defaultRetryDelayMs: 5 })).toBe(5);
  });
});
