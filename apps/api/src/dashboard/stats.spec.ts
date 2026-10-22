import {
  addDays,
  type DaySummary,
  type Micros,
  type MicrosCoverage,
  type Nutrients,
  type TargetValues,
  zeroNutrients,
} from '@food/shared';
import {
  averageNutrients,
  averageTargets,
  caloriesOnTarget,
  computeRangeStats,
  fiberHit,
  fluidHit,
  hasFluids,
  proteinHit,
  satFatOver,
  sodiumOver,
  sugarOver,
  weekdayAverages,
} from './stats.js';

const MONDAY = '2026-09-21';

const TARGETS: TargetValues = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 70,
  satFatMax: 22,
  fiberMin: 28,
  sugarMax: 90,
  sodiumMax: 2300,
};

const BALANCED: Nutrients = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 67,
  satFat: 15,
  fiber: 30,
  sugar: 50,
  sodium: 1800,
  alcohol: 0,
};

interface DayOptions {
  totals?: Partial<Nutrients>;
  targets?: Partial<TargetValues>;
  trainingDay?: boolean;
  entryCount?: number;
  micros?: Micros;
  microsCoverage?: MicrosCoverage;
  fluidsMl?: number;
  fluidTargetMl?: number;
}

function day(date: string, options: DayOptions = {}): DaySummary {
  return {
    date,
    trainingDay: options.trainingDay ?? false,
    targets: { ...TARGETS, ...options.targets },
    totals: { ...BALANCED, ...options.totals },
    entryCount: options.entryCount ?? 3,
    micros: { ...options.micros },
    microsCoverage: options.microsCoverage ?? { items: 0, withMicros: 0 },
    fluidsMl: options.fluidsMl ?? 0,
    fluidTargetMl: options.fluidTargetMl ?? 2800,
  };
}

function emptyDay(date: string, options: DayOptions = {}): DaySummary {
  return {
    ...day(date, options),
    totals: zeroNutrients(),
    entryCount: 0,
  };
}

function week(
  build: (date: string, index: number) => DaySummary,
  start = MONDAY,
  length = 7,
): DaySummary[] {
  return Array.from({ length }, (_, index) =>
    build(addDays(start, index), index),
  );
}

describe('day predicates', () => {
  it('counts protein as hit from 90 % of the target', () => {
    expect(proteinHit(day(MONDAY, { totals: { protein: 135 } }))).toBe(true);
    expect(proteinHit(day(MONDAY, { totals: { protein: 134.9 } }))).toBe(false);
  });

  it('counts calories on target within ±10 % inclusive', () => {
    expect(caloriesOnTarget(day(MONDAY, { totals: { calories: 2200 } }))).toBe(
      true,
    );
    expect(caloriesOnTarget(day(MONDAY, { totals: { calories: 1800 } }))).toBe(
      true,
    );
    expect(caloriesOnTarget(day(MONDAY, { totals: { calories: 2201 } }))).toBe(
      false,
    );
    expect(caloriesOnTarget(day(MONDAY, { totals: { calories: 1799 } }))).toBe(
      false,
    );
  });

  it('flags limits only when strictly exceeded', () => {
    expect(satFatOver(day(MONDAY, { totals: { satFat: 22 } }))).toBe(false);
    expect(satFatOver(day(MONDAY, { totals: { satFat: 22.1 } }))).toBe(true);
    expect(sodiumOver(day(MONDAY, { totals: { sodium: 2300 } }))).toBe(false);
    expect(sodiumOver(day(MONDAY, { totals: { sodium: 2301 } }))).toBe(true);
    expect(sugarOver(day(MONDAY, { totals: { sugar: 91 } }))).toBe(true);
  });

  it('counts fiber as hit at or above the minimum', () => {
    expect(fiberHit(day(MONDAY, { totals: { fiber: 28 } }))).toBe(true);
    expect(fiberHit(day(MONDAY, { totals: { fiber: 27.9 } }))).toBe(false);
  });

  it.each([21, 74, 119, 203, 248])(
    'counts exactly 90 %% of a %d g protein target as hit despite float rounding',
    (target) => {
      const threshold = Math.round(target * 9) / 10;
      const hit = day(MONDAY, {
        targets: { protein: target },
        totals: { protein: threshold },
      });
      const miss = day(MONDAY, {
        targets: { protein: target },
        totals: { protein: threshold - 0.1 },
      });
      expect(proteinHit(hit)).toBe(true);
      expect(proteinHit(miss)).toBe(false);
    },
  );

  it('keeps the ±10 % calorie band inclusive for targets that are not round', () => {
    const target = 2090;
    for (const calories of [1881, 2299]) {
      expect(
        caloriesOnTarget(
          day(MONDAY, { targets: { calories: target }, totals: { calories } }),
        ),
      ).toBe(true);
    }
    for (const calories of [1880, 2300]) {
      expect(
        caloriesOnTarget(
          day(MONDAY, { targets: { calories: target }, totals: { calories } }),
        ),
      ).toBe(false);
    }
  });
});

describe('fluid predicates', () => {
  it('counts a day with any fluid as a fluid day', () => {
    expect(hasFluids({ fluidsMl: 1 })).toBe(true);
    expect(hasFluids({ fluidsMl: 0 })).toBe(false);
  });

  it('counts the target as hit from 100 %', () => {
    expect(fluidHit({ fluidsMl: 2800, fluidTargetMl: 2800 })).toBe(true);
    expect(fluidHit({ fluidsMl: 2799, fluidTargetMl: 2800 })).toBe(false);
    expect(fluidHit({ fluidsMl: 0, fluidTargetMl: 0 })).toBe(false);
  });
});

describe('averages', () => {
  it('returns zeros for an empty list', () => {
    expect(averageNutrients([])).toEqual(zeroNutrients());
    expect(averageTargets([])).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      satFatMax: 0,
      fiberMin: 0,
      sugarMax: 0,
      sodiumMax: 0,
    });
  });

  it('rounds averaged nutrients to their display precision', () => {
    const average = averageNutrients([
      day(MONDAY, { totals: { calories: 2001, protein: 100.1, sodium: 1000 } }),
      day(MONDAY, { totals: { calories: 2000, protein: 100.2, sodium: 1001 } }),
      day(MONDAY, { totals: { calories: 2000, protein: 100.2, sodium: 1001 } }),
    ]);
    expect(average.calories).toBe(2000);
    expect(average.protein).toBe(100.2);
    expect(average.sodium).toBe(1001);
  });

  it('averages targets across training and rest days', () => {
    const average = averageTargets([
      day(MONDAY, { targets: { calories: 2200, carbs: 250 } }),
      day(MONDAY, { targets: { calories: 1900, carbs: 175 } }),
    ]);
    expect(average.calories).toBe(2050);
    expect(average.carbs).toBe(212.5);
    expect(average.sodiumMax).toBe(2300);
  });
});

describe('weekdayAverages', () => {
  it('always returns the seven weekdays in order with zeros when nothing is logged', () => {
    const averages = weekdayAverages([]);
    expect(averages.map((entry) => entry.weekday)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    for (const entry of averages) {
      expect(entry).toMatchObject({
        loggedDays: 0,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      });
    }
  });

  it('averages logged days per weekday and ignores empty days', () => {
    const nextMonday = addDays(MONDAY, 7);
    const tuesday = addDays(MONDAY, 1);
    const sunday = addDays(MONDAY, 6);
    const averages = weekdayAverages([
      day(MONDAY, { totals: { calories: 1800, protein: 120 } }),
      day(nextMonday, { totals: { calories: 2400, protein: 181 } }),
      emptyDay(tuesday),
      day(sunday, { totals: { calories: 3000, carbs: 350, fat: 110 } }),
    ]);

    expect(averages[1]).toEqual({
      weekday: 1,
      loggedDays: 2,
      calories: 2100,
      protein: 150.5,
      carbs: 200,
      fat: 67,
    });
    expect(averages[2]).toMatchObject({
      weekday: 2,
      loggedDays: 0,
      calories: 0,
    });
    expect(averages[0]).toEqual({
      weekday: 0,
      loggedDays: 1,
      calories: 3000,
      protein: 150,
      carbs: 350,
      fat: 110,
    });
  });
});

describe('computeRangeStats', () => {
  it('handles an empty range', () => {
    const stats = computeRangeStats([]);
    expect(stats).toMatchObject({
      loggedDays: 0,
      totalDays: 0,
      avgTotals: zeroNutrients(),
      macroSplit: { protein: 0, carbs: 0, fat: 0, alcohol: 0 },
      proteinHitDays: 0,
      calorieOnTargetDays: 0,
      satFatOverDays: 0,
      sodiumOverDays: 0,
      fiberHitDays: 0,
      avgMicros: {},
      microsCoverage: { items: 0, withMicros: 0 },
      microsDays: 0,
      avgFluidsMl: 0,
      fluidDays: 0,
      fluidHitDays: 0,
    });
    expect(stats.weekdayAverages).toHaveLength(7);
  });

  it('averages fluids over days with any fluid and counts days at the target', () => {
    const days = [
      day(MONDAY, { fluidsMl: 2800, fluidTargetMl: 2800 }),
      day(addDays(MONDAY, 1), { fluidsMl: 1400, fluidTargetMl: 3300 }),
      day(addDays(MONDAY, 2), { fluidsMl: 0 }),
      emptyDay(addDays(MONDAY, 3), { fluidsMl: 3001, fluidTargetMl: 3000 }),
    ];

    const stats = computeRangeStats(days);

    expect(stats).toMatchObject({
      avgFluidsMl: 2400,
      fluidDays: 3,
      fluidHitDays: 2,
      loggedDays: 3,
    });
  });

  it('averages micros over days where at least half of the items have them', () => {
    const days = [
      day(MONDAY, {
        micros: { vitaminD: 130, calcium: 900, caffeine: 140 },
        microsCoverage: { items: 6, withMicros: 6 },
      }),
      day(addDays(MONDAY, 1), {
        micros: { vitaminD: 10, calcium: 500 },
        microsCoverage: { items: 4, withMicros: 2 },
      }),
      day(addDays(MONDAY, 2), {
        micros: { calcium: 50, caffeine: 35 },
        microsCoverage: { items: 5, withMicros: 1 },
      }),
      emptyDay(addDays(MONDAY, 3)),
      day(addDays(MONDAY, 4), {
        micros: { caffeine: 80 },
        microsCoverage: { items: 0, withMicros: 0 },
      }),
    ];

    const stats = computeRangeStats(days);

    expect(stats.microsDays).toBe(2);
    expect(stats.avgMicros).toEqual({
      vitaminD: 70,
      calcium: 700,
      caffeine: 140,
    });
    expect(stats.microsCoverage).toEqual({ items: 15, withMicros: 9 });
  });

  it('rounds averaged micros per nutrient', () => {
    const stats = computeRangeStats([
      day(MONDAY, {
        micros: { vitaminB12: 1.111, iron: 10.04 },
        microsCoverage: { items: 1, withMicros: 1 },
      }),
      day(addDays(MONDAY, 1), {
        micros: { vitaminB12: 2.222, iron: 11.1 },
        microsCoverage: { items: 2, withMicros: 1 },
      }),
    ]);

    expect(stats.avgMicros).toEqual({ vitaminB12: 1.67, iron: 10.6 });
  });

  it('falls back to the targets of all days when nothing is logged', () => {
    const days = [
      emptyDay(MONDAY, { targets: { calories: 2200 }, trainingDay: true }),
      emptyDay(addDays(MONDAY, 1), { targets: { calories: 1800 } }),
    ];
    const stats = computeRangeStats(days);
    expect(stats.loggedDays).toBe(0);
    expect(stats.totalDays).toBe(2);
    expect(stats.avgTotals).toEqual(zeroNutrients());
    expect(stats.avgTargets.calories).toBe(2000);
    expect(stats.proteinHitDays).toBe(0);
    expect(stats.fiberHitDays).toBe(0);
  });

  it('computes every counter when all days are logged', () => {
    const days = week((date, index) =>
      day(date, {
        totals: {
          calories: 1500 + index * 100,
          protein: index < 4 ? 150 : 100,
          satFat: index < 2 ? 30 : 10,
          sodium: index === 6 ? 4000 : 1500,
          fiber: index % 2 === 0 ? 30 : 12,
        },
      }),
    );
    const stats = computeRangeStats(days);

    expect(stats.loggedDays).toBe(7);
    expect(stats.totalDays).toBe(7);
    expect(stats.avgTotals.calories).toBe(1800);
    expect(stats.avgTargets).toEqual(TARGETS);
    expect(stats.proteinHitDays).toBe(4);
    expect(stats.calorieOnTargetDays).toBe(4);
    expect(stats.satFatOverDays).toBe(2);
    expect(stats.sodiumOverDays).toBe(1);
    expect(stats.fiberHitDays).toBe(4);
    expect(stats.weekdayAverages.every((entry) => entry.loggedDays === 1)).toBe(
      true,
    );
  });

  it('only uses logged days for averages, counters and targets', () => {
    const days = [
      day(MONDAY, {
        totals: { calories: 2400, protein: 160 },
        targets: { calories: 2200 },
        trainingDay: true,
      }),
      emptyDay(addDays(MONDAY, 1), { targets: { calories: 1000 } }),
      day(addDays(MONDAY, 2), { totals: { calories: 1600, protein: 100 } }),
    ];
    const stats = computeRangeStats(days);

    expect(stats.loggedDays).toBe(2);
    expect(stats.totalDays).toBe(3);
    expect(stats.avgTotals.calories).toBe(2000);
    expect(stats.avgTotals.protein).toBe(130);
    expect(stats.avgTargets.calories).toBe(2100);
    expect(stats.proteinHitDays).toBe(1);
    expect(stats.calorieOnTargetDays).toBe(1);
  });

  it('derives the macro split from the average totals', () => {
    const stats = computeRangeStats([
      day(MONDAY, {
        totals: { protein: 100, carbs: 200, fat: 50, alcohol: 0 },
      }),
      day(addDays(MONDAY, 1), {
        totals: { protein: 100, carbs: 200, fat: 50, alcohol: 20 },
      }),
    ]);
    expect(stats.macroSplit).toEqual({
      protein: 23.3,
      carbs: 46.5,
      fat: 26.2,
      alcohol: 4.1,
    });
  });
});
