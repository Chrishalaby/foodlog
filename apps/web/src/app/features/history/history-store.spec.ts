import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  zeroNutrients,
  type EntryDto,
  type EntryListQuery,
  type EntryListResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { SessionScope } from '../../core/session-scope';
import { HISTORY_CACHE_TTL_MS, HISTORY_PAGE_SIZE, HistoryStore } from './history-store';

function entry(id: string, timestamp: string, name = `Meal ${id}`): EntryDto {
  return {
    portion: null,
    id,
    name,
    description: null,
    mealType: 'lunch',
    source: 'manual',
    timestamp,
    localDate: timestamp.slice(0, 10),
    items: [],
    totals: zeroNutrients(),
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

class FakeApi {
  readonly listEntries = vi.fn<(query?: EntryListQuery) => Promise<EntryListResponse>>();
  readonly getEntry = vi.fn<(id: string) => Promise<EntryDto>>();
}

const ids = (list: readonly EntryDto[]): string[] => list.map((item) => item.id);

describe('HistoryStore', () => {
  const e = entry('e', '2026-09-28T12:00:00.000Z');
  const d = entry('d', '2026-09-28T08:00:00.000Z');
  const c = entry('c', '2026-09-27T12:00:00.000Z');
  const b = entry('b', '2026-09-26T12:00:00.000Z');
  const a = entry('a', '2026-09-25T12:00:00.000Z');
  let api: FakeApi;
  let store: HistoryStore;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    store = TestBed.inject(HistoryStore);
  });

  async function loadPages(): Promise<void> {
    api.listEntries
      .mockResolvedValueOnce({ items: [e, d], nextCursor: 'after-d' })
      .mockResolvedValueOnce({ items: [c, b], nextCursor: 'after-b' });
    await store.load('');
    await store.loadMore();
  }

  it('loads the first page, then the next one with the cursor and search term', async () => {
    api.listEntries
      .mockResolvedValueOnce({ items: [d, e], nextCursor: 'after-d' })
      .mockResolvedValueOnce({ items: [c], nextCursor: null });
    await store.load('oats');
    expect(api.listEntries).toHaveBeenLastCalledWith({ limit: HISTORY_PAGE_SIZE, q: 'oats' });
    expect(ids(store.entries())).toEqual(['e', 'd']);
    expect(store.hasMore()).toBe(true);

    await store.loadMore();
    expect(api.listEntries).toHaveBeenLastCalledWith({
      limit: HISTORY_PAGE_SIZE,
      q: 'oats',
      before: 'after-d',
    });
    expect(ids(store.entries())).toEqual(['e', 'd', 'c']);
    expect(store.hasMore()).toBe(false);
  });

  it('revalidates the newest page without dropping older pages that are already loaded', async () => {
    await loadPages();
    const fresh = entry('f', '2026-09-28T18:00:00.000Z');
    api.listEntries.mockResolvedValueOnce({ items: [fresh, e], nextCursor: 'after-e' });

    await store.revalidate();

    expect(ids(store.entries())).toEqual(['f', 'e', 'd', 'c', 'b']);
    api.listEntries.mockResolvedValueOnce({ items: [a], nextCursor: null });
    await store.loadMore();
    expect(api.listEntries).toHaveBeenLastCalledWith({
      limit: HISTORY_PAGE_SIZE,
      before: 'after-b',
    });
    expect(ids(store.entries())).toEqual(['f', 'e', 'd', 'c', 'b', 'a']);
    expect(store.moreError()).toBeNull();
  });

  it('keeps the oldest loaded entry after coming back from it unchanged', async () => {
    await loadPages();
    api.getEntry.mockResolvedValueOnce(b);

    await store.refreshEntry('b');

    expect(ids(store.entries())).toEqual(['e', 'd', 'c', 'b']);
  });

  it('applies edits from the entry page and drops entries deleted there', async () => {
    await loadPages();
    api.getEntry.mockResolvedValueOnce({ ...c, name: 'Renamed' });
    await store.refreshEntry('c');
    expect(store.entries().find((item) => item.id === 'c')?.name).toBe('Renamed');

    api.getEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    await store.refreshEntry('d');
    expect(ids(store.entries())).toEqual(['e', 'c', 'b']);
  });

  it('restores an optimistically removed entry even when it was the oldest loaded one', async () => {
    await loadPages();
    const removed = store.remove('b');
    expect(ids(store.entries())).toEqual(['e', 'd', 'c']);

    store.restore(removed!);

    expect(ids(store.entries())).toEqual(['e', 'd', 'c', 'b']);
    expect(store.hasMore()).toBe(true);
  });

  it('does not add a newly logged entry that belongs to pages not loaded yet', async () => {
    await loadPages();
    store.upsert(a);
    expect(ids(store.entries())).toEqual(['e', 'd', 'c', 'b']);
  });

  it('discards a page that arrives after a newer load started', async () => {
    await loadPages();
    const stale = deferred<EntryListResponse>();
    api.listEntries.mockReturnValueOnce(stale.promise);
    const more = store.loadMore();
    api.listEntries.mockResolvedValueOnce({ items: [e], nextCursor: null });
    await store.load('');
    stale.resolve({ items: [a], nextCursor: null });
    await more;

    expect(ids(store.entries())).toEqual(['e']);
  });

  it('clears results of a previous search when a new search fails, but keeps them on retry', async () => {
    api.listEntries.mockResolvedValueOnce({ items: [e, d], nextCursor: null });
    await store.load('rice');

    api.listEntries.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await store.load('rice');
    expect(store.status()).toBe('error');
    expect(ids(store.entries())).toEqual(['e', 'd']);

    api.listEntries.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await store.load('pasta');
    expect(store.status()).toBe('error');
    expect(store.entries()).toEqual([]);
    expect(store.error()).toContain('offline');
  });

  it('forgets loaded pages, the search, the return point and late responses when the session resets', async () => {
    await loadPages();
    store.rememberReturn({ entryId: 'c', scrollY: 640 });
    const late = deferred<EntryListResponse>();
    api.listEntries.mockReturnValueOnce(late.promise);
    const loading = store.load('oats');

    TestBed.inject(SessionScope).reset();
    late.resolve({ items: [a], nextCursor: null });
    await loading;

    expect(store.entries()).toEqual([]);
    expect(store.query()).toBe('');
    expect(store.status()).toBe('idle');
    expect(store.hasMore()).toBe(false);
    expect(store.canReuse()).toBe(false);
    expect(store.isStale()).toBe(true);
    expect(store.takeReturn()).toBeNull();
  });

  it('hands out a return point once and only within the cache window', async () => {
    store.rememberReturn({ entryId: 'c', scrollY: 640 }, 1_000);
    expect(store.takeReturn(2_000)).toEqual({ entryId: 'c', scrollY: 640 });
    expect(store.takeReturn(2_000)).toBeNull();

    store.rememberReturn({ entryId: 'c', scrollY: 640 }, 1_000);
    expect(store.takeReturn(1_000 + HISTORY_CACHE_TTL_MS)).toBeNull();
  });

  it('is reusable only while a successful load is fresh', async () => {
    expect(store.canReuse()).toBe(false);
    api.listEntries.mockResolvedValueOnce({ items: [e], nextCursor: null });
    await store.load('');
    expect(store.canReuse()).toBe(true);
    expect(store.canReuse(Date.now() + HISTORY_CACHE_TTL_MS)).toBe(false);
  });

  it('revalidates right away when entries change while the first page is loading', async () => {
    const events = TestBed.inject(DataEventsService);
    const first = deferred<EntryListResponse>();
    api.listEntries.mockReturnValueOnce(first.promise);
    const loading = store.load('');
    events.notify('entries');
    const fresh = entry('f', '2026-09-28T18:00:00.000Z');
    api.listEntries.mockResolvedValueOnce({ items: [fresh, e], nextCursor: null });
    first.resolve({ items: [e], nextCursor: null });
    await loading;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(api.listEntries).toHaveBeenCalledTimes(2);
    expect(ids(store.entries())).toEqual(['f', 'e']);
    expect(store.isStale()).toBe(false);
  });

  it('knows when entries changed since the last load and absorbs its own changes', async () => {
    const events = TestBed.inject(DataEventsService);
    expect(store.isStale()).toBe(true);
    api.listEntries.mockResolvedValueOnce({ items: [e], nextCursor: null });
    await store.load('');
    expect(store.isStale()).toBe(false);

    store.notifyLocalChange();
    expect(events.entries()).toBe(1);
    expect(store.isStale()).toBe(false);

    events.notify('entries');
    expect(store.isStale()).toBe(true);
    store.notifyLocalChange();
    expect(store.isStale()).toBe(true);

    api.listEntries.mockResolvedValueOnce({ items: [e, d], nextCursor: null });
    await store.revalidate();
    expect(store.isStale()).toBe(false);
    expect(ids(store.entries())).toEqual(['e', 'd']);
  });
});
