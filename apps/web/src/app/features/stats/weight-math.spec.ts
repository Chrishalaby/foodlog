import type { WeightLogDto, WeightSummaryResponse, WeightTrendPointDto } from '@food/shared';
import {
  bodyFatError,
  compareBurn,
  dayPhrase,
  firstMissingDate,
  formatKg,
  formatSigned,
  formatSignedKg,
  lastTrendPoint,
  parseBodyFatText,
  parseWeightText,
  percentDecimals,
  readWeighInDraft,
  recentWeighIns,
  retrend,
  stepWeight,
  trendRangeChange,
  weighInsPerWeek,
  weeklyPercent,
  weightChangeTone,
  weightError,
  weighInEdit,
  weightText,
  withWeighIn,
  withoutWeighIn,
} from './weight-math';

const log = (date: string, weightKg: number, bodyFatPct: number | null = null): WeightLogDto => ({
  date,
  weightKg,
  bodyFatPct,
});

const point = (
  date: string,
  weightKg: number | null,
  trendKg: number | null,
): WeightTrendPointDto => ({ date, weightKg, trendKg });

describe('weight formatting', () => {
  it('always shows one decimal and a real minus sign', () => {
    expect(formatKg(80)).toBe('80.0');
    expect(formatKg(80.04)).toBe('80.0');
    expect(formatKg(1234.56)).toBe('1,234.6');
    expect(formatKg(-0.01)).toBe('0.0');
    expect(formatSignedKg(0.34)).toBe('+0.3');
    expect(formatSignedKg(-1.26)).toBe('−1.3');
    expect(formatSignedKg(-0.04)).toBe('0.0');
    expect(formatSigned(-0.426, 2)).toBe('−0.43');
    expect(formatSigned(180, 0)).toBe('+180');
    expect(formatSigned(-1250, 0)).toBe('−1,250');
  });

  it('uses more decimals for tiny percentages', () => {
    expect(percentDecimals(0.05)).toBe(2);
    expect(percentDecimals(-0.5)).toBe(1);
  });

  it('describes days in plain words', () => {
    expect(dayPhrase('2026-09-28', '2026-09-28')).toBe('today');
    expect(dayPhrase('2026-09-27', '2026-09-28')).toBe('yesterday');
    expect(dayPhrase('2026-09-21', '2026-09-28')).toBe('Mon 21 Sep');
  });
});

describe('weight input', () => {
  it('parses decimal commas and rounds to 0.1 kg', () => {
    expect(parseWeightText(' 80,46 ')).toBe(80.5);
    expect(parseWeightText('')).toBeNull();
    expect(parseWeightText('abc')).toBeNull();
    expect(weightText(80)).toBe('80.0');
    expect(weightText(null)).toBe('');
  });

  it('validates against the shared body bounds', () => {
    expect(weightError(null)).toBe('Enter your weight in kg.');
    expect(weightError(24.9)).toBe('Enter a weight between 25 and 400 kg.');
    expect(weightError(400.1)).toBe('Enter a weight between 25 and 400 kg.');
    expect(weightError(72.4)).toBeNull();
  });

  it('treats body fat as optional but bounded', () => {
    expect(parseBodyFatText('')).toBeNull();
    expect(parseBodyFatText('18,25')).toBe(18.3);
    expect(parseBodyFatText('x')).toBeUndefined();
    expect(bodyFatError(null)).toBeNull();
    expect(bodyFatError(undefined)).toBe('Body fat must be between 3 and 70 %.');
    expect(bodyFatError(71)).toBe('Body fat must be between 3 and 70 %.');
    expect(bodyFatError(18)).toBeNull();
  });

  it('reads a whole draft at once', () => {
    expect(readWeighInDraft('72.4', '')).toEqual({
      weightKg: 72.4,
      bodyFatPct: null,
      weightError: null,
      bodyFatError: null,
    });
    expect(readWeighInDraft('', 'x').weightError).not.toBeNull();
    expect(readWeighInDraft('', 'x').bodyFatError).not.toBeNull();
  });

  it('steps by 0.1 kg within bounds and starts from a fallback when empty', () => {
    expect(stepWeight(80, 1)).toBe(80.1);
    expect(stepWeight(80.1, -1)).toBe(80);
    expect(stepWeight(400, 1)).toBe(400);
    expect(stepWeight(25, -1)).toBe(25);
    expect(stepWeight(null, 1, 72.3)).toBe(72.3);
    expect(stepWeight(null, 1)).toBeNull();
  });
});

describe('trend math', () => {
  const trend = [
    point('2026-09-01', null, 81),
    point('2026-09-02', 80.5, 80.95),
    point('2026-09-03', null, 80.95),
    point('2026-09-04', 80, 80.86),
  ];

  it('finds the first and last trend values', () => {
    expect(lastTrendPoint(trend)).toEqual({ date: '2026-09-04', trendKg: 80.86 });
    expect(lastTrendPoint([point('2026-09-01', null, null)])).toBeNull();
  });

  it('measures the change over the range', () => {
    expect(trendRangeChange(trend)).toEqual({
      fromDate: '2026-09-01',
      toDate: '2026-09-04',
      fromKg: 81,
      toKg: 80.86,
      changeKg: -0.14,
      days: 3,
    });
    expect(trendRangeChange([point('2026-09-01', 80, 80)])).toBeNull();
  });

  it('expresses the weekly rate as a share of body weight', () => {
    expect(weeklyPercent(-0.4, 80)).toBe(-0.5);
    expect(weeklyPercent(null, 80)).toBeNull();
    expect(weeklyPercent(-0.4, null)).toBeNull();
  });

  it('recomputes the moving trend from an edited day onwards', () => {
    const updated = retrend(trend, '2026-09-03', 79.5);
    expect(updated.slice(0, 2)).toEqual(trend.slice(0, 2));
    expect(updated[2]?.weightKg).toBe(79.5);
    expect(updated[2]?.trendKg).toBeCloseTo(80.8, 1);
    expect(updated[3]?.trendKg).toBeCloseTo(80.72, 2);
    expect(retrend(trend, '2026-08-01', 70)).toEqual(trend);
  });

  it('starts a trend from the first weigh-in and backs out the warm-up on day one', () => {
    const empty = [point('2026-09-01', null, null), point('2026-09-02', null, null)];
    expect(retrend(empty, '2026-09-01', 80).map((p) => p.trendKg)).toEqual([80, 80]);
    const warmed = [point('2026-09-01', 81, 80.1), point('2026-09-02', null, 80.1)];
    const edited = retrend(warmed, '2026-09-01', 79);
    expect(edited[0]?.trendKg).toBeCloseTo(79.9, 5);
    expect(retrend(warmed, '2026-09-01', null)[0]?.trendKg).toBe(80);
  });
});

describe('weight change tone', () => {
  it('praises losing on a cut but flags going too fast', () => {
    expect(weightChangeTone(-0.5, 'cut', 80)).toBe('good');
    expect(weightChangeTone(-1, 'cut', 80)).toBe('caution');
    expect(weightChangeTone(0.3, 'cut', 80)).toBe('caution');
    expect(weightChangeTone(0, 'cut', 80)).toBe('neutral');
  });

  it('praises slow gains on a bulk', () => {
    expect(weightChangeTone(0.25, 'bulk', 80)).toBe('good');
    expect(weightChangeTone(0.6, 'bulk', 80)).toBe('caution');
    expect(weightChangeTone(-0.3, 'bulk', 80)).toBe('caution');
  });

  it('praises stability when maintaining', () => {
    expect(weightChangeTone(0.1, 'maintain')).toBe('good');
    expect(weightChangeTone(-0.3, 'maintain')).toBe('neutral');
    expect(weightChangeTone(0.6, 'maintain')).toBe('caution');
    expect(weightChangeTone(null, 'maintain')).toBe('neutral');
    expect(weightChangeTone(-0.5, null)).toBe('neutral');
  });
});

describe('weigh-in lists', () => {
  const logs = [log('2026-09-03', 80.2, 18.5), log('2026-09-01', 81), log('2026-09-02', 80.6)];

  it('lists the latest weigh-ins first with the change from the one before', () => {
    expect(recentWeighIns(logs)).toEqual([
      { date: '2026-09-03', weightKg: 80.2, bodyFatPct: 18.5, deltaKg: -0.4 },
      { date: '2026-09-02', weightKg: 80.6, bodyFatPct: null, deltaKg: -0.4 },
      { date: '2026-09-01', weightKg: 81, bodyFatPct: null, deltaKg: null },
    ]);
    expect(recentWeighIns(logs, 1)).toHaveLength(1);
  });

  it('counts weigh-ins per week over the last four weeks', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      log(`2026-09-${String(10 + i * 2).padStart(2, '0')}`, 80),
    );
    expect(weighInsPerWeek(many, '2026-09-28')).toBe(2.5);
    expect(weighInsPerWeek([], '2026-09-28')).toBe(0);
  });

  it('suggests the most recent day without a weigh-in', () => {
    expect(firstMissingDate(logs, '2026-09-04')).toBe('2026-09-04');
    expect(firstMissingDate(logs, '2026-09-03')).toBe('2026-08-31');
    expect(firstMissingDate(logs, '2026-09-03', 2)).toBe('2026-09-03');
  });

  it('compares a measured burn with the current one', () => {
    expect(compareBurn(2480, 2300)).toEqual({ currentKcal: 2300, diffKcal: 180, diffPercent: 8 });
    expect(compareBurn(2480, null)).toBeNull();
  });
});

describe('optimistic summary updates', () => {
  const summary: WeightSummaryResponse = {
    from: '2026-09-01',
    to: '2026-09-03',
    logs: [log('2026-09-01', 81)],
    trend: [
      point('2026-09-01', 81, 81),
      point('2026-09-02', null, 81),
      point('2026-09-03', null, 81),
    ],
    latest: log('2026-09-01', 81),
    weeklyChangeKg: null,
    adaptiveTdee: null,
  };

  it('adds a weigh-in, makes it the latest and moves the trend', () => {
    const next = withWeighIn(summary, log('2026-09-03', 80));
    expect(next.logs.map((l) => l.date)).toEqual(['2026-09-01', '2026-09-03']);
    expect(next.latest?.date).toBe('2026-09-03');
    expect(next.trend[2]).toEqual(point('2026-09-03', 80, 80.9));
  });

  it('ignores weigh-ins outside the range for the list but keeps the latest honest', () => {
    const before = withWeighIn(summary, log('2026-08-20', 82));
    expect(before.logs).toEqual(summary.logs);
    expect(before.latest?.date).toBe('2026-09-01');
    const after = withWeighIn(summary, log('2026-09-10', 79));
    expect(after.latest?.date).toBe('2026-09-01');
  });

  it('replaces an existing day and removes one again', () => {
    const replaced = withWeighIn(summary, log('2026-09-01', 80.5));
    expect(replaced.logs).toEqual([log('2026-09-01', 80.5)]);
    const removed = withoutWeighIn(withWeighIn(summary, log('2026-09-02', 80)), '2026-09-02');
    expect(removed.logs).toEqual(summary.logs);
    expect(removed.latest?.date).toBe('2026-09-01');
    expect(removed.trend[1]?.weightKg).toBeNull();
    expect(withoutWeighIn(summary, '2026-09-01').latest).toBeNull();
  });
});

describe('weighInEdit', () => {
  const row = { date: '2026-09-27', weightKg: 80.2, bodyFatPct: 18.5 };

  it('leaves body fat out when it was not changed so the stored reading and profile stay put', () => {
    const edit = weighInEdit(row, { weightKg: 80.1, bodyFatPct: 18.5 });
    expect(edit).toEqual({ date: '2026-09-27', weightKg: 80.1 });
    expect('bodyFatPct' in edit).toBe(false);
  });

  it('compares against the stored reading as shown in the field', () => {
    const edit = weighInEdit({ ...row, bodyFatPct: 18.54 }, { weightKg: 80, bodyFatPct: 18.5 });
    expect('bodyFatPct' in edit).toBe(false);
  });

  it('sends a changed body fat reading', () => {
    expect(weighInEdit(row, { weightKg: 80.2, bodyFatPct: 17 })).toEqual({
      date: '2026-09-27',
      weightKg: 80.2,
      bodyFatPct: 17,
    });
  });

  it('sends null when a stored reading was cleared', () => {
    expect(weighInEdit(row, { weightKg: 80.2, bodyFatPct: null })).toEqual({
      date: '2026-09-27',
      weightKg: 80.2,
      bodyFatPct: null,
    });
  });

  it('leaves body fat out for a weigh-in without one when the field stays empty', () => {
    const edit = weighInEdit({ ...row, bodyFatPct: null }, { weightKg: 81, bodyFatPct: null });
    expect(edit).toEqual({ date: '2026-09-27', weightKg: 81 });
    expect('bodyFatPct' in edit).toBe(false);
  });

  it('sends a first body fat reading for a weigh-in without one', () => {
    expect(weighInEdit({ ...row, bodyFatPct: null }, { weightKg: 81, bodyFatPct: 15 })).toEqual({
      date: '2026-09-27',
      weightKg: 81,
      bodyFatPct: 15,
    });
  });
});
