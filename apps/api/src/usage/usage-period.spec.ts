import {
  MONTH_PATTERN,
  roundUsd,
  trailingWindowStart,
  utcMonthOf,
  utcMonthRange,
} from './usage-period.js';

describe('usage periods', () => {
  it('derives the UTC month of an instant', () => {
    expect(utcMonthOf(new Date('2026-09-30T23:59:59.999Z'))).toBe('2026-09');
    expect(utcMonthOf(new Date('2026-10-01T00:00:00.000Z'))).toBe('2026-10');
  });

  it('covers a whole UTC month, including year ends', () => {
    expect(utcMonthRange('2026-12')).toEqual({
      start: new Date('2026-12-01T00:00:00.000Z'),
      end: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(utcMonthRange('2024-02').end).toEqual(
      new Date('2024-03-01T00:00:00.000Z'),
    );
  });

  it('validates YYYY-MM months', () => {
    expect(MONTH_PATTERN.test('2026-09')).toBe(true);
    expect(MONTH_PATTERN.test('2026-13')).toBe(false);
    expect(MONTH_PATTERN.test('2026-9')).toBe(false);
    expect(MONTH_PATTERN.test('2026-00')).toBe(false);
    expect(MONTH_PATTERN.test('0099-05')).toBe(false);
  });

  it('computes the trailing 30-day window and rounds dollars to micro-dollars', () => {
    expect(trailingWindowStart(new Date('2026-09-30T12:00:00Z'))).toEqual(
      new Date('2026-08-31T12:00:00Z'),
    );
    expect(roundUsd(0.1 + 0.2)).toBe(0.3);
    expect(roundUsd(0.0000004)).toBe(0);
  });
});
