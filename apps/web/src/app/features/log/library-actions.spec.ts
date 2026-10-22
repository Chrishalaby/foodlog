import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type FavoriteDto,
  type FoodRenameRequest,
  type FoodRenameResponse,
  type FoodSearchResult,
  type HiddenFoodsResponse,
  type HideFoodRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { FoodSearchStore } from './food-search.store';
import {
  LibraryActions,
  canHideResult,
  canSavePortion,
  favoriteLibraryResult,
} from './library-actions';

function result(overrides: Partial<FoodSearchResult> = {}): FoodSearchResult {
  return {
    portion: null,
    key: 'meal:entry-1',
    kind: 'meal',
    name: 'Chicken shawarma plate',
    detail: null,
    items: [],
    totals: zeroNutrients(),
    grams: 330,
    mealType: 'lunch',
    photo: null,
    favoriteId: null,
    entryId: 'entry-1',
    productId: null,
    useCount: 4,
    lastUsedAt: null,
    starred: false,
    ...overrides,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('LibraryActions', () => {
  const api = {
    renameFood: vi.fn<(body: FoodRenameRequest) => Promise<FoodRenameResponse>>(),
    hideFood: vi.fn<(body: HideFoodRequest) => Promise<HiddenFoodsResponse>>(),
    unhideFood: vi.fn<(name: string) => Promise<HiddenFoodsResponse>>(),
    createFavorite: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
  };
  const search = { forget: vi.fn(), refresh: vi.fn(async () => undefined) };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  let actions: LibraryActions;
  let events: DataEventsService;
  let toast: ToastService;

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    search.forget.mockReset();
    search.refresh.mockClear();
    api.renameFood.mockResolvedValue({ matchedEntries: 4, renamedEntries: 4, renamedItems: 2 });
    api.hideFood.mockResolvedValue({ names: ['chicken shawarma plate'] });
    api.unhideFood.mockResolvedValue({ names: [] });
    confirm.confirm.mockReset();
    confirm.confirm.mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        LibraryActions,
        { provide: FoodSearchStore, useValue: search },
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    actions = TestBed.inject(LibraryActions);
    events = TestBed.inject(DataEventsService);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => toast.clear());

  const messages = (): string[] => toast.toasts().map((item) => item.message);

  it('hides only meals and foods from suggestions', () => {
    expect(canHideResult({ kind: 'meal' })).toBe(true);
    expect(canHideResult({ kind: 'food' })).toBe(true);
    expect(canHideResult({ kind: 'product' })).toBe(false);
    expect(canHideResult({ kind: 'favorite' })).toBe(false);
  });

  it('turns a favorite into its starred library result', () => {
    const favorite: FavoriteDto = {
      portion: null,
      id: 'fav-9',
      name: 'Khoury yogurt',
      mealType: 'breakfast',
      items: [
        { name: 'Yogurt', grams: 170.04, nutrients: { ...zeroNutrients(), calories: 150 } },
        { name: 'Honey', grams: 10.03, nutrients: { ...zeroNutrients(), calories: 30 } },
      ],
      totals: { ...zeroNutrients(), calories: 180 },
      photo: null,
      useCount: 3,
      lastUsedAt: '2026-09-27T07:00:00.000Z',
      createdAt: '2026-09-20T07:00:00.000Z',
      updatedAt: '2026-09-20T07:00:00.000Z',
    };
    const starred = favoriteLibraryResult(favorite);
    expect(starred).toEqual({
      key: 'favorite:fav-9',
      kind: 'favorite',
      name: 'Khoury yogurt',
      detail: null,
      items: favorite.items,
      totals: favorite.totals,
      grams: 180.1,
      portion: null,
      mealType: 'breakfast',
      photo: null,
      favoriteId: 'fav-9',
      entryId: null,
      productId: null,
      useCount: 3,
      lastUsedAt: '2026-09-27T07:00:00.000Z',
      starred: true,
    });
    expect(starred.items).not.toBe(favorite.items);
  });

  describe('star', () => {
    const favorite = (name: string): FavoriteDto => ({
      portion: null,
      id: 'fav-1',
      name,
      mealType: null,
      items: [],
      totals: zeroNutrients(),
      photo: null,
      useCount: 0,
      lastUsedAt: null,
      createdAt: '2026-09-28T07:00:00.000Z',
      updatedAt: '2026-09-28T07:00:00.000Z',
    });

    it('stars a logged meal from its entry', async () => {
      api.createFavoriteFromEntry.mockResolvedValueOnce(favorite('Chicken shawarma plate'));
      await actions.star(result());
      expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-1');
      expect(api.createFavorite).not.toHaveBeenCalled();
      expect(events.favorites()).toBe(1);
    });

    it('never pins a meal type, so one-tap logging follows the time of day', async () => {
      api.createFavorite.mockResolvedValue(favorite('Chicken shawarma plate'));
      await actions.star(result({ entryId: null }));
      await actions.star(
        result({ key: 'food:item-1', kind: 'food', entryId: null, mealType: 'breakfast' }),
      );
      expect(api.createFavorite).toHaveBeenCalledTimes(2);
      for (const [body] of api.createFavorite.mock.calls) {
        expect(body).toMatchObject({ mealType: null });
      }
    });

    it('keeps the count of a food it stars', async () => {
      const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };
      api.createFavorite.mockResolvedValue(favorite('Burgers'));
      await actions.star(result({ key: 'food:item-1', kind: 'food', portion: burgers }));
      expect(api.createFavorite.mock.calls[0]![0]).toMatchObject({ portion: burgers });
      expect(canSavePortion(result({ portion: burgers }))).toBe(false);
      expect(canSavePortion(result())).toBe(true);
      expect(canSavePortion(result({ entryId: null }))).toBe(false);
      expect(canSavePortion(result({ key: 'product:p1', kind: 'product' }))).toBe(false);
    });
  });

  describe('rename', () => {
    it('renames every entry of a meal, notifies entries and favorites, and confirms', async () => {
      const response = await actions.rename(result(), '  Shawarma plate  ');
      expect(api.renameFood).toHaveBeenCalledWith({
        from: 'Chicken shawarma plate',
        to: 'Shawarma plate',
      });
      expect(response?.renamedEntries).toBe(4);
      expect(events.entries()).toBe(1);
      expect(events.favorites()).toBe(1);
      expect(messages()).toEqual(['Renamed 4 entries to “Shawarma plate”']);
      expect(actions.busyKey()).toBeNull();
    });

    it('says so when nothing was left to rename', async () => {
      api.renameFood.mockResolvedValueOnce({
        matchedEntries: 0,
        renamedEntries: 0,
        renamedItems: 0,
      });
      await actions.rename(result(), 'Shawarma plate');
      expect(messages()).toEqual(['Nothing named “Chicken shawarma plate” was left to rename.']);
    });

    it('ignores empty or unchanged names, foods and concurrent actions', async () => {
      expect(await actions.rename(result(), '   ')).toBeNull();
      expect(await actions.rename(result(), 'Chicken shawarma plate')).toBeNull();
      expect(
        await actions.rename(result({ kind: 'food', key: 'food:item-1' }), 'Yogurt'),
      ).toBeNull();
      const pending = actions.rename(result(), 'Shawarma');
      expect(actions.busyKey()).toBe('meal:entry-1');
      expect(await actions.rename(result({ key: 'meal:entry-2' }), 'Other')).toBeNull();
      await pending;
      expect(api.renameFood).toHaveBeenCalledTimes(1);
    });

    it('reports a failure without notifying', async () => {
      api.renameFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      expect(await actions.rename(result(), 'Shawarma')).toBeNull();
      expect(events.entries()).toBe(0);
      expect(messages()).toEqual(["Couldn't rename Chicken shawarma plate. Please try again."]);
      expect(actions.busyKey()).toBeNull();
    });
  });

  describe('hide', () => {
    it('removes the name from suggestions right away and offers an undo', async () => {
      expect(await actions.hide(result())).toBe(true);
      expect(search.forget).toHaveBeenCalledWith('Chicken shawarma plate');
      expect(api.hideFood).toHaveBeenCalledWith({ name: 'Chicken shawarma plate' });
      expect(events.entries()).toBe(1);
      const [shown] = toast.toasts();
      expect(shown?.message).toBe(
        'Removed “Chicken shawarma plate” from suggestions. Your logs are kept.',
      );
      expect(shown?.action?.label).toBe('Undo');

      toast.runAction(shown!.id);
      await flush();
      expect(api.unhideFood).toHaveBeenCalledWith('Chicken shawarma plate');
      expect(events.entries()).toBe(2);
      expect(messages()).toContain('“Chicken shawarma plate” is back in suggestions');
    });

    it('brings the result back when hiding fails', async () => {
      api.hideFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      expect(await actions.hide(result({ kind: 'food', key: 'food:item-1', name: 'Yogurt' }))).toBe(
        false,
      );
      expect(search.refresh).toHaveBeenCalled();
      expect(events.entries()).toBe(0);
      expect(messages()).toEqual(["Couldn't remove Yogurt from suggestions."]);
    });

    it('never hides favorites or products', async () => {
      expect(await actions.hide(result({ kind: 'favorite', key: 'favorite:1' }))).toBe(false);
      expect(await actions.hide(result({ kind: 'product', key: 'product:1' }))).toBe(false);
      expect(api.hideFood).not.toHaveBeenCalled();
      expect(search.forget).not.toHaveBeenCalled();
    });

    it('reports a failed undo', async () => {
      api.unhideFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      expect(await actions.unhide('Yogurt')).toBe(false);
      expect(events.entries()).toBe(0);
      expect(messages()).toEqual(["Couldn't bring back Yogurt. Please try again."]);
    });
  });
});
