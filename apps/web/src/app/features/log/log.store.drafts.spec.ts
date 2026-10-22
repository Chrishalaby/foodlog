import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  zeroNutrients,
  type AnalyzeRequestFields,
  type AnalyzeResponse,
  type CreateDraftFields,
  type CreateEntryRequest,
  type DraftDto,
  type EntryDto,
  type EntryListQuery,
  type EntryListResponse,
  type LogDraftRequest,
  type PhotoRef,
  type UpdateDraftRequest,
  type UpdateEntryRequest,
  type UserDto,
} from '@food/shared';
import { ApiService, type AnalyzeImage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { DraftSyncService } from '../../core/draft-sync.service';
import { NetworkService } from '../../core/network.service';
import { localDateOf } from '../../core/time';
import {
  OFFLINE_DRAFTS_BACKEND,
  OfflineDraftsStore,
  memoryDraftsBackend,
  type LocalDraft,
} from '../../core/offline-drafts.store';
import type { CompressOptions, CompressedImage } from '../../shared/utils/image-compress';
import { DraftsStore } from './drafts/drafts.store';
import { currentDateTimeInput } from './entry-timing';
import { IMAGE_COMPRESSOR, LogStore, PHOTO_TIME_READER, type PhotoTimeReader } from './log.store';

const ALICE: UserDto = { id: 'user-alice', email: 'a@example.com', name: 'Alice', role: 'member' };

const PHOTO: PhotoRef = {
  id: 'photo-1',
  url: '/api/photos/photo-1',
  thumbUrl: '/api/photos/photo-1/thumb',
  width: 1200,
  height: 1600,
};

const LABEL_REF: PhotoRef = { ...PHOTO, id: 'photo-2', url: '/api/photos/photo-2' };

function analysis(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    analysisId: 'analysis-1',
    mode: 'food_photo',
    description: 'chicken rice',
    result: {
      inputType: 'food_photo',
      mealName: 'Chicken rice',
      portion: null,
      scaleCues: '',
      items: [
        {
          count: null,
          unit: null,
          unitPlural: null,
          name: 'Chicken rice',
          grams: 400,
          nutrients: { ...zeroNutrients(), calories: 620, protein: 38 },
          per100g: { ...zeroNutrients(), calories: 155, protein: 9.5 },
          micros: null,
          microsPer100g: null,
          fluidMl: null,
          confidence: 'medium',
          amountSource: 'visual_estimate',
          state: 'cooked',
          portionBasis: 'One plate',
          flags: [],
          savedFood: null,
          suggestedFood: null,
        },
      ],
      label: null,
      totals: zeroNutrients(),
      assumptions: [],
      followUpQuestion: null,
      followUpOptions: [],
      warnings: [],
    },
    photo: PHOTO,
    photos: [{ photo: PHOTO, role: 'food' }],
    usage: {
      model: 'mock',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      durationMs: 900,
      attempts: 1,
    },
    precise: false,
    ...overrides,
  };
}

function serverDraft(overrides: Partial<DraftDto> = {}): DraftDto {
  return {
    portion: null,
    id: 'draft-1',
    mode: 'food_photo',
    name: null,
    description: 'Mandi from the place downstairs',
    mealType: 'lunch',
    timestamp: new Date(2026, 8, 30, 13, 15).toISOString(),
    localDate: '2026-09-30',
    items: null,
    analysisId: null,
    photos: [
      { photo: PHOTO, role: 'food' },
      { photo: LABEL_REF, role: 'label' },
    ],
    createdAt: '2026-09-30T10:20:00.000Z',
    updatedAt: '2026-09-30T10:20:00.000Z',
    ...overrides,
  };
}

function entryFrom(
  body: { name: string; mealType: EntryDto['mealType'] } & Partial<EntryDto>,
): EntryDto {
  return {
    portion: null,
    id: 'entry-1',
    description: null,
    source: 'food_photo',
    timestamp: new Date().toISOString(),
    localDate: '2026-09-30',
    items: [],
    totals: zeroNutrients(),
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...body,
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

describe('LogStore drafts', () => {
  let store: LogStore;
  let online: ReturnType<typeof signal<boolean>>;
  let offline: OfflineDraftsStore;
  let drafts: DraftsStore;
  let compressor: ReturnType<
    typeof vi.fn<(file: Blob, options: CompressOptions) => Promise<CompressedImage>>
  >;
  let photoReader: ReturnType<typeof vi.fn<PhotoTimeReader>>;
  const api = {
    analyze:
      vi.fn<
        (fields: AnalyzeRequestFields, images?: readonly AnalyzeImage[]) => Promise<AnalyzeResponse>
      >(),
    createEntry: vi.fn<(body: CreateEntryRequest) => Promise<EntryDto>>(),
    createFavoriteFromEntry: vi.fn(),
    getProfile: vi.fn(),
    listDrafts: vi.fn<() => Promise<DraftDto[]>>(),
    createDraft:
      vi.fn<(fields: CreateDraftFields, images?: readonly AnalyzeImage[]) => Promise<DraftDto>>(),
    updateDraft: vi.fn<(id: string, body: UpdateDraftRequest) => Promise<DraftDto>>(),
    logDraft: vi.fn<(id: string, body: LogDraftRequest) => Promise<EntryDto>>(),
    updateEntry: vi.fn<(id: string, body: UpdateEntryRequest) => Promise<EntryDto>>(),
    deleteDraft: vi.fn(),
    listEntries: vi.fn<(query: EntryListQuery) => Promise<EntryListResponse>>(),
  };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getProfile.mockRejectedValue(new Error('no profile'));
    api.listDrafts.mockResolvedValue([]);
    api.analyze.mockResolvedValue(analysis());
    api.createEntry.mockImplementation(async (body) =>
      entryFrom({
        id: 'entry-new',
        name: body.name,
        mealType: body.mealType,
        analysisId: body.analysisId ?? null,
      }),
    );
    api.createDraft.mockImplementation(async (fields, images = []) =>
      serverDraft({
        id: 'draft-new',
        mode: fields.mode,
        name: fields.name ?? null,
        description: fields.description ?? null,
        mealType: fields.mealType ?? null,
        timestamp: fields.timestamp,
        localDate: fields.localDate,
        analysisId: fields.analysisId ?? null,
        items: fields.items ? JSON.parse(fields.items) : null,
        photos: images.map((image, index) => ({
          photo: { ...PHOTO, id: `up-${index}` },
          role: image.role,
        })),
      }),
    );
    api.updateDraft.mockImplementation(async (id, body) =>
      serverDraft({
        id,
        ...(body.analysisId !== undefined ? { analysisId: body.analysisId } : {}),
        ...(body.items !== undefined ? { items: body.items } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      }),
    );
    api.logDraft.mockImplementation(async (id, body) =>
      entryFrom({ id: `entry-from-${id}`, name: body.name, mealType: body.mealType }),
    );
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) =>
      blob instanceof File ? `blob:${blob.name}` : 'blob:preview',
    );
    URL.revokeObjectURL = vi.fn();
    online = signal(true);
    compressor = vi.fn(async (file: Blob) =>
      compressed(new Blob([`jpeg:${(file as File).name ?? 'blob'}`], { type: 'image/jpeg' })),
    );
    photoReader = vi.fn<PhotoTimeReader>(async () => null);
    TestBed.configureTestingModule({
      providers: [
        LogStore,
        { provide: ApiService, useValue: api },
        {
          provide: AuthService,
          useValue: { user: signal<UserDto | null>(ALICE), isAdmin: signal(false) },
        },
        { provide: NetworkService, useValue: { online } },
        { provide: IMAGE_COMPRESSOR, useValue: compressor },
        { provide: PHOTO_TIME_READER, useValue: photoReader },
        { provide: OFFLINE_DRAFTS_BACKEND, useFactory: memoryDraftsBackend },
      ],
    });
    store = TestBed.inject(LogStore);
    offline = TestBed.inject(OfflineDraftsStore);
    drafts = TestBed.inject(DraftsStore);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  const photo = (name = 'meal.jpg'): File => new File(['raw'], name, { type: 'image/jpeg' });

  function startPhoto(name = 'meal.jpg'): void {
    store.start({ file: photo(name), mode: 'food_photo', source: 'camera' });
  }

  async function reachReview(): Promise<void> {
    startPhoto();
    store.description.set('chicken rice');
    await store.analyze();
    expect(store.phase()).toBe('review');
  }

  async function keepLocal(overrides: Partial<CreateDraftFields> = {}): Promise<LocalDraft> {
    const saved = await offline.add({
      fields: {
        mode: 'food_photo',
        description: 'Kebab plate',
        mealType: 'dinner',
        timestamp: new Date(2026, 8, 29, 20, 10).toISOString(),
        localDate: '2026-09-29',
        ...overrides,
      },
      images: [
        { blob: new Blob(['stored-food'], { type: 'image/jpeg' }), role: 'food' },
        { blob: new Blob(['stored-label'], { type: 'image/jpeg' }), role: 'label' },
      ],
      photoId: 'photo-local',
    });
    return saved!.draft;
  }

  describe('save for later from compose', () => {
    it('uploads the photos, description and meal time as a draft', async () => {
      const takenAt = new Date(Date.now() - 2 * 3600_000);
      takenAt.setSeconds(0, 0);
      photoReader.mockResolvedValue(takenAt);
      store.start({ file: photo('lunch.jpg'), mode: 'food_photo', source: 'library' });
      store.addPhotos([photo('box.jpg')], 'library', 'label');
      store.description.set('  half a shawarma plate  ');
      await flush();
      expect(store.timeSource()).toBe('photo');
      expect(store.canSaveDraft()).toBe(true);

      const outcome = await store.saveDraft();

      expect(outcome?.kind).toBe('created');
      const [fields, images] = api.createDraft.mock.calls[0]!;
      expect(fields).toEqual({
        mode: 'food_photo',
        description: 'half a shawarma plate',
        mealType: expect.any(String),
        timestamp: takenAt.toISOString(),
        localDate: localDateOf(takenAt),
      });
      expect(images?.map((image) => image.role)).toEqual(['food', 'label']);
      expect(images?.[0]?.blob).toBeInstanceOf(Blob);
      expect(api.analyze).not.toHaveBeenCalled();
      expect(drafts.rows().map((row) => row.key)).toEqual(['server:draft-new']);
      expect(store.hasUnsavedWork()).toBe(false);
    });

    it('files a draft of a photo taken after midnight under the day before', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 2, 1, 30));
      try {
        setDayStartHour(DEFAULT_DAY_START_HOUR, null);
        const takenAt = new Date(2026, 9, 2, 0, 56);
        photoReader.mockResolvedValue(takenAt);
        store.start({ file: photo('apple.jpg'), mode: 'food_photo', source: 'library' });
        store.description.set('red apple');
        await flush();
        expect(store.timeSource()).toBe('photo');

        await store.saveDraft();

        expect(api.createDraft.mock.calls[0]![0]).toMatchObject({
          timestamp: takenAt.toISOString(),
          localDate: '2026-10-01',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('files a draft saved after midnight without a photo time under the day before', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const now = new Date(2026, 9, 2, 0, 56);
      vi.setSystemTime(now);
      try {
        setDayStartHour(DEFAULT_DAY_START_HOUR, null);
        store.start({ file: null, mode: 'text', source: 'text' });
        store.description.set('red apple');

        await store.saveDraft();

        expect(api.createDraft.mock.calls[0]![0]).toMatchObject({
          timestamp: now.toISOString(),
          localDate: '2026-10-01',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('saves a typed description as a text draft', async () => {
      store.start({ file: null, mode: 'text', source: 'text' });
      expect(store.canSaveDraft()).toBe(false);
      store.description.set('two eggs and toast');

      await store.saveDraft();

      const [fields, images] = api.createDraft.mock.calls[0]!;
      expect(fields).toMatchObject({ mode: 'text', description: 'two eggs and toast' });
      expect(fields.items).toBeUndefined();
      expect(fields.analysisId).toBeUndefined();
      expect(images).toEqual([]);
    });

    it('keeps the draft on this phone while offline', async () => {
      online.set(false);
      startPhoto();

      const outcome = await store.saveDraft();

      expect(outcome).toEqual({ kind: 'local', persisted: true, offline: true });
      expect(api.createDraft).not.toHaveBeenCalled();
      const [local] = offline.drafts();
      expect(local?.fields.mode).toBe('food_photo');
      expect(local?.images.map((image) => image.role)).toEqual(['food']);
      expect(await local?.images[0]?.blob.text()).toBe('jpeg:meal.jpg');
      expect(local?.firstSentAt).toBeNull();
      expect(drafts.rows()[0]?.upload).toBe('waiting');
    });

    it('keeps the draft on this phone when the upload cannot reach the server', async () => {
      api.createDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
      startPhoto();

      const outcome = await store.saveDraft();

      expect(outcome).toEqual({ kind: 'local', persisted: true, offline: true });
      const [local] = offline.drafts();
      expect(local?.attempts).toBe(1);
      expect(local?.firstSentAt).not.toBeNull();
    });

    it('keeps the draft on this phone while the server is restarting', async () => {
      api.createDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 502 }));
      startPhoto();

      const outcome = await store.saveDraft();

      expect(outcome).toEqual({ kind: 'local', persisted: true, offline: false });
      const [local] = offline.drafts();
      expect(local?.attempts).toBe(1);
      expect(local?.firstSentAt).not.toBeNull();
      expect(store.draftError()).toBeNull();
    });

    it('explains a server refusal and keeps the work on screen', async () => {
      api.createDraft.mockRejectedValueOnce(
        new HttpErrorResponse({
          status: 409,
          error: { statusCode: 409, message: 'You have 100 drafts already' },
        }),
      );
      startPhoto();

      expect(await store.saveDraft()).toBeNull();
      expect(store.draftError()).toBe('You have 100 drafts already.');
      expect(store.phase()).toBe('compose');
      expect(store.hasUnsavedWork()).toBe(true);
      expect(offline.drafts()).toEqual([]);
    });

    it('is not offered for a barcode label scan', () => {
      store.start({
        file: photo(),
        mode: 'nutrition_label',
        source: 'camera',
        barcode: '5000112637922',
      });
      expect(store.canSaveDraft()).toBe(false);
    });
  });

  describe('save as draft from review', () => {
    it('keeps the counted portion with the new draft', async () => {
      const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };
      await reachReview();
      store.portion.set(burgers);
      await store.saveDraft();
      const [fields] = api.createDraft.mock.calls[0]!;
      expect(JSON.parse(fields.portion!)).toEqual(burgers);
    });

    it('leaves the portion out of a draft without one', async () => {
      await reachReview();
      await store.saveDraft();
      expect(api.createDraft.mock.calls[0]![0].portion).toBeUndefined();
    });

    it('keeps the analysis and the edited items without uploading the photos again', async () => {
      await reachReview();
      store.items.update((items) => items.map((item) => ({ ...item, grams: 300 })));
      store.name.set('Lunch plate');
      api.analyze.mockResolvedValueOnce(
        analysis({
          analysisId: 'analysis-2',
          photos: [
            { photo: PHOTO, role: 'food' },
            { photo: LABEL_REF, role: 'label' },
          ],
        }),
      );
      await store.addLabelPhoto(photo('label.jpg'), 'camera');
      store.items.update((items) => items.map((item) => ({ ...item, grams: 250 })));

      const outcome = await store.saveDraft();

      expect(outcome?.kind).toBe('created');
      const [fields, images] = api.createDraft.mock.calls[0]!;
      expect(fields).toMatchObject({
        mode: 'food_photo',
        name: 'Lunch plate',
        description: 'chicken rice',
        analysisId: 'analysis-2',
        localDate: expect.any(String),
      });
      const items = JSON.parse(fields.items!) as { name: string; grams: number }[];
      expect(items).toEqual([expect.objectContaining({ name: 'Chicken rice', grams: 250 })]);
      expect(images).toEqual([]);
      expect(api.createDraft).toHaveBeenCalledTimes(1);
      expect(store.hasUnsavedWork()).toBe(false);
    });

    it('uploads the photos after all when the analysis has expired', async () => {
      await reachReview();
      api.analyze.mockResolvedValueOnce(analysis({ analysisId: 'analysis-2' }));
      await store.addLabelPhoto(photo('label.jpg'), 'camera');
      api.createDraft.mockRejectedValueOnce(
        new HttpErrorResponse({ status: 404, error: { statusCode: 404, message: 'Not found' } }),
      );

      const outcome = await store.saveDraft();

      expect(outcome?.kind).toBe('created');
      expect(api.createDraft).toHaveBeenCalledTimes(2);
      const [fields, images] = api.createDraft.mock.calls[1]!;
      expect(fields.analysisId).toBeUndefined();
      expect(fields.items).toContain('Chicken rice');
      expect(images?.map((image) => image.role)).toEqual(['food', 'label']);
    });

    it('keeps an analysed draft with its photos on this phone while offline', async () => {
      await reachReview();
      online.set(false);

      const outcome = await store.saveDraft();

      expect(outcome?.kind).toBe('local');
      const [local] = offline.drafts();
      expect(local?.fields.analysisId).toBe('analysis-1');
      expect(local?.photoId).toBe('photo-1');
      expect(local?.images.map((image) => image.role)).toEqual(['food']);
      expect(drafts.rows()[0]).toMatchObject({ analysed: true, upload: 'waiting' });
    });

    it('asks for fixes before saving an invalid draft', async () => {
      await reachReview();
      store.items.update((items) => items.map((item) => ({ ...item, name: ' ' })));
      store.name.set('');

      expect(await store.saveDraft()).toBeNull();
      expect(api.createDraft).not.toHaveBeenCalled();
      expect(store.visibleValidationError()).toBeTruthy();
    });
  });

  describe('resuming a server draft', () => {
    it('restores photos, description and time without re-uploading anything', async () => {
      const draft = serverDraft();
      expect(store.resumeDraft({ kind: 'server', draft })).toBe(true);

      expect(store.phase()).toBe('compose');
      expect(store.mode()).toBe('food_photo');
      expect(store.description()).toBe('Mandi from the place downstairs');
      expect(store.remotePhotos().map((ref) => ref.photo.id)).toEqual(['photo-1', 'photo-2']);
      expect(store.photoUrl()).toBe(PHOTO.url);
      expect(store.dateTime()).toBe(currentDateTimeInput(new Date(2026, 8, 30, 13, 15)));
      expect(store.mealType()).toBe('lunch');
      expect(store.canAnalyze()).toBe(true);
      expect(store.canAddPhoto()).toBe(false);
      expect(store.hasUnsavedWork()).toBe(false);

      store.description.set('Mandi, half the rice');
      expect(store.hasUnsavedWork()).toBe(true);
    });

    it('analyzes with the draft photos and stores the result on the draft', async () => {
      store.resumeDraft({ kind: 'server', draft: serverDraft() });

      await store.analyze();

      const [fields, images] = api.analyze.mock.calls[0]!;
      expect(fields).toMatchObject({
        mode: 'food_photo',
        draftId: 'draft-1',
        description: 'Mandi from the place downstairs',
      });
      expect(images).toEqual([]);
      expect(store.phase()).toBe('review');
      await flush();
      expect(api.updateDraft).toHaveBeenCalledWith('draft-1', {
        analysisId: 'analysis-1',
        items: [expect.objectContaining({ name: 'Chicken rice', grams: 400 })],
        portion: null,
        name: 'Chicken rice',
        description: 'chicken rice',
        mealType: store.mealType(),
        timestamp: new Date(2026, 8, 30, 13, 15).toISOString(),
        localDate: '2026-09-30',
      });
      expect(store.attachedDraft()?.analysisId).toBe('analysis-1');
      expect(store.hasUnsavedWork()).toBe(false);
      expect(drafts.find('draft-1')?.analysisId).toBe('analysis-1');
    });

    it('keeps the meal the draft was saved for through the analysis', async () => {
      store.resumeDraft({ kind: 'server', draft: serverDraft({ mealType: 'dinner' }) });

      await store.analyze();

      expect(api.analyze.mock.calls[0]![0]).toMatchObject({ mealType: 'dinner' });
      expect(store.mealType()).toBe('dinner');
      expect(store.dateTime()).toBe(currentDateTimeInput(new Date(2026, 8, 30, 13, 15)));
    });

    it('logs the draft in one step and removes it from the drafts', async () => {
      store.resumeDraft({ kind: 'server', draft: serverDraft() });
      await store.analyze();
      await flush();
      const events = TestBed.inject(DataEventsService);
      const before = events.entries();

      const outcome = await store.save();

      expect(outcome?.entry.id).toBe('entry-from-draft-1');
      expect(api.createEntry).not.toHaveBeenCalled();
      expect(api.updateDraft).toHaveBeenCalledTimes(1);
      const [id, body] = api.logDraft.mock.calls[0]!;
      expect(id).toBe('draft-1');
      expect(body).toMatchObject({
        name: 'Chicken rice',
        description: 'chicken rice',
        items: [expect.objectContaining({ name: 'Chicken rice' })],
      });
      expect(events.entries()).toBe(before + 1);
      expect(drafts.find('draft-1')).toBeNull();
    });

    it('updates the same draft instead of creating another one', async () => {
      store.resumeDraft({ kind: 'server', draft: serverDraft() });
      store.description.set('Mandi, no rice');

      const outcome = await store.saveDraft();

      expect(outcome?.kind).toBe('updated');
      expect(api.createDraft).not.toHaveBeenCalled();
      expect(api.updateDraft).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ description: 'Mandi, no rice', mealType: 'lunch' }),
      );
      expect(api.updateDraft.mock.calls[0]![1].items).toBeUndefined();
    });

    it('carries the portion of an analysed draft into review, updates and the log', async () => {
      const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };
      const draft = serverDraft({
        name: 'Burgers',
        analysisId: 'analysis-7',
        portion: burgers,
        items: [{ name: 'Burger', grams: 780, nutrients: { ...zeroNutrients(), calories: 1450 } }],
      });
      store.resumeDraft({ kind: 'server', draft });
      expect(store.portion()).toEqual(burgers);
      expect(store.canSaveDraft()).toBe(false);

      store.portion.set({ ...burgers, count: 1.5 });
      expect(store.canSaveDraft()).toBe(true);
      await store.saveDraft();
      expect(api.updateDraft).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ portion: { ...burgers, count: 1.5 } }),
      );

      store.resumeDraft({ kind: 'server', draft });
      await store.save();
      expect(api.logDraft.mock.calls[0]![1].portion).toEqual(burgers);
    });

    it('logs a draft without the portion the user removed in review', async () => {
      const draft = serverDraft({
        name: 'Burgers',
        analysisId: 'analysis-7',
        portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
        items: [{ name: 'Burger', grams: 780, nutrients: { ...zeroNutrients(), calories: 1450 } }],
      });
      store.resumeDraft({ kind: 'server', draft });
      store.portion.set(null);
      await store.save();
      expect(api.logDraft.mock.calls[0]![1]).toHaveProperty('portion', null);
    });

    it('reopens an analysed draft straight in review', async () => {
      const draft = serverDraft({
        name: 'Mandi',
        analysisId: 'analysis-7',
        items: [
          { name: 'Lamb mandi', grams: 450, nutrients: { ...zeroNutrients(), calories: 880 } },
        ],
      });
      store.resumeDraft({ kind: 'server', draft });

      expect(store.phase()).toBe('review');
      expect(store.name()).toBe('Mandi');
      expect(store.items()[0]).toMatchObject({ name: 'Lamb mandi', grams: 450 });
      expect(store.thumbUrl()).toBe(PHOTO.thumbUrl);
      expect(store.canCorrect()).toBe(true);
      expect(store.hasUnsavedWork()).toBe(false);
      expect(store.canSaveDraft()).toBe(false);

      await store.save();
      expect(api.updateDraft).not.toHaveBeenCalled();
      expect(api.logDraft).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ name: 'Mandi', mealType: 'lunch' }),
      );
    });

    describe('cover photo', () => {
      const DRAFT_PHOTOS = serverDraft().photos;
      const analysedDraft = (): DraftDto =>
        serverDraft({
          name: 'Mandi',
          analysisId: 'analysis-7',
          items: [{ name: 'Lamb mandi', grams: 450, nutrients: zeroNutrients() }],
        });

      beforeEach(() => {
        api.logDraft.mockImplementation(async (id, body) =>
          entryFrom({
            id: `entry-from-${id}`,
            name: body.name,
            mealType: body.mealType,
            photo: PHOTO,
            photos: DRAFT_PHOTOS,
          }),
        );
        api.updateEntry.mockImplementation(async (id, body) =>
          entryFrom({
            id,
            name: body.name,
            mealType: body.mealType,
            photo: body.coverPhotoId === LABEL_REF.id ? LABEL_REF : PHOTO,
            photos: DRAFT_PHOTOS,
          }),
        );
      });

      it('shows every draft photo with the first food photo as the cover', () => {
        store.resumeDraft({ kind: 'server', draft: analysedDraft() });
        expect(store.reviewPhotos()).toEqual(DRAFT_PHOTOS);
        expect(store.coverPhoto()?.id).toBe('photo-1');
      });

      it('moves the cover to the photo picked once the draft is logged', async () => {
        store.resumeDraft({ kind: 'server', draft: analysedDraft() });
        store.chooseCover('photo-2');
        expect(store.photoUrl()).toBe(LABEL_REF.url);

        const outcome = await store.save();

        expect(api.logDraft.mock.calls[0]![1]).not.toHaveProperty('coverPhotoId');
        expect(api.updateEntry).toHaveBeenCalledWith('entry-from-draft-1', {
          name: 'Mandi',
          description: null,
          mealType: 'lunch',
          timestamp: expect.any(String),
          localDate: '2026-09-30',
          items: [],
          portion: null,
          coverPhotoId: 'photo-2',
        });
        expect(outcome?.entry.photo?.id).toBe('photo-2');
        expect(outcome?.coverFailed).toBe(false);
      });

      it('leaves the logged entry alone when its cover is already the one picked', async () => {
        store.resumeDraft({ kind: 'server', draft: analysedDraft() });
        store.chooseCover('photo-1');
        await store.save();
        store.resumeDraft({ kind: 'server', draft: analysedDraft() });
        await store.save();
        expect(api.logDraft).toHaveBeenCalledTimes(2);
        expect(api.updateEntry).not.toHaveBeenCalled();
      });

      it('still logs the meal when moving the cover fails', async () => {
        api.updateEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
        store.resumeDraft({ kind: 'server', draft: analysedDraft() });
        store.chooseCover('photo-2');

        const outcome = await store.save();

        expect(outcome?.entry).toMatchObject({ id: 'entry-from-draft-1', photo: PHOTO });
        expect(outcome?.coverFailed).toBe(true);
        expect(store.phase()).toBe('saved');
      });

      it('drops the cover with the analysis when the fallback entry cannot use it', async () => {
        api.analyze.mockResolvedValueOnce(analysis({ photos: DRAFT_PHOTOS }));
        store.resumeDraft({ kind: 'server', draft: serverDraft() });
        await store.analyze();
        await flush();
        store.chooseCover('photo-2');
        api.logDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
        api.createEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));

        const outcome = await store.save();

        expect(outcome?.entry.id).toBe('entry-new');
        expect(api.createEntry.mock.calls[0]![0]).toMatchObject({
          analysisId: 'analysis-1',
          photoId: 'photo-2',
          coverPhotoId: 'photo-2',
        });
        expect(api.createEntry.mock.calls[1]![0]).toMatchObject({
          analysisId: null,
          photoId: null,
          coverPhotoId: null,
        });
        expect(api.updateEntry).not.toHaveBeenCalled();
      });
    });

    it('corrects an analysed draft and logs it with the new analysis', async () => {
      const draft = serverDraft({
        analysisId: 'analysis-7',
        items: [
          { name: 'Lamb mandi', grams: 450, nutrients: { ...zeroNutrients(), calories: 880 } },
        ],
      });
      store.resumeDraft({ kind: 'server', draft });
      api.analyze.mockResolvedValueOnce(analysis({ analysisId: 'analysis-8' }));
      api.updateDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

      await store.correct('It was chicken, not lamb');

      expect(api.analyze.mock.calls[0]![0]).toMatchObject({
        previousAnalysisId: 'analysis-7',
        followUpAnswer: 'It was chicken, not lamb',
        description: 'Mandi from the place downstairs',
      });
      await flush();
      expect(store.hasUnsavedWork()).toBe(true);

      await store.save();
      expect(api.updateDraft).toHaveBeenLastCalledWith('draft-1', { analysisId: 'analysis-8' });
      expect(api.logDraft).toHaveBeenCalledTimes(1);
    });

    it('offers to update an analysed draft once its time or meal changes', async () => {
      store.resumeDraft({
        kind: 'server',
        draft: serverDraft({
          analysisId: 'analysis-7',
          items: [{ name: 'Soup', grams: 300, nutrients: zeroNutrients() }],
        }),
      });
      expect(store.canSaveDraft()).toBe(false);

      store.pickMealType('dinner');

      expect(store.hasUnsavedWork()).toBe(true);
      expect(store.canSaveDraft()).toBe(true);
      const outcome = await store.saveDraft();
      expect(outcome?.kind).toBe('updated');
      expect(api.updateDraft).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ mealType: 'dinner', analysisId: 'analysis-7' }),
      );
    });

    it('keeps the draft attached when switching to manual entry', async () => {
      store.resumeDraft({ kind: 'server', draft: serverDraft() });

      store.startManual();

      expect(store.phase()).toBe('review');
      expect(store.attachedDraft()?.kind).toBe('server');
      expect(store.thumbUrl()).toBe(PHOTO.thumbUrl);
      expect(store.dateTime()).toBe(currentDateTimeInput(new Date(2026, 8, 30, 13, 15)));
      store.name.set('Mandi');
      store.items.update((items) =>
        items.map((item) => ({
          ...item,
          name: 'Mandi',
          grams: 400,
          nutrients: { ...item.nutrients, calories: 700 },
        })),
      );

      await store.save();

      expect(api.createEntry).not.toHaveBeenCalled();
      expect(api.logDraft).toHaveBeenCalledWith(
        'draft-1',
        expect.objectContaining({ name: 'Mandi', mealType: 'lunch' }),
      );
    });

    it('does not carry a draft into a fresh capture', () => {
      store.resumeDraft({ kind: 'server', draft: serverDraft() });

      startPhoto('new.jpg');

      expect(store.attachedDraft()).toBeNull();
      expect(store.description()).toBe('');
      expect(store.photos()).toHaveLength(1);
    });

    it('does not log a draft twice when the reply to the first save was lost', async () => {
      store.resumeDraft({
        kind: 'server',
        draft: serverDraft({
          analysisId: 'analysis-7',
          items: [{ name: 'Soup', grams: 300, nutrients: zeroNutrients() }],
        }),
      });
      api.logDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

      expect(await store.save()).toBeNull();
      expect(store.saveError()).toBeTruthy();

      const sent = api.logDraft.mock.calls[0]![1];
      const logged = entryFrom({
        id: 'entry-from-draft-1',
        name: sent.name,
        mealType: sent.mealType,
        timestamp: sent.timestamp,
        localDate: sent.localDate,
      });
      api.logDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
      api.listEntries.mockResolvedValueOnce({
        items: [entryFrom({ id: 'other', name: 'Toast', mealType: 'breakfast' }), logged],
        nextCursor: null,
      });

      const outcome = await store.save();

      expect(outcome?.entry.id).toBe('entry-from-draft-1');
      expect(api.listEntries).toHaveBeenCalledWith({
        from: sent.localDate,
        to: sent.localDate,
        limit: 100,
      });
      expect(api.createEntry).not.toHaveBeenCalled();
    });

    it('logs a normal entry when the unconfirmed save never reached the server', async () => {
      store.resumeDraft({
        kind: 'server',
        draft: serverDraft({
          analysisId: 'analysis-7',
          items: [{ name: 'Soup', grams: 300, nutrients: zeroNutrients() }],
        }),
      });
      api.logDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
      await store.save();
      api.logDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
      api.listEntries.mockResolvedValueOnce({ items: [], nextCursor: null });

      const outcome = await store.save();

      expect(outcome?.entry.id).toBe('entry-new');
      expect(api.createEntry).toHaveBeenCalledTimes(1);
    });

    it('keeps the save retryable when checking for the earlier save fails', async () => {
      store.resumeDraft({
        kind: 'server',
        draft: serverDraft({
          analysisId: 'analysis-7',
          items: [{ name: 'Soup', grams: 300, nutrients: zeroNutrients() }],
        }),
      });
      api.logDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
      await store.save();
      api.logDraft.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
      api.listEntries.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

      expect(await store.save()).toBeNull();
      expect(api.createEntry).not.toHaveBeenCalled();

      const sent = api.logDraft.mock.calls[0]![1];
      api.listEntries.mockResolvedValueOnce({
        items: [
          entryFrom({
            id: 'entry-from-draft-1',
            name: sent.name,
            mealType: sent.mealType,
            timestamp: sent.timestamp,
            localDate: sent.localDate,
          }),
        ],
        nextCursor: null,
      });

      expect((await store.save())?.entry.id).toBe('entry-from-draft-1');
      expect(api.createEntry).not.toHaveBeenCalled();
    });

    it('falls back to a normal entry when the draft is already gone', async () => {
      store.resumeDraft({
        kind: 'server',
        draft: serverDraft({
          analysisId: 'analysis-7',
          items: [{ name: 'Soup', grams: 300, nutrients: zeroNutrients() }],
        }),
      });
      api.logDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));

      const outcome = await store.save();

      expect(outcome?.entry.id).toBe('entry-new');
      expect(api.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({ analysisId: 'analysis-7', photoId: 'photo-1', name: 'Soup' }),
      );
      expect(api.listEntries).not.toHaveBeenCalled();
    });
  });

  describe('resuming a draft saved on this phone', () => {
    it('restores its photos without compressing them again and holds it back from syncing', async () => {
      const local = await keepLocal();
      const sync = TestBed.inject(DraftSyncService);

      expect(store.resumeDraft({ kind: 'local', draft: local })).toBe(true);

      expect(store.phase()).toBe('compose');
      expect(store.photos().map((p) => p.role)).toEqual(['food', 'label']);
      expect(store.description()).toBe('Kebab plate');
      expect(store.mealType()).toBe('dinner');
      expect(sync.claim(local.localId)).toBe(true);
      expect(compressor).not.toHaveBeenCalled();

      await store.analyze();
      const [, images] = api.analyze.mock.calls[0]!;
      expect(await images?.[0]?.blob.text()).toBe('stored-food');
      expect(images?.map((image) => image.role)).toEqual(['food', 'label']);
      expect(compressor).not.toHaveBeenCalled();

      await store.save();
      expect(api.createEntry).toHaveBeenCalledTimes(1);
      await flush();
      expect(offline.drafts()).toEqual([]);
    });

    it('logs an analysed local draft with its analysis and photo', async () => {
      const local = await keepLocal({
        analysisId: 'analysis-3',
        name: 'Kebab',
        items: JSON.stringify([{ name: 'Kebab', grams: 300, nutrients: zeroNutrients() }]),
      });
      store.resumeDraft({ kind: 'local', draft: local });

      expect(store.phase()).toBe('review');
      await store.save();

      expect(api.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Kebab',
          analysisId: 'analysis-3',
          photoId: 'photo-local',
        }),
      );
      await flush();
      expect(offline.get(local.localId)).toBeNull();
    });

    it('replaces the old copy when saved for later again', async () => {
      online.set(false);
      const local = await keepLocal();
      store.resumeDraft({ kind: 'local', draft: local });
      store.description.set('Kebab plate, extra garlic');

      const outcome = await store.saveDraft();

      expect(outcome?.kind).toBe('local');
      const kept = offline.drafts();
      expect(kept).toHaveLength(1);
      expect(kept[0]?.localId).not.toBe(local.localId);
      expect(kept[0]?.fields.description).toBe('Kebab plate, extra garlic');
      expect(kept[0]?.images.map((image) => image.role)).toEqual(['food', 'label']);
    });

    it('lets go of the draft when the screen closes it', async () => {
      const local = await keepLocal();
      const sync = TestBed.inject(DraftSyncService);
      const release = vi.spyOn(sync, 'release');
      store.resumeDraft({ kind: 'local', draft: local });

      store.discard();

      expect(release).toHaveBeenCalledWith(local.localId);
      expect(offline.get(local.localId)).not.toBeNull();
    });
  });
});
