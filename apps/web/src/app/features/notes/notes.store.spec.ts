import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { NoteDto, NoteListQuery, NoteListResponse, UpdateNoteRequest } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { OFFLINE_MESSAGE } from '../../core/errors';
import { SessionScope } from '../../core/session-scope';
import type { NoteAttachment } from './notes-model';
import { NOTES_LOAD_FAILED, NOTES_PAGE_SIZE, NOTE_SEND_FAILED, NotesStore } from './notes.store';

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

function note(id: string, day: number, overrides: Partial<NoteDto> = {}): NoteDto {
  const createdAt = new Date(Date.UTC(2026, 9, day, 10)).toISOString();
  return {
    id,
    text: `Note ${id}`,
    photos: [],
    done: false,
    doneAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function page(notes: NoteDto[], nextCursor: string | null = null): NoteListResponse {
  return { notes, nextCursor };
}

function attachment(id: string): NoteAttachment {
  return { id, blob: new Blob([id]), previewUrl: `blob:${id}`, width: 800, height: 600 };
}

const offline = (): HttpErrorResponse => new HttpErrorResponse({ status: 0 });
const notFound = (): HttpErrorResponse =>
  new HttpErrorResponse({ status: 404, error: { message: 'Note not found' } });

describe('NotesStore', () => {
  const api = {
    listNotes: vi.fn<(query?: NoteListQuery) => Promise<NoteListResponse>>(),
    createNote: vi.fn<(text: string, images?: readonly Blob[]) => Promise<NoteDto>>(),
    updateNote: vi.fn<(id: string, body: UpdateNoteRequest) => Promise<NoteDto>>(),
    deleteNote: vi.fn<(id: string) => Promise<void>>(),
  };
  const A = note('a', 1);
  const B = note('b', 2);
  const C = note('c', 3);
  const D = note('d', 4);
  const originalRevoke = URL.revokeObjectURL;
  let store: NotesStore;

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.listNotes.mockResolvedValue(page([C, B]));
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    store = TestBed.inject(NotesStore);
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevoke;
  });

  function keys(): string[] {
    return store.feed().map((item) => item.key);
  }

  function shown(id: string) {
    return store.feed().find((item) => item.id === id);
  }

  describe('loading', () => {
    it('loads the latest notes and shows them oldest first', async () => {
      expect(store.status()).toBe('idle');
      const loading = store.ensureLoaded();
      expect(store.status()).toBe('loading');
      await loading;
      expect(store.status()).toBe('ready');
      expect(api.listNotes).toHaveBeenCalledWith({ limit: NOTES_PAGE_SIZE });
      expect(keys()).toEqual(['b', 'c']);
      expect(store.hasEarlier()).toBe(false);
      expect(store.filtered()).toBe(false);
    });

    it('shares one request between callers while the first load runs', async () => {
      await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);
      expect(api.listNotes).toHaveBeenCalledTimes(1);
    });

    it('reports a failed first load and recovers on retry', async () => {
      api.listNotes.mockRejectedValueOnce(offline());
      await store.ensureLoaded();
      expect(store.status()).toBe('error');
      expect(store.error()).toBe(OFFLINE_MESSAGE);
      api.listNotes.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      await store.reload();
      expect(store.error()).toBe(NOTES_LOAD_FAILED);
      await store.reload();
      expect(store.status()).toBe('ready');
      expect(store.error()).toBeNull();
      expect(keys()).toEqual(['b', 'c']);
    });

    it('refreshes quietly: new notes arrive, deleted ones leave, earlier pages stay', async () => {
      api.listNotes.mockResolvedValueOnce(page([C, B], 'cursor-1'));
      await store.ensureLoaded();
      api.listNotes.mockResolvedValueOnce(page([A]));
      await store.loadEarlier();
      expect(keys()).toEqual(['a', 'b', 'c']);

      api.listNotes.mockResolvedValueOnce(page([D, { ...B, done: true }], 'cursor-2'));
      await store.ensureLoaded();
      expect(store.status()).toBe('ready');
      expect(keys()).toEqual(['a', 'b', 'd']);
      expect(shown('b')?.done).toBe(true);
      expect(store.hasEarlier()).toBe(false);
    });

    it('starts over from the latest page when it no longer connects to what is shown', async () => {
      api.listNotes.mockResolvedValueOnce(page([B, A]));
      await store.ensureLoaded();
      api.listNotes.mockResolvedValueOnce(page([D], 'cursor-9'));
      await store.refresh();
      expect(keys()).toEqual(['d']);
      expect(store.hasEarlier()).toBe(true);

      api.listNotes.mockResolvedValueOnce(page([D]));
      await store.refresh();
      expect(keys()).toEqual(['d']);
      expect(store.hasEarlier()).toBe(false);
    });

    it('keeps what is shown when a quiet refresh fails', async () => {
      await store.ensureLoaded();
      api.listNotes.mockRejectedValueOnce(offline());
      await store.refresh();
      expect(store.status()).toBe('ready');
      expect(keys()).toEqual(['b', 'c']);
    });

    it('loads again when a note changed while the list was on its way', async () => {
      await store.ensureLoaded();
      const slow = deferred<NoteListResponse>();
      api.listNotes.mockReturnValueOnce(slow.promise);
      api.listNotes.mockResolvedValueOnce(page([D, C, B]));
      api.createNote.mockResolvedValue(D);
      const refreshing = store.refresh();
      await store.send('Note d');
      slow.resolve(page([C, B]));
      await refreshing;
      expect(api.listNotes).toHaveBeenCalledTimes(3);
      expect(keys()).toEqual(['b', 'c', 'local-1']);
    });

    it('forgets everything when the session changes', async () => {
      api.createNote.mockRejectedValue(offline());
      await store.ensureLoaded();
      await store.setFilter('open');
      await store.send('Unsent', [attachment('p1')]);
      TestBed.inject(SessionScope).reset();
      expect(store.status()).toBe('idle');
      expect(store.feed()).toEqual([]);
      expect(store.filter()).toBe('all');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p1');
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      api.listNotes.mockResolvedValueOnce(page([D, C], 'cursor-1'));
      await store.ensureLoaded();
    });

    it('puts an earlier page above the feed and follows the cursor', async () => {
      expect(store.hasEarlier()).toBe(true);
      api.listNotes.mockResolvedValueOnce(page([B], 'cursor-2'));
      const loading = store.loadEarlier();
      expect(store.earlier()).toBe('loading');
      await loading;
      expect(api.listNotes).toHaveBeenLastCalledWith({
        limit: NOTES_PAGE_SIZE,
        before: 'cursor-1',
      });
      expect(keys()).toEqual(['b', 'c', 'd']);
      expect(store.earlier()).toBe('idle');

      api.listNotes.mockResolvedValueOnce(page([B, A]));
      await store.loadEarlier();
      expect(api.listNotes).toHaveBeenLastCalledWith({
        limit: NOTES_PAGE_SIZE,
        before: 'cursor-2',
      });
      expect(keys()).toEqual(['a', 'b', 'c', 'd']);
      expect(store.hasEarlier()).toBe(false);
    });

    it('asks once while a page is loading and not at all at the start of the feed', async () => {
      const slow = deferred<NoteListResponse>();
      api.listNotes.mockReturnValueOnce(slow.promise);
      const first = store.loadEarlier();
      const second = store.loadEarlier();
      slow.resolve(page([B]));
      await Promise.all([first, second]);
      expect(api.listNotes).toHaveBeenCalledTimes(2);
      await store.loadEarlier();
      expect(api.listNotes).toHaveBeenCalledTimes(2);
    });

    it('keeps the cursor after a failure so the page can be asked for again', async () => {
      api.listNotes.mockRejectedValueOnce(offline());
      await store.loadEarlier();
      expect(store.earlier()).toBe('error');
      expect(keys()).toEqual(['c', 'd']);
      api.listNotes.mockResolvedValueOnce(page([B]));
      await store.loadEarlier();
      expect(store.earlier()).toBe('idle');
      expect(keys()).toEqual(['b', 'c', 'd']);
    });

    it('drops an earlier page that arrives after the search changed', async () => {
      const slow = deferred<NoteListResponse>();
      api.listNotes.mockReturnValueOnce(slow.promise);
      const earlier = store.loadEarlier();
      api.listNotes.mockResolvedValueOnce(page([A]));
      await store.setQuery('a');
      slow.resolve(page([B]));
      await earlier;
      expect(keys()).toEqual(['a']);
      expect(store.earlier()).toBe('idle');
    });
  });

  describe('search and status', () => {
    beforeEach(async () => {
      await store.ensureLoaded();
      api.listNotes.mockClear();
    });

    it('searches with the trimmed text and replaces the feed', async () => {
      api.listNotes.mockResolvedValueOnce(page([B]));
      const searching = store.setQuery('  mirror ');
      expect(store.busy()).toBe(true);
      expect(store.status()).toBe('ready');
      await searching;
      expect(api.listNotes).toHaveBeenCalledWith({ limit: NOTES_PAGE_SIZE, q: 'mirror' });
      expect(store.query()).toBe('mirror');
      expect(store.filtered()).toBe(true);
      expect(store.busy()).toBe(false);
      expect(keys()).toEqual(['b']);
    });

    it('combines the search with the status filter', async () => {
      await store.setQuery('mirror');
      await store.setFilter('open');
      expect(api.listNotes).toHaveBeenLastCalledWith({
        limit: NOTES_PAGE_SIZE,
        q: 'mirror',
        status: 'open',
      });
      await store.setQuery('');
      await store.setFilter('done');
      expect(api.listNotes).toHaveBeenLastCalledWith({ limit: NOTES_PAGE_SIZE, status: 'done' });
      await store.setFilter('all');
      expect(api.listNotes).toHaveBeenLastCalledWith({ limit: NOTES_PAGE_SIZE });
      expect(store.filtered()).toBe(false);
    });

    it('does not ask again for the same search or status', async () => {
      await store.setQuery('');
      await store.setFilter('all');
      expect(api.listNotes).not.toHaveBeenCalled();
    });

    it('shows only the answer to the latest search', async () => {
      const first = deferred<NoteListResponse>();
      api.listNotes.mockReturnValueOnce(first.promise);
      api.listNotes.mockResolvedValueOnce(page([C]));
      const stale = store.setQuery('mi');
      await store.setQuery('mirror');
      first.resolve(page([B]));
      await stale;
      expect(keys()).toEqual(['c']);
      expect(store.busy()).toBe(false);
    });

    it('shows an error instead of results from another search', async () => {
      api.listNotes.mockRejectedValueOnce(offline());
      await store.setQuery('mirror');
      expect(store.status()).toBe('error');
      expect(store.feed()).toEqual([]);
    });
  });

  describe('sending', () => {
    beforeEach(async () => {
      await store.ensureLoaded();
    });

    it('shows the note at once as sending and then as sent, under the same key', async () => {
      const saving = deferred<NoteDto>();
      api.createNote.mockReturnValueOnce(saving.promise);
      const photo = attachment('p1');
      const sending = store.send('Install this', [photo]);
      expect(keys()).toEqual(['b', 'c', 'local-1']);
      expect(store.feed().at(-1)).toMatchObject({
        id: null,
        text: 'Install this',
        state: 'sending',
        photos: [{ id: 'p1', url: 'blob:p1' }],
      });
      expect(api.createNote).toHaveBeenCalledWith('Install this', [photo.blob]);

      saving.resolve(note('d', 4, { text: 'Install this' }));
      expect(await sending).toBe(true);
      expect(keys()).toEqual(['b', 'c', 'local-1']);
      expect(store.feed().at(-1)).toMatchObject({ id: 'd', state: 'sent', text: 'Install this' });
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p1');
    });

    it('keeps a failed note as not sent and sends it on retry', async () => {
      api.createNote.mockRejectedValueOnce(offline());
      expect(await store.send('Dehumidifier')).toBe(false);
      expect(store.feed().at(-1)).toMatchObject({
        key: 'local-1',
        state: 'failed',
        error: OFFLINE_MESSAGE,
        text: 'Dehumidifier',
      });

      const saving = deferred<NoteDto>();
      api.createNote.mockReturnValueOnce(saving.promise);
      const retrying = store.retry('local-1');
      expect(store.feed().at(-1)).toMatchObject({ state: 'sending', error: null });
      saving.resolve(note('d', 4, { text: 'Dehumidifier' }));
      expect(await retrying).toBe(true);
      expect(api.createNote).toHaveBeenCalledTimes(2);
      expect(store.feed().at(-1)).toMatchObject({ id: 'd', state: 'sent' });
    });

    it('uses a plain message when the server gives no reason', async () => {
      api.createNote.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      await store.send('Dehumidifier');
      expect(store.feed().at(-1)?.error).toBe(NOTE_SEND_FAILED);
    });

    it('discards a failed note and frees its photo previews', async () => {
      api.createNote.mockRejectedValue(offline());
      await store.send('Shelf', [attachment('p1'), attachment('p2')]);
      store.discard('local-1');
      expect(keys()).toEqual(['b', 'c']);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p1');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p2');
      expect(await store.retry('local-1')).toBe(false);
    });

    it('does not discard or resend a note that is still on its way', async () => {
      const saving = deferred<NoteDto>();
      api.createNote.mockReturnValueOnce(saving.promise);
      const sending = store.send('Buy mirror');
      store.discard('local-1');
      expect(await store.retry('local-1')).toBe(false);
      expect(keys()).toEqual(['b', 'c', 'local-1']);
      saving.resolve(D);
      await sending;
      expect(api.createNote).toHaveBeenCalledTimes(1);
    });

    it('keeps unsent notes at the bottom while the feed reloads', async () => {
      api.createNote.mockRejectedValue(offline());
      await store.send('Unsent');
      api.listNotes.mockResolvedValueOnce(page([B]));
      await store.setFilter('done');
      expect(keys()).toEqual(['b', 'local-1']);
    });
  });

  describe('done toggle', () => {
    beforeEach(async () => {
      await store.ensureLoaded();
    });

    it('ticks a note at once and keeps what the server saved', async () => {
      const saving = deferred<NoteDto>();
      api.updateNote.mockReturnValueOnce(saving.promise);
      const toggling = store.toggleDone('b');
      expect(shown('b')?.done).toBe(true);
      expect(api.updateNote).toHaveBeenCalledWith('b', { done: true });
      saving.resolve({ ...B, done: true, doneAt: '2026-10-07T08:00:00.000Z' });
      await toggling;
      expect(shown('b')?.done).toBe(true);

      api.updateNote.mockResolvedValueOnce(B);
      await store.toggleDone('b');
      expect(api.updateNote).toHaveBeenLastCalledWith('b', { done: false });
      expect(shown('b')?.done).toBe(false);
    });

    it('rolls back and reports when the change is not saved', async () => {
      api.updateNote.mockRejectedValueOnce(offline());
      await expect(store.toggleDone('b')).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(shown('b')?.done).toBe(false);
    });

    it('sends quick taps one after another and ends on the last choice', async () => {
      const first = deferred<NoteDto>();
      const second = deferred<NoteDto>();
      api.updateNote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const on = store.toggleDone('b');
      const off = store.toggleDone('b');
      expect(shown('b')?.done).toBe(false);
      expect(api.updateNote).toHaveBeenCalledTimes(1);
      first.resolve({ ...B, done: true });
      await on;
      expect(shown('b')?.done).toBe(false);
      await vi.waitFor(() => expect(api.updateNote).toHaveBeenCalledTimes(2));
      expect(api.updateNote).toHaveBeenLastCalledWith('b', { done: false });
      second.resolve(B);
      await off;
      expect(shown('b')?.done).toBe(false);
    });

    it('removes a note that no longer exists on the server', async () => {
      api.updateNote.mockRejectedValueOnce(notFound());
      await expect(store.toggleDone('b')).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(keys()).toEqual(['c']);
    });

    it('ignores notes it does not know', async () => {
      await store.toggleDone('missing');
      expect(api.updateNote).not.toHaveBeenCalled();
    });
  });

  describe('editing', () => {
    beforeEach(async () => {
      await store.ensureLoaded();
    });

    it('shows the new text at once and keeps the saved note', async () => {
      const saving = deferred<NoteDto>();
      api.updateNote.mockReturnValueOnce(saving.promise);
      const editing = store.edit('c', 'Buy a round mirror');
      expect(shown('c')?.text).toBe('Buy a round mirror');
      expect(api.updateNote).toHaveBeenCalledWith('c', { text: 'Buy a round mirror' });
      saving.resolve({ ...C, text: 'Buy a round mirror', updatedAt: '2026-10-07T08:00:00.000Z' });
      await editing;
      expect(shown('c')?.text).toBe('Buy a round mirror');
    });

    it('puts the old text back when saving fails, without undoing a tick', async () => {
      const ticking = deferred<NoteDto>();
      api.updateNote.mockReturnValueOnce(ticking.promise).mockRejectedValueOnce(offline());
      const ticked = store.toggleDone('c');
      const edited = store.edit('c', 'Changed');
      ticking.resolve({ ...C, done: true });
      await ticked;
      await expect(edited).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(shown('c')).toMatchObject({ text: 'Note c', done: true });
    });
  });

  describe('deleting', () => {
    beforeEach(async () => {
      await store.ensureLoaded();
    });

    it('removes the note at once', async () => {
      const deleting = deferred<void>();
      api.deleteNote.mockReturnValueOnce(deleting.promise);
      const removing = store.remove('b');
      expect(keys()).toEqual(['c']);
      deleting.resolve();
      await removing;
      expect(api.deleteNote).toHaveBeenCalledWith('b');
      expect(keys()).toEqual(['c']);
    });

    it('puts the note back in its place when deleting fails', async () => {
      api.deleteNote.mockRejectedValueOnce(offline());
      await expect(store.remove('b')).rejects.toBeInstanceOf(HttpErrorResponse);
      expect(keys()).toEqual(['b', 'c']);
    });

    it('treats a note that is already gone as deleted', async () => {
      api.deleteNote.mockRejectedValueOnce(notFound());
      await store.remove('b');
      expect(keys()).toEqual(['c']);
    });

    it('deletes a note sent in this session under its server id', async () => {
      api.createNote.mockResolvedValueOnce(D);
      api.deleteNote.mockResolvedValueOnce(undefined);
      await store.send('Note d');
      expect(keys()).toEqual(['b', 'c', 'local-1']);
      await store.remove('d');
      expect(api.deleteNote).toHaveBeenCalledWith('d');
      expect(keys()).toEqual(['b', 'c']);
    });
  });
});
