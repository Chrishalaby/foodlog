import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  zeroNutrients,
  type AnalysisPhotoRef,
  type EntryDto,
  type FavoriteDto,
  type FoodRenameRequest,
  type FoodRenameResponse,
  type ProductDto,
  type UpdateEntryRequest,
  type UpdateFavoriteRequest,
  type UpsertProductRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import {
  EntryEditStore,
  brandLeadsName,
  formatRawAi,
  productDisplayName,
  renameOfferTitle,
  renamedOthersMessage,
} from './entry-edit.store';

const TIMESTAMP = new Date(2026, 8, 28, 12, 34, 56).toISOString();

function entry(overrides: Partial<EntryDto> = {}): EntryDto {
  return {
    portion: null,
    id: 'entry-1',
    name: 'Chicken bowl',
    description: 'with rice',
    mealType: 'lunch',
    source: 'food_photo',
    timestamp: TIMESTAMP,
    localDate: '2026-09-28',
    items: [
      {
        count: null,
        unit: null,
        unitPlural: null,
        id: 'item-1',
        position: 0,
        name: 'Chicken',
        grams: 150,
        nutrients: { ...zeroNutrients(), calories: 248, protein: 46.5, fat: 5.4 },
        confidence: 'high',
        productId: null,
        micros: null,
        fluidMl: null,
      },
    ],
    totals: { ...zeroNutrients(), calories: 248, protein: 46.5, fat: 5.4 },
    photo: null,
    photos: [],
    analysisId: 'analysis-1',
    favoriteId: null,
    productId: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

describe('EntryEditStore', () => {
  let store: EntryEditStore;
  const api = {
    getEntry: vi.fn<(id: string) => Promise<EntryDto>>(),
    updateEntry: vi.fn<(id: string, body: UpdateEntryRequest) => Promise<EntryDto>>(),
    deleteEntry: vi.fn<(id: string) => Promise<void>>(),
    duplicateEntry: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
    getEntryRawAi: vi.fn(),
    renameFood: vi.fn<(body: FoodRenameRequest) => Promise<FoodRenameResponse>>(),
    listProducts: vi.fn<() => Promise<ProductDto[]>>(),
    upsertProduct: vi.fn<(code: string, body: UpsertProductRequest) => Promise<ProductDto>>(),
    updateMyFood: vi.fn(),
    listFavorites: vi.fn<() => Promise<FavoriteDto[]>>(),
    updateFavorite: vi.fn<(id: string, body: UpdateFavoriteRequest) => Promise<FavoriteDto>>(),
  };

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getEntry.mockResolvedValue(entry());
    api.updateEntry.mockImplementation(async (id, body) =>
      entry({
        ...body,
        id,
        description: body.description ?? null,
        items: body.items.map((input, position) => ({
          count: null,
          unit: null,
          unitPlural: null,
          ...input,
          id: `item-${position}`,
          position,
          confidence: input.confidence ?? null,
          productId: input.productId ?? null,
          micros: input.micros ?? null,
          fluidMl: input.fluidMl ?? null,
        })),
      }),
    );
    TestBed.configureTestingModule({
      providers: [EntryEditStore, { provide: ApiService, useValue: api }],
    });
    store = TestBed.inject(EntryEditStore);
  });

  it('loads an entry into the form and tracks unsaved edits', async () => {
    await store.load('entry-1');
    expect(store.status()).toBe('ready');
    expect(store.name()).toBe('Chicken bowl');
    expect(store.mealType()).toBe('lunch');
    expect(store.description()).toBe('with rice');
    expect(store.dateTime()).toBe('2026-09-28T12:34');
    expect(store.items()[0]).toMatchObject({ name: 'Chicken', grams: 150, confidence: 'high' });
    expect(store.dirty()).toBe(false);

    store.name.set('Chicken rice bowl');
    expect(store.dirty()).toBe(true);
    store.name.set('Chicken bowl ');
    expect(store.dirty()).toBe(false);
  });

  it('keeps the original instant and local date when the time was not touched', async () => {
    await store.load('entry-1');
    store.mealType.set('dinner');
    const saved = await store.save();
    expect(saved).not.toBeNull();
    expect(api.updateEntry).toHaveBeenCalledWith('entry-1', {
      name: 'Chicken bowl',
      description: 'with rice',
      mealType: 'dinner',
      timestamp: TIMESTAMP,
      localDate: '2026-09-28',
      items: [
        {
          name: 'Chicken',
          grams: 150,
          nutrients: { ...zeroNutrients(), calories: 248, protein: 46.5, fat: 5.4 },
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
        },
      ],
      portion: null,
    });
    expect(store.dirty()).toBe(false);
  });

  it('derives timestamp and local date from an edited time', async () => {
    await store.load('entry-1');
    store.dateTime.set('2026-09-27T21:05');
    await store.save();
    expect(api.updateEntry.mock.calls[0]![1]).toMatchObject({
      timestamp: new Date(2026, 8, 27, 21, 5).toISOString(),
      localDate: '2026-09-27',
    });
  });

  it('validates before saving and reports server errors', async () => {
    await store.load('entry-1');
    store.items.set([]);
    expect(await store.save()).toBeNull();
    expect(store.visibleValidationError()).toBe('Add at least one item.');
    expect(api.updateEntry).not.toHaveBeenCalled();

    await store.load('entry-1');
    store.description.set('changed');
    api.updateEntry.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 400, error: { statusCode: 400, message: 'name too long' } }),
    );
    expect(await store.save()).toBeNull();
    expect(store.saveError()).toBe('Name too long.');
    expect(store.busy()).toBeNull();
  });

  it('marks missing entries as not found and other failures as errors', async () => {
    api.getEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    await store.load('missing');
    expect(store.status()).toBe('not_found');

    api.getEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await store.load('entry-1');
    expect(store.status()).toBe('error');
    expect(store.loadError()).toContain('offline');
  });

  it('ignores a slower response for a previous id', async () => {
    let resolveFirst!: (value: EntryDto) => void;
    api.getEntry.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    api.getEntry.mockResolvedValueOnce(entry({ id: 'entry-2', name: 'Soup' }));
    const first = store.load('entry-1');
    await store.load('entry-2');
    resolveFirst(entry());
    await first;
    expect(store.entry()?.id).toBe('entry-2');
    expect(store.name()).toBe('Soup');
  });

  it('logs again now with a guessed meal type and saves favorites by name', async () => {
    await store.load('entry-1');
    api.duplicateEntry.mockResolvedValueOnce(entry({ id: 'entry-3' }));
    const now = new Date(2026, 8, 28, 19, 30);
    const copy = await store.logAgain(now);
    expect(copy.id).toBe('entry-3');
    expect(api.duplicateEntry).toHaveBeenCalledWith('entry-1', {
      timestamp: now.toISOString(),
      localDate: '2026-09-28',
      mealType: 'dinner',
    });

    api.createFavoriteFromEntry.mockResolvedValue({ id: 'fav-1', name: 'Bowl' });
    await store.saveAsFavorite('  Bowl ');
    expect(api.createFavoriteFromEntry).toHaveBeenLastCalledWith('entry-1', { name: 'Bowl' });
    await store.saveAsFavorite('');
    expect(api.createFavoriteFromEntry).toHaveBeenLastCalledWith('entry-1', {});
  });

  it('deletes through the API and resets the busy state on failure', async () => {
    await store.load('entry-1');
    api.deleteEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    await expect(store.remove()).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.busy()).toBeNull();
    api.deleteEntry.mockResolvedValueOnce(undefined);
    await store.remove();
    expect(api.deleteEntry).toHaveBeenCalledTimes(2);
  });

  it('lazily loads and pretty-prints the raw AI JSON once', async () => {
    await store.load('entry-1');
    api.getEntryRawAi.mockResolvedValue({
      entryId: 'entry-1',
      analysisId: 'analysis-1',
      rawAiJson: { mealName: 'Bowl', items: [1] },
    });
    await store.loadRawAi();
    await store.loadRawAi();
    expect(api.getEntryRawAi).toHaveBeenCalledTimes(1);
    expect(store.rawAi()).toEqual({
      status: 'ready',
      text: '{\n  "mealName": "Bowl",\n  "items": [\n    1\n  ]\n}',
      error: null,
    });
  });

  it('notifies other screens after every successful change', async () => {
    const events = TestBed.inject(DataEventsService);
    await store.load('entry-1');
    store.name.set('Chicken & rice');
    await store.save();
    expect(events.entries()).toBe(1);

    api.duplicateEntry.mockResolvedValueOnce(entry({ id: 'entry-2' }));
    await store.logAgain();
    expect(events.entries()).toBe(2);

    api.createFavoriteFromEntry.mockResolvedValueOnce({ id: 'fav-1', name: 'Chicken & rice' });
    await store.saveAsFavorite('');
    expect(events.favorites()).toBe(1);

    api.deleteEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    await expect(store.remove()).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(events.entries()).toBe(2);
    api.deleteEntry.mockResolvedValueOnce(undefined);
    await store.remove();
    expect(events.entries()).toBe(3);
  });

  describe('cover photo', () => {
    const photo = (id: string) => ({
      id,
      url: `/api/photos/${id}`,
      thumbUrl: `/api/photos/${id}/thumb`,
      width: 1344,
      height: 1792,
    });
    const PHOTOS: AnalysisPhotoRef[] = [
      { photo: photo('food-1'), role: 'food' },
      { photo: photo('label-1'), role: 'label' },
    ];

    beforeEach(() => {
      api.getEntry.mockResolvedValue(entry({ photo: PHOTOS[0]!.photo, photos: PHOTOS }));
      api.updateEntry.mockImplementation(async (id, body) =>
        entry({
          id,
          photo:
            PHOTOS.find(({ photo: ref }) => ref.id === body.coverPhotoId)?.photo ??
            PHOTOS[0]!.photo,
          photos: PHOTOS,
        }),
      );
    });

    it('exposes every photo and the current cover', async () => {
      await store.load('entry-1');
      expect(store.photos()).toEqual(PHOTOS);
      expect(store.coverId()).toBe('food-1');
      expect(store.cover()).toBe(PHOTOS[0]!.photo);
    });

    it('treats the first photo as the cover when the entry has none', async () => {
      api.getEntry.mockResolvedValue(entry({ photo: null, photos: PHOTOS }));
      await store.load('entry-1');
      expect(store.coverId()).toBe('food-1');
      expect(store.cover()).toBe(PHOTOS[0]!.photo);
    });

    it('saves only the new cover and keeps unsaved edits in the form', async () => {
      await store.load('entry-1');
      const version = store.formVersion();
      store.name.set('Chicken & labneh');
      const events = TestBed.inject(DataEventsService);
      const before = events.entries();

      const updated = await store.setCover('label-1');

      expect(api.updateEntry).toHaveBeenCalledWith('entry-1', {
        name: 'Chicken bowl',
        description: 'with rice',
        mealType: 'lunch',
        timestamp: TIMESTAMP,
        localDate: '2026-09-28',
        items: [
          {
            name: 'Chicken',
            grams: 150,
            nutrients: { ...zeroNutrients(), calories: 248, protein: 46.5, fat: 5.4 },
            confidence: 'high',
            count: null,
            unit: null,
            unitPlural: null,
          },
        ],
        portion: null,
        coverPhotoId: 'label-1',
      });
      expect(updated.photo?.id).toBe('label-1');
      expect(store.coverId()).toBe('label-1');
      expect(store.name()).toBe('Chicken & labneh');
      expect(store.dirty()).toBe(true);
      expect(store.formVersion()).toBe(version);
      expect(store.busy()).toBeNull();
      expect(events.entries()).toBe(before + 1);
    });

    it('skips the request for the current cover or a photo the entry does not have', async () => {
      await store.load('entry-1');
      await store.setCover('food-1');
      await store.setCover('someone-else');
      expect(api.updateEntry).not.toHaveBeenCalled();
    });

    it('keeps the old cover when the change fails', async () => {
      await store.load('entry-1');
      api.updateEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      await expect(store.setCover('label-1')).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(store.coverId()).toBe('food-1');
      expect(store.busy()).toBeNull();
    });

    it('starts a new form version whenever the form is refilled', async () => {
      await store.load('entry-1');
      const loaded = store.formVersion();
      store.mealType.set('dinner');
      await store.save();
      expect(store.formVersion()).toBe(loaded + 1);
    });
  });

  it('formats raw AI payloads of any shape', () => {
    expect(formatRawAi(null)).toBeNull();
    expect(formatRawAi('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatRawAi('not json')).toBe('not json');
    expect(formatRawAi([1])).toBe('[\n  1\n]');
  });

  describe('renaming other entries', () => {
    const counts = (matchedEntries: number, renamedEntries = 0): FoodRenameResponse => ({
      matchedEntries,
      renamedEntries,
      renamedItems: renamedEntries,
    });

    it('offers to rename the other entries that still carry the old name', async () => {
      await store.load('entry-1');
      api.renameFood.mockResolvedValueOnce(counts(3));
      const offer = await store.findRenameOffer(' Chicken bowl ', 'Chicken rice bowl');
      expect(api.renameFood).toHaveBeenCalledWith({
        from: 'Chicken bowl',
        to: 'Chicken rice bowl',
        dryRun: true,
      });
      expect(offer).toEqual({ from: 'Chicken bowl', to: 'Chicken rice bowl', count: 3 });
      expect(store.busy()).toBeNull();
    });

    it('skips silently when nothing else matches, the dry run fails or the name barely changed', async () => {
      await store.load('entry-1');
      api.renameFood.mockResolvedValueOnce(counts(0));
      expect(await store.findRenameOffer('Chicken bowl', 'Chicken rice bowl')).toBeNull();
      api.renameFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
      expect(await store.findRenameOffer('Chicken bowl', 'Chicken rice bowl')).toBeNull();
      expect(await store.findRenameOffer('Chicken bowl', 'chicken  BOWL')).toBeNull();
      expect(await store.findRenameOffer('Chicken bowl', '  ')).toBeNull();
      expect(api.renameFood).toHaveBeenCalledTimes(2);
    });

    it('renames the others and tells the rest of the app', async () => {
      await store.load('entry-1');
      const events = TestBed.inject(DataEventsService);
      const before = events.entries();
      api.renameFood.mockResolvedValueOnce(counts(3, 3));
      const result = await store.renameOthers({ from: 'Chicken bowl', to: 'Rice bowl', count: 3 });
      expect(api.renameFood).toHaveBeenCalledWith({ from: 'Chicken bowl', to: 'Rice bowl' });
      expect(result.renamedEntries).toBe(3);
      expect(events.entries()).toBe(before + 1);
      expect(store.busy()).toBeNull();
    });

    it('does not notify when the rename fails', async () => {
      await store.load('entry-1');
      const events = TestBed.inject(DataEventsService);
      const before = events.entries();
      api.renameFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      await expect(
        store.renameOthers({ from: 'Chicken bowl', to: 'Rice bowl', count: 1 }),
      ).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(events.entries()).toBe(before);
    });

    it('words the question and the result for one or many entries', () => {
      expect(renameOfferTitle({ from: 'Chicken bowl', to: 'Rice bowl', count: 1 })).toBe(
        'Also rename 1 other “Chicken bowl” entry to “Rice bowl”?',
      );
      expect(renameOfferTitle({ from: 'Chicken bowl', to: 'Rice bowl', count: 4 })).toBe(
        'Also rename 4 other “Chicken bowl” entries to “Rice bowl”?',
      );
      expect(renamedOthersMessage(1, 'Rice bowl')).toBe('Renamed 1 other entry to “Rice bowl”');
      expect(renamedOthersMessage(4, 'Rice bowl')).toBe('Renamed 4 other entries to “Rice bowl”');
    });
  });

  describe('renaming what an entry was logged from', () => {
    const YOGURT: ProductDto = {
      id: 'product-1',
      barcode: '5281234567896',
      name: 'Strawberry Yogurt',
      brand: 'Khoury',
      aliases: [],
      unitName: null,
      unitGrams: null,
      basisUnit: 'g',
      per100: { ...zeroNutrients(), calories: 96, protein: 3.5, carbs: 14, sugar: 13, fat: 2.8 },
      microsPer100: null,
      servingSizeG: 150,
      packSizeG: 150,
      source: 'openfoodfacts',
      imageUrl: 'https://images.openfoodfacts.org/yogurt.jpg',
      missingNutrients: ['fiber'],
      useCount: 4,
      lastUsedAt: TIMESTAMP,
    };
    const OATS: FavoriteDto = {
      portion: null,
      id: 'fav-1',
      name: 'Overnight oats',
      mealType: 'breakfast',
      items: [{ name: 'Oats', grams: 60, nutrients: { ...zeroNutrients(), calories: 228 } }],
      totals: { ...zeroNutrients(), calories: 228 },
      photo: null,
      useCount: 3,
      lastUsedAt: TIMESTAMP,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };
    const fromProduct = (name: string): EntryDto =>
      entry({ name, source: 'barcode', productId: 'product-1' });
    const fromFavorite = (name: string): EntryDto =>
      entry({ name, source: 'favorite', favoriteId: 'fav-1' });

    beforeEach(() => {
      api.listProducts.mockResolvedValue([YOGURT]);
      api.upsertProduct.mockImplementation(async (_code, body) => ({
        ...YOGURT,
        ...body,
        brand: body.brand ?? null,
      }));
      api.listFavorites.mockResolvedValue([OATS]);
      api.updateFavorite.mockImplementation(async (_id, body) => ({ ...OATS, ...body }));
    });

    it('shows a product as its brand and name once', () => {
      expect(productDisplayName(YOGURT)).toBe('Khoury Strawberry Yogurt');
      expect(productDisplayName({ name: 'Khoury labneh', brand: 'Khoury' })).toBe('Khoury labneh');
      expect(productDisplayName({ name: 'Labneh', brand: null })).toBe('Labneh');
      expect(brandLeadsName('Khoury yogurt', 'khoury')).toBe(true);
      expect(brandLeadsName('Khourys yogurt', 'Khoury')).toBe(false);
      expect(brandLeadsName('Yogurt', null)).toBe(false);
    });

    it('renames the product, keeping its brand when the new name starts with it', async () => {
      const events = TestBed.inject(DataEventsService);
      const renamed = await store.renameLinkedProduct(
        fromProduct('Khoury yogurt'),
        'Khoury Strawberry Yogurt',
      );
      expect(renamed).toBe(true);
      expect(api.upsertProduct).toHaveBeenCalledWith('5281234567896', {
        name: 'Khoury yogurt',
        brand: 'Khoury',
        basisUnit: 'g',
        per100: YOGURT.per100,
        servingSizeG: 150,
        packSizeG: 150,
        source: 'openfoodfacts',
      });
      expect(events.products()).toBe(1);
      expect(events.entries()).toBe(1);
      expect(store.busy()).toBeNull();
    });

    it('keeps the product’s vitamins per 100 g when renaming it', async () => {
      api.listProducts.mockResolvedValueOnce([
        { ...YOGURT, microsPer100: { calcium: 110, vitaminD: 0.5 } },
      ]);
      await store.renameLinkedProduct(fromProduct('Strawberry yogurt'), 'Khoury Strawberry Yogurt');
      expect(api.upsertProduct.mock.calls[0]![1]).toMatchObject({
        name: 'Strawberry yogurt',
        microsPer100: { calcium: 110, vitaminD: 0.5 },
      });
    });

    it('drops the brand when the new name does not start with it', async () => {
      await store.renameLinkedProduct(fromProduct('Strawberry yogurt'), 'Khoury Strawberry Yogurt');
      expect(api.upsertProduct.mock.calls[0]![1]).toMatchObject({
        name: 'Strawberry yogurt',
        brand: null,
      });
    });

    it('renames a saved food without a barcode through My foods', async () => {
      api.listProducts.mockResolvedValueOnce([{ ...YOGURT, barcode: null }]);
      api.updateMyFood.mockResolvedValueOnce({
        food: { ...YOGURT, barcode: null, name: 'Strawberry yogurt', itemCount: 1 },
        updatedItems: 0,
        updatedEntries: 0,
        updatedFavorites: 0,
      });
      expect(
        await store.renameLinkedProduct(
          fromProduct('Strawberry yogurt'),
          'Khoury Strawberry Yogurt',
        ),
      ).toBe(true);
      expect(api.updateMyFood).toHaveBeenCalledWith('product-1', { name: 'Strawberry yogurt' });
      expect(api.upsertProduct).not.toHaveBeenCalled();
    });

    it('leaves products alone that are not linked, gone or already renamed', async () => {
      expect(
        await store.renameLinkedProduct(entry({ name: 'Yogurt' }), 'Khoury Strawberry Yogurt'),
      ).toBe(false);
      expect(api.listProducts).not.toHaveBeenCalled();
      expect(
        await store.renameLinkedProduct(
          fromProduct('khoury strawberry  YOGURT'),
          'Khoury Strawberry Yogurt',
        ),
      ).toBe(false);
      expect(api.listProducts).not.toHaveBeenCalled();

      api.listProducts.mockResolvedValueOnce([]);
      expect(
        await store.renameLinkedProduct(fromProduct('Yogurt'), 'Khoury Strawberry Yogurt'),
      ).toBe(false);
      api.listProducts.mockResolvedValueOnce([{ ...YOGURT, name: 'Labneh', brand: null }]);
      expect(
        await store.renameLinkedProduct(fromProduct('Yogurt'), 'Khoury Strawberry Yogurt'),
      ).toBe(false);
      expect(api.upsertProduct).not.toHaveBeenCalled();
      expect(TestBed.inject(DataEventsService).products()).toBe(0);
    });

    it('renames the favorite and keeps its meal type and items', async () => {
      const events = TestBed.inject(DataEventsService);
      expect(
        await store.renameLinkedFavorite(fromFavorite('Oats & berries'), 'Overnight oats'),
      ).toBe(true);
      expect(api.updateFavorite).toHaveBeenCalledWith('fav-1', {
        name: 'Oats & berries',
        mealType: 'breakfast',
        items: OATS.items,
        portion: null,
      });
      expect(events.favorites()).toBe(1);
    });

    it('leaves the favorite alone for scaled logs or entries not logged from it', async () => {
      expect(
        await store.renameLinkedFavorite(fromFavorite('Oats & berries'), 'Overnight oats ×2'),
      ).toBe(false);
      expect(await store.renameLinkedFavorite(entry({ name: 'Oats' }), 'Overnight oats')).toBe(
        false,
      );
      api.listFavorites.mockResolvedValueOnce([]);
      expect(await store.renameLinkedFavorite(fromFavorite('Oats'), 'Overnight oats')).toBe(false);
      expect(api.updateFavorite).not.toHaveBeenCalled();
    });
  });
});
