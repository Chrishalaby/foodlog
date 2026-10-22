import { randomUUID } from 'node:crypto';
import {
  API_LIMITS,
  type ApiError,
  type NoteDto,
  type NoteListQuery,
  type NoteListResponse,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { NOTE_CREATE_THROTTLE } from '../src/notes/notes.controller.js';
import { PhotoCleanupService } from '../src/photos/photo-cleanup.service.js';
import { PhotosService } from '../src/photos/photos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
  withSettings,
} from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_NOTE = 'Write something or add a photo';

function binaryParser(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function image(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 60, g: 110, b: 190 },
    },
  })
    .jpeg()
    .toBuffer();
}

function imageWithExif(): Promise<Buffer> {
  return sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 200, g: 200, b: 60 },
    },
  })
    .withExif({ IFD0: { Copyright: 'home address', Make: 'PhoneCam' } })
    .jpeg()
    .toBuffer();
}

describe('notes (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let photos: PhotosService;
  let storage: StorageService;
  let agent: TestAgent;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp({
      configure: withSettings({ notesEnabled: true }),
    });
    prisma = app.get(PrismaService);
    photos = app.get(PhotosService);
    storage = app.get(StorageService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  beforeEach(async () => {
    await prisma.note.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: userId } } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  function postNote(
    text: string | undefined,
    images: Buffer[] = [],
    as: TestAgent = agent,
  ): request.Test {
    let call = as.post('/api/notes');
    if (text !== undefined) {
      call = call.field('text', text);
    }
    images.forEach((buffer, index) => {
      call = call.attach('images', buffer, {
        filename: `photo-${index}.jpg`,
        contentType: 'image/jpeg',
      });
    });
    return call;
  }

  async function createTextNote(
    text: string,
    as: TestAgent = agent,
  ): Promise<NoteDto> {
    return (await as.post('/api/notes').send({ text }).expect(201))
      .body as NoteDto;
  }

  async function createPhotoNote(
    text: string | undefined,
    images: Buffer[],
    as: TestAgent = agent,
  ): Promise<NoteDto> {
    return (await postNote(text, images, as).expect(201)).body as NoteDto;
  }

  async function listNotes(
    query: NoteListQuery = {},
    as: TestAgent = agent,
  ): Promise<NoteListResponse> {
    return (await as.get('/api/notes').query(query).expect(200))
      .body as NoteListResponse;
  }

  async function seedNote(
    text: string,
    createdAt: string,
    options: { done?: boolean; owner?: string; id?: string } = {},
  ): Promise<string> {
    const note = await prisma.note.create({
      data: {
        ...(options.id ? { id: options.id } : {}),
        userId: options.owner ?? userId,
        text,
        done: options.done ?? false,
        doneAt: options.done ? new Date(createdAt) : null,
        createdAt: new Date(createdAt),
      },
    });
    return note.id;
  }

  async function photoExists(id: string): Promise<boolean> {
    return (await prisma.photo.findUnique({ where: { id } })) !== null;
  }

  it('requires authentication', async () => {
    const anonymous = request(app.getHttpServer());

    await anonymous.get('/api/notes').expect(401);
    await anonymous.post('/api/notes').send({ text: 'Buy mirror' }).expect(401);
    await anonymous
      .patch(`/api/notes/${randomUUID()}`)
      .send({ done: true })
      .expect(401);
    await anonymous.delete(`/api/notes/${randomUUID()}`).expect(401);
  });

  describe('create', () => {
    it('saves a text note sent as JSON', async () => {
      const before = Date.now();
      const response = await agent
        .post('/api/notes')
        .send({ text: '  Buy mirror\nfor the hallway ' })
        .expect(201);
      const note = response.body as NoteDto;

      expect(note).toEqual({
        id: expect.any(String) as string,
        text: 'Buy mirror\nfor the hallway',
        photos: [],
        done: false,
        doneAt: null,
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      expect(Date.parse(note.createdAt)).toBeGreaterThanOrEqual(before - 1000);
      expect(note.updatedAt).toBe(note.createdAt);
      await expect(
        prisma.note.findUnique({ where: { id: note.id } }),
      ).resolves.toMatchObject({ userId, text: 'Buy mirror\nfor the hallway' });
    });

    it('saves a text note sent as a multipart form', async () => {
      const note = await createPhotoNote(' Dehumidifier ', []);

      expect(note).toMatchObject({ text: 'Dehumidifier', photos: [] });
    });

    it('saves photos with a caption, processed like every other upload', async () => {
      const note = await createPhotoNote(
        'Width around 20cm height around 30 cm',
        [await image(3024, 4032), await imageWithExif()],
      );

      expect(note.text).toBe('Width around 20cm height around 30 cm');
      expect(note.photos).toEqual([
        {
          id: expect.any(String) as string,
          url: `/api/photos/${note.photos[0]?.id}`,
          thumbUrl: `/api/photos/${note.photos[0]?.id}/thumb`,
          width: 1344,
          height: 1792,
        },
        {
          id: expect.any(String) as string,
          url: `/api/photos/${note.photos[1]?.id}`,
          thumbUrl: `/api/photos/${note.photos[1]?.id}/thumb`,
          width: 640,
          height: 480,
        },
      ]);
      await expect(
        prisma.notePhoto.findMany({
          where: { noteId: note.id },
          orderBy: { position: 'asc' },
          select: { photoId: true, position: true },
        }),
      ).resolves.toEqual(
        note.photos.map(({ id }, position) => ({ photoId: id, position })),
      );

      const full = await agent
        .get(note.photos[1]?.url ?? '')
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(full.headers['content-type']).toBe('image/jpeg');
      const meta = await sharp(full.body as Buffer).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        'jpeg',
        640,
        480,
      ]);
      expect(meta.exif).toBeUndefined();
      expect((full.body as Buffer).includes('home address')).toBe(false);

      const thumb = await agent
        .get(note.photos[0]?.thumbUrl ?? '')
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(thumb.headers['content-type']).toBe('image/webp');
      expect((await sharp(thumb.body as Buffer).metadata()).height).toBe(320);
    });

    it('saves a photo without any text', async () => {
      const note = await createPhotoNote(undefined, [await image(800, 600)]);

      expect(note.text).toBe('');
      expect(note.photos).toHaveLength(1);
    });

    it(`keeps up to ${API_LIMITS.notePhotosMax} photos in upload order`, async () => {
      const sizes = [400, 420, 440, 460];
      const note = await createPhotoNote(
        'Install this for the bathroom',
        await Promise.all(sizes.map((width) => image(width, 300))),
      );

      expect(note.photos.map(({ width }) => width)).toEqual(sizes);
    });

    it('refuses a note with neither text nor a photo', async () => {
      const cases: request.Test[] = [
        agent.post('/api/notes').send({}),
        agent.post('/api/notes').send({ text: '   ' }),
        agent.post('/api/notes'),
        postNote(' \n '),
      ];

      for (const call of cases) {
        const response = await call.expect(400);
        expect((response.body as ApiError).message).toBe(EMPTY_NOTE);
      }
      expect(await prisma.note.count()).toBe(0);
    });

    it('refuses invalid text and unknown fields', async () => {
      const tooLong = 'x'.repeat(API_LIMITS.noteTextMax + 1);

      await agent.post('/api/notes').send({ text: tooLong }).expect(400);
      await postNote(tooLong).expect(400);
      await agent.post('/api/notes').send({ text: null }).expect(400);
      await agent.post('/api/notes').send({ text: 42 }).expect(400);
      await agent
        .post('/api/notes')
        .send({ text: 'Buy mirror', done: true })
        .expect(400);
      await postNote('Buy mirror').field('done', 'true').expect(400);
      const nullChar = await agent
        .post('/api/notes')
        .send({ text: 'Buy\u0000mirror' })
        .expect(400);
      expect((nullChar.body as ApiError).message).toBe(
        'Text must not contain null characters',
      );
      await agent
        .post('/api/notes')
        .send({ text: 'x'.repeat(API_LIMITS.noteTextMax) })
        .expect(201);
      expect(await prisma.note.count()).toBe(1);
    });

    it('refuses bad uploads without keeping any photo', async () => {
      const photo = await image(800, 600);
      const cases: [Buffer[], string][] = [
        [
          [photo, Buffer.from('GIF89a-nope')],
          'Unsupported image type — upload a JPEG, PNG or WebP photo',
        ],
        [
          [photo, Buffer.from([0xff, 0xd8, 0xff, 0x00])],
          'The uploaded file is not a supported image',
        ],
        [
          Array.from({ length: API_LIMITS.notePhotosMax + 1 }, () => photo),
          'Too many files',
        ],
      ];

      for (const [images, message] of cases) {
        const response = await postNote('Box', images).expect(400);
        expect((response.body as ApiError).message).toBe(message);
      }
      const wrongField = await agent
        .post('/api/notes')
        .field('text', 'Box')
        .attach('image', photo, 'photo.jpg')
        .expect(400);
      expect((wrongField.body as ApiError).message).toBe(
        'Unexpected file field - image',
      );
      expect(await prisma.photo.count()).toBe(0);
      expect(await prisma.note.count()).toBe(0);
    });

    it('rejects photos above the upload limit with 413', async () => {
      const oversized = Buffer.alloc(API_LIMITS.imageMaxBytes + 1);
      oversized.set([0xff, 0xd8, 0xff]);

      await postNote('Box', [oversized]).expect(413);
      expect(await prisma.note.count()).toBe(0);
    });
  });

  describe('list', () => {
    it('returns the notes newest first with their photos', async () => {
      const older = await seedNote('Dehumidifier', '2026-10-01T08:00:00.000Z');
      const newer = await seedNote('Buy mirror', '2026-10-02T08:00:00.000Z');
      const withPhoto = await createPhotoNote('Shelf', [await image(800, 600)]);

      const { notes, nextCursor } = await listNotes();

      expect(notes.map(({ id }) => id)).toEqual([withPhoto.id, newer, older]);
      expect(notes[0]).toEqual(withPhoto);
      expect(nextCursor).toBeNull();
    });

    it('finds notes holding every search word, whatever the case', async () => {
      const mirror = await seedNote(
        'Buy mirror for the bathroom',
        '2026-10-01T08:00:00.000Z',
      );
      const shelf = await seedNote(
        'Bathroom shelf: width around 20cm',
        '2026-10-02T08:00:00.000Z',
      );
      const sale = await seedNote(
        'Dehumidifier 50% off_now',
        '2026-10-03T08:00:00.000Z',
      );
      const ids = async (q: string): Promise<string[]> =>
        (await listNotes({ q })).notes.map(({ id }) => id);

      await expect(ids('bathroom')).resolves.toEqual([shelf, mirror]);
      await expect(ids('  BATH   Mirror ')).resolves.toEqual([mirror]);
      await expect(ids('room irr')).resolves.toEqual([mirror]);
      await expect(ids('mirror shelf')).resolves.toEqual([]);
      await expect(ids('20CM')).resolves.toEqual([shelf]);
      await expect(ids('%')).resolves.toEqual([sale]);
      await expect(ids('_')).resolves.toEqual([sale]);
      await expect(ids('   ')).resolves.toEqual([sale, shelf, mirror]);
    });

    it('filters open and done notes', async () => {
      const open = await seedNote('Buy mirror', '2026-10-01T08:00:00.000Z');
      const done = await seedNote('Dehumidifier', '2026-10-02T08:00:00.000Z', {
        done: true,
      });
      const ids = async (query: NoteListQuery): Promise<string[]> =>
        (await listNotes(query)).notes.map(({ id }) => id);

      await expect(ids({})).resolves.toEqual([done, open]);
      await expect(ids({ status: 'all' })).resolves.toEqual([done, open]);
      await expect(ids({ status: 'open' })).resolves.toEqual([open]);
      await expect(ids({ status: 'done' })).resolves.toEqual([done]);
      await expect(ids({ status: 'done', q: 'mirror' })).resolves.toEqual([]);
    });

    it('pages through the notes with a cursor, across equal creation times', async () => {
      const sameTime = '2026-10-03T08:00:00.000Z';
      const first = await seedNote('one', '2026-10-01T08:00:00.000Z');
      const second = await seedNote('two', '2026-10-02T08:00:00.000Z');
      const tieLow = await seedNote('three', sameTime, {
        id: '019a0000-0000-7000-8000-00000000aaa1',
      });
      const tieHigh = await seedNote('four', sameTime, {
        id: '019a0000-0000-7000-8000-00000000aaa2',
      });
      const last = await seedNote('five', '2026-10-04T08:00:00.000Z');
      const expected = [last, tieHigh, tieLow, second, first];

      const seen: string[] = [];
      const cursors: (string | null)[] = [];
      let before: string | undefined;
      for (let page = 0; page < expected.length; page += 1) {
        const response = await listNotes({ limit: 2, before });
        seen.push(...response.notes.map(({ id }) => id));
        cursors.push(response.nextCursor);
        if (response.nextCursor === null) {
          break;
        }
        before = response.nextCursor;
      }

      expect(seen).toEqual(expected);
      expect(cursors).toEqual([
        expect.any(String) as string,
        expect.any(String) as string,
        null,
      ]);
      expect(cursors[0]).toMatch(/^[A-Za-z0-9_-]+$/);
      const exact = await listNotes({ limit: 5 });
      expect(exact.notes).toHaveLength(5);
      expect(exact.nextCursor).toBeNull();
      const searched = await listNotes({ limit: 1, q: 'o' });
      expect(searched.notes.map(({ id }) => id)).toEqual([tieHigh]);
      const rest = await listNotes({
        limit: 5,
        q: 'o',
        before: searched.nextCursor ?? undefined,
      });
      expect(rest.notes.map(({ id }) => id)).toEqual([second, first]);
      expect(rest.nextCursor).toBeNull();
    });

    it('returns 50 notes by default and at most the page maximum', async () => {
      const total = API_LIMITS.notesPageMax + 5;
      const start = Date.parse('2026-09-01T00:00:00.000Z');
      await prisma.note.createMany({
        data: Array.from({ length: total }, (_, index) => ({
          userId,
          text: `note ${index}`,
          createdAt: new Date(start + index * 1000),
        })),
      });

      const byDefault = await listNotes();
      const largest = await listNotes({ limit: API_LIMITS.notesPageMax });

      expect(byDefault.notes).toHaveLength(50);
      expect(byDefault.notes[0]?.text).toBe(`note ${total - 1}`);
      expect(byDefault.nextCursor).not.toBeNull();
      expect(largest.notes).toHaveLength(API_LIMITS.notesPageMax);
      expect(largest.nextCursor).not.toBeNull();
    });

    it('rejects invalid queries with 400', async () => {
      const cursor = await agent
        .get('/api/notes')
        .query({ before: 'not-a-cursor' })
        .expect(400);
      expect((cursor.body as ApiError).message).toBe(
        'before must be a cursor returned by the API',
      );
      const queries: Record<string, string>[] = [
        { before: 'A'.repeat(200) },
        { limit: '0' },
        { limit: String(API_LIMITS.notesPageMax + 1) },
        { limit: 'many' },
        { status: 'closed' },
        { q: 'x'.repeat(API_LIMITS.foodQueryMax + 1) },
        { sort: 'oldest' },
      ];
      for (const query of queries) {
        await agent.get('/api/notes').query(query).expect(400);
      }
    });
  });

  describe('update', () => {
    it('changes the text and keeps the photos', async () => {
      const note = await createPhotoNote('Shelf', [await image(800, 600)]);

      const response = await agent
        .patch(`/api/notes/${note.id}`)
        .send({ text: '  Shelf: width around 20cm ' })
        .expect(200);
      const updated = response.body as NoteDto;

      expect(updated).toEqual({
        ...note,
        text: 'Shelf: width around 20cm',
        updatedAt: expect.any(String) as string,
      });
      expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(note.updatedAt),
      );
      expect((await listNotes()).notes).toEqual([updated]);
    });

    it('marks a note done once and reopens it', async () => {
      const note = await createTextNote('Buy mirror');
      const patch = async (body: object): Promise<NoteDto> =>
        (await agent.patch(`/api/notes/${note.id}`).send(body).expect(200))
          .body as NoteDto;

      const before = Date.now();
      const done = await patch({ done: true });
      expect(done).toMatchObject({
        id: note.id,
        text: 'Buy mirror',
        done: true,
      });
      expect(Date.parse(done.doneAt ?? '')).toBeGreaterThanOrEqual(
        before - 1000,
      );

      const again = await patch({ done: true });
      expect(again).toEqual(done);

      const edited = await patch({ done: true, text: 'Bought the mirror' });
      expect(edited).toMatchObject({
        text: 'Bought the mirror',
        done: true,
        doneAt: done.doneAt,
      });

      const reopened = await patch({ done: false });
      expect(reopened).toMatchObject({
        text: 'Bought the mirror',
        done: false,
        doneAt: null,
      });
      await expect(patch({ done: false })).resolves.toMatchObject({
        done: false,
        doneAt: null,
      });
    });

    it('lets only a note with photos lose its text', async () => {
      const textOnly = await createTextNote('Buy mirror');
      const withPhoto = await createPhotoNote('Box', [await image(800, 600)]);

      const refused = await agent
        .patch(`/api/notes/${textOnly.id}`)
        .send({ text: '   ' })
        .expect(400);
      expect((refused.body as ApiError).message).toBe(
        'A note without a photo needs some text',
      );
      const cleared = await agent
        .patch(`/api/notes/${withPhoto.id}`)
        .send({ text: '' })
        .expect(200);

      expect((cleared.body as NoteDto).text).toBe('');
      expect((cleared.body as NoteDto).photos).toEqual(withPhoto.photos);
      await expect(
        prisma.note.findUnique({ where: { id: textOnly.id } }),
      ).resolves.toMatchObject({ text: 'Buy mirror' });
    });

    it('rejects empty and invalid bodies with 400', async () => {
      const note = await createTextNote('Buy mirror');

      const empty = await agent
        .patch(`/api/notes/${note.id}`)
        .send({})
        .expect(400);
      expect((empty.body as ApiError).message).toBe(
        'Send text or done to change a note',
      );
      await agent.patch(`/api/notes/${note.id}`).expect(400);
      const bodies: object[] = [
        { done: 'true' },
        { done: null },
        { text: null },
        { text: 'x'.repeat(API_LIMITS.noteTextMax + 1) },
        { text: 'ok', photos: [] },
        { doneAt: '2026-10-07T08:00:00.000Z' },
      ];
      for (const body of bodies) {
        await agent.patch(`/api/notes/${note.id}`).send(body).expect(400);
      }
      await agent
        .patch('/api/notes/not-a-uuid')
        .send({ done: true })
        .expect(400);
      expect((await listNotes()).notes).toEqual([note]);
    });

    it('returns 404 for an unknown note', async () => {
      await agent
        .patch(`/api/notes/${randomUUID()}`)
        .send({ done: true })
        .expect(404);
    });
  });

  describe('delete', () => {
    it('deletes a note and releases its photos', async () => {
      const note = await createPhotoNote('Box', [
        await image(800, 600),
        await image(600, 800),
      ]);
      const rows = await prisma.photo.findMany({
        where: { id: { in: note.photos.map(({ id }) => id) } },
      });
      expect(rows).toHaveLength(2);

      await agent.delete(`/api/notes/${note.id}`).expect(204);

      expect(await prisma.note.count()).toBe(0);
      expect(await prisma.notePhoto.count()).toBe(0);
      expect(await prisma.photo.count()).toBe(0);
      for (const row of rows) {
        await expect(storage.get(row.storageKey)).rejects.toMatchObject({
          status: 404,
        });
        await expect(storage.get(row.thumbKey)).rejects.toMatchObject({
          status: 404,
        });
      }
      await agent.get(note.photos[0]?.url ?? '').expect(404);
      await agent.delete(`/api/notes/${note.id}`).expect(404);
    });

    it('keeps a photo that something else still uses', async () => {
      const note = await createPhotoNote('Box', [await image(800, 600)]);
      const photoId = note.photos[0]?.id ?? '';
      const entry = await prisma.entry.create({
        data: {
          userId,
          name: 'Soup',
          mealType: 'lunch',
          source: 'food_photo',
          timestamp: new Date(),
          localDate: '2026-10-07',
          photoId,
        },
      });

      await agent.delete(`/api/notes/${note.id}`).expect(204);
      await expect(photoExists(photoId)).resolves.toBe(true);

      await prisma.entry.delete({ where: { id: entry.id } });
      await expect(photos.deleteIfUnreferenced(photoId)).resolves.toBe(true);
    });

    it('answers 404 for unknown ids and 400 for malformed ones', async () => {
      await agent.delete(`/api/notes/${randomUUID()}`).expect(404);
      await agent.delete('/api/notes/not-a-uuid').expect(400);
    });
  });

  describe('ownership', () => {
    it('hides the notes and photos of other people', async () => {
      const stranger = await createSignedInUser(app);
      const mine = await createPhotoNote('Box', [await image(800, 600)]);
      const theirs = await createTextNote('Their note', stranger.agent);

      expect((await listNotes()).notes.map(({ id }) => id)).toEqual([mine.id]);
      expect(
        (await listNotes({}, stranger.agent)).notes.map(({ id }) => id),
      ).toEqual([theirs.id]);
      expect((await listNotes({ q: 'box' }, stranger.agent)).notes).toEqual([]);

      await stranger.agent
        .patch(`/api/notes/${mine.id}`)
        .send({ text: 'Taken over', done: true })
        .expect(404);
      await stranger.agent.delete(`/api/notes/${mine.id}`).expect(404);
      await stranger.agent.get(mine.photos[0]?.url ?? '').expect(404);
      await stranger.agent.get(mine.photos[0]?.thumbUrl ?? '').expect(404);

      expect((await listNotes()).notes).toEqual([mine]);
      await agent.get(mine.photos[0]?.url ?? '').expect(200);
    });

    it('removes the notes and photo files of a deleted person', async () => {
      const member = await createSignedInUser(app);
      const note = await createPhotoNote(
        'Their box',
        [await image(800, 600)],
        member.agent,
      );
      const row = await prisma.photo.findUniqueOrThrow({
        where: { id: note.photos[0]?.id ?? '' },
      });
      await expect(storage.get(row.storageKey)).resolves.toHaveLength(
        row.bytes,
      );

      await agent.delete(`/api/admin/users/${member.user.id}`).expect(204);

      expect(await prisma.note.count()).toBe(0);
      expect(await prisma.notePhoto.count()).toBe(0);
      expect(await prisma.photo.count()).toBe(0);
      await expect(storage.get(row.storageKey)).rejects.toMatchObject({
        status: 404,
      });
      await expect(storage.get(row.thumbKey)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('photo cleanup', () => {
    it('never cleans up the photo of a note, however old it is', async () => {
      const note = await createPhotoNote('Box', [await image(800, 600)]);
      const photoId = note.photos[0]?.id ?? '';
      const orphan = await photos.createFromUpload(
        userId,
        await image(400, 300),
        { role: 'food' },
      );
      await prisma.photo.updateMany({
        where: { id: { in: [photoId, orphan.id] } },
        data: { createdAt: new Date(Date.now() - 60 * DAY_MS) },
      });

      await expect(photos.deleteIfUnreferenced(photoId)).resolves.toBe(false);
      const result = await app.get(PhotoCleanupService).runCleanup(new Date());

      expect(result.photos).toBe(1);
      await expect(photoExists(orphan.id)).resolves.toBe(false);
      await expect(photoExists(photoId)).resolves.toBe(true);
      await agent.get(note.photos[0]?.url ?? '').expect(200);
      await agent.get(note.photos[0]?.thumbUrl ?? '').expect(200);
      expect((await listNotes()).notes).toEqual([note]);

      await agent.delete(`/api/notes/${note.id}`).expect(204);
      await expect(photoExists(photoId)).resolves.toBe(false);
    });
  });
});

describe('notes throttling (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      throttling: true,
      configure: withSettings({ notesEnabled: true }),
    });
    await resetDatabase(app.get(PrismaService));
  });

  afterAll(async () => {
    await resetDatabase(app.get(PrismaService));
    await app.close();
  });

  it(`allows ${NOTE_CREATE_THROTTLE.long.limit} new notes per minute per client`, async () => {
    const agent = await setupAndLogin(app);
    const create = (): request.Test =>
      agent.post('/api/notes').send({ text: 'Buy mirror' });

    const first = await create().expect(201);
    const second = await create().expect(201);
    const listing = await agent.get('/api/notes').expect(200);

    expect(first.headers['x-ratelimit-limit-long']).toBe(
      String(NOTE_CREATE_THROTTLE.long.limit),
    );
    expect(first.headers['x-ratelimit-remaining-long']).toBe(
      String(NOTE_CREATE_THROTTLE.long.limit - 1),
    );
    expect(second.headers['x-ratelimit-remaining-long']).toBe(
      String(NOTE_CREATE_THROTTLE.long.limit - 2),
    );
    expect(listing.headers['x-ratelimit-limit-long']).toBe('600');
  });
});
