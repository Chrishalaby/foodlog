import type { DaySummariesService } from '../dashboard/day-summaries.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProfileService } from '../profile/profile.service.js';
import type { WeightsService } from '../weights/weights.service.js';
import { InsightsService, latestDate, todayUtc } from './insights.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';

function setup() {
  const prisma = {
    entry: {
      aggregate: vi.fn().mockResolvedValue({
        _min: { localDate: '2026-09-01' },
        _max: { localDate: '2026-09-30' },
      }),
    },
    fluidLog: {
      aggregate: vi.fn().mockResolvedValue({ _max: { localDate: null } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  };
  const summaries = { forRange: vi.fn().mockResolvedValue([]) };
  const profiles = {
    getProfile: vi.fn().mockResolvedValue({
      weightKg: 80,
      heightCm: 180,
      age: 16,
      sex: 'male',
      activityLevel: 'moderate',
      goal: 'maintain',
      trainingDaysPerWeek: 3,
      targetOverrides: {},
    }),
  };
  const weights = {
    signals: vi.fn().mockResolvedValue({ weights: [], adaptiveTdee: null }),
  };
  const service = new InsightsService(
    prisma as unknown as PrismaService,
    summaries as unknown as DaySummariesService,
    profiles as unknown as ProfileService,
    weights as unknown as WeightsService,
  );
  return { prisma, summaries, weights, service };
}

function summary(date: string, fluidsMl: number) {
  return {
    date,
    trainingDay: false,
    targets: {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
      satFatMax: 22,
      fiberMin: 28,
      sugarMax: 90,
      sodiumMax: 2300,
    },
    totals: {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
      satFat: 10,
      fiber: 30,
      sugar: 40,
      sodium: 1500,
      alcohol: 0,
    },
    entryCount: 3,
    micros: {},
    microsCoverage: { items: 3, withMicros: 0 },
    fluidsMl,
    fluidTargetMl: 2800,
  };
}

describe('latestDate', () => {
  it('picks the latest of the known dates', () => {
    expect(latestDate('2026-09-30', '2026-10-01')).toBe('2026-10-01');
    expect(latestDate('2026-10-01', null)).toBe('2026-10-01');
    expect(latestDate(undefined, '2026-09-29')).toBe('2026-09-29');
    expect(latestDate(null, undefined)).toBeNull();
  });
});

describe('todayUtc', () => {
  it('is the UTC calendar date', () => {
    expect(todayUtc(new Date('2026-10-01T22:30:00.000Z'))).toBe('2026-10-01');
  });
});

describe('InsightsService', () => {
  it('trusts the date the client asks for', async () => {
    const { service, summaries } = setup();

    const response = await service.insights(USER_ID, {
      to: '2026-10-01',
      days: 7,
    });

    expect(response).toMatchObject({ from: '2026-09-25', to: '2026-10-01' });
    expect(summaries.forRange).toHaveBeenCalledWith(
      USER_ID,
      '2026-09-25',
      '2026-10-01',
    );
  });

  it('defaults to the latest logical date with food or fluids', async () => {
    const { prisma, service, weights } = setup();
    prisma.fluidLog.aggregate.mockResolvedValue({
      _max: { localDate: '2026-10-01' },
    });

    const response = await service.insights(USER_ID, {});

    expect(response.to).toBe('2026-10-01');
    expect(prisma.fluidLog.aggregate).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      _max: { localDate: true },
    });
    expect(weights.signals).toHaveBeenCalledWith(USER_ID, '2026-10-01');
  });

  it('applies the caffeine limit for the user’s age', async () => {
    const { service, summaries } = setup();
    summaries.forRange.mockResolvedValue([
      {
        date: '2026-10-01',
        trainingDay: false,
        targets: {
          calories: 2000,
          protein: 150,
          carbs: 200,
          fat: 70,
          satFatMax: 22,
          fiberMin: 28,
          sugarMax: 90,
          sodiumMax: 2300,
        },
        totals: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          satFat: 0,
          fiber: 0,
          sugar: 0,
          sodium: 0,
          alcohol: 0,
        },
        entryCount: 1,
        micros: { caffeine: 150 },
        microsCoverage: { items: 1, withMicros: 1 },
        fluidsMl: 0,
        fluidTargetMl: 2800,
      },
    ]);

    const response = await service.insights(USER_ID, { to: '2026-10-01' });

    expect(
      response.insights.find(({ id }) => id === 'caffeine-high')?.title,
    ).toBe('Caffeine over 100 mg on 1 of 1 days');
  });

  it('judges fluids only on days with a fluid log', async () => {
    const { prisma, service, summaries } = setup();
    const dates = [
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ];
    summaries.forRange.mockResolvedValue(
      dates.map((date) => summary(date, 330)),
    );

    const mealDrinksOnly = await service.insights(USER_ID, {
      to: '2026-10-01',
    });
    expect(mealDrinksOnly.insights.map(({ id }) => id)).not.toContain(
      'fluids-low',
    );
    expect(prisma.fluidLog.groupBy).toHaveBeenCalledWith({
      by: ['localDate'],
      where: {
        userId: USER_ID,
        localDate: { gte: '2026-09-25', lte: '2026-10-01' },
      },
    });

    prisma.fluidLog.groupBy.mockResolvedValue(
      dates.slice(3).map((localDate) => ({ localDate })),
    );
    const tracked = await service.insights(USER_ID, { to: '2026-10-01' });
    expect(tracked.insights.find(({ id }) => id === 'fluids-low')?.title).toBe(
      'Fluids under 70% of your target on 4 of 4 days',
    );
  });
});
