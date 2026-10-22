import { TestBed } from '@angular/core/testing';
import type {
  FoodMergeSuggestionsResponse,
  MergeFoodsRequest,
  MyFoodChangeResponse,
  MyFoodDto,
  SaveMyFoodRequest,
  UpdateMyFoodRequest,
} from '@food/shared';
import {
  MAYO,
  YOGURT,
  ketchupSuggestion,
  mayoSuggestion,
  myFood,
  per100,
} from '../shared/testing/my-foods-fixtures';
import { ApiService } from './api.service';
import { DataEventsService } from './data-events.service';
import { MY_FOODS_RETRY_MS, MyFoodsStore } from './my-foods.store';
import { SessionScope } from './session-scope';

const KETCHUP = myFood();

function change(food: MyFoodDto, updatedItems = 0): MyFoodChangeResponse {
  return { food, updatedItems, updatedEntries: updatedItems > 0 ? 2 : 0, updatedFavorites: 0 };
}

describe('MyFoodsStore', () => {
  const api = {
    listMyFoods: vi.fn<() => Promise<MyFoodDto[]>>(),
    createMyFood: vi.fn<(body: SaveMyFoodRequest) => Promise<MyFoodDto>>(),
    updateMyFood: vi.fn<(id: string, body: UpdateMyFoodRequest) => Promise<MyFoodChangeResponse>>(),
    deleteMyFood: vi.fn<(id: string) => Promise<void>>(),
    foodMergeSuggestions: vi.fn<() => Promise<FoodMergeSuggestionsResponse>>(),
    mergeFoods: vi.fn<(body: MergeFoodsRequest) => Promise<MyFoodChangeResponse>>(),
    dismissFoodMerge: vi.fn<(body: { key: string }) => Promise<void>>(),
  };
  let store: MyFoodsStore;
  let events: DataEventsService;

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.listMyFoods.mockResolvedValue([KETCHUP, MAYO]);
    api.foodMergeSuggestions.mockResolvedValue({
      suggestions: [ketchupSuggestion(), mayoSuggestion()],
    });
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    store = TestBed.inject(MyFoodsStore);
    events = TestBed.inject(DataEventsService);
  });

  it('loads the list once and serves it from the cache', async () => {
    expect(store.status()).toBe('idle');
    const first = store.ensureLoaded();
    const second = store.ensureLoaded();
    expect(store.status()).toBe('loading');
    await Promise.all([first, second]);
    await store.ensureLoaded();
    expect(api.listMyFoods).toHaveBeenCalledTimes(1);
    expect(store.status()).toBe('ready');
    expect(store.foods().map((food) => food.name)).toEqual([
      'Heinz tomato ketchup',
      'Heinz mayonnaise, regular',
    ]);
    expect(store.find('food-mayo')).toBe(MAYO);
    expect(store.find(null)).toBeNull();
  });

  it('reloads after new logs or product changes elsewhere', async () => {
    await store.ensureLoaded();
    events.notify('entries');
    api.listMyFoods.mockResolvedValue([KETCHUP, MAYO, YOGURT]);
    await store.ensureLoaded();
    expect(api.listMyFoods).toHaveBeenCalledTimes(2);
    expect(store.count()).toBe(3);
    events.notify('products');
    await store.ensureLoaded();
    expect(api.listMyFoods).toHaveBeenCalledTimes(3);
  });

  it('keeps the last list when a reload fails and reports a first failure', async () => {
    api.listMyFoods.mockRejectedValueOnce(new Error('offline'));
    await store.ensureLoaded();
    expect(store.status()).toBe('error');
    await store.refresh();
    expect(store.status()).toBe('ready');
    api.listMyFoods.mockRejectedValueOnce(new Error('offline'));
    await store.refresh();
    expect(store.status()).toBe('ready');
    expect(store.foods()).toHaveLength(2);
  });

  it('does not ask again on every change while offline, only after new data or a pause', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      api.listMyFoods.mockRejectedValue(new Error('offline'));
      api.foodMergeSuggestions.mockRejectedValue(new Error('offline'));
      await store.ensureLoaded();
      await store.ensureLoaded();
      await store.ensureSuggestions();
      await store.ensureSuggestions();
      expect(api.listMyFoods).toHaveBeenCalledTimes(1);
      expect(api.foodMergeSuggestions).toHaveBeenCalledTimes(1);
      events.notify('entries');
      await store.ensureLoaded();
      expect(api.listMyFoods).toHaveBeenCalledTimes(2);
      vi.setSystemTime(Date.now() + MY_FOODS_RETRY_MS);
      api.listMyFoods.mockResolvedValue([KETCHUP]);
      await store.ensureLoaded();
      await store.ensureSuggestions();
      expect(api.listMyFoods).toHaveBeenCalledTimes(3);
      expect(api.foodMergeSuggestions).toHaveBeenCalledTimes(2);
      expect(store.status()).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never throws when the API is unavailable', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: {} }] });
    const bare = TestBed.inject(MyFoodsStore);
    await expect(bare.ensureLoaded()).resolves.toBeUndefined();
    await expect(bare.ensureSuggestions()).resolves.toBeUndefined();
    expect(bare.status()).toBe('error');
    expect(bare.suggestionsStatus()).toBe('error');
  });

  it('adds a created food to the cached list and tells the library', async () => {
    await store.ensureLoaded();
    const created = myFood({ id: 'food-bun', name: 'Sofisoft potato bun', useCount: 0 });
    api.createMyFood.mockResolvedValue(created);
    const products = events.products();
    const body: SaveMyFoodRequest = {
      name: 'Sofisoft potato bun',
      basisUnit: 'g',
      per100: per100({ calories: 272 }),
      source: 'manual',
    };
    await expect(store.create(body)).resolves.toBe(created);
    expect(api.createMyFood).toHaveBeenCalledWith(body);
    expect(events.products()).toBe(products + 1);
    expect(store.foods().map((food) => food.id)).toEqual(['food-ketchup', 'food-mayo', 'food-bun']);
    await store.ensureLoaded();
    expect(api.listMyFoods).toHaveBeenCalledTimes(1);
  });

  it('replaces an edited food and refreshes logs when past items changed', async () => {
    await store.ensureLoaded();
    const edited = myFood({ per100: per100({ calories: 105 }) });
    api.updateMyFood.mockResolvedValue(change(edited, 3));
    const entries = events.entries();
    const favorites = events.favorites();
    const response = await store.update(KETCHUP.id, { per100: edited.per100, applyToPast: true });
    expect(response.updatedItems).toBe(3);
    expect(store.find(KETCHUP.id)?.per100.calories).toBe(105);
    expect(events.entries()).toBe(entries + 1);
    expect(events.favorites()).toBe(favorites + 1);

    api.updateMyFood.mockResolvedValue(change(myFood({ name: 'Ketchup' })));
    await store.update(KETCHUP.id, { name: 'Ketchup' });
    expect(events.entries()).toBe(entries + 1);
    expect(store.find(KETCHUP.id)?.name).toBe('Ketchup');
  });

  it('drops a deleted food', async () => {
    await store.ensureLoaded();
    api.deleteMyFood.mockResolvedValue(undefined);
    await store.remove(MAYO.id);
    expect(api.deleteMyFood).toHaveBeenCalledWith('food-mayo');
    expect(store.foods().map((food) => food.id)).toEqual(['food-ketchup']);
  });

  it('loads merge suggestions and drops a merged one', async () => {
    await store.ensureSuggestions();
    await store.ensureSuggestions();
    expect(api.foodMergeSuggestions).toHaveBeenCalledTimes(1);
    expect(store.suggestions().map((item) => item.key)).toEqual(['tomato ketchup', 'mayo']);

    const merged = myFood({ id: 'food-new', name: 'Heinz tomato ketchup' });
    api.mergeFoods.mockResolvedValue(change(merged, 3));
    const topics = [events.entries(), events.favorites(), events.products()];
    const body: MergeFoodsRequest = {
      key: 'tomato ketchup',
      names: ['Heinz tomato ketchup', 'Tomato ketchup'],
      name: 'Heinz tomato ketchup',
      basisUnit: 'g',
      per100: per100({ calories: 118 }),
      productId: null,
      applyToPast: true,
    };
    await store.merge(body);
    expect(api.mergeFoods).toHaveBeenCalledWith(body);
    expect(store.suggestions().map((item) => item.key)).toEqual(['mayo']);
    expect(store.find('food-new')).toEqual(merged);
    expect([events.entries(), events.favorites(), events.products()]).toEqual(
      topics.map((version) => version + 1),
    );
    await store.ensureSuggestions();
    expect(api.foodMergeSuggestions).toHaveBeenCalledTimes(2);
  });

  it('reloads the list after a merge, since other saved foods may have lost items', async () => {
    await store.ensureLoaded();
    api.mergeFoods.mockResolvedValue(change(myFood({ id: 'food-new' }), 3));
    await store.merge({
      key: 'tomato ketchup',
      names: ['Heinz tomato ketchup', 'Tomato ketchup'],
      name: 'Heinz tomato ketchup',
      basisUnit: 'g',
      per100: per100({ calories: 118 }),
      productId: null,
      applyToPast: true,
    });
    expect(store.find('food-new')).not.toBeNull();
    await store.ensureLoaded();
    expect(api.listMyFoods).toHaveBeenCalledTimes(2);
    expect(store.find('food-new')).toBeNull();
  });

  it('hides a dismissed suggestion at once and restores it when the server refuses', async () => {
    await store.ensureSuggestions();
    api.dismissFoodMerge.mockResolvedValueOnce(undefined);
    await store.dismiss('mayo');
    expect(api.dismissFoodMerge).toHaveBeenCalledWith({ key: 'mayo' });
    expect(store.suggestions().map((item) => item.key)).toEqual(['tomato ketchup']);

    api.dismissFoodMerge.mockRejectedValueOnce(new Error('offline'));
    const pending = store.dismiss('tomato ketchup');
    expect(store.suggestions()).toEqual([]);
    await expect(pending).rejects.toThrow('offline');
    expect(store.suggestions().map((item) => item.key)).toEqual(['tomato ketchup']);
  });

  it('forgets everything when the session ends', async () => {
    await store.ensureLoaded();
    await store.ensureSuggestions();
    TestBed.inject(SessionScope).reset();
    expect(store.foods()).toEqual([]);
    expect(store.suggestions()).toEqual([]);
    expect(store.status()).toBe('idle');
    await store.ensureLoaded();
    expect(api.listMyFoods).toHaveBeenCalledTimes(2);
  });

  it('ignores a list that arrives after the session ended', async () => {
    let resolve: (foods: MyFoodDto[]) => void = () => undefined;
    api.listMyFoods.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const loading = store.ensureLoaded();
    TestBed.inject(SessionScope).reset();
    resolve([KETCHUP]);
    await loading;
    expect(store.foods()).toEqual([]);
    expect(store.status()).toBe('idle');
  });
});
