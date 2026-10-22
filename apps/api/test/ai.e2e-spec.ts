import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AnalysisItem,
  AnalyzeResponse,
  ApiError,
  DayDashboardResponse,
  DraftDto,
  EntryDto,
  EntryItemInput,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModuleBuilder } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import {
  AI_PROVIDER,
  type AiAnalyzeRequest,
  type AiAnalyzeResult,
  type AiProvider,
} from '../src/ai/providers/ai-provider.js';
import {
  type AiFailureKind,
  AiProviderError,
} from '../src/ai/providers/ai-provider-error.js';
import { MockProvider } from '../src/ai/providers/mock.provider.js';
import { AppConfig } from '../src/config/app-config.js';
import { PhotosService } from '../src/photos/photos.service.js';
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function jpeg(width = 1600, height = 1200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
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

interface DraftImage {
  buffer: Buffer;
  role: 'food' | 'label';
}

function createDraft(
  agent: TestAgent,
  fields: Record<string, string>,
  images: DraftImage[] = [],
): Promise<DraftDto> {
  let call = agent
    .post('/api/drafts')
    .field('timestamp', '2026-09-30T12:15:00.000Z')
    .field('localDate', '2026-09-30');
  for (const [key, value] of Object.entries(fields)) {
    call = call.field(key, value);
  }
  if (images.length > 0) {
    call = call.field('imageRoles', images.map(({ role }) => role).join(','));
  }
  images.forEach(({ buffer }, index) => {
    call = call.attach('images', buffer, `draft-${index}.jpg`);
  });
  return call.expect(201).then((response) => response.body as DraftDto);
}

async function storedPhotoFileCount(): Promise<number> {
  const files = await readdir(join(e2eEnvironment().photosDir, 'photos')).catch(
    (): string[] => [],
  );
  return files.length;
}

function binaryParser(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
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

function withProvider(
  provider: AiProvider,
): (builder: TestingModuleBuilder) => TestingModuleBuilder {
  return (builder) => builder.overrideProvider(AI_PROVIDER).useValue(provider);
}

class CapturingProvider implements AiProvider {
  readonly name = 'mock';
  readonly requests: AiAnalyzeRequest[] = [];
  private readonly mock = new MockProvider({ latencyMs: 0 });

  analyze(request: AiAnalyzeRequest): Promise<AiAnalyzeResult> {
    this.requests.push(request);
    return this.mock.analyze(request);
  }
}

class FailingProvider implements AiProvider {
  readonly name = 'openai';
  calls = 0;

  constructor(
    private readonly kind: AiFailureKind,
    private readonly retryable: boolean,
  ) {}

  analyze(): Promise<AiAnalyzeResult> {
    this.calls += 1;
    return Promise.reject(
      new AiProviderError(this.kind, `simulated ${this.kind}`, this.retryable, {
        model: 'gpt-5.6-sol',
        retryAfterMs: 1,
        requestId: `req_${this.calls}`,
        usage: {
          inputTokens: 2000,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 500,
          reasoningTokens: 300,
        },
      }),
    );
  }
}

describe('analyze (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  function analyzeImages(
    fields: Record<string, string>,
    images: Buffer[],
  ): request.Test {
    let call = agent.post('/api/analyze');
    for (const [key, value] of Object.entries(fields)) {
      call = call.field(key, value);
    }
    images.forEach((image, index) => {
      call = call.attach('images', image, {
        filename: `photo-${index}.jpg`,
        contentType: 'image/jpeg',
      });
    });
    return call;
  }

  function analyzePhoto(
    fields: Record<string, string>,
    image?: Buffer,
  ): request.Test {
    let call = agent.post('/api/analyze');
    for (const [key, value] of Object.entries(fields)) {
      call = call.field(key, value);
    }
    if (image) {
      call = call.attach('image', image, {
        filename: 'meal.jpg',
        contentType: 'image/jpeg',
      });
    }
    return call;
  }

  it('analyzes a text description with the mock provider and records usage', async () => {
    const response = await analyzePhoto({
      mode: 'text',
      description: '150g chicken and rice',
      localTime: '2026-09-28T13:05',
      mealType: 'lunch',
    }).expect(200);
    const body = response.body as AnalyzeResponse;

    expect(body.analysisId).toMatch(UUID_PATTERN);
    expect(body).toMatchObject({
      mode: 'text',
      description: '150g chicken and rice',
      photo: null,
      precise: false,
      usage: { model: 'mock', costUsd: 0, attempts: 1 },
    });
    expect(body.usage.inputTokens).toBeGreaterThan(0);
    expect(body.result.inputType).toBe('text');
    expect(
      body.result.items.map((item) => [
        item.name,
        item.grams,
        item.nutrients.calories,
      ]),
    ).toEqual([
      ['Chicken breast, grilled', 150, 248],
      ['White rice, cooked', 180, 234],
    ]);
    expect(body.result.totals.calories).toBe(482);
    expect(body.result.warnings).toEqual([]);

    const analysis = await prisma.analysis.findUniqueOrThrow({
      where: { id: body.analysisId },
      include: { usages: true },
    });
    expect(analysis).toMatchObject({
      userId,
      mode: 'text',
      description: '150g chicken and rice',
      photoId: null,
      model: 'mock',
      detail: null,
      precise: false,
    });
    expect(analysis.result).toEqual(body.result);
    expect(analysis.rawResponse).toMatchObject({ input_type: 'text' });
    expect(analysis.usages).toHaveLength(1);
    expect(analysis.usages[0]).toMatchObject({
      userId,
      model: 'mock',
      mode: 'text',
      attempt: 1,
      success: true,
      costUsd: 0,
      errorKind: null,
    });
  });

  function itemInputs(items: readonly AnalysisItem[]): EntryItemInput[] {
    return items.map((item) => ({
      name: item.name,
      grams: item.grams,
      nutrients: item.nutrients,
      confidence: item.confidence,
      count: item.count,
      unit: item.unit,
      unitPlural: item.unitPlural,
      micros: item.micros,
      fluidMl: item.fluidMl,
    }));
  }

  async function analyzeAndSave(
    description: string,
    localDate: string,
  ): Promise<{ analysis: AnalyzeResponse; entry: EntryDto }> {
    const analysis = (
      await agent
        .post('/api/analyze')
        .send({ mode: 'text', description })
        .expect(200)
    ).body as AnalyzeResponse;
    const entry = (
      await agent
        .post('/api/entries')
        .send({
          name: analysis.result.mealName,
          mealType: 'lunch',
          source: 'text',
          timestamp: `${localDate}T12:00:00.000Z`,
          localDate,
          items: itemInputs(analysis.result.items),
          analysisId: analysis.analysisId,
        })
        .expect(201)
    ).body as EntryDto;
    return { analysis, entry };
  }

  async function dayOf(date: string): Promise<DayDashboardResponse['day']> {
    const response = await agent
      .get('/api/dashboard/day')
      .query({ date })
      .expect(200);
    return (response.body as DayDashboardResponse).day;
  }

  it('splits a description of several meals into one analysis each', async () => {
    const response = await analyzePhoto({
      mode: 'text',
      description:
        'For breakfast I had 2 eggs with toast, and for lunch 150g chicken and rice',
      localTime: '2026-09-28T21:30',
      split: 'true',
    }).expect(200);
    const body = response.body as AnalyzeResponse;
    const [lunch, ...others] = body.moreMeals ?? [];

    expect(others).toEqual([]);
    expect(body).toMatchObject({
      mode: 'text',
      description: 'For breakfast I had 2 eggs with toast',
      timing: { mealType: 'breakfast', time: null, daysAgo: 0 },
      usage: { model: 'mock', attempts: 1 },
    });
    expect(lunch).toMatchObject({
      mode: 'text',
      description: 'lunch 150g chicken and rice',
      timing: { mealType: 'lunch', time: null, daysAgo: 0 },
      usage: { model: 'mock', attempts: 0, costUsd: 0, inputTokens: 0 },
    });
    expect(lunch?.analysisId).toMatch(UUID_PATTERN);
    expect(lunch?.analysisId).not.toBe(body.analysisId);
    expect(body.result.items.map((item) => item.name).join(' ')).toMatch(
      /egg/i,
    );
    expect(lunch?.result.items.map((item) => item.name)).toEqual([
      'Chicken breast, grilled',
      'White rice, cooked',
    ]);

    const stored = await prisma.analysis.findMany({
      where: { id: { in: [body.analysisId, lunch?.analysisId ?? ''] } },
      include: { usages: true },
    });
    const usagesOf = (id: string | undefined): number | undefined =>
      stored.find((analysis) => analysis.id === id)?.usages.length;
    expect(stored).toHaveLength(2);
    expect(usagesOf(body.analysisId)).toBe(1);
    expect(usagesOf(lunch?.analysisId)).toBe(0);
    expect(
      stored.find((analysis) => analysis.id === lunch?.analysisId),
    ).toMatchObject({
      userId,
      mode: 'text',
      description: 'lunch 150g chicken and rice',
    });

    const corrected = await analyzePhoto({
      mode: 'text',
      previousAnalysisId: lunch?.analysisId ?? '',
      followUpAnswer: 'it was 200 g of chicken',
      followUpKind: 'correction',
      split: 'true',
    }).expect(200);
    const rerun = corrected.body as AnalyzeResponse;
    expect(rerun.description).toBe('lunch 150g chicken and rice');
    expect(rerun.moreMeals).toBeUndefined();
    expect(rerun.timing).toBeUndefined();
  });

  it('keeps a single described meal whole when splitting is allowed', async () => {
    const response = await analyzePhoto({
      mode: 'text',
      description: '150g chicken and rice',
      split: 'true',
    }).expect(200);
    const body = response.body as AnalyzeResponse;

    expect(body.moreMeals).toBeUndefined();
    expect(body.description).toBe('150g chicken and rice');
    expect(body.timing).toEqual({ mealType: null, time: null, daysAgo: 0 });
    expect(body.result.totals.calories).toBe(482);
  });

  it('estimates vitamins and drinks that follow the meal into its entry, a scaled re-log and the day', async () => {
    const date = '2026-10-05';
    const { analysis, entry } = await analyzeAndSave(
      'chicken burger meal with a diet pepsi',
      date,
    );

    const items = analysis.result.items;
    expect(items.every((item) => item.micros !== null)).toBe(true);
    expect(items.every((item) => item.microsPer100g !== null)).toBe(true);
    const soda = items.find((item) => item.name === 'Diet Pepsi');
    expect(soda).toMatchObject({
      grams: 330,
      fluidMl: 330,
      micros: { caffeine: 35 },
      microsPer100g: { caffeine: 10.6 },
    });
    expect(
      items.filter((item) => item.fluidMl !== null).map(({ name }) => name),
    ).toEqual(['Diet Pepsi']);

    expect(
      entry.items.map(({ name, micros, fluidMl }) => ({
        name,
        micros,
        fluidMl,
      })),
    ).toEqual(
      items.map(({ name, micros, fluidMl }) => ({ name, micros, fluidMl })),
    );
    await expect(
      agent.get(`/api/entries/${entry.id}`).expect(200),
    ).resolves.toMatchObject({ body: { items: entry.items } });

    const again = (
      await agent
        .post('/api/foods/log')
        .send({
          key: `meal:${entry.id}`,
          servings: 1.5,
          timestamp: `${date}T19:00:00.000Z`,
          localDate: date,
          mealType: 'dinner',
        })
        .expect(201)
    ).body as EntryDto;
    const againSoda = again.items.find((item) => item.name === 'Diet Pepsi');
    expect(againSoda).toMatchObject({
      grams: 495,
      fluidMl: 495,
      micros: { caffeine: 53, potassium: 54 },
    });
    const bun = again.items.find((item) => item.name === 'Burger bun');
    expect(bun?.micros?.calcium).toBe(116);

    const day = await dayOf(date);
    expect(day.microsCoverage).toEqual({ items: 10, withMicros: 10 });
    expect(day.micros.caffeine).toBe(88);
    expect(day.micros.calcium).toBeGreaterThan(0);
  });

  it('counts a vitamin D3 softgel as 125 µg of vitamin D for the day', async () => {
    const date = '2026-10-06';
    const { entry } = await analyzeAndSave(
      "Doctor's Best Vitamin D3 125 mcg softgel",
      date,
    );

    expect(entry.items).toEqual([
      expect.objectContaining({
        grams: 1,
        count: 1,
        unit: 'softgel',
        micros: expect.objectContaining({ vitaminD: 125, calcium: 0 }),
        fluidMl: null,
      }),
    ]);
    expect(entry.totals.calories).toBe(0);
    const day = await dayOf(date);
    expect(day.micros).toMatchObject({ vitaminD: 125 });
    expect(day.microsCoverage).toEqual({ items: 1, withMicros: 1 });
  });

  it('counts a glass of water as a drink without nutrients', async () => {
    const response = await agent
      .post('/api/analyze')
      .send({ mode: 'text', description: 'glass of water' })
      .expect(200);

    expect((response.body as AnalyzeResponse).result.items).toEqual([
      expect.objectContaining({ name: 'Water', grams: 250, fluidMl: 250 }),
    ]);
  });

  it('accepts a JSON body for text analysis', async () => {
    const response = await agent
      .post('/api/analyze')
      .send({ mode: 'text', description: '2 eggs' })
      .expect(200);
    expect((response.body as AnalyzeResponse).result.items[0]).toMatchObject({
      name: 'Eggs, whole',
      grams: 100,
    });
  });

  it('stores an uploaded photo and returns a fetchable PhotoRef', async () => {
    const response = await analyzePhoto({ mode: 'food_photo' }, await jpeg());
    expect(response.status).toBe(200);
    const body = response.body as AnalyzeResponse;

    expect(body.photo).toEqual({
      id: expect.stringMatching(UUID_PATTERN) as string,
      url: `/api/photos/${body.photo?.id}`,
      thumbUrl: `/api/photos/${body.photo?.id}/thumb`,
      width: 1600,
      height: 1200,
    });
    expect(body.result.items).toHaveLength(4);
    expect(body.result.items.map((item) => item.amountSource)).toContain(
      'assumed_hidden',
    );
    expect(body.result.followUpQuestion).toBe('How was the chicken cooked?');
    expect(body.result.followUpOptions.length).toBeGreaterThanOrEqual(2);

    const full = await agent
      .get(body.photo!.url)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(full.headers['content-type']).toBe('image/jpeg');
    await agent.get(body.photo!.thumbUrl).expect(200);

    await expect(
      prisma.analysis.findUniqueOrThrow({ where: { id: body.analysisId } }),
    ).resolves.toMatchObject({
      photoId: body.photo!.id,
      detail: 'high',
      mode: 'food_photo',
    });
    expect(body.photos).toEqual([{ photo: body.photo, role: 'food' }]);
    await expect(
      prisma.analysisPhoto.findMany({
        where: { analysisId: body.analysisId },
      }),
    ).resolves.toEqual([
      {
        analysisId: body.analysisId,
        photoId: body.photo!.id,
        role: 'food',
        position: 0,
      },
    ]);
  });

  it('reads a nutrition label and keeps more resolution for it', async () => {
    const response = await analyzePhoto(
      { mode: 'nutrition_label', detail: 'low' },
      await png(3000, 1500),
    ).expect(200);
    const body = response.body as AnalyzeResponse;

    expect(body.photo).toMatchObject({ width: 2048, height: 1024 });
    expect(body.photos).toEqual([{ photo: body.photo, role: 'label' }]);
    expect(body.result.label).toMatchObject({
      productName: 'Oat & honey granola',
      basisUnit: 'g',
      servingSize: 30,
      packSize: 500,
    });
    expect(body.result.items).toEqual([
      expect.objectContaining({ grams: 30, amountSource: 'label' }),
    ]);
    const usage = await prisma.aiUsage.findFirstOrThrow({
      where: { analysisId: body.analysisId },
    });
    expect(usage.detail).toBe('low');
  });

  it('rejects requests without the required input', async () => {
    const before = await prisma.photo.count();
    const missingPhoto = await analyzePhoto({ mode: 'food_photo' }).expect(400);
    expect((missingPhoto.body as ApiError).message).toBe(
      'A photo is required for food photo analysis',
    );
    await analyzePhoto({ mode: 'nutrition_label' }).expect(400);
    await analyzePhoto({ mode: 'text', description: '   ' }).expect(400);
    await analyzePhoto(
      { mode: 'text', description: 'soup' },
      await jpeg(200, 200),
    ).expect(400);
    await analyzePhoto(
      { mode: 'food_photo' },
      Buffer.from('GIF89a-not-really'),
    ).expect(400);
    await analyzePhoto(
      { mode: 'food_photo' },
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    ).expect(400);
    await analyzePhoto({ mode: 'dessert' }).expect(400);
    await analyzePhoto({
      mode: 'text',
      description: 'x',
      precise: 'maybe',
    }).expect(400);
    await analyzePhoto({
      mode: 'text',
      description: 'x',
      localTime: '13:05',
    }).expect(400);
    await analyzePhoto({
      mode: 'text',
      description: 'x',
      unexpected: '1',
    }).expect(400);
    await analyzePhoto({
      mode: 'text',
      description: 'x',
      followUpAnswer: 'fried',
    }).expect(400);
    expect(await prisma.photo.count()).toBe(before);
  });

  it('re-runs a follow-up on the previous photo with the answer as ground truth', async () => {
    const first = (
      await analyzePhoto({ mode: 'food_photo' }, await jpeg()).expect(200)
    ).body as AnalyzeResponse;
    const photoCount = await prisma.photo.count();

    const response = await analyzePhoto({
      mode: 'food_photo',
      previousAnalysisId: first.analysisId,
      followUpAnswer: 'Pan-fried in oil',
    }).expect(200);
    const body = response.body as AnalyzeResponse;

    expect(body.analysisId).not.toBe(first.analysisId);
    expect(body.photo?.id).toBe(first.photo?.id);
    expect(body.result.followUpQuestion).toBeNull();
    expect(
      body.result.items.find((item) => item.name === 'Olive oil for cooking')
        ?.grams,
    ).toBe(15);
    expect(body.result.totals.calories).toBeGreaterThan(
      first.result.totals.calories,
    );
    expect(await prisma.photo.count()).toBe(photoCount);
    await expect(
      prisma.analysis.findUniqueOrThrow({ where: { id: body.analysisId } }),
    ).resolves.toMatchObject({
      previousAnalysisId: first.analysisId,
      followUpAnswer: 'Pan-fried in oil',
      photoId: first.photo?.id,
    });
  });

  it('applies a correction without treating it as the answer to the open question', async () => {
    const first = (
      await analyzePhoto({ mode: 'food_photo' }, await jpeg()).expect(200)
    ).body as AnalyzeResponse;
    expect(first.result.followUpQuestion).toBe('How was the chicken cooked?');

    const corrected = (
      await analyzePhoto({
        mode: 'food_photo',
        previousAnalysisId: first.analysisId,
        followUpAnswer: 'Pan-fried in oil',
        followUpKind: 'correction',
      }).expect(200)
    ).body as AnalyzeResponse;

    expect(corrected.result.followUpQuestion).toBe(
      'How was the chicken cooked?',
    );
    expect(
      corrected.result.items.find(
        (item) => item.name === 'Olive oil for cooking',
      )?.grams,
    ).toBe(15);
    await analyzePhoto({
      mode: 'food_photo',
      previousAnalysisId: first.analysisId,
      followUpAnswer: 'Pan-fried in oil',
      followUpKind: 'question',
    }).expect(400);
  });

  it('keeps earlier follow-up answers when re-checking with the precise model', async () => {
    const first = (
      await analyzePhoto({ mode: 'food_photo' }, await jpeg()).expect(200)
    ).body as AnalyzeResponse;
    const answered = (
      await analyzePhoto({
        mode: 'food_photo',
        previousAnalysisId: first.analysisId,
        followUpAnswer: 'Pan-fried in oil',
      }).expect(200)
    ).body as AnalyzeResponse;

    const recheck = (
      await analyzePhoto({
        mode: 'food_photo',
        previousAnalysisId: answered.analysisId,
        precise: 'true',
      }).expect(200)
    ).body as AnalyzeResponse;

    expect(recheck.precise).toBe(true);
    expect(recheck.photo?.id).toBe(first.photo?.id);
    expect(recheck.result.followUpQuestion).toBeNull();
    expect(recheck.result.totals).toEqual(answered.result.totals);
    expect(
      recheck.result.items.find((item) => item.name === 'Olive oil for cooking')
        ?.grams,
    ).toBe(15);
    await expect(
      prisma.analysis.findUniqueOrThrow({ where: { id: recheck.analysisId } }),
    ).resolves.toMatchObject({
      previousAnalysisId: answered.analysisId,
      followUpAnswer: null,
      precise: true,
    });
  });

  it('lets a follow-up of a text analysis keep its description', async () => {
    const first = (
      await analyzePhoto({ mode: 'text', description: 'burger' }).expect(200)
    ).body as AnalyzeResponse;
    expect(first.result.followUpQuestion).toBe('How big was the patty?');

    const body = (
      await analyzePhoto({
        mode: 'text',
        previousAnalysisId: first.analysisId,
        followUpAnswer: 'Large (~150 g)',
      }).expect(200)
    ).body as AnalyzeResponse;
    expect(body.description).toBe('burger');
    expect(body.result.items[0]).toMatchObject({
      name: 'Beef patty 80/20, grilled',
      grams: 150,
    });
  });

  it('returns 404 for unknown or foreign previous analyses', async () => {
    await analyzePhoto({
      mode: 'food_photo',
      previousAnalysisId: randomUUID(),
    }).expect(404);

    const stranger = await prisma.user.create({
      data: {
        email: `stranger-${randomUUID()}@example.com`,
        passwordHash: 'x',
      },
    });
    const foreign = await prisma.analysis.create({
      data: { userId: stranger.id, mode: 'text', model: 'mock', result: {} },
    });
    await analyzePhoto({
      mode: 'text',
      previousAnalysisId: foreign.id,
      followUpAnswer: 'yes',
    }).expect(404);
    await analyzePhoto({ mode: 'text', previousAnalysisId: 'nope' }).expect(
      400,
    );
  });

  it('analyzes a food photo and a label photo in one request', async () => {
    const photoCount = await prisma.photo.count();
    const response = await analyzeImages(
      { mode: 'food_photo', imageRoles: 'food,label' },
      [await jpeg(), await png(3000, 1500)],
    ).expect(200);
    const body = response.body as AnalyzeResponse;

    expect(body.photos.map(({ role, photo }) => [role, photo.width])).toEqual([
      ['food', 1600],
      ['label', 2048],
    ]);
    expect(body.photo).toEqual(body.photos[0]?.photo);
    expect(body.result.label).toMatchObject({
      productName: 'Strawberry yogurt',
      servingSize: 120,
    });
    expect(body.result.items).toEqual([
      expect.objectContaining({
        name: 'Strawberry yogurt',
        grams: 120,
        amountSource: 'visual_estimate',
        per100g: expect.objectContaining({ calories: 96 }) as unknown,
      }),
    ]);
    expect(await prisma.photo.count()).toBe(photoCount + 2);

    const analysis = await prisma.analysis.findUniqueOrThrow({
      where: { id: body.analysisId },
      include: { photos: { orderBy: { position: 'asc' } } },
    });
    expect(analysis.photoId).toBe(body.photos[0]?.photo.id);
    expect(analysis.detail).toBe('high');
    expect(
      analysis.photos.map(({ photoId, role, position }) => [
        photoId,
        role,
        position,
      ]),
    ).toEqual([
      [body.photos[0]?.photo.id, 'food', 0],
      [body.photos[1]?.photo.id, 'label', 1],
    ]);
    await agent.get(body.photos[1]!.photo.url).expect(200);
  });

  it('makes the first food photo the primary one and defaults later images to label', async () => {
    const labelFirst = (
      await analyzeImages({ mode: 'food_photo', imageRoles: 'label,food' }, [
        await png(3000, 1500),
        await jpeg(),
      ]).expect(200)
    ).body as AnalyzeResponse;
    expect(labelFirst.photos.map(({ role }) => role)).toEqual([
      'label',
      'food',
    ]);
    expect(labelFirst.photo).toEqual(labelFirst.photos[1]?.photo);

    const defaults = (
      await analyzeImages({ mode: 'food_photo' }, [
        await jpeg(),
        await jpeg(),
      ]).expect(200)
    ).body as AnalyzeResponse;
    expect(defaults.photos.map(({ role }) => role)).toEqual(['food', 'label']);
    expect(defaults.result.label?.productName).toBe('Strawberry yogurt');

    const labelScan = (
      await analyzeImages({ mode: 'nutrition_label' }, [
        await png(3000, 1500),
      ]).expect(200)
    ).body as AnalyzeResponse;
    expect(
      labelScan.photos.map(({ role, photo }) => [role, photo.width]),
    ).toEqual([['label', 2048]]);
  });

  it('adds a label photo to a previous analysis and re-runs with both', async () => {
    const first = (
      await analyzePhoto(
        { mode: 'food_photo', description: 'Khoury labneh' },
        await jpeg(),
      ).expect(200)
    ).body as AnalyzeResponse;
    expect(first.result.label).toBeNull();
    const photoCount = await prisma.photo.count();

    const response = await analyzeImages(
      {
        mode: 'food_photo',
        previousAnalysisId: first.analysisId,
        imageRoles: 'label',
      },
      [await png(3000, 1500)],
    ).expect(200);
    const body = response.body as AnalyzeResponse;

    expect(body.analysisId).not.toBe(first.analysisId);
    expect(body.description).toBe('Khoury labneh');
    expect(body.photos.map(({ role, photo }) => [role, photo.id])).toEqual([
      ['food', first.photo?.id],
      ['label', expect.stringMatching(UUID_PATTERN)],
    ]);
    expect(body.photo?.id).toBe(first.photo?.id);
    expect(body.result.label?.productName).toBe('Strawberry yogurt');
    expect(body.result.items[0]).toMatchObject({
      amountSource: 'visual_estimate',
      per100g: expect.objectContaining({ calories: 96 }) as unknown,
    });
    expect(await prisma.photo.count()).toBe(photoCount + 1);
    await expect(
      prisma.analysis.findUniqueOrThrow({ where: { id: body.analysisId } }),
    ).resolves.toMatchObject({
      previousAnalysisId: first.analysisId,
      photoId: first.photo?.id,
    });

    const answered = (
      await analyzePhoto({
        mode: 'food_photo',
        previousAnalysisId: body.analysisId,
        followUpAnswer: 'Half a cup (60 g)',
      }).expect(200)
    ).body as AnalyzeResponse;
    expect(answered.photos).toEqual(body.photos);
    expect(answered.result.items[0]).toMatchObject({
      name: 'Strawberry yogurt',
      grams: 60,
    });
  });

  it('keeps the food photo as cover and the added label photo on the saved entry', async () => {
    const first = (
      await analyzePhoto({ mode: 'food_photo' }, await jpeg()).expect(200)
    ).body as AnalyzeResponse;
    const withLabel = (
      await analyzeImages(
        {
          mode: 'food_photo',
          previousAnalysisId: first.analysisId,
          imageRoles: 'label',
        },
        [await png(3000, 1500)],
      ).expect(200)
    ).body as AnalyzeResponse;

    const entry = (
      await agent
        .post('/api/entries')
        .send({
          name: 'Strawberry yogurt',
          mealType: 'snack',
          source: withLabel.mode,
          timestamp: '2026-09-30T10:00:00.000Z',
          localDate: '2026-09-30',
          items: withLabel.result.items.map(
            ({ name, grams, nutrients, confidence }) => ({
              name,
              grams,
              nutrients,
              confidence,
            }),
          ),
          analysisId: withLabel.analysisId,
          photoId: withLabel.photo?.id ?? null,
        })
        .expect(201)
    ).body as EntryDto;

    expect(entry.photo).toEqual(first.photo);
    expect(entry.photos).toEqual(withLabel.photos);
    expect(entry.photos.map(({ role }) => role)).toEqual(['food', 'label']);
    await agent.get(entry.photos[1]!.photo.url).expect(200);
  });

  it('carries the photo of an analysis stored before photo roles existed', async () => {
    const seeded = (
      await analyzePhoto(
        { mode: 'nutrition_label' },
        await png(1200, 800),
      ).expect(200)
    ).body as AnalyzeResponse;
    await prisma.analysisPhoto.deleteMany({
      where: { analysisId: seeded.analysisId },
    });

    const body = (
      await analyzeImages(
        { mode: 'nutrition_label', previousAnalysisId: seeded.analysisId },
        [await jpeg()],
      ).expect(200)
    ).body as AnalyzeResponse;
    expect(body.photos.map(({ role, photo }) => [role, photo.id])).toEqual([
      ['label', seeded.photo?.id],
      ['label', expect.stringMatching(UUID_PATTERN)],
    ]);
    expect(body.photo?.id).toBe(seeded.photo?.id);
  });

  it('keeps at most three photos: the first food photo and the newest others', async () => {
    const first = (
      await analyzeImages(
        { mode: 'food_photo', imageRoles: 'food,label,label' },
        [await jpeg(), await png(1200, 800), await png(1300, 800)],
      ).expect(200)
    ).body as AnalyzeResponse;
    const [food, oldLabel, newerLabel] = first.photos.map(
      ({ photo }) => photo.id,
    );

    const body = (
      await analyzeImages(
        { mode: 'food_photo', previousAnalysisId: first.analysisId },
        [await png(1400, 800)],
      ).expect(200)
    ).body as AnalyzeResponse;
    expect(body.photos).toHaveLength(3);
    expect(body.photos.map(({ photo }) => photo.id).slice(0, 2)).toEqual([
      food,
      newerLabel,
    ]);
    expect(body.photos.map(({ role }) => role)).toEqual([
      'food',
      'label',
      'label',
    ]);
    expect(body.photos.map(({ photo }) => photo.id)).not.toContain(oldLabel);
    await expect(
      prisma.photo.findUnique({ where: { id: oldLabel } }),
    ).resolves.not.toBeNull();

    const photoCount = await prisma.photo.count();
    const tooMany = await analyzeImages({ mode: 'food_photo' }, [
      await jpeg(),
      await jpeg(),
      await jpeg(),
      await jpeg(),
    ]).expect(400);
    expect((tooMany.body as ApiError).message).toBe('Too many files');
    await analyzePhoto({ mode: 'food_photo' }, await jpeg())
      .attach('images', await jpeg(), 'a.jpg')
      .attach('images', await jpeg(), 'b.jpg')
      .attach('images', await jpeg(), 'c.jpg')
      .expect(400);
    expect(await prisma.photo.count()).toBe(photoCount);
  });

  it('rejects invalid image roles and images in text mode without storing photos', async () => {
    const photoCount = await prisma.photo.count();
    const invalid = await analyzeImages(
      { mode: 'food_photo', imageRoles: 'food,drink' },
      [await jpeg(), await jpeg()],
    ).expect(400);
    expect((invalid.body as ApiError).message).toEqual([
      'imageRoles must be a comma-separated list of food or label',
    ]);
    const mismatch = await analyzeImages(
      { mode: 'food_photo', imageRoles: 'food,label' },
      [await jpeg()],
    ).expect(400);
    expect((mismatch.body as ApiError).message).toContain(
      'imageRoles lists 2 role(s) for 1 image(s)',
    );
    await analyzePhoto(
      { mode: 'food_photo', imageRoles: 'label' },
      await jpeg(),
    ).expect(400);
    await analyzeImages({ mode: 'food_photo' }, [
      await jpeg(),
      Buffer.from('GIF89a-not-really'),
    ]).expect(400);

    const text = await analyzeImages(
      { mode: 'text', description: 'soup', imageRoles: 'food,label' },
      [await jpeg(), await jpeg()],
    ).expect(400);
    expect((text.body as ApiError).message).toContain(
      'Text analysis does not take an image',
    );
    expect(await prisma.photo.count()).toBe(photoCount);
  });

  it('removes the photos already stored when another upload cannot be processed', async () => {
    const photoCount = await prisma.photo.count();
    const fileCount = await storedPhotoFileCount();
    const response = await analyzeImages(
      { mode: 'food_photo', imageRoles: 'food,label' },
      [await jpeg(), Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ).expect(400);
    expect((response.body as ApiError).message).toBe(
      'The uploaded file is not a supported image',
    );
    expect(await prisma.photo.count()).toBe(photoCount);
    expect(await storedPhotoFileCount()).toBe(fileCount);
  });

  it('rejects images above the upload limit with 413', async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    await analyzePhoto({ mode: 'food_photo' }, oversized).expect(413);
  });

  it('bounds multipart text fields before validation', async () => {
    const response = await analyzePhoto({
      mode: 'text',
      description: 'x'.repeat(20_000),
    }).expect(400);
    expect((response.body as ApiError).message).toBe(
      'Field value too long - description',
    );
    const fields = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`extra${i}`, '1']),
    );
    const tooMany = await analyzePhoto({ mode: 'text', ...fields }).expect(400);
    expect((tooMany.body as ApiError).message).toBe('Too many fields');
  });

  it('analyzes the photos and description of a draft without changing it', async () => {
    const draft = await createDraft(
      agent,
      { mode: 'food_photo', description: 'Office lunch box' },
      [
        { buffer: await jpeg(3024, 4032), role: 'food' },
        { buffer: await png(3000, 1500), role: 'label' },
      ],
    );
    const photoCount = await prisma.photo.count();

    const body = (
      await analyzePhoto({ mode: 'food_photo', draftId: draft.id }).expect(200)
    ).body as AnalyzeResponse;

    expect(body.mode).toBe('food_photo');
    expect(body.description).toBe('Office lunch box');
    expect(body.photos).toEqual(draft.photos);
    expect(body.photo).toEqual(draft.photos[0]?.photo);
    expect(body.photo).toMatchObject({ width: 1344, height: 1792 });
    expect(body.result.label?.productName).toBe('Strawberry yogurt');
    expect(await prisma.photo.count()).toBe(photoCount);
    await expect(
      prisma.analysis.findUniqueOrThrow({ where: { id: body.analysisId } }),
    ).resolves.toMatchObject({
      photoId: draft.photos[0]?.photo.id,
      description: 'Office lunch box',
      previousAnalysisId: null,
    });
    const [unchanged] = (await agent.get('/api/drafts').expect(200))
      .body as DraftDto[];
    expect(unchanged).toEqual(draft);
  });

  it('adds new photos to the draft photos and lets a new description win', async () => {
    const draft = await createDraft(
      agent,
      { mode: 'food_photo', description: 'pasta' },
      [{ buffer: await jpeg(), role: 'food' }],
    );
    const photoCount = await prisma.photo.count();

    const body = (
      await analyzeImages(
        {
          mode: 'food_photo',
          draftId: draft.id,
          description: 'pasta with pesto',
          imageRoles: 'label',
        },
        [await png(3000, 1500)],
      ).expect(200)
    ).body as AnalyzeResponse;

    expect(body.description).toBe('pasta with pesto');
    expect(body.photos.map(({ role, photo }) => [role, photo.id])).toEqual([
      ['food', draft.photos[0]?.photo.id],
      ['label', expect.stringMatching(UUID_PATTERN)],
    ]);
    expect(await prisma.photo.count()).toBe(photoCount + 1);
    await expect(
      prisma.draftPhoto.count({ where: { draftId: draft.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.draft.findUniqueOrThrow({ where: { id: draft.id } }),
    ).resolves.toMatchObject({ description: 'pasta', analysisId: null });
  });

  it('analyzes a described draft with photos as a food photo', async () => {
    const withPhoto = await createDraft(
      agent,
      { mode: 'text', description: 'burger from the place downstairs' },
      [{ buffer: await jpeg(), role: 'food' }],
    );
    const textOnly = await createDraft(agent, {
      mode: 'text',
      description: 'burger',
    });

    const photo = (
      await analyzePhoto({ mode: 'text', draftId: withPhoto.id }).expect(200)
    ).body as AnalyzeResponse;
    const text = (
      await analyzePhoto({ mode: 'text', draftId: textOnly.id }).expect(200)
    ).body as AnalyzeResponse;

    expect(photo.mode).toBe('food_photo');
    expect(photo.description).toBe('burger from the place downstairs');
    expect(photo.photos).toEqual(withPhoto.photos);
    expect(text).toMatchObject({
      mode: 'text',
      description: 'burger',
      photo: null,
      photos: [],
    });
    expect(text.result.followUpQuestion).toBe('How big was the patty?');
  });

  it('combines a draft with a previous analysis without duplicating photos', async () => {
    const draft = await createDraft(
      agent,
      { mode: 'food_photo', description: 'chicken plate' },
      [{ buffer: await jpeg(), role: 'food' }],
    );
    const first = (
      await analyzePhoto({ mode: 'food_photo', draftId: draft.id }).expect(200)
    ).body as AnalyzeResponse;

    const answered = (
      await analyzePhoto({
        mode: 'food_photo',
        draftId: draft.id,
        previousAnalysisId: first.analysisId,
        followUpAnswer: 'Pan-fried in oil',
      }).expect(200)
    ).body as AnalyzeResponse;

    expect(answered.photos).toEqual(draft.photos);
    expect(answered.description).toBe('chicken plate');
    expect(
      answered.result.items.find(
        (item) => item.name === 'Olive oil for cooking',
      )?.grams,
    ).toBe(15);
    await expect(
      prisma.analysis.findUniqueOrThrow({
        where: { id: answered.analysisId },
      }),
    ).resolves.toMatchObject({
      previousAnalysisId: first.analysisId,
      followUpAnswer: 'Pan-fried in oil',
    });
  });

  it('returns 404 for unknown or foreign drafts without storing uploads', async () => {
    const stranger = await createSignedInUser(app);
    const foreign = await createDraft(stranger.agent, { mode: 'food_photo' }, [
      { buffer: await jpeg(), role: 'food' },
    ]);
    const photoCount = await prisma.photo.count();

    const unknown = await analyzeImages(
      { mode: 'food_photo', draftId: randomUUID() },
      [await jpeg()],
    ).expect(404);
    expect((unknown.body as ApiError).message).toBe('Draft not found');
    await analyzePhoto({ mode: 'food_photo', draftId: foreign.id }).expect(404);
    await analyzePhoto({ mode: 'food_photo', draftId: 'nope' }).expect(400);
    expect(await prisma.photo.count()).toBe(photoCount);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .field('mode', 'text')
      .field('description', 'apple')
      .expect(401);
  });
});

describe('analyze limits and failures (e2e)', () => {
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

  it('returns 429 once the monthly budget is used up, before storing the photo', async () => {
    const { app, prisma, agent } = await startApp(
      withAiSettings({ monthlyBudgetUsd: 0.05 }),
    );
    try {
      const user = await getTestUser(app);
      await agent
        .post('/api/analyze')
        .field('mode', 'text')
        .field('description', 'apple')
        .expect(200);
      await prisma.aiUsage.create({
        data: {
          userId: user.id,
          model: 'gpt-5.6-sol',
          mode: 'food_photo',
          costUsd: 0.06,
          success: true,
        },
      });

      const response = await agent
        .post('/api/analyze')
        .field('mode', 'food_photo')
        .attach('image', await jpeg(), 'meal.jpg')
        .expect(429);
      expect((response.body as ApiError).message).toBe(
        'Monthly AI budget reached',
      );
      expect(await prisma.photo.count()).toBe(0);
      expect(await prisma.aiUsage.count()).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('returns 503 when OpenAI is selected without an API key', async () => {
    const { app, agent } = await startApp(
      withAiSettings({ provider: 'openai', apiKey: null }),
    );
    try {
      const response = await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(503);
      expect((response.body as ApiError).message).toBe(
        'AI is not configured — set OPENAI_API_KEY',
      );
    } finally {
      await app.close();
    }
  });

  it('retries a retryable failure once, records both attempts and removes the new photo', async () => {
    const provider = new FailingProvider('server_error', true);
    const { app, prisma, agent } = await startApp(withProvider(provider));
    try {
      const response = await agent
        .post('/api/analyze')
        .field('mode', 'food_photo')
        .attach('image', await jpeg(), 'meal.jpg')
        .expect(502);
      expect((response.body as ApiError).message).toBe(
        'OpenAI is having problems right now — please try again shortly',
      );
      expect(provider.calls).toBe(2);
      const usages = await prisma.aiUsage.findMany({
        orderBy: { attempt: 'asc' },
      });
      expect(
        usages.map((u) => [u.attempt, u.success, u.errorKind, u.analysisId]),
      ).toEqual([
        [1, false, 'server_error', null],
        [2, false, 'server_error', null],
      ]);
      expect(usages[0]?.costUsd).toBeGreaterThan(0);
      expect(usages[0]?.requestId).toBe('req_1');
      expect(await prisma.photo.count()).toBe(0);
      expect(await prisma.analysis.count()).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('analyses a description as one meal when the provider cannot or will not split it', async () => {
    const rejecting = Object.assign(new CapturingProvider(), {
      splitCalls: 0,
      analyzeMeals(): Promise<never> {
        this.splitCalls += 1;
        return Promise.reject(
          new AiProviderError('bad_request', 'Invalid schema', false, {
            model: 'gpt-5.6-sol',
          }),
        );
      },
    });
    const day = {
      mode: 'text',
      description: 'eggs for breakfast and chicken for lunch',
      split: 'true',
    };
    for (const provider of [new CapturingProvider(), rejecting]) {
      const { app, prisma, agent } = await startApp(withProvider(provider));
      try {
        const response = await agent.post('/api/analyze').send(day).expect(200);
        const body = response.body as AnalyzeResponse;

        expect(body.description).toBe(day.description);
        expect(body.moreMeals).toBeUndefined();
        expect(body.timing).toBeUndefined();
        expect(provider.requests).toHaveLength(1);
        expect(await prisma.analysis.count()).toBe(1);
      } finally {
        await app.close();
      }
    }
    expect(rejecting.splitCalls).toBe(1);
  });

  it('sends the resolved model, profile detail, context and stored JPEG to the provider', async () => {
    const provider = new CapturingProvider();
    const { app, prisma, agent } = await startApp(withProvider(provider));
    try {
      const user = await getTestUser(app);
      await prisma.profile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          aiModel: 'gpt-6-sol',
          aiDetailFood: 'low',
          location: 'Lisbon, Portugal',
        },
        update: {
          aiModel: 'gpt-6-sol',
          aiDetailFood: 'low',
          location: 'Lisbon, Portugal',
        },
      });

      await agent
        .post('/api/analyze')
        .field('mode', 'food_photo')
        .field('description', 'half a burger')
        .field('localTime', '2026-09-28T19:45')
        .attach('image', await png(800, 600), 'meal.png')
        .expect(200);
      await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple', precise: 'true' })
        .expect(200);

      const [photo, text] = provider.requests;
      expect(photo?.model).toBe('gpt-6-sol');
      expect(photo?.images).toHaveLength(1);
      expect(photo?.images[0]?.detail).toBe('low');
      expect(photo?.images[0]?.dataUrl).toMatch(
        /^data:image\/jpeg;base64,\/9j\//,
      );
      expect(photo?.prompt).toEqual({
        mode: 'food_photo',
        imageRoles: ['food'],
        description: 'half a burger',
        localTime: '2026-09-28T19:45',
        mealType: null,
        location: 'Lisbon, Portugal',
        answeredQuestions: [],
        followUp: null,
        savedFoods: [],
      });
      expect(text?.model).toBe(app.get(AppConfig).ai.preciseModel);
      expect(text?.images).toEqual([]);
      expect(text?.prompt.imageRoles).toEqual([]);
      const analyses = await prisma.analysis.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(analyses.map((a) => [a.detail, a.precise])).toEqual([
        ['low', false],
        [null, true],
      ]);
    } finally {
      await app.close();
    }
  });

  it('sends every photo in order with the profile detail of its role', async () => {
    const provider = new CapturingProvider();
    const { app, prisma, agent } = await startApp(withProvider(provider));
    try {
      const user = await getTestUser(app);
      await prisma.profile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, aiDetailFood: 'low', aiDetailLabel: 'high' },
        update: { aiDetailFood: 'low', aiDetailLabel: 'high' },
      });

      const body = (
        await agent
          .post('/api/analyze')
          .field('mode', 'food_photo')
          .field('imageRoles', 'label,food')
          .attach('images', await png(3000, 1500), 'label.png')
          .attach('images', await jpeg(), 'meal.jpg')
          .expect(200)
      ).body as AnalyzeResponse;

      const [sent] = provider.requests;
      expect(sent?.prompt.imageRoles).toEqual(['label', 'food']);
      expect(sent?.images.map(({ detail }) => detail)).toEqual(['high', 'low']);
      const sizes = await Promise.all(
        (sent?.images ?? []).map(async ({ dataUrl }) => {
          const meta = await sharp(
            Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'),
          ).metadata();
          return [meta.format, meta.width];
        }),
      );
      expect(sizes).toEqual([
        ['jpeg', 2048],
        ['jpeg', 1600],
      ]);
      expect(body.photo?.id).toBe(body.photos[1]?.photo.id);
      const usage = await prisma.aiUsage.findFirstOrThrow({
        where: { analysisId: body.analysisId },
      });
      expect(usage.detail).toBe('high');
    } finally {
      await app.close();
    }
  });

  it('removes only the photos created by a failed request', async () => {
    const provider = new FailingProvider('server_error', true);
    const { app, prisma, agent } = await startApp(withProvider(provider));
    try {
      const user = await getTestUser(app);
      const previousPhoto = await app
        .get(PhotosService)
        .createFromUpload(user.id, await jpeg(), { role: 'food' });
      const previous = await prisma.analysis.create({
        data: {
          userId: user.id,
          mode: 'food_photo',
          model: 'mock',
          result: {},
          photoId: previousPhoto.id,
          photos: { create: { photoId: previousPhoto.id, role: 'food' } },
        },
      });

      await agent
        .post('/api/analyze')
        .field('mode', 'food_photo')
        .field('previousAnalysisId', previous.id)
        .field('imageRoles', 'label,label')
        .attach('images', await png(1200, 800), 'label.png')
        .attach('images', await png(900, 900), 'back.png')
        .expect(502);

      expect(provider.calls).toBe(2);
      await expect(
        prisma.photo.findMany({ select: { id: true } }),
      ).resolves.toEqual([{ id: previousPhoto.id }]);
      expect(await prisma.analysis.count()).toBe(1);
      expect(await prisma.analysisPhoto.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('keeps the draft photos when an analysis of the draft fails', async () => {
    const provider = new FailingProvider('server_error', true);
    const { app, prisma, agent } = await startApp(withProvider(provider));
    try {
      const draft = await createDraft(agent, { mode: 'food_photo' }, [
        { buffer: await jpeg(), role: 'food' },
      ]);

      await agent
        .post('/api/analyze')
        .field('mode', 'food_photo')
        .field('draftId', draft.id)
        .field('imageRoles', 'label')
        .attach('images', await png(1200, 800), 'label.png')
        .expect(502);

      await expect(
        prisma.photo.findMany({ select: { id: true } }),
      ).resolves.toEqual([{ id: draft.photos[0]?.photo.id }]);
      await expect(
        prisma.draftPhoto.count({ where: { draftId: draft.id } }),
      ).resolves.toBe(1);
      await agent.get(draft.photos[0]!.photo.url).expect(200);
    } finally {
      await app.close();
    }
  });

  it('stores and sends a 12 MP portrait photo sized to the patch budget with high detail', async () => {
    const provider = new CapturingProvider();
    const { app, agent } = await startApp(withProvider(provider));
    try {
      const body = (
        await agent
          .post('/api/analyze')
          .field('mode', 'food_photo')
          .attach('images', await jpeg(3024, 4032), 'portrait.jpg')
          .expect(200)
      ).body as AnalyzeResponse;

      expect(body.photo).toMatchObject({ width: 1344, height: 1792 });
      const [sent] = provider.requests;
      expect(sent?.images.map(({ detail }) => detail)).toEqual(['high']);
      const meta = await sharp(
        Buffer.from(sent?.images[0]?.dataUrl.split(',')[1] ?? '', 'base64'),
      ).metadata();
      expect([
        meta.format,
        meta.width,
        meta.height,
        meta.chromaSubsampling,
      ]).toEqual(['jpeg', 1344, 1792, '4:2:0']);
    } finally {
      await app.close();
    }
  });

  it('maps a quota failure to 503 without retrying', async () => {
    const provider = new FailingProvider('quota_exceeded', false);
    const { app, prisma, agent } = await startApp(withProvider(provider));
    try {
      const response = await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(503);
      expect((response.body as ApiError).message).toBe(
        'OpenAI quota or billing limit reached',
      );
      expect(provider.calls).toBe(1);
      expect(await prisma.aiUsage.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('returns 429 once a member’s own monthly budget is used up while admins stay unlimited', async () => {
    const memberBudget = 0.5;
    const { app, prisma, agent } = await startApp(
      withAiSettings({ memberMonthlyBudgetUsd: memberBudget }),
    );
    try {
      const member = await createSignedInUser(app);
      await prisma.aiUsage.createMany({
        data: [
          {
            userId: member.user.id,
            model: 'gpt-5.6-sol',
            mode: 'text',
            costUsd: memberBudget,
            success: true,
          },
          {
            userId: (await getTestUser(app)).id,
            model: 'gpt-5.6-sol',
            mode: 'text',
            costUsd: 500,
            success: true,
          },
        ],
      });

      const response = await member.agent
        .post('/api/analyze')
        .field('mode', 'food_photo')
        .attach('image', await jpeg(), 'meal.jpg')
        .expect(429);
      expect((response.body as ApiError).message).toBe(
        'Your monthly AI budget is used up',
      );
      expect(await prisma.photo.count()).toBe(0);
      await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(200);

      await agent
        .patch(`/api/admin/users/${member.user.id}`)
        .send({ aiMonthlyBudgetUsd: memberBudget + 1 })
        .expect(200);
      await member.agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(200);

      await agent
        .patch(`/api/admin/users/${member.user.id}`)
        .send({ aiMonthlyBudgetUsd: 0 })
        .expect(200);
      await member.agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(429);

      await agent
        .patch(`/api/admin/users/${member.user.id}`)
        .send({ aiBudgetUnlimited: true })
        .expect(200);
      await member.agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(200);

      await agent
        .patch(`/api/admin/users/${member.user.id}`)
        .send({ aiBudgetUnlimited: false })
        .expect(200);
      await member.agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(429);
    } finally {
      await app.close();
    }
  });

  it('lets an admin cap their own budget', async () => {
    const { app, prisma, agent } = await startApp();
    try {
      const admin = await getTestUser(app);
      await prisma.aiUsage.create({
        data: {
          userId: admin.id,
          model: 'gpt-5.6-sol',
          mode: 'text',
          costUsd: 2,
          success: true,
        },
      });
      await agent
        .patch(`/api/admin/users/${admin.id}`)
        .send({ aiMonthlyBudgetUsd: 1 })
        .expect(200);
      const response = await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(429);
      expect((response.body as ApiError).message).toBe(
        'Your monthly AI budget is used up',
      );

      await agent
        .patch(`/api/admin/users/${admin.id}`)
        .send({ aiBudgetUnlimited: true })
        .expect(200);
      await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(200);
    } finally {
      await app.close();
    }
  });

  it('keys the AI rate limit by person rather than by IP', async () => {
    const { perMinute } = aiRateLimits();
    const { app, agent } = await startApp(undefined, true);
    try {
      const member = await createSignedInUser(app);
      for (let i = 0; i < perMinute; i += 1) {
        await agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'apple' })
          .expect(200);
      }
      const limited = await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(429);
      expect(limited.headers['retry-after-aiminute']).toBeDefined();
      await member.agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(200);
    } finally {
      await app.close();
    }
  });

  it('applies the per-minute AI rate limit to analyze', async () => {
    const { perMinute } = aiRateLimits();
    const { app, agent } = await startApp(undefined, true);
    try {
      for (let i = 0; i < perMinute; i += 1) {
        await agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'apple' })
          .expect(200);
      }
      await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'apple' })
        .expect(429);
    } finally {
      await app.close();
    }
  });
});
