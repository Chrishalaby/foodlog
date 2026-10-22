import type { NoteDto } from '@food/shared';
import {
  NOTE_DRAFT_KEY_PREFIX,
  NOTE_TEXT_MAX,
  type FeedNote,
  type OutboxNote,
  emptyFeedMessage,
  groupNotesByDay,
  hasSharePayload,
  linkSegments,
  mergeShareText,
  noteDraftKey,
  noteViewerPhotos,
  oldestFirst,
  outboxNote,
  photosLeftOutMessage,
  readNoteDraft,
  sentNote,
  shareText,
  writeNoteDraft,
} from './notes-model';

function at(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function note(overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    id: 'note-1',
    text: 'Buy mirror',
    photos: [],
    done: false,
    doneAt: null,
    createdAt: at(2026, 10, 7),
    updatedAt: at(2026, 10, 7),
    ...overrides,
  };
}

function feedNote(id: string, createdAt: string): FeedNote {
  return sentNote(note({ id, createdAt }));
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe('linkSegments', () => {
  it('returns plain text as one segment and nothing for empty text', () => {
    expect(linkSegments('Dehumidifier')).toEqual([{ text: 'Dehumidifier', href: null }]);
    expect(linkSegments('')).toEqual([]);
  });

  it('splits text around links and keeps line breaks', () => {
    expect(linkSegments('Shelf idea\nhttps://example.com/a?b=1 looks good')).toEqual([
      { text: 'Shelf idea\n', href: null },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: ' looks good', href: null },
    ]);
  });

  it('leaves sentence punctuation and closing brackets outside the link', () => {
    expect(linkSegments('See https://example.com/page.')).toEqual([
      { text: 'See ', href: null },
      { text: 'https://example.com/page', href: 'https://example.com/page' },
      { text: '.', href: null },
    ]);
    expect(linkSegments('(https://example.com/x), then')).toEqual([
      { text: '(', href: null },
      { text: 'https://example.com/x', href: 'https://example.com/x' },
      { text: '), then', href: null },
    ]);
  });

  it('keeps brackets that belong to the address', () => {
    const url = 'https://en.wikipedia.org/wiki/Mirror_(disambiguation)';
    expect(linkSegments(url)).toEqual([{ text: url, href: url }]);
  });

  it('links several addresses and ignores anything that is not a web address', () => {
    const parts = linkSegments('http://a.test and HTTPS://b.test/x; javascript:alert(1) https://');
    expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual([
      'http://a.test',
      'HTTPS://b.test/x',
    ]);
    expect(parts.map((part) => part.text).join('')).toBe(
      'http://a.test and HTTPS://b.test/x; javascript:alert(1) https://',
    );
  });
});

describe('share text', () => {
  it('joins title, text and url on separate lines', () => {
    expect(
      shareText({ title: 'Wall mirror', text: 'Round, 60 cm', url: 'https://shop.test/m' }),
    ).toBe('Wall mirror\nRound, 60 cm\nhttps://shop.test/m');
  });

  it('skips the url when the text already contains it', () => {
    expect(shareText({ text: 'Look https://shop.test/m', url: 'https://shop.test/m' })).toBe(
      'Look https://shop.test/m',
    );
  });

  it('skips a title that repeats the text or the url', () => {
    expect(shareText({ title: 'Wall mirror', text: 'Wall mirror, round' })).toBe(
      'Wall mirror, round',
    );
    expect(shareText({ title: 'https://maps.test/p', url: 'https://maps.test/p' })).toBe(
      'https://maps.test/p',
    );
  });

  it('knows when nothing was shared', () => {
    expect(hasSharePayload({ title: ' ', text: null })).toBe(false);
    expect(hasSharePayload({ url: 'https://maps.test/p' })).toBe(true);
    expect(shareText({})).toBe('');
  });

  it('adds shared text under what is already typed', () => {
    expect(mergeShareText('', { text: 'Dropped pin', url: 'https://maps.test/p' })).toBe(
      'Dropped pin\nhttps://maps.test/p',
    );
    expect(mergeShareText('Parking spot  ', { url: 'https://maps.test/p' })).toBe(
      'Parking spot\nhttps://maps.test/p',
    );
  });

  it('leaves the text alone when nothing new was shared', () => {
    expect(mergeShareText('Keep me', {})).toBe('Keep me');
    expect(mergeShareText('Seen https://maps.test/p', { url: 'https://maps.test/p' })).toBe(
      'Seen https://maps.test/p',
    );
  });

  it('never grows past the note limit', () => {
    const merged = mergeShareText('a'.repeat(NOTE_TEXT_MAX - 2), { text: 'overflow' });
    expect(merged).toHaveLength(NOTE_TEXT_MAX);
  });
});

describe('note draft storage', () => {
  it('keeps one draft per user and one for an unknown user', () => {
    expect(noteDraftKey('user-1')).toBe(`${NOTE_DRAFT_KEY_PREFIX}user-1`);
    expect(noteDraftKey(null)).toBe(`${NOTE_DRAFT_KEY_PREFIX}guest`);
    expect(noteDraftKey('user-1')).not.toBe(noteDraftKey('user-2'));
  });

  it('saves, restores and clears a draft', () => {
    const storage = memoryStorage();
    writeNoteDraft(storage, 'user-1', 'Width around 20cm');
    expect(readNoteDraft(storage, 'user-1')).toBe('Width around 20cm');
    expect(readNoteDraft(storage, 'user-2')).toBe('');
    writeNoteDraft(storage, 'user-1', '   ');
    expect(storage.getItem(noteDraftKey('user-1'))).toBeNull();
  });

  it('survives missing or failing storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readNoteDraft(null, 'user-1')).toBe('');
    expect(readNoteDraft(broken, 'user-1')).toBe('');
    expect(() => writeNoteDraft(broken, 'user-1', 'text')).not.toThrow();
    expect(() => writeNoteDraft(broken, 'user-1', '')).not.toThrow();
    expect(() => writeNoteDraft(null, 'user-1', 'text')).not.toThrow();
  });
});

describe('groupNotesByDay', () => {
  const now = new Date(2026, 9, 7, 9, 30);

  it('groups a chat-ordered feed under day separators', () => {
    const days = groupNotesByDay(
      [
        feedNote('a', at(2026, 10, 2, 18)),
        feedNote('b', at(2026, 10, 6, 8)),
        feedNote('c', at(2026, 10, 6, 23, 59)),
        feedNote('d', at(2026, 10, 7, 0, 5)),
      ],
      now,
    );
    expect(days.map((day) => day.label)).toEqual(['Fri 2 Oct', 'Yesterday', 'Today']);
    expect(days.map((day) => day.notes.map((item) => item.key))).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
    ]);
    expect(days[0].date).toBe('2026-10-02');
  });

  it('uses the calendar day, not the food day that starts at 3 am', () => {
    const days = groupNotesByDay([feedNote('late', at(2026, 10, 7, 1, 30))], now);
    expect(days[0].label).toBe('Today');
  });

  it('adds the year for older notes and returns nothing for an empty feed', () => {
    expect(groupNotesByDay([feedNote('old', at(2025, 12, 31))], now)[0].label).toBe(
      'Wed 31 Dec 2025',
    );
    expect(groupNotesByDay([], now)).toEqual([]);
  });
});

describe('feed notes', () => {
  it('orders notes oldest first', () => {
    const notes = [
      note({ id: 'c', createdAt: at(2026, 10, 7, 12) }),
      note({ id: 'a', createdAt: at(2026, 10, 5, 12) }),
      note({ id: 'b', createdAt: at(2026, 10, 6, 12) }),
    ];
    expect(oldestFirst(notes).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(notes.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('shows a saved note as sent, under its own or a remembered key', () => {
    const saved = note({ done: true });
    expect(sentNote(saved)).toMatchObject({
      key: 'note-1',
      id: 'note-1',
      state: 'sent',
      done: true,
    });
    expect(sentNote(saved, 'local-4').key).toBe('local-4');
  });

  it('shows an unsent note with its local photo previews', () => {
    const pending: OutboxNote = {
      key: 'local-1',
      text: 'Install this',
      attachments: [
        { id: 'p1', blob: new Blob(['x']), previewUrl: 'blob:p1', width: 800, height: 600 },
        { id: 'p2', blob: new Blob(['y']), previewUrl: null, width: 600, height: 800 },
      ],
      createdAt: at(2026, 10, 7),
      state: 'failed',
      error: 'Offline',
    };
    const shown = outboxNote(pending);
    expect(shown).toMatchObject({ key: 'local-1', id: null, state: 'failed', error: 'Offline' });
    expect(shown.photos).toEqual([
      { id: 'p1', url: 'blob:p1', thumbUrl: 'blob:p1', width: 800, height: 600 },
      { id: 'p2', url: '', thumbUrl: '', width: 600, height: 800 },
    ]);
  });

  it('captions viewer photos with the note text', () => {
    const shown = sentNote(
      note({
        text: ' Width around 20cm ',
        photos: [
          {
            id: 'p1',
            url: '/api/photos/p1',
            thumbUrl: '/api/photos/p1/thumb',
            width: 4,
            height: 3,
          },
          {
            id: 'p2',
            url: '/api/photos/p2',
            thumbUrl: '/api/photos/p2/thumb',
            width: 4,
            height: 3,
          },
        ],
      }),
    );
    expect(noteViewerPhotos(shown)).toEqual([
      { id: 'p1', url: '/api/photos/p1', alt: 'Note photo 1', caption: 'Width around 20cm' },
      { id: 'p2', url: '/api/photos/p2', alt: 'Note photo 2', caption: 'Width around 20cm' },
    ]);
    const single = sentNote(note({ text: '', photos: shown.photos.slice(0, 1) }));
    expect(noteViewerPhotos(single)).toEqual([
      { id: 'p1', url: '/api/photos/p1', alt: 'Note photo', caption: null },
    ]);
  });

  it('words the left-out photos and empty results', () => {
    expect(photosLeftOutMessage(1)).toBe('A note holds up to 4 photos. 1 photo was left out.');
    expect(photosLeftOutMessage(3)).toBe('A note holds up to 4 photos. 3 photos were left out.');
    expect(emptyFeedMessage('mirror', 'open')).toBe('No notes match “mirror”.');
    expect(emptyFeedMessage('', 'open')).toBe('Nothing left to do.');
    expect(emptyFeedMessage('', 'done')).toBe('Nothing ticked off yet.');
  });
});
