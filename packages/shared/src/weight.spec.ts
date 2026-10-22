import { describe, expect, it } from 'vitest';
import { addDays, eachDate } from './dates.js';
import { adaptiveTdee, weeklyWeightChange, weightTrendSeries, type DailyIntake, type WeightPoint } from './weight.js';

const start = '2026-09-01';

function steadyLoss(days: number, startKg: number, kgPerDay: number, everyNDays = 1): WeightPoint[] {
  return eachDate(start, addDays(start, days - 1))
    .filter((_, i) => i % everyNDays === 0)
    .map((date) => {
      const i = eachDate(start, date).length - 1;
      return { date, weightKg: Math.round((startKg + kgPerDay * i) * 100) / 100 };
    });
}

describe('weightTrendSeries', () => {
  it('smooths weigh-ins and carries the trend across gaps', () => {
    const logs = [
      { date: '2026-09-01', weightKg: 80 },
      { date: '2026-09-03', weightKg: 82 },
    ];
    const series = weightTrendSeries(logs, '2026-09-01', '2026-09-04');
    expect(series.map((p) => p.trendKg)).toEqual([80, 80, 80.2, 80.2]);
    expect(series[1]!.weightKg).toBeNull();
  });

  it('warms up from logs before the window and leaves days before the first log empty', () => {
    const series = weightTrendSeries([{ date: '2026-09-05', weightKg: 70 }], '2026-09-04', '2026-09-05');
    expect(series[0]!.trendKg).toBeNull();
    expect(series[1]!.trendKg).toBe(70);
    const warmed = weightTrendSeries([{ date: '2026-08-20', weightKg: 75 }], '2026-09-01', '2026-09-01');
    expect(warmed[0]!.trendKg).toBe(75);
  });
});

describe('weeklyWeightChange', () => {
  it('measures the regression slope per week', () => {
    const logs = steadyLoss(21, 82, -0.1);
    expect(weeklyWeightChange(logs, addDays(start, 20))).toBeCloseTo(-0.7, 2);
  });

  it('needs at least a week of data', () => {
    expect(weeklyWeightChange(steadyLoss(5, 82, -0.1), addDays(start, 4))).toBeNull();
  });
});

describe('adaptiveTdee', () => {
  const intake = (days: number, kcal: number, loggedEvery = 1): DailyIntake[] =>
    eachDate(start, addDays(start, days - 1)).map((date, i) => ({
      date,
      calories: i % loggedEvery === 0 ? kcal : 0,
      logged: i % loggedEvery === 0,
    }));

  it('adds the energy deficit implied by weight loss to intake', () => {
    const result = adaptiveTdee(intake(28, 2200), steadyLoss(28, 82, -0.05));
    expect(result).not.toBeNull();
    expect(result!.kcal).toBe(2590);
    expect(result!.confidence).toBe('high');
    expect(result!.weightChangeKg).toBeCloseTo(-1.35, 2);
  });

  it('refuses with too little logging or too few weigh-ins', () => {
    expect(adaptiveTdee(intake(28, 2200, 2), steadyLoss(28, 82, -0.05))).toBeNull();
    expect(adaptiveTdee(intake(28, 2200), steadyLoss(28, 82, -0.05, 10))).toBeNull();
    expect(adaptiveTdee(intake(10, 2200), steadyLoss(10, 82, -0.05))).toBeNull();
  });
});
