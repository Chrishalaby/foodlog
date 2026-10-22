import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  decodeEntryCursor,
  encodeEntryCursor,
} from '../entries/entry-cursor.js';
import type { PhotosService } from '../photos/photos.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { NOTE_INCLUDE, type NoteWithPhotos } from './note-mapper.js';
import {
  EMPTY_NOTE_MESSAGE,
  EMPTY_NOTE_UPDATE_MESSAGE,
  NOTE_TEXT_REQUIRED_MESSAGE,
  NotesService,
} from './notes.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const NOTE_ID = '019a0000-0000-7000-8000-0000000000b1';
const OLDER_ID = '019a0000-0000-7000-8000-0000000000b0';
const CREATED_AT = new Date('2026-10-07T08:00:00.000Z');
const NOW = new Date('2026-10-07T09:30:00.000Z');
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const ORDER = [{ createdAt: 'desc' }, { id: 'desc' }];

function storedPhoto(id: string) {
  return {
    id,
    userId: USER_ID,
    storageKey: `photos/${id}.jpg`,
    thumbKey: `photos/${id}_thumb.webp`,
    width: 1600,
    height: 1200,
    bytes: 1,
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
    updatedAt: CREATED_AT,
    photos: [],
    ...overrides,
  };
}

function notePhotos(...photoIds: string[]): NoteWithPhotos['photos'] {
  return photoIds.map((photoId, position) => ({
    noteId: NOTE_ID,
    photoId,
    position,
    photo: storedPhoto(photoId),
  }));
}

function setup() {
  const tx = {
    note: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const photos = {
    createManyFromUploads: vi.fn(
      (_userId: string, uploads: readonly unknown[]) =>
        Promise.resolve(uploads.map((_, index) => storedPhoto(`p${index}`))),
    ),
    releaseAll: vi.fn(() => Promise.resolve()),
  };
  const service = new NotesService(
    prisma as unknown as PrismaService,
    photos as unknown as PhotosService,
  );
  return { service, prisma, tx, photos };
}

describe('NotesService.list', () => {
  it('loads one note more than the default page, newest first', async () => {
    const { service, tx } = setup();

    await expect(service.list(USER_ID, {})).resolves.toEqual({
      notes: [],
      nextCursor: null,
    });
    expect(tx.note.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, AND: [{}, {}, {}] },
      orderBy: ORDER,
      include: NOTE_INCLUDE,
      take: 51,
    });
  });

  it('filters by every search token, the status and the cursor', async () => {
    const { service, tx } = setup();
    const before = encodeEntryCursor({ timestamp: CREATED_AT, id: NOTE_ID });

    await service.list(USER_ID, {
      q: 'buy mirror',
      status: 'done',
      before,
      limit: 10,
    });

    expect(tx.note.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        AND: [
          {
            AND: [
              { text: { contains: 'buy', mode: 'insensitive' } },
              { text: { contains: 'mirror', mode: 'insensitive' } },
            ],
          },
          { done: true },
          {
            OR: [
              { createdAt: { lt: CREATED_AT } },
              { createdAt: CREATED_AT, id: { lt: NOTE_ID } },
            ],
          },
        ],
      },
      orderBy: ORDER,
      include: NOTE_INCLUDE,
      take: 11,
    });
  });

  it('returns a page with a cursor to the notes after it', async () => {
    const { service, tx } = setup();
    tx.note.findMany.mockResolvedValue([
      noteRow(),
      noteRow({ id: OLDER_ID, text: 'Dehumidifier' }),
    ]);

    const page = await service.list(USER_ID, { limit: 1 });

    expect(page.notes.map(({ id, text }) => [id, text])).toEqual([
      [NOTE_ID, 'Buy mirror'],
    ]);
    expect(decodeEntryCursor(page.nextCursor ?? '')).toEqual({
      timestamp: CREATED_AT,
      id: NOTE_ID,
    });
  });

  it('refuses a cursor it did not issue before querying', async () => {
    const { service, tx } = setup();

    await expect(
      service.list(USER_ID, { before: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.note.findMany).not.toHaveBeenCalled();
  });
});

describe('NotesService.create', () => {
  it('refuses a note with neither text nor a photo before storing anything', async () => {
    const { service, tx, photos } = setup();

    await expect(service.create(USER_ID, {}, [])).rejects.toThrow(
      new BadRequestException(EMPTY_NOTE_MESSAGE),
    );
    await expect(service.create(USER_ID, { text: '' }, [])).rejects.toThrow(
      new BadRequestException(EMPTY_NOTE_MESSAGE),
    );
    expect(photos.createManyFromUploads).not.toHaveBeenCalled();
    expect(tx.note.create).not.toHaveBeenCalled();
  });

  it('saves a text note without photos', async () => {
    const { service, tx, photos } = setup();
    tx.note.create.mockResolvedValue(noteRow());

    const note = await service.create(USER_ID, { text: 'Buy mirror' }, []);

    expect(photos.createManyFromUploads).toHaveBeenCalledWith(USER_ID, []);
    expect(tx.note.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, text: 'Buy mirror', photos: { create: [] } },
      include: NOTE_INCLUDE,
    });
    expect(note).toMatchObject({ id: NOTE_ID, text: 'Buy mirror', photos: [] });
  });

  it('stores the photos of a note in upload order, with or without text', async () => {
    const { service, tx, photos } = setup();
    tx.note.create.mockResolvedValue(
      noteRow({ text: '', photos: notePhotos('p0', 'p1') }),
    );

    const note = await service.create(USER_ID, {}, [JPEG, JPEG]);

    expect(photos.createManyFromUploads).toHaveBeenCalledWith(USER_ID, [
      { buffer: JPEG, role: 'food' },
      { buffer: JPEG, role: 'food' },
    ]);
    expect(tx.note.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        text: '',
        photos: {
          create: [
            { photoId: 'p0', position: 0 },
            { photoId: 'p1', position: 1 },
          ],
        },
      },
      include: NOTE_INCLUDE,
    });
    expect(note.photos.map(({ id }) => id)).toEqual(['p0', 'p1']);
  });

  it('saves nothing when a photo cannot be stored', async () => {
    const { service, tx, photos } = setup();
    photos.createManyFromUploads.mockRejectedValueOnce(
      new BadRequestException('The uploaded file is not a supported image'),
    );

    await expect(
      service.create(USER_ID, { text: 'Box' }, [JPEG]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.note.create).not.toHaveBeenCalled();
  });

  it('releases the stored photos when the note cannot be saved', async () => {
    const { service, tx, photos } = setup();
    tx.note.create.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.create(USER_ID, { text: 'Box' }, [JPEG, JPEG]),
    ).rejects.toThrow('database unavailable');
    expect(photos.releaseAll).toHaveBeenCalledWith(['p0', 'p1']);
  });
});

describe('NotesService.update', () => {
  it('refuses an update that changes nothing before loading the note', async () => {
    const { service, tx } = setup();

    await expect(service.update(USER_ID, NOTE_ID, {})).rejects.toThrow(
      new BadRequestException(EMPTY_NOTE_UPDATE_MESSAGE),
    );
    expect(tx.note.findFirst).not.toHaveBeenCalled();
  });

  it('answers not found for a note of another person', async () => {
    const { service, tx } = setup();

    await expect(
      service.update(USER_ID, NOTE_ID, { text: 'Bought' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.note.findFirst).toHaveBeenCalledWith({
      where: { id: NOTE_ID, userId: USER_ID },
      include: NOTE_INCLUDE,
    });
    expect(tx.note.update).not.toHaveBeenCalled();
  });

  it('changes the text of a note', async () => {
    const { service, tx } = setup();
    tx.note.findFirst.mockResolvedValue(noteRow());
    tx.note.update.mockResolvedValue(noteRow({ text: 'Buy round mirror' }));

    const note = await service.update(
      USER_ID,
      NOTE_ID,
      { text: 'Buy round mirror' },
      NOW,
    );

    expect(tx.note.update).toHaveBeenCalledWith({
      where: { id: NOTE_ID },
      data: { text: 'Buy round mirror' },
      include: NOTE_INCLUDE,
    });
    expect(note.text).toBe('Buy round mirror');
  });

  it('keeps the text of a note without photos from being emptied', async () => {
    const { service, tx } = setup();
    tx.note.findFirst.mockResolvedValue(noteRow());

    await expect(
      service.update(USER_ID, NOTE_ID, { text: '', done: true }),
    ).rejects.toThrow(new BadRequestException(NOTE_TEXT_REQUIRED_MESSAGE));
    expect(tx.note.update).not.toHaveBeenCalled();
  });

  it('lets the text of a note with photos be emptied', async () => {
    const { service, tx } = setup();
    tx.note.findFirst.mockResolvedValue(noteRow({ photos: notePhotos('p0') }));
    tx.note.update.mockResolvedValue(
      noteRow({ text: '', photos: notePhotos('p0') }),
    );

    const note = await service.update(USER_ID, NOTE_ID, { text: '' }, NOW);

    expect(tx.note.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { text: '' } }),
    );
    expect(note).toMatchObject({ text: '', photos: [{ id: 'p0' }] });
  });

  it('marks an open note done at the current time', async () => {
    const { service, tx } = setup();
    tx.note.findFirst.mockResolvedValue(noteRow());
    tx.note.update.mockResolvedValue(noteRow({ done: true, doneAt: NOW }));

    const note = await service.update(USER_ID, NOTE_ID, { done: true }, NOW);

    expect(tx.note.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { done: true, doneAt: NOW } }),
    );
    expect(note).toMatchObject({ done: true, doneAt: NOW.toISOString() });
  });

  it('leaves a note that is already done untouched', async () => {
    const { service, tx } = setup();
    tx.note.findFirst.mockResolvedValue(
      noteRow({ done: true, doneAt: CREATED_AT }),
    );

    const note = await service.update(USER_ID, NOTE_ID, { done: true }, NOW);

    expect(tx.note.update).not.toHaveBeenCalled();
    expect(note).toMatchObject({
      done: true,
      doneAt: CREATED_AT.toISOString(),
    });
  });

  it('reopens a done note and clears the time it was done', async () => {
    const { service, tx } = setup();
    tx.note.findFirst.mockResolvedValue(
      noteRow({ done: true, doneAt: CREATED_AT }),
    );
    tx.note.update.mockResolvedValue(noteRow());

    const note = await service.update(USER_ID, NOTE_ID, { done: false }, NOW);

    expect(tx.note.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { done: false, doneAt: null } }),
    );
    expect(note).toMatchObject({ done: false, doneAt: null });
  });
});

describe('NotesService.remove', () => {
  it('answers not found for a note of another person without deleting', async () => {
    const { service, tx, photos } = setup();

    await expect(service.remove(USER_ID, NOTE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.note.findFirst).toHaveBeenCalledWith({
      where: { id: NOTE_ID, userId: USER_ID },
      select: { id: true, photos: { select: { photoId: true } } },
    });
    expect(tx.note.deleteMany).not.toHaveBeenCalled();
    expect(photos.releaseAll).not.toHaveBeenCalled();
  });

  it('deletes the note and then releases each of its photos', async () => {
    const { service, tx, photos } = setup();
    const calls: string[] = [];
    tx.note.findFirst.mockResolvedValue({
      id: NOTE_ID,
      photos: [{ photoId: 'p0' }, { photoId: 'p1' }],
    });
    tx.note.deleteMany.mockImplementation(() => {
      calls.push('delete');
      return Promise.resolve({ count: 1 });
    });
    photos.releaseAll.mockImplementation(() => {
      calls.push('release');
      return Promise.resolve();
    });

    await expect(service.remove(USER_ID, NOTE_ID)).resolves.toBeUndefined();

    expect(tx.note.deleteMany).toHaveBeenCalledWith({
      where: { id: NOTE_ID, userId: USER_ID },
    });
    expect(photos.releaseAll).toHaveBeenCalledWith(['p0', 'p1']);
    expect(calls).toEqual(['delete', 'release']);
  });

  it('keeps the photos when the note was deleted meanwhile', async () => {
    const { service, tx, photos } = setup();
    tx.note.findFirst.mockResolvedValue({
      id: NOTE_ID,
      photos: [{ photoId: 'p0' }],
    });
    tx.note.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove(USER_ID, NOTE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(photos.releaseAll).not.toHaveBeenCalled();
  });
});
