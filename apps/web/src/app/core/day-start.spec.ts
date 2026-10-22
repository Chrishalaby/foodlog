import {
  DAY_BOUNDARY_SLACK_MS,
  DAY_START_HOURS,
  DAY_START_STORAGE_KEY,
  DEFAULT_DAY_START_HOUR,
  calendarDateFor,
  dayEndsNote,
  dayStartHint,
  dayStartHour,
  dayStartLabel,
  isBeforeDayStart,
  logicalDate,
  msUntilNextDayBoundary,
  normalizeDayStartHour,
  readStoredDayStartHour,
  setDayStartHour,
} from './day-start';
import { localDateTimeToIso, relativeDayLabel, todayLocalDate } from './time';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('day start', () => {
  afterEach(() => {
    vi.useRealTimers();
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
  });

  it('offers midnight to 6 am and defaults to 3 am', () => {
    expect(DAY_START_HOURS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(DEFAULT_DAY_START_HOUR).toBe(3);
    expect(normalizeDayStartHour(undefined)).toBe(3);
    expect(normalizeDayStartHour(7)).toBe(3);
    expect(normalizeDayStartHour(-1)).toBe(3);
    expect(normalizeDayStartHour(2.5)).toBe(3);
    expect(normalizeDayStartHour(0)).toBe(0);
    expect(normalizeDayStartHour(6)).toBe(6);
  });

  it('counts a moment before the day start toward the previous date', () => {
    expect(logicalDate(new Date(2026, 9, 2, 0, 56), 3)).toBe('2026-10-01');
    expect(logicalDate(new Date(2026, 9, 2, 2, 59), 3)).toBe('2026-10-01');
    expect(logicalDate(new Date(2026, 9, 2, 3, 0), 3)).toBe('2026-10-02');
    expect(logicalDate(new Date(2026, 9, 2, 0, 56), 0)).toBe('2026-10-02');
    expect(logicalDate(new Date(2026, 0, 1, 1, 0), 3)).toBe('2025-12-31');
  });

  it('knows which clock times fall before the day start', () => {
    expect(isBeforeDayStart('00:30', 3)).toBe(true);
    expect(isBeforeDayStart('2:59', 3)).toBe(true);
    expect(isBeforeDayStart('03:00', 3)).toBe(false);
    expect(isBeforeDayStart('23:30', 3)).toBe(false);
    expect(isBeforeDayStart('00:00', 0)).toBe(false);
    expect(isBeforeDayStart('nope', 3)).toBe(false);
  });

  it('finds the calendar date of a clock time inside a logical day', () => {
    expect(calendarDateFor('2026-10-01', '00:30', 3)).toBe('2026-10-02');
    expect(calendarDateFor('2026-10-01', '03:00', 3)).toBe('2026-10-01');
    expect(calendarDateFor('2026-12-31', '01:00', 3)).toBe('2027-01-01');
    expect(calendarDateFor('2026-10-01', '00:30', 0)).toBe('2026-10-01');
  });

  it('builds the real instant from the eating day and clock time', () => {
    expect(localDateTimeToIso('2026-10-01', '00:30', 3)).toBe(
      new Date(2026, 9, 2, 0, 30).toISOString(),
    );
    expect(localDateTimeToIso('2026-10-01', '00:30', 0)).toBe(
      new Date(2026, 9, 1, 0, 30).toISOString(),
    );
  });

  it('labels the options and explains the setting', () => {
    expect(dayStartLabel(0)).toBe('Midnight');
    expect(dayStartLabel(3)).toBe('3 am');
    expect(dayStartHint(3)).toBe('Food you log before 3 am counts toward the day before.');
    expect(dayStartHint(0)).toBe('Each day starts at midnight.');
  });

  it('notes when the day ends only between midnight and the day start', () => {
    expect(dayEndsNote(new Date(2026, 9, 2, 0, 56), 3)).toBe('Day ends at 3 am');
    expect(dayEndsNote(new Date(2026, 9, 2, 3, 0), 3)).toBeNull();
    expect(dayEndsNote(new Date(2026, 9, 1, 23, 0), 3)).toBeNull();
    expect(dayEndsNote(new Date(2026, 9, 2, 0, 56), 0)).toBeNull();
  });

  it('wakes up at the next midnight or day start, whichever comes first', () => {
    expect(msUntilNextDayBoundary(new Date(2026, 9, 1, 23, 59), 3)).toBe(
      60_000 + DAY_BOUNDARY_SLACK_MS,
    );
    expect(msUntilNextDayBoundary(new Date(2026, 9, 2, 0, 56), 3)).toBe(
      (2 * 60 + 4) * 60_000 + DAY_BOUNDARY_SLACK_MS,
    );
    expect(msUntilNextDayBoundary(new Date(2026, 9, 2, 3, 0), 3)).toBe(
      21 * 3_600_000 + DAY_BOUNDARY_SLACK_MS,
    );
    expect(msUntilNextDayBoundary(new Date(2026, 9, 2, 0, 0), 0)).toBe(
      86_400_000 + DAY_BOUNDARY_SLACK_MS,
    );
  });

  it('remembers the hour on the device and ignores bad stored values', () => {
    const storage = memoryStorage();
    setDayStartHour(5, storage);
    expect(dayStartHour()).toBe(5);
    expect(storage.getItem(DAY_START_STORAGE_KEY)).toBe('5');
    expect(readStoredDayStartHour(storage)).toBe(5);
    expect(readStoredDayStartHour(memoryStorage({ [DAY_START_STORAGE_KEY]: 'x' }))).toBe(3);
    expect(readStoredDayStartHour(memoryStorage({ [DAY_START_STORAGE_KEY]: '' }))).toBe(3);
    expect(readStoredDayStartHour(memoryStorage({ [DAY_START_STORAGE_KEY]: '0' }))).toBe(0);
    expect(readStoredDayStartHour(null)).toBe(3);
  });

  it('survives storage that throws', () => {
    const broken = memoryStorage();
    broken.setItem = () => {
      throw new Error('quota');
    };
    broken.getItem = () => {
      throw new Error('blocked');
    };
    expect(() => setDayStartHour(4, broken)).not.toThrow();
    expect(dayStartHour()).toBe(4);
    expect(readStoredDayStartHour(broken)).toBe(3);
  });

  describe('with a fake clock at 00:56', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 2, 0, 56));
    });

    it('keeps yesterday as Today with a 3 am day start', () => {
      setDayStartHour(3, null);
      expect(todayLocalDate()).toBe('2026-10-01');
      expect(relativeDayLabel('2026-10-01')).toBe('Today');
      expect(relativeDayLabel('2026-10-02')).toBe('Tomorrow');
    });

    it('moves to the calendar date at 03:00', () => {
      setDayStartHour(3, null);
      vi.setSystemTime(new Date(2026, 9, 2, 3, 0));
      expect(todayLocalDate()).toBe('2026-10-02');
    });

    it('switches to the calendar date as soon as the day starts at midnight', () => {
      setDayStartHour(0, null);
      expect(todayLocalDate()).toBe('2026-10-02');
    });
  });
});
