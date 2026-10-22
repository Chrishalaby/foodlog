import type { ApiError, TranscribeResponse } from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import {
  type AiFailureKind,
  AiProviderError,
} from '../src/ai/providers/ai-provider-error.js';
import { AppConfig } from '../src/config/app-config.js';
import { aiRateLimits } from '../src/config/rate-limits.js';
import { type AiSettings, parseSettings } from '../src/config/settings.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  MOCK_TRANSCRIPT,
  MockVoiceProvider,
} from '../src/voice/mock-voice.provider.js';
import {
  VOICE_AI_PROVIDER,
  type VoiceAiProvider,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from '../src/voice/voice-provider.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const TRANSCRIBE_PATH = '/api/transcribe';
const AUDIO = Buffer.alloc(4096, 7);

function transcribe(
  agent: TestAgent,
  contentType = 'audio/webm;codecs=opus',
  audio: Buffer = AUDIO,
  field = 'audio',
): request.Test {
  return agent
    .post(TRANSCRIBE_PATH)
    .attach(field, audio, { filename: 'voice.webm', contentType });
}

function withAiSettings(
  overrides: Partial<AiSettings>,
): (builder: TestingModuleBuilder) => TestingModuleBuilder {
  const settings = parseSettings(process.env);
  const config = new AppConfig({
    ...settings,
    ai: { ...settings.ai, ...overrides },
  });
  return (builder) => builder.overrideProvider(AppConfig).useValue(config);
}

function withVoiceProvider(
  provider: VoiceAiProvider,
): (builder: TestingModuleBuilder) => TestingModuleBuilder {
  return (builder) =>
    builder.overrideProvider(VOICE_AI_PROVIDER).useValue(provider);
}

class CapturingVoiceProvider implements VoiceAiProvider {
  readonly name = 'mock';
  readonly requests: VoiceTranscribeRequest[] = [];
  private readonly mock = new MockVoiceProvider({ latencyMs: 0 });

  transcribe(request: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
    this.requests.push(request);
    return this.mock.transcribe(request);
  }
}

class FailingVoiceProvider implements VoiceAiProvider {
  readonly name = 'openai';
  calls = 0;

  constructor(
    private readonly kind: AiFailureKind,
    private readonly retryable: boolean,
  ) {}

  transcribe(): Promise<VoiceTranscribeResult> {
    this.calls += 1;
    return Promise.reject(
      new AiProviderError(this.kind, `simulated ${this.kind}`, this.retryable, {
        model: 'gpt-transcribe',
        retryAfterMs: 1,
        requestId: `req_voice_${this.calls}`,
      }),
    );
  }
}

describe('voice transcription (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
  });

  beforeEach(async () => {
    await prisma.aiUsage.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('returns the mock transcript and records one voice usage row', async () => {
    const response = await transcribe(agent).expect(200);

    expect(response.body as TranscribeResponse).toEqual({
      text: MOCK_TRANSCRIPT,
    });
    expect(await prisma.analysis.count()).toBe(0);
    expect(await prisma.photo.count()).toBe(0);
    const usages = await prisma.aiUsage.findMany();
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      mode: 'voice',
      model: 'mock',
      detail: null,
      attempt: 1,
      analysisId: null,
      success: true,
      costUsd: 0,
    });
  });

  it.each(['audio/mp4', 'audio/x-m4a', 'video/mp4', 'video/webm'])(
    'accepts %s recordings',
    async (contentType) => {
      await transcribe(agent, contentType).expect(200);
    },
  );

  it('rejects a missing, empty or non-audio upload before calling the AI', async () => {
    const missing = await agent.post(TRANSCRIBE_PATH).expect(400);
    expect((missing.body as ApiError).message).toBe(
      'Record something to transcribe',
    );
    await transcribe(agent, 'audio/webm', Buffer.alloc(0)).expect(400);

    const image = await transcribe(agent, 'image/jpeg').expect(400);
    expect((image.body as ApiError).message).toBe(
      'Unsupported audio type — record again or type your description',
    );
    await transcribe(agent, 'video/quicktime').expect(400);
    await transcribe(agent, 'audio/webm', AUDIO, 'file').expect(400);

    expect(await prisma.aiUsage.count()).toBe(0);
  });

  it('rejects recordings above the upload limit with 413', async () => {
    await transcribe(
      agent,
      'audio/webm',
      Buffer.alloc(10 * 1024 * 1024 + 1, 1),
    ).expect(413);
    expect(await prisma.aiUsage.count()).toBe(0);
  });

  it('shows voice rows in the usage summary', async () => {
    await transcribe(agent).expect(200);

    const response = await agent.get('/api/usage').expect(200);
    const recent = (response.body as { recent: { mode: string }[] }).recent;

    expect(recent.map(({ mode }) => mode)).toEqual(['voice']);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(TRANSCRIBE_PATH)
      .attach('audio', AUDIO, {
        filename: 'voice.webm',
        contentType: 'audio/webm',
      })
      .expect(401);
  });
});

describe('voice transcription limits and failures (e2e)', () => {
  let prismaForReset: PrismaService | undefined;

  async function startApp(
    configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
    throttling = false,
  ): Promise<{
    app: NestExpressApplication;
    prisma: PrismaService;
    agent: TestAgent;
  }> {
    const app = await createTestApp({ configure, throttling });
    const prisma = app.get(PrismaService);
    prismaForReset = prisma;
    await resetDatabase(prisma);
    const agent = await setupAndLogin(app);
    return { app, prisma, agent };
  }

  afterAll(async () => {
    if (prismaForReset) {
      await resetDatabase(prismaForReset);
    }
  });

  it('returns 429 once the global monthly budget is used up', async () => {
    const { app, prisma, agent } = await startApp(
      withAiSettings({ monthlyBudgetUsd: 0.05 }),
    );
    try {
      await prisma.aiUsage.create({
        data: {
          userId: (await getTestUser(app)).id,
          model: 'gpt-5.6-sol',
          mode: 'food_photo',
          costUsd: 0.06,
          success: true,
        },
      });

      const response = await transcribe(agent).expect(429);

      expect((response.body as ApiError).message).toBe(
        'Monthly AI budget reached',
      );
      expect(await prisma.aiUsage.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('returns 429 once a member’s own budget is used up, counting voice rows', async () => {
    const { app, prisma, agent } = await startApp(
      withAiSettings({ memberMonthlyBudgetUsd: 0.5 }),
    );
    try {
      const member = await createSignedInUser(app);
      await transcribe(member.agent).expect(200);
      await prisma.aiUsage.updateMany({
        where: { userId: member.user.id, mode: 'voice' },
        data: { costUsd: 0.5 },
      });

      const response = await transcribe(member.agent).expect(429);

      expect((response.body as ApiError).message).toBe(
        'Your monthly AI budget is used up',
      );
      await transcribe(agent).expect(200);
    } finally {
      await app.close();
    }
  });

  it('returns 503 when OpenAI is selected without an API key', async () => {
    const { app, agent } = await startApp(
      withAiSettings({ provider: 'openai', apiKey: null }),
    );
    try {
      const response = await transcribe(agent).expect(503);
      expect((response.body as ApiError).message).toBe(
        'AI is not configured — an admin can add a provider in Settings → AI',
      );
    } finally {
      await app.close();
    }
  });

  it('retries a retryable failure once and records both voice attempts', async () => {
    const provider = new FailingVoiceProvider('server_error', true);
    const { app, prisma, agent } = await startApp(withVoiceProvider(provider));
    try {
      await transcribe(agent).expect(502);

      expect(provider.calls).toBe(2);
      const usages = await prisma.aiUsage.findMany({
        orderBy: { attempt: 'asc' },
      });
      expect(
        usages.map((u) => [
          u.mode,
          u.model,
          u.attempt,
          u.success,
          u.errorKind,
          u.requestId,
          u.costUsd,
        ]),
      ).toEqual([
        ['voice', 'gpt-transcribe', 1, false, 'server_error', 'req_voice_1', 0],
        ['voice', 'gpt-transcribe', 2, false, 'server_error', 'req_voice_2', 0],
      ]);
    } finally {
      await app.close();
    }
  });

  it('does not retry a quota failure and maps it to 503', async () => {
    const provider = new FailingVoiceProvider('quota_exceeded', false);
    const { app, prisma, agent } = await startApp(withVoiceProvider(provider));
    try {
      await transcribe(agent).expect(503);
      expect(provider.calls).toBe(1);
      expect(await prisma.aiUsage.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('sends the configured model, a normalized file and only the caller’s vocabulary', async () => {
    const provider = new CapturingVoiceProvider();
    const { app, prisma, agent } = await startApp(withVoiceProvider(provider));
    try {
      const owner = await getTestUser(app);
      const member = await createSignedInUser(app);
      const now = new Date();
      await prisma.product.createMany({
        data: [
          {
            userId: owner.id,
            name: 'Labneh',
            brand: 'Khoury',
            source: 'manual',
            useCount: 9,
          },
          {
            userId: owner.id,
            name: 'Potato bun',
            brand: 'Sofisoft',
            source: 'manual',
            useCount: 3,
          },
          {
            userId: member.user.id,
            name: 'Secret snack',
            brand: 'Hidden',
            source: 'manual',
            useCount: 50,
          },
        ],
      });
      await prisma.entry.createMany({
        data: [
          { name: 'Manakish zaatar', userId: owner.id },
          { name: 'Manakish zaatar', userId: owner.id },
          { name: 'Fattoush', userId: owner.id },
          { name: 'Private dinner', userId: member.user.id },
        ].map((entry) => ({
          ...entry,
          mealType: 'lunch' as const,
          source: 'manual' as const,
          timestamp: now,
          localDate: now.toISOString().slice(0, 10),
        })),
      });

      await transcribe(agent, 'video/mp4').expect(200);

      const [sent] = provider.requests;
      expect(sent?.model).toBe('gpt-transcribe');
      expect(sent?.audio).toMatchObject({
        filename: 'voice.m4a',
        mimeType: 'audio/mp4',
      });
      expect(sent?.audio.buffer.equals(AUDIO)).toBe(true);
      expect(sent?.vocabulary).toEqual([
        'Khoury',
        'Labneh',
        'Sofisoft',
        'Potato bun',
        'Manakish zaatar',
        'Fattoush',
      ]);
    } finally {
      await app.close();
    }
  });

  it('gives dictation its own rate limit at twice the AI limit', async () => {
    const { perMinute } = aiRateLimits();
    const { app, agent } = await startApp(undefined, true);
    try {
      const member = await createSignedInUser(app);
      for (let i = 0; i < perMinute * 2; i += 1) {
        await transcribe(agent).expect(200);
      }
      const limited = await transcribe(agent).expect(429);
      expect(limited.headers['retry-after-voiceminute']).toBeDefined();
      await transcribe(member.agent).expect(200);
      await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'banana' })
        .expect(200);
    } finally {
      await app.close();
    }
  });
});
