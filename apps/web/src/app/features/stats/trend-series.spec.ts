import { DEFAULT_BASE_TARGETS, zeroNutrients, type DaySummary } from '@food/shared';
import {
  buildTrendSeries,
  isTrendNutrient,
  movingAverage,
  weekdayMetricFor,
  weekdayRows,
} from './trend-series';

function day(
  date: string,
  calories: number | null,
  overrides: Partial<DaySummary> = {},
): DaySummary {
  return {
    date,
    trainingDay: false,
    targets: { ...DEFAULT_BASE_TARGETS },
    totals: { ...zeroNutrients(), calories: calories ?? 0, sodium: (calories ?? 0) * 1.5 },
    entryCount: calories === null ? 0 : 2,
    micros: {},
    microsCoverage: { items: 0, withMicros: 0 },
    fluidsMl: 0,
    fluidTargetMl: 2500,
    ...overrides,
  };
}

describe('movingAverage', () => {
  it('averages the available values in a trailing window and skips gaps', () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
    expect(movingAverage([10, null, 20, null, null], 3)).toEqual([10, 10, 15, 20, 20]);
    expect(movingAverage([null, null, 6], 7)).toEqual([null, null, 6]);
    expect(movingAverage([null, null, null, null, 4], 2)).toEqual([null, null, null, null, 4]);
  });

  it('rounds to the requested decimals and tolerates a degenerate window', () => {
    expect(movingAverage([1, 2, 2], 3, 0)).toEqual([1, 2, 2]);
    expect(movingAverage([1, 2], 0)).toEqual([1, 2]);
    expect(movingAverage([], 7)).toEqual([]);
  });
});

describe('buildTrendSeries', () => {
  const days = [
    day('2026-09-03', 1900),
    day('2026-09-01', 2100),
    day('2026-09-02', null),
    day('2026-09-04', 2500, {
      trainingDay: true,
      targets: { ...DEFAULT_BASE_TARGETS, calories: 2200 },
    }),
  ];

  it('sorts by date, leaves unlogged days as gaps and adds targets and a moving average', () => {
    const series = buildTrendSeries(days, 'calories');
    expect(series.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(series.labels).toEqual(['1 Sep', '2 Sep', '3 Sep', '4 Sep']);
    expect(series.values).toEqual([2100, null, 1900, 2500]);
    expect(series.targets).toEqual([2000, 2000, 2000, 2200]);
    expect(series.movingAverage).toEqual([2100, 2100, 2000, 2167]);
    expect(series.targetKind).toBe('goal');
    expect(series.loggedDays).toBe(3);
    expect(series.totalDays).toBe(4);
    expect(series.average).toBe(2167);
    expect(series.averageTarget).toBe(2067);
  });

  it('uses the matching limit or minimum for other nutrients', () => {
    const sodium = buildTrendSeries(days, 'sodium');
    expect(sodium.targetKind).toBe('max');
    expect(sodium.targets[0]).toBe(DEFAULT_BASE_TARGETS.sodiumMax);
    expect(sodium.values[0]).toBe(3150);
    const fiber = buildTrendSeries(days, 'fiber');
    expect(fiber.targetKind).toBe('min');
    expect(fiber.targets[0]).toBe(DEFAULT_BASE_TARGETS.fiberMin);
  });

  it('seeds the moving average with lead-in days without plotting them', () => {
    const leadIn = [day('2026-08-31', 3000), day('2026-08-30', 1000), day('2026-09-02', 9999)];
    const series = buildTrendSeries(days, 'calories', { leadIn });
    expect(series.dates[0]).toBe('2026-09-01');
    expect(series.values).toEqual([2100, null, 1900, 2500]);
    expect(series.movingAverage).toEqual([2033, 2033, 2000, 2100]);
    expect(series.loggedDays).toBe(3);
    expect(series.average).toBe(2167);
  });

  it('keeps the unfinished current day out of the moving average but still plots it', () => {
    const series = buildTrendSeries(days, 'calories', { inProgressDate: '2026-09-04' });
    expect(series.values.at(-1)).toBe(2500);
    expect(series.movingAverage).toEqual([2100, 2100, 2000, 2000]);
  });

  it('handles a range with nothing logged', () => {
    const series = buildTrendSeries([day('2026-09-01', null)], 'protein');
    expect(series.values).toEqual([null]);
    expect(series.average).toBeNull();
    expect(series.averageTarget).toBe(DEFAULT_BASE_TARGETS.protein);
    expect(series.loggedDays).toBe(0);
  });
});

describe('weekday rows', () => {
  it('orders Monday to Sunday and hides days without logs', () => {
    const rows = weekdayRows(
      [
        { weekday: 0, loggedDays: 2, calories: 2400.4, protein: 90, carbs: 250, fat: 80 },
        { weekday: 1, loggedDays: 3, calories: 1800, protein: 130.26, carbs: 180, fat: 60 },
        { weekday: 3, loggedDays: 0, calories: 0, protein: 0, carbs: 0, fat: 0 },
      ],
      'protein',
    );
    expect(rows.map((row) => row.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(rows[0].value).toBe(130.3);
    expect(rows[2].value).toBeNull();
    expect(rows[6]).toEqual({ weekday: 0, label: 'Sun', value: 90, loggedDays: 2 });
    expect(rows[1]).toEqual({ weekday: 2, label: 'Tue', value: null, loggedDays: 0 });
  });

  it('maps nutrients without weekday data to calories', () => {
    expect(weekdayMetricFor('fat')).toBe('fat');
    expect(weekdayMetricFor('sodium')).toBe('calories');
    expect(isTrendNutrient('satFat')).toBe(true);
    expect(isTrendNutrient('alcohol')).toBe(false);
  });
});
