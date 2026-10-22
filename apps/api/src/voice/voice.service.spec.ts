import { HttpException } from '@nestjs/common';
import type { AiConfigService } from '../ai/ai-config.service.js';
import type { AiUsageRecorder } from '../ai/ai-usage.recorder.js';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import { zeroUsage } from '../ai/providers/ai-provider.js';
import type { StructuredAttemptRecord } from '../ai/providers/structured-attempts.js';
import type { AppConfig } from '../config/app-config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { UsageService } from '../usage/usage.service.js';
import { MOCK_TRANSCRIPT, MockVoiceProvider } from './mock-voice.provider.js';
import type {
  VoiceAiProvider,
  VoiceAudio,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
  VoiceTranscript,
} from './voice-provider.js';
import { VoiceService } from './voice.service.js';

const USER_ID = 'user-1';

const AUDIO: VoiceAudio = {
  buffer: Buffer.from('audio'),
  filename: 'voice.webm',
  mimeType: 'audio/webm',
};

interface Recorded {
  context: Parameters<AiUsageRecorder['record']>[0];
  record: StructuredAttemptRecord<VoiceTranscript>;
  costUsd: number | undefined;
}

interface Budgets {
  global?: boolean;
  user?: boolean;
}

interface HarnessOptions {
  provider?: VoiceAiProvider;
  aiProvider?: 'openai' | 'mock' | 'unconfigured';
  voiceEnabled?: boolean;
  location?: string | null;
  budgets?: Budgets;
  model?: string;
}

function result(
  text: string,
  audioSeconds: number | null,
): VoiceTranscribeResult {
  return {
    raw: { text, audioSeconds },
    usage: zeroUsage(),
    model: 'gpt-transcribe',
    requestId: 'req_1',
    latencyMs: 5,
    serviceTier: null,
  };
}

class ScriptedProvider implements VoiceAiProvider {
  readonly name = 'openai';
  readonly requests: VoiceTranscribeRequest[] = [];

  constructor(
    private readonly script: (VoiceTranscribeResult | AiProviderError)[],
  ) {}

  transcribe(request: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (!next) {
      return Promise.reject(new Error('script exhausted'));
    }
    return next instanceof AiProviderError
      ? Promise.reject(next)
      : Promise.resolve(next);
  }
}

function harness(options: HarnessOptions = {}) {
  const recorded: Recorded[] = [];
  const productQueries: unknown[] = [];
  const entryQueries: unknown[] = [];
  const prisma = {
    profile: {
      findUnique: () => Promise.resolve({ location: options.location ?? null }),
    },
    product: {
      findMany: (query: unknown) => {
        productQueries.push(query);
        return Promise.resolve([
          { name: 'Labneh', brand: 'Khoury' },
          { name: 'Potato bun', brand: 'Sofisoft' },
        ]);
      },
    },
    entry: {
      groupBy: (query: unknown) => {
        entryQueries.push(query);
        return Promise.resolve([
          { name: 'Manakish zaatar', _count: { name: 9 } },
          { name: 'Labneh', _count: { name: 4 } },
        ]);
      },
    },
  } as unknown as PrismaService;
  const config = {
    ai: { transcribeModel: options.model ?? 'gpt-transcribe' },
  } as unknown as AppConfig;
  const aiConfig = {
    provider: options.aiProvider ?? 'openai',
    voiceEnabled: options.voiceEnabled ?? true,
  } as unknown as AiConfigService;
  const usage = {
    isMonthlyBudgetReached: () =>
      Promise.resolve(options.budgets?.global ?? false),
    isUserBudgetReached: (userId: string) =>
      Promise.resolve(userId === USER_ID && (options.budgets?.user ?? false)),
  } as unknown as UsageService;
  const recorder = {
    record: (
      context: Recorded['context'],
      record: StructuredAttemptRecord<VoiceTranscript>,
      costUsd?: number,
    ) => {
      recorded.push({ context, record, costUsd });
      return Promise.resolve({ id: `usage-${recorded.length}` });
    },
  } as unknown as AiUsageRecorder;
  const provider =
    options.provider ?? new ScriptedProvider([result(' 2 eggs ', 30)]);
  const service = new VoiceService(
    prisma,
    config,
    aiConfig,
    usage,
    recorder,
    provider,
  );
  return { service, recorded, productQueries, entryQueries, provider };
}

async function failureOf(promise: Promise<unknown>): Promise<HttpException> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

describe('VoiceService', () => {
  it('transcribes with the configured model and the user vocabulary, then trims the text', async () => {
    const provider = new ScriptedProvider([
      result('  2 eggs and labneh \n', 30),
    ]);
    const { service, recorded, productQueries, entryQueries } = harness({
      provider,
      location: 'Beirut, Lebanon',
    });

    await expect(service.transcribe(USER_ID, AUDIO)).resolves.toEqual({
      text: '2 eggs and labneh',
    });

    expect(provider.requests).toEqual([
      {
        model: 'gpt-transcribe',
        audio: AUDIO,
        vocabulary: [
          'Khoury',
          'Labneh',
          'Sofisoft',
          'Potato bun',
          'Manakish zaatar',
        ],
        location: 'Beirut, Lebanon',
      },
    ]);
    expect(productQueries).toEqual([
      expect.objectContaining({ where: { userId: USER_ID }, take: 40 }),
    ]);
    expect(entryQueries).toEqual([
      expect.objectContaining({
        by: ['name'],
        take: 20,
        where: {
          userId: USER_ID,
          timestamp: { gte: expect.any(Date) as Date },
        },
      }),
    ]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.context).toEqual({
      userId: USER_ID,
      mode: 'voice',
      detail: null,
      requestedModel: 'gpt-transcribe',
    });
    expect(recorded[0]?.record).toMatchObject({ attempt: 1, ok: true });
    expect(recorded[0]?.costUsd).toBeCloseTo((30 / 60) * 0.0045, 6);
  });

  it('returns an empty text for silence', async () => {
    const { service } = harness({
      provider: new ScriptedProvider([result('   ', 4)]),
    });

    await expect(service.transcribe(USER_ID, AUDIO)).resolves.toEqual({
      text: '',
    });
  });

  it('works with the mock provider at zero cost', async () => {
    const { service, recorded } = harness({
      aiProvider: 'mock',
      provider: new MockVoiceProvider({ latencyMs: 0 }),
    });

    await expect(service.transcribe(USER_ID, AUDIO)).resolves.toEqual({
      text: MOCK_TRANSCRIPT,
    });
    expect(recorded.map(({ costUsd }) => costUsd)).toEqual([0]);
  });

  it('answers 503 without calling the provider when AI is not configured', async () => {
    const { service, recorded, provider } = harness({
      aiProvider: 'unconfigured',
    });

    const error = await failureOf(service.transcribe(USER_ID, AUDIO));

    expect(error.getStatus()).toBe(503);
    expect(error.message).toBe('AI is not configured — set OPENAI_API_KEY');
    expect((provider as ScriptedProvider).requests).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it('answers 503 without calling the provider when voice is turned off', async () => {
    const { service, recorded, provider } = harness({ voiceEnabled: false });

    const error = await failureOf(service.transcribe(USER_ID, AUDIO));

    expect(error.getStatus()).toBe(503);
    expect(error.message).toBe(
      'Voice dictation is not configured on this server',
    );
    expect((provider as ScriptedProvider).requests).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it('answers 429 when the global monthly budget is reached', async () => {
    const { service, recorded } = harness({ budgets: { global: true } });

    const error = await failureOf(service.transcribe(USER_ID, AUDIO));

    expect(error.getStatus()).toBe(429);
    expect(error.message).toBe('Monthly AI budget reached');
    expect(recorded).toHaveLength(0);
  });

  it('answers 429 when the user’s own monthly budget is reached', async () => {
    const { service, recorded } = harness({ budgets: { user: true } });

    const error = await failureOf(service.transcribe(USER_ID, AUDIO));

    expect(error.getStatus()).toBe(429);
    expect(error.message).toBe('Your monthly AI budget is used up');
    expect(recorded).toHaveLength(0);
  });

  it('retries a retryable failure once and records both attempts', async () => {
    const provider = new ScriptedProvider([
      new AiProviderError('server_error', 'boom', true, { retryAfterMs: 1 }),
      result('fattoush', 12),
    ]);
    const { service, recorded } = harness({ provider });

    await expect(service.transcribe(USER_ID, AUDIO)).resolves.toEqual({
      text: 'fattoush',
    });

    expect(provider.requests).toHaveLength(2);
    expect(recorded.map(({ record }) => [record.attempt, record.ok])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(recorded[0]?.costUsd).toBe(0);
    expect(recorded[1]?.costUsd).toBeCloseTo((12 / 60) * 0.0045, 6);
  });

  it('gives up after the second failure with the mapped HTTP error', async () => {
    const provider = new ScriptedProvider([
      new AiProviderError('server_error', 'boom', true, { retryAfterMs: 1 }),
      new AiProviderError('server_error', 'boom', true, { retryAfterMs: 1 }),
    ]);
    const { service, recorded } = harness({ provider });

    const error = await failureOf(service.transcribe(USER_ID, AUDIO));

    expect(error.getStatus()).toBe(502);
    expect(provider.requests).toHaveLength(2);
    expect(recorded).toHaveLength(2);
  });

  it('does not retry a timeout and bills it conservatively', async () => {
    const provider = new ScriptedProvider([
      new AiProviderError('timeout', 'Request timed out.', false),
    ]);
    const { service, recorded } = harness({ provider });

    const error = await failureOf(service.transcribe(USER_ID, AUDIO));

    expect(error.getStatus()).toBe(504);
    expect(provider.requests).toHaveLength(1);
    expect(recorded[0]?.costUsd).toBeCloseTo((180 / 60) * 0.0045, 6);
  });

  it('maps a quota failure to 503 without retrying', async () => {
    const provider = new ScriptedProvider([
      new AiProviderError('quota_exceeded', 'no credit', false),
    ]);
    const { service, recorded } = harness({ provider });

    const error = await failureOf(service.transcribe(USER_ID, AUDIO));

    expect(error.getStatus()).toBe(503);
    expect(recorded).toHaveLength(1);
  });
});
