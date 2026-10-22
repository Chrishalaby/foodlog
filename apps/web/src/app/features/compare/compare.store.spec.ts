import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type AnalyzeRequestFields,
  type AnalyzeResponse,
  type BarcodeLookupResponse,
  type CreateEntryRequest,
  type EntryDto,
  type FoodSearchResult,
  type LogProductRequest,
  type MenuDish,
  type MenuScanFields,
  type MenuScanResponse,
  type Nutrients,
  type ProductDto,
  type QuickLogRequest,
} from '@food/shared';
import { ApiService, type AnalyzeImage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { NetworkService } from '../../core/network.service';
import { SessionScope } from '../../core/session-scope';
import { ToastService } from '../../core/toast.service';
import { COMPRESS_PRESETS, type CompressOptions } from '../../shared/utils/image-compress';
import { COMPARE_MAX_AGE_MS, COMPARE_STORAGE_KEY, MAX_OPTIONS } from './compare-model';
import {
  COMPARE_CLOCK,
  COMPARE_COMPRESSOR,
  CompareStore,
  MENU_PHOTOS_MAX,
  NO_DISHES_FOUND,
  NO_FOOD_FOUND,
} from './compare.store';

const NOW = new Date(2026, 8, 30, 19, 45, 0);

function n(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

const DISH: MenuDish = {
  portion: null,
  name: 'Lentil soup',
  description: null,
  grams: 350,
  nutrients: n({ calories: 280, protein: 16 }),
  confidence: 'medium',
  notes: null,
};

const PRODUCT: ProductDto = {
  id: 'prod-1',
  barcode: '5281234567890',
  name: 'Protein bar',
  brand: 'Acme',
  aliases: [],
  unitName: null,
  unitGrams: null,
  basisUnit: 'g',
  per100: n({ calories: 400, protein: 30 }),
  microsPer100: null,
  servingSizeG: 50,
  packSizeG: 50,
  source: 'openfoodfacts',
  imageUrl: null,
  missingNutrients: [],
  useCount: 0,
  lastUsedAt: null,
};

const OATS: FoodSearchResult = {
  portion: null,
  key: 'favorite:fav-1',
  kind: 'favorite',
  name: 'Overnight oats',
  detail: null,
  items: [{ name: 'Oats', grams: 80, nutrients: n({ calories: 300, protein: 10 }) }],
  totals: n({ calories: 300, protein: 10 }),
  grams: 80,
  mealType: 'breakfast',
  photo: null,
  favoriteId: 'fav-1',
  entryId: null,
  productId: null,
  useCount: 2,
  lastUsedAt: null,
  starred: true,
};

function entry(id: string, name: string): EntryDto {
  return {
    portion: null,
    id,
    name,
    description: null,
    mealType: 'dinner',
    source: 'text',
    timestamp: NOW.toISOString(),
    localDate: '2026-09-30',
    items: [],
    totals: n({ calories: 400 }),
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function analysis(items: number, mode: AnalyzeResponse['mode'] = 'food_photo'): AnalyzeResponse {
  const item = {
    name: 'Grilled salmon',
    grams: 180,
    nutrients: n({ calories: 370, protein: 40 }),
    per100g: n({ calories: 205, protein: 22 }),
    micros: null,
    microsPer100g: null,
    fluidMl: null,
    confidence: 'high' as const,
    amountSource: 'visual_estimate' as const,
    state: 'cooked' as const,
    portionBasis: '',
    flags: [],
    savedFood: null,
    suggestedFood: null,
    count: null,
    unit: null,
    unitPlural: null,
  };
  return {
    analysisId: 'an-7',
    mode,
    description: null,
    result: {
      inputType: mode,
      mealName: 'Salmon dinner',
      portion: null,
      scaleCues: '',
      items: Array.from({ length: items }, () => item),
      label: null,
      totals: n({ calories: 370 * items, protein: 40 * items }),
      assumptions: [],
      followUpQuestion: null,
      followUpOptions: [],
      warnings: [],
    },
    photo: {
      id: 'ph-7',
      url: '/api/photos/ph-7',
      thumbUrl: '/api/photos/ph-7/thumb',
      width: 1,
      height: 1,
    },
    photos: [],
    usage: {
      model: 'mock',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      durationMs: 0,
      attempts: 1,
    },
    precise: false,
  };
}

function menuResponse(dishes: MenuDish[]): MenuScanResponse {
  return { restaurant: ' Café Nour ', dishes, warnings: [], usage: analysis(1).usage };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = async (): Promise<void> => {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
  }
};

class FakeApi {
  readonly analyze =
    vi.fn<
      (fields: AnalyzeRequestFields, images?: readonly AnalyzeImage[]) => Promise<AnalyzeResponse>
    >();
  readonly scanMenu =
    vi.fn<(fields: MenuScanFields, images: readonly AnalyzeImage[]) => Promise<MenuScanResponse>>();
  readonly lookupBarcode = vi.fn<(code: string) => Promise<BarcodeLookupResponse>>();
  readonly createEntry = vi.fn(async (body: CreateEntryRequest) => entry('entry-1', body.name));
  readonly quickLog = vi.fn(async (_body: QuickLogRequest) => entry('entry-2', 'Overnight oats'));
  readonly logProduct = vi.fn(async (_id: string, _body: LogProductRequest) =>
    entry('entry-3', 'Acme Protein bar'),
  );
  readonly deleteEntry = vi.fn(async (_id: string) => undefined);
  readonly dayDashboard = vi.fn();
}

describe('CompareStore', () => {
  let api: FakeApi;
  let compress: ReturnType<
    typeof vi.fn<(file: Blob, options: CompressOptions) => Promise<{ blob: Blob }>>
  >;
  let store: CompareStore;
  let clock: number;

  beforeEach(() => {
    sessionStorage.clear();
    clock = NOW.getTime();
    api = new FakeApi();
    compress = vi.fn(async (file: Blob, _options: CompressOptions) => ({ blob: file }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        {
          provide: AuthService,
          useValue: { user: signal({ id: 'user-1' }), isAdmin: signal(false) },
        },
        { provide: COMPARE_CLOCK, useValue: () => new Date(clock) },
        { provide: COMPARE_COMPRESSOR, useValue: compress },
        { provide: NetworkService, useValue: { online: signal(true) } },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    store = TestBed.inject(CompareStore);
  });

  afterEach(() => sessionStorage.clear());

  it('sends a food photo compressed with the food preset', async () => {
    api.analyze.mockResolvedValue(analysis(1));
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    store.addPhoto(photo, 'food_photo');
    await flush();
    expect(compress).toHaveBeenCalledWith(photo, COMPRESS_PRESETS.food_photo);
    expect(api.analyze).toHaveBeenCalledWith(
      { mode: 'food_photo', localTime: '2026-09-30T19:45', mealType: 'dinner' },
      [{ blob: photo, role: 'food' }],
    );
    expect(store.options()[0].name).toBe('Salmon dinner');
  });

  it('sends a label photo as a label image with the label preset', async () => {
    api.analyze.mockResolvedValue(analysis(1, 'nutrition_label'));
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    store.addPhoto(photo, 'nutrition_label');
    await flush();
    expect(compress).toHaveBeenCalledWith(photo, COMPRESS_PRESETS.nutrition_label);
    expect(api.analyze.mock.calls[0][1]).toEqual([{ blob: photo, role: 'label' }]);
    expect(store.options()[0].badge).toBe('Label');
  });

  it('fails an analysis that found no food', async () => {
    api.analyze.mockResolvedValue(analysis(0));
    store.describe('a glass of water');
    await flush();
    const slot = store.slots()[0];
    expect(slot.status === 'failed' && slot.failure).toEqual(NO_FOOD_FOUND);
  });

  it('shows a budget error from the server as not retryable', async () => {
    api.analyze.mockRejectedValue(
      new HttpErrorResponse({
        status: 429,
        error: { statusCode: 429, message: 'Your monthly AI budget is used up' },
      }),
    );
    store.describe('pizza');
    await flush();
    const slot = store.slots()[0];
    expect(slot.status).toBe('failed');
    expect(slot.status === 'failed' && slot.failure.retryable).toBe(false);
    expect(slot.status === 'failed' && slot.failure.title).toBe(
      "You've used this month's AI budget",
    );
  });

  it('ignores a late result for an option that was removed', async () => {
    const pending = deferred<AnalyzeResponse>();
    api.analyze.mockReturnValue(pending.promise);
    store.describe('pizza');
    const id = store.slots()[0].id;
    store.remove(id);
    pending.resolve(analysis(1));
    await flush();
    expect(store.slots()).toEqual([]);
  });

  it('never holds more than four options', async () => {
    api.analyze.mockReturnValue(new Promise(() => undefined));
    for (let index = 0; index < MAX_OPTIONS; index++) {
      expect(store.describe(`option ${index}`)).toBe(true);
    }
    expect(store.describe('one too many')).toBe(false);
    expect(store.addFromLibrary(OATS)).toBe(false);
    expect(store.lookupBarcode('5281234567890')).toBe(false);
    expect(store.freeSlots()).toBe(0);
  });

  it('adds a product found on Open Food Facts and refreshes products', async () => {
    api.lookupBarcode.mockResolvedValue({
      barcode: PRODUCT.barcode!,
      source: 'openfoodfacts',
      product: PRODUCT,
    });
    const events = TestBed.inject(DataEventsService);
    const before = events.products();
    store.lookupBarcode(PRODUCT.barcode!);
    await flush();
    expect(events.products()).toBe(before + 1);
    expect(store.options()[0].name).toBe('Acme Protein bar');
  });

  it('treats a 404 barcode lookup as not found', async () => {
    api.lookupBarcode.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
    store.lookupBarcode('5281234567890');
    await flush();
    const slot = store.slots()[0];
    expect(slot.status === 'failed' && slot.failure.labelScan).toBe(true);
  });

  it('turns a failed barcode into a label scan in the same slot', async () => {
    api.lookupBarcode.mockResolvedValue({ barcode: '5281234567890', source: null, product: null });
    api.analyze.mockResolvedValue(analysis(1, 'nutrition_label'));
    store.lookupBarcode('5281234567890');
    await flush();
    const id = store.slots()[0].id;
    store.addPhoto(new Blob(['x']), 'nutrition_label', id);
    await flush();
    expect(store.slots()).toHaveLength(1);
    expect(store.slots()[0]).toMatchObject({ id, status: 'ready' });
  });

  it('logs an analysed option with its analysis and photo', async () => {
    api.analyze.mockResolvedValue(analysis(2));
    store.addPhoto(new Blob(['x']), 'food_photo');
    await flush();
    const option = store.options()[0];
    store.setPortion(option.id, { mode: 'servings', servings: 0.5 });
    await store.log(option.id);
    expect(api.createEntry).toHaveBeenCalledWith({
      name: 'Salmon dinner',
      description: null,
      mealType: 'dinner',
      source: 'food_photo',
      timestamp: NOW.toISOString(),
      localDate: '2026-09-30',
      items: [
        {
          name: 'Grilled salmon',
          grams: 90,
          nutrients: n({ calories: 185, protein: 20 }),
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
        },
        {
          name: 'Grilled salmon',
          grams: 90,
          nutrients: n({ calories: 185, protein: 20 }),
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
        },
      ],
      analysisId: 'an-7',
      photoId: 'ph-7',
    });
  });

  it('logs a scanned product with servings through the product log', async () => {
    api.lookupBarcode.mockResolvedValue({
      barcode: PRODUCT.barcode!,
      source: 'library',
      product: PRODUCT,
    });
    store.lookupBarcode(PRODUCT.barcode!);
    await flush();
    const events = TestBed.inject(DataEventsService);
    const products = events.products();
    await store.log(store.options()[0].id);
    expect(api.logProduct).toHaveBeenCalledWith('prod-1', {
      servings: 1,
      timestamp: NOW.toISOString(),
      localDate: '2026-09-30',
      mealType: 'dinner',
    });
    expect(events.products()).toBe(products + 1);
  });

  it("logs a favorite at the favorite's meal", async () => {
    store.addFromLibrary(OATS);
    await store.log(store.options()[0].id);
    expect(api.quickLog).toHaveBeenCalledWith({
      key: 'favorite:fav-1',
      servings: 1,
      timestamp: NOW.toISOString(),
      localDate: '2026-09-30',
      mealType: 'breakfast',
    });
  });

  it('files what is logged after midnight under the day the user is still awake in', async () => {
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
    const lateNight = new Date(2026, 9, 1, 0, 56, 0);
    clock = lateNight.getTime();
    api.dayDashboard.mockResolvedValue({ day: null });
    await store.loadDay();
    expect(api.dayDashboard).toHaveBeenCalledWith('2026-09-30');

    store.addFromLibrary(OATS);
    await store.log(store.options()[0].id);
    expect(api.quickLog).toHaveBeenCalledWith({
      key: 'favorite:fav-1',
      servings: 1,
      timestamp: lateNight.toISOString(),
      localDate: '2026-09-30',
      mealType: 'breakfast',
    });
  });

  it('logs a counted library meal by how many units were picked', async () => {
    store.addFromLibrary({
      ...OATS,
      key: 'meal:entry-5',
      kind: 'meal',
      favoriteId: null,
      starred: false,
      portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
    });
    const id = store.options()[0].id;
    store.setPortion(id, { mode: 'count', count: 1.5 });
    await store.log(id);
    expect(api.quickLog).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'meal:entry-5', portionCount: 1.5 }),
    );
    expect(api.quickLog.mock.calls[0]![0].servings).toBeUndefined();
  });

  it('explains when a library food is gone and keeps the option', async () => {
    api.quickLog.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
    store.addFromLibrary(OATS);
    expect(await store.log(store.options()[0].id)).toBeNull();
    expect(TestBed.inject(ToastService).toasts()[0].message).toBe(
      'Overnight oats is no longer in your library.',
    );
    expect(store.options()[0].loggedEntryId).toBeNull();
  });

  it('logs one option at a time', async () => {
    const pending = deferred<EntryDto>();
    api.quickLog.mockReturnValue(pending.promise);
    store.addFromLibrary(OATS);
    store.addFromLibrary({ ...OATS, key: 'favorite:fav-2', favoriteId: 'fav-2' });
    const [first, second] = store.options();
    const running = store.log(first.id);
    expect(await store.log(second.id)).toBeNull();
    pending.resolve(entry('entry-2', 'Overnight oats'));
    await running;
    expect(api.quickLog).toHaveBeenCalledTimes(1);
  });

  it('keeps at most three menu photos', () => {
    const skipped = store.addMenuPhotos([
      new Blob(['1']),
      new Blob(['2']),
      new Blob(['3']),
      new Blob(['4']),
    ]);
    expect(skipped).toBe(1);
    expect(store.menu().photos).toHaveLength(MENU_PHOTOS_MAX);
    store.removeMenuPhoto(store.menu().photos[0].id);
    expect(store.menu().photos).toHaveLength(2);
  });

  it('remembers a scanned menu and tidies the restaurant name', async () => {
    api.scanMenu.mockResolvedValue(menuResponse([DISH, { ...DISH, name: '   ' }]));
    store.addMenuPhotos([new Blob(['menu'])]);
    expect(await store.scanMenu('  big   portions ')).toBe(true);
    expect(api.scanMenu.mock.calls[0][0]).toEqual({ description: 'big portions' });
    expect(compress.mock.calls[0][1]).toEqual(COMPRESS_PRESETS.menu);
    expect(store.lastMenu()).toMatchObject({ restaurant: 'Café Nour', dishes: [DISH] });
    expect(store.menuReady()).toBe(true);
    expect(store.menu()).toEqual({ status: 'idle', photos: [] });
    expect(store.addDishes([DISH])).toBe(1);
    expect(store.menuReady()).toBe(false);
    expect(store.options()[0].detail).toBe('Café Nour');
  });

  it('keeps the photos for another try when no dishes are found', async () => {
    api.scanMenu
      .mockResolvedValueOnce(menuResponse([]))
      .mockResolvedValueOnce(menuResponse([DISH]));
    store.addMenuPhotos([new Blob(['menu'])]);
    expect(await store.scanMenu()).toBe(false);
    const failed = store.menu();
    expect(failed.status === 'failed' && failed.failure).toEqual(NO_DISHES_FOUND);
    expect(failed.photos).toHaveLength(1);
    expect(await store.scanMenu()).toBe(true);
  });

  it('drops a menu result that arrives after cancelling', async () => {
    const pending = deferred<MenuScanResponse>();
    api.scanMenu.mockReturnValue(pending.promise);
    store.addMenuPhotos([new Blob(['menu'])]);
    const scan = store.scanMenu();
    await flush();
    expect(store.menu().status).toBe('scanning');
    store.cancelMenuScan();
    pending.resolve(menuResponse([DISH]));
    expect(await scan).toBe(false);
    expect(store.lastMenu()).toBeNull();
    expect(store.menu()).toMatchObject({ status: 'idle' });
  });

  it('still logs an analysed option when its analysis is gone from the server', async () => {
    api.analyze.mockResolvedValue(analysis(1));
    api.createEntry
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }))
      .mockResolvedValueOnce(entry('entry-9', 'Salmon dinner'));
    store.addPhoto(new Blob(['x']), 'food_photo');
    await flush();
    const option = store.options()[0];
    expect(await store.log(option.id)).toMatchObject({ id: 'entry-9' });
    expect(api.createEntry).toHaveBeenCalledTimes(2);
    expect(api.createEntry.mock.calls[0][0]).toMatchObject({
      analysisId: 'an-7',
      photoId: 'ph-7',
    });
    expect(api.createEntry.mock.calls[1][0]).toMatchObject({
      name: 'Salmon dinner',
      analysisId: null,
      photoId: null,
    });
    expect(store.options()[0].loggedEntryId).toBe('entry-9');
  });

  it('does not retry a menu dish or a failed save without an analysis', async () => {
    api.createEntry.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
    store.addDishes([DISH]);
    expect(await store.log(store.options()[0].id)).toBeNull();
    expect(api.createEntry).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the session ends while an option is being logged', async () => {
    const pending = deferred<EntryDto>();
    api.quickLog.mockReturnValue(pending.promise);
    const navigate = vi.mocked(TestBed.inject(Router).navigateByUrl);
    store.addFromLibrary(OATS);
    const running = store.log(store.options()[0].id);
    TestBed.inject(SessionScope).reset();
    pending.resolve(entry('entry-2', 'Overnight oats'));
    expect(await running).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(TestBed.inject(ToastService).toasts()).toHaveLength(0);
    expect(store.options()).toHaveLength(0);
    expect(store.loggingId()).toBeNull();
  });

  it('forgets a comparison that has not been touched for half a day', () => {
    store.addFromLibrary(OATS);
    clock += COMPARE_MAX_AGE_MS - 1000;
    expect(store.expireStale()).toBe(false);
    expect(store.options()).toHaveLength(1);
    store.setPortion(store.options()[0].id, { mode: 'servings', servings: 2 });
    clock += COMPARE_MAX_AGE_MS - 1000;
    expect(store.expireStale()).toBe(false);
    clock += 2000;
    expect(store.expireStale()).toBe(true);
    expect(store.slots()).toHaveLength(0);
    expect(store.lastMenu()).toBeNull();
    expect(sessionStorage.getItem(COMPARE_STORAGE_KEY)).toBeNull();
    expect(store.expireStale()).toBe(false);
  });

  it('keeps an old comparison while an option is still being estimated', () => {
    api.analyze.mockReturnValue(new Promise<AnalyzeResponse>(() => undefined));
    store.describe('pizza');
    clock += COMPARE_MAX_AGE_MS + 1000;
    expect(store.expireStale()).toBe(false);
    expect(store.slots()).toHaveLength(1);
  });
});
