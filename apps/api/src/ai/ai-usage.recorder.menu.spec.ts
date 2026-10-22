import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type AttemptContext,
  AiUsageRecorder,
  buildUsageRow,
  timeoutUsageEstimate,
  USAGE_ERROR_MESSAGE_MAX,
} from './ai-usage.recorder.js';
import { AiProviderError } from './providers/ai-provider-error.js';
import type { StructuredAttemptRecord } from './providers/structured-attempts.js';

const USAGE = {
  inputTokens: 2800,
  cachedInputTokens: 1000,
  cacheWriteTokens: 200,
  outputTokens: 1500,
  reasoningTokens: 600,
};

const STANDARD_SOL_COST = (1600 * 4 + 1000 * 0.4 + 200 * 5 + 1500 * 20) / 1e6;

const MENU_CONTEXT: AttemptContext = {
  userId: 'user-1',
  mode: 'menu',
  detail: 'high',
  requestedModel: 'gpt-5.6-sol',
};

const MENU_SUCCESS: StructuredAttemptRecord<{ dishes: string[] }> = {
  attempt: 1,
  durationMs: 4321,
  ok: true,
  result: {
    raw: { dishes: ['Falafel wrap'] },
    usage: USAGE,
    model: 'gpt-5.6-sol-2026-07-09',
    requestId: 'req_1',
    latencyMs: 4300,
    serviceTier: 'default',
  },
};

const noWarning = (): void => {
  throw new Error('unexpected warning');
};

describe('buildUsageRow for menu scans', () => {
  it('records a successful menu attempt with mode menu and its cost', () => {
    expect(buildUsageRow(MENU_CONTEXT, MENU_SUCCESS, noWarning)).toEqual({
      userId: 'user-1',
      model: 'gpt-5.6-sol',
      mode: 'menu',
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

  it('charges a failed attempt for its tokens and truncates the message', () => {
    const record: StructuredAttemptRecord<unknown> = {
      attempt: 2,
      durationMs: 900,
      ok: false,
      error: new AiProviderError('invalid_output', 'x'.repeat(900), true, {
        usage: USAGE,
        model: 'gpt-5.6-sol',
        requestId: 'req_2',
      }),
    };

    const row = buildUsageRow(MENU_CONTEXT, record, noWarning);

    expect(row).toMatchObject({
      mode: 'menu',
      attempt: 2,
      success: false,
      errorKind: 'invalid_output',
      requestId: 'req_2',
      outputTokens: 1500,
    });
    expect(row.costUsd).toBeCloseTo(STANDARD_SOL_COST, 6);
    expect(row.errorMessage).toHaveLength(USAGE_ERROR_MESSAGE_MAX);
  });

  it('bills a timeout without usage at the typical-request estimate', () => {
    const record: StructuredAttemptRecord<unknown> = {
      attempt: 1,
      durationMs: 90_000,
      ok: false,
      error: new AiProviderError('timeout', 'timed out', false, {
        model: 'gpt-5.6-sol',
      }),
    };

    const row = buildUsageRow(MENU_CONTEXT, record, noWarning);
    const estimate = buildUsageRow(
      MENU_CONTEXT,
      {
        ...MENU_SUCCESS,
        result: {
          ...MENU_SUCCESS.result,
          model: 'gpt-5.6-sol',
          usage: timeoutUsageEstimate(),
        },
      },
      noWarning,
    );

    expect(row.inputTokens).toBe(0);
    expect(row.costUsd).toBeGreaterThan(0);
    expect(row.costUsd).toBe(estimate.costUsd);
  });

  it('falls back to the requested model and warns about unknown prices', () => {
    const warnings: string[] = [];
    const record: StructuredAttemptRecord<unknown> = {
      attempt: 1,
      durationMs: 10,
      ok: false,
      error: new AiProviderError('connection', 'offline', true),
    };

    const unknown = buildUsageRow(
      { ...MENU_CONTEXT, requestedModel: 'gpt-9-mystery' },
      { ...MENU_SUCCESS, result: { ...MENU_SUCCESS.result, model: '' } },
      (model) => warnings.push(model),
    );
    const offline = buildUsageRow(MENU_CONTEXT, record, noWarning);

    expect(unknown).toMatchObject({ model: 'gpt-9-mystery', costUsd: 0 });
    expect(warnings).toEqual(['gpt-9-mystery']);
    expect(offline).toMatchObject({
      model: 'gpt-5.6-sol',
      inputTokens: 0,
      costUsd: 0,
      requestId: null,
    });
  });
});

describe('AiUsageRecorder for menu scans', () => {
  it('stores the row and returns what was recorded', async () => {
    const created: Prisma.AiUsageUncheckedCreateInput[] = [];
    const prisma = {
      aiUsage: {
        create: ({ data }: { data: Prisma.AiUsageUncheckedCreateInput }) => {
          created.push(data);
          return Promise.resolve({ ...data, id: 'usage-1' });
        },
      },
    } as unknown as PrismaService;
    const recorder = new AiUsageRecorder(prisma);

    const recorded = await recorder.record(MENU_CONTEXT, MENU_SUCCESS);

    expect(created).toHaveLength(1);
    expect(created[0]?.mode).toBe('menu');
    expect(recorded).toEqual({
      id: 'usage-1',
      model: 'gpt-5.6-sol',
      usage: USAGE,
      costUsd: expect.closeTo(STANDARD_SOL_COST, 6) as number,
      durationMs: 4321,
      success: true,
    });
  });
});
