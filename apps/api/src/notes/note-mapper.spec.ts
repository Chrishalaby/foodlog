import { NOTE_INCLUDE, type NoteWithPhotos, toNoteDto } from './note-mapper.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const NOTE_ID = '019a0000-0000-7000-8000-0000000000b1';
const BOX_ID = '019a0000-0000-7000-8000-0000000000f1';
const SHELF_ID = '019a0000-0000-7000-8000-0000000000f2';
const CREATED_AT = new Date('2026-10-07T08:00:00.000Z');
const UPDATED_AT = new Date('2026-10-07T08:05:00.000Z');
const DONE_AT = new Date('2026-10-07T09:30:00.000Z');

function photo(id: string, width: number, height: number) {
  return {
    id,
    userId: USER_ID,
    storageKey: `photos/${id}.jpg`,
    thumbKey: `photos/${id}_thumb.webp`,
    width,
    height,
    bytes: 1000,
    createdAt: CREATED_AT,
  };
}

function noteRow(overrides: Partial<NoteWithPhotos> = {}): NoteWithPhotos {
  return {
    id: NOTE_ID,
    userId: USER_ID,
    text: 'Buy mirror',
    done: false,
    doneAt: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    photos: [],
    ...overrides,
  };
}

describe('NOTE_INCLUDE', () => {
  it('loads the photos of a note in position order', () => {
    expect(NOTE_INCLUDE).toEqual({
      photos: { orderBy: { position: 'asc' }, include: { photo: true } },
    });
  });
});

describe('toNoteDto', () => {
  it('maps an open text note', () => {
    expect(toNoteDto(noteRow())).toEqual({
      id: NOTE_ID,
      text: 'Buy mirror',
      photos: [],
      done: false,
      doneAt: null,
      createdAt: '2026-10-07T08:00:00.000Z',
      updatedAt: '2026-10-07T08:05:00.000Z',
    });
  });

  it('maps a done note with the time it was done', () => {
    const dto = toNoteDto(noteRow({ done: true, doneAt: DONE_AT }));

    expect(dto).toMatchObject({
      done: true,
      doneAt: '2026-10-07T09:30:00.000Z',
    });
  });

  it('maps the photos as photo references in position order', () => {
    const dto = toNoteDto(
      noteRow({
        text: '',
        photos: [
          {
            noteId: NOTE_ID,
            photoId: SHELF_ID,
            position: 1,
            photo: photo(SHELF_ID, 1344, 1792),
          },
          {
            noteId: NOTE_ID,
            photoId: BOX_ID,
            position: 0,
            photo: photo(BOX_ID, 1792, 1344),
          },
        ],
      }),
    );

    expect(dto.text).toBe('');
    expect(dto.photos).toEqual([
      {
        id: BOX_ID,
        url: `/api/photos/${BOX_ID}`,
        thumbUrl: `/api/photos/${BOX_ID}/thumb`,
        width: 1792,
        height: 1344,
      },
      {
        id: SHELF_ID,
        url: `/api/photos/${SHELF_ID}`,
        thumbUrl: `/api/photos/${SHELF_ID}/thumb`,
        width: 1344,
        height: 1792,
      },
    ]);
  });

  it('never exposes the owner or the storage keys', () => {
    const dto = toNoteDto(
      noteRow({
        photos: [
          {
            noteId: NOTE_ID,
            photoId: BOX_ID,
            position: 0,
            photo: photo(BOX_ID, 800, 600),
          },
        ],
      }),
    );

    const json = JSON.stringify(dto);

    expect(json).not.toContain(USER_ID);
    expect(json).not.toContain('.jpg');
    expect(json).not.toContain('_thumb.webp');
  });
});
