import { computeTargets, zeroNutrients } from '@food/shared';
import {
  buildDaySummaries,
  buildDaySummary,
  nutrientsFromSums,
} from './day-summaries.js';

const TARGETS = computeTargets({
  weightKg: 80,
  heightCm: 180,
  age: 35,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 3,
  targetOverrides: {},
});

describe('nutrientsFromSums', () => {
  it('treats missing and null sums as zero', () => {
    expect(nutrientsFromSums(null)).toEqual(zeroNutrients());
    expect(nutrientsFromSums(undefined)).toEqual(zeroNutrients());
    expect(
      nutrientsFromSums({
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
        satFat: null,
        fiber: null,
        sugar: null,
        sodium: null,
        alcohol: null,
      }),
    ).toEqual(zeroNutrients());
  });

  it('rounds away floating point noise from database sums', () => {
    const totals = nutrientsFromSums({
      calories: 1234.5000000001,
      protein: 0.1 + 0.2,
      carbs: 10,
      fat: 3.3000000000000003,
      satFat: 0,
      fiber: 7.05,
      sugar: 1,
      sodium: 999.6,
      alcohol: 0,
    });
    expect(totals).toMatchObject({
      calories: 1235,
      protein: 0.3,
      fat: 3.3,
      fiber: 7.1,
      sodium: 1000,
    });
  });
});

describe('buildDaySummary', () => {
  it('picks training or rest day targets', () => {
    expect(TARGETS.trainingDay.calories).toBeGreaterThan(
      TARGETS.restDay.calories,
    );
    expect(
      buildDaySummary('2026-09-28', true, TARGETS, undefined).targets,
    ).toEqual(TARGETS.trainingDay);
    expect(
      buildDaySummary('2026-09-28', false, TARGETS, undefined).targets,
    ).toEqual(TARGETS.restDay);
  });

  it('copies targets so callers cannot mutate the shared result', () => {
    const summary = buildDaySummary('2026-09-28', true, TARGETS, undefined);
    summary.targets.calories = 1;
    expect(TARGETS.trainingDay.calories).not.toBe(1);
  });
});

describe('day micros', () => {
  it('copies the micros and coverage of the day', () => {
    const dayMicros = {
      micros: { vitaminD: 125, caffeine: 35 },
      coverage: { items: 3, withMicros: 2 },
    };
    const summary = buildDaySummary(
      '2026-09-28',
      false,
      TARGETS,
      undefined,
      dayMicros,
    );

    expect(summary).toMatchObject({
      micros: { vitaminD: 125, caffeine: 35 },
      microsCoverage: { items: 3, withMicros: 2 },
    });
    summary.micros.vitaminD = 1;
    summary.microsCoverage.items = 9;
    expect(dayMicros.micros.vitaminD).toBe(125);
    expect(dayMicros.coverage.items).toBe(3);
  });

  it('gives each date its own micros', () => {
    const summaries = buildDaySummaries(
      ['2026-09-27', '2026-09-28'],
      new Map(),
      new Set(),
      TARGETS,
      new Map([
        [
          '2026-09-28',
          { micros: { iron: 9 }, coverage: { items: 1, withMicros: 1 } },
        ],
      ]),
    );

    expect(
      summaries.map(({ micros, microsCoverage }) => [micros, microsCoverage]),
    ).toEqual([
      [{}, { items: 0, withMicros: 0 }],
      [{ iron: 9 }, { items: 1, withMicros: 1 }],
    ]);
  });
});

describe('day fluids', () => {
  it('reports the fluids of the day against its target', () => {
    expect(
      buildDaySummary('2026-10-01', false, TARGETS, undefined, undefined, {
        ml: 830,
        targetMl: 2800,
      }),
    ).toMatchObject({ fluidsMl: 830, fluidTargetMl: 2800 });
  });

  it('gives each date its fluids and a target for its day type', () => {
    const summaries = buildDaySummaries(
      ['2026-09-30', '2026-10-01', '2026-10-02'],
      new Map(),
      new Set(['2026-10-02']),
      TARGETS,
      new Map(),
      {
        profile: { weightKg: 80, fluidTargetMl: null },
        mlByDate: new Map([['2026-10-01', 830]]),
      },
    );

    expect(
      summaries.map(({ date, fluidsMl, fluidTargetMl }) => [
        date,
        fluidsMl,
        fluidTargetMl,
      ]),
    ).toEqual([
      ['2026-09-30', 0, 2800],
      ['2026-10-01', 830, 2800],
      ['2026-10-02', 0, 3300],
    ]);
  });
});

describe('buildDaySummaries', () => {
  it('returns one summary per date, zero-filled for empty days', () => {
    const totals = { ...zeroNutrients(), calories: 850, protein: 60 };
    const summaries = buildDaySummaries(
      ['2026-09-27', '2026-09-28', '2026-09-29'],
      new Map([['2026-09-28', { totals, entryCount: 2 }]]),
      new Set(['2026-09-29']),
      TARGETS,
    );

    expect(summaries.map((day) => day.date)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
    ]);
    expect(summaries[0]).toEqual({
      date: '2026-09-27',
      trainingDay: false,
      targets: TARGETS.restDay,
      totals: zeroNutrients(),
      entryCount: 0,
      micros: {},
      microsCoverage: { items: 0, withMicros: 0 },
      fluidsMl: 0,
      fluidTargetMl: 0,
    });
    expect(summaries[1]).toMatchObject({ totals, entryCount: 2 });
    expect(summaries[2]).toMatchObject({
      trainingDay: true,
      targets: TARGETS.trainingDay,
      entryCount: 0,
    });
  });
});
