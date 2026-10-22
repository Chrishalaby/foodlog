import { randomUUID } from 'node:crypto';
import {
  addDays,
  eachDate,
  type FluidKind,
  type Insight,
  type InsightsResponse,
  type Nutrients,
  type ProfileDto,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { entryItemData, normalizeItems } from '../src/common/items.js';
import { nutrientColumns } from '../src/common/mappers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const WEEK_START = '2026-09-21';
const WEEK_END = '2026-09-27';

const BALANCED: Partial<Nutrients> = {
  calories: 2000,
  protein: 130,
  carbs: 230,
  fat: 65,
  satFat: 15,
  fiber: 30,
  sugar: 50,
  sodium: 1800,
};

const PROFILE: ProfileDto = {
  weightKg: 80,
  heightCm: 180,
  age: 35,
  sex: 'male',
  bodyFatPct: null,
  tdeeOverride: 2000,
  onboarded: true,
  activityLevel: 'moderate',
  goal: 'cut',
  trainingDaysPerWeek: 0,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
};

function ids(insights: readonly Insight[]): string[] {
  return insights.map((insight) => insight.id);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('insights (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let userId: string;
  let strangerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
    strangerId = (
      await prisma.user.create({
        data: {
          email: `stranger-${randomUUID()}@example.com`,
          passwordHash: 'x',
        },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.entry.deleteMany();
    await prisma.fluidLog.deleteMany();
    await prisma.dayMeta.deleteMany();
    await prisma.weightLog.deleteMany();
    await prisma.profile.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function logDay(
    localDate: string,
    nutrients: Partial<Nutrients>,
    owner = userId,
  ): Promise<void> {
    const { items, totals } = normalizeItems([
      {
        name: 'Day total',
        grams: 1000,
        nutrients: { ...zeroNutrients(), ...nutrients },
        confidence: 'medium',
      },
    ]);
    await prisma.entry.create({
      data: {
        userId: owner,
        name: 'Everything',
        mealType: 'dinner',
        source: 'manual',
        timestamp: new Date(`${localDate}T18:00:00.000Z`),
        localDate,
        ...nutrientColumns(totals),
        items: { createMany: { data: items.map(entryItemData) } },
      },
    });
  }

  async function logFluid(
    localDate: string,
    kind: FluidKind,
    ml: number,
    owner = userId,
  ): Promise<void> {
    await prisma.fluidLog.create({
      data: {
        userId: owner,
        localDate,
        timestamp: new Date(`${localDate}T09:00:00.000Z`),
        kind,
        ml,
      },
    });
  }

  async function logMealWithDietPepsi(localDate: string): Promise<void> {
    const { items, totals } = normalizeItems([
      {
        name: 'Chicken burger',
        grams: 250,
        nutrients: { ...zeroNutrients(), ...BALANCED },
        confidence: 'medium',
      },
      {
        name: 'Diet Pepsi',
        grams: 330,
        nutrients: zeroNutrients(),
        confidence: 'high',
        fluidMl: 330,
      },
    ]);
    await prisma.entry.create({
      data: {
        userId,
        name: 'Chicken burger meal',
        mealType: 'dinner',
        source: 'food_photo',
        timestamp: new Date(`${localDate}T18:00:00.000Z`),
        localDate,
        ...nutrientColumns(totals),
        items: { createMany: { data: items.map(entryItemData) } },
      },
    });
  }

  async function logPreWorkout(localDate: string): Promise<void> {
    const { items, totals } = normalizeItems([
      {
        name: 'C4 pre-workout',
        grams: 6.5,
        nutrients: zeroNutrients(),
        confidence: 'high',
        micros: { caffeine: 200 },
      },
    ]);
    await prisma.entry.create({
      data: {
        userId,
        name: 'C4 pre-workout',
        mealType: 'snack',
        source: 'manual',
        timestamp: new Date(`${localDate}T16:00:00.000Z`),
        localDate,
        ...nutrientColumns(totals),
        items: { createMany: { data: items.map(entryItemData) } },
      },
    });
  }

  async function logWeek(
    nutrientsFor: (index: number) => Partial<Nutrients> | null,
  ): Promise<void> {
    for (let index = 0; index < 7; index++) {
      const nutrients = nutrientsFor(index);
      if (nutrients) {
        await logDay(addDays(WEEK_START, index), nutrients);
      }
    }
  }

  async function logWeights(
    to: string,
    days: number,
    weeklyKg: number,
    owner = userId,
  ): Promise<void> {
    const dates = eachDate(addDays(to, -(days - 1)), to);
    await prisma.weightLog.createMany({
      data: dates.map((date, index) => ({
        userId: owner,
        date,
        weightKg: 80 + (weeklyKg / 7) * (index - (days - 1)),
      })),
    });
  }

  async function saveProfile(patch: Partial<ProfileDto> = {}): Promise<void> {
    await agent
      .put('/api/profile')
      .send({ ...PROFILE, ...patch })
      .expect(200);
  }

  function findInsight(body: InsightsResponse, id: string): Insight {
    const match = body.insights.find((insight) => insight.id === id);
    if (!match) {
      throw new Error(`expected ${id} in ${ids(body.insights).join(', ')}`);
    }
    return match;
  }

  async function getInsights(
    query: Record<string, string | number> = {},
  ): Promise<InsightsResponse> {
    const response = await agent.get('/api/insights').query(query).expect(200);
    return response.body as InsightsResponse;
  }

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/insights').expect(401);
  });

  it('defaults to the 7 days ending today (UTC) when nothing is logged', async () => {
    const before = todayUtc();
    const body = await getInsights();
    const after = todayUtc();

    expect([before, after]).toContain(body.to);
    expect(body.from).toBe(addDays(body.to, -6));
    expect(ids(body.insights)).toEqual(['not-enough-data']);
    expect(body.insights[0]).toMatchObject({
      severity: 'info',
      title: 'Not enough data yet',
    });
  });

  it('defaults the window to end on the latest logged date, ignoring other users', async () => {
    await logWeek(() => BALANCED);
    await logDay('2026-10-30', BALANCED, strangerId);

    const body = await getInsights();

    expect(body.from).toBe(WEEK_START);
    expect(body.to).toBe(WEEK_END);
    expect(ids(body.insights)).toEqual([
      'calories-on-target',
      'protein-hit',
      'fiber-good',
    ]);
  });

  it('finds the patterns of a crafted week, warnings first', async () => {
    await logWeek((index) => ({
      ...BALANCED,
      satFat: index < 5 ? 31 : 12,
      sodium: index < 2 ? 3000 : 1500,
      fiber: index < 4 ? 7 : 26,
      protein: index < 3 ? 130 : 80,
      alcohol: index >= 4 ? 24 : 0,
    }));

    const body = await getInsights({ to: WEEK_END, days: 7 });
    const severities = body.insights.map((insight) => insight.severity);

    expect(ids(body.insights)).toEqual([
      'protein-low',
      'fiber-low',
      'satfat-over',
      'sodium-over',
      'alcohol-days',
      'calories-on-target',
    ]);
    expect(severities).toEqual([
      'warning',
      'warning',
      'warning',
      'info',
      'info',
      'good',
    ]);
    const satFat = body.insights.find(
      (insight) => insight.id === 'satfat-over',
    );
    expect(satFat?.title).toBe(
      'Saturated fat over your limit on 5 of 7 logged days',
    );
    expect(satFat?.detail).toContain('31 g vs your limit of 22 g');
    const sodium = body.insights.find(
      (insight) => insight.id === 'sodium-over',
    );
    expect(sodium?.title).toBe('Sodium over your limit on 2 of 7 logged days');
  });

  it('uses training-day metadata for the rest-day protein and carb rules', async () => {
    const trainingIndexes = new Set([0, 2, 4]);
    for (const index of trainingIndexes) {
      await prisma.dayMeta.create({
        data: {
          userId,
          date: addDays(WEEK_START, index),
          trainingDay: true,
        },
      });
    }
    await logWeek((index) =>
      trainingIndexes.has(index)
        ? { ...BALANCED, protein: 140, carbs: 180 }
        : { ...BALANCED, protein: 70 },
    );

    const body = await getInsights({ to: WEEK_END });

    expect(ids(body.insights)).toContain('protein-rest-days');
    expect(ids(body.insights)).toContain('carbs-training-days');
    const rest = body.insights.find(
      (insight) => insight.id === 'protein-rest-days',
    );
    expect(rest?.detail).toContain(
      'You hit your protein target on 0 of 4 rest days vs 3 of 3 training days.',
    );
  });

  it('reports logging gaps over a longer window once tracking began before it', async () => {
    await logDay(addDays(WEEK_START, -30), BALANCED);
    await logWeek(() => BALANCED);

    const body = await getInsights({ to: WEEK_END, days: 14 });

    expect(body.from).toBe(addDays(WEEK_END, -13));
    const gaps = body.insights.find((insight) => insight.id === 'logging-gaps');
    expect(gaps).toMatchObject({
      severity: 'info',
      title: 'Logged 7 of 14 days',
    });
  });

  it('does not report logging gaps for days before the first entry', async () => {
    await logWeek((index) => (index >= 3 ? BALANCED : null));

    const body = await getInsights({ to: WEEK_END });

    expect(body.from).toBe(WEEK_START);
    expect(ids(body.insights)).not.toContain('logging-gaps');
    expect(ids(body.insights)).toContain('calories-on-target');
  });

  it('only reports the progress hint below three logged days', async () => {
    await logWeek((index) => (index < 2 ? { ...BALANCED, satFat: 50 } : null));

    const body = await getInsights({ to: WEEK_END });

    expect(ids(body.insights)).toEqual(['not-enough-data']);
    expect(body.insights[0]?.detail).toContain('2 of 7 days');
  });

  describe('fluids and caffeine', () => {
    it('warns about low fluids and notes a day over the caffeine limit', async () => {
      await saveProfile();
      await logWeek(() => BALANCED);
      for (let index = 0; index < 7; index++) {
        const date = addDays(WEEK_START, index);
        await logFluid(date, 'water', index < 4 ? 1500 : 2300);
      }
      await logFluid(addDays(WEEK_START, 4), 'water', 600);
      await logFluid(addDays(WEEK_START, 5), 'water', 600);
      await logFluid(WEEK_END, 'coffee', 600);
      await logPreWorkout(WEEK_END);
      await logFluid(addDays(WEEK_START, 2), 'coffee', 3000, strangerId);

      const body = await getInsights({ to: WEEK_END });

      expect(findInsight(body, 'fluids-low')).toEqual({
        id: 'fluids-low',
        severity: 'warning',
        title: 'Fluids under 70% of your target on 4 of 7 days',
        detail: expect.stringContaining(
          'you averaged 2.1 L a day vs your target of 2.8 L',
        ) as string,
      });
      expect(findInsight(body, 'caffeine-high')).toMatchObject({
        severity: 'info',
        title: 'Caffeine over 400 mg on 1 of 7 days',
        detail: expect.stringContaining('about 440 mg') as string,
      });
      const order = ids(body.insights);
      expect(order.indexOf('fluids-low')).toBeLessThan(
        order.indexOf('caffeine-high'),
      );
    });

    it('judges fluids only on the days a fluid was logged', async () => {
      await saveProfile();
      for (let index = 0; index < 7; index++) {
        await logMealWithDietPepsi(addDays(WEEK_START, index));
      }

      const mealsOnly = await getInsights({ to: WEEK_END });
      expect(ids(mealsOnly.insights)).not.toContain('fluids-low');

      for (let index = 3; index < 7; index++) {
        await logFluid(addDays(WEEK_START, index), 'water', 500);
      }
      const tracked = await getInsights({ to: WEEK_END });
      expect(findInsight(tracked, 'fluids-low')).toMatchObject({
        title: 'Fluids under 70% of your target on 4 of 4 days',
        detail: expect.stringContaining(
          'you averaged 0.8 L a day vs your target of 2.8 L',
        ) as string,
      });
    });

    it('stays quiet when fluids are on target and caffeine is moderate', async () => {
      await saveProfile();
      await logWeek(() => BALANCED);
      for (let index = 0; index < 7; index++) {
        await logFluid(addDays(WEEK_START, index), 'water', 2500);
        await logFluid(addDays(WEEK_START, index), 'coffee', 300);
      }

      const body = await getInsights({ to: WEEK_END });

      expect(ids(body.insights)).not.toContain('fluids-low');
      expect(ids(body.insights)).not.toContain('caffeine-high');
    });

    it('uses the lower caffeine limit for teenagers', async () => {
      await saveProfile({ age: 16 });
      await logWeek(() => BALANCED);
      await logFluid(WEEK_END, 'tea', 600);

      const body = await getInsights({ to: WEEK_END });

      expect(findInsight(body, 'caffeine-high').title).toBe(
        'Caffeine over 100 mg on 1 of 7 days',
      );
    });

    it('defaults the window to end on the latest date with fluids', async () => {
      await logWeek(() => BALANCED);
      await logFluid(addDays(WEEK_END, 1), 'water', 500);
      await logFluid(addDays(WEEK_END, 9), 'water', 500, strangerId);

      const body = await getInsights();

      expect(body.to).toBe(addDays(WEEK_END, 1));
    });
  });

  describe('body insights', () => {
    it('relates the weekly weight change to the goal', async () => {
      await saveProfile({ goal: 'cut' });
      await logWeek(() => BALANCED);
      await logWeights(WEEK_END, 21, -0.6);

      const body = await getInsights({ to: WEEK_END });

      expect(findInsight(body, 'weight-trend')).toMatchObject({
        severity: 'good',
        title: 'Losing weight at a steady pace',
      });
      expect(findInsight(body, 'weight-trend').detail).toContain(
        'losing about 0.6 kg a week (0.75% of your body weight)',
      );
    });

    it('warns about gaining on a cut, even before three days of food are logged', async () => {
      await saveProfile({ goal: 'cut' });
      await logWeights(WEEK_END, 14, 0.4);

      const body = await getInsights({ to: WEEK_END });

      expect(ids(body.insights)).toEqual(['weight-trend', 'not-enough-data']);
      expect(body.insights[0]).toMatchObject({
        severity: 'warning',
        title: 'Gaining weight on a cut',
      });
      expect(body.insights[0]?.detail).toMatch(
        /^Over the last 2 weeks you have been gaining about 0\.4 kg a week/,
      );
    });

    it('uses the profile goal', async () => {
      await saveProfile({ goal: 'bulk' });
      await logWeights(WEEK_END, 21, 0.2);

      const body = await getInsights({ to: WEEK_END });

      expect(findInsight(body, 'weight-trend')).toMatchObject({
        severity: 'good',
        title: 'Gaining at a lean pace',
      });
    });

    it('omits the weight trend without enough weigh-ins or with only another user’s', async () => {
      await saveProfile();
      await prisma.weightLog.createMany({
        data: [
          { userId, date: addDays(WEEK_END, -3), weightKg: 80 },
          { userId, date: WEEK_END, weightKg: 79.5 },
        ],
      });
      await logWeights(WEEK_END, 21, 0.5, strangerId);

      const body = await getInsights({ to: WEEK_END });

      expect(ids(body.insights)).not.toContain('weight-trend');
    });

    it('ignores weigh-ins after the window end', async () => {
      await saveProfile();
      await logWeights(addDays(WEEK_END, 30), 21, 0.5);

      const body = await getInsights({ to: WEEK_END });

      expect(ids(body.insights)).not.toContain('weight-trend');
    });

    it('suggests the measured burn when it differs from the setting by more than 10 %', async () => {
      await saveProfile({ goal: 'maintain', tdeeOverride: 2000 });
      for (const date of eachDate(
        addDays(WEEK_END, -28),
        addDays(WEEK_END, -1),
      )) {
        await logDay(date, { ...BALANCED, calories: 2500 });
      }
      await logWeights(addDays(WEEK_END, -1), 28, 0);

      const body = await getInsights({ to: WEEK_END });

      const adaptive = findInsight(body, 'adaptive-tdee');
      expect(adaptive).toMatchObject({
        severity: 'info',
        title: 'Your measured burn is higher than your setting',
      });
      expect(adaptive.detail).toContain(
        'Your measured burn is about 2,500 kcal/day, 500 kcal higher than your current setting — you can adopt it in Stats → Weight.',
      );
      expect(findInsight(body, 'weight-trend')).toMatchObject({
        severity: 'good',
        title: 'Weight stable',
      });
    });

    it('stays quiet when the measured burn matches the setting', async () => {
      await saveProfile({ goal: 'maintain', tdeeOverride: 2400 });
      for (const date of eachDate(
        addDays(WEEK_END, -28),
        addDays(WEEK_END, -1),
      )) {
        await logDay(date, { ...BALANCED, calories: 2500 });
      }
      await logWeights(addDays(WEEK_END, -1), 28, 0);

      const body = await getInsights({ to: WEEK_END });

      expect(ids(body.insights)).not.toContain('adaptive-tdee');
    });
  });

  it.each([
    ['days below 7', { days: 6 }],
    ['days above 90', { days: 91 }],
    ['fractional days', { days: 7.5 }],
    ['non-numeric days', { days: 'week' }],
    ['an invalid to date', { to: '2026-09-31' }],
    ['an unexpected parameter', { from: WEEK_START }],
  ])('rejects %s with 400', async (_label, query) => {
    await agent.get('/api/insights').query(query).expect(400);
  });

  it('accepts the boundary window sizes', async () => {
    const min = await getInsights({ to: WEEK_END, days: 7 });
    expect(min.from).toBe(WEEK_START);
    const max = await getInsights({ to: WEEK_END, days: 90 });
    expect(max.from).toBe(addDays(WEEK_END, -89));
  });
});
