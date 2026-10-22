import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import {
  afterMidnightNote,
  aiLocalTime,
  analysisLocalTime,
  currentDateTimeInput,
  dateTimeInputFromIso,
  logNowTiming,
  mealTypeAt,
  parseDateTimeInput,
  photoTimeLabel,
  timingFromInput,
  usablePhotoTime,
} from './entry-timing';

describe('entry timing', () => {
  afterEach(() => setDayStartHour(DEFAULT_DAY_START_HOUR, null));

  it('parses datetime-local values as local time', () => {
    const date = parseDateTimeInput('2026-09-28T07:45');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(28);
    expect(date?.getHours()).toBe(7);
    expect(date?.getMinutes()).toBe(45);
    expect(parseDateTimeInput('2026-09-28T07:45:30')?.getMinutes()).toBe(45);
  });

  it('rejects empty, malformed and impossible values', () => {
    expect(parseDateTimeInput('')).toBeNull();
    expect(parseDateTimeInput('2026-09-28')).toBeNull();
    expect(parseDateTimeInput('2026-02-30T10:00')).toBeNull();
    expect(parseDateTimeInput('2026-13-01T10:00')).toBeNull();
    expect(parseDateTimeInput('2026-09-28T24:00')).toBeNull();
  });

  it('derives the ISO timestamp and the local date from the same instant', () => {
    const timing = timingFromInput('2026-09-28T23:30');
    const local = new Date(2026, 8, 28, 23, 30);
    expect(timing).toEqual({ timestamp: local.toISOString(), localDate: '2026-09-28' });
    expect(timingFromInput('nope')).toBeNull();
  });

  it('round-trips ISO timestamps into datetime-local values', () => {
    const iso = new Date(2026, 0, 5, 9, 7).toISOString();
    expect(dateTimeInputFromIso(iso)).toBe('2026-01-05T09:07');
    expect(currentDateTimeInput(new Date(2026, 11, 31, 18, 0))).toBe('2026-12-31T18:00');
  });

  it('builds the log-now timing from one instant', () => {
    const now = new Date(2026, 8, 28, 23, 50);
    expect(logNowTiming(now)).toEqual({
      timestamp: now.toISOString(),
      localDate: '2026-09-28',
      mealType: 'snack',
    });
  });

  it('formats the analysis local time as YYYY-MM-DDTHH:mm, falling back to now', () => {
    expect(analysisLocalTime('2026-09-27T19:40')).toBe('2026-09-27T19:40');
    expect(analysisLocalTime('2026-09-27T19:40:30')).toBe('2026-09-27T19:40');
    expect(analysisLocalTime('', new Date(2026, 0, 2, 7, 5))).toBe('2026-01-02T07:05');
  });

  it('guesses the meal type from the chosen time', () => {
    expect(mealTypeAt('2026-09-28T08:00')).toBe('breakfast');
    expect(mealTypeAt('2026-09-28T12:30')).toBe('lunch');
    expect(mealTypeAt('2026-09-28T19:00')).toBe('dinner');
    expect(mealTypeAt('')).toBeNull();
  });

  describe('photo time', () => {
    const now = new Date(2026, 8, 28, 12, 0);

    it('accepts photo times from the last 30 days', () => {
      const lunch = new Date(2026, 8, 27, 13, 5);
      expect(usablePhotoTime(lunch, now)).toBe(lunch);
      const oldest = new Date(now.getTime() - 30 * 86_400_000);
      expect(usablePhotoTime(oldest, now)).toBe(oldest);
    });

    it('rejects missing, invalid, future and too old photo times', () => {
      expect(usablePhotoTime(null, now)).toBeNull();
      expect(usablePhotoTime(new Date(Number.NaN), now)).toBeNull();
      expect(usablePhotoTime(new Date(2026, 8, 28, 12, 5), now)).toBeNull();
      expect(usablePhotoTime(new Date(now.getTime() - 30 * 86_400_000 - 1), now)).toBeNull();
    });

    it('treats a photo a few seconds ahead of the clock as taken now', () => {
      const ahead = new Date(now.getTime() + 20_000);
      expect(usablePhotoTime(ahead, now)).toBe(now);
    });

    it('labels the photo time with the day when it is not today', () => {
      expect(photoTimeLabel('2026-09-28T13:05', '2026-09-28')).toBe('13:05');
      expect(photoTimeLabel('2026-09-27T13:05', '2026-09-28')).toBe('Yesterday 13:05');
      expect(photoTimeLabel('2026-09-20T08:00', '2026-09-28')).toBe('Sun 20 Sep 08:00');
      expect(photoTimeLabel('nope', '2026-09-28')).toBe('');
    });
  });

  describe('eating day and clock time', () => {
    it('stores 00:30 on the eating day as the real next-day instant with a 3 am day start', () => {
      setDayStartHour(3, null);
      const timing = timingFromInput('2026-10-01T00:30');
      expect(timing).toEqual({
        timestamp: new Date(2026, 9, 2, 0, 30).toISOString(),
        localDate: '2026-10-01',
      });
      expect(parseDateTimeInput('2026-10-01T00:30')?.getDate()).toBe(2);
    });

    it('keeps times from the day start onward on the picked calendar date', () => {
      setDayStartHour(3, null);
      expect(timingFromInput('2026-10-01T03:00')).toEqual({
        timestamp: new Date(2026, 9, 1, 3, 0).toISOString(),
        localDate: '2026-10-01',
      });
    });

    it('treats every time as its calendar date when the day starts at midnight', () => {
      setDayStartHour(0, null);
      expect(timingFromInput('2026-10-01T00:30')).toEqual({
        timestamp: new Date(2026, 9, 1, 0, 30).toISOString(),
        localDate: '2026-10-01',
      });
    });

    it('shows a 00:56 moment on the previous eating day and round-trips it', () => {
      setDayStartHour(3, null);
      const late = new Date(2026, 9, 2, 0, 56);
      expect(currentDateTimeInput(late)).toBe('2026-10-01T00:56');
      expect(dateTimeInputFromIso(late.toISOString())).toBe('2026-10-01T00:56');
      expect(timingFromInput(currentDateTimeInput(late))).toEqual({
        timestamp: late.toISOString(),
        localDate: '2026-10-01',
      });
      expect(currentDateTimeInput(new Date(2026, 9, 2, 3, 0))).toBe('2026-10-02T03:00');
    });

    it('logs a late snack now on the day the user is still awake in', () => {
      setDayStartHour(3, null);
      const late = new Date(2026, 9, 2, 0, 56);
      expect(logNowTiming(late)).toEqual({
        timestamp: late.toISOString(),
        localDate: '2026-10-01',
        mealType: 'snack',
      });
      setDayStartHour(0, null);
      expect(logNowTiming(late).localDate).toBe('2026-10-02');
    });

    it('sends the real clock time to the AI, not the eating day', () => {
      setDayStartHour(3, null);
      expect(aiLocalTime(new Date(2026, 9, 2, 0, 56))).toBe('2026-10-02T00:56');
      expect(analysisLocalTime('2026-10-01T00:56')).toBe('2026-10-02T00:56');
      expect(mealTypeAt('2026-10-01T00:56')).toBe('snack');
    });

    it('notes times after midnight and which day they count toward', () => {
      setDayStartHour(3, null);
      expect(afterMidnightNote('2026-10-01T00:30', 3, '2026-10-01')).toBe(
        'After midnight (Fri 2 Oct) · counts toward today',
      );
      expect(afterMidnightNote('2026-09-29T02:59', 3, '2026-10-01')).toBe(
        'After midnight (Wed 30 Sep) · counts toward Tue 29 Sep',
      );
      expect(afterMidnightNote('2026-09-30T01:00', 3, '2026-10-01')).toBe(
        'After midnight (Thu 1 Oct) · counts toward yesterday',
      );
      expect(afterMidnightNote('2026-10-01T03:00', 3, '2026-10-01')).toBeNull();
      expect(afterMidnightNote('2026-10-01T00:30', 0, '2026-10-01')).toBeNull();
      expect(afterMidnightNote('nope', 3, '2026-10-01')).toBeNull();
    });

    it('labels an after-midnight photo time with its eating day', () => {
      setDayStartHour(3, null);
      expect(photoTimeLabel('2026-10-01T00:56', '2026-10-01')).toBe('00:56');
      expect(photoTimeLabel('2026-09-30T00:56', '2026-10-01')).toBe('Yesterday 00:56');
    });
  });
});
