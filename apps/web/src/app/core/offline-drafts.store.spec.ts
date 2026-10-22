import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CreateDraftFields, UserDto } from '@food/shared';
import { AuthService } from './auth.service';
import {
  OFFLINE_DB_NAME,
  OFFLINE_DRAFTS_BACKEND,
  OFFLINE_DRAFTS_STORE,
  OfflineDraftsStore,
  indexedDbDraftsBackend,
  isDraftFields,
  memoryDraftsBackend,
  type LocalDraft,
  type OfflineDraftsBackend,
} from './offline-drafts.store';
import { FakeIndexedDb } from './testing/fake-indexed-db';

const ALICE: UserDto = { id: 'user-alice', email: 'a@example.com', name: 'Alice', role: 'member' };
const BOB: UserDto = { id: 'user-bob', email: 'b@example.com', name: 'Bob', role: 'member' };

const FIELDS: CreateDraftFields = {
  mode: 'food_photo',
  description: 'Chicken shawarma, no garlic sauce',
  mealType: 'lunch',
  timestamp: '2026-09-30T10:15:00.000Z',
  localDate: '2026-09-30',
};

const jpeg = (text: string): Blob => new Blob([text], { type: 'image/jpeg' });

async function blobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

function spyBackend(inner: OfflineDraftsBackend = memoryDraftsBackend()) {
  return {
    list: vi.fn(() => inner.list()),
    put: vi.fn((draft: LocalDraft) => inner.put(draft)),
    delete: vi.fn((id: string) => inner.delete(id)),
  };
}

describe('OfflineDraftsStore', () => {
  let user: ReturnType<typeof signal<UserDto | null>>;
  let backend: ReturnType<typeof spyBackend>;

  function setup(custom: OfflineDraftsBackend = memoryDraftsBackend()): OfflineDraftsStore {
    user = signal<UserDto | null>(ALICE);
    backend = spyBackend(custom);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user } },
        { provide: OFFLINE_DRAFTS_BACKEND, useValue: backend },
      ],
    });
    return TestBed.inject(OfflineDraftsStore);
  }

  it('keeps a draft with its photos for the signed-in user and persists it', async () => {
    const store = setup();
    const saved = await store.add({
      fields: FIELDS,
      images: [{ blob: jpeg('food'), role: 'food' }],
      photoId: 'photo-9',
    });

    expect(saved?.persisted).toBe(true);
    expect(saved?.draft).toMatchObject({
      userId: ALICE.id,
      fields: FIELDS,
      photoId: 'photo-9',
      attempts: 0,
      failure: null,
    });
    expect(store.drafts()).toHaveLength(1);
    expect(backend.put).toHaveBeenCalledTimes(1);
  });

  it('never shows one account the drafts another account left on this phone', async () => {
    const store = setup();
    await store.add({ fields: FIELDS, images: [] });
    user.set(BOB);
    expect(store.drafts()).toEqual([]);
    user.set(null);
    expect(store.drafts()).toEqual([]);
    expect(await store.add({ fields: FIELDS, images: [] })).toBeNull();
    user.set(ALICE);
    expect(store.drafts()).toHaveLength(1);
  });

  it('lists the newest draft first', async () => {
    const store = setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-30T08:00:00Z'));
      await store.add({ fields: { ...FIELDS, description: 'first' }, images: [] });
      vi.setSystemTime(new Date('2026-09-30T09:00:00Z'));
      await store.add({ fields: { ...FIELDS, description: 'second' }, images: [] });
    } finally {
      vi.useRealTimers();
    }
    expect(store.drafts().map((draft) => draft.fields.description)).toEqual(['second', 'first']);
  });

  it('restores persisted drafts after a reload', async () => {
    const shared = memoryDraftsBackend();
    const first = setup(shared);
    await first.add({ fields: FIELDS, images: [{ blob: jpeg('x'), role: 'label' }] });
    TestBed.resetTestingModule();

    const second = setup(shared);
    expect(second.drafts()).toEqual([]);
    await second.load();
    expect(second.drafts()).toHaveLength(1);
    expect(second.drafts()[0]?.images[0]?.role).toBe('label');
  });

  it('keeps a draft in memory when the phone refuses to store it', async () => {
    const store = setup({
      list: async () => [],
      put: async () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      delete: async () => undefined,
    });
    const saved = await store.add({ fields: FIELDS, images: [] });
    expect(saved?.persisted).toBe(false);

    await store.refresh();
    expect(store.drafts().map((draft) => draft.localId)).toEqual([saved?.draft.localId]);
  });

  it('does not bring a removed draft back when deleting it from storage failed', async () => {
    const inner = memoryDraftsBackend();
    const store = setup(inner);
    const saved = await store.add({ fields: FIELDS, images: [] });
    backend.delete.mockRejectedValueOnce(new Error('busy'));

    await store.remove(saved!.draft.localId);
    expect(store.drafts()).toEqual([]);
    expect(await inner.list()).toHaveLength(1);

    await store.refresh();
    expect(store.drafts()).toEqual([]);
    expect(await inner.list()).toHaveLength(0);
  });

  it('keeps the same photos across refreshes so thumbnails do not reload', async () => {
    const shared = indexedDbDraftsBackend(new FakeIndexedDb().asFactory());
    const store = setup(shared);
    const saved = await store.add({ fields: FIELDS, images: [{ blob: jpeg('a'), role: 'food' }] });

    await store.refresh();
    await store.refresh();

    expect(store.drafts()[0]?.images).toBe(saved!.draft.images);
  });

  it('does not lose a draft that is still being written when the list refreshes', async () => {
    const inner = memoryDraftsBackend();
    let finishWrite!: () => void;
    const store = setup({
      list: () => inner.list(),
      put: (draft) =>
        new Promise<void>((resolve) => {
          finishWrite = () => void inner.put(draft).then(resolve);
        }),
      delete: (id) => inner.delete(id),
    });

    const adding = store.add({ fields: FIELDS, images: [] });
    await store.refresh();
    expect(store.drafts()).toHaveLength(1);

    finishWrite();
    expect((await adding)?.persisted).toBe(true);
    await store.refresh();
    expect(store.drafts()).toHaveLength(1);
  });

  it('updates retry bookkeeping without touching the photos', async () => {
    const store = setup();
    const saved = await store.add({ fields: FIELDS, images: [{ blob: jpeg('a'), role: 'food' }] });
    const id = saved!.draft.localId;
    const updated = await store.update(id, { attempts: 2, nextAttemptAt: 123, failure: 'Nope.' });

    expect(updated).toMatchObject({ attempts: 2, nextAttemptAt: 123, failure: 'Nope.' });
    expect(updated?.images).toBe(saved!.draft.images);
    expect(await store.update('missing', { attempts: 1 })).toBeNull();
  });
});

describe('indexedDbDraftsBackend', () => {
  function draft(overrides: Partial<LocalDraft> = {}): LocalDraft {
    return {
      localId: 'local-1',
      userId: ALICE.id,
      fields: FIELDS,
      images: [
        { blob: jpeg('plate'), role: 'food' },
        { blob: jpeg('label'), role: 'label' },
      ],
      photoId: null,
      createdAt: '2026-09-30T10:16:00.000Z',
      attempts: 0,
      nextAttemptAt: 0,
      firstSentAt: null,
      lastSentAt: null,
      failure: null,
      ...overrides,
    };
  }

  it('stores drafts with their photos and reads them back', async () => {
    const idb = new FakeIndexedDb();
    const backend = indexedDbDraftsBackend(idb.asFactory());
    await backend.put(draft());

    const [restored] = await indexedDbDraftsBackend(idb.asFactory()).list();
    expect(restored).toMatchObject({ localId: 'local-1', fields: FIELDS, userId: ALICE.id });
    expect(restored?.images.map((image) => image.role)).toEqual(['food', 'label']);
    expect(await blobText(restored!.images[0]!.blob)).toBe('plate');
    expect(restored?.images[1]?.blob.type).toBe('image/jpeg');
    expect(idb.databases.get(OFFLINE_DB_NAME)?.stores.has(OFFLINE_DRAFTS_STORE)).toBe(true);
  });

  it('deletes drafts and reuses one connection', async () => {
    const idb = new FakeIndexedDb();
    const backend = indexedDbDraftsBackend(idb.asFactory());
    await backend.put(draft());
    await backend.put(draft({ localId: 'local-2' }));
    await backend.delete('local-1');

    expect((await backend.list()).map((stored) => stored.localId)).toEqual(['local-2']);
    expect(idb.openCalls).toBe(1);
  });

  it('skips records that are not valid drafts', async () => {
    const idb = new FakeIndexedDb();
    const backend = indexedDbDraftsBackend(idb.asFactory());
    await backend.put(draft());
    idb.databases
      .get(OFFLINE_DB_NAME)!
      .stores.get(OFFLINE_DRAFTS_STORE)!
      .set('broken', { localId: 'broken', fields: { mode: 'banana' }, images: [] });

    expect((await backend.list()).map((stored) => stored.localId)).toEqual(['local-1']);
  });

  it('rejects writes the browser refuses so the caller can fall back', async () => {
    const idb = new FakeIndexedDb();
    const backend = indexedDbDraftsBackend(idb.asFactory());
    await backend.put(draft());
    idb.setFailWrites(OFFLINE_DB_NAME, true);

    await expect(backend.put(draft({ localId: 'local-2' }))).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });

  it('retries opening the database after a failure', async () => {
    const idb = new FakeIndexedDb();
    idb.failOpen = true;
    const backend = indexedDbDraftsBackend(idb.asFactory());
    await expect(backend.list()).rejects.toMatchObject({ name: 'InvalidStateError' });

    idb.failOpen = false;
    await expect(backend.list()).resolves.toEqual([]);
    expect(idb.openCalls).toBe(2);
  });
});

describe('isDraftFields', () => {
  it('accepts create-draft fields and rejects anything else', () => {
    expect(isDraftFields(FIELDS)).toBe(true);
    expect(isDraftFields({ ...FIELDS, items: '[]', analysisId: 'a-1' })).toBe(true);
    expect(isDraftFields({ ...FIELDS, mode: 'menu' })).toBe(false);
    expect(isDraftFields({ ...FIELDS, mealType: 'brunch' })).toBe(false);
    expect(isDraftFields({ ...FIELDS, timestamp: 5 })).toBe(false);
    expect(isDraftFields(null)).toBe(false);
  });
});
