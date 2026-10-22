import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type AttemptContext,
  AiUsageRecorder,
  buildUsageRow,
} from './ai-usage.recorder.js';
import { AiProviderError } from './providers/ai-provider-error.js';
import { zeroUsage } from './providers/ai-provider.js';
import type { StructuredAttemptRecord } from './providers/structured-attempts.js';

interface Transcript {
  text: string;
  audioSeconds: number | null;
}

const VOICE_CONTEXT: AttemptContext = {
  userId: 'user-1',
  mode: 'voice',
  detail: null,
  requestedModel: 'gpt-transcribe',
};

const VOICE_SUCCESS: StructuredAttemptRecord<Transcript> = {
  attempt: 1,
  durationMs: 1800,
  ok: true,
  result: {
    raw: { text: '2 eggs', audioSeconds: 40 },
    usage: zeroUsage(),
    model: 'gpt-transcribe',
    requestId: 'req_voice_1',
    latencyMs: 1790,
    serviceTier: null,
  },
};

const noWarning = (): void => {
  throw new Error('unexpected warning');
};

describe('buildUsageRow for voice transcriptions', () => {
  it('stores the explicit cost of a duration-billed attempt without consulting token prices', () => {
    expect(
      buildUsageRow(VOICE_CONTEXT, VOICE_SUCCESS, noWarning, 0.003),
    ).toEqual({
      userId: 'user-1',
      model: 'gpt-transcribe',
      mode: 'voice',
      detail: null,
      attempt: 1,
      ...zeroUsage(),
      costUsd: 0.003,
      durationMs: 1800,
      success: true,
      errorKind: null,
      errorMessage: null,
      requestId: 'req_voice_1',
    });
  });

  it('stores an explicit zero cost for a failed attempt', () => {
    const record: StructuredAttemptRecord<Transcript> = {
      attempt: 2,
      durationMs: 400,
      ok: false,
      error: new AiProviderError('server_error', 'boom', true, {
        model: 'gpt-transcribe',
        requestId: 'req_voice_2',
      }),
    };

    expect(buildUsageRow(VOICE_CONTEXT, record, noWarning, 0)).toMatchObject({
      mode: 'voice',
      attempt: 2,
      success: false,
      errorKind: 'server_error',
      costUsd: 0,
      requestId: 'req_voice_2',
    });
  });

  it('still prices from tokens when no explicit cost is given', () => {
    const warnings: string[] = [];

    const row = buildUsageRow(VOICE_CONTEXT, VOICE_SUCCESS, (model) =>
      warnings.push(model),
    );

    expect(row.costUsd).toBe(0);
    expect(warnings).toEqual(['gpt-transcribe']);
  });
});

describe('AiUsageRecorder for voice transcriptions', () => {
  it('stores the row with the explicit cost and returns what was recorded', async () => {
    const created: Prisma.AiUsageUncheckedCreateInput[] = [];
    const prisma = {
      aiUsage: {
        create: ({ data }: { data: Prisma.AiUsageUncheckedCreateInput }) => {
          created.push(data);
          return Promise.resolve({ ...data, id: 'usage-voice-1' });
        },
      },
    } as unknown as PrismaService;
    const recorder = new AiUsageRecorder(prisma);

    const recorded = await recorder.record(VOICE_CONTEXT, VOICE_SUCCESS, 0.003);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ mode: 'voice', costUsd: 0.003 });
    expect(recorded).toEqual({
      id: 'usage-voice-1',
      model: 'gpt-transcribe',
      usage: zeroUsage(),
      costUsd: 0.003,
      durationMs: 1800,
      success: true,
    });
  });
});
