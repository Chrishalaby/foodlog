import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarDateFor,
  DAY_START_HOURS,
  DEFAULT_DAY_START_HOUR,
  diffDays,
  eachDate,
  guessMealType,
  isBeforeDayStart,
  isValidLocalDate,
  logicalDate,
  logicalDateInTimeZone,
  startOfWeek,
  weekdayOf,
} from './dates.js';

describe('dates', () => {
  it('validates local dates', () => {
    expect(isValidLocalDate('2026-09-28')).toBe(true);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-9-28')).toBe(false);
  });

  it('does date arithmetic across month and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(diffDays('2026-09-01', '2026-09-30')).toBe(29);
    expect(eachDate('2026-09-27', '2026-09-29')).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
    expect(weekdayOf('2026-09-28')).toBe(1);
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
  });

  it('guesses meal type from local time', () => {
    expect(guessMealType(new Date(2026, 8, 28, 8, 0))).toBe('breakfast');
    expect(guessMealType(new Date(2026, 8, 28, 13, 0))).toBe('lunch');
    expect(guessMealType(new Date(2026, 8, 28, 16, 0))).toBe('snack');
    expect(guessMealType(new Date(2026, 8, 28, 20, 0))).toBe('dinner');
    expect(guessMealType(new Date(2026, 8, 28, 23, 30))).toBe('snack');
  });

  it('offers day starts from midnight to 6 am with 3 am as the default', () => {
    expect(DAY_START_HOURS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(DEFAULT_DAY_START_HOUR).toBe(3);
  });

  it('counts a moment before the day start toward the previous date', () => {
    const apple = new Date(2026, 9, 2, 0, 56);
    expect(logicalDate(apple, 3)).toBe('2026-10-01');
    expect(logicalDate(apple, 0)).toBe('2026-10-02');
    expect(logicalDate(new Date(2026, 9, 2, 3, 0), 3)).toBe('2026-10-02');
    expect(logicalDate(new Date(2026, 9, 2, 2, 59), 3)).toBe('2026-10-01');
    expect(logicalDate(new Date(2026, 9, 1, 0, 30), 1)).toBe('2026-09-30');
  });

  it('falls back to the default day start for out-of-range hours', () => {
    const apple = new Date(2026, 9, 2, 0, 56);
    expect(logicalDate(apple, 9)).toBe('2026-10-01');
    expect(logicalDate(apple, -1)).toBe('2026-10-01');
    expect(logicalDate(apple, Number.NaN)).toBe('2026-10-01');
    expect(isBeforeDayStart('04:00', 12)).toBe(false);
  });

  it('works out the logical date in a named time zone', () => {
    const appleInBeirut = new Date('2026-10-01T21:56:00Z');
    expect(logicalDateInTimeZone(appleInBeirut, 'Asia/Beirut', 3)).toBe('2026-10-01');
    expect(logicalDateInTimeZone(appleInBeirut, 'Asia/Beirut', 0)).toBe('2026-10-02');
    expect(logicalDateInTimeZone(appleInBeirut, 'UTC', 3)).toBe('2026-10-01');
    expect(logicalDateInTimeZone(new Date('2026-10-02T00:00:00Z'), 'Asia/Beirut', 3)).toBe('2026-10-02');
    expect(logicalDateInTimeZone(new Date('2026-12-31T22:30:00Z'), 'Asia/Beirut', 3)).toBe('2026-12-31');
  });

  it('tells whether a clock time falls before the day start', () => {
    expect(isBeforeDayStart('00:56', 3)).toBe(true);
    expect(isBeforeDayStart('2:59', 3)).toBe(true);
    expect(isBeforeDayStart('03:00', 3)).toBe(false);
    expect(isBeforeDayStart('23:30', 3)).toBe(false);
    expect(isBeforeDayStart('00:30', 0)).toBe(false);
    expect(isBeforeDayStart(' 01:15 ', 2)).toBe(true);
    expect(isBeforeDayStart('nope', 3)).toBe(false);
    expect(isBeforeDayStart('', 3)).toBe(false);
  });

  it('finds the real calendar date of a clock time inside a logical day', () => {
    expect(calendarDateFor('2026-10-01', '00:30', 3)).toBe('2026-10-02');
    expect(calendarDateFor('2026-10-01', '23:30', 3)).toBe('2026-10-01');
    expect(calendarDateFor('2026-10-31', '01:00', 3)).toBe('2026-11-01');
    expect(calendarDateFor('2026-10-01', '00:30', 0)).toBe('2026-10-01');
  });
});
