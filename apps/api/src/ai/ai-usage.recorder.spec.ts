import {
  attemptCostUsd,
  buildUsageRow,
  timeoutUsageEstimate,
} from './ai-usage.recorder.js';
import type { AttemptRecord } from './analysis-attempts.js';
import { TYPICAL_REQUEST_TOKENS } from './models.js';
import { AiProviderError } from './providers/ai-provider-error.js';
import { DEFAULT_MAX_OUTPUT_TOKENS } from './providers/openai.provider.js';

const USAGE = {
  inputTokens: 2800,
  cachedInputTokens: 1000,
  cacheWriteTokens: 200,
  outputTokens: 1500,
  reasoningTokens: 600,
};

const STANDARD_SOL_COST = (1600 * 4 + 1000 * 0.4 + 200 * 5 + 1500 * 20) / 1e6;

const CONTEXT = {
  userId: 'user-1',
  mode: 'food_photo' as const,
  detail: 'high',
  requestedModel: 'gpt-5.6-sol',
};

describe('attemptCostUsd', () => {
  const noWarning = (): void => {
    throw new Error('unexpected warning');
  };

  it('prices uncached, cached, cache-write and output tokens', () => {
    expect(
      attemptCostUsd('gpt-5.6-sol', USAGE, 'default', noWarning),
    ).toBeCloseTo(STANDARD_SOL_COST, 6);
    expect(
      attemptCostUsd('gpt-5.6-sol-2026-07-09', USAGE, null, noWarning),
    ).toBeCloseTo(STANDARD_SOL_COST, 6);
  });

  it('applies the fast-tier multiplier for fast/priority responses', () => {
    expect(
      attemptCostUsd('gpt-5.6-sol', USAGE, 'priority', noWarning),
    ).toBeCloseTo(STANDARD_SOL_COST * 2, 6);
    expect(attemptCostUsd('gpt-5.5', USAGE, 'fast', noWarning)).toBeCloseTo(
      ((1600 * 5 + 1000 * 0.5 + 200 * 5 + 1500 * 30) / 1e6) * 2.5,
      6,
    );
    expect(attemptCostUsd('gpt-6-sol', USAGE, 'flex', noWarning)).toBeCloseTo(
      ((1600 * 2 + 1000 * 0.2 + 200 * 2.5 + 1500 * 10) / 1e6) * 0.5,
      6,
    );
  });

  it('charges nothing for the mock provider', () => {
    expect(attemptCostUsd('mock', USAGE, null, noWarning)).toBe(0);
  });

  it('prices Claude models from the catalog and ignores service tiers', () => {
    expect(
      attemptCostUsd('claude-sonnet-5-5', USAGE, null, noWarning),
    ).toBeCloseTo((1600 * 2 + 1000 * 0.2 + 200 * 2.5 + 1500 * 10) / 1e6, 6);
    expect(
      attemptCostUsd('claude-opus-5-5', USAGE, 'priority', noWarning),
    ).toBeCloseTo((1600 * 4 + 1000 * 0.2 + 200 * 5 + 1500 * 20) / 1e6, 6);
  });

  it('records Claude models without a known price as free and warns', () => {
    const warnings: string[] = [];
    expect(
      attemptCostUsd('claude-sonnet-4-5', USAGE, null, (model) =>
        warnings.push(model),
      ),
    ).toBe(0);
    expect(warnings).toEqual(['claude-sonnet-4-5']);
  });

  it('records unknown models as free and warns', () => {
    const warnings: string[] = [];
    expect(
      attemptCostUsd('gpt-9-mystery', USAGE, null, (model) =>
        warnings.push(model),
      ),
    ).toBe(0);
    expect(warnings).toEqual(['gpt-9-mystery']);
  });
});

describe('buildUsageRow', () => {
  it('records a successful attempt with the canonical model and its cost', () => {
    const record: AttemptRecord = {
      attempt: 1,
      durationMs: 4321,
      ok: true,
      result: {
        raw: {
          input_type: 'food_photo',
          meal_name: 'x',
          portion: null,
          scale_cues: '',
          items: [],
          label: null,
          assumptions: [],
          follow_up_question: null,
          follow_up_options: [],
        },
        usage: USAGE,
        model: 'gpt-5.6-sol-2026-07-09',
        requestId: 'req_1',
        latencyMs: 4300,
        serviceTier: 'default',
      },
    };
    const row = buildUsageRow(CONTEXT, record, () => undefined);
    expect(row).toEqual({
      userId: 'user-1',
      model: 'gpt-5.6-sol',
      mode: 'food_photo',
      detail: 'high',
      attempt: 1,
      ...USAGE,
      costUsd: expect.closeTo(STANDARD_SOL_COST, 6) as number,
      durationMs: 4321,
      success: true,
      errorKind: null,
      errorMessage: null,
      requestId: 'req_1',
    });
  });

  it('charges failed attempts for the tokens they consumed', () => {
    const record: AttemptRecord = {
      attempt: 2,
      durationMs: 900,
      ok: false,
      error: new AiProviderError('invalid_output', 'x'.repeat(900), true, {
        usage: USAGE,
        model: 'gpt-5.6-sol',
        requestId: 'req_2',
      }),
    };
    const row = buildUsageRow(CONTEXT, record, () => undefined);
    expect(row).toMatchObject({
      attempt: 2,
      success: false,
      errorKind: 'invalid_output',
      requestId: 'req_2',
      inputTokens: 2800,
    });
    expect(row.costUsd).toBeCloseTo(STANDARD_SOL_COST, 6);
    expect(row.errorMessage).toHaveLength(500);
  });

  it('charges a timed-out attempt a conservative estimate while keeping its real token counts', () => {
    const record: AttemptRecord = {
      attempt: 1,
      durationMs: 90_000,
      ok: false,
      error: new AiProviderError('timeout', 'Request timed out.', false),
    };
    const row = buildUsageRow(CONTEXT, record, () => undefined);

    expect(row).toMatchObject({
      model: 'gpt-5.6-sol',
      inputTokens: 0,
      outputTokens: 0,
      success: false,
      errorKind: 'timeout',
      requestId: null,
    });
    expect(row.costUsd).toBeCloseTo((2800 * 4 + 16_000 * 20) / 1e6, 6);
    expect(timeoutUsageEstimate()).toEqual({
      inputTokens: TYPICAL_REQUEST_TOKENS.input,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      reasoningTokens: 0,
    });
  });

  it('prices the timeout estimate for the requested precise model', () => {
    const record: AttemptRecord = {
      attempt: 1,
      durationMs: 90_000,
      ok: false,
      error: new AiProviderError('timeout', 'Request timed out.', false),
    };
    const row = buildUsageRow(
      { ...CONTEXT, requestedModel: 'gpt-6-astra' },
      record,
      () => undefined,
    );

    expect(row.model).toBe('gpt-6-astra');
    expect(row.costUsd).toBeCloseTo((2800 * 10 + 16_000 * 50) / 1e6, 6);
  });

  it('prices a timeout that did report usage from that usage', () => {
    const record: AttemptRecord = {
      attempt: 1,
      durationMs: 90_000,
      ok: false,
      error: new AiProviderError('timeout', 'Request timed out.', false, {
        usage: USAGE,
        model: 'gpt-5.6-sol',
      }),
    };

    expect(buildUsageRow(CONTEXT, record, () => undefined).costUsd).toBeCloseTo(
      STANDARD_SOL_COST,
      6,
    );
  });

  it('falls back to the requested model and zero cost for connection errors without usage', () => {
    const record: AttemptRecord = {
      attempt: 1,
      durationMs: 300,
      ok: false,
      error: new AiProviderError('connection', 'Connection error.', true),
    };
    expect(buildUsageRow(CONTEXT, record, () => undefined)).toMatchObject({
      model: 'gpt-5.6-sol',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      requestId: null,
    });
  });

  it('charges nothing for timeouts of the mock and warns for unknown models', () => {
    const timeout = (): AttemptRecord => ({
      attempt: 1,
      durationMs: 90_000,
      ok: false,
      error: new AiProviderError('timeout', 'Request timed out.', false),
    });
    const warnings: string[] = [];

    expect(
      buildUsageRow({ ...CONTEXT, requestedModel: 'mock' }, timeout(), () =>
        warnings.push('mock'),
      ).costUsd,
    ).toBe(0);
    expect(
      buildUsageRow(
        { ...CONTEXT, requestedModel: 'gpt-9-mystery' },
        timeout(),
        (model) => warnings.push(model),
      ).costUsd,
    ).toBe(0);
    expect(warnings).toEqual(['gpt-9-mystery']);
  });
});
