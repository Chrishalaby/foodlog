import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { API_LIMITS, type ApiError, type MenuScanResponse } from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModuleBuilder } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import {
  type AiMenuRequest,
  type AiMenuResult,
  MENU_AI_PROVIDER,
  type MenuAiProvider,
} from '../src/ai/providers/ai-provider.js';
import {
  type AiFailureKind,
  AiProviderError,
} from '../src/ai/providers/ai-provider-error.js';
import { MOCK_NOTICE } from '../src/ai/providers/mock-analysis.js';
import { MockProvider } from '../src/ai/providers/mock.provider.js';
import { AppConfig } from '../src/config/app-config.js';
import { aiRateLimits } from '../src/config/rate-limits.js';
import { type AiSettings, parseSettings } from '../src/config/settings.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { e2eEnvironment } from './e2e-environment.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const MENU_PATH = '/api/compare/menu';

function jpeg(width = 1600, height = 1200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 245, g: 240, b: 225 },
    },
  })
    .jpeg()
    .toBuffer();
}

function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 250, g: 250, b: 250 },
    },
  })
    .png()
    .toBuffer();
}

function scanMenu(
  agent: TestAgent,
  fields: Record<string, string>,
  images: readonly Buffer[],
  field = 'images',
): request.Test {
  let call = agent.post(MENU_PATH);
  for (const [key, value] of Object.entries(fields)) {
    call = call.field(key, value);
  }
  images.forEach((image, index) => {
    call = call.attach(field, image, {
      filename: `menu-${index + 1}.jpg`,
      contentType: 'image/jpeg',
    });
  });
  return call;
}

async function storedPhotoFileCount(): Promise<number> {
  const files = await readdir(join(e2eEnvironment().photosDir, 'photos')).catch(
    (): string[] => [],
  );
  return files.length;
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

function withMenuProvider(
  provider: MenuAiProvider,
): (builder: TestingModuleBuilder) => TestingModuleBuilder {
  return (builder) =>
    builder.overrideProvider(MENU_AI_PROVIDER).useValue(provider);
}

class CapturingMenuProvider implements MenuAiProvider {
  readonly name = 'mock';
  readonly requests: AiMenuRequest[] = [];
  private readonly mock = new MockProvider({ latencyMs: 0 });

  extractMenu(request: AiMenuRequest): Promise<AiMenuResult> {
    this.requests.push(request);
    return this.mock.extractMenu(request);
  }
}

class FailingMenuProvider implements MenuAiProvider {
  readonly name = 'openai';
  calls = 0;

  constructor(
    private readonly kind: AiFailureKind,
    private readonly retryable: boolean,
  ) {}

  extractMenu(): Promise<AiMenuResult> {
    this.calls += 1;
    return Promise.reject(
      new AiProviderError(this.kind, `simulated ${this.kind}`, this.retryable, {
        model: 'gpt-5.6-sol',
        retryAfterMs: 1,
        requestId: `req_menu_${this.calls}`,
        usage: {
          inputTokens: 3000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 400,
          reasoningTokens: 200,
        },
      }),
    );
  }
}

async function decodedImage(
  dataUrl: string,
): Promise<[string | undefined, number, number, string | undefined]> {
  const meta = await sharp(
    Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'),
  ).metadata();
  return [meta.format, meta.width, meta.height, meta.chromaSubsampling];
}

describe('compare menu (e2e)', () => {
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

  it('returns the mock dishes, stores nothing but a menu usage row', async () => {
    const photos = await prisma.photo.count();
    const files = await storedPhotoFileCount();

    const response = await scanMenu(
      agent,
      {
        description: 'I want something high protein under 700 kcal',
        imageRoles: 'label,label',
      },
      [await jpeg(), await png(1200, 1800)],
    ).expect(200);
    const body = response.body as MenuScanResponse;

    expect(body.restaurant).toBe('Mock Bistro');
    expect(body.dishes.map((dish) => dish.name)).toEqual([
      'Grilled chicken plate',
      'Falafel wrap',
      'Chicken caesar salad',
      'Beef burger',
    ]);
    expect(body.dishes[0]).toEqual({
      name: 'Grilled chicken plate',
      description: 'Chicken breast, rice, grilled vegetables, garlic sauce',
      grams: 450,
      portion: { count: 1, unit: 'plate', unitPlural: 'plates' },
      nutrients: {
        calories: 570,
        protein: 52,
        carbs: 58,
        fat: 16,
        satFat: 4,
        fiber: 7,
        sugar: 6,
        sodium: 980,
        alcohol: 0,
      },
      confidence: 'medium',
      notes: 'Plate with ~180 g chicken and rice',
    });
    expect(body.dishes[3]?.notes).toBe(
      'Burger with ~150 g patty. Fries not included',
    );
    expect(body.warnings).toEqual([MOCK_NOTICE]);
    expect(body.usage).toMatchObject({
      model: 'mock',
      costUsd: 0,
      attempts: 1,
    });
    expect(body.usage.inputTokens).toBeGreaterThan(0);

    expect(await prisma.photo.count()).toBe(photos);
    expect(await storedPhotoFileCount()).toBe(files);
    expect(await prisma.analysis.count()).toBe(0);
    const usages = await prisma.aiUsage.findMany();
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      mode: 'menu',
      model: 'mock',
      detail: 'high',
      attempt: 1,
      analysisId: null,
      success: true,
      costUsd: 0,
      outputTokens: body.usage.outputTokens,
    });
  });

  it('accepts a single menu photo without description or roles', async () => {
    const body = (await scanMenu(agent, {}, [await jpeg(800, 600)]).expect(200))
      .body as MenuScanResponse;
    expect(body.dishes).toHaveLength(4);
  });

  it('rejects missing, extra and invalid photos before calling the AI', async () => {
    const photos = await prisma.photo.count();
    const missing = await scanMenu(agent, { description: 'x' }, []).expect(400);
    expect((missing.body as ApiError).message).toBe('Add a photo of the menu');
    await agent.post(MENU_PATH).send({ description: 'pasta' }).expect(400);

    const four = await Promise.all([jpeg(), jpeg(), jpeg(), jpeg()]);
    await scanMenu(agent, {}, four).expect(400);

    const gif = await scanMenu(agent, {}, [
      await jpeg(),
      Buffer.from('GIF89a-not-really'),
    ]).expect(400);
    expect((gif.body as ApiError).message).toBe(
      'Unsupported image type — upload a JPEG, PNG or WebP photo',
    );
    const broken = await scanMenu(agent, {}, [
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    ]).expect(400);
    expect((broken.body as ApiError).message).toBe(
      'The uploaded file is not a supported image',
    );

    await scanMenu(agent, {}, [await jpeg()], 'image').expect(400);
    await scanMenu(
      agent,
      { description: 'x'.repeat(API_LIMITS.descriptionMax + 1) },
      [await jpeg()],
    ).expect(400);
    await scanMenu(agent, { mode: 'menu' }, [await jpeg()]).expect(400);
    await scanMenu(agent, { imageRoles: 'x'.repeat(65) }, [
      await jpeg(),
    ]).expect(400);

    expect(await prisma.aiUsage.count()).toBe(0);
    expect(await prisma.photo.count()).toBe(photos);
  });

  it('rejects photos above the upload limit with 413', async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    await scanMenu(agent, {}, [oversized]).expect(413);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(MENU_PATH)
      .attach('images', await jpeg(), 'menu.jpg')
      .expect(401);
  });
});

describe('compare menu limits and failures (e2e)', () => {
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

      const response = await scanMenu(agent, {}, [await jpeg()]).expect(429);

      expect((response.body as ApiError).message).toBe(
        'Monthly AI budget reached',
      );
      expect(await prisma.aiUsage.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('returns 429 once a member’s own budget is used up, counting menu scans', async () => {
    const { app, prisma, agent } = await startApp(
      withAiSettings({ memberMonthlyBudgetUsd: 0.5 }),
    );
    try {
      const member = await createSignedInUser(app);
      await scanMenu(member.agent, {}, [await jpeg()]).expect(200);
      await prisma.aiUsage.updateMany({
        where: { userId: member.user.id, mode: 'menu' },
        data: { costUsd: 0.5 },
      });

      const response = await scanMenu(member.agent, {}, [await jpeg()]).expect(
        429,
      );

      expect((response.body as ApiError).message).toBe(
        'Your monthly AI budget is used up',
      );
      await scanMenu(agent, {}, [await jpeg()]).expect(200);
    } finally {
      await app.close();
    }
  });

  it('returns 503 when OpenAI is selected without an API key', async () => {
    const { app, agent } = await startApp(
      withAiSettings({ provider: 'openai', apiKey: null }),
    );
    try {
      const response = await scanMenu(agent, {}, [await jpeg()]).expect(503);
      expect((response.body as ApiError).message).toBe(
        'AI is not configured — set OPENAI_API_KEY',
      );
    } finally {
      await app.close();
    }
  });

  it('retries a retryable failure once and records both menu attempts', async () => {
    const provider = new FailingMenuProvider('server_error', true);
    const { app, prisma, agent } = await startApp(withMenuProvider(provider));
    try {
      const response = await scanMenu(agent, {}, [await jpeg()]).expect(502);

      expect((response.body as ApiError).message).toBe(
        'OpenAI is having problems right now — please try again shortly',
      );
      expect(provider.calls).toBe(2);
      const usages = await prisma.aiUsage.findMany({
        orderBy: { attempt: 'asc' },
      });
      expect(
        usages.map((u) => [
          u.mode,
          u.attempt,
          u.success,
          u.errorKind,
          u.requestId,
          u.analysisId,
        ]),
      ).toEqual([
        ['menu', 1, false, 'server_error', 'req_menu_1', null],
        ['menu', 2, false, 'server_error', 'req_menu_2', null],
      ]);
      expect(usages[0]?.costUsd).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('does not retry a quota failure and maps it to 503', async () => {
    const provider = new FailingMenuProvider('quota_exceeded', false);
    const { app, prisma, agent } = await startApp(withMenuProvider(provider));
    try {
      await scanMenu(agent, {}, [await jpeg()]).expect(503);
      expect(provider.calls).toBe(1);
      expect(await prisma.aiUsage.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('sends the profile model, location, description and sharp 4:4:4 JPEGs', async () => {
    const provider = new CapturingMenuProvider();
    const { app, prisma, agent } = await startApp(withMenuProvider(provider));
    try {
      const user = await getTestUser(app);
      await prisma.profile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, aiModel: 'gpt-6-sol', location: 'Beirut' },
        update: { aiModel: 'gpt-6-sol', location: 'Beirut' },
      });

      await scanMenu(agent, { description: '  half portion  ' }, [
        await png(3000, 4000),
        await jpeg(1200, 900),
      ]).expect(200);

      const [sent] = provider.requests;
      expect(sent?.model).toBe('gpt-6-sol');
      expect(sent?.prompt).toEqual({
        description: 'half portion',
        imageCount: 2,
        location: 'Beirut',
      });
      expect(sent?.images.map(({ detail }) => detail)).toEqual([
        'high',
        'high',
      ]);
      await expect(
        Promise.all(
          (sent?.images ?? []).map(({ dataUrl }) => decodedImage(dataUrl)),
        ),
      ).resolves.toEqual([
        ['jpeg', 1344, 1792, '4:4:4'],
        ['jpeg', 1200, 900, '4:4:4'],
      ]);
      expect(await prisma.photo.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('applies the per-person AI rate limit to menu scans', async () => {
    const { perMinute } = aiRateLimits();
    const { app, agent } = await startApp(undefined, true);
    try {
      const member = await createSignedInUser(app);
      const image = await jpeg(400, 300);
      for (let i = 0; i < perMinute; i += 1) {
        await scanMenu(agent, {}, [image]).expect(200);
      }
      const limited = await scanMenu(agent, {}, [image]).expect(429);
      expect(limited.headers['retry-after-aiminute']).toBeDefined();
      await scanMenu(member.agent, {}, [image]).expect(200);
    } finally {
      await app.close();
    }
  });

  it('shares one per-person AI rate limit between analyses and menu scans', async () => {
    const { perMinute } = aiRateLimits();
    const { app, agent } = await startApp(undefined, true);
    try {
      const image = await jpeg(400, 300);
      const analyzeText = (): request.Test =>
        agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'banana' });
      for (let i = 0; i < perMinute; i += 1) {
        await (
          i % 2 === 0 ? analyzeText() : scanMenu(agent, {}, [image])
        ).expect(200);
      }

      await scanMenu(agent, {}, [image]).expect(429);
      await analyzeText().expect(429);
    } finally {
      await app.close();
    }
  });
});
