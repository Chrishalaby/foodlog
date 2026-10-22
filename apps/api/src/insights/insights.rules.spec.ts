import {
  addDays,
  type DaySummary,
  type Insight,
  type Micros,
  type Nutrients,
  type TargetValues,
  zeroNutrients,
} from '@food/shared';
import type { BodyInsightContext } from './body-insights.js';
import {
  buildInsights,
  notEnoughDataInsight,
  sortInsights,
} from './insights.rules.js';

const START = '2026-09-21';

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
  logged?: boolean;
  micros?: Micros;
  fluidsMl?: number;
  fluidTargetMl?: number;
}

function day(index: number, options: DayOptions = {}): DaySummary {
  const logged = options.logged ?? true;
  return {
    date: addDays(START, index),
    trainingDay: options.trainingDay ?? false,
    targets: { ...TARGETS, ...options.targets },
    totals: logged ? { ...BALANCED, ...options.totals } : zeroNutrients(),
    entryCount: logged ? 3 : 0,
    micros: { ...options.micros },
    microsCoverage: { items: 0, withMicros: 0 },
    fluidsMl: options.fluidsMl ?? 0,
    fluidTargetMl: options.fluidTargetMl ?? 2800,
  };
}

function days(
  length: number,
  options: (index: number) => DayOptions = () => ({}),
): DaySummary[] {
  return Array.from({ length }, (_, index) => day(index, options(index)));
}

function ids(insights: readonly Insight[]): string[] {
  return insights.map((insight) => insight.id);
}

function find(insights: readonly Insight[], id: string): Insight {
  const match = insights.find((insight) => insight.id === id);
  if (!match) {
    throw new Error(`expected insight ${id} in ${ids(insights).join(', ')}`);
  }
  return match;
}

describe('buildInsights', () => {
  describe('not enough data', () => {
    it('explains that nothing was logged in an empty window', () => {
      const insights = buildInsights(days(7, () => ({ logged: false })));
      expect(insights).toEqual([
        {
          id: 'not-enough-data',
          severity: 'info',
          title: 'Not enough data yet',
          detail:
            'Nothing logged in this 7-day period yet. Log meals on at least 3 days to see patterns in your nutrition.',
        },
      ]);
    });

    it('returns only the progress hint while fewer than 3 days are logged', () => {
      const insights = buildInsights(
        days(7, (index) => ({
          logged: index < 2,
          totals: { satFat: 60, sodium: 6000 },
        })),
      );
      expect(ids(insights)).toEqual(['not-enough-data']);
      expect(insights[0]?.detail).toContain('2 of 7 days');
    });

    it('starts evaluating rules from 3 logged days', () => {
      const insights = buildInsights(
        days(3, () => ({ totals: { satFat: 30 } })),
      );
      expect(ids(insights)).not.toContain('not-enough-data');
      expect(ids(insights)).toContain('satfat-over');
    });
  });

  describe('a balanced, fully logged week', () => {
    it('only reports good news', () => {
      const insights = buildInsights(days(7));
      expect(ids(insights)).toEqual([
        'calories-on-target',
        'protein-hit',
        'fiber-good',
      ]);
      expect(insights.every((insight) => insight.severity === 'good')).toBe(
        true,
      );
      expect(find(insights, 'protein-hit').title).toBe(
        'Protein target hit on 7 of 7 logged days',
      );
      expect(find(insights, 'calories-on-target').detail).toBe(
        'You averaged 2,000 kcal a day vs your target of 2,000 kcal. That is within 10% of your target.',
      );
    });
  });

  describe('limits', () => {
    it('warns about saturated fat when at least half of the logged days are over', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { satFat: index < 5 ? 31 : 12 } })),
      );
      const satFat = find(insights, 'satfat-over');
      expect(satFat.severity).toBe('warning');
      expect(satFat.title).toBe(
        'Saturated fat over your limit on 5 of 7 logged days',
      );
      expect(satFat.detail).toContain(
        'On those days you averaged 31 g vs your limit of 22 g.',
      );
    });

    it('treats a minority of days over the limit as info and a single day as noise', () => {
      const someDays = buildInsights(
        days(7, (index) => ({ totals: { satFat: index < 3 ? 30 : 10 } })),
      );
      expect(find(someDays, 'satfat-over').severity).toBe('info');

      const oneDay = buildInsights(
        days(7, (index) => ({ totals: { satFat: index === 0 ? 30 : 10 } })),
      );
      expect(ids(oneDay)).not.toContain('satfat-over');
    });

    it('reports sodium and sugar with their own units and averages', () => {
      const insights = buildInsights(
        days(7, (index) => ({
          totals: {
            sodium: index < 4 ? 3100 : 1500,
            sugar: index < 6 ? 120 : 40,
          },
        })),
      );
      const sodium = find(insights, 'sodium-over');
      expect(sodium.severity).toBe('warning');
      expect(sodium.title).toBe('Sodium over your limit on 4 of 7 logged days');
      expect(sodium.detail).toContain('3,100 mg vs your limit of 2,300 mg');

      const sugar = find(insights, 'sugar-over');
      expect(sugar.title).toBe('Sugar over your limit on 6 of 7 logged days');
      expect(sugar.detail).toContain('120 g vs your limit of 90 g');
    });

    it('compares each day against that day’s own limit', () => {
      const insights = buildInsights(
        days(4, (index) => ({
          trainingDay: index < 2,
          targets: { satFatMax: index < 2 ? 30 : 20 },
          totals: { satFat: 25 },
        })),
      );
      const satFat = find(insights, 'satfat-over');
      expect(satFat.title).toBe(
        'Saturated fat over your limit on 2 of 4 logged days',
      );
      expect(satFat.detail).toContain('25 g vs your limit of 20 g');
    });
  });

  describe('fiber', () => {
    it('warns when fiber is under 10 g on most logged days', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { fiber: index < 4 ? 6 : 30 } })),
      );
      const fiber = find(insights, 'fiber-low');
      expect(fiber.severity).toBe('warning');
      expect(fiber.title).toBe('Fiber under 10 g on 4 of 7 logged days');
      expect(ids(insights)).not.toContain('fiber-good');
    });

    it('celebrates meeting the minimum on at least 70 % of logged days', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { fiber: index < 5 ? 30 : 15 } })),
      );
      expect(find(insights, 'fiber-good').title).toBe(
        'Fiber target met on 5 of 7 logged days',
      );
    });

    it('nudges gently when fiber is between 10 g and the minimum on most days', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { fiber: index < 2 ? 30 : 18 } })),
      );
      const fiber = find(insights, 'fiber-below-target');
      expect(fiber.severity).toBe('info');
      expect(fiber.title).toBe(
        'Fiber below your minimum on 5 of 7 logged days',
      );
    });

    it('stays quiet in the middle band', () => {
      const insights = buildInsights(
        days(6, (index) => ({ totals: { fiber: index < 3 ? 30 : 18 } })),
      );
      expect(ids(insights).filter((id) => id.startsWith('fiber'))).toEqual([]);
    });
  });

  describe('protein', () => {
    it('reports protein-hit when at least 70 % of logged days reach 90 % of target', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { protein: index < 5 ? 135 : 90 } })),
      );
      expect(find(insights, 'protein-hit').title).toBe(
        'Protein target hit on 5 of 7 logged days',
      );
    });

    it('warns with protein-low when fewer than half of the logged days are hit', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { protein: index < 3 ? 150 : 90 } })),
      );
      const protein = find(insights, 'protein-low');
      expect(protein.severity).toBe('warning');
      expect(protein.title).toBe('Protein under target on 4 of 7 logged days');
      expect(protein.detail).toContain(
        'You averaged 115.7 g a day vs your target of 150 g.',
      );
    });

    it('stays quiet between 50 % and 70 %', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { protein: index < 4 ? 150 : 90 } })),
      );
      expect(ids(insights)).not.toContain('protein-hit');
      expect(ids(insights)).not.toContain('protein-low');
    });
  });

  describe('protein on rest days', () => {
    it('warns when rest days lag training days by 30+ points and are under 50 %', () => {
      const insights = buildInsights(
        days(7, (index) => {
          const trainingDay = index % 2 === 0;
          return {
            trainingDay,
            totals: { protein: trainingDay || index === 1 ? 150 : 100 },
          };
        }),
      );
      const rest = find(insights, 'protein-rest-days');
      expect(rest.severity).toBe('warning');
      expect(rest.title).toBe('Protein under target on rest days');
      expect(rest.detail).toContain(
        'You hit your protein target on 1 of 3 rest days vs 4 of 4 training days.',
      );
    });

    it('does not fire when rest days are only slightly behind', () => {
      const insights = buildInsights(
        days(8, (index) => {
          const trainingDay = index < 4;
          const hit = trainingDay ? index < 2 : index < 5;
          return { trainingDay, totals: { protein: hit ? 150 : 100 } };
        }),
      );
      expect(ids(insights)).not.toContain('protein-rest-days');
    });

    it('does not fire when rest days hit at least half the time', () => {
      const insights = buildInsights(
        days(6, (index) => {
          const trainingDay = index < 2;
          const hit = trainingDay || index < 4;
          return { trainingDay, totals: { protein: hit ? 150 : 100 } };
        }),
      );
      expect(ids(insights)).not.toContain('protein-rest-days');
    });

    it('needs at least two training days and two rest days', () => {
      const insights = buildInsights(
        days(5, (index) => ({
          trainingDay: index === 0,
          totals: { protein: index === 0 ? 150 : 100 },
        })),
      );
      expect(ids(insights)).not.toContain('protein-rest-days');
    });
  });

  describe('calories', () => {
    it('flags average calories more than 10 % over target', () => {
      const insights = buildInsights(
        days(7, () => ({ totals: { calories: 2300 } })),
      );
      const calories = find(insights, 'calories-over');
      expect(calories.severity).toBe('warning');
      expect(calories.title).toBe('Calories 15% above target on average');
      expect(calories.detail).toContain(
        'You averaged 2,300 kcal a day vs your target of 2,000 kcal.',
      );
    });

    it('mentions possibly unlogged meals when calories are more than 10 % under', () => {
      const insights = buildInsights(
        days(7, () => ({ totals: { calories: 1500 } })),
      );
      const calories = find(insights, 'calories-under');
      expect(calories.severity).toBe('info');
      expect(calories.title).toBe('Calories 25% below target on average');
      expect(calories.detail).toContain('went unlogged');
    });

    it('treats exactly 10 % off as on target', () => {
      expect(
        ids(buildInsights(days(7, () => ({ totals: { calories: 2200 } })))),
      ).toContain('calories-on-target');
      expect(
        ids(buildInsights(days(7, () => ({ totals: { calories: 1800 } })))),
      ).toContain('calories-on-target');
    });

    it('compares against the average of the day-specific targets', () => {
      const insights = buildInsights(
        days(4, (index) => ({
          trainingDay: index < 2,
          targets: { calories: index < 2 ? 2400 : 1600 },
          totals: { calories: 2000 },
        })),
      );
      expect(ids(insights)).toContain('calories-on-target');
    });
  });

  describe('carbs on training days', () => {
    it('suggests more carbs when most training days fall under 90 % of the carb target', () => {
      const insights = buildInsights(
        days(7, (index) => {
          const trainingDay = index < 3;
          return {
            trainingDay,
            targets: { carbs: trainingDay ? 250 : 200 },
            totals: { carbs: trainingDay && index < 2 ? 180 : 250 },
          };
        }),
      );
      const carbs = find(insights, 'carbs-training-days');
      expect(carbs.severity).toBe('info');
      expect(carbs.title).toBe('Carbs under target on 2 of 3 training days');
      expect(carbs.detail).toContain('(250 g on average)');
      expect(carbs.detail).toContain('You averaged 203.3 g on those days.');
    });

    it('counts exactly 90 % of the carb target as fuelled despite float rounding', () => {
      const insights = buildInsights(
        days(7, (index) => ({
          trainingDay: index < 3,
          targets: { carbs: 119 },
          totals: { carbs: 107.1 },
        })),
      );
      expect(ids(insights)).not.toContain('carbs-training-days');
    });

    it('stays quiet when most training days are fuelled', () => {
      const insights = buildInsights(
        days(7, (index) => ({
          trainingDay: index < 3,
          totals: { carbs: index === 0 ? 100 : 200 },
        })),
      );
      expect(ids(insights)).not.toContain('carbs-training-days');
    });
  });

  describe('logging gaps and alcohol', () => {
    it('mentions logging gaps below 70 % of the window', () => {
      const insights = buildInsights(
        days(7, (index) => ({ logged: index < 4 })),
      );
      expect(find(insights, 'logging-gaps').title).toBe('Logged 4 of 7 days');

      const enough = buildInsights(days(7, (index) => ({ logged: index < 5 })));
      expect(ids(enough)).not.toContain('logging-gaps');
    });

    it('only counts days since tracking began, so new users are not told about gaps', () => {
      const window = days(7, (index) => ({ logged: index >= 3 }));
      const trackingSince = addDays(START, 3);

      const newUser = buildInsights(window, { trackingSince });
      expect(ids(newUser)).not.toContain('logging-gaps');

      const gappy = buildInsights(
        days(7, (index) => ({ logged: index === 1 || index >= 5 })),
        { trackingSince: addDays(START, 1) },
      );
      expect(find(gappy, 'logging-gaps').title).toBe('Logged 3 of 6 days');
    });

    it('counts the whole window when tracking began before it', () => {
      const insights = buildInsights(
        days(7, (index) => ({ logged: index < 4 })),
        { trackingSince: addDays(START, -30) },
      );
      expect(find(insights, 'logging-gaps').title).toBe('Logged 4 of 7 days');
    });

    it('never counts fewer tracked days than logged days', () => {
      const insights = buildInsights(
        days(7, (index) => ({ logged: index % 2 === 0 })),
        { trackingSince: addDays(START, 6) },
      );
      expect(ids(insights)).not.toContain('logging-gaps');
    });

    it('scales to longer windows', () => {
      const insights = buildInsights(
        days(30, (index) => ({ logged: index % 3 !== 0 })),
      );
      expect(find(insights, 'logging-gaps').title).toBe('Logged 20 of 30 days');
    });

    it('notes alcohol from three logged days on', () => {
      const insights = buildInsights(
        days(7, (index) => ({ totals: { alcohol: index < 3 ? 28 : 0 } })),
      );
      const alcohol = find(insights, 'alcohol-days');
      expect(alcohol.severity).toBe('info');
      expect(alcohol.title).toBe('Alcohol on 3 of 7 logged days');
      expect(alcohol.detail).toBe(
        'You averaged 28 g of alcohol on those days, about 196 kcal.',
      );

      const twoDays = buildInsights(
        days(7, (index) => ({ totals: { alcohol: index < 2 ? 28 : 0 } })),
      );
      expect(ids(twoDays)).not.toContain('alcohol-days');
    });
  });

  describe('ordering', () => {
    it('sorts warnings first, then info, then good, keeping rule order within a severity', () => {
      const insights = buildInsights(
        days(7, (index) => ({
          logged: index < 4,
          totals: {
            calories: 1900,
            satFat: 40,
            sodium: 4000,
            alcohol: index < 3 ? 20 : 0,
          },
        })),
      );
      expect(ids(insights)).toEqual([
        'satfat-over',
        'sodium-over',
        'alcohol-days',
        'logging-gaps',
        'calories-on-target',
        'protein-hit',
        'fiber-good',
      ]);
    });

    it('produces unique ids', () => {
      const insights = buildInsights(
        days(7, (index) => ({
          trainingDay: index % 3 === 0,
          totals: {
            calories: 2600,
            protein: index % 3 === 0 ? 150 : 90,
            satFat: 40,
            sodium: 4000,
            sugar: 150,
            fiber: 5,
            carbs: 120,
            alcohol: 15,
          },
        })),
      );
      expect(new Set(ids(insights)).size).toBe(insights.length);
      expect(ids(insights)).toEqual([
        'calories-over',
        'protein-low',
        'protein-rest-days',
        'fiber-low',
        'satfat-over',
        'sodium-over',
        'sugar-over',
        'carbs-training-days',
        'alcohol-days',
      ]);
    });
  });
});

describe('buildInsights with body data', () => {
  function gainingOnCut(overrides: Partial<BodyInsightContext> = {}) {
    return {
      to: addDays(START, 6),
      goal: 'cut',
      weights: Array.from({ length: 14 }, (_, index) => ({
        date: addDays(START, index - 7),
        weightKg: 80 + index * 0.05,
      })),
      tdee: 2000,
      adaptiveTdee: {
        kcal: 2400,
        windowDays: 28,
        loggedDays: 27,
        weighIns: 20,
        avgIntakeKcal: 2500,
        weightChangeKg: 1.2,
        confidence: 'high',
      },
      ...overrides,
    } satisfies BodyInsightContext;
  }

  it('merges weight insights with the nutrition insights by severity', () => {
    const insights = buildInsights(days(7), { body: gainingOnCut() });
    expect(ids(insights)).toEqual([
      'weight-trend',
      'adaptive-tdee',
      'calories-on-target',
      'protein-hit',
      'fiber-good',
    ]);
    expect(find(insights, 'weight-trend')).toMatchObject({
      severity: 'warning',
      title: 'Gaining weight on a cut',
    });
  });

  it('still reports weight insights while food logging is too sparse', () => {
    const insights = buildInsights(
      days(7, (index) => ({ logged: index === 0 })),
      { body: gainingOnCut({ adaptiveTdee: null }) },
    );
    expect(ids(insights)).toEqual(['weight-trend', 'not-enough-data']);
  });

  it('adds nothing when there is no body data', () => {
    const insights = buildInsights(days(7), {
      body: gainingOnCut({ weights: [], adaptiveTdee: null }),
    });
    expect(ids(insights)).toEqual([
      'calories-on-target',
      'protein-hit',
      'fiber-good',
    ]);
  });
});

describe('buildInsights with fluids and caffeine', () => {
  function fluidLogDates(list: readonly DaySummary[]): Set<string> {
    return new Set(list.map(({ date }) => date));
  }

  it('puts the fluid warnings among the nutrition insights by severity', () => {
    const week = days(7, (index) => ({
      fluidsMl: 1200,
      micros: index === 6 ? { caffeine: 450 } : {},
    }));
    const insights = buildInsights(week, {
      fluidLogDates: fluidLogDates(week),
    });

    expect(ids(insights)).toEqual([
      'fluids-low',
      'caffeine-high',
      'calories-on-target',
      'protein-hit',
      'fiber-good',
    ]);
  });

  it('never warns about fluids on days without a fluid log', () => {
    const insights = buildInsights(days(7, () => ({ fluidsMl: 330 })));

    expect(ids(insights)).not.toContain('fluids-low');
  });

  it('uses the caffeine limit it is given', () => {
    const insights = buildInsights(
      days(7, (index) => ({ micros: index === 0 ? { caffeine: 150 } : {} })),
      { caffeineLimitMg: 100 },
    );

    expect(find(insights, 'caffeine-high').title).toBe(
      'Caffeine over 100 mg on 1 of 7 days',
    );
  });

  it('still reports fluids while food logging is too sparse', () => {
    const week = days(7, (index) => ({ logged: index === 0, fluidsMl: 900 }));
    const insights = buildInsights(week, {
      fluidLogDates: fluidLogDates(week),
    });

    expect(ids(insights)).toEqual(['fluids-low', 'not-enough-data']);
  });
});

describe('sortInsights', () => {
  it('is stable and does not mutate its input', () => {
    const input: Insight[] = [
      { id: 'a', severity: 'good', title: '', detail: '' },
      { id: 'b', severity: 'warning', title: '', detail: '' },
      { id: 'c', severity: 'info', title: '', detail: '' },
      { id: 'd', severity: 'warning', title: '', detail: '' },
    ];
    expect(ids(sortInsights(input))).toEqual(['b', 'd', 'c', 'a']);
    expect(ids(input)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('notEnoughDataInsight', () => {
  it('reports progress when something was logged', () => {
    expect(notEnoughDataInsight(1, 14).detail).toBe(
      'You have logged meals on 1 of 14 days so far. Log meals on at least 3 days to see patterns in your nutrition.',
    );
  });
});
