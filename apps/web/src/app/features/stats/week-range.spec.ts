import {
  canShowNextWeek,
  currentWeekStart,
  formatDateRange,
  normalizeWeekStart,
  shiftWeek,
  weekRange,
  weekTitle,
} from './week-range';

const TODAY = '2026-09-30';

describe('week range math', () => {
  it('starts weeks on Monday', () => {
    expect(currentWeekStart(TODAY)).toBe('2026-09-28');
    expect(currentWeekStart('2026-09-28')).toBe('2026-09-28');
    expect(currentWeekStart('2026-10-04')).toBe('2026-09-28');
  });

  it('clips the current week at today and lists all seven dates', () => {
    const range = weekRange('2026-09-28', TODAY);
    expect(range.end).toBe('2026-10-04');
    expect(range.to).toBe(TODAY);
    expect(range.dates).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(range.isCurrent).toBe(true);
    const past = weekRange('2026-09-21', TODAY);
    expect(past.to).toBe('2026-09-27');
    expect(past.isCurrent).toBe(false);
  });

  it('moves between weeks without passing the current week', () => {
    expect(shiftWeek('2026-09-28', -1, TODAY)).toBe('2026-09-21');
    expect(shiftWeek('2026-09-21', 1, TODAY)).toBe('2026-09-28');
    expect(shiftWeek('2026-09-28', 1, TODAY)).toBe('2026-09-28');
    expect(shiftWeek('2026-01-05', -1, TODAY)).toBe('2025-12-29');
    expect(canShowNextWeek('2026-09-21', TODAY)).toBe(true);
    expect(canShowNextWeek('2026-09-28', TODAY)).toBe(false);
  });

  it('normalizes arbitrary or invalid dates to a week start', () => {
    expect(normalizeWeekStart('2026-09-17', TODAY)).toBe('2026-09-14');
    expect(normalizeWeekStart('2027-01-01', TODAY)).toBe('2026-09-28');
    expect(normalizeWeekStart('nope', TODAY)).toBe('2026-09-28');
    expect(normalizeWeekStart(null, TODAY)).toBe('2026-09-28');
  });

  it('formats compact date ranges', () => {
    expect(formatDateRange('2026-09-14', '2026-09-20', TODAY)).toBe('14 – 20 Sep');
    expect(formatDateRange('2026-09-28', '2026-10-04', TODAY)).toBe('28 Sep – 4 Oct');
    expect(formatDateRange('2025-12-29', '2026-01-04', TODAY)).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(formatDateRange('2025-03-03', '2025-03-09', TODAY)).toBe('3 – 9 Mar 2025');
    expect(formatDateRange('', '2025-03-09', TODAY)).toBe('');
  });

  it('titles weeks relative to the current one', () => {
    expect(weekTitle('2026-09-28', TODAY)).toBe('This week');
    expect(weekTitle('2026-09-21', TODAY)).toBe('Last week');
    expect(weekTitle('2026-09-07', TODAY)).toBe('3 weeks ago');
  });
});
