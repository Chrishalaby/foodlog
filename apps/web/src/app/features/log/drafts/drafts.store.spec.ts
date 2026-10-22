import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CreateDraftFields, DraftDto, UserDto } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { DraftSyncService } from '../../../core/draft-sync.service';
import { NetworkService } from '../../../core/network.service';
import {
  OFFLINE_DRAFTS_BACKEND,
  OfflineDraftsStore,
  memoryDraftsBackend,
} from '../../../core/offline-drafts.store';
import { SessionScope } from '../../../core/session-scope';
import { DraftsStore } from './drafts.store';

const ALICE: UserDto = { id: 'user-alice', email: 'a@example.com', name: 'Alice', role: 'member' };

const FIELDS: CreateDraftFields = {
  mode: 'text',
  description: 'Falafel wrap',
  timestamp: '2026-09-30T11:00:00.000Z',
  localDate: '2026-09-30',
};

function draft(id: string, updatedAt: string, overrides: Partial<DraftDto> = {}): DraftDto {
  return {
    portion: null,
    id,
    mode: 'food_photo',
    name: null,
    description: id,
    mealType: null,
    timestamp: '2026-09-30T10:00:00.000Z',
    localDate: '2026-09-30',
    items: null,
    analysisId: null,
    photos: [],
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('DraftsStore', () => {
  let online: ReturnType<typeof signal<boolean>>;
  let offline: OfflineDraftsStore;
  let store: DraftsStore;
  const api = {
    listDrafts: vi.fn<() => Promise<DraftDto[]>>(),
    createDraft: vi.fn<(fields: CreateDraftFields) => Promise<DraftDto>>(),
    deleteDraft: vi.fn<(id: string) => Promise<void>>(),
  };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let urlSeq = 0;

  beforeEach(() => {
    api.listDrafts.mockReset().mockResolvedValue([]);
    api.createDraft.mockReset();
    api.deleteDraft.mockReset().mockResolvedValue(undefined);
    urlSeq = 0;
    URL.createObjectURL = vi.fn(() => `blob:thumb-${++urlSeq}`);
    URL.revokeObjectURL = vi.fn();
    online = signal(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: signal<UserDto | null>(ALICE) } },
        { provide: NetworkService, useValue: { online } },
        { provide: OFFLINE_DRAFTS_BACKEND, useFactory: memoryDraftsBackend },
      ],
    });
    offline = TestBed.inject(OfflineDraftsStore);
    store = TestBed.inject(DraftsStore);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('merges server drafts with drafts waiting on this phone, newest first', async () => {
    api.listDrafts.mockResolvedValue([
      draft('older', '2026-09-27T10:00:00.000Z'),
      draft('newer', '2026-09-28T12:00:00.000Z'),
    ]);
    await offline.add({
      fields: FIELDS,
      images: [{ blob: new Blob(['a'], { type: 'image/jpeg' }), role: 'food' }],
    });

    store.activate();
    await flush();

    expect(api.listDrafts).toHaveBeenCalledTimes(1);
    expect(store.status()).toBe('ready');
    const rows = store.rows();
    expect(rows.map((row) => row.title)).toEqual(['Falafel wrap', 'newer', 'older']);
    expect(rows[0]).toMatchObject({ upload: 'waiting', thumbs: ['blob:thumb-1'] });
    expect(store.count()).toBe(3);
  });

  it('does not reload a fresh list every time a screen shows it', async () => {
    store.activate();
    await flush();
    store.activate();
    await flush();
    expect(api.listDrafts).toHaveBeenCalledTimes(1);
  });

  it('keeps showing local drafts when the server list cannot load', async () => {
    api.listDrafts.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    await offline.add({ fields: FIELDS, images: [] });
    store.activate();
    await flush();

    expect(store.status()).toBe('error');
    expect(store.error()).toContain('offline');
    expect(store.rows().map((row) => row.title)).toEqual(['Falafel wrap']);
  });

  it('shows an uploaded draft right away and refreshes the list', async () => {
    await offline.add({ fields: FIELDS, images: [] });
    api.createDraft.mockResolvedValue(draft('uploaded', '2026-09-30T13:00:00.000Z'));
    store.activate();
    await flush();
    expect(store.rows()[0]?.upload).toBe('waiting');

    api.listDrafts.mockResolvedValue([draft('uploaded', '2026-09-30T13:00:00.000Z')]);
    online.set(true);
    TestBed.tick();
    await vi.waitFor(() => expect(api.createDraft).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.rows().map((row) => row.key)).toEqual(['server:uploaded']));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(api.listDrafts).toHaveBeenCalledTimes(2);
  });

  it('frees local thumbnails once a local draft is gone', async () => {
    const saved = await offline.add({
      fields: FIELDS,
      images: [{ blob: new Blob(['a'], { type: 'image/jpeg' }), role: 'food' }],
    });
    store.activate();
    await flush();
    expect(store.rows()[0]?.thumbs).toEqual(['blob:thumb-1']);

    await store.remove(store.rows()[0]!);
    expect(store.rows()).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1');
    expect(offline.get(saved!.draft.localId)).toBeNull();
    expect(api.deleteDraft).not.toHaveBeenCalled();
  });

  it('removes a server draft right away and restores it when the delete fails', async () => {
    api.listDrafts.mockResolvedValue([draft('d1', '2026-09-30T10:00:00.000Z')]);
    store.activate();
    await flush();
    const row = store.rows()[0]!;

    let fail!: (err: unknown) => void;
    api.deleteDraft.mockReturnValueOnce(new Promise<void>((_, reject) => (fail = reject)));
    const removing = store.remove(row);
    expect(store.rows()).toEqual([]);
    fail(new HttpErrorResponse({ status: 500 }));
    await expect(removing).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.rows().map((r) => r.key)).toEqual(['server:d1']);

    api.deleteDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    await store.remove(row);
    expect(store.rows()).toEqual([]);
  });

  it('deletes the uploaded copy when a local draft finished uploading before the delete', async () => {
    await offline.add({
      fields: FIELDS,
      images: [{ blob: new Blob(['a'], { type: 'image/jpeg' }), role: 'food' }],
    });
    store.activate();
    await flush();
    const localRow = store.rows()[0]!;
    api.createDraft.mockResolvedValue(draft('uploaded', '2026-09-30T12:00:00.000Z'));
    api.listDrafts.mockResolvedValue([draft('uploaded', '2026-09-30T12:00:00.000Z')]);
    online.set(true);
    TestBed.tick();
    await vi.waitFor(() => expect(store.rows().map((row) => row.key)).toEqual(['server:uploaded']));

    await store.remove(localRow);

    expect(api.deleteDraft).toHaveBeenCalledWith('uploaded');
    expect(store.rows()).toEqual([]);
  });

  it('ignores a list that was loading while a draft was saved', async () => {
    let answer!: (drafts: DraftDto[]) => void;
    api.listDrafts.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    store.activate();
    store.upsert(draft('fresh', '2026-09-30T14:00:00.000Z'));
    answer([]);
    await flush();
    expect(store.rows().map((row) => row.key)).toEqual(['server:fresh']);

    store.forget('fresh');
    expect(store.find('fresh')).toBeNull();
  });

  it('forgets everything when the session resets', async () => {
    api.listDrafts.mockResolvedValue([draft('d1', '2026-09-30T10:00:00.000Z')]);
    store.activate();
    await flush();
    TestBed.inject(SessionScope).reset();
    expect(store.server()).toEqual([]);
    expect(store.status()).toBe('idle');
  });

  it('starts background uploads when activated', () => {
    const start = vi.spyOn(TestBed.inject(DraftSyncService), 'start');
    store.activate();
    expect(start).toHaveBeenCalled();
  });
});
