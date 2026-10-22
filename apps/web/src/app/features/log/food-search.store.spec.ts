import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  zeroNutrients,
  type FoodSearchQuery,
  type FoodSearchResponse,
  type FoodSearchResult,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { SessionScope } from '../../core/session-scope';
import {
  BROWSE_LIMIT,
  FOOD_SEARCH_SCOPE,
  FoodSearchStore,
  SEARCH_DEBOUNCE_MS,
} from './food-search.store';

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

function food(name: string, starred = false): FoodSearchResult {
  return {
    portion: null,
    key: `${starred ? 'favorite' : 'meal'}:${name}`,
    kind: starred ? 'favorite' : 'meal',
    name,
    detail: null,
    items: [],
    totals: zeroNutrients(),
    grams: 100,
    mealType: null,
    photo: null,
    favoriteId: starred ? `fav-${name}` : null,
    entryId: starred ? null : `entry-${name}`,
    productId: null,
    useCount: 1,
    lastUsedAt: null,
    starred,
  };
}

const response = (query: string, ...results: FoodSearchResult[]): FoodSearchResponse => ({
  query,
  results,
});

describe('FoodSearchStore', () => {
  const searchFoods = vi.fn<(query: FoodSearchQuery) => Promise<FoodSearchResponse>>();
  let store: FoodSearchStore;

  beforeEach(() => {
    vi.useFakeTimers();
    searchFoods.mockReset();
    searchFoods.mockImplementation(async (query) =>
      query.q
        ? response(query.q, food(`${query.q} match`))
        : response('', food('Oats', true), food('Rice')),
    );
    TestBed.configureTestingModule({
      providers: [FoodSearchStore, { provide: ApiService, useValue: { searchFoods } }],
    });
    store = TestBed.inject(FoodSearchStore);
  });

  afterEach(() => vi.useRealTimers());

  async function activate(): Promise<void> {
    store.activate();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('does nothing until activated, then loads starred and frequent foods', async () => {
    TestBed.tick();
    expect(searchFoods).not.toHaveBeenCalled();
    await activate();
    expect(searchFoods).toHaveBeenCalledWith({ limit: BROWSE_LIMIT });
    expect(store.loaded()).toBe(true);
    expect(store.browsing()).toBe(true);
    expect(store.sections().starred.map((r) => r.name)).toEqual(['Oats']);
    expect(store.sections().recent.map((r) => r.name)).toEqual(['Rice']);
  });

  it('debounces typing into a single request for the latest text', async () => {
    await activate();
    searchFoods.mockClear();
    store.setText('k');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50);
    store.setText('kh');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50);
    store.setText('  khoury ');
    expect(store.busy()).toBe(true);
    expect(store.settled()).toBe(false);
    expect(store.results().map((r) => r.name)).toEqual(['Oats', 'Rice']);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(searchFoods).toHaveBeenCalledTimes(1);
    expect(searchFoods).toHaveBeenCalledWith({ q: 'khoury' });
    expect(store.shownQuery()).toBe('khoury');
    expect(store.results().map((r) => r.name)).toEqual(['khoury match']);
    expect(store.settled()).toBe(true);
  });

  it('keeps the previous results visible while a search is loading', async () => {
    await activate();
    const slow = deferred<FoodSearchResponse>();
    searchFoods.mockReturnValueOnce(slow.promise);
    store.setText('yog');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.loading()).toBe(true);
    expect(store.shownQuery()).toBe('');
    expect(store.results()).toHaveLength(2);
    slow.resolve(response('yog', food('Yogurt')));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.loading()).toBe(false);
    expect(store.results().map((r) => r.name)).toEqual(['Yogurt']);
  });

  it('ignores responses to stale queries', async () => {
    await activate();
    const first = deferred<FoodSearchResponse>();
    const second = deferred<FoodSearchResponse>();
    searchFoods.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    store.setText('yog');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    store.setText('yogurt');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    second.resolve(response('yogurt', food('Greek yogurt')));
    await vi.advanceTimersByTimeAsync(0);
    first.resolve(response('yog', food('Yoghurt drink')));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.shownQuery()).toBe('yogurt');
    expect(store.results().map((r) => r.name)).toEqual(['Greek yogurt']);
    expect(store.loading()).toBe(false);
  });

  it('shows the cached browse list at once when the search is cleared', async () => {
    await activate();
    store.setText('rice');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    const refresh = deferred<FoodSearchResponse>();
    searchFoods.mockReturnValueOnce(refresh.promise);
    store.clear();
    expect(store.text()).toBe('');
    expect(store.shownQuery()).toBe('');
    expect(store.results().map((r) => r.name)).toEqual(['Oats', 'Rice']);
    expect(searchFoods).toHaveBeenLastCalledWith({ limit: BROWSE_LIMIT });
    refresh.resolve(response('', food('Soup')));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.results().map((r) => r.name)).toEqual(['Soup']);
  });

  it('reports errors, keeps the last results and retries on refresh', async () => {
    await activate();
    searchFoods.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    store.setText('tea');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.error()).toBe("Couldn't load your foods.");
    expect(store.results()).toHaveLength(2);
    await store.refresh();
    expect(store.error()).toBeNull();
    expect(store.results().map((r) => r.name)).toEqual(['tea match']);
  });

  it('refreshes the current query when entries or favorites change', async () => {
    await activate();
    store.setText('tea');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    searchFoods.mockClear();
    TestBed.inject(DataEventsService).notify('entries');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(searchFoods).toHaveBeenCalledWith({ q: 'tea' });
    TestBed.inject(DataEventsService).notify('weights');
    TestBed.tick();
    expect(searchFoods).toHaveBeenCalledTimes(1);
  });

  it('refreshes when products change, e.g. after a barcode scan saved one', async () => {
    await activate();
    searchFoods.mockClear();
    TestBed.inject(DataEventsService).notify('products');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(searchFoods).toHaveBeenCalledWith({ limit: BROWSE_LIMIT });
  });

  it('forgets results, the typed text and the browse cache when the session resets', async () => {
    await activate();
    store.setText('tea');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.results()).toHaveLength(1);

    TestBed.inject(SessionScope).reset();
    expect(store.text()).toBe('');
    expect(store.results()).toEqual([]);
    expect(store.loaded()).toBe(false);

    store.setText('rice');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.results().map((r) => r.name)).toEqual(['rice match']);
    store.setText('');
    expect(store.results().map((r) => r.name)).toEqual(['rice match']);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.results().map((r) => r.name)).toEqual(['Oats', 'Rice']);
  });

  it('stays quiet while hidden and catches up once when shown again', async () => {
    await activate();
    searchFoods.mockClear();
    store.deactivate();
    TestBed.tick();
    const events = TestBed.inject(DataEventsService);
    events.notify('entries');
    events.notify('favorites');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(searchFoods).not.toHaveBeenCalled();

    await activate();
    expect(searchFoods).toHaveBeenCalledTimes(1);
    store.deactivate();
    TestBed.tick();
    await activate();
    expect(searchFoods).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending search immediately and returns its results', async () => {
    await activate();
    store.setText('latte');
    const results = await store.flush();
    expect(results.map((r) => r.name)).toEqual(['latte match']);
    expect(searchFoods).toHaveBeenLastCalledWith({ q: 'latte' });
    expect((await store.flush()).map((r) => r.name)).toEqual(['latte match']);
    expect(searchFoods).toHaveBeenCalledTimes(2);
  });

  it('forgets a hidden name locally, also in the cached browse list, but keeps starred foods', async () => {
    searchFoods.mockImplementation(async (query) =>
      query.q
        ? response(query.q, food('Rice pudding'), food('RICE'))
        : response('', food('Rice', true), food('Rice'), food('Ríce'), food('Oats')),
    );
    await activate();
    store.forget('  rice ');
    expect(store.results().map((r) => `${r.kind}:${r.name}`)).toEqual([
      'favorite:Rice',
      'meal:Oats',
    ]);

    store.setText('rice');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.results().map((r) => r.name)).toEqual(['Rice pudding', 'RICE']);
    store.forget('Rice');
    expect(store.results().map((r) => r.name)).toEqual(['Rice pudding']);

    const pending = deferred<FoodSearchResponse>();
    searchFoods.mockReturnValueOnce(pending.promise);
    store.clear();
    expect(store.results().map((r) => r.name)).toEqual(['Rice', 'Oats']);
    pending.resolve(response('', food('Oats')));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.results().map((r) => r.name)).toEqual(['Oats']);
  });
});

describe('FoodSearchStore with a scope', () => {
  const searchFoods = vi.fn<(query: FoodSearchQuery) => Promise<FoodSearchResponse>>();

  beforeEach(() => {
    vi.useFakeTimers();
    searchFoods.mockReset();
    searchFoods.mockImplementation(async (query) => response(query.q ?? '', food('Oats')));
    TestBed.configureTestingModule({
      providers: [
        FoodSearchStore,
        { provide: FOOD_SEARCH_SCOPE, useValue: 'standalone' },
        { provide: ApiService, useValue: { searchFoods } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('asks only for foods eaten on their own when browsing and searching', async () => {
    const store = TestBed.inject(FoodSearchStore);
    store.activate();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(searchFoods).toHaveBeenCalledWith({ limit: BROWSE_LIMIT, scope: 'standalone' });

    store.setText('ketchup');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(searchFoods).toHaveBeenLastCalledWith({ q: 'ketchup', scope: 'standalone' });
  });
});
