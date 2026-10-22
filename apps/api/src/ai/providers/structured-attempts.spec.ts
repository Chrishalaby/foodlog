import type { AiStructuredResult } from './ai-provider.js';
import { AiProviderError } from './ai-provider-error.js';
import {
  callWithOneRetry,
  type StructuredAttemptRecord,
} from './structured-attempts.js';

type Menu = { dishes: string[] };

const SUCCESS: AiStructuredResult<Menu> = {
  raw: { dishes: ['Falafel wrap'] },
  usage: {
    inputTokens: 1000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 300,
    reasoningTokens: 100,
  },
  model: 'gpt-5.6-sol',
  requestId: 'req_ok',
  latencyMs: 5,
  serviceTier: 'default',
};

function failure(retryable: boolean, retryAfterMs?: number): AiProviderError {
  return new AiProviderError('server_error', 'boom', retryable, {
    model: 'gpt-5.6-sol',
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

function scripted(outcomes: ReadonlyArray<AiStructuredResult<Menu> | Error>): {
  call: () => Promise<AiStructuredResult<Menu>>;
  calls: () => number;
} {
  let calls = 0;
  return {
    call: () => {
      const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
      calls += 1;
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome as AiStructuredResult<Menu>);
    },
    calls: () => calls,
  };
}

async function run(outcomes: ReadonlyArray<AiStructuredResult<Menu> | Error>) {
  const records: StructuredAttemptRecord<Menu>[] = [];
  const sleeps: number[] = [];
  const script = scripted(outcomes);
  const outcome = await callWithOneRetry(script.call, {
    onAttempt: (record) => {
      records.push(record);
      return Promise.resolve();
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  }).then(
    (result) => ({ result, error: null }),
    (error: unknown) => ({ result: null, error }),
  );
  return { ...outcome, records, sleeps, calls: script.calls() };
}

describe('callWithOneRetry', () => {
  it('returns the first success after recording one attempt', async () => {
    const { result, records, calls } = await run([SUCCESS]);

    expect(result).toBe(SUCCESS);
    expect(calls).toBe(1);
    expect(records).toMatchObject([{ attempt: 1, ok: true, result: SUCCESS }]);
  });

  it('retries a retryable failure exactly once after the advised delay', async () => {
    const { result, records, sleeps, calls } = await run([
      failure(true, 250),
      SUCCESS,
    ]);

    expect(result).toBe(SUCCESS);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([250]);
    expect(records.map((r) => [r.attempt, r.ok])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('gives up after the second failure and throws it', async () => {
    const second = failure(true);
    const { error, records, calls } = await run([failure(true), second]);

    expect(error).toBe(second);
    expect(calls).toBe(2);
    expect(records).toHaveLength(2);
  });

  it('does not retry non-retryable failures or long retry-after waits', async () => {
    const fatal = await run([failure(false), SUCCESS]);
    const slow = await run([failure(true, 60_000), SUCCESS]);

    expect(fatal.calls).toBe(1);
    expect(fatal.error).toMatchObject({ kind: 'server_error' });
    expect(slow.calls).toBe(1);
    expect(slow.sleeps).toEqual([]);
  });

  it('wraps unexpected errors as unknown, non-retryable provider errors', async () => {
    const { error, records } = await run([new TypeError('kaboom')]);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ kind: 'unknown', retryable: false });
    expect(records[0]).toMatchObject({ ok: false, attempt: 1 });
  });
});
