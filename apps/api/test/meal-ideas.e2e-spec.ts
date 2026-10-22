import {
  API_LIMITS,
  type ApiError,
  type CreateEntryRequest,
  type EntryDto,
  type EntryItemInput,
  type MealIdeasRequest,
  type MealIdeasResponse,
  type MealType,
  type Nutrients,
  toLocalDateTimeInput,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import {
  type AiMealIdeasRequest,
  type AiMealIdeasResult,
  MEAL_IDEAS_AI_PROVIDER,
  type MealIdeasAiProvider,
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
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const IDEAS_PATH = '/api/meal-ideas';
const DAY_MS = 86_400_000;
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const LOCAL_TIME = toLocalDateTimeInput(NOW);
const NEW_IDEA_TITLE = 'Grilled chicken with rice and salad';

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function item(
  name: string,
  grams: number,
  values: Partial<Nutrients> = {},
): EntryItemInput {
  return { name, grams, nutrients: nutrients(values) };
}

const WRAP = item('Chicken wrap', 320, {
  calories: 640,
  protein: 40,
  carbs: 60,
  fat: 24,
});
const YOGURT = item('Khoury yogurt', 125, {
  calories: 110,
  protein: 5,
  carbs: 17,
  fat: 2.5,
});
const OATS = item('Oats with whey', 300, {
  calories: 450,
  protein: 35,
  carbs: 55,
  fat: 9,
});

async function logMeal(
  agent: TestAgent,
  food: EntryItemInput,
  daysAgo: number,
  mealType: MealType = 'lunch',
): Promise<EntryDto> {
  const at = new Date(NOW.getTime() - daysAgo * DAY_MS);
  const body: CreateEntryRequest = {
    name: food.name,
    mealType,
    source: 'manual',
    timestamp: at.toISOString(),
    localDate: at.toISOString().slice(0, 10),
    items: [food],
  };
  const response = await agent.post('/api/entries').send(body).expect(201);
  return response.body as EntryDto;
}

async function seedUsualFoods(agent: TestAgent): Promise<void> {
  await logMeal(agent, WRAP, 3);
  await logMeal(agent, WRAP, 2);
  await logMeal(agent, WRAP, 1);
  await logMeal(agent, YOGURT, 2, 'snack');
  await logMeal(agent, YOGURT, 1, 'snack');
  await logMeal(agent, OATS, 0, 'breakfast');
}

function ask(
  agent: TestAgent,
  body: Partial<MealIdeasRequest> | Record<string, unknown> = {},
): request.Test {
  return agent
    .post(IDEAS_PATH)
    .send({ localDate: TODAY, localTime: LOCAL_TIME, ...body });
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

function withIdeasProvider(
  provider: MealIdeasAiProvider,
): (builder: TestingModuleBuilder) => TestingModuleBuilder {
  return (builder) =>
    builder.overrideProvider(MEAL_IDEAS_AI_PROVIDER).useValue(provider);
}

class CapturingIdeasProvider implements MealIdeasAiProvider {
  readonly name = 'mock';
  readonly requests: AiMealIdeasRequest[] = [];
  private readonly mock = new MockProvider({ latencyMs: 0 });

  suggestMeals(request: AiMealIdeasRequest): Promise<AiMealIdeasResult> {
    this.requests.push(request);
    return this.mock.suggestMeals(request);
  }
}

class FailingIdeasProvider implements MealIdeasAiProvider {
  readonly name = 'openai';
  calls = 0;

  constructor(
    private readonly kind: AiFailureKind,
    private readonly retryable: boolean,
  ) {}

  suggestMeals(): Promise<AiMealIdeasResult> {
    this.calls += 1;
    return Promise.reject(
      new AiProviderError(this.kind, `simulated ${this.kind}`, this.retryable, {
        model: 'gpt-5.6-sol',
        retryAfterMs: 1,
        requestId: `req_ideas_${this.calls}`,
        usage: {
          inputTokens: 2500,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 300,
          reasoningTokens: 150,
        },
      }),
    );
  }
}

describe('meal ideas (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    await seedUsualFoods(agent);
  });

  beforeEach(async () => {
    await prisma.aiUsage.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('suggests the foods the user logs most, with nutrition from their own records, and stores only a usage row', async () => {
    const entries = await prisma.entry.count();

    const body = (await ask(agent).expect(200)).body as MealIdeasResponse;

    expect(body.summary).toBe(MOCK_NOTICE);
    expect(body.ideas).toHaveLength(API_LIMITS.mealIdeasMax);
    const [usual, pair, fresh] = body.ideas;
    expect(usual).toMatchObject({
      title: 'Chicken wrap',
      grams: 320,
      totals: WRAP.nutrients,
    });
    expect(usual?.parts).toHaveLength(1);
    expect(usual?.parts[0]).toMatchObject({
      name: 'Chicken wrap',
      servings: 1,
      grams: 320,
      nutrients: WRAP.nutrients,
    });
    expect(usual?.parts[0]?.foodKey).toMatch(/^meal:/);
    expect(pair?.parts.map((part) => [part.name, part.servings])).toEqual([
      ['Khoury yogurt', 1],
      ['Oats with whey', 0.5],
    ]);
    expect(pair?.totals).toMatchObject({ calories: 335, protein: 22.5 });
    expect(fresh?.title).toBe(NEW_IDEA_TITLE);
    expect(fresh?.parts.every((part) => part.foodKey === null)).toBe(true);
    expect(fresh?.totals.calories).toBe(501);
    expect(body.usage).toMatchObject({
      model: 'mock',
      costUsd: 0,
      attempts: 1,
    });
    expect(body.usage.inputTokens).toBeGreaterThan(0);

    expect(await prisma.entry.count()).toBe(entries);
    expect(await prisma.analysis.count()).toBe(0);
    const usages = await prisma.aiUsage.findMany();
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      mode: 'ideas',
      model: 'mock',
      detail: null,
      attempt: 1,
      analysisId: null,
      success: true,
      costUsd: 0,
    });
  });

  it('returns ideas that can be logged as they are: one usual food through quick log, a mix as a new entry', async () => {
    const body = (await ask(agent).expect(200)).body as MealIdeasResponse;
    const [usual, pair] = body.ideas;
    const when = { timestamp: NOW.toISOString(), localDate: TODAY };

    const quick = await agent
      .post('/api/foods/log')
      .send({
        key: usual?.parts[0]?.foodKey,
        servings: usual?.parts[0]?.servings,
        mealType: usual?.mealType,
        ...when,
      })
      .expect(201);
    const created = await agent
      .post('/api/entries')
      .send({
        name: pair?.title,
        mealType: pair?.mealType,
        source: 'copy',
        items: pair?.parts.flatMap((part) => part.items),
        ...when,
      })
      .expect(201);

    expect((quick.body as EntryDto).totals).toEqual(usual?.totals);
    expect((created.body as EntryDto).totals).toEqual(pair?.totals);
    expect((created.body as EntryDto).items.map((i) => i.grams)).toEqual([
      125, 150,
    ]);
    await prisma.entry.deleteMany({
      where: {
        id: {
          in: [(quick.body as EntryDto).id, (created.body as EntryDto).id],
        },
      },
    });
  });

  it('gives other ideas when the shown ones are excluded', async () => {
    const first = (await ask(agent).expect(200)).body as MealIdeasResponse;
    const shown = first.ideas.map((idea) => idea.title);

    const again = (await ask(agent, { exclude: shown }).expect(200))
      .body as MealIdeasResponse;

    expect(again.ideas.length).toBeGreaterThan(0);
    expect(again.ideas.filter((idea) => shown.includes(idea.title))).toEqual(
      [],
    );
  });

  it('rejects incomplete or oversized requests before calling the AI', async () => {
    await agent.post(IDEAS_PATH).send({ localTime: LOCAL_TIME }).expect(400);
    await agent.post(IDEAS_PATH).send({ localDate: TODAY }).expect(400);
    await ask(agent, { localDate: '2026-02-30' }).expect(400);
    await ask(agent, { localTime: '19:30' }).expect(400);
    await ask(agent, {
      note: 'x'.repeat(API_LIMITS.mealIdeaNoteMax + 1),
    }).expect(400);
    await ask(agent, {
      exclude: Array.from(
        { length: API_LIMITS.mealIdeaExcludeMax + 1 },
        (_, index) => `Idea ${index}`,
      ),
    }).expect(400);
    await ask(agent, { exclude: ['x'.repeat(API_LIMITS.nameMax + 1)] }).expect(
      400,
    );
    await ask(agent, { exclude: 'Chicken wrap' }).expect(400);
    await ask(agent, { mealType: 'dinner' }).expect(400);

    expect(await prisma.aiUsage.count()).toBe(0);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(IDEAS_PATH)
      .send({ localDate: TODAY, localTime: LOCAL_TIME })
      .expect(401);
  });
});

describe('meal ideas context, limits and failures (e2e)', () => {
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

  it('tells the AI the targets, what was eaten and logged today, the usual foods and the request', async () => {
    const provider = new CapturingIdeasProvider();
    const { app, prisma, agent } = await startApp(withIdeasProvider(provider));
    try {
      const user = await getTestUser(app);
      await prisma.profile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          aiModel: 'gpt-6-sol',
          location: ' Beirut ',
          goal: 'cut',
        },
        update: { aiModel: 'gpt-6-sol', location: ' Beirut ', goal: 'cut' },
      });
      await agent
        .put(`/api/days/${TODAY}`)
        .send({ trainingDay: true })
        .expect(200);
      await seedUsualFoods(agent);
      const stranger = await createSignedInUser(app);
      await logMeal(
        stranger.agent,
        item('Secret stew', 400, { calories: 500 }),
        0,
      );

      await ask(agent, {
        note: '  eating out tonight  ',
        exclude: [' Tuna sandwich ', 'tuna  sandwich', '', 'Omelette'],
      }).expect(200);

      const [sent] = provider.requests;
      expect(sent?.model).toBe('gpt-6-sol');
      expect(sent?.prompt).toMatchObject({
        count: API_LIMITS.mealIdeasMax,
        localTime: LOCAL_TIME,
        goal: 'cut',
        trainingDay: true,
        location: 'Beirut',
        eaten: OATS.nutrients,
        logged: [
          {
            name: 'Oats with whey',
            mealType: 'breakfast',
            calories: 450,
            protein: 35,
          },
        ],
        exclude: ['Tuna sandwich', 'Omelette'],
        note: 'eating out tonight',
      });
      expect(sent?.prompt.targets.calories).toBeGreaterThan(0);
      expect(
        sent?.prompt.foods.map((food) => [
          food.id,
          food.name,
          food.amount,
          food.nutrients.calories,
          food.useCount,
        ]),
      ).toEqual([
        ['F1', 'Chicken wrap', '320 g', 640, 3],
        ['F2', 'Khoury yogurt', '125 g', 110, 2],
        ['F3', 'Oats with whey', '300 g', 450, 1],
      ]);
    } finally {
      await app.close();
    }
  });

  it('still answers with new ideas for someone who has logged nothing', async () => {
    const { app, agent } = await startApp();
    try {
      const body = (await ask(agent).expect(200)).body as MealIdeasResponse;

      expect(body.ideas).toHaveLength(API_LIMITS.mealIdeasMax);
      expect(
        body.ideas.every((idea) =>
          idea.parts.every((part) => part.foodKey === null),
        ),
      ).toBe(true);
    } finally {
      await app.close();
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

      const response = await ask(agent).expect(429);

      expect((response.body as ApiError).message).toBe(
        'Monthly AI budget reached',
      );
      expect(await prisma.aiUsage.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('returns 429 once a member’s own budget is used up, counting meal ideas', async () => {
    const { app, prisma, agent } = await startApp(
      withAiSettings({ memberMonthlyBudgetUsd: 0.5 }),
    );
    try {
      const member = await createSignedInUser(app);
      await ask(member.agent).expect(200);
      await prisma.aiUsage.updateMany({
        where: { userId: member.user.id, mode: 'ideas' },
        data: { costUsd: 0.5 },
      });

      const response = await ask(member.agent).expect(429);

      expect((response.body as ApiError).message).toBe(
        'Your monthly AI budget is used up',
      );
      await ask(agent).expect(200);
    } finally {
      await app.close();
    }
  });

  it('returns 503 when OpenAI is selected without an API key', async () => {
    const { app, agent } = await startApp(
      withAiSettings({ provider: 'openai', apiKey: null }),
    );
    try {
      const response = await ask(agent).expect(503);
      expect((response.body as ApiError).message).toBe(
        'AI is not configured — an admin can add a provider in Settings → AI',
      );
    } finally {
      await app.close();
    }
  });

  it('retries a retryable failure once and records both attempts as ideas usage', async () => {
    const provider = new FailingIdeasProvider('server_error', true);
    const { app, prisma, agent } = await startApp(withIdeasProvider(provider));
    try {
      const response = await ask(agent).expect(502);

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
        ]),
      ).toEqual([
        ['ideas', 1, false, 'server_error', 'req_ideas_1'],
        ['ideas', 2, false, 'server_error', 'req_ideas_2'],
      ]);
      expect(usages[0]?.costUsd).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('does not retry a quota failure and maps it to 503', async () => {
    const provider = new FailingIdeasProvider('quota_exceeded', false);
    const { app, prisma, agent } = await startApp(withIdeasProvider(provider));
    try {
      await ask(agent).expect(503);
      expect(provider.calls).toBe(1);
      expect(await prisma.aiUsage.count()).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('shares one per-person AI rate limit between analyses and meal ideas', async () => {
    const { perMinute } = aiRateLimits();
    const { app, agent } = await startApp(undefined, true);
    try {
      const member = await createSignedInUser(app);
      const analyzeText = (): request.Test =>
        agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'banana' });
      for (let i = 0; i < perMinute; i += 1) {
        await (i % 2 === 0 ? analyzeText() : ask(agent)).expect(200);
      }

      const limited = await ask(agent).expect(429);
      expect(limited.headers['retry-after-aiminute']).toBeDefined();
      await analyzeText().expect(429);
      await ask(member.agent).expect(200);
    } finally {
      await app.close();
    }
  });
});
