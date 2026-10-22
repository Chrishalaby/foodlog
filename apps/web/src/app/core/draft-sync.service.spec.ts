import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CreateDraftFields, DraftDto, UserDto } from '@food/shared';
import { ApiService, type AnalyzeImage } from './api.service';
import { AuthService } from './auth.service';
import {
  DRAFT_RETRY_BASE_MS,
  DRAFT_RETRY_MAX_MS,
  DraftSyncService,
  classifyUploadError,
  draftRetryDelay,
  isServerUnreachable,
  matchesUploadedDraft,
} from './draft-sync.service';
import { NetworkService } from './network.service';
import {
  OFFLINE_DRAFTS_BACKEND,
  OfflineDraftsStore,
  memoryDraftsBackend,
  type LocalDraft,
} from './offline-drafts.store';

const ALICE: UserDto = { id: 'user-alice', email: 'a@example.com', name: 'Alice', role: 'member' };

const FIELDS: CreateDraftFields = {
  mode: 'food_photo',
  description: 'Lentil soup',
  mealType: 'dinner',
  timestamp: '2026-09-30T18:40:00.000Z',
  localDate: '2026-09-30',
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function serverDraft(overrides: Partial<DraftDto> = {}): DraftDto {
  return {
    portion: null,
    id: 'draft-1',
    mode: 'food_photo',
    name: null,
    description: 'Lentil soup',
    mealType: 'dinner',
    timestamp: FIELDS.timestamp,
    localDate: FIELDS.localDate,
    items: null,
    analysisId: null,
    photos: [
      {
        role: 'food',
        photo: {
          id: 'p1',
          url: '/api/photos/p1',
          thumbUrl: '/api/photos/p1/thumb',
          width: 1,
          height: 1,
        },
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function localDraft(overrides: Partial<LocalDraft> = {}): LocalDraft {
  return {
    localId: 'local-1',
    userId: ALICE.id,
    fields: FIELDS,
    images: [{ blob: new Blob(['x'], { type: 'image/jpeg' }), role: 'food' }],
    photoId: null,
    createdAt: '2026-09-30T18:41:00.000Z',
    attempts: 0,
    nextAttemptAt: 0,
    firstSentAt: null,
    lastSentAt: null,
    failure: null,
    ...overrides,
  };
}

describe('draft sync helpers', () => {
  it('backs off exponentially up to five minutes', () => {
    expect(draftRetryDelay(1)).toBe(DRAFT_RETRY_BASE_MS);
    expect(draftRetryDelay(2)).toBe(DRAFT_RETRY_BASE_MS * 2);
    expect(draftRetryDelay(4)).toBe(DRAFT_RETRY_BASE_MS * 8);
    expect(draftRetryDelay(30)).toBe(DRAFT_RETRY_MAX_MS);
  });

  it('tells offline, retryable, auth and rejected upload failures apart', () => {
    expect(classifyUploadError(new HttpErrorResponse({ status: 0 }))).toBe('offline');
    expect(classifyUploadError(new HttpErrorResponse({ status: 503 }))).toBe('retry');
    expect(classifyUploadError(new HttpErrorResponse({ status: 429 }))).toBe('retry');
    expect(classifyUploadError(new Error('boom'))).toBe('retry');
    expect(classifyUploadError(new HttpErrorResponse({ status: 401 }))).toBe('auth');
    expect(classifyUploadError(new HttpErrorResponse({ status: 400 }))).toBe('rejected');
    expect(classifyUploadError(new HttpErrorResponse({ status: 413 }))).toBe('rejected');
  });

  it('treats a dropped connection or a restarting server as unreachable', () => {
    expect(isServerUnreachable(new HttpErrorResponse({ status: 0 }))).toBe(true);
    expect(isServerUnreachable(new HttpErrorResponse({ status: 502 }))).toBe(true);
    expect(isServerUnreachable(new HttpErrorResponse({ status: 504 }))).toBe(true);
    expect(isServerUnreachable(new HttpErrorResponse({ status: 500 }))).toBe(false);
    expect(isServerUnreachable(new HttpErrorResponse({ status: 409 }))).toBe(false);
    expect(isServerUnreachable(new Error('boom'))).toBe(false);
  });

  it('only matches a server draft created by an earlier uncertain upload of the same draft', () => {
    const sent = Date.parse('2026-09-30T18:45:00.000Z');
    const local = localDraft({ firstSentAt: sent, lastSentAt: sent });
    const twin = serverDraft({ createdAt: '2026-09-30T18:45:02.000Z' });

    expect(matchesUploadedDraft(local, twin)).toBe(true);
    expect(matchesUploadedDraft(localDraft(), twin)).toBe(false);
    expect(matchesUploadedDraft(local, { ...twin, timestamp: '2026-09-30T18:41:00.000Z' })).toBe(
      false,
    );
    expect(matchesUploadedDraft(local, { ...twin, description: 'Soup' })).toBe(false);
    expect(matchesUploadedDraft(local, { ...twin, photos: [] })).toBe(false);
    expect(matchesUploadedDraft(local, { ...twin, createdAt: '2026-09-29T18:45:00.000Z' })).toBe(
      false,
    );
  });
});

describe('DraftSyncService', () => {
  let online: ReturnType<typeof signal<boolean>>;
  let user: ReturnType<typeof signal<UserDto | null>>;
  let store: OfflineDraftsStore;
  let service: DraftSyncService;
  const api = {
    listDrafts: vi.fn<() => Promise<DraftDto[]>>(),
    createDraft:
      vi.fn<(fields: CreateDraftFields, images?: readonly AnalyzeImage[]) => Promise<DraftDto>>(),
  };

  beforeEach(() => {
    api.listDrafts.mockReset().mockResolvedValue([]);
    api.createDraft
      .mockReset()
      .mockImplementation(async (fields) =>
        serverDraft({ id: `draft-${fields.description}`, description: fields.description ?? null }),
      );
    online = signal(true);
    user = signal<UserDto | null>(ALICE);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user } },
        { provide: NetworkService, useValue: { online } },
        { provide: OFFLINE_DRAFTS_BACKEND, useFactory: memoryDraftsBackend },
      ],
    });
    store = TestBed.inject(OfflineDraftsStore);
    service = TestBed.inject(DraftSyncService);
  });

  async function keep(description: string, patch: Partial<LocalDraft> = {}): Promise<LocalDraft> {
    const saved = await store.add(
      {
        fields: { ...FIELDS, description },
        images: [{ blob: new Blob([description], { type: 'image/jpeg' }), role: 'food' }],
      },
      patch,
    );
    return saved!.draft;
  }

  it('uploads drafts saved on this phone as soon as it starts, without duplicating them', async () => {
    await keep('soup');
    await keep('bread');
    const uploaded: (DraftDto | null)[] = [];
    service.onUploaded((draft) => uploaded.push(draft));

    service.start();
    service.start();
    await service.sync();
    await flush();

    expect(api.createDraft).toHaveBeenCalledTimes(2);
    const [fields, images] = api.createDraft.mock.calls[0]!;
    expect(fields).toMatchObject({ mode: 'food_photo', mealType: 'dinner' });
    expect(images?.map((image) => image.role)).toEqual(['food']);
    expect(store.drafts()).toEqual([]);
    expect(uploaded.map((draft) => draft?.description).sort()).toEqual(['bread', 'soup']);
  });

  it('waits while offline and uploads once the connection is back', async () => {
    online.set(false);
    await keep('soup');
    service.start();
    await flush();
    expect(api.createDraft).not.toHaveBeenCalled();

    online.set(true);
    TestBed.tick();
    await vi.waitFor(() => expect(api.createDraft).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.drafts()).toEqual([]));
  });

  it('backs off after a network failure and tries again later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-30T19:00:00Z'));
      const draft = await keep('soup');
      await keep('bread');
      api.createDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

      service.start();
      await service.sync();
      await flush();
      expect(api.createDraft).toHaveBeenCalledTimes(1);
      const after = store.get(draft.localId) ?? store.drafts().find((d) => d.attempts > 0)!;
      expect(after).toMatchObject({
        attempts: 1,
        nextAttemptAt: Date.now() + DRAFT_RETRY_BASE_MS,
        firstSentAt: Date.now(),
        lastSentAt: Date.now(),
      });

      await service.sync();
      expect(api.createDraft).toHaveBeenCalledTimes(1);
      expect(store.drafts()).toHaveLength(2);

      vi.setSystemTime(new Date(Date.now() + DRAFT_RETRY_BASE_MS + 1));
      await service.sync();
      expect(api.createDraft).toHaveBeenCalledTimes(3);
      expect(store.drafts()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not upload twice when the first upload reached the server but the answer was lost', async () => {
    const sentAt = Date.now() - 60_000;
    await keep('Lentil soup', { attempts: 1, firstSentAt: sentAt, lastSentAt: sentAt });
    api.listDrafts.mockResolvedValue([serverDraft({ createdAt: new Date(sentAt).toISOString() })]);
    const uploaded: (DraftDto | null)[] = [];
    service.onUploaded((draft) => uploaded.push(draft));

    service.start();
    await service.sync({ force: true });

    expect(api.createDraft).not.toHaveBeenCalled();
    expect(store.drafts()).toEqual([]);
    expect(uploaded).toEqual([null]);
  });

  it('lets one server draft stand in for only one uncertain local draft', async () => {
    const sentAt = Date.now() - 60_000;
    await keep('Lentil soup', { attempts: 1, firstSentAt: sentAt, lastSentAt: sentAt });
    await keep('Lentil soup', { attempts: 1, firstSentAt: sentAt, lastSentAt: sentAt });
    api.listDrafts.mockResolvedValue([serverDraft({ createdAt: new Date(sentAt).toISOString() })]);

    service.start();
    await service.sync({ force: true });

    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(store.drafts()).toEqual([]);
  });

  it('does not upload a draft the user opened while the server list was loading', async () => {
    const sentAt = Date.now() - 60_000;
    const draft = await keep('soup', { attempts: 1, firstSentAt: sentAt, lastSentAt: sentAt });
    let answer!: (drafts: DraftDto[]) => void;
    api.listDrafts.mockImplementationOnce(
      () => new Promise<DraftDto[]>((resolve) => (answer = resolve)),
    );

    service.start();
    const run = service.sync({ force: true });
    await vi.waitFor(() => expect(api.listDrafts).toHaveBeenCalled());
    expect(service.claim(draft.localId)).toBe(true);
    answer([]);
    await run;

    expect(api.createDraft).not.toHaveBeenCalled();
    expect(store.get(draft.localId)).not.toBeNull();
  });

  it('remembers which server draft an upload became', async () => {
    const draft = await keep('soup');
    service.start();
    await service.sync({ force: true });

    expect(service.uploadedAs(draft.localId)).toBe('draft-soup');
    expect(service.claim(draft.localId)).toBe(false);
  });

  it('uploads again when no server draft matches the uncertain attempt', async () => {
    const sentAt = Date.now() - 60_000;
    await keep('Lentil soup', { attempts: 1, firstSentAt: sentAt, lastSentAt: sentAt });
    api.listDrafts.mockResolvedValue([
      serverDraft({
        timestamp: '2026-09-30T12:00:00.000Z',
        createdAt: new Date(sentAt).toISOString(),
      }),
    ]);

    service.start();
    await service.sync({ force: true });

    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(store.drafts()).toEqual([]);
  });

  it('marks a draft the server rejects and keeps going with the others', async () => {
    const rejected = await keep('huge');
    await keep('soup');
    api.createDraft.mockImplementationOnce(async () => {
      throw new HttpErrorResponse({
        status: 413,
        error: { statusCode: 413, message: 'File too large' },
      });
    });

    service.start();
    await service.sync({ force: true });
    await flush();

    const remaining = store.drafts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.failure).toBe('File too large.');
    expect(api.createDraft).toHaveBeenCalledTimes(2);

    await service.sync({ force: true });
    expect(api.createDraft).toHaveBeenCalledTimes(2);

    await service.retry(remaining[0]!.localId);
    expect(api.createDraft).toHaveBeenCalledTimes(3);
    expect(store.get(rejected.localId) ?? store.drafts()[0] ?? null).toBeNull();
  });

  it('lets the server reuse the analysis photos and uploads them only if the analysis is gone', async () => {
    await store.add({
      fields: { ...FIELDS, description: 'analysed', analysisId: 'analysis-1', items: '[]' },
      images: [{ blob: new Blob(['food'], { type: 'image/jpeg' }), role: 'food' }],
    });
    api.createDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));

    service.start();
    await service.sync({ force: true });

    expect(api.createDraft).toHaveBeenCalledTimes(2);
    const [first, firstImages] = api.createDraft.mock.calls[0]!;
    expect(first.analysisId).toBe('analysis-1');
    expect(firstImages).toEqual([]);
    const [second, secondImages] = api.createDraft.mock.calls[1]!;
    expect(second.analysisId).toBeUndefined();
    expect(second.items).toBe('[]');
    expect(secondImages?.map((image) => image.role)).toEqual(['food']);
    expect(store.drafts()).toEqual([]);
  });

  it('stops quietly when the session has expired', async () => {
    await keep('soup');
    api.createDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 401 }));

    service.start();
    await service.sync({ force: true });

    expect(store.drafts()[0]).toMatchObject({ attempts: 0, failure: null });
  });

  it('runs one upload at a time even when asked repeatedly', async () => {
    await keep('soup');
    let release!: () => void;
    api.createDraft.mockImplementationOnce(
      () =>
        new Promise<DraftDto>((resolve) => {
          release = () => resolve(serverDraft());
        }),
    );

    service.start();
    const first = service.sync({ force: true });
    const second = service.sync({ force: true });
    await flush();
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(service.syncing()).toBe(true);

    release();
    await Promise.all([first, second]);
    await flush();
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(store.drafts()).toEqual([]);
  });

  it('leaves a draft alone while it is open on screen', async () => {
    const draft = await keep('soup');
    service.start();
    expect(service.claim(draft.localId)).toBe(true);
    await service.sync({ force: true });
    expect(api.createDraft).not.toHaveBeenCalled();

    service.release(draft.localId);
    await vi.waitFor(() => expect(api.createDraft).toHaveBeenCalledTimes(1));
  });

  it('refuses to open a draft that is uploading right now', async () => {
    const draft = await keep('soup');
    let release!: () => void;
    api.createDraft.mockImplementationOnce(
      () =>
        new Promise<DraftDto>((resolve) => {
          release = () => resolve(serverDraft());
        }),
    );
    service.start();
    await flush();
    await flush();

    expect(service.isUploading(draft.localId)).toBe(true);
    expect(service.claim(draft.localId)).toBe(false);
    release();
    await vi.waitFor(() => expect(service.isUploading(draft.localId)).toBe(false));
  });

  it('remembers an uncertain first attempt when keeping a draft locally', async () => {
    online.set(false);
    const attemptedAt = Date.now();
    const saved = await service.keepLocally({ fields: FIELDS, images: [] }, attemptedAt);

    expect(saved?.draft).toMatchObject({
      attempts: 1,
      firstSentAt: attemptedAt,
      lastSentAt: attemptedAt,
      nextAttemptAt: attemptedAt + DRAFT_RETRY_BASE_MS,
    });
    const offline = await service.keepLocally({ fields: FIELDS, images: [] }, null);
    expect(offline?.draft).toMatchObject({ attempts: 0, firstSentAt: null, nextAttemptAt: 0 });
  });

  it('checks again when the app comes back to the foreground', async () => {
    service.start();
    await service.sync();
    await keep('soup');
    expect(api.createDraft).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(api.createDraft).toHaveBeenCalledTimes(1));
  });

  it('does nothing without a signed-in user', async () => {
    await keep('soup');
    user.set(null);
    service.start();
    await service.sync({ force: true });
    expect(api.createDraft).not.toHaveBeenCalled();
  });
});
