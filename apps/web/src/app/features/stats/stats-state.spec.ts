import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { addDays } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { SessionScope } from '../../core/session-scope';
import { todayLocalDate } from '../../core/time';
import { DATA_REFRESH_DEBOUNCE_MS } from '../today/data-watch';
import { STATS_STALE_MS, StatsState, parseStatsTab, resourceErrorMessage } from './stats-state';
import { currentWeekStart } from './week-range';

describe('parseStatsTab', () => {
  it('accepts known tabs and defaults to week', () => {
    expect(parseStatsTab('trends')).toBe('trends');
    expect(parseStatsTab('insights')).toBe('insights');
    expect(parseStatsTab('week')).toBe('week');
    expect(parseStatsTab('weight')).toBe('weight');
    expect(parseStatsTab('bogus')).toBe('week');
    expect(parseStatsTab(undefined)).toBe('week');
  });
});

describe('resourceErrorMessage', () => {
  it('unwraps wrapped errors and uses API messages', () => {
    const http = new HttpErrorResponse({
      status: 400,
      error: { message: 'from must be before to' },
    });
    expect(resourceErrorMessage(http, 'fallback')).toBe('From must be before to.');
    expect(resourceErrorMessage(new Error('wrapped', { cause: http }), 'fallback')).toBe(
      'From must be before to.',
    );
    expect(resourceErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('StatsState', () => {
  const api = {
    rangeDashboard: vi.fn(),
    insights: vi.fn(),
    weights: vi.fn(),
    getProfile: vi.fn(),
  };

  beforeEach(() => {
    api.rangeDashboard.mockReset();
    api.insights.mockReset();
    api.weights.mockReset();
    api.getProfile.mockReset();
    TestBed.configureTestingModule({
      providers: [StatsState, { provide: ApiService, useValue: api }],
    });
  });

  it('caches ranges and forgets failed requests', async () => {
    const state = TestBed.inject(StatsState);
    api.rangeDashboard.mockRejectedValueOnce(new Error('down'));
    await expect(state.range('2026-09-01', '2026-09-07')).rejects.toThrow('down');
    api.rangeDashboard.mockResolvedValue({ from: '2026-09-01' });
    await state.range('2026-09-01', '2026-09-07');
    await state.range('2026-09-01', '2026-09-07');
    expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
  });

  it('requests insights up to yesterday so an unfinished today does not skew them', async () => {
    const state = TestBed.inject(StatsState);
    api.insights.mockResolvedValue({ insights: [] });
    await state.insights(30);
    await state.insights(30);
    expect(api.insights).toHaveBeenCalledTimes(1);
    expect(api.insights).toHaveBeenCalledWith({ to: addDays(state.today(), -1), days: 30 });
  });

  it('moves the insights window forward when the day rolls over', async () => {
    const state = TestBed.inject(StatsState);
    api.insights.mockResolvedValue({ insights: [] });
    const previousToday = state.today();
    await state.insights(7);

    const tomorrow = new Date(Date.now() + 86_400_000);
    state.refreshIfStale(tomorrow);
    await state.insights(7);

    expect(state.today()).toBe(todayLocalDate(tomorrow));
    expect(api.insights).toHaveBeenCalledTimes(2);
    expect(api.insights).toHaveBeenLastCalledWith({ to: previousToday, days: 7 });
  });

  it('keeps the day the user is still awake in as today until the day starts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 0, 56));
    try {
      setDayStartHour(DEFAULT_DAY_START_HOUR, null);
      const state = TestBed.inject(StatsState);
      expect(state.today()).toBe('2026-10-01');
      expect(state.weekStart()).toBe(currentWeekStart('2026-10-01'));
      api.insights.mockResolvedValue({ insights: [] });
      await state.insights(7);
      expect(api.insights).toHaveBeenCalledWith({ to: '2026-09-30', days: 7 });

      state.refreshIfStale(new Date(2026, 9, 2, 2, 59));
      expect(state.today()).toBe('2026-10-01');
      state.refreshIfStale(new Date(2026, 9, 2, 3, 0));
      expect(state.today()).toBe('2026-10-02');
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads the six days before a trend range so the first moving averages are complete', async () => {
    const state = TestBed.inject(StatsState);
    api.rangeDashboard.mockImplementation(async (from: string, to: string) => ({
      from,
      to,
      days: [{ date: from }],
    }));
    const data = await state.trend('2026-09-01', '2026-09-30');
    expect(api.rangeDashboard).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    expect(api.rangeDashboard).toHaveBeenCalledWith('2026-08-26', '2026-08-31');
    expect(data.range.from).toBe('2026-09-01');
    expect(data.leadIn).toEqual([{ date: '2026-08-26' }]);
  });

  it('still shows a trend when the lead-in days fail to load', async () => {
    const state = TestBed.inject(StatsState);
    api.rangeDashboard.mockImplementation(async (from: string) => {
      if (from === '2026-08-26') {
        throw new Error('offline');
      }
      return { from, days: [] };
    });
    const data = await state.trend('2026-09-01', '2026-09-30');
    expect(data.leadIn).toEqual([]);
  });

  it('keeps recent data but refetches everything once it is stale', async () => {
    const state = TestBed.inject(StatsState);
    api.rangeDashboard.mockResolvedValue({ from: '2026-09-01' });
    await state.range('2026-09-01', '2026-09-07');
    const now = Date.now();

    expect(state.refreshIfStale(new Date(now + 60_000))).toBe(false);
    expect(state.revision()).toBe(0);

    expect(state.refreshIfStale(new Date(now + STATS_STALE_MS + 1000))).toBe(true);
    expect(state.revision()).toBe(1);
    await state.range('2026-09-01', '2026-09-07');
    expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
  });

  it('moves to the new current week when the day rolls over', () => {
    const state = TestBed.inject(StatsState);
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(state.refreshIfStale(later)).toBe(true);
    expect(state.today()).toBe(todayLocalDate(later));
    expect(state.weekStart()).toBe(currentWeekStart(todayLocalDate(later)));
  });

  it('keeps a past week selected when the day rolls over', () => {
    const state = TestBed.inject(StatsState);
    const past = addDays(state.weekStart(), -21);
    state.weekStart.set(past);
    state.refreshIfStale(new Date(Date.now() + 86_400_000));
    expect(state.weekStart()).toBe(past);
  });

  it('refreshes when the app becomes visible again after a while', () => {
    const state = TestBed.inject(StatsState);
    const spy = vi.spyOn(state, 'refreshIfStale');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches weigh-ins per range until something changes', async () => {
    const state = TestBed.inject(StatsState);
    api.weights.mockResolvedValue({ logs: [] });
    await state.weights('2026-09-01', '2026-09-30');
    await state.weights('2026-09-01', '2026-09-30');
    await state.weights('2026-07-03', '2026-09-30');
    expect(api.weights).toHaveBeenCalledTimes(2);
    expect(api.weights).toHaveBeenNthCalledWith(1, '2026-09-01', '2026-09-30');
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  it('drops every cache without refetching when the session resets', async () => {
    const state = TestBed.inject(StatsState);
    api.weights.mockResolvedValue({ logs: [] });
    api.rangeDashboard.mockResolvedValue({ from: '2026-09-01' });
    api.insights.mockResolvedValue({ insights: [] });
    await state.weights('2026-09-01', '2026-09-30');
    await state.range('2026-09-01', '2026-09-07');
    await state.insights(7);

    TestBed.inject(SessionScope).reset();
    expect(state.revision()).toBe(0);
    await state.weights('2026-09-01', '2026-09-30');
    await state.range('2026-09-01', '2026-09-07');
    await state.insights(7);
    expect(api.weights).toHaveBeenCalledTimes(2);
    expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
    expect(api.insights).toHaveBeenCalledTimes(2);
  });

  it('drops every cache and bumps the revision when entries, weights or the profile change', async () => {
    vi.useFakeTimers();
    try {
      const state = TestBed.inject(StatsState);
      const events = TestBed.inject(DataEventsService);
      api.weights.mockResolvedValue({ logs: [] });
      api.rangeDashboard.mockResolvedValue({ from: '2026-09-01' });
      await state.weights('2026-09-01', '2026-09-30');
      await state.range('2026-09-01', '2026-09-07');
      TestBed.tick();

      events.notify('favorites');
      TestBed.tick();
      vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS);
      expect(state.revision()).toBe(0);

      events.notify('entries');
      events.notify('weights');
      TestBed.tick();
      vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS);
      expect(state.revision()).toBe(1);
      await state.weights('2026-09-01', '2026-09-30');
      await state.range('2026-09-01', '2026-09-07');
      expect(api.weights).toHaveBeenCalledTimes(2);
      expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches the week when fluids change', async () => {
    vi.useFakeTimers();
    try {
      const state = TestBed.inject(StatsState);
      const events = TestBed.inject(DataEventsService);
      api.rangeDashboard.mockResolvedValue({ from: '2026-09-01' });
      await state.range('2026-09-01', '2026-09-07');
      TestBed.tick();

      events.notify('fluids');
      TestBed.tick();
      vi.advanceTimersByTime(DATA_REFRESH_DEBOUNCE_MS);
      expect(state.revision()).toBe(1);
      await state.range('2026-09-01', '2026-09-07');
      expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
