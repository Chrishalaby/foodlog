import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  zeroNutrients,
  type AnalysisItem,
  type AnalyzeRequestFields,
  type AnalyzeResponse,
  type CreateEntryRequest,
  type EntryDto,
  type LabelInfo,
  type LogProductRequest,
  type PhotoRef,
  type ProductDto,
  type UpsertProductRequest,
} from '@food/shared';
import { ApiService, type AnalyzeImage } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { NetworkService } from '../../core/network.service';
import { SessionScope } from '../../core/session-scope';
import {
  COMPRESS_PRESETS,
  ImageDecodeError,
  type CompressOptions,
  type CompressedImage,
} from '../../shared/utils/image-compress';
import { AuthService } from '../../core/auth.service';
import { createDraftItem } from '../../shared/ui/items-editor/items-math';
import { currentDateTimeInput } from './entry-timing';
import {
  IMAGE_COMPRESSOR,
  LogStore,
  PHOTO_TIME_READER,
  mealNeedsLook,
  type PhotoTimeReader,
} from './log.store';

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

function item(overrides: Partial<AnalysisItem> = {}): AnalysisItem {
  return {
    count: null,
    unit: null,
    unitPlural: null,
    name: 'Cooked rice',
    grams: 150,
    nutrients: { ...zeroNutrients(), calories: 195, protein: 4.1, carbs: 42.3, fat: 0.5 },
    per100g: { ...zeroNutrients(), calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3 },
    micros: null,
    microsPer100g: null,
    fluidMl: null,
    confidence: 'medium',
    amountSource: 'visual_estimate',
    state: 'cooked',
    portionBasis: 'About one cup',
    flags: [],
    savedFood: null,
    suggestedFood: null,
    ...overrides,
  };
}

const PHOTO_1: PhotoRef = {
  id: 'photo-1',
  url: '/api/photos/photo-1',
  thumbUrl: '/api/photos/photo-1/thumb',
  width: 1024,
  height: 768,
};

const LABEL: LabelInfo = {
  productName: 'Granola',
  basisUnit: 'g',
  per100: { ...zeroNutrients(), calories: 450, protein: 10, carbs: 60, fat: 18 },
  microsPer100: null,
  servingSize: 40,
  servingText: '40 g',
  packSize: 500,
};

function response(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    analysisId: 'analysis-1',
    mode: 'food_photo',
    description: 'rice bowl',
    result: {
      portion: null,
      inputType: 'food_photo',
      mealName: 'Rice bowl',
      scaleCues: 'Fork for scale',
      items: [item()],
      label: null,
      totals: zeroNutrients(),
      assumptions: ['No added oil'],
      followUpQuestion: 'Was there sauce?',
      followUpOptions: ['Yes', 'No'],
      warnings: [],
    },
    photo: PHOTO_1,
    photos: [{ photo: PHOTO_1, role: 'food' }],
    usage: {
      model: 'mock',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      durationMs: 1200,
      attempts: 1,
    },
    precise: false,
    ...overrides,
  };
}

function entryFrom(body: CreateEntryRequest): EntryDto {
  return {
    portion: null,
    id: 'entry-1',
    name: body.name,
    description: body.description ?? null,
    mealType: body.mealType,
    source: body.source,
    timestamp: body.timestamp,
    localDate: body.localDate,
    items: [],
    totals: zeroNutrients(),
    photo: null,
    photos: [],
    analysisId: body.analysisId ?? null,
    favoriteId: null,
    productId: null,
    createdAt: body.timestamp,
    updatedAt: body.timestamp,
  };
}

function compressed(blob: Blob): CompressedImage {
  return {
    blob,
    mimeType: 'image/jpeg',
    width: 10,
    height: 10,
    sourceWidth: 10,
    sourceHeight: 10,
    sourceBytes: 1,
    bytes: 1,
    decoder: 'image-bitmap',
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('LogStore', () => {
  let store: LogStore;
  let online: ReturnType<typeof signal<boolean>>;
  let compressor: ReturnType<
    typeof vi.fn<(file: Blob, options: CompressOptions) => Promise<CompressedImage>>
  >;
  let photoReader: ReturnType<typeof vi.fn<PhotoTimeReader>>;
  const compressedBlob = new Blob(['jpeg'], { type: 'image/jpeg' });
  const api = {
    analyze:
      vi.fn<
        (fields: AnalyzeRequestFields, images?: readonly AnalyzeImage[]) => Promise<AnalyzeResponse>
      >(),
    createEntry: vi.fn<(body: CreateEntryRequest) => Promise<EntryDto>>(),
    createFavoriteFromEntry: vi.fn(),
    getProfile: vi.fn(),
    upsertProduct: vi.fn<(code: string, body: UpsertProductRequest) => Promise<ProductDto>>(),
    logProduct: vi.fn<(id: string, body: LogProductRequest) => Promise<EntryDto>>(),
  };
  const auth = { isAdmin: signal(false) };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getProfile.mockRejectedValue(new Error('no profile'));
    api.createEntry.mockImplementation(async (body) => entryFrom(body));
    api.createFavoriteFromEntry.mockImplementation(
      async (_id: string, body: { name?: string }) => ({
        id: 'fav-1',
        name: body.name ?? 'Rice bowl',
      }),
    );
    api.upsertProduct.mockImplementation(async (code, body) => ({
      id: 'product-1',
      barcode: code,
      name: body.name,
      brand: body.brand ?? null,
      aliases: [],
      unitName: null,
      unitGrams: null,
      basisUnit: body.basisUnit,
      per100: body.per100,
      microsPer100: body.microsPer100 ?? null,
      servingSizeG: body.servingSizeG ?? null,
      packSizeG: body.packSizeG ?? null,
      source: body.source,
      imageUrl: null,
      missingNutrients: [],
      useCount: 0,
      lastUsedAt: null,
    }));
    api.logProduct.mockImplementation(async (id, body) => ({
      ...entryFrom({ ...body, name: 'Granola', source: 'barcode', items: [] }),
      id: 'entry-from-product',
      productId: id,
    }));
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    online = signal(true);
    compressor = vi.fn(async () => compressed(compressedBlob));
    photoReader = vi.fn<PhotoTimeReader>(async () => null);
    auth.isAdmin.set(false);
    TestBed.configureTestingModule({
      providers: [
        LogStore,
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: NetworkService, useValue: { online } },
        { provide: IMAGE_COMPRESSOR, useValue: compressor },
        { provide: PHOTO_TIME_READER, useValue: photoReader },
      ],
    });
    store = TestBed.inject(LogStore);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  const photo = (): File => new File(['raw'], 'meal.heic', { type: 'image/jpeg' });

  async function reachReview(result: AnalyzeResponse = response()): Promise<void> {
    api.analyze.mockResolvedValueOnce(result);
    store.start({ file: photo(), mode: result.mode, source: 'camera' });
    store.description.set('rice bowl');
    await store.analyze();
  }

  it('starts composing a photo capture and compresses it right away with the mode preset', () => {
    store.start({ file: photo(), mode: 'nutrition_label', source: 'library' });
    expect(store.phase()).toBe('compose');
    expect(store.previewUrl()).toBe('blob:preview');
    expect(store.canAnalyze()).toBe(true);
    expect(compressor).toHaveBeenCalledWith(expect.any(File), COMPRESS_PRESETS.nutrition_label);

    store.setMode('food_photo');
    expect(compressor).toHaveBeenLastCalledWith(expect.any(File), COMPRESS_PRESETS.food_photo);
  });

  it('requires a description in text mode', async () => {
    store.start({ file: null, mode: 'text', source: 'text' });
    expect(store.canAnalyze()).toBe(false);
    await store.analyze();
    expect(api.analyze).not.toHaveBeenCalled();
    store.description.set('two eggs');
    expect(store.canAnalyze()).toBe(true);
  });

  it('analyzes the compressed photo and seeds the review from the result', async () => {
    const pending = deferred<AnalyzeResponse>();
    api.analyze.mockReturnValueOnce(pending.promise);
    store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
    store.description.set('  rice bowl, no oil ');
    store.precise.set(true);

    const run = store.analyze();
    expect(store.phase()).toBe('analyzing');
    await flush();
    const [fields, images] = api.analyze.mock.calls[0]!;
    expect(images).toEqual([{ blob: compressedBlob, role: 'food' }]);
    expect(fields).toMatchObject({
      mode: 'food_photo',
      description: 'rice bowl, no oil',
      precise: 'true',
    });
    expect(fields.localTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fields.mealType).toBeDefined();

    pending.resolve(response({ precise: true }));
    await run;
    expect(store.phase()).toBe('review');
    expect(store.name()).toBe('Rice bowl');
    expect(store.items()).toHaveLength(1);
    expect(store.items()[0]).toMatchObject({ name: 'Cooked rice', grams: 150 });
    expect(store.items()[0]?.nutrients.calories).toBe(195);
    expect(store.source()).toBe('food_photo');
    expect(store.edited()).toBe(false);
    expect(store.hasUnsavedWork()).toBe(true);
    expect(store.canRecheckPrecise()).toBe(false);
  });

  it('cancels back to compose and ignores the late result', async () => {
    const pending = deferred<AnalyzeResponse>();
    api.analyze.mockReturnValueOnce(pending.promise);
    store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
    store.description.set('pasta');
    const run = store.analyze();
    await flush();

    store.cancelAnalysis();
    expect(store.phase()).toBe('compose');
    pending.resolve(response());
    await run;
    expect(store.phase()).toBe('compose');
    expect(store.analysis()).toBeNull();
    expect(store.description()).toBe('pasta');
    expect(store.file()).not.toBeNull();
  });

  it('returns to compose with a friendly failure and retries with the kept photo', async () => {
    api.analyze.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 503,
        error: { statusCode: 503, message: 'AI is not configured' },
      }),
    );
    store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
    await store.analyze();
    expect(store.phase()).toBe('compose');
    expect(store.error()?.kind).toBe('not_configured');

    api.analyze.mockRejectedValueOnce(new HttpErrorResponse({ status: 504 }));
    await store.retry();
    expect(store.error()).toMatchObject({ kind: 'ai_failed', retryable: true });

    api.analyze.mockResolvedValueOnce(response());
    await store.retry();
    expect(store.phase()).toBe('review');
    expect(store.error()).toBeNull();
    expect(api.analyze).toHaveBeenCalledTimes(3);
    expect(api.analyze.mock.calls.every(([, images]) => images?.[0]?.blob === compressedBlob)).toBe(
      true,
    );
  });

  it('fails fast while offline without calling the API', async () => {
    online.set(false);
    store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
    await store.analyze();
    expect(api.analyze).not.toHaveBeenCalled();
    expect(store.phase()).toBe('compose');
    expect(store.error()?.kind).toBe('offline');
  });

  it('shows an unreadable-photo error as soon as compression fails', async () => {
    compressor.mockRejectedValueOnce(new ImageDecodeError(new Blob(), new Error('heic')));
    store.start({ file: photo(), mode: 'food_photo', source: 'library' });
    await flush();
    expect(store.error()?.kind).toBe('unreadable_image');
  });

  it('sends the API local time format the server validates (YYYY-MM-DDTHH:mm)', async () => {
    store.start({ file: null, mode: 'text', source: 'text' });
    store.description.set('two eggs');
    api.analyze.mockResolvedValueOnce(response({ mode: 'text', photo: null }));
    const before = new Date();
    await store.analyze();
    const after = new Date();
    const { localTime } = api.analyze.mock.calls[0]![0];
    const sent = new Date(`${localTime}:00`);
    expect(localTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(sent.getTime()).toBeGreaterThanOrEqual(before.getTime() - 60_000);
    expect(sent.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('retries a failed compression instead of reusing the rejected result', async () => {
    compressor.mockRejectedValueOnce(new Error('canvas lost'));
    store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
    await flush();
    expect(store.error()).toMatchObject({ kind: 'unknown', retryable: true });

    api.analyze.mockResolvedValueOnce(response());
    await store.retry();
    expect(compressor).toHaveBeenCalledTimes(2);
    expect(api.analyze).toHaveBeenCalledWith(expect.anything(), [
      { blob: compressedBlob, role: 'food' },
    ]);
    expect(store.phase()).toBe('review');
  });

  it('maps saving and saved to the review view so the page does not swap panels', async () => {
    await reachReview();
    const pending = deferred<EntryDto>();
    api.createEntry.mockReturnValueOnce(pending.promise);
    const saving = store.save();
    expect(store.phase()).toBe('saving');
    expect(store.view()).toBe('review');
    pending.resolve(
      entryFrom({
        name: 'Rice bowl',
        mealType: 'lunch',
        source: 'food_photo',
        timestamp: '2026-09-28T12:00:00.000Z',
        localDate: '2026-09-28',
        items: [],
      }),
    );
    await saving;
    expect(store.phase()).toBe('saved');
    expect(store.view()).toBe('review');
  });

  it('keeps the description when a new photo arrives while composing', () => {
    store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
    store.description.set('burger');
    store.precise.set(true);
    store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
    expect(store.description()).toBe('burger');
    expect(store.precise()).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('re-runs a follow-up answer against the previous analysis without re-uploading', async () => {
    await reachReview();
    store.name.set('My rice');
    store.pickMealType('dinner');
    store.dateTime.set('2026-09-27T19:40');
    const dateTime = store.dateTime();

    api.analyze.mockResolvedValueOnce(
      response({
        analysisId: 'analysis-2',
        result: {
          ...response().result,
          mealName: 'Rice with sauce',
          items: [item({ grams: 200 })],
        },
      }),
    );
    await store.answerFollowUp('Yes, teriyaki');

    const [fields, images] = api.analyze.mock.calls[1]!;
    expect(images).toEqual([]);
    expect(fields).toMatchObject({
      mode: 'food_photo',
      previousAnalysisId: 'analysis-1',
      followUpAnswer: 'Yes, teriyaki',
      mealType: 'dinner',
      localTime: '2026-09-27T19:40',
    });
    expect(store.items()[0]?.grams).toBe(200);
    expect(store.name()).toBe('My rice');
    expect(store.mealType()).toBe('dinner');
    expect(store.dateTime()).toBe(dateTime);
    expect(store.analysis()?.analysisId).toBe('analysis-2');
  });

  it('takes the new meal name on re-runs when the user kept the suggested one', async () => {
    await reachReview();
    api.analyze.mockResolvedValueOnce(
      response({ precise: true, result: { ...response().result, mealName: 'Rice & beans' } }),
    );
    await store.recheckPrecise();
    expect(api.analyze.mock.calls[1]?.[0]).toMatchObject({
      precise: 'true',
      previousAnalysisId: 'analysis-1',
    });
    expect(store.name()).toBe('Rice & beans');
    expect(store.precise()).toBe(true);
    expect(store.canRecheckPrecise()).toBe(false);
  });

  describe('re-checking with the precise model', () => {
    function aiConfigWith(activeModel: string) {
      return {
        ai: {
          provider: 'openai',
          defaultModel: 'gpt-5.6-sol',
          preciseModel: 'gpt-6-astra',
          activeModel,
          reasoningEffort: 'low',
          availableModels: [],
          monthlyBudgetUsd: null,
        },
      };
    }

    const usageOf = (model: string): AnalyzeResponse['usage'] => ({
      ...response().usage,
      model,
    });

    it('is not offered when the estimate already came from the precise model', async () => {
      api.getProfile.mockResolvedValue(aiConfigWith('gpt-6-astra'));
      await reachReview(response({ usage: usageOf('gpt-6-astra') }));
      await flush();
      expect(store.aiConfig()?.preciseModel).toBe('gpt-6-astra');
      expect(store.canRecheckPrecise()).toBe(false);
      await store.recheckPrecise();
      expect(api.analyze).toHaveBeenCalledTimes(1);
    });

    it('is offered when the estimate came from another model', async () => {
      api.getProfile.mockResolvedValue(aiConfigWith('gpt-5.6-sol'));
      await reachReview(response({ usage: usageOf('gpt-5.6-sol') }));
      await flush();
      expect(store.canRecheckPrecise()).toBe(true);
      api.analyze.mockResolvedValueOnce(response({ precise: true, usage: usageOf('gpt-6-astra') }));
      await store.recheckPrecise();
      expect(api.analyze.mock.calls[1]?.[0]).toMatchObject({ precise: 'true' });
      expect(store.canRecheckPrecise()).toBe(false);
    });
  });

  describe('AI budget errors', () => {
    const budgetError = (message: string): HttpErrorResponse =>
      new HttpErrorResponse({ status: 429, error: { statusCode: 429, message } });

    it('never shows server settings to a member who used up their budget', async () => {
      api.analyze.mockRejectedValueOnce(budgetError('Your monthly AI budget is used up'));
      store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
      await store.analyze();
      expect(store.phase()).toBe('compose');
      expect(store.error()).toMatchObject({ kind: 'budget', retryable: false });
      expect(store.error()?.message).toContain('Ask your admin');
      expect(store.error()?.message).not.toContain('AI_MONTHLY_BUDGET_USD');
    });

    it('names the server setting for an admin who hit the app-wide cap', async () => {
      auth.isAdmin.set(true);
      api.analyze.mockRejectedValueOnce(budgetError('Monthly AI budget reached'));
      store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
      await store.analyze();
      expect(store.error()?.message).toContain('AI_MONTHLY_BUDGET_USD');

      auth.isAdmin.set(false);
      api.analyze.mockRejectedValueOnce(budgetError('Monthly AI budget reached'));
      await store.retry();
      expect(store.error()?.kind).toBe('budget');
      expect(store.error()?.message).not.toContain('AI_MONTHLY_BUDGET_USD');
    });
  });

  it('returns to review with the answer kept when a follow-up fails', async () => {
    await reachReview();
    api.analyze.mockRejectedValueOnce(new HttpErrorResponse({ status: 502 }));
    await store.answerFollowUp('No sauce');
    expect(store.phase()).toBe('review');
    expect(store.followUpAnswer()).toBe('No sauce');
    expect(store.error()?.kind).toBe('ai_failed');
    expect(store.items()[0]?.name).toBe('Cooked rice');
  });

  it('applies label portions from the per-100 g values', async () => {
    await reachReview(
      response({
        mode: 'nutrition_label',
        result: {
          ...response().result,
          inputType: 'nutrition_label',
          label: LABEL,
          items: [
            item({
              name: 'Granola',
              grams: 40,
              amountSource: 'label',
              nutrients: { ...zeroNutrients(), calories: 180, protein: 4, carbs: 24, fat: 7.2 },
              per100g: LABEL.per100,
            }),
          ],
        },
      }),
    );
    expect(store.labelItem()?.name).toBe('Granola');
    store.applyLabelAmount(60);
    expect(store.labelItem()?.grams).toBe(60);
    expect(store.labelItem()?.nutrients).toMatchObject({ calories: 270, protein: 6, fat: 10.8 });
    expect(store.edited()).toBe(true);
  });

  it('turns a label without a barcode into a saved food and links its item', async () => {
    await reachReview(
      response({
        mode: 'nutrition_label',
        result: {
          ...response().result,
          inputType: 'nutrition_label',
          label: LABEL,
          items: [
            item({
              name: 'Granola',
              grams: 40,
              amountSource: 'label',
              nutrients: { ...zeroNutrients(), calories: 180, protein: 4, carbs: 24, fat: 7.2 },
              per100g: LABEL.per100,
            }),
          ],
        },
      }),
    );
    expect(store.labelFoodRequest()).toEqual({
      name: 'Granola',
      brand: null,
      basisUnit: 'g',
      per100: LABEL.per100,
      servingSizeG: 40,
      packSizeG: 500,
      source: 'label',
    });
    store.linkLabelItem({
      id: 'food-granola',
      name: 'Crunchy granola',
      brand: null,
      basisUnit: 'g',
      per100: LABEL.per100,
      microsPer100: null,
      unitName: null,
      unitGrams: null,
    });
    expect(store.labelItem()).toMatchObject({
      name: 'Crunchy granola',
      productId: 'food-granola',
      grams: 40,
    });
    store.applyLabelAmount(60);
    expect(store.labelItem()?.productId).toBe('food-granola');
    await store.save();
    expect(api.createEntry.mock.calls[0]![0].items[0]).toMatchObject({
      name: 'Crunchy granola',
      productId: 'food-granola',
      grams: 60,
    });
  });

  it('keeps saved-food links from the analysis when saving', async () => {
    const saved = {
      id: 'food-rice',
      name: 'Basmati rice, cooked',
      brand: null,
      basisUnit: 'g' as const,
      per100: { ...zeroNutrients(), calories: 130, carbs: 28 },
      microsPer100: null,
      unitName: null,
      unitGrams: null,
    };
    await reachReview(
      response({
        result: {
          ...response().result,
          items: [item({ name: 'Basmati rice, cooked', savedFood: saved })],
        },
      }),
    );
    expect(store.labelFoodRequest()).toBeNull();
    await store.save();
    expect(api.createEntry.mock.calls[0]![0].items[0]).toMatchObject({
      name: 'Basmati rice, cooked',
      productId: 'food-rice',
    });
  });

  it('saves the reviewed meal with timing, source, analysis and photo, then a favorite', async () => {
    await reachReview();
    store.dateTime.set('2026-09-27T20:15');
    store.saveAsFavorite.set(true);
    store.favoriteName.set('Weeknight rice');

    const outcome = await store.save();
    const body = api.createEntry.mock.calls[0]![0];
    expect(body).toMatchObject({
      name: 'Rice bowl',
      description: 'rice bowl',
      source: 'food_photo',
      localDate: '2026-09-27',
      timestamp: new Date(2026, 8, 27, 20, 15).toISOString(),
      analysisId: 'analysis-1',
      photoId: 'photo-1',
    });
    expect(body.items[0]).toMatchObject({ name: 'Cooked rice', grams: 150, confidence: 'medium' });
    expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-1', { name: 'Weeknight rice' });
    expect(outcome).toMatchObject({
      coverFailed: false,
      favoriteFailed: false,
      favoriteName: 'Weeknight rice',
      current: true,
    });
    expect(store.phase()).toBe('saved');
    expect(store.hasUnsavedWork()).toBe(false);
  });

  it('reports a failed favorite without failing the save', async () => {
    await reachReview();
    store.saveAsFavorite.set(true);
    api.createFavoriteFromEntry.mockRejectedValueOnce(new Error('nope'));
    const outcome = await store.save();
    expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-1', {});
    expect(outcome?.favoriteFailed).toBe(true);
    expect(outcome?.favoriteName).toBeNull();
  });

  it('reports no favorite name when the meal is not starred', async () => {
    await reachReview();
    const outcome = await store.save();
    expect(api.createFavoriteFromEntry).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ favoriteFailed: false, favoriteName: null });
  });

  it('blocks saving with inline validation until the items are valid', async () => {
    await reachReview();
    store.items.update((items) => items.map((draft) => ({ ...draft, name: ' ' })));
    expect(store.visibleValidationError()).toBeNull();
    expect(await store.save()).toBeNull();
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(store.visibleValidationError()).toBe('Item 1 needs a name.');
    expect(store.phase()).toBe('review');
  });

  it('goes back to review with the server message when saving fails', async () => {
    await reachReview();
    api.createEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    expect(await store.save()).toBeNull();
    expect(store.phase()).toBe('review');
    expect(store.saveError()).toContain('offline');
  });

  it('logs a manual meal without AI and derives the name from the items', async () => {
    store.startManual();
    expect(store.phase()).toBe('review');
    expect(store.items()).toHaveLength(1);
    expect(store.hasUnsavedWork()).toBe(false);
    store.items.update(([first]) => [{ ...first!, name: 'Banana' }]);
    expect(store.hasUnsavedWork()).toBe(true);

    await store.save();
    expect(api.createEntry.mock.calls[0]![0]).toMatchObject({
      name: 'Banana',
      source: 'manual',
      analysisId: null,
      photoId: null,
      description: null,
    });
  });

  it('discards everything and releases the preview', async () => {
    await reachReview();
    store.discard();
    expect(store.phase()).toBe('idle');
    expect(store.analysis()).toBeNull();
    expect(store.items()).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('drops the draft when the signed-in account changes', async () => {
    await reachReview();
    store.name.set('Edited name');
    TestBed.inject(SessionScope).reset();
    expect(store.phase()).toBe('idle');
    expect(store.hasUnsavedWork()).toBe(false);
    expect(store.name()).toBe('');
    expect(store.analysis()).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('does not treat a save as current after a new capture replaced the session', async () => {
    await reachReview();
    const pending = deferred<EntryDto>();
    api.createEntry.mockReturnValueOnce(pending.promise);
    const saving = store.save();
    expect(store.phase()).toBe('saving');
    store.start({ file: null, mode: 'text', source: 'text' });
    pending.resolve(
      entryFrom({
        name: 'Rice bowl',
        mealType: 'lunch',
        source: 'food_photo',
        timestamp: '2026-09-28T12:00:00.000Z',
        localDate: '2026-09-28',
        items: [],
      }),
    );
    const outcome = await saving;
    expect(outcome?.current).toBe(false);
    expect(store.phase()).toBe('compose');
  });

  it('tells other screens about new entries and favorites after saving', async () => {
    const events = TestBed.inject(DataEventsService);
    await reachReview();
    store.saveAsFavorite.set(true);
    await store.save();
    expect(events.entries()).toBe(1);
    expect(events.favorites()).toBe(1);

    await reachReview();
    store.saveAsFavorite.set(true);
    api.createFavoriteFromEntry.mockRejectedValueOnce(new Error('nope'));
    await store.save();
    expect(events.entries()).toBe(2);
    expect(events.favorites()).toBe(1);
  });

  it('prefills a text capture without treating the prefill as unsaved work', () => {
    store.start({ file: null, mode: 'text', source: 'text', description: 'Khoury yogurt' });
    expect(store.phase()).toBe('compose');
    expect(store.description()).toBe('Khoury yogurt');
    expect(store.canAnalyze()).toBe(true);
    expect(store.hasUnsavedWork()).toBe(false);
    store.description.set('Khoury yogurt, 1 cup');
    expect(store.hasUnsavedWork()).toBe(true);
  });

  describe('counted portions', () => {
    const BURGERS = { count: 2, unit: 'burger', unitPlural: 'burgers' };

    function burgerResponse(): AnalyzeResponse {
      const base = response();
      return {
        ...base,
        result: {
          ...base.result,
          mealName: 'Black Angus burgers',
          portion: BURGERS,
          items: [
            item({
              name: 'Black Angus patty',
              grams: 300,
              count: 2,
              unit: 'patty',
              unitPlural: 'patties',
            }),
          ],
        },
      };
    }

    it('seeds the portion from the analysis and saves it with the item counts', async () => {
      await reachReview(burgerResponse());
      expect(store.portion()).toEqual(BURGERS);
      expect(store.items()[0]).toMatchObject({ count: 2, unit: 'patty' });
      expect(store.edited()).toBe(false);

      store.portion.set({ ...BURGERS, count: 1.5 });
      expect(store.edited()).toBe(true);
      await store.save();
      const body = api.createEntry.mock.calls[0]![0];
      expect(body.portion).toEqual({ ...BURGERS, count: 1.5 });
      expect(body.items[0]).toMatchObject({ count: 2, unit: 'patty', unitPlural: 'patties' });
    });

    it('sends no portion when the meal is not countable', async () => {
      await reachReview();
      expect(store.portion()).toBeNull();
      await store.save();
      expect(api.createEntry.mock.calls[0]![0]).not.toHaveProperty('portion');
    });

    it('keeps the portion of a library draft', () => {
      store.startFromLibrary({
        name: 'Black Angus burgers',
        items: [{ name: 'Burger', grams: 390, nutrients: zeroNutrients() }],
        mealType: 'dinner',
        mealTypeAuto: false,
        dateTime: '2026-09-28T19:30',
        photo: null,
        portion: { ...BURGERS, count: 1 },
      });
      expect(store.portion()).toEqual({ ...BURGERS, count: 1 });
      expect(store.hasUnsavedWork()).toBe(false);
    });

    it('clears the portion when the review starts over', async () => {
      await reachReview(burgerResponse());
      store.discard();
      expect(store.portion()).toBeNull();
      store.startManual();
      expect(store.portion()).toBeNull();
    });
  });

  it('opens a library draft for review and saves it as a copy with its photo', async () => {
    store.startFromLibrary({
      portion: null,
      name: 'Chicken plate',
      items: [
        { name: 'Chicken', grams: 90, nutrients: { ...zeroNutrients(), calories: 195 } },
        { name: 'Fries', grams: 60, nutrients: { ...zeroNutrients(), calories: 185 } },
      ],
      mealType: 'dinner',
      mealTypeAuto: false,
      dateTime: '2026-09-28T19:30',
      photo: response().photo,
    });
    expect(store.phase()).toBe('review');
    expect(store.fromLibrary()).toBe(true);
    expect(store.source()).toBe('copy');
    expect(store.thumbUrl()).toBe('/api/photos/photo-1/thumb');
    expect(store.items().map((draft) => draft.grams)).toEqual([90, 60]);
    expect(store.totals().calories).toBe(380);
    expect(store.hasUnsavedWork()).toBe(false);

    await store.save();
    expect(api.createEntry.mock.calls[0]![0]).toMatchObject({
      name: 'Chicken plate',
      source: 'copy',
      mealType: 'dinner',
      localDate: '2026-09-28',
      analysisId: null,
      photoId: 'photo-1',
    });

    store.discard();
    expect(store.fromLibrary()).toBe(false);
    expect(store.source()).toBe('manual');
  });

  it('re-runs a correction as ground truth against the previous analysis', async () => {
    await reachReview();
    const seed = store.seedVersion();
    store.correctionOpen.set(true);
    api.analyze.mockResolvedValueOnce(
      response({
        analysisId: 'analysis-2',
        result: { ...response().result, items: [item({ grams: 75 })] },
      }),
    );
    const running = store.correct('  I ate half  ');
    expect(store.phase()).toBe('analyzing');
    expect(store.runKind()).toBe('correction');
    await running;

    const [fields, images] = api.analyze.mock.calls[1]!;
    expect(images).toEqual([]);
    expect(fields).toMatchObject({
      mode: 'food_photo',
      description: 'rice bowl',
      previousAnalysisId: 'analysis-1',
      followUpAnswer: 'I ate half',
    });
    expect(store.items()[0]?.grams).toBe(75);
    expect(store.correction()).toBe('');
    expect(store.correctionOpen()).toBe(false);
    expect(store.seedVersion()).toBeGreaterThan(seed);
  });

  it('keeps the correction open with its text when the re-run fails', async () => {
    await reachReview();
    store.correctionOpen.set(true);
    api.analyze.mockRejectedValueOnce(new HttpErrorResponse({ status: 502 }));
    await store.correct('No oil used');
    expect(store.phase()).toBe('review');
    expect(store.correction()).toBe('No oil used');
    expect(store.correctionOpen()).toBe(true);
    expect(store.error()?.kind).toBe('ai_failed');
  });

  it('ignores empty corrections and corrections without an analysis', async () => {
    await store.correct('No oil');
    expect(api.analyze).not.toHaveBeenCalled();
    await reachReview();
    await store.correct('   ');
    expect(api.analyze).toHaveBeenCalledTimes(1);
  });
  describe('barcode from an unknown product', () => {
    const EAN = '5281234567896';

    function labelResponse(): AnalyzeResponse {
      return response({
        mode: 'nutrition_label',
        description: null,
        result: {
          ...response().result,
          inputType: 'nutrition_label',
          mealName: 'Granola',
          label: LABEL,
          items: [
            item({
              name: 'Oat granola',
              grams: 40,
              amountSource: 'label',
              nutrients: { ...zeroNutrients(), calories: 180, protein: 4, carbs: 24, fat: 7.2 },
              per100g: LABEL.per100,
            }),
          ],
        },
      });
    }

    async function reachLabelReview(result: AnalyzeResponse = labelResponse()): Promise<void> {
      store.start({ file: photo(), mode: 'nutrition_label', source: 'camera', barcode: EAN });
      api.analyze.mockResolvedValueOnce(result);
      await store.analyze();
    }

    it('saves the label values against the barcode and logs the entry through the product', async () => {
      await reachLabelReview();
      expect(store.barcode()).toBe(EAN);
      expect(store.productPlan()?.kind).toBe('log');
      store.pickMealType('snack');
      const events = TestBed.inject(DataEventsService);

      const outcome = await store.save();

      expect(api.createEntry).not.toHaveBeenCalled();
      expect(api.upsertProduct).toHaveBeenCalledWith(EAN, {
        name: 'Granola',
        brand: null,
        basisUnit: 'g',
        per100: LABEL.per100,
        servingSizeG: 40,
        packSizeG: 500,
        source: 'label',
      });
      expect(api.logProduct).toHaveBeenCalledTimes(1);
      const [productId, body] = api.logProduct.mock.calls[0]!;
      expect(productId).toBe('product-1');
      expect(body).toMatchObject({ grams: 40, mealType: 'snack' });
      expect(body.timestamp).toBeTruthy();
      expect(body.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(api.upsertProduct.mock.invocationCallOrder[0]).toBeLessThan(
        api.logProduct.mock.invocationCallOrder[0]!,
      );
      expect(outcome).toMatchObject({
        product: 'saved',
        current: true,
        entry: { id: 'entry-from-product', productId: 'product-1' },
      });
      expect(events.entries()).toBe(1);
      expect(events.products()).toBe(1);
      expect(store.phase()).toBe('saved');
    });

    it('names the product after the reviewed meal name', async () => {
      const unnamed = labelResponse();
      await reachLabelReview({
        ...unnamed,
        result: { ...unnamed.result, label: { ...LABEL, productName: null } },
      });
      store.name.set('  Crunchy granola ');
      await store.save();
      expect(api.upsertProduct.mock.calls[0]![1].name).toBe('Crunchy granola');

      await reachLabelReview({
        ...unnamed,
        result: { ...unnamed.result, label: { ...LABEL, productName: null } },
      });
      store.name.set('');
      await store.save();
      expect(api.upsertProduct.mock.calls[1]![1].name).toBe('Oat granola');
    });

    it('stores corrected label values when the user fixes the reviewed item', async () => {
      await reachLabelReview();
      const [labelItem] = store.items();
      store.items.set([
        { ...labelItem!, nutrients: { ...labelItem!.nutrients, protein: 6 }, basis: null },
      ]);
      await store.save();
      expect(api.upsertProduct.mock.calls[0]![1].per100).toEqual({
        ...LABEL.per100,
        protein: 15,
      });
      expect(api.logProduct.mock.calls[0]![1].grams).toBe(40);
    });

    it('logs a plain entry when the product cannot be saved', async () => {
      api.upsertProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 400 }));
      await reachLabelReview();
      const outcome = await store.save();
      expect(api.logProduct).not.toHaveBeenCalled();
      expect(api.createEntry).toHaveBeenCalledTimes(1);
      expect(outcome).toMatchObject({ product: 'failed', current: true });
      expect(TestBed.inject(DataEventsService).products()).toBe(0);
    });

    it('keeps the review open when logging through the product fails and never logs twice', async () => {
      api.logProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
      await reachLabelReview();
      const events = TestBed.inject(DataEventsService);

      expect(await store.save()).toBeNull();
      expect(store.phase()).toBe('review');
      expect(store.saveError()).toBeTruthy();
      expect(api.createEntry).not.toHaveBeenCalled();
      expect(events.products()).toBe(1);
      expect(events.entries()).toBe(0);

      const outcome = await store.save();
      expect(outcome?.entry.id).toBe('entry-from-product');
      expect(api.upsertProduct).toHaveBeenCalledTimes(2);
      expect(api.logProduct).toHaveBeenCalledTimes(2);
      expect(api.createEntry).not.toHaveBeenCalled();
      expect(events.entries()).toBe(1);
    });

    it('falls back to a plain entry when the product log is rejected', async () => {
      api.logProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 400 }));
      await reachLabelReview();
      const outcome = await store.save();
      expect(api.createEntry).toHaveBeenCalledTimes(1);
      expect(outcome).toMatchObject({ product: 'saved', entry: { id: 'entry-1' } });
    });

    it('saves the label product after a plain entry when the meal has more items', async () => {
      const base = labelResponse();
      await reachLabelReview({
        ...base,
        result: {
          ...base.result,
          items: [...base.result.items, item({ name: 'Milk', grams: 200 })],
        },
      });
      expect(store.productPlan()?.kind).toBe('save');
      const outcome = await store.save();
      expect(api.logProduct).not.toHaveBeenCalled();
      expect(api.createEntry).toHaveBeenCalledTimes(1);
      expect(api.upsertProduct).toHaveBeenCalledWith(
        EAN,
        expect.objectContaining({ name: 'Granola', per100: LABEL.per100, source: 'label' }),
      );
      expect(api.createEntry.mock.invocationCallOrder[0]).toBeLessThan(
        api.upsertProduct.mock.invocationCallOrder[0]!,
      );
      expect(outcome?.product).toBe('saved');
    });

    it('keeps the barcode when the label photo is retaken but not for an unrelated capture', () => {
      store.start({ file: photo(), mode: 'nutrition_label', source: 'camera', barcode: EAN });
      store.start({ file: photo(), mode: 'nutrition_label', source: 'camera' });
      expect(store.barcode()).toBe(EAN);
      store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
      expect(store.barcode()).toBeNull();
    });

    function describedSingle(mealName: string, itemName: string): AnalyzeResponse {
      return response({
        mode: 'text',
        photo: null,
        result: {
          ...response().result,
          inputType: 'text',
          mealName,
          items: [
            item({
              name: itemName,
              grams: 60,
              nutrients: { ...zeroNutrients(), calories: 159, protein: 5.4, carbs: 31.2 },
            }),
          ],
        },
      });
    }

    it('remembers a described single food with per-100 values from the estimate', async () => {
      store.start({ file: null, mode: 'text', source: 'text', barcode: EAN });
      store.description.set('one Toufoulti bread');
      api.analyze.mockResolvedValueOnce(describedSingle('Toufoulti', 'Toufoulti bread'));
      await store.analyze();
      const outcome = await store.save();
      expect(api.createEntry.mock.calls[0]![0].name).toBe('Toufoulti');
      expect(api.upsertProduct).toHaveBeenCalledWith(EAN, {
        name: 'Toufoulti',
        brand: null,
        basisUnit: 'g',
        per100: { ...zeroNutrients(), calories: 265, protein: 9, carbs: 52 },
        servingSizeG: null,
        packSizeG: null,
        source: 'manual',
      });
      expect(outcome?.product).toBe('saved');
    });

    it('names the product like the saved meal so the library shows it once', async () => {
      store.start({ file: null, mode: 'text', source: 'text', barcode: EAN });
      store.description.set('Hummus from a supermarket tub, ate 100 g');
      api.analyze.mockResolvedValueOnce(
        describedSingle('Supermarket Hummus', 'Hummus, supermarket prepared'),
      );
      await store.analyze();
      await store.save();
      expect(api.createEntry.mock.calls[0]![0].name).toBe('Supermarket Hummus');
      expect(api.upsertProduct.mock.calls[0]![1].name).toBe('Supermarket Hummus');
      expect(api.logProduct).not.toHaveBeenCalled();
    });

    it('follows a meal name the user edits during the review', async () => {
      store.start({ file: null, mode: 'text', source: 'text', barcode: EAN });
      store.description.set('Hummus from a supermarket tub, ate 100 g');
      api.analyze.mockResolvedValueOnce(
        describedSingle('Supermarket Hummus', 'Hummus, supermarket prepared'),
      );
      await store.analyze();
      store.name.set(' Tub hummus ');
      expect(store.productPlan()).toMatchObject({ kind: 'save', body: { name: 'Tub hummus' } });
      await store.save();
      expect(api.createEntry.mock.calls[0]![0].name).toBe('Tub hummus');
      expect(api.upsertProduct.mock.calls[0]![1].name).toBe('Tub hummus');
    });

    it('names a manually entered product after the meal', async () => {
      store.start({ file: null, mode: 'text', source: 'text', barcode: EAN });
      store.startManual();
      store.name.set('Toast');
      store.items.set([
        createDraftItem({
          name: 'White bread',
          grams: 30,
          nutrients: { ...zeroNutrients(), calories: 80, carbs: 15 },
        }),
      ]);
      await store.save();
      expect(api.createEntry.mock.calls[0]![0].name).toBe('Toast');
      expect(api.upsertProduct.mock.calls[0]![1]).toMatchObject({
        name: 'Toast',
        source: 'manual',
      });
    });

    it('keeps the barcode when switching to manual entry from compose', async () => {
      store.start({ file: null, mode: 'text', source: 'text', barcode: EAN });
      store.startManual();
      expect(store.barcode()).toBe(EAN);
      store.discard();
      expect(store.barcode()).toBeNull();
    });

    it('skips the product for multi-item meals or when the user unlinks the barcode', async () => {
      store.start({ file: photo(), mode: 'food_photo', source: 'camera', barcode: EAN });
      api.analyze.mockResolvedValueOnce(
        response({
          result: { ...response().result, items: [item(), item({ name: 'Salad', grams: 80 })] },
        }),
      );
      await store.analyze();
      expect((await store.save())?.product).toBeNull();

      store.start({ file: photo(), mode: 'nutrition_label', source: 'camera', barcode: EAN });
      api.analyze.mockResolvedValueOnce(labelResponse());
      await store.analyze();
      store.clearBarcode();
      expect((await store.save())?.product).toBeNull();
      expect(api.upsertProduct).not.toHaveBeenCalled();
    });

    it('skips remembering a barcode whose per-100 values look wrong and says so', async () => {
      store.start({ file: null, mode: 'text', source: 'text', barcode: EAN });
      store.description.set('a pinch of sugar');
      api.analyze.mockResolvedValueOnce(
        response({
          mode: 'text',
          photo: null,
          result: {
            ...response().result,
            inputType: 'text',
            items: [
              item({
                name: 'Sugar',
                grams: 0.5,
                nutrients: { ...zeroNutrients(), calories: 20, carbs: 5 },
              }),
            ],
          },
        }),
      );
      await store.analyze();
      expect(store.productPlan()).toEqual({ kind: 'skip', reason: 'values' });
      const outcome = await store.save();
      expect(api.createEntry).toHaveBeenCalledTimes(1);
      expect(api.upsertProduct).not.toHaveBeenCalled();
      expect(outcome?.product).toBe('skipped');
    });

    it('reports a failed product save without failing the entry', async () => {
      api.upsertProduct.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      store.start({ file: photo(), mode: 'nutrition_label', source: 'camera', barcode: EAN });
      api.analyze.mockResolvedValueOnce(labelResponse());
      await store.analyze();
      const outcome = await store.save();
      expect(outcome).toMatchObject({ product: 'failed', current: true });
      expect(store.phase()).toBe('saved');
    });
  });

  describe('photo time from library uploads', () => {
    const takenYesterdayAt = (hours: number, minutes: number): Date => {
      const taken = new Date();
      taken.setDate(taken.getDate() - 1);
      taken.setHours(hours, minutes, 0, 0);
      return taken;
    };

    it('prefills the time and meal type from the photo and keeps them through the analysis', async () => {
      const taken = takenYesterdayAt(13, 5);
      photoReader.mockResolvedValueOnce(taken);
      const file = photo();
      store.start({ file, mode: 'food_photo', source: 'library' });
      expect(photoReader).toHaveBeenCalledWith(file);
      await flush();

      expect(store.photoTime()).toBe(currentDateTimeInput(taken));
      expect(store.dateTime()).toBe(currentDateTimeInput(taken));
      expect(store.mealType()).toBe('lunch');
      expect(store.timeSource()).toBe('photo');

      api.analyze.mockResolvedValueOnce(response());
      await store.analyze();
      expect(api.analyze.mock.calls[0]![0]).toMatchObject({
        localTime: currentDateTimeInput(taken),
        mealType: 'lunch',
      });
      expect(store.phase()).toBe('review');
      expect(store.dateTime()).toBe(currentDateTimeInput(taken));
      expect(store.mealType()).toBe('lunch');
      expect(store.buildEntryRequest()).toMatchObject({
        timestamp: taken.toISOString(),
        localDate: currentDateTimeInput(taken).slice(0, 10),
        mealType: 'lunch',
      });
    });

    it('keeps now for camera captures and photos without a usable time', async () => {
      store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
      await flush();
      expect(photoReader).not.toHaveBeenCalled();
      expect(store.photoTime()).toBeNull();

      const future = new Date(Date.now() + 3_600_000);
      photoReader.mockResolvedValueOnce(future);
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      await flush();
      expect(store.photoTime()).toBeNull();
      expect(store.timeSource()).toBe('now');

      photoReader.mockResolvedValueOnce(new Date(Date.now() - 31 * 86_400_000));
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      await flush();
      expect(store.photoTime()).toBeNull();

      photoReader.mockRejectedValueOnce(new Error('unreadable'));
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      await flush();
      expect(store.photoTime()).toBeNull();
      expect(store.error()).toBeNull();
    });

    it('ignores a photo time that arrives after the photo was replaced', async () => {
      const pending = deferred<Date | null>();
      photoReader.mockReturnValueOnce(pending.promise);
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
      pending.resolve(takenYesterdayAt(8, 0));
      await flush();
      expect(store.photoTime()).toBeNull();
      expect(store.timeSource()).toBe('now');
    });

    it('applies a late photo time in review only while the time is untouched', async () => {
      const late = deferred<Date | null>();
      photoReader.mockReturnValueOnce(late.promise);
      api.analyze.mockResolvedValueOnce(response());
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      await store.analyze();
      expect(store.phase()).toBe('review');
      const taken = takenYesterdayAt(19, 30);
      late.resolve(taken);
      await flush();
      expect(store.dateTime()).toBe(currentDateTimeInput(taken));
      expect(store.mealType()).toBe('dinner');

      const edited = deferred<Date | null>();
      photoReader.mockReturnValueOnce(edited.promise);
      api.analyze.mockResolvedValueOnce(response());
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      await store.analyze();
      store.dateTime.set('2026-09-27T09:00');
      edited.resolve(taken);
      await flush();
      expect(store.dateTime()).toBe('2026-09-27T09:00');
      expect(store.photoTime()).toBe(currentDateTimeInput(taken));
    });

    it('lets the user change the time while composing or go back to now', async () => {
      const taken = takenYesterdayAt(13, 5);
      photoReader.mockResolvedValueOnce(taken);
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      await flush();

      store.setCaptureTime('2026-09-27T20:15');
      expect(store.timeSource()).toBe('user');
      expect(store.mealType()).toBe('dinner');
      store.setCaptureTime(currentDateTimeInput(taken));
      expect(store.timeSource()).toBe('photo');
      store.setCaptureTime('2026-09-27T20:15');

      api.analyze.mockResolvedValueOnce(response());
      await store.analyze();
      expect(api.analyze.mock.calls[0]![0]).toMatchObject({
        localTime: '2026-09-27T20:15',
        mealType: 'dinner',
      });
      expect(store.dateTime()).toBe('2026-09-27T20:15');
      store.setCaptureTime('2026-09-27T08:00');
      expect(store.dateTime()).toBe('2026-09-27T20:15');

      store.start({ file: photo(), mode: 'food_photo', source: 'camera' });
      store.setCaptureTime('2026-09-27T20:15');
      store.useCurrentTime();
      expect(store.timeSource()).toBe('now');
      expect(store.dateTime()).not.toBe('2026-09-27T20:15');
    });

    it('forgets the photo time when the meal is discarded', async () => {
      photoReader.mockResolvedValueOnce(takenYesterdayAt(13, 5));
      store.start({ file: photo(), mode: 'food_photo', source: 'library' });
      await flush();
      expect(store.photoTime()).not.toBeNull();
      store.discard();
      expect(store.photoTime()).toBeNull();
      expect(store.timeSource()).toBe('now');
    });
  });

  describe('several photos per meal', () => {
    const file = (name: string): File => new File([name], name, { type: 'image/jpeg' });

    beforeEach(() => {
      vi.mocked(URL.createObjectURL).mockImplementation((blob) => `blob:${(blob as File).name}`);
      compressor.mockImplementation(async (blob) => compressed(new Blob([(blob as File).name])));
    });

    const compressedAs = (): [string, CompressOptions][] =>
      compressor.mock.calls.map(([blob, options]) => [(blob as File).name, options]);

    const sentRoles = (call = 0): string[] =>
      (api.analyze.mock.calls[call]![1] ?? []).map((image) => image.role);

    it('adds up to three photos, the next ones as labels, each compressed with its role preset', async () => {
      const [food, label, extra, overflow] = [
        file('food.jpg'),
        file('label.jpg'),
        file('back.jpg'),
        file('more.jpg'),
      ];
      store.start({ file: food, mode: 'food_photo', source: 'camera' });
      expect(store.canAddPhoto()).toBe(true);
      expect(store.addPhotos([label], 'camera')).toBe(1);
      expect(store.addPhotos([extra, overflow], 'library')).toBe(1);

      expect(store.photos().map((draft) => [draft.file.name, draft.role, draft.source])).toEqual([
        ['food.jpg', 'food', 'camera'],
        ['label.jpg', 'label', 'camera'],
        ['back.jpg', 'label', 'library'],
      ]);
      expect(store.canAddPhoto()).toBe(false);
      expect(store.mode()).toBe('food_photo');
      expect(store.previewUrl()).toBe('blob:food.jpg');
      expect(compressedAs()).toEqual([
        ['food.jpg', COMPRESS_PRESETS.food_photo],
        ['label.jpg', COMPRESS_PRESETS.nutrition_label],
        ['back.jpg', COMPRESS_PRESETS.nutrition_label],
      ]);
      expect(overflow.name).toBe('more.jpg');
      expect(photoReader).not.toHaveBeenCalled();

      api.analyze.mockResolvedValueOnce(response());
      await store.analyze();
      const [fields, images] = api.analyze.mock.calls[0]!;
      expect(fields.mode).toBe('food_photo');
      expect(sentRoles()).toEqual(['food', 'label', 'label']);
      expect(await Promise.all((images ?? []).map((image) => image.blob.text()))).toEqual([
        'food.jpg',
        'label.jpg',
        'back.jpg',
      ]);
    });

    it('uses the role the caller asks for and keeps a first label photo as a label', () => {
      store.start({ file: file('label.jpg'), mode: 'nutrition_label', source: 'camera' });
      store.addPhotos([file('plate.jpg')], 'camera', 'food');
      expect(store.photos().map((draft) => draft.role)).toEqual(['label', 'food']);
      expect(store.mode()).toBe('food_photo');
      expect(store.previewUrl()).toBe('blob:plate.jpg');
    });

    it('starts the photo list from an empty photo compose', () => {
      store.start({ file: null, mode: 'nutrition_label', source: 'camera' });
      expect(store.canAnalyze()).toBe(false);
      store.addPhotos([file('a.jpg'), file('b.jpg')], 'library');
      expect(store.photos().map((draft) => draft.role)).toEqual(['label', 'label']);
      expect(store.mode()).toBe('nutrition_label');
      expect(store.canAnalyze()).toBe(true);
      expect(store.hasUnsavedWork()).toBe(true);
    });

    it('switches a photo between food and label without compressing it again', async () => {
      const [first, second] = [file('pack.jpg'), file('bowl.jpg')];
      store.start({ file: first, mode: 'nutrition_label', source: 'camera' });
      store.addPhotos([second], 'camera');
      expect(store.mode()).toBe('nutrition_label');
      const id = store.photos()[1]!.id;
      const calls = compressor.mock.calls.length;

      store.setPhotoRole(id, 'food');
      expect(store.photos()[1]?.role).toBe('food');
      expect(store.mode()).toBe('food_photo');
      expect(compressedAs().at(-1)).toEqual(['bowl.jpg', COMPRESS_PRESETS.food_photo]);
      expect(second.name).toBe('bowl.jpg');
      expect(compressor).toHaveBeenCalledTimes(calls);
      store.setPhotoRole(id, 'label');
      store.setPhotoRole(id, 'food');
      expect(compressor).toHaveBeenCalledTimes(calls);

      api.analyze.mockResolvedValueOnce(response());
      await store.analyze();
      expect(sentRoles()).toEqual(['label', 'food']);
      expect(api.analyze.mock.calls[0]![0].mode).toBe('food_photo');
    });

    it('changes the only photo role from the Food / Label switch', () => {
      const only = file('meal.jpg');
      store.start({ file: only, mode: 'food_photo', source: 'camera' });
      store.setMode('nutrition_label');
      expect(store.photos()[0]?.role).toBe('label');
      expect(store.mode()).toBe('nutrition_label');
      expect(compressedAs()).toEqual([['meal.jpg', COMPRESS_PRESETS.nutrition_label]]);
      expect(compressor.mock.calls[0]![0]).toBe(only);
    });

    it('removes a photo and releases its preview', () => {
      store.start({ file: file('a.jpg'), mode: 'food_photo', source: 'camera' });
      store.addPhotos([file('b.jpg')], 'camera');
      const [first, second] = store.photos();
      store.removePhoto(first!.id);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a.jpg');
      expect(store.photos()).toEqual([second]);
      expect(store.mode()).toBe('nutrition_label');
      store.removePhoto(second!.id);
      expect(store.photos()).toEqual([]);
      expect(store.canAnalyze()).toBe(false);
      store.removePhoto(999);
      expect(store.photos()).toEqual([]);
    });

    it('marks the photo that cannot be read and clears it once removed', async () => {
      compressor.mockImplementation(async (blob) => {
        if ((blob as File).name === 'broken.heic') {
          throw new ImageDecodeError(blob, new Error('heic'));
        }
        return compressed(blob);
      });
      store.start({ file: file('ok.jpg'), mode: 'food_photo', source: 'camera' });
      store.addPhotos([file('broken.heic')], 'library');
      await flush();
      const broken = store.photos()[1]!;
      expect(store.failedPhotos().has(broken.id)).toBe(true);
      expect(store.failedPhotos().has(store.photos()[0]!.id)).toBe(false);
      expect(store.error()?.kind).toBe('unreadable_image');

      store.removePhoto(broken.id);
      expect(store.failedPhotos().size).toBe(0);
      expect(store.error()).toBeNull();
    });

    it('reads the meal time only from the first photo when it came from the library', async () => {
      const taken = new Date();
      taken.setDate(taken.getDate() - 1);
      taken.setHours(12, 40, 0, 0);
      photoReader.mockResolvedValue(taken);
      const [camera, oldLabel] = [file('now.jpg'), file('old-label.jpg')];
      store.start({ file: camera, mode: 'food_photo', source: 'camera' });
      store.addPhotos([oldLabel], 'library');
      await flush();
      expect(photoReader).not.toHaveBeenCalled();
      expect(store.photoTime()).toBeNull();

      store.removePhoto(store.photos()[0]!.id);
      await flush();
      expect(photoReader).toHaveBeenCalledWith(oldLabel);
      expect(store.photoTime()).toBe(currentDateTimeInput(taken));
      expect(store.timeSource()).toBe('photo');

      store.addPhotos([file('extra.jpg')], 'library');
      await flush();
      expect(photoReader).toHaveBeenCalledTimes(1);

      store.removePhoto(store.photos()[0]!.id);
      await flush();
      expect(store.photoTime()).toBe(currentDateTimeInput(taken));
      expect(photoReader).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'extra.jpg' }));
    });

    it('drops the photo time when the first photo is replaced by a camera shot', async () => {
      const taken = new Date();
      taken.setDate(taken.getDate() - 2);
      taken.setHours(9, 15, 0, 0);
      photoReader.mockResolvedValue(taken);
      store.start({ file: file('library.jpg'), mode: 'food_photo', source: 'library' });
      await flush();
      expect(store.timeSource()).toBe('photo');
      store.addPhotos([file('camera.jpg')], 'camera');
      store.removePhoto(store.photos()[0]!.id);
      expect(store.photoTime()).toBeNull();
      expect(store.timeSource()).toBe('now');
      expect(store.dateTime()).not.toBe(currentDateTimeInput(taken));
    });

    it('only edits photos while composing a photo meal', async () => {
      store.start({ file: null, mode: 'text', source: 'text' });
      store.addPhotos([file('a.jpg')], 'camera');
      expect(store.photos()).toEqual([]);
      expect(store.canAddPhoto()).toBe(false);

      await reachReview();
      const count = store.photos().length;
      store.addPhotos([file('b.jpg')], 'camera');
      store.removePhoto(store.photos()[0]!.id);
      expect(store.photos()).toHaveLength(count);
    });
  });

  describe('label photo from the review', () => {
    const labelFile = (): File => new File(['label'], 'label.jpg', { type: 'image/jpeg' });
    const LABEL_PHOTO: PhotoRef = {
      id: 'photo-2',
      url: '/api/photos/photo-2',
      thumbUrl: '/api/photos/photo-2/thumb',
      width: 2048,
      height: 1536,
    };

    beforeEach(() => {
      vi.mocked(URL.createObjectURL).mockImplementation((blob) => `blob:${(blob as File).name}`);
    });

    function withLabel(): AnalyzeResponse {
      return response({
        analysisId: 'analysis-2',
        photos: [
          { photo: PHOTO_1, role: 'food' },
          { photo: LABEL_PHOTO, role: 'label' },
        ],
        result: {
          ...response().result,
          mealName: 'Labneh',
          followUpQuestion: 'Was there sauce?',
          items: [item({ name: 'Labneh', grams: 60, amountSource: 'label' })],
        },
      });
    }

    it('re-runs the analysis with the label photo on top of the previous one', async () => {
      await reachReview();
      store.name.set('Breakfast labneh');
      store.pickMealType('breakfast');
      store.correctionOpen.set(true);
      store.correction.set('No oil used');
      store.followUpAnswer.set('No');
      const pending = deferred<AnalyzeResponse>();
      api.analyze.mockReturnValueOnce(pending.promise);
      const label = labelFile();

      const run = store.addLabelPhoto(label, 'library');
      expect(store.phase()).toBe('analyzing');
      expect(store.runKind()).toBe('label');
      expect(store.analyzingPhotoUrl()).toBe('blob:label.jpg');
      await flush();
      expect(compressor).toHaveBeenLastCalledWith(label, COMPRESS_PRESETS.nutrition_label);
      const [fields, images] = api.analyze.mock.calls[1]!;
      expect(fields).toMatchObject({
        mode: 'food_photo',
        description: 'rice bowl',
        previousAnalysisId: 'analysis-1',
        mealType: 'breakfast',
      });
      expect(fields.followUpAnswer).toBeUndefined();
      expect(images).toEqual([{ blob: compressedBlob, role: 'label' }]);

      pending.resolve(withLabel());
      await run;
      expect(store.phase()).toBe('review');
      expect(store.analysis()?.analysisId).toBe('analysis-2');
      expect(store.items()[0]?.name).toBe('Labneh');
      expect(store.name()).toBe('Breakfast labneh');
      expect(store.mealType()).toBe('breakfast');
      expect(store.analysisPhotos().map((photo) => photo.role)).toEqual(['food', 'label']);
      expect(store.correction()).toBe('No oil used');
      expect(store.correctionOpen()).toBe(true);
      expect(store.followUpAnswer()).toBe('No');
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:label.jpg');
      expect(store.analyzingPhotoUrl()).toBe('blob:meal.heic');

      store.discard();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:label.jpg');
    });

    it('keeps the label photo for a retry when the re-run fails', async () => {
      await reachReview();
      api.analyze.mockRejectedValueOnce(new HttpErrorResponse({ status: 502 }));
      await store.addLabelPhoto(labelFile(), 'camera');
      expect(store.phase()).toBe('review');
      expect(store.error()).toMatchObject({ kind: 'ai_failed', retryable: true });
      expect(store.analysis()?.analysisId).toBe('analysis-1');

      api.analyze.mockResolvedValueOnce(withLabel());
      await store.retry();
      expect(api.analyze).toHaveBeenCalledTimes(3);
      expect(api.analyze.mock.calls[2]![1]).toEqual([{ blob: compressedBlob, role: 'label' }]);
      expect(compressor).toHaveBeenCalledTimes(2);
      expect(store.analysis()?.analysisId).toBe('analysis-2');
    });

    it('drops the old follow-up answer when the new estimate asks something else', async () => {
      await reachReview();
      store.followUpAnswer.set('Yes');
      api.analyze.mockResolvedValueOnce({
        ...withLabel(),
        result: { ...withLabel().result, followUpQuestion: 'How much did you eat?' },
      });
      await store.addLabelPhoto(labelFile(), 'camera');
      expect(store.followUpAnswer()).toBe('');
    });

    it('re-runs a described meal with the label photo and its analysis', async () => {
      await reachReview(
        response({
          mode: 'text',
          photo: null,
          photos: [],
          description: 'Khoury labneh, 2 tbsp',
        }),
      );
      api.analyze.mockResolvedValueOnce(
        response({ analysisId: 'analysis-3', mode: 'nutrition_label' }),
      );
      await store.addLabelPhoto(labelFile(), 'camera');
      const [fields, images] = api.analyze.mock.calls[1]!;
      expect(fields).toMatchObject({
        mode: 'text',
        description: 'Khoury labneh, 2 tbsp',
        previousAnalysisId: 'analysis-1',
      });
      expect(images).toEqual([{ blob: compressedBlob, role: 'label' }]);
      expect(store.analysis()?.analysisId).toBe('analysis-3');
    });

    it('only adds a label photo to an analysis under review', async () => {
      await store.addLabelPhoto(labelFile(), 'camera');
      store.startManual();
      await store.addLabelPhoto(labelFile(), 'camera');
      expect(api.analyze).not.toHaveBeenCalled();
      expect(store.phase()).toBe('review');
    });

    it('suggests a label photo for uncertain or packaged results', async () => {
      await reachReview(
        response({
          result: { ...response().result, items: [item({ confidence: 'low' })] },
        }),
      );
      expect(store.labelHint()).toBe('low_confidence');

      await reachReview(
        response({
          result: { ...response().result, assumptions: ['Standard Almarai 500 ml bottle'] },
        }),
      );
      expect(store.labelHint()).toBe('packaged');

      await reachReview(withLabel());
      expect(store.labelHint()).toBeNull();
    });

    describe('cover photo', () => {
      function labelFirst(): AnalyzeResponse {
        return response({
          photo: PHOTO_1,
          photos: [
            { photo: LABEL_PHOTO, role: 'label' },
            { photo: PHOTO_1, role: 'food' },
          ],
        });
      }

      it('defaults to the first food photo and sends it as the cover', async () => {
        await reachReview(labelFirst());
        expect(store.reviewPhotos().map(({ photo }) => photo.id)).toEqual(['photo-2', 'photo-1']);
        expect(store.coverPhoto()?.id).toBe('photo-1');
        expect(store.thumbUrl()).toBe('blob:meal.heic');

        await store.save();
        expect(api.createEntry.mock.calls[0]![0]).toMatchObject({
          analysisId: 'analysis-1',
          photoId: 'photo-1',
          coverPhotoId: 'photo-1',
        });
      });

      it('saves the photo picked as the cover and shows it as the thumbnail', async () => {
        await reachReview(withLabel());
        store.chooseCover('photo-2');
        expect(store.coverPhoto()?.id).toBe('photo-2');
        expect(store.thumbUrl()).toBe('/api/photos/photo-2/thumb');
        expect(store.photoUrl()).toBe('/api/photos/photo-2');

        await store.save();
        expect(api.createEntry.mock.calls[0]![0]).toMatchObject({
          photoId: 'photo-2',
          coverPhotoId: 'photo-2',
        });
      });

      it('ignores photos that are not part of the meal and choices outside the review', async () => {
        store.chooseCover('photo-2');
        await reachReview(withLabel());
        expect(store.coverPhoto()?.id).toBe('photo-1');
        store.chooseCover('photo-9');
        expect(store.coverPhoto()?.id).toBe('photo-1');
      });

      it('keeps the choice through a label re-run and forgets it for the next meal', async () => {
        await reachReview(withLabel());
        store.chooseCover('photo-2');
        api.analyze.mockResolvedValueOnce({ ...withLabel(), analysisId: 'analysis-4' });
        await store.addLabelPhoto(labelFile(), 'camera');
        expect(store.coverPhoto()?.id).toBe('photo-2');

        api.analyze.mockResolvedValueOnce(response({ photos: [{ photo: PHOTO_1, role: 'food' }] }));
        await store.addLabelPhoto(labelFile(), 'camera');
        expect(store.coverPhoto()?.id).toBe('photo-1');

        await reachReview(withLabel());
        expect(store.coverPhoto()?.id).toBe('photo-1');
      });

      it('sends no cover for a meal without analysis photos', async () => {
        store.startManual();
        store.items.update(([first]) => [{ ...first!, name: 'Banana' }]);
        await store.save();
        expect(api.createEntry.mock.calls[0]![0]).not.toHaveProperty('coverPhotoId');
      });
    });
  });

  describe('several meals from one description', () => {
    const NOW = new Date(2026, 9, 4, 21, 30);

    function mealResponse(
      id: string,
      mealName: string,
      timing: AnalyzeResponse['timing'],
      items: AnalysisItem[] = [item({ name: `${mealName} item` })],
    ): AnalyzeResponse {
      const base = response({ mode: 'text', photo: null, photos: [], analysisId: id });
      return {
        ...base,
        description: `${mealName} words`,
        result: { ...base.result, inputType: 'text', mealName, items, followUpQuestion: null },
        timing,
      };
    }

    function dayResponse(): AnalyzeResponse {
      return {
        ...mealResponse('a-lunch', 'Chicken wrap', { mealType: 'lunch', time: null, daysAgo: 0 }),
        moreMeals: [
          mealResponse('a-breakfast', 'Eggs', { mealType: 'breakfast', time: '07:45', daysAgo: 0 }),
        ],
      };
    }

    async function describeDay(result: AnalyzeResponse = dayResponse()): Promise<void> {
      api.analyze.mockResolvedValueOnce(result);
      store.start({ file: null, mode: 'text', source: 'text' });
      store.description.set('eggs for breakfast, a chicken wrap for lunch');
      await store.analyze();
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });

    afterEach(() => vi.useRealTimers());

    it('asks for a split only for a fresh typed description', async () => {
      await describeDay(mealResponse('a-1', 'Eggs', null));
      expect(api.analyze.mock.calls[0]![0].split).toBe('true');

      store.discard();
      await reachReview();
      expect(api.analyze.mock.calls[1]![0]).not.toHaveProperty('split');

      store.discard();
      api.analyze.mockResolvedValueOnce(mealResponse('a-2', 'Yogurt', null));
      store.start({ file: null, mode: 'text', source: 'text', barcode: '5280000000017' });
      store.description.set('one cup');
      await store.analyze();
      expect(api.analyze.mock.calls[2]![0]).not.toHaveProperty('split');
    });

    it('lists every meal found in eating order with a time for each', async () => {
      await describeDay();

      expect(store.phase()).toBe('meals');
      expect(store.view()).toBe('meals');
      expect(store.hasUnsavedWork()).toBe(true);
      expect(store.analysis()).toBeNull();
      expect(
        store.meals().map((meal) => [meal.name, meal.mealType, meal.dateTime, meal.mealTypeAuto]),
      ).toEqual([
        ['Eggs', 'breakfast', '2026-10-04T07:45', false],
        ['Chicken wrap', 'lunch', '2026-10-04T13:00', false],
      ]);
      expect(store.meals().every((meal) => meal.analysis.moreMeals === undefined)).toBe(true);
    });

    it('opens one meal for review and keeps its edits when going back', async () => {
      await describeDay();
      const [eggs] = store.meals();

      store.openMeal(eggs!.id);
      expect(store.phase()).toBe('review');
      expect(store.activeMealPosition()).toEqual({ index: 1, total: 2 });
      expect(store.analysis()?.analysisId).toBe('a-breakfast');
      expect(store.name()).toBe('Eggs');
      expect(store.mealType()).toBe('breakfast');
      expect(store.dateTime()).toBe('2026-10-04T07:45');
      expect(store.canSaveDraft()).toBe(false);

      store.name.set('Scrambled eggs');
      store.dateTime.set('2026-10-04T14:10');
      store.closeMeal();

      expect(store.phase()).toBe('meals');
      expect(store.activeMeal()).toBeNull();
      expect(store.meals().map((meal) => [meal.name, meal.dateTime])).toEqual([
        ['Chicken wrap', '2026-10-04T13:00'],
        ['Scrambled eggs', '2026-10-04T14:10'],
      ]);
    });

    it('saves a reviewed meal on its own and returns to the ones left', async () => {
      await describeDay();
      store.openMeal(store.meals()[0]!.id);

      const first = await store.save();

      expect(first).toMatchObject({ remaining: 1, current: true });
      expect(api.createEntry.mock.calls[0]![0]).toMatchObject({
        name: 'Eggs',
        description: 'Eggs words',
        mealType: 'breakfast',
        source: 'text',
        localDate: '2026-10-04',
        analysisId: 'a-breakfast',
        photoId: null,
      });
      expect(store.phase()).toBe('meals');
      expect(store.meals().map((meal) => meal.name)).toEqual(['Chicken wrap']);

      store.openMeal(store.meals()[0]!.id);
      const last = await store.save();

      expect(last).toMatchObject({ remaining: 0 });
      expect(store.phase()).toBe('saved');
      expect(store.view()).toBe('review');
      expect(store.meals()).toEqual([]);
    });

    it('saves every meal in order', async () => {
      await describeDay();

      const outcome = await store.saveMeals();

      expect(outcome).toMatchObject({ failed: false, current: true });
      expect(outcome?.entries).toHaveLength(2);
      expect(
        api.createEntry.mock.calls.map(([body]) => [
          body.name,
          body.mealType,
          body.analysisId,
          new Date(body.timestamp).getHours(),
          body.items[0]?.name,
        ]),
      ).toEqual([
        ['Eggs', 'breakfast', 'a-breakfast', 7, 'Eggs item'],
        ['Chicken wrap', 'lunch', 'a-lunch', 13, 'Chicken wrap item'],
      ]);
      expect(store.phase()).toBe('saved');
      expect(store.view()).toBe('meals');
      expect(store.hasUnsavedWork()).toBe(false);
    });

    it('keeps the meals that were not saved when saving stops half-way', async () => {
      await describeDay();
      api.createEntry
        .mockImplementationOnce(async (body) => entryFrom(body))
        .mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));

      const outcome = await store.saveMeals();

      expect(outcome).toMatchObject({ failed: true });
      expect(outcome?.entries).toHaveLength(1);
      expect(store.phase()).toBe('meals');
      expect(store.mealsSaving()).toBe(false);
      expect(store.mealsError()).toBeTruthy();
      expect(store.meals().map((meal) => meal.name)).toEqual(['Chicken wrap']);
    });

    it('saves nothing while one meal still needs a look', async () => {
      await describeDay({
        ...dayResponse(),
        moreMeals: [mealResponse('a-empty', 'Mystery', null, [])],
      });

      expect(await store.saveMeals()).toBeNull();
      expect(api.createEntry).not.toHaveBeenCalled();
      expect(store.mealsError()).toBe(mealNeedsLook('Mystery'));
    });

    it('removes meals and leaves the flow with the last one', async () => {
      await describeDay();
      const [eggs, wrap] = store.meals();

      store.removeMeal(eggs!.id);
      expect(store.meals().map((meal) => meal.name)).toEqual(['Chicken wrap']);
      expect(store.phase()).toBe('meals');

      store.removeMeal(wrap!.id);
      expect(store.phase()).toBe('idle');
      expect(store.hasUnsavedWork()).toBe(false);
    });

    it('moves the meals to another day and one meal to another time', async () => {
      await describeDay({
        ...dayResponse(),
        moreMeals: [mealResponse('a-late', 'Toast', { mealType: null, time: '09:00', daysAgo: 0 })],
      });
      const toast = store.meals().find((meal) => meal.name === 'Toast')!;
      expect(toast).toMatchObject({ mealType: 'breakfast', mealTypeAuto: true });

      store.setMealsDay('2026-10-03');
      store.setMealTime(toast.id, '19:15');

      expect(store.meals().map((meal) => [meal.name, meal.dateTime, meal.mealType])).toEqual([
        ['Chicken wrap', '2026-10-03T13:00', 'lunch'],
        ['Toast', '2026-10-03T19:15', 'dinner'],
      ]);
    });

    it('places a single described meal where the description says it was eaten', async () => {
      await describeDay(
        mealResponse('a-1', 'Shawarma', { mealType: 'dinner', time: null, daysAgo: 1 }),
      );

      expect(store.phase()).toBe('review');
      expect(store.meals()).toEqual([]);
      expect(store.dateTime()).toBe('2026-10-03T20:00');
      expect(store.mealType()).toBe('dinner');
      expect(store.mealTypeAuto()).toBe(false);
      expect(store.buildEntryRequest()).toMatchObject({ localDate: '2026-10-03' });
    });

    it('logs a single described meal now when it gives no timing', async () => {
      await describeDay(
        mealResponse('a-1', 'Shawarma', { mealType: null, time: null, daysAgo: 0 }),
      );

      expect(store.phase()).toBe('review');
      expect(store.dateTime()).toBe(currentDateTimeInput(NOW));
      expect(store.mealType()).toBe('dinner');
      expect(store.mealTypeAuto()).toBe(true);
    });
  });
});
