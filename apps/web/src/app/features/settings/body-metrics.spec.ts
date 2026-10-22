import type { WeightSummaryResponse } from '@food/shared';
import {
  adaptiveSummary,
  bodyFatHint,
  daysAgoLabel,
  oneDecimal,
  scalePercent,
  signedKg,
  weeklyChangeTone,
} from './body-metrics';
import { latestTrendKg, weightView } from './sections/body-section';

const SUMMARY: WeightSummaryResponse = {
  from: '2026-08-30',
  to: '2026-09-28',
  logs: [],
  trend: [
    { date: '2026-09-26', weightKg: 80.2, trendKg: 80.4 },
    { date: '2026-09-27', weightKg: null, trendKg: 80.31 },
    { date: '2026-09-28', weightKg: null, trendKg: null },
  ],
  latest: { date: '2026-09-26', weightKg: 80.2, bodyFatPct: null },
  weeklyChangeKg: 0.3,
  adaptiveTdee: null,
};

describe('body metric helpers', () => {
  it('places values on the BMI scale', () => {
    expect(scalePercent(15)).toBe(0);
    expect(scalePercent(25)).toBe(40);
    expect(scalePercent(55)).toBe(100);
    expect(scalePercent(Number.NaN)).toBe(0);
  });

  it('gives a body fat hint that fits the selected sex', () => {
    expect(bodyFatHint('male')).toContain('12 and 25 %');
    expect(bodyFatHint('female')).toContain('20 and 35 %');
    expect(bodyFatHint('')).toContain('Skip if unsure');
  });

  it('always shows one decimal for body values', () => {
    expect(oneDecimal(26)).toBe('26.0');
    expect(oneDecimal(25.84)).toBe('25.8');
  });

  it('formats signed weight changes', () => {
    expect(signedKg(-0.42)).toBe('−0.4 kg');
    expect(signedKg(0.26)).toBe('+0.3 kg');
    expect(signedKg(0.01)).toBe('0 kg');
  });

  it('rates the weekly change against the goal', () => {
    expect(weeklyChangeTone(-0.4, 'cut')).toBe('ok');
    expect(weeklyChangeTone(0.3, 'cut')).toBe('warn');
    expect(weeklyChangeTone(0.2, 'bulk')).toBe('ok');
    expect(weeklyChangeTone(-0.3, 'bulk')).toBe('warn');
    expect(weeklyChangeTone(0.1, 'maintain')).toBe('ok');
    expect(weeklyChangeTone(-0.6, 'maintain')).toBe('warn');
    expect(weeklyChangeTone(null, 'cut')).toBe('neutral');
  });

  it('describes how long ago a weigh-in was', () => {
    expect(daysAgoLabel('2026-09-28', '2026-09-28')).toBe('Today');
    expect(daysAgoLabel('2026-09-27', '2026-09-28')).toBe('Yesterday');
    expect(daysAgoLabel('2026-09-24', '2026-09-28')).toBe('4 days ago');
    expect(daysAgoLabel('2026-09-10', '2026-09-28')).toBe('Thu 10 Sep');
  });

  it('summarizes how the measured burn was calculated', () => {
    expect(
      adaptiveSummary({
        kcal: 2650,
        windowDays: 28,
        loggedDays: 26,
        weighIns: 1,
        avgIntakeKcal: 2400,
        weightChangeKg: -0.9,
        confidence: 'high',
      }),
    ).toBe('From 26 logged days and 1 weigh-in over the last 4 weeks · high confidence');
  });
});

describe('weight row', () => {
  it('uses the most recent smoothed value', () => {
    expect(latestTrendKg(SUMMARY)).toBe(80.31);
    expect(latestTrendKg({ ...SUMMARY, trend: [] })).toBeNull();
  });

  it('builds the latest weigh-in, trend and change', () => {
    expect(weightView(SUMMARY, 'cut', '2026-09-28')).toEqual({
      latest: '80.2 kg',
      when: '2 days ago',
      trend: '80.3 kg',
      change: '+0.3 kg',
      changeHint: 'per week',
      changeClass: 'text-warn',
    });
    expect(weightView({ ...SUMMARY, weeklyChangeKg: null }, 'cut', '2026-09-28')).toMatchObject({
      change: '—',
      changeHint: 'needs more data',
      changeClass: 'text-fg',
    });
    expect(
      weightView({ ...SUMMARY, weeklyChangeKg: 0.02 }, 'maintain', '2026-09-28'),
    ).toMatchObject({ change: 'Stable', changeClass: 'text-ok' });
    expect(weightView({ ...SUMMARY, latest: null }, 'cut', '2026-09-28')).toBeNull();
  });
});
