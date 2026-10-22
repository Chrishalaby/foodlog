import {
  addDays,
  type DaySummary,
  type Micros,
  zeroNutrients,
} from '@food/shared';
import {
  buildFluidInsights,
  caffeineInsight,
  fluidsLowInsight,
} from './fluid-insights.js';

const START = '2026-09-25';
const TARGET_ML = 2800;

interface DayOptions {
  fluidsMl?: number;
  fluidTargetMl?: number;
  caffeine?: number;
  logged?: boolean;
}

function day(index: number, options: DayOptions = {}): DaySummary {
  const logged = options.logged ?? true;
  const micros: Micros =
    options.caffeine === undefined ? {} : { caffeine: options.caffeine };
  return {
    date: addDays(START, index),
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
    totals: zeroNutrients(),
    entryCount: logged ? 3 : 0,
    micros,
    microsCoverage: { items: 0, withMicros: 0 },
    fluidsMl: options.fluidsMl ?? 0,
    fluidTargetMl: options.fluidTargetMl ?? TARGET_ML,
  };
}

function days(
  length: number,
  options: (index: number) => DayOptions = () => ({}),
): DaySummary[] {
  return Array.from({ length }, (_, index) => day(index, options(index)));
}

function withFluids(list: readonly DaySummary[]): Set<string> {
  return new Set(
    list.filter((entry) => entry.fluidsMl > 0).map((entry) => entry.date),
  );
}

function lowFluids(list: readonly DaySummary[]) {
  return fluidsLowInsight(list, withFluids(list));
}

describe('fluidsLowInsight', () => {
  it('warns when 4 of the last 7 days with fluids are under 70 % of the target', () => {
    const week = days(7, (index) => ({
      fluidsMl: index < 4 ? 1500 : 2900,
    }));

    expect(lowFluids(week)).toEqual({
      id: 'fluids-low',
      severity: 'warning',
      title: 'Fluids under 70% of your target on 4 of 7 days',
      detail:
        'On the days you logged fluids you averaged 2.1 L a day vs your target of 2.8 L. Drinks inside meals count too. Keeping a bottle of water nearby and having a glass with every meal makes the target easier to reach.',
    });
  });

  it('stays quiet with only 3 low days', () => {
    const week = days(7, (index) => ({
      fluidsMl: index < 3 ? 1500 : 2900,
    }));

    expect(lowFluids(week)).toBeNull();
  });

  it('counts exactly 70 % of the target as enough', () => {
    const week = days(7, () => ({ fluidsMl: TARGET_ML * 0.7 }));

    expect(lowFluids(week)).toBeNull();
  });

  it('only looks at days that have fluid data', () => {
    const sparse = days(7, (index) => ({
      fluidsMl: index < 3 ? 1000 : 0,
    }));
    const enough = days(7, (index) => ({
      fluidsMl: index % 2 === 0 ? 1000 : 0,
    }));

    expect(lowFluids(sparse)).toBeNull();
    expect(lowFluids(enough)?.title).toBe(
      'Fluids under 70% of your target on 4 of 4 days',
    );
  });

  it('uses the 7 most recent days with fluids in a longer window', () => {
    const month = days(30, (index) => ({
      fluidsMl: index < 23 ? 1000 : 2800,
    }));
    const lowLately = days(30, (index) => ({
      fluidsMl: index >= 26 ? 1000 : 2800,
    }));

    expect(lowFluids(month)).toBeNull();
    expect(lowFluids(lowLately)?.title).toBe(
      'Fluids under 70% of your target on 4 of 7 days',
    );
  });

  it('compares each day against its own target', () => {
    const week = days(7, (index) => ({
      fluidsMl: 2100,
      fluidTargetMl: index < 4 ? 3300 : 2800,
    }));

    expect(lowFluids(week)?.title).toBe(
      'Fluids under 70% of your target on 4 of 7 days',
    );
  });

  it('ignores days whose only fluid is a drink inside a meal', () => {
    const week = days(7, (index) => ({ fluidsMl: index < 5 ? 330 : 1200 }));
    const tracked = new Set(week.slice(3).map((entry) => entry.date));

    expect(fluidsLowInsight(week, new Set())).toBeNull();
    expect(fluidsLowInsight(week, tracked)?.title).toBe(
      'Fluids under 70% of your target on 4 of 4 days',
    );
    expect(
      fluidsLowInsight(week, new Set(week.slice(4).map(({ date }) => date))),
    ).toBeNull();
  });
});

describe('caffeineInsight', () => {
  it('notes a single day over 400 mg in the last 7 days', () => {
    const week = days(7, (index) => ({
      caffeine: index === 5 ? 460 : 180,
    }));

    expect(caffeineInsight(week)).toEqual({
      id: 'caffeine-high',
      severity: 'info',
      title: 'Caffeine over 400 mg on 1 of 7 days',
      detail:
        'Your highest day was about 460 mg vs a limit of 400 mg a day. Coffee, tea, energy drinks and pre-workout supplements add up quickly, and caffeine late in the day can disturb sleep.',
    });
  });

  it('warns when at least half of the recent days are over', () => {
    const week = days(6, (index) => ({ caffeine: index < 3 ? 520 : 300 }));

    expect(caffeineInsight(week)).toMatchObject({
      severity: 'warning',
      title: 'Caffeine over 400 mg on 3 of 6 days',
      detail: expect.stringContaining('about 520 mg') as string,
    });
  });

  it('treats exactly 400 mg as within the limit', () => {
    expect(caffeineInsight(days(7, () => ({ caffeine: 400 })))).toBeNull();
    expect(caffeineInsight(days(7))).toBeNull();
  });

  it('ignores days before the last 7 days of the window', () => {
    const window = days(14, (index) => ({
      caffeine: index < 7 ? 900 : 200,
    }));

    expect(caffeineInsight(window)).toBeNull();
  });

  it('counts days with only fluid logs and skips empty days', () => {
    const week = days(7, (index) => ({
      logged: false,
      fluidsMl: index < 2 ? 400 : 0,
      caffeine: index === 0 ? 480 : undefined,
    }));

    expect(caffeineInsight(week)?.title).toBe(
      'Caffeine over 400 mg on 1 of 2 days',
    );
  });

  it('uses a lower limit when one is given', () => {
    expect(
      caffeineInsight(
        days(7, (index) => ({ caffeine: index === 0 ? 150 : 50 })),
        100,
      )?.title,
    ).toBe('Caffeine over 100 mg on 1 of 7 days');
  });
});

describe('buildFluidInsights', () => {
  it('returns both insights in a stable order', () => {
    const week = days(7, (index) => ({
      fluidsMl: 1200,
      caffeine: index === 6 ? 450 : 100,
    }));

    const fluidLogDates = withFluids(week);

    expect(
      buildFluidInsights(week, { fluidLogDates }).map(({ id }) => id),
    ).toEqual(['fluids-low', 'caffeine-high']);
    expect(
      buildFluidInsights(week, { caffeineLimitMg: 500, fluidLogDates }).map(
        ({ id }) => id,
      ),
    ).toEqual(['fluids-low']);
    expect(buildFluidInsights(week).map(({ id }) => id)).toEqual([
      'caffeine-high',
    ]);
  });

  it('returns nothing without fluid or caffeine data', () => {
    expect(buildFluidInsights(days(7))).toEqual([]);
    expect(buildFluidInsights([])).toEqual([]);
  });
});
