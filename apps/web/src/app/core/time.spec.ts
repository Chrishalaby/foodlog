import { localClockTime, localDateTimeToIso, relativeDayLabel, shortDateLabel } from './time';

describe('time helpers', () => {
  const today = '2026-09-28';

  it('labels today, yesterday and tomorrow', () => {
    expect(relativeDayLabel('2026-09-28', today)).toBe('Today');
    expect(relativeDayLabel('2026-09-27', today)).toBe('Yesterday');
    expect(relativeDayLabel('2026-09-29', today)).toBe('Tomorrow');
  });

  it('formats other days as weekday, day and month', () => {
    expect(relativeDayLabel('2026-09-21', today)).toBe('Mon 21 Sep');
    expect(relativeDayLabel('2026-10-01', today)).toBe('Thu 1 Oct');
  });

  it('adds the year for dates in another year', () => {
    expect(shortDateLabel('2025-12-31', today)).toBe('Wed 31 Dec 2025');
  });

  it('formats local clock times and combines local date and time', () => {
    expect(localClockTime(new Date(2026, 8, 28, 7, 5))).toBe('07:05');
    expect(localDateTimeToIso('2026-09-28', '07:05')).toBe(
      new Date(2026, 8, 28, 7, 5).toISOString(),
    );
    expect(localDateTimeToIso('2026-02-30', '07:05')).toBeNull();
    expect(localDateTimeToIso('2026-09-28', '25:00')).toBeNull();
  });
});
