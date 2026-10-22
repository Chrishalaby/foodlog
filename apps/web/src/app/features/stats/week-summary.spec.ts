import {
  DEFAULT_BASE_TARGETS,
  zeroNutrients,
  type DaySummary,
  type RangeStats,
} from '@food/shared';
import {
  averageBars,
  calorieStatus,
  consistencyTiles,
  fluidWeek,
  hasMacroData,
  macroShares,
  weekRows,
} from './week-summary';

function stats(overrides: Partial<RangeStats> = {}): RangeStats {
  return {
    loggedDays: 5,
    totalDays: 7,
    avgTotals: { ...zeroNutrients(), calories: 2050.6, protein: 110.44, sodium: 2412.4 },
    avgTargets: { ...DEFAULT_BASE_TARGETS },
    macroSplit: { protein: 22, carbs: 48, fat: 30, alcohol: 0 },
    proteinHitDays: 4,
    calorieOnTargetDays: 2,
    satFatOverDays: 0,
    sodiumOverDays: 3,
    fiberHitDays: 1,
    weekdayAverages: [],
    avgMicros: {},
    microsCoverage: { items: 0, withMicros: 0 },
    microsDays: 0,
    avgFluidsMl: 0,
    fluidDays: 0,
    fluidHitDays: 0,
    ...overrides,
  };
}

describe('calorieStatus', () => {
  it('classifies days within ±10 % as on target', () => {
    expect(calorieStatus(null, 2000)).toBe('empty');
    expect(calorieStatus(1800, 2000)).toBe('on');
    expect(calorieStatus(2200, 2000)).toBe('on');
    expect(calorieStatus(1799, 2000)).toBe('under');
    expect(calorieStatus(2201, 2000)).toBe('over');
    expect(calorieStatus(500, null)).toBe('on');
  });
});

describe('weekRows', () => {
  it('maps each week date to its summary, marking training and future days', () => {
    const days: DaySummary[] = [
      {
        date: '2026-09-28',
        trainingDay: true,
        targets: { ...DEFAULT_BASE_TARGETS, calories: 2200 },
        totals: { ...zeroNutrients(), calories: 2500.4 },
        entryCount: 3,
        micros: {},
        microsCoverage: { items: 0, withMicros: 0 },
        fluidsMl: 0,
        fluidTargetMl: 2500,
      },
      {
        date: '2026-09-29',
        trainingDay: false,
        targets: { ...DEFAULT_BASE_TARGETS },
        totals: zeroNutrients(),
        entryCount: 0,
        micros: {},
        microsCoverage: { items: 0, withMicros: 0 },
        fluidsMl: 0,
        fluidTargetMl: 2500,
      },
    ];
    const rows = weekRows(['2026-09-28', '2026-09-29', '2026-09-30'], days, '2026-09-29');
    expect(rows[0]).toMatchObject({
      weekday: 'Mon',
      fullLabel: 'Mon 28 Sep',
      calories: 2500,
      target: 2200,
      trainingDay: true,
      status: 'over',
      future: false,
    });
    expect(rows[0].inProgress).toBe(false);
    expect(rows[1]).toMatchObject({
      calories: null,
      target: 2000,
      status: 'empty',
      future: false,
      inProgress: true,
    });
    expect(rows[2]).toMatchObject({ calories: null, target: null, status: 'empty', future: true });
  });
});

describe('consistency tiles', () => {
  it('scores goals and limits against logged days', () => {
    const tiles = consistencyTiles(stats());
    expect(tiles.map((t) => [t.id, t.hits, t.total, t.tone])).toEqual([
      ['protein', 4, 5, 'good'],
      ['calories', 2, 5, 'warn'],
      ['fiber', 1, 5, 'bad'],
      ['satFat', 0, 5, 'good'],
      ['sodium', 3, 5, 'bad'],
    ]);
    expect(consistencyTiles(stats({ loggedDays: 0 })).every((t) => t.tone === 'neutral')).toBe(
      true,
    );
  });
});

describe('averages and macro split', () => {
  it('builds bars for macros and limits with rounded values', () => {
    const bars = averageBars(stats());
    expect(bars.map((b) => b.key)).toEqual([
      'calories',
      'protein',
      'carbs',
      'fat',
      'fiber',
      'satFat',
      'sugar',
      'sodium',
    ]);
    expect(bars[0]).toMatchObject({ value: 2051, target: 2000, kind: 'goal', unit: 'kcal' });
    expect(bars[1].value).toBe(110.4);
    expect(bars[4]).toMatchObject({ kind: 'min', target: DEFAULT_BASE_TARGETS.fiberMin });
    expect(bars[7]).toMatchObject({ kind: 'max', value: 2412, unit: 'mg' });
  });

  it('compares the macro split with the split implied by the targets', () => {
    const shares = macroShares(stats().macroSplit, DEFAULT_BASE_TARGETS);
    expect(shares.map((s) => s.key)).toEqual(['protein', 'carbs', 'fat']);
    expect(shares[0].percent).toBe(22);
    expect(shares[0].targetPercent).toBeCloseTo(24, 0);
    const withAlcohol = macroShares({ protein: 20, carbs: 40, fat: 30, alcohol: 10 }, null);
    expect(withAlcohol.at(-1)).toEqual({
      key: 'alcohol',
      label: 'Alcohol',
      percent: 10,
      targetPercent: null,
    });
    expect(hasMacroData({ protein: 0, carbs: 0, fat: 0, alcohol: 0 })).toBe(false);
    expect(hasMacroData(stats().macroSplit)).toBe(true);
  });
});

describe('fluidWeek', () => {
  function day(date: string, fluidsMl: number, fluidTargetMl: number): DaySummary {
    return {
      date,
      trainingDay: fluidTargetMl > 2800,
      targets: { ...DEFAULT_BASE_TARGETS },
      totals: zeroNutrients(),
      entryCount: 1,
      micros: {},
      microsCoverage: { items: 0, withMicros: 0 },
      fluidsMl,
      fluidTargetMl,
    };
  }

  const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];

  it('scales each day against the largest value and marks the days that hit the target', () => {
    const week = fluidWeek(
      dates,
      [day('2026-09-28', 2900, 2800), day('2026-09-29', 1400, 3300), day('2026-09-30', 0, 2800)],
      stats({ avgFluidsMl: 2150, fluidDays: 2, fluidHitDays: 1 }),
      '2026-09-30',
    );
    expect(week.bars.map((bar) => bar.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu']);
    expect(week.bars[0]).toMatchObject({
      ml: 2900,
      target: 2800,
      hit: true,
      fillPercent: 82.9,
      targetPercent: 80,
      value: '2.9',
      label: 'Mon 28 Sep: 2.9 of 2.8 L, target reached',
    });
    expect(week.bars[1]).toMatchObject({
      hit: false,
      fillPercent: 40,
      targetPercent: 94.3,
      value: '1.4',
    });
    expect(week.bars[2]).toMatchObject({ inProgress: true, fillPercent: 0, value: '–' });
    expect(week.bars[3]).toMatchObject({
      future: true,
      fillPercent: 0,
      value: '',
      label: 'Thu 1 Oct: upcoming',
    });
    expect(week.hasData).toBe(true);
    expect(week.average).toBe('2.2');
    expect(week.averageTarget).toBe('3.0');
    expect(week.summary).toBe('Target reached 1 of 2 days with drinks logged');
    expect(week.chartLabel).toContain('Tue 29 Sep: 1.4 of 3.3 L');
    expect(week.chartLabel).not.toContain('upcoming');
  });

  it('keeps a round custom target line inside the chart', () => {
    const week = fluidWeek(
      dates,
      [day('2026-09-29', 1100, 3500), day('2026-09-30', 3500, 3500)],
      stats({ avgFluidsMl: 2300, fluidDays: 2, fluidHitDays: 1 }),
      '2026-09-30',
    );
    expect(week.bars[1]).toMatchObject({ fillPercent: 27.5, targetPercent: 87.5, hit: false });
    expect(week.bars[2]).toMatchObject({ fillPercent: 87.5, targetPercent: 87.5, hit: true });
    expect(week.bars.every((bar) => bar.targetPercent < 100)).toBe(true);
  });

  it('explains an empty week', () => {
    const week = fluidWeek(dates, [], stats(), '2026-10-01');
    expect(week.hasData).toBe(false);
    expect(week.summary).toBe('No drinks logged this week yet');
    expect(week.bars.every((bar) => bar.fillPercent === 0)).toBe(true);
    expect(week.averageTarget).toBe('0.0');
  });

  it('says day for a single day with drinks', () => {
    expect(
      fluidWeek(dates, [], stats({ fluidDays: 1, fluidHitDays: 1 }), '2026-10-01').summary,
    ).toBe('Target reached 1 of 1 day with drinks logged');
  });
});
