import {
  addDays,
  type DailyIntake,
  eachDate,
  type WeightLogDto,
} from '@food/shared';
import {
  adaptiveTdeeWindow,
  buildWeightSummary,
  dailyIntake,
  trendWarmupStart,
  WEIGHT_TREND_WARMUP_DAYS,
} from './weight-summary.js';

const TO = '2026-09-28';

function log(date: string, weightKg: number, bodyFatPct: number | null = null) {
  return { date, weightKg, bodyFatPct } satisfies WeightLogDto;
}

function dailyLogs(
  lastDate: string,
  days: number,
  weightAt: (index: number) => number,
): WeightLogDto[] {
  const first = addDays(lastDate, -(days - 1));
  return eachDate(first, lastDate).map((date, index) =>
    log(date, weightAt(index)),
  );
}

function fullIntake(to: string, calories: number): DailyIntake[] {
  const window = adaptiveTdeeWindow(to);
  return eachDate(window.from, window.to).map((date) => ({
    date,
    calories,
    logged: true,
  }));
}

describe('adaptiveTdeeWindow', () => {
  it('covers the 28 days ending the day before to', () => {
    const window = adaptiveTdeeWindow(TO);
    expect(window).toEqual({ from: '2026-08-31', to: '2026-09-27' });
    expect(eachDate(window.from, window.to)).toHaveLength(28);
  });
});

describe('trendWarmupStart', () => {
  it('reaches 60 days before from', () => {
    expect(WEIGHT_TREND_WARMUP_DAYS).toBe(60);
    expect(trendWarmupStart('2026-09-01')).toBe('2026-07-03');
  });
});

describe('dailyIntake', () => {
  it('returns one day per window date, filling gaps with unlogged zero days', () => {
    const intake = dailyIntake({ from: '2026-09-01', to: '2026-09-04' }, [
      { date: '2026-09-02', calories: 2100.5, entryCount: 3 },
      { date: '2026-09-03', calories: null, entryCount: 1 },
      { date: '2026-09-04', calories: 0, entryCount: 0 },
    ]);
    expect(intake).toEqual([
      { date: '2026-09-01', calories: 0, logged: false },
      { date: '2026-09-02', calories: 2100.5, logged: true },
      { date: '2026-09-03', calories: 0, logged: true },
      { date: '2026-09-04', calories: 0, logged: false },
    ]);
  });
});

describe('buildWeightSummary', () => {
  it('returns empty series and null metrics without any weigh-ins', () => {
    const summary = buildWeightSummary({
      from: '2026-09-26',
      to: TO,
      logs: [],
      latest: null,
      intake: [],
    });
    expect(summary).toEqual({
      from: '2026-09-26',
      to: TO,
      logs: [],
      trend: [
        { date: '2026-09-26', weightKg: null, trendKg: null },
        { date: '2026-09-27', weightKg: null, trendKg: null },
        { date: '2026-09-28', weightKg: null, trendKg: null },
      ],
      latest: null,
      weeklyChangeKg: null,
      adaptiveTdee: null,
    });
  });

  it('lists only the logs inside the range and passes latest through', () => {
    const logs = [
      log('2026-09-20', 81),
      log('2026-09-26', 80.4, 18.2),
      log('2026-09-28', 80.2),
    ];
    const summary = buildWeightSummary({
      from: '2026-09-25',
      to: TO,
      logs,
      latest: logs[2]!,
      intake: [],
    });
    expect(summary.logs).toEqual([logs[1], logs[2]]);
    expect(summary.latest).toEqual(logs[2]);
    expect(summary.trend.map((point) => point.date)).toEqual(
      eachDate('2026-09-25', TO),
    );
    expect(summary.trend[0]).toEqual({
      date: '2026-09-25',
      weightKg: null,
      trendKg: 81,
    });
    expect(summary.trend[1]).toEqual({
      date: '2026-09-26',
      weightKg: 80.4,
      trendKg: 80.94,
    });
  });

  it('warms the trend up with at most 60 days of earlier weigh-ins', () => {
    const from = '2026-09-01';
    const summary = buildWeightSummary({
      from,
      to: from,
      logs: [
        log(addDays(from, -61), 150),
        log(addDays(from, -60), 90),
        log(from, 80),
      ],
      latest: log(from, 80),
      intake: [],
    });
    expect(summary.trend).toEqual([{ date: from, weightKg: 80, trendKg: 89 }]);
  });

  it('ignores weigh-ins after to', () => {
    const summary = buildWeightSummary({
      from: TO,
      to: TO,
      logs: [log(TO, 80), log(addDays(TO, 1), 70)],
      latest: log(TO, 80),
      intake: [],
    });
    expect(summary.logs).toEqual([log(TO, 80)]);
    expect(summary.trend).toEqual([{ date: TO, weightKg: 80, trendKg: 80 }]);
  });

  it('computes the weekly change from the last three weeks of weigh-ins', () => {
    const logs = dailyLogs(TO, 21, (index) => 82 - index * 0.1);
    const summary = buildWeightSummary({
      from: addDays(TO, -6),
      to: TO,
      logs,
      latest: logs.at(-1)!,
      intake: [],
    });
    expect(summary.weeklyChangeKg).toBe(-0.7);
  });

  it('estimates the adaptive TDEE from the intake window and weigh-ins', () => {
    const logs = dailyLogs(addDays(TO, -1), 28, (index) => 85 - index * 0.04);
    const summary = buildWeightSummary({
      from: addDays(TO, -27),
      to: TO,
      logs,
      latest: logs.at(-1)!,
      intake: fullIntake(TO, 2500),
    });
    expect(summary.adaptiveTdee).toEqual({
      kcal: 2810,
      windowDays: 28,
      loggedDays: 28,
      weighIns: 28,
      avgIntakeKcal: 2500,
      weightChangeKg: -1.08,
      confidence: 'high',
    });
  });

  it('leaves the adaptive TDEE null without enough logged days', () => {
    const logs = dailyLogs(addDays(TO, -1), 28, (index) => 85 - index * 0.04);
    const intake = fullIntake(TO, 2500).map((day, index) =>
      index % 2 === 0 ? { ...day, calories: 0, logged: false } : day,
    );
    const summary = buildWeightSummary({
      from: addDays(TO, -27),
      to: TO,
      logs,
      latest: logs.at(-1)!,
      intake,
    });
    expect(summary.adaptiveTdee).toBeNull();
  });
});
