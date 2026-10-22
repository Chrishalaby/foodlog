import { TestBed } from '@angular/core/testing';
import type {
  DayDashboardResponse,
  FoodRenameResponse,
  FoodSearchResponse,
  HiddenFoodsResponse,
  ProfileResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { SessionScope } from '../../core/session-scope';
import {
  TEST_TARGETS,
  makeDashboard,
  makeEntry,
  makeFavorite,
  makeFood,
  nutrients,
} from './today-fixtures';
import { PROFILE_STALE_MS, TodayStore } from './today-store';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createApi() {
  return {
    dayDashboard: vi.fn<(date: string) => Promise<DayDashboardResponse>>(),
    searchFoods: vi
      .fn<() => Promise<FoodSearchResponse>>()
      .mockResolvedValue({ query: '', results: [] }),
    getProfile: vi.fn().mockResolvedValue({
      profile: { goal: 'cut', weightKg: 80, theme: 'dark' },
      targets: { ...TEST_TARGETS, complete: true },
    } as unknown as ProfileResponse),
    putDay: vi.fn(),
    deleteEntry: vi.fn(),
    duplicateEntry: vi.fn(),
    quickLog: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
    renameFood: vi.fn<(body: { from: string; to: string }) => Promise<FoodRenameResponse>>(),
    hideFood: vi.fn<(body: { name: string }) => Promise<HiddenFoodsResponse>>(),
    unhideFood: vi.fn<(name: string) => Promise<HiddenFoodsResponse>>(),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('TodayStore', () => {
  let api: ReturnType<typeof createApi>;
  let store: TodayStore;
  let events: DataEventsService;

  beforeEach(() => {
    api = createApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    store = TestBed.inject(TodayStore);
    events = TestBed.inject(DataEventsService);
  });

  it('loads a day, then serves it from cache while refreshing silently', async () => {
    const first = makeDashboard('2026-09-28', [makeEntry({ id: 'a' })]);
    api.dayDashboard.mockResolvedValueOnce(first);
    const loading = store.show('2026-09-28');
    expect(store.status()).toBe('loading');
    await loading;
    expect(store.status()).toBe('ready');
    expect(store.dashboard()).toEqual(first);

    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-27'));
    await store.show('2026-09-27');

    const pending = deferred<DayDashboardResponse>();
    api.dayDashboard.mockReturnValueOnce(pending.promise);
    const back = store.show('2026-09-28');
    expect(store.status()).toBe('ready');
    expect(store.dashboard()).toEqual(first);
    expect(store.refreshing()).toBe(true);
    pending.resolve(makeDashboard('2026-09-28'));
    await back;
    expect(store.dashboard()?.entries).toEqual([]);
    expect(store.refreshing()).toBe(false);
  });

  it('reports an error only when nothing is on screen and recovers on retry', async () => {
    api.dayDashboard.mockRejectedValueOnce(new Error('Server exploded'));
    await store.show('2026-09-28');
    expect(store.status()).toBe('error');
    expect(store.error()).toBe('Server exploded');

    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-28'));
    await store.retry();
    expect(store.status()).toBe('ready');

    api.dayDashboard.mockRejectedValueOnce(new Error('offline'));
    await store.refresh();
    expect(store.status()).toBe('ready');
    expect(store.error()).toBeNull();
  });

  it('ignores a stale response for a day that is no longer shown', async () => {
    const slow = deferred<DayDashboardResponse>();
    api.dayDashboard.mockReturnValueOnce(slow.promise);
    const first = store.show('2026-09-27');
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-28'));
    await store.show('2026-09-28');
    slow.resolve(makeDashboard('2026-09-27', [makeEntry({ id: 'late' })]));
    await first;
    expect(store.date()).toBe('2026-09-28');
    expect(store.dashboard()?.day.date).toBe('2026-09-28');
  });

  it('toggles training day optimistically with swapped targets and reverts on failure', async () => {
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-28'));
    await store.loadExtras();
    await store.show('2026-09-28');

    const request = deferred<unknown>();
    const refresh = deferred<DayDashboardResponse>();
    api.putDay.mockReturnValueOnce(request.promise);
    api.dayDashboard.mockReturnValueOnce(refresh.promise);
    const toggling = store.setTrainingDay(true);
    expect(store.dashboard()?.day.trainingDay).toBe(true);
    expect(store.dashboard()?.day.targets.calories).toBe(2400);
    expect(api.putDay).toHaveBeenCalledWith('2026-09-28', { trainingDay: true });
    request.reject(new Error('nope'));
    await expect(toggling).rejects.toThrow('nope');
    expect(store.dashboard()?.day.trainingDay).toBe(false);
    expect(store.dashboard()?.day.targets.calories).toBe(1800);
    expect(api.dayDashboard).toHaveBeenCalledTimes(2);
    refresh.resolve(makeDashboard('2026-09-28'));
    await flush();
    expect(store.dashboard()?.day.targets.calories).toBe(2000);
  });

  it('keeps the optimistic training day when the save succeeds', async () => {
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-28'));
    await store.show('2026-09-28');
    api.putDay.mockResolvedValueOnce({ date: '2026-09-28', trainingDay: true });
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-28', [], true));
    await store.setTrainingDay(true);
    await flush();
    expect(store.dashboard()?.day.trainingDay).toBe(true);
    expect(api.putDay).toHaveBeenCalledTimes(1);
    await store.setTrainingDay(true);
    expect(api.putDay).toHaveBeenCalledTimes(1);
  });

  it('removes a deleted entry immediately and restores it when the delete fails', async () => {
    const entry = makeEntry({ id: 'a', totals: nutrients({ calories: 300 }) });
    api.dayDashboard.mockResolvedValue(makeDashboard('2026-09-28', [entry]));
    await store.show('2026-09-28');

    const request = deferred<void>();
    api.deleteEntry.mockReturnValueOnce(request.promise);
    const deleting = store.deleteEntry(entry);
    expect(store.dashboard()?.entries).toEqual([]);
    expect(store.dashboard()?.day.totals.calories).toBe(0);
    request.reject(new Error('fail'));
    await expect(deleting).rejects.toThrow('fail');
    expect(store.dashboard()?.entries.map((e) => e.id)).toEqual(['a']);
    expect(events.entries()).toBe(0);
  });

  it('announces a successful delete instead of refetching the day itself', async () => {
    const entry = makeEntry({ id: 'a' });
    api.dayDashboard.mockResolvedValue(makeDashboard('2026-09-28', [entry]));
    await store.show('2026-09-28');
    api.deleteEntry.mockResolvedValueOnce(undefined);

    await store.deleteEntry(entry);
    expect(store.dashboard()?.entries).toEqual([]);
    expect(api.dayDashboard).toHaveBeenCalledTimes(1);
    expect(events.entries()).toBe(1);
  });

  it('leaves the viewed day untouched when deleting an entry from another day fails', async () => {
    const shown = makeDashboard('2026-09-20', [makeEntry({ id: 'old', localDate: '2026-09-20' })]);
    api.dayDashboard.mockResolvedValue(shown);
    await store.show('2026-09-20');
    api.deleteEntry.mockRejectedValueOnce(new Error('offline'));

    await expect(
      store.deleteEntry(makeEntry({ id: 'copy', localDate: '2026-09-28' })),
    ).rejects.toThrow('offline');
    expect(store.dashboard()?.entries.map((e) => e.id)).toEqual(['old']);

    const other = deferred<DayDashboardResponse>();
    api.dayDashboard.mockReturnValueOnce(other.promise);
    void store.show('2026-09-28');
    expect(store.status()).toBe('loading');
    expect(store.dashboard()).toBeNull();
    other.resolve(makeDashboard('2026-09-28'));
  });

  it('quick-logs a library item to the viewed day, announces it and can undo it', async () => {
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-25'));
    await store.show('2026-09-25');
    const food = makeFood({ key: 'meal:abc', name: 'Khoury strawberry yogurt', mealType: 'lunch' });
    const created = makeEntry({
      id: 'new',
      localDate: '2026-09-25',
      totals: nutrients({ calories: 350 }),
    });
    api.quickLog.mockResolvedValueOnce(created);

    const result = await store.quickLog(food, new Date(2026, 8, 28, 9, 30));
    expect(result).toBe(created);
    expect(api.quickLog).toHaveBeenCalledWith({
      key: 'meal:abc',
      servings: 1,
      timestamp: new Date(2026, 8, 25, 9, 30).toISOString(),
      localDate: '2026-09-25',
      mealType: 'breakfast',
    });
    expect(store.dashboard()?.entries.map((e) => e.id)).toEqual(['new']);
    expect(store.dashboard()?.day.totals.calories).toBe(350);
    expect(api.dayDashboard).toHaveBeenCalledTimes(1);
    expect(events.entries()).toBe(1);
    expect(events.favorites()).toBe(1);

    api.deleteEntry.mockResolvedValueOnce(undefined);
    await store.undoCreate(created);
    expect(api.deleteEntry).toHaveBeenCalledWith('new');
    expect(store.dashboard()?.entries).toEqual([]);
    expect(events.entries()).toBe(2);
  });

  it('announces a product quick log so product views refresh too', async () => {
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-28'));
    await store.show('2026-09-28');
    api.quickLog.mockResolvedValueOnce(makeEntry({ id: 'p1' }));
    await store.quickLog(makeFood({ key: 'product:1', kind: 'product', name: 'Labneh' }));
    expect(events.entries()).toBe(1);
    expect(events.favorites()).toBe(1);
    expect(events.products()).toBe(1);
  });

  it('forgets every cached day and the library when the session resets', async () => {
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-27'));
    await store.show('2026-09-27');
    api.dayDashboard.mockResolvedValueOnce(makeDashboard('2026-09-28'));
    await store.show('2026-09-28');
    api.searchFoods.mockResolvedValueOnce({ query: '', results: [makeFood({ key: 'meal:a' })] });
    await store.loadFoods();
    expect(store.foods()).toHaveLength(1);

    const late = deferred<DayDashboardResponse>();
    api.dayDashboard.mockReturnValueOnce(late.promise);
    const refreshing = store.refresh();
    TestBed.inject(SessionScope).reset();
    late.resolve(makeDashboard('2026-09-28'));
    await refreshing;

    expect(store.date()).toBeNull();
    expect(store.dashboard()).toBeNull();
    expect(store.status()).toBe('loading');
    expect(store.foods()).toEqual([]);
    expect(store.foodsStatus()).toBe('loading');

    const next = deferred<DayDashboardResponse>();
    api.dayDashboard.mockReturnValueOnce(next.promise);
    const showing = store.show('2026-09-27');
    expect(store.dashboard()).toBeNull();
    expect(store.status()).toBe('loading');
    next.resolve(makeDashboard('2026-09-27'));
    await showing;
    expect(store.status()).toBe('ready');
    expect(api.dayDashboard).toHaveBeenCalledTimes(4);
  });

  it('guesses the meal type from the clock even for a starred breakfast favorite', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard('2026-09-28'));
    await store.show('2026-09-28');
    const favorite = makeFood({
      key: 'favorite:y',
      kind: 'favorite',
      productId: null,
      starred: true,
      mealType: 'breakfast',
    });
    api.quickLog.mockResolvedValueOnce(makeEntry({ id: 'n', localDate: '2026-09-28' }));

    await store.quickLog(favorite, new Date(2026, 8, 28, 15, 45));
    expect(api.quickLog).toHaveBeenCalledWith(expect.objectContaining({ mealType: 'snack' }));
  });

  it('logs an entry again for today with a meal type matching the current time', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard('2026-09-20'));
    await store.show('2026-09-20');
    const source = makeEntry({ id: 'a', localDate: '2026-09-20', mealType: 'breakfast' });
    api.duplicateEntry.mockResolvedValueOnce(makeEntry({ id: 'copy', localDate: '2026-09-28' }));

    const now = new Date(2026, 8, 28, 19, 0);
    await store.logAgain(source, now);
    expect(api.duplicateEntry).toHaveBeenCalledWith('a', {
      timestamp: now.toISOString(),
      localDate: '2026-09-28',
      mealType: 'dinner',
    });
    expect(store.dashboard()?.entries).toEqual([]);
  });

  it('loads the quick-add library starred first and keeps chip order on a stable refresh', async () => {
    api.searchFoods.mockResolvedValueOnce({
      query: '',
      results: [makeFood({ key: 'm1' }), makeFood({ key: 'f1', kind: 'favorite', starred: true })],
    });
    await store.loadFoods();
    expect(api.searchFoods).toHaveBeenCalledWith({ limit: 10 });
    expect(store.foods().map((f) => f.key)).toEqual(['f1', 'm1']);
    expect(store.foodsStatus()).toBe('ready');

    api.searchFoods.mockResolvedValueOnce({
      query: '',
      results: [
        makeFood({ key: 'm2' }),
        makeFood({ key: 'm1' }),
        makeFood({ key: 'f1', kind: 'favorite', starred: true }),
      ],
    });
    await store.loadFoods({ stable: true });
    expect(store.foods().map((f) => f.key)).toEqual(['f1', 'm1', 'm2']);

    api.searchFoods.mockRejectedValueOnce(new Error('offline'));
    await store.loadFoods();
    expect(store.foodsStatus()).toBe('ready');
    expect(store.foods()).toHaveLength(3);
  });

  it('reports a library error only before anything loaded and recovers on retry', async () => {
    api.searchFoods.mockRejectedValueOnce(new Error('404'));
    await store.loadFoods();
    expect(store.foodsStatus()).toBe('error');
    expect(store.foods()).toEqual([]);

    const pending = deferred<FoodSearchResponse>();
    api.searchFoods.mockReturnValueOnce(pending.promise);
    const retry = store.loadFoods();
    expect(store.foodsStatus()).toBe('loading');
    pending.resolve({ query: '', results: [makeFood({ key: 'm1' })] });
    await retry;
    expect(store.foodsStatus()).toBe('ready');
    expect(store.foods().map((f) => f.key)).toEqual(['m1']);
  });

  it('keeps the profile goal and weight next to the targets from the shared profile', async () => {
    await store.loadProfile();
    await store.loadProfile();
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(store.profile()).toEqual({ goal: 'cut', weightKg: 80 });
    expect(store.targets()?.complete).toBe(true);
  });

  it('reloads the shared profile only once it is stale', async () => {
    await store.loadProfile();
    store.refreshProfileIfStale();
    expect(api.getProfile).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + PROFILE_STALE_MS + 1);
      store.refreshProfileIfStale();
    } finally {
      vi.useRealTimers();
    }
    await flush();
    expect(api.getProfile).toHaveBeenCalledTimes(2);
  });

  it('announces a new favorite so the library reloads', async () => {
    api.createFavoriteFromEntry.mockResolvedValueOnce(makeFavorite({ id: 'y' }));
    const saved = await store.saveAsFavorite(makeEntry({ id: 'e' }));
    expect(saved.id).toBe('y');
    expect(events.favorites()).toBe(1);
  });

  describe('library chip actions', () => {
    const chips = () => store.foods().map((f) => f.key);

    async function loadChips(...keys: string[]): Promise<void> {
      api.searchFoods.mockResolvedValueOnce({
        query: '',
        results: keys.map((key) => makeFood({ key, name: `Food ${key}` })),
      });
      await store.loadFoods();
    }

    it('renames a meal everywhere, updates its chip at once and announces the change', async () => {
      await loadChips('meal:a', 'meal:b');
      api.renameFood.mockResolvedValueOnce({
        matchedEntries: 3,
        renamedEntries: 3,
        renamedItems: 2,
      });
      const response = await store.renameFood(store.foods()[1], 'Khoury yogurt');
      expect(api.renameFood).toHaveBeenCalledWith({ from: 'Food meal:b', to: 'Khoury yogurt' });
      expect(response.renamedEntries).toBe(3);
      expect(store.foods().map((f) => f.name)).toEqual(['Food meal:a', 'Khoury yogurt']);
      expect(events.entries()).toBe(1);
    });

    it('leaves the chips alone and stays quiet when a rename fails', async () => {
      await loadChips('meal:a');
      api.renameFood.mockRejectedValueOnce(new Error('offline'));
      await expect(store.renameFood(store.foods()[0], 'Other')).rejects.toThrow('offline');
      expect(store.foods()[0].name).toBe('Food meal:a');
      expect(events.entries()).toBe(0);
    });

    it('hides a chip immediately, remembers its place and brings it back there on undo', async () => {
      await loadChips('meal:a', 'meal:b', 'meal:c');
      const target = store.foods()[1];
      const hide = deferred<HiddenFoodsResponse>();
      api.hideFood.mockReturnValueOnce(hide.promise);

      const hiding = store.hideFood(target);
      expect(chips()).toEqual(['meal:a', 'meal:c']);
      expect(api.hideFood).toHaveBeenCalledWith({ name: 'Food meal:b' });
      hide.resolve({ names: ['food meal:b'] });
      expect(await hiding).toBe(1);
      expect(events.entries()).toBe(1);

      api.unhideFood.mockResolvedValueOnce({ names: [] });
      const undo = store.unhideFood(target, 1);
      expect(chips()).toEqual(['meal:a', 'meal:b', 'meal:c']);
      await undo;
      expect(api.unhideFood).toHaveBeenCalledWith('Food meal:b');
      expect(events.entries()).toBe(2);
    });

    it('puts a chip back and rethrows when hiding fails', async () => {
      await loadChips('meal:a', 'meal:b');
      api.hideFood.mockRejectedValueOnce(new Error('offline'));
      await expect(store.hideFood(store.foods()[0])).rejects.toThrow('offline');
      expect(chips()).toEqual(['meal:a', 'meal:b']);
      expect(events.entries()).toBe(0);
    });

    it('removes the chip again when undoing a hide fails', async () => {
      await loadChips('meal:a', 'meal:b');
      const target = store.foods()[0];
      api.hideFood.mockResolvedValueOnce({ names: ['food meal:a'] });
      await store.hideFood(target);
      api.unhideFood.mockRejectedValueOnce(new Error('offline'));
      await expect(store.unhideFood(target, 0)).rejects.toThrow('offline');
      expect(chips()).toEqual(['meal:b']);
      expect(events.entries()).toBe(1);
    });

    it('never lets a library refresh bring back a chip that is being hidden', async () => {
      await loadChips('meal:a', 'meal:b');
      const stale = deferred<FoodSearchResponse>();
      api.searchFoods.mockReturnValueOnce(stale.promise);
      const staleLoad = store.loadFoods({ stable: true });

      const hide = deferred<HiddenFoodsResponse>();
      api.hideFood.mockReturnValueOnce(hide.promise);
      const hiding = store.hideFood(store.foods()[0]);

      api.searchFoods.mockResolvedValueOnce({
        query: '',
        results: [makeFood({ key: 'meal:a' }), makeFood({ key: 'meal:b' })],
      });
      await store.loadFoods({ stable: true });
      expect(chips()).toEqual(['meal:b']);

      stale.resolve({
        query: '',
        results: [makeFood({ key: 'meal:a' }), makeFood({ key: 'meal:b' })],
      });
      await staleLoad;
      expect(chips()).toEqual(['meal:b']);

      hide.resolve({ names: ['food meal:a'] });
      await hiding;
      expect(chips()).toEqual(['meal:b']);
    });

    it('drops a chip at once and ignores a library load that started before', async () => {
      await loadChips('product:p', 'meal:b');
      const stale = deferred<FoodSearchResponse>();
      api.searchFoods.mockReturnValueOnce(stale.promise);
      const staleLoad = store.loadFoods({ stable: true });

      store.removeFood('product:p');
      expect(chips()).toEqual(['meal:b']);

      stale.resolve({
        query: '',
        results: [makeFood({ key: 'product:p' }), makeFood({ key: 'meal:b' })],
      });
      await staleLoad;
      expect(chips()).toEqual(['meal:b']);
    });
  });

  it('shows an entry logged elsewhere on the viewed day at once and forgets other cached days', async () => {
    const today = '2026-09-28';
    const other = '2026-09-25';
    api.dayDashboard.mockImplementation(async (date: string) => makeDashboard(date));
    await store.show(other);
    await store.show(today);
    const calls = api.dayDashboard.mock.calls.length;

    store.addLogged(makeEntry({ id: 'x', localDate: today, totals: nutrients({ calories: 210 }) }));
    expect(store.dashboard()?.entries.map((entry) => entry.id)).toEqual(['x']);
    expect(store.dashboard()?.day.totals.calories).toBe(210);

    store.addLogged(makeEntry({ id: 'y', localDate: other }));
    const shown = store.show(other);
    expect(store.status()).toBe('loading');
    await shown;
    expect(api.dayDashboard.mock.calls.length).toBe(calls + 1);
  });
});
