import { randomUUID } from 'node:crypto';
import {
  addDays,
  API_LIMITS,
  computeTargets,
  type DayDashboardResponse,
  type FluidKind,
  type MealType,
  type Micros,
  type Nutrients,
  type ProfileDto,
  type RangeDashboardResponse,
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

const DAY = '2026-09-24';

const DEFAULT_PROFILE: ProfileDto = {
  weightKg: null,
  heightCm: null,
  age: null,
  sex: null,
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 0,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
};

const ATHLETE_PROFILE: ProfileDto = {
  ...DEFAULT_PROFILE,
  weightKg: 75,
  heightCm: 178,
  age: 29,
  sex: 'female',
  activityLevel: 'very',
  goal: 'bulk',
  trainingDaysPerWeek: 4,
};

interface ItemSeed {
  name: string;
  grams: number;
  nutrients: Partial<Nutrients>;
  micros?: Micros | null;
  fluidMl?: number | null;
}

interface EntrySeed {
  localDate: string;
  timestamp: string;
  name?: string;
  mealType?: MealType;
  userId?: string;
  items: ItemSeed[];
}

describe('dashboard (e2e)', () => {
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
    await prisma.profile.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function createEntry(seed: EntrySeed): Promise<string> {
    const { items, totals } = normalizeItems(
      seed.items.map((item) => ({
        name: item.name,
        grams: item.grams,
        nutrients: { ...zeroNutrients(), ...item.nutrients },
        confidence: 'medium' as const,
        micros: item.micros ?? null,
        fluidMl: item.fluidMl ?? null,
      })),
    );
    const entry = await prisma.entry.create({
      data: {
        userId: seed.userId ?? userId,
        name: seed.name ?? seed.items[0]?.name ?? 'Meal',
        mealType: seed.mealType ?? 'lunch',
        source: 'manual',
        timestamp: new Date(seed.timestamp),
        localDate: seed.localDate,
        ...nutrientColumns(totals),
        items: { createMany: { data: items.map(entryItemData) } },
      },
    });
    return entry.id;
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
        timestamp: new Date(`${localDate}T10:00:00.000Z`),
        kind,
        ml,
      },
    });
  }

  async function markTrainingDay(date: string, owner = userId): Promise<void> {
    await prisma.dayMeta.create({
      data: { userId: owner, date, trainingDay: true },
    });
  }

  async function getDay(date: string): Promise<DayDashboardResponse> {
    const response = await agent
      .get('/api/dashboard/day')
      .query({ date })
      .expect(200);
    return response.body as DayDashboardResponse;
  }

  async function getRange(
    from: string,
    to: string,
  ): Promise<RangeDashboardResponse> {
    const response = await agent
      .get('/api/dashboard/range')
      .query({ from, to })
      .expect(200);
    return response.body as RangeDashboardResponse;
  }

  it('requires authentication', async () => {
    const server = app.getHttpServer();
    await request(server).get(`/api/dashboard/day?date=${DAY}`).expect(401);
    await request(server)
      .get(`/api/dashboard/range?from=${DAY}&to=${DAY}`)
      .expect(401);
  });

  describe('GET /api/dashboard/day', () => {
    it('returns an empty day with rest-day targets from the default profile', async () => {
      const body = await getDay(DAY);
      expect(body).toEqual({
        day: {
          date: DAY,
          trainingDay: false,
          targets: computeTargets(DEFAULT_PROFILE).restDay,
          totals: zeroNutrients(),
          entryCount: 0,
          micros: {},
          microsCoverage: { items: 0, withMicros: 0 },
          fluidsMl: 0,
          fluidTargetMl: 2500,
        },
        entries: [],
      });
    });

    it('sums the vitamins and minerals of the day with caffeine from coffee and tea', async () => {
      await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T08:00:00.000Z',
        items: [
          {
            name: 'Vitamin D3 softgel',
            grams: 1,
            nutrients: {},
            micros: { vitaminD: 125 },
          },
          {
            name: 'Soy milk',
            grams: 250,
            nutrients: { calories: 135 },
            micros: { calcium: 300, vitaminD: 2.8, vitaminB12: 0.95 },
          },
          { name: 'Old granola', grams: 40, nutrients: { calories: 180 } },
        ],
      });
      await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T13:00:00.000Z',
        items: [
          {
            name: 'Diet Pepsi',
            grams: 330,
            nutrients: { sodium: 33 },
            micros: { caffeine: 35, potassium: 36 },
          },
        ],
      });
      await createEntry({
        userId: strangerId,
        localDate: DAY,
        timestamp: '2026-09-24T09:00:00.000Z',
        items: [
          {
            name: 'Not mine',
            grams: 1,
            nutrients: {},
            micros: { vitaminD: 1000 },
          },
        ],
      });
      await logFluid(DAY, 'coffee', 250);
      await logFluid(DAY, 'tea', 300);
      await logFluid(DAY, 'water', 500);
      await logFluid(addDays(DAY, 1), 'coffee', 200);
      await logFluid(DAY, 'coffee', 1000, strangerId);

      const body = await getDay(DAY);

      expect(body.day.micros).toEqual({
        vitaminD: 127.8,
        vitaminB12: 0.95,
        calcium: 300,
        potassium: 36,
        caffeine: 195,
      });
      expect(body.day.microsCoverage).toEqual({ items: 4, withMicros: 3 });
      expect(body.entries[0]?.items.map(({ micros }) => micros)).toEqual([
        { vitaminD: 125 },
        { calcium: 300, vitaminD: 2.8, vitaminB12: 0.95 },
        null,
      ]);
      const next = await getDay(addDays(DAY, 1));
      expect(next.day.micros).toEqual({ caffeine: 80 });
      expect(next.day.microsCoverage).toEqual({ items: 0, withMicros: 0 });
    });

    it('adds fluid logs and drinks inside meals against the day’s fluid target', async () => {
      await agent
        .put('/api/profile')
        .send({ ...DEFAULT_PROFILE, weightKg: 80 })
        .expect(200);
      await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T10:30:00.000Z',
        name: 'Chicken burger meal',
        items: [
          { name: 'Chicken burger', grams: 250, nutrients: { calories: 560 } },
          {
            name: 'Diet Pepsi',
            grams: 330,
            nutrients: { sodium: 33 },
            fluidMl: 330,
          },
        ],
      });
      await createEntry({
        userId: strangerId,
        localDate: DAY,
        timestamp: '2026-09-24T10:30:00.000Z',
        items: [{ name: 'Not mine', grams: 500, nutrients: {}, fluidMl: 500 }],
      });
      await logFluid(DAY, 'water', 250);
      await logFluid(DAY, 'water', 250);
      await logFluid(addDays(DAY, 1), 'water', 750);
      await logFluid(DAY, 'water', 2000, strangerId);

      const rest = await getDay(DAY);
      expect(rest.day).toMatchObject({ fluidsMl: 830, fluidTargetMl: 2800 });
      expect(rest.day.totals.calories).toBe(560);
      expect(rest.entries[0]?.items.map(({ fluidMl }) => fluidMl)).toEqual([
        null,
        330,
      ]);

      await markTrainingDay(DAY);
      const training = await getDay(DAY);
      expect(training.day).toMatchObject({
        fluidsMl: 830,
        fluidTargetMl: 3300,
      });

      await agent
        .put('/api/profile')
        .send({ ...DEFAULT_PROFILE, weightKg: 80, fluidTargetMl: 3000 })
        .expect(200);
      const custom = await getDay(DAY);
      expect(custom.day.fluidTargetMl).toBe(3000);
      const next = await getDay(addDays(DAY, 1));
      expect(next.day).toMatchObject({ fluidsMl: 750, fluidTargetMl: 3000 });
    });

    it('sums the day’s entries and lists them by timestamp', async () => {
      const dinner = await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T19:00:00.000Z',
        mealType: 'dinner',
        items: [
          {
            name: 'Salmon',
            grams: 150,
            nutrients: { calories: 312, protein: 30.6, fat: 20.1, satFat: 3.2 },
          },
          {
            name: 'Potatoes',
            grams: 200,
            nutrients: { calories: 154, carbs: 34.2, fiber: 4.4, sodium: 12 },
          },
        ],
      });
      const breakfast = await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T07:30:00.000Z',
        mealType: 'breakfast',
        items: [
          {
            name: 'Oats',
            grams: 60,
            nutrients: { calories: 233.4, protein: 8.1, carbs: 39.8, fiber: 6 },
          },
        ],
      });
      const lunch = await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T12:15:00.000+02:00',
        items: [
          {
            name: 'Beer',
            grams: 500,
            nutrients: { calories: 215, carbs: 17.5, alcohol: 19.7 },
          },
        ],
      });
      await createEntry({
        localDate: addDays(DAY, 1),
        timestamp: '2026-09-25T08:00:00.000Z',
        items: [{ name: 'Toast', grams: 40, nutrients: { calories: 100 } }],
      });
      await createEntry({
        userId: strangerId,
        localDate: DAY,
        timestamp: '2026-09-24T09:00:00.000Z',
        items: [{ name: 'Cake', grams: 100, nutrients: { calories: 400 } }],
      });

      const body = await getDay(DAY);

      expect(body.entries.map((entry) => entry.id)).toEqual([
        breakfast,
        lunch,
        dinner,
      ]);
      expect(body.entries[2]?.items.map((item) => item.name)).toEqual([
        'Salmon',
        'Potatoes',
      ]);
      expect(body.day.entryCount).toBe(3);
      expect(body.day.totals).toEqual({
        calories: 914,
        protein: 38.7,
        carbs: 91.5,
        fat: 20.1,
        satFat: 3.2,
        fiber: 10.4,
        sugar: 0,
        sodium: 12,
        alcohol: 19.7,
      });
    });

    it('uses training-day targets when the day is marked as a training day', async () => {
      await agent.put('/api/profile').send(ATHLETE_PROFILE).expect(200);
      await markTrainingDay(DAY);
      await markTrainingDay(addDays(DAY, 1), strangerId);
      const targets = computeTargets(ATHLETE_PROFILE);

      const training = await getDay(DAY);
      expect(training.day.trainingDay).toBe(true);
      expect(training.day.targets).toEqual(targets.trainingDay);

      const rest = await getDay(addDays(DAY, 1));
      expect(rest.day.trainingDay).toBe(false);
      expect(rest.day.targets).toEqual(targets.restDay);
      expect(rest.day.targets.calories).toBeLessThan(
        training.day.targets.calories,
      );
    });

    it('reflects profile changes in the day targets', async () => {
      const before = await getDay(DAY);
      await agent
        .put('/api/profile')
        .send({ ...DEFAULT_PROFILE, targetOverrides: { calories: 3000 } })
        .expect(200);
      const after = await getDay(DAY);
      expect(before.day.targets.calories).toBe(2000);
      expect(after.day.targets.calories).toBe(3000);
    });

    it.each([
      ['a missing date', {}],
      ['an impossible date', { date: '2026-02-30' }],
      ['a malformed date', { date: '24.09.2026' }],
      ['an unexpected parameter', { date: DAY, userId: 'x' }],
    ])('rejects %s with 400', async (_label, query) => {
      await agent.get('/api/dashboard/day').query(query).expect(400);
    });
  });

  describe('GET /api/dashboard/range', () => {
    it('returns one summary per date, including empty days', async () => {
      const from = addDays(DAY, -3);
      const to = addDays(DAY, 3);
      await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T08:00:00.000Z',
        items: [
          {
            name: 'Eggs',
            grams: 120,
            nutrients: { calories: 186, protein: 15.1, fat: 12.7, satFat: 3.9 },
          },
        ],
      });
      await createEntry({
        localDate: DAY,
        timestamp: '2026-09-24T13:00:00.000Z',
        items: [
          {
            name: 'Pasta',
            grams: 250,
            nutrients: {
              calories: 395,
              protein: 14.5,
              carbs: 77.3,
              fiber: 4.5,
            },
          },
        ],
      });
      await createEntry({
        localDate: to,
        timestamp: '2026-09-27T12:00:00.000Z',
        items: [
          {
            name: 'Burger',
            grams: 300,
            nutrients: {
              calories: 780,
              protein: 40,
              carbs: 60,
              fat: 42,
              satFat: 16,
              sodium: 1400,
            },
          },
        ],
      });
      await createEntry({
        localDate: addDays(to, 1),
        timestamp: '2026-09-28T12:00:00.000Z',
        items: [{ name: 'Outside', grams: 100, nutrients: { calories: 999 } }],
      });
      await createEntry({
        userId: strangerId,
        localDate: from,
        timestamp: '2026-09-21T12:00:00.000Z',
        items: [{ name: 'Not mine', grams: 100, nutrients: { calories: 999 } }],
      });
      await markTrainingDay(to);

      const body = await getRange(from, to);
      const defaults = computeTargets(DEFAULT_PROFILE);

      expect(body.from).toBe(from);
      expect(body.to).toBe(to);
      expect(body.days.map((day) => day.date)).toEqual([
        '2026-09-21',
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
        '2026-09-27',
      ]);
      expect(body.days[0]).toEqual({
        date: from,
        trainingDay: false,
        targets: defaults.restDay,
        totals: zeroNutrients(),
        entryCount: 0,
        micros: {},
        microsCoverage: { items: 0, withMicros: 0 },
        fluidsMl: 0,
        fluidTargetMl: 2500,
      });
      expect(body.days[3]).toMatchObject({
        entryCount: 2,
        totals: { calories: 581, protein: 29.6, carbs: 77.3, fat: 12.7 },
      });
      expect(body.days[6]).toMatchObject({
        trainingDay: true,
        targets: defaults.trainingDay,
        entryCount: 1,
        totals: { calories: 780, satFat: 16 },
      });

      expect(body.stats).toMatchObject({
        loggedDays: 2,
        totalDays: 7,
        satFatOverDays: 0,
        sodiumOverDays: 0,
        fiberHitDays: 0,
      });
      expect(body.stats.avgTotals.calories).toBe(681);
      expect(body.stats.avgTargets.calories).toBe(
        (defaults.restDay.calories + defaults.trainingDay.calories) / 2,
      );
      expect(body.stats.weekdayAverages).toHaveLength(7);
      expect(body.stats.weekdayAverages[4]).toMatchObject({
        weekday: 4,
        loggedDays: 1,
        calories: 581,
      });
      expect(body.stats.weekdayAverages[0]).toMatchObject({
        weekday: 0,
        loggedDays: 1,
        calories: 780,
      });
      expect(body.stats.weekdayAverages[1]).toMatchObject({
        loggedDays: 0,
        calories: 0,
      });
      const split = body.stats.macroSplit;
      expect(
        split.protein + split.carbs + split.fat + split.alcohol,
      ).toBeCloseTo(100, 0);
    });

    it('averages micros over the days where at least half of the items have them', async () => {
      const from = DAY;
      const to = addDays(DAY, 6);
      await createEntry({
        localDate: from,
        timestamp: '2026-09-24T08:00:00.000Z',
        items: [
          {
            name: 'Salmon',
            grams: 150,
            nutrients: { calories: 309 },
            micros: { vitaminD: 19.7, potassium: 576 },
          },
          {
            name: 'Rice',
            grams: 180,
            nutrients: { calories: 234 },
            micros: { potassium: 63 },
          },
        ],
      });
      await createEntry({
        localDate: addDays(from, 1),
        timestamp: '2026-09-25T08:00:00.000Z',
        items: [
          {
            name: 'Vitamin D3 softgel',
            grams: 1,
            nutrients: {},
            micros: { vitaminD: 125 },
          },
          { name: 'Old toast', grams: 40, nutrients: { calories: 100 } },
        ],
      });
      await createEntry({
        localDate: addDays(from, 2),
        timestamp: '2026-09-26T08:00:00.000Z',
        items: [
          {
            name: 'Banana',
            grams: 118,
            nutrients: { calories: 105 },
            micros: { potassium: 422 },
          },
          { name: 'Old cereal', grams: 40, nutrients: { calories: 150 } },
          { name: 'Old milk', grams: 200, nutrients: { calories: 100 } },
        ],
      });
      await logFluid(addDays(from, 3), 'coffee', 250);

      const body = await getRange(from, to);

      expect(body.stats.microsDays).toBe(2);
      expect(body.stats.avgMicros).toEqual({
        vitaminD: 72.4,
        potassium: 639,
      });
      expect(body.stats.microsCoverage).toEqual({ items: 7, withMicros: 4 });
      expect(body.days[3]?.micros).toEqual({ caffeine: 100 });
    });

    it('reports fluids per day and averages them over the days with any fluid', async () => {
      const from = DAY;
      const to = addDays(DAY, 6);
      await agent
        .put('/api/profile')
        .send({ ...DEFAULT_PROFILE, weightKg: 80 })
        .expect(200);
      await markTrainingDay(addDays(from, 1));
      await createEntry({
        localDate: from,
        timestamp: '2026-09-24T10:30:00.000Z',
        items: [
          { name: 'Diet Pepsi', grams: 330, nutrients: {}, fluidMl: 330 },
        ],
      });
      await logFluid(from, 'water', 2500);
      await logFluid(addDays(from, 1), 'water', 1500);
      await logFluid(addDays(from, 1), 'coffee', 200);
      await logFluid(addDays(from, 3), 'tea', 300);
      await logFluid(addDays(to, 1), 'water', 3000);
      await logFluid(addDays(from, 2), 'water', 3000, strangerId);

      const body = await getRange(from, to);

      expect(
        body.days.map(({ fluidsMl, fluidTargetMl }) => [
          fluidsMl,
          fluidTargetMl,
        ]),
      ).toEqual([
        [2830, 2800],
        [1700, 3300],
        [0, 2800],
        [300, 2800],
        [0, 2800],
        [0, 2800],
        [0, 2800],
      ]);
      expect(body.stats).toMatchObject({
        avgFluidsMl: 1610,
        fluidDays: 3,
        fluidHitDays: 1,
      });
    });

    it('returns zeroed stats when nothing was logged', async () => {
      const body = await getRange(DAY, addDays(DAY, 6));
      expect(body.days).toHaveLength(7);
      expect(body.days.every((day) => day.entryCount === 0)).toBe(true);
      expect(body.stats).toMatchObject({
        loggedDays: 0,
        totalDays: 7,
        avgTotals: zeroNutrients(),
        proteinHitDays: 0,
        calorieOnTargetDays: 0,
        avgMicros: {},
        microsCoverage: { items: 0, withMicros: 0 },
        microsDays: 0,
        avgFluidsMl: 0,
        fluidDays: 0,
        fluidHitDays: 0,
      });
      expect(body.stats.avgTargets.calories).toBe(2000);
    });

    it('supports a single-day range and the maximum span', async () => {
      const single = await getRange(DAY, DAY);
      expect(single.days).toHaveLength(1);

      const maxTo = addDays(DAY, API_LIMITS.rangeMaxDays - 1);
      const max = await getRange(DAY, maxTo);
      expect(max.days).toHaveLength(API_LIMITS.rangeMaxDays);
      expect(max.days.at(-1)?.date).toBe(maxTo);
    });

    it('rejects a range that ends before it starts', async () => {
      const response = await agent
        .get('/api/dashboard/range')
        .query({ from: DAY, to: addDays(DAY, -1) })
        .expect(400);
      expect((response.body as { message: string[] }).message).toContain(
        'to must be on or after from',
      );
    });

    it('rejects a range longer than the maximum span', async () => {
      const response = await agent
        .get('/api/dashboard/range')
        .query({ from: DAY, to: addDays(DAY, API_LIMITS.rangeMaxDays) })
        .expect(400);
      expect((response.body as { message: string[] }).message).toContain(
        `the range from..to must span at most ${API_LIMITS.rangeMaxDays} days`,
      );
    });

    it.each([
      ['a missing from', { to: DAY }],
      ['a missing to', { from: DAY }],
      ['an invalid from', { from: '2026-13-01', to: DAY }],
      ['an invalid to', { from: DAY, to: 'tomorrow' }],
    ])('rejects %s with 400', async (_label, query) => {
      await agent.get('/api/dashboard/range').query(query).expect(400);
    });
  });
});
