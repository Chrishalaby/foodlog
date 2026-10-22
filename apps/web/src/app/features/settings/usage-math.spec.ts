import {
  budgetNote,
  budgetStatus,
  formatDuration,
  formatTokenCount,
  formatUsd,
  modelBreakdown,
  monthLabel,
  projectMonthEndUsd,
  recentUtcMonths,
  utcMonthOf,
} from './usage-math';

describe('usage months', () => {
  it('uses the UTC month', () => {
    expect(utcMonthOf(new Date('2026-09-30T23:30:00-05:00'))).toBe('2026-10');
    expect(utcMonthOf(new Date('2026-10-01T01:00:00+03:00'))).toBe('2026-09');
  });

  it('lists recent months across a year boundary', () => {
    expect(recentUtcMonths(new Date('2026-02-10T12:00:00Z'), 4)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });

  it('labels months', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('bogus')).toBe('bogus');
  });
});

describe('projectMonthEndUsd', () => {
  it('projects linearly from the elapsed part of the month', () => {
    const now = new Date('2026-09-16T00:00:00Z');
    expect(projectMonthEndUsd(1.5, '2026-09', now)).toBeCloseTo(3, 6);
  });

  it('treats the first day as a full day to avoid wild projections', () => {
    const now = new Date('2026-09-01T02:00:00Z');
    expect(projectMonthEndUsd(0.1, '2026-09', now)).toBeCloseTo(3, 6);
  });

  it('does not project past or future months', () => {
    const now = new Date('2026-09-16T00:00:00Z');
    expect(projectMonthEndUsd(4, '2026-08', now)).toBeNull();
    expect(projectMonthEndUsd(0, '2026-10', now)).toBeNull();
  });
});

describe('budgetStatus', () => {
  it('returns null without a budget', () => {
    expect(budgetStatus(1, null)).toBeNull();
    expect(budgetStatus(1, 0)).toBeNull();
  });

  it('grades spend against the budget', () => {
    expect(budgetStatus(2, 10)).toMatchObject({ percent: 20, level: 'ok', remainingUsd: 8 });
    expect(budgetStatus(8.5, 10)?.level).toBe('warn');
    expect(budgetStatus(12, 10)).toMatchObject({
      level: 'over',
      fillPercent: 100,
      remainingUsd: 0,
    });
  });
});

describe('budgetNote', () => {
  it('describes the current month with what is left or the pace', () => {
    expect(budgetNote(budgetStatus(2, 10)!, true, false)).toBe('20% used · $8.00 left');
    expect(budgetNote(budgetStatus(6, 10)!, true, true)).toContain('At this pace');
    expect(budgetNote(budgetStatus(10, 10)!, true, false)).toContain('blocked until next month');
  });

  it('does not claim analyses are blocked when looking at a past month', () => {
    expect(budgetNote(budgetStatus(12, 10)!, false, false)).toBe('Budget reached (120% used).');
    expect(budgetNote(budgetStatus(4, 10)!, false, false)).toBe('40% of the budget used.');
  });
});

describe('formatting', () => {
  it('formats USD for tiny and large amounts', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0412)).toBe('$0.041');
    expect(formatUsd(0.5)).toBe('$0.50');
    expect(formatUsd(0.0004)).toBe('<$0.001');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
  });

  it('formats token counts and durations compactly', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(2840)).toBe('2.8k');
    expect(formatTokenCount(15_400)).toBe('15k');
    expect(formatTokenCount(2_500_000)).toBe('2.5M');
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(12_340)).toBe('12 s');
    expect(formatDuration(4_560)).toBe('4.6 s');
  });
});

describe('modelBreakdown', () => {
  it('sorts by cost and computes shares with friendly labels', () => {
    const rows = modelBreakdown(
      [
        { model: 'gpt-6-luna', requests: 10, costUsd: 0.01 },
        { model: 'gpt-5.6-sol', requests: 5, costUsd: 0.2 },
        { model: 'gpt-6-sol', requests: 2, costUsd: 0.04 },
      ],
      new Map([['gpt-5.6-sol', 'GPT-5.6 Sol']]),
    );
    expect(rows.map((row) => row.label)).toEqual(['GPT-5.6 Sol', 'gpt-6-sol', 'gpt-6-luna']);
    expect(rows[0].share).toBeCloseTo(0.2 / 0.25, 6);
  });

  it('falls back to request shares when everything is free', () => {
    const rows = modelBreakdown(
      [
        { model: 'mock', requests: 3, costUsd: 0 },
        { model: 'mock-2', requests: 1, costUsd: 0 },
      ],
      new Map(),
    );
    expect(rows[0]).toMatchObject({ model: 'mock', share: 0.75 });
  });
});
