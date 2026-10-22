import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  NoteDto,
  NoteListQuery,
  NoteListResponse,
  PhotoRef,
  UpdateNoteRequest,
  UserDto,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { OFFLINE_MESSAGE } from '../../core/errors';
import { ToastService } from '../../core/toast.service';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { ConfirmService, type ConfirmOptions } from '../../shared/ui/confirm.service';
import { COMPRESS_PRESETS } from '../../shared/utils/image-compress';
import { NOTE_PHOTO_COMPRESSOR, type NotePhotoCompressor } from './note-composer';
import { noteDraftKey, photosLeftOutMessage } from './notes-model';
import {
  NOTES_INSTALLING,
  NOTES_SEARCH_DEBOUNCE_MS,
  NOTE_COPIED,
  NOTE_DELETE_FAILED,
  NotesPage,
} from './notes-page';
import { NOTES_PAGE_SIZE } from './notes.store';

@Component({ template: '' })
class Elsewhere {}

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

const flush = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function daysAgo(days: number, hour = 10): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function photo(id: string): PhotoRef {
  return {
    id,
    url: `/api/photos/${id}`,
    thumbUrl: `/api/photos/${id}/thumb`,
    width: 1200,
    height: 900,
  };
}

function note(id: string, text: string, createdAt: string, extra: Partial<NoteDto> = {}): NoteDto {
  return {
    id,
    text,
    photos: [],
    done: false,
    doneAt: null,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

function page(notes: NoteDto[], nextCursor: string | null = null): NoteListResponse {
  return { notes, nextCursor };
}

const USER: UserDto = {
  id: 'user-1',
  email: 'chris@example.test',
  name: 'Chris',
  role: 'admin',
} as UserDto;

const OLD = note('old', 'Dehumidifier', new Date(2020, 0, 3, 9, 15).toISOString());
const SHELF = note('shelf', 'Width around 20cm\nheight around 30 cm', daysAgo(1), {
  photos: [photo('p1')],
});
const MIRROR = note('mirror', 'Buy mirror, see https://shop.test/mirror?size=60.', daysAgo(0, 0), {
  done: true,
  doneAt: daysAgo(0, 0),
});

describe('NotesPage', () => {
  const api = {
    listNotes: vi.fn<(query?: NoteListQuery) => Promise<NoteListResponse>>(),
    createNote: vi.fn<(text: string, images?: readonly Blob[]) => Promise<NoteDto>>(),
    updateNote: vi.fn<(id: string, body: UpdateNoteRequest) => Promise<NoteDto>>(),
    deleteNote: vi.fn<(id: string) => Promise<void>>(),
    transcribe: vi.fn(),
  };
  const compress = vi.fn<NotePhotoCompressor>();
  const confirm = { confirm: vi.fn<(options: ConfirmOptions) => Promise<boolean>>() };
  const user = signal<UserDto | null>(USER);
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let restoreDialog: () => void;
  let harness: RouterTestingHarness;
  let el: HTMLElement;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    localStorage.clear();
    Object.values(api).forEach((mock) => mock.mockReset());
    compress.mockReset();
    confirm.confirm.mockReset();
    confirm.confirm.mockResolvedValue(true);
    user.set(USER);
    api.listNotes.mockResolvedValue(page([MIRROR, SHELF, OLD]));
    compress.mockImplementation(async (file) => ({
      blob: new Blob([`small-${(file as File).name}`], { type: 'image/jpeg' }),
      width: 800,
      height: 600,
    }));
    let previews = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++previews}`);
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'notes', component: NotesPage },
          { path: 'today', component: Elsewhere },
        ]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user } },
        { provide: ConfirmService, useValue: confirm },
        { provide: NOTE_PHOTO_COMPRESSOR, useValue: compress },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    localStorage.clear();
    restoreDialog();
  });

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    await flush();
    await harness.fixture.whenStable();
  }

  async function open(url = '/notes'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    el = harness.routeNativeElement!;
    await settle();
  }

  const field = (): HTMLTextAreaElement =>
    el.querySelector<HTMLTextAreaElement>('app-note-composer textarea')!;
  const sendButton = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('[data-send]')!;
  const cards = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('[data-note]'));
  const card = (key: string): HTMLElement => el.querySelector<HTMLElement>(`[data-note="${key}"]`)!;
  const texts = (): string[] =>
    cards().map((item) => item.querySelector('[data-note-text]')?.textContent ?? '');
  const dayLabels = (): string[] =>
    Array.from(el.querySelectorAll('[data-day]')).map((item) => item.textContent?.trim() ?? '');
  const toasts = (): string[] =>
    TestBed.inject(ToastService)
      .toasts()
      .map((toast) => toast.message);
  const buttonWith = (root: ParentNode, text: string): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.replace(/\s+/g, ' ').includes(text),
    );

  function type(value: string): void {
    field().value = value;
    field().dispatchEvent(new Event('input'));
  }

  async function pick(selector: string, names: string[]): Promise<void> {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    const files = names.map((name) => new File([name], name, { type: 'image/jpeg' }));
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  async function openMenu(key: string): Promise<HTMLElement> {
    card(key).querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click();
    await settle();
    return el.querySelector<HTMLElement>('app-note-actions-sheet')!;
  }

  describe('feed', () => {
    it('shows the notes in chat order under day separators, straight into the text box', async () => {
      await open();
      expect(el.querySelector('h1')?.textContent).toContain('Notes');
      expect(api.listNotes).toHaveBeenCalledWith({ limit: NOTES_PAGE_SIZE });
      expect(dayLabels()).toEqual(['Fri 3 Jan 2020', 'Yesterday', 'Today']);
      expect(cards().map((item) => item.dataset['note'])).toEqual(['old', 'shelf', 'mirror']);
      expect(texts()).toEqual([OLD.text, SHELF.text, MIRROR.text]);
      expect(document.activeElement).toBe(field());
      expect(el.querySelector('nav')).toBeNull();
    });

    it('keeps line breaks and turns web addresses into safe links', async () => {
      await open();
      const text = card('mirror').querySelector('[data-note-text]')!;
      const link = text.querySelector('a')!;
      expect(text.textContent).toBe(MIRROR.text);
      expect(text.classList.contains('whitespace-pre-wrap')).toBe(true);
      expect(link.getAttribute('href')).toBe('https://shop.test/mirror?size=60');
      expect(link.textContent).toBe('https://shop.test/mirror?size=60');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
      expect(card('shelf').querySelector('[data-note-text]')?.textContent).toBe(SHELF.text);
    });

    it('shows done notes ticked and struck through', async () => {
      await open();
      const done = card('mirror');
      expect(done.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
      expect(done.querySelector('[data-note-text]')?.classList.contains('line-through')).toBe(true);
      expect(card('old').querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe(
        'false',
      );
    });

    it('shows one photo large and several as a grid, and opens them in the viewer', async () => {
      const trio = note('trio', '', daysAgo(0, 1), {
        photos: [photo('a'), photo('b'), photo('c')],
      });
      api.listNotes.mockResolvedValue(page([trio, SHELF]));
      await open();
      const single = card('shelf').querySelectorAll('img');
      expect(single).toHaveLength(1);
      expect(single[0].getAttribute('src')).toBe('/api/photos/p1');
      expect(single[0].getAttribute('width')).toBe('1200');
      const grid = Array.from(card('trio').querySelectorAll('img'));
      expect(grid.map((img) => img.getAttribute('src'))).toEqual([
        '/api/photos/a/thumb',
        '/api/photos/b/thumb',
        '/api/photos/c/thumb',
      ]);
      expect(card('trio').querySelector('[data-note-text]')).toBeNull();

      card('trio')
        .querySelector<HTMLButtonElement>('button[aria-label="Open photo 2 of 3"]')!
        .click();
      await settle();
      const viewer = el.querySelector('app-photo-viewer dialog')!;
      expect(viewer.hasAttribute('open')).toBe(true);
      expect(viewer.querySelector('img')?.getAttribute('src')).toBe('/api/photos/b');
      expect(viewer.textContent).toContain('2 / 3');
    });

    it('loads earlier notes above the feed on request', async () => {
      api.listNotes.mockResolvedValueOnce(page([MIRROR, SHELF], 'cursor-1'));
      await open();
      api.listNotes.mockResolvedValueOnce(page([OLD]));
      el.querySelector<HTMLButtonElement>('[data-load-earlier]')!.click();
      await settle();
      expect(api.listNotes).toHaveBeenLastCalledWith({
        limit: NOTES_PAGE_SIZE,
        before: 'cursor-1',
      });
      expect(cards().map((item) => item.dataset['note'])).toEqual(['old', 'shelf', 'mirror']);
      expect(el.querySelector('[data-load-earlier]')).toBeNull();
    });

    it('welcomes a new user with an empty state', async () => {
      api.listNotes.mockResolvedValue(page([]));
      await open();
      expect(el.textContent).toContain('Notes to self');
      expect(cards()).toHaveLength(0);
    });

    it('shows a skeleton while loading and an inline error with retry', async () => {
      const loading = deferred<NoteListResponse>();
      api.listNotes.mockReturnValueOnce(loading.promise);
      await open();
      expect(el.querySelector('[data-testid="notes-skeleton"]')).not.toBeNull();
      loading.reject(new HttpErrorResponse({ status: 0 }));
      await settle();
      expect(el.querySelector('[data-testid="notes-skeleton"]')).toBeNull();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain(OFFLINE_MESSAGE);

      buttonWith(el, 'Try again')!.click();
      await settle();
      expect(cards()).toHaveLength(3);
      expect(el.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('search and filter', () => {
    it('searches after a short pause and can show everything again', async () => {
      await open();
      expect(el.querySelector('#notes-search')).toBeNull();
      el.querySelector<HTMLButtonElement>('[data-search-toggle]')!.click();
      await settle();
      const search = el.querySelector<HTMLInputElement>('#notes-search')!;
      expect(document.activeElement).toBe(search);

      api.listNotes.mockResolvedValueOnce(page([]));
      search.value = 'mir';
      search.dispatchEvent(new Event('input'));
      search.value = 'mirror';
      search.dispatchEvent(new Event('input'));
      expect(api.listNotes).toHaveBeenCalledTimes(1);
      await flush(NOTES_SEARCH_DEBOUNCE_MS + 30);
      await settle();
      expect(api.listNotes).toHaveBeenCalledTimes(2);
      expect(api.listNotes).toHaveBeenLastCalledWith({ limit: NOTES_PAGE_SIZE, q: 'mirror' });
      expect(el.textContent).toContain('No notes match “mirror”.');

      buttonWith(el, 'Show all notes')!.click();
      await settle();
      expect(api.listNotes).toHaveBeenLastCalledWith({ limit: NOTES_PAGE_SIZE });
      expect(el.querySelector('#notes-search')).toBeNull();
      expect(cards()).toHaveLength(3);
    });

    it('filters by to do and done', async () => {
      await open();
      const radios = Array.from(el.querySelectorAll<HTMLButtonElement>('button[role="radio"]'));
      expect(radios.map((radio) => radio.textContent?.trim())).toEqual(['All', 'To do', 'Done']);
      api.listNotes.mockResolvedValueOnce(page([SHELF, OLD]));
      radios[1].click();
      await settle();
      expect(api.listNotes).toHaveBeenLastCalledWith({ limit: NOTES_PAGE_SIZE, status: 'open' });
      expect(radios[1].getAttribute('aria-checked')).toBe('true');
      expect(cards().map((item) => item.dataset['note'])).toEqual(['old', 'shelf']);
      api.listNotes.mockResolvedValueOnce(page([MIRROR]));
      radios[2].click();
      await settle();
      expect(api.listNotes).toHaveBeenLastCalledWith({ limit: NOTES_PAGE_SIZE, status: 'done' });
    });
  });

  describe('sending', () => {
    it('sends text: the note appears at once as sending, then as sent', async () => {
      await open();
      expect(sendButton().disabled).toBe(true);
      const saving = deferred<NoteDto>();
      api.createNote.mockReturnValueOnce(saving.promise);
      type('  Buy mirror  ');
      await settle();
      expect(localStorage.getItem(noteDraftKey('user-1'))).toBe('  Buy mirror  ');
      expect(sendButton().disabled).toBe(false);
      sendButton().click();
      await settle();

      expect(api.createNote).toHaveBeenCalledWith('Buy mirror', []);
      expect(field().value).toBe('');
      expect(localStorage.getItem(noteDraftKey('user-1'))).toBeNull();
      const pending = cards().at(-1)!;
      expect(pending.dataset['state']).toBe('sending');
      expect(pending.textContent).toContain('Buy mirror');
      expect(pending.textContent).toContain('Sending…');
      expect(pending.querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(true);

      saving.resolve(note('new', 'Buy mirror', new Date().toISOString()));
      await settle();
      const sent = cards().at(-1)!;
      expect(sent).toBe(pending);
      expect(sent.dataset['state']).toBe('sent');
      expect(sent.textContent).not.toContain('Sending…');
      expect(dayLabels().at(-1)).toBe('Today');
    });

    it('sends with photos compressed on the device, and no text needed', async () => {
      await open();
      await pick('[data-gallery-input]', ['box.jpg', 'shelf.jpg']);
      expect(compress).toHaveBeenCalledTimes(2);
      expect(compress.mock.calls[0][1]).toEqual(COMPRESS_PRESETS.food_photo);
      expect((compress.mock.calls[0][0] as File).name).toBe('box.jpg');
      const thumbs = Array.from(el.querySelectorAll('app-note-composer li img'));
      expect(thumbs.map((img) => img.getAttribute('src'))).toEqual([
        'blob:preview-1',
        'blob:preview-2',
      ]);
      expect(sendButton().disabled).toBe(false);

      const saving = deferred<NoteDto>();
      api.createNote.mockReturnValueOnce(saving.promise);
      type('Install this for the bathroom');
      await settle();
      sendButton().click();
      await settle();

      const [text, images] = api.createNote.mock.calls[0];
      expect(text).toBe('Install this for the bathroom');
      expect(images).toHaveLength(2);
      const compressed = await Promise.all(compress.mock.results.map((result) => result.value));
      expect(images).toEqual(compressed.map((image) => image.blob));
      expect(images![0]).toBe(compressed[0].blob);
      expect(el.querySelectorAll('app-note-composer li')).toHaveLength(0);
      const pending = cards().at(-1)!;
      expect(
        Array.from(pending.querySelectorAll('img')).map((img) => img.getAttribute('src')),
      ).toEqual(['blob:preview-1', 'blob:preview-2']);

      saving.resolve(
        note('new', 'Install this for the bathroom', new Date().toISOString(), {
          photos: [photo('s1'), photo('s2')],
        }),
      );
      await settle();
      expect(
        Array.from(cards().at(-1)!.querySelectorAll('img')).map((img) => img.getAttribute('src')),
      ).toEqual(['/api/photos/s1/thumb', '/api/photos/s2/thumb']);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    });

    it('takes a camera photo and lets it be removed again', async () => {
      await open();
      const camera = el.querySelector<HTMLInputElement>('[data-camera-input]')!;
      expect(camera.getAttribute('capture')).toBe('environment');
      expect(camera.accept).toBe('image/*');
      expect(el.querySelector<HTMLInputElement>('[data-gallery-input]')!.multiple).toBe(true);
      await pick('[data-camera-input]', ['shot.jpg']);
      expect(sendButton().disabled).toBe(false);
      el.querySelector<HTMLButtonElement>('button[aria-label="Remove photo 1"]')!.click();
      await settle();
      expect(el.querySelectorAll('app-note-composer li')).toHaveLength(0);
      expect(sendButton().disabled).toBe(true);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    });

    it('keeps four photos per note and says how many were left out', async () => {
      await open();
      await pick('[data-gallery-input]', ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg']);
      expect(compress).toHaveBeenCalledTimes(4);
      expect(el.querySelectorAll('app-note-composer li')).toHaveLength(4);
      expect(toasts()).toContain(photosLeftOutMessage(2));
      expect(
        el.querySelector<HTMLButtonElement>('button[aria-label="Take a photo"]')!.disabled,
      ).toBe(true);
    });

    it('keeps a failed note as not sent, with retry and discard', async () => {
      await open();
      api.createNote.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
      type('Dehumidifier filter');
      await settle();
      sendButton().click();
      await settle();
      const failed = cards().at(-1)!;
      expect(failed.dataset['state']).toBe('failed');
      expect(failed.textContent).toContain('Not sent');
      expect(failed.textContent).toContain(OFFLINE_MESSAGE);

      api.createNote.mockResolvedValueOnce(
        note('new', 'Dehumidifier filter', new Date().toISOString()),
      );
      buttonWith(failed, 'Retry')!.click();
      await settle();
      expect(api.createNote).toHaveBeenCalledTimes(2);
      expect(cards().at(-1)!.dataset['state']).toBe('sent');

      api.createNote.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
      type('Throwaway');
      await settle();
      sendButton().click();
      await settle();
      buttonWith(cards().at(-1)!, 'Discard')!.click();
      await settle();
      expect(texts()).not.toContain('Throwaway');
      expect(cards()).toHaveLength(4);
    });
  });

  describe('draft and sharing', () => {
    it('restores the unsent text of this user', async () => {
      localStorage.setItem(noteDraftKey('user-1'), 'Half a thought');
      localStorage.setItem(noteDraftKey('user-2'), 'Someone else');
      await open();
      expect(field().value).toBe('Half a thought');
      expect(sendButton().disabled).toBe(false);
      type('Half a thought, finished');
      await settle();
      expect(localStorage.getItem(noteDraftKey('user-1'))).toBe('Half a thought, finished');
      expect(localStorage.getItem(noteDraftKey('user-2'))).toBe('Someone else');
    });

    it('hands text typed before sign-in was known over to the user', async () => {
      user.set(null);
      await open();
      type('Typed offline');
      await settle();
      expect(localStorage.getItem(noteDraftKey(null))).toBe('Typed offline');
      user.set(USER);
      await settle();
      expect(field().value).toBe('Typed offline');
      expect(localStorage.getItem(noteDraftKey('user-1'))).toBe('Typed offline');
      expect(localStorage.getItem(noteDraftKey(null))).toBeNull();
    });

    it('puts shared title, text and link into the text box and cleans the address', async () => {
      await open(
        '/notes?title=Wall%20mirror&text=Round%2C%2060%20cm&url=https%3A%2F%2Fshop.test%2Fm',
      );
      expect(field().value).toBe('Wall mirror\nRound, 60 cm\nhttps://shop.test/m');
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/notes'));
      expect(localStorage.getItem(noteDraftKey('user-1'))).toBe(
        'Wall mirror\nRound, 60 cm\nhttps://shop.test/m',
      );
      expect(sendButton().disabled).toBe(false);
    });

    it('adds a share under an existing draft and skips a link the text already has', async () => {
      localStorage.setItem(noteDraftKey('user-1'), 'Parking spot');
      await open(
        '/notes?text=Pin%20https%3A%2F%2Fmaps.test%2Fp&url=https%3A%2F%2Fmaps.test%2Fp&keep=1',
      );
      expect(field().value).toBe('Parking spot\nPin https://maps.test/p');
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/notes?keep=1'));
    });
  });

  describe('note actions', () => {
    it('ticks a note at once and rolls back with a message when it fails', async () => {
      await open();
      const saving = deferred<NoteDto>();
      api.updateNote.mockReturnValueOnce(saving.promise);
      const toggle = (): HTMLButtonElement =>
        card('old').querySelector<HTMLButtonElement>('[role="checkbox"]')!;
      toggle().click();
      await settle();
      expect(api.updateNote).toHaveBeenCalledWith('old', { done: true });
      expect(toggle().getAttribute('aria-checked')).toBe('true');
      saving.reject(new HttpErrorResponse({ status: 0 }));
      await settle();
      expect(toggle().getAttribute('aria-checked')).toBe('false');
      expect(toasts()).toContain(OFFLINE_MESSAGE);
    });

    it('edits the text from the more menu', async () => {
      await open();
      api.updateNote.mockResolvedValueOnce({ ...OLD, text: 'Dehumidifier for the bathroom' });
      const sheet = await openMenu('old');
      sheet.querySelector<HTMLElement>('[data-action="edit"]')!.click();
      await settle();
      const editor = sheet.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(editor.value).toBe('Dehumidifier');
      const save = buttonWith(sheet, 'Save')!;
      expect(save.disabled).toBe(true);
      editor.value = 'Dehumidifier for the bathroom';
      editor.dispatchEvent(new Event('input'));
      await settle();
      expect(save.disabled).toBe(false);
      save.click();
      await settle();
      expect(api.updateNote).toHaveBeenCalledWith('old', { text: 'Dehumidifier for the bathroom' });
      expect(texts()[0]).toBe('Dehumidifier for the bathroom');
      expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    });

    it('copies the text', async () => {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      try {
        await open();
        const sheet = await openMenu('shelf');
        sheet.querySelector<HTMLElement>('[data-action="copy"]')!.click();
        await settle();
        expect(writeText).toHaveBeenCalledWith(SHELF.text);
        expect(toasts()).toContain(NOTE_COPIED);
      } finally {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    });

    it('deletes after confirming and puts the note back when that fails', async () => {
      await open();
      confirm.confirm.mockResolvedValueOnce(false);
      (await openMenu('old')).querySelector<HTMLElement>('[data-action="delete"]')!.click();
      await settle();
      expect(confirm.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete this note?', tone: 'danger' }),
      );
      expect(api.deleteNote).not.toHaveBeenCalled();

      api.deleteNote.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      (await openMenu('old')).querySelector<HTMLElement>('[data-action="delete"]')!.click();
      await settle();
      expect(api.deleteNote).toHaveBeenCalledWith('old');
      expect(cards()).toHaveLength(3);
      expect(toasts()).toContain(NOTE_DELETE_FAILED);

      api.deleteNote.mockResolvedValueOnce(undefined);
      (await openMenu('old')).querySelector<HTMLElement>('[data-action="delete"]')!.click();
      await settle();
      expect(cards().map((item) => item.dataset['note'])).toEqual(['shelf', 'mirror']);
    });
  });

  describe('install', () => {
    it('offers Install only when the browser can prompt', async () => {
      await open();
      expect(el.querySelector('[data-install]')).toBeNull();
      const prompt = vi.fn(async () => undefined);
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt,
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });
      window.dispatchEvent(event);
      await settle();
      el.querySelector<HTMLButtonElement>('[data-install]')!.click();
      await settle();
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(toasts()).toContain(NOTES_INSTALLING);
      expect(el.querySelector('[data-install]')).toBeNull();
    });
  });
});
