import { randomUUID } from 'node:crypto';
import {
  fitToPatchBudget,
  patchCount,
  VISION_MAX_PATCHES,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { APP_THROTTLERS } from '../src/common/throttling.js';
import type { Photo } from '../src/generated/prisma/client.js';
import { PhotoCleanupService } from '../src/photos/photo-cleanup.service.js';
import { PhotosService } from '../src/photos/photos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const IMMUTABLE_PRIVATE = 'private, max-age=31536000, immutable';
const DAY_MS = 24 * 60 * 60 * 1000;

function binaryParser(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function testImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 160, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

describe('photos (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let photos: PhotosService;
  let storage: StorageService;
  let agent: TestAgent;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    photos = app.get(PhotosService);
    storage = app.get(StorageService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function createPhoto(ownerId = userId): Promise<Photo> {
    return photos.createFromUpload(ownerId, await testImage(3000, 2000), {
      role: 'food',
    });
  }

  it('stores a processed photo and serves it and its thumbnail to the owner', async () => {
    const photo = await createPhoto();
    expect(photo).toMatchObject({ userId, width: 1920, height: 1280 });
    expect(photo.storageKey).toMatch(/^photos\/[0-9a-f-]{36}\.jpg$/);
    expect(photo.thumbKey).toBe(
      photo.storageKey.replace('.jpg', '_thumb.webp'),
    );

    const full = await agent
      .get(`/api/photos/${photo.id}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(full.headers['content-type']).toBe('image/jpeg');
    expect(full.headers['cache-control']).toBe(IMMUTABLE_PRIVATE);
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    const fullMeta = await sharp(full.body as Buffer).metadata();
    expect([fullMeta.format, fullMeta.width, fullMeta.height]).toEqual([
      'jpeg',
      1920,
      1280,
    ]);
    expect((full.body as Buffer).length).toBe(photo.bytes);

    const thumb = await agent
      .get(`/api/photos/${photo.id}/thumb`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cache-control']).toBe(IMMUTABLE_PRIVATE);
    const thumbMeta = await sharp(thumb.body as Buffer).metadata();
    expect([thumbMeta.format, thumbMeta.width]).toEqual(['webp', 320]);

    await expect(photos.readFull(photo)).resolves.toHaveLength(photo.bytes);
  });

  it.each([
    ['portrait food', 3024, 4032, 'food', 1344, 1792, '4:2:0'],
    ['landscape food', 4032, 3024, 'food', 1792, 1344, '4:2:0'],
    ['portrait label', 3024, 4032, 'label', 1344, 1792, '4:4:4'],
    ['landscape label', 4032, 3024, 'label', 1792, 1344, '4:4:4'],
    ['9:16 food', 1440, 2560, 'food', 1152, 2048, '4:2:0'],
    ['9:16 label', 1440, 2560, 'label', 1152, 2048, '4:4:4'],
  ] as const)(
    'stores a %s photo sized to the vision patch budget',
    async (_name, width, height, role, storedWidth, storedHeight, chroma) => {
      const photo = await photos.createFromUpload(
        userId,
        await testImage(width, height),
        { role },
      );

      expect([photo.width, photo.height]).toEqual([storedWidth, storedHeight]);
      expect(photo).toMatchObject(fitToPatchBudget({ width, height }));
      expect(patchCount(photo)).toBeLessThanOrEqual(VISION_MAX_PATCHES);
      const meta = await sharp(await photos.readFull(photo)).metadata();
      expect([
        meta.format,
        meta.width,
        meta.height,
        meta.chromaSubsampling,
      ]).toEqual(['jpeg', storedWidth, storedHeight, chroma]);
    },
  );

  it('returns 404 for unknown photos without caching the error', async () => {
    const response = await agent.get(`/api/photos/${randomUUID()}`).expect(404);
    expect(response.headers['cache-control']).not.toBe(IMMUTABLE_PRIVATE);
    await agent.get(`/api/photos/${randomUUID()}/thumb`).expect(404);
  });

  it('rejects malformed ids with 400', async () => {
    await agent.get('/api/photos/not-a-uuid').expect(400);
  });

  it('hides photos owned by another user', async () => {
    const stranger = await prisma.user.create({
      data: {
        email: `stranger-${randomUUID()}@example.com`,
        passwordHash: 'x',
      },
    });
    const photo = await createPhoto(stranger.id);

    await agent.get(`/api/photos/${photo.id}`).expect(404);
    await agent.get(`/api/photos/${photo.id}/thumb`).expect(404);
  });

  it('requires authentication', async () => {
    const photo = await createPhoto();
    await request(app.getHttpServer())
      .get(`/api/photos/${photo.id}`)
      .expect(401);
  });

  it('rejects uploads that are not images', async () => {
    await expect(
      photos.createFromUpload(userId, Buffer.from('plain text'), {
        role: 'food',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('deletes a photo only once nothing references it', async () => {
    const photo = await createPhoto();
    const entry = await prisma.entry.create({
      data: {
        userId,
        name: 'Salad',
        mealType: 'lunch',
        source: 'food_photo',
        timestamp: new Date(),
        localDate: '2026-09-28',
        photoId: photo.id,
      },
    });

    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(false);
    await expect(photos.deleteIfUnreferenced(null)).resolves.toBe(false);

    await prisma.entry.delete({ where: { id: entry.id } });
    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(true);
    await expect(
      prisma.photo.findUnique({ where: { id: photo.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
      status: 404,
    });
    await expect(storage.get(photo.thumbKey)).rejects.toMatchObject({
      status: 404,
    });
    await agent.get(`/api/photos/${photo.id}`).expect(404);
  });

  it('keeps an unreferenced photo row until its files are really gone', async () => {
    const photo = await createPhoto();
    const entry = (
      await agent
        .post('/api/entries')
        .send({
          name: 'Salad',
          description: null,
          mealType: 'lunch',
          source: 'food_photo',
          timestamp: new Date().toISOString(),
          localDate: '2026-09-28',
          items: [{ name: 'Salad', grams: 200, nutrients: zeroNutrients() }],
          photoId: photo.id,
          analysisId: null,
        })
        .expect(201)
    ).body as { id: string };
    const failOnce = vi
      .spyOn(storage, 'delete')
      .mockRejectedValueOnce(new Error('R2 unavailable'));

    try {
      await agent.delete(`/api/entries/${entry.id}`).expect(204);
    } finally {
      failOnce.mockRestore();
    }

    await expect(
      prisma.photo.findUnique({ where: { id: photo.id } }),
    ).resolves.not.toBeNull();
    await expect(storage.get(photo.storageKey)).resolves.toHaveLength(
      photo.bytes,
    );
    await app
      .get(PhotoCleanupService)
      .runCleanup(new Date(Date.now() + DAY_MS + 60_000));
    await expect(
      prisma.photo.findUnique({ where: { id: photo.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
      status: 404,
    });
    await expect(storage.get(photo.thumbKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps cleaning the other orphans when the files of one cannot be deleted', async () => {
    const stuck = await createPhoto();
    const other = await createPhoto();
    const later = new Date(Date.now() + DAY_MS + 60_000);
    const deleteFile = storage.delete.bind(storage);
    const failing = vi
      .spyOn(storage, 'delete')
      .mockImplementation((key: string) =>
        key === stuck.storageKey
          ? Promise.reject(new Error('R2 unavailable'))
          : deleteFile(key),
      );

    try {
      await app.get(PhotoCleanupService).runCleanup(later);
    } finally {
      failing.mockRestore();
    }

    await expect(
      prisma.photo.findUnique({ where: { id: other.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.photo.findUnique({ where: { id: stuck.id } }),
    ).resolves.not.toBeNull();
    await expect(storage.get(stuck.storageKey)).resolves.toHaveLength(
      stuck.bytes,
    );

    await app.get(PhotoCleanupService).runCleanup(later);

    await expect(
      prisma.photo.findUnique({ where: { id: stuck.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(stuck.storageKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps a photo referenced only by an analysis photo row', async () => {
    const photo = await createPhoto();
    const analysis = await prisma.analysis.create({
      data: {
        userId,
        mode: 'food_photo',
        model: 'mock',
        result: {},
        photos: { create: { photoId: photo.id, role: 'label', position: 1 } },
      },
    });

    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(false);
    await expect(
      prisma.analysisPhoto.count({ where: { photoId: photo.id } }),
    ).resolves.toBe(1);

    await prisma.analysis.delete({ where: { id: analysis.id } });
    await expect(
      prisma.analysisPhoto.count({ where: { photoId: photo.id } }),
    ).resolves.toBe(0);
    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(true);
    await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps a photo referenced only by an entry photo row', async () => {
    const photo = await createPhoto();
    const entry = await prisma.entry.create({
      data: {
        userId,
        name: 'Granola',
        mealType: 'breakfast',
        source: 'food_photo',
        timestamp: new Date(),
        localDate: '2026-09-28',
        photos: { create: { photoId: photo.id, role: 'label', position: 1 } },
      },
    });

    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(false);

    await prisma.entry.delete({ where: { id: entry.id } });
    await expect(
      prisma.entryPhoto.count({ where: { photoId: photo.id } }),
    ).resolves.toBe(0);
    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(true);
    await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps a photo referenced only by a note photo row', async () => {
    const photo = await createPhoto();
    await prisma.photo.update({
      where: { id: photo.id },
      data: { createdAt: new Date(Date.now() - 30 * DAY_MS) },
    });
    const note = await prisma.note.create({
      data: {
        userId,
        text: 'Install this for the bathroom',
        photos: { create: { photoId: photo.id, position: 0 } },
      },
    });

    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(false);
    await app.get(PhotoCleanupService).runCleanup(new Date());
    await expect(storage.get(photo.storageKey)).resolves.toHaveLength(
      photo.bytes,
    );

    await prisma.note.delete({ where: { id: note.id } });
    await expect(
      prisma.notePhoto.count({ where: { photoId: photo.id } }),
    ).resolves.toBe(0);
    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(true);
    await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('never cleans up photos that entries keep through entry photo rows', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 30 * DAY_MS);
    const food = await createPhoto();
    const label = await createPhoto();
    const orphan = await createPhoto();
    await prisma.photo.updateMany({
      where: { id: { in: [food.id, label.id, orphan.id] } },
      data: { createdAt: old },
    });
    const stale = await prisma.analysis.create({
      data: {
        userId,
        mode: 'food_photo',
        model: 'mock',
        result: {},
        createdAt: old,
        photoId: food.id,
        photos: {
          create: [
            { photoId: food.id, role: 'food', position: 0 },
            { photoId: label.id, role: 'label', position: 1 },
            { photoId: orphan.id, role: 'label', position: 2 },
          ],
        },
      },
    });
    const entry = await prisma.entry.create({
      data: {
        userId,
        name: 'Yogurt bowl',
        mealType: 'breakfast',
        source: 'copy',
        timestamp: now,
        localDate: '2026-09-28',
        photoId: food.id,
        photos: {
          create: [
            { photoId: food.id, role: 'food', position: 0 },
            { photoId: label.id, role: 'label', position: 1 },
          ],
        },
        ...zeroNutrients(),
      },
    });

    const result = await app.get(PhotoCleanupService).runCleanup(now);

    expect(result.analyses).toBeGreaterThanOrEqual(1);
    expect(result.photos).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.analysis.findUnique({ where: { id: stale.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(food.storageKey)).resolves.toHaveLength(
      food.bytes,
    );
    await expect(storage.get(label.storageKey)).resolves.toHaveLength(
      label.bytes,
    );
    await expect(
      prisma.photo.findUnique({ where: { id: orphan.id } }),
    ).resolves.toBeNull();

    await agent.delete(`/api/entries/${entry.id}`).expect(204);

    await expect(
      prisma.photo.count({ where: { id: { in: [food.id, label.id] } } }),
    ).resolves.toBe(0);
    await expect(storage.get(label.storageKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps photos still referenced through analysis photo rows when stale analyses are cleaned up', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 8 * DAY_MS);
    const shared = await createPhoto();
    const labelOnly = await createPhoto();
    const staleOnly = await createPhoto();
    await prisma.photo.updateMany({
      where: { id: { in: [shared.id, labelOnly.id, staleOnly.id] } },
      data: { createdAt: old },
    });
    const stale = await prisma.analysis.create({
      data: {
        userId,
        mode: 'food_photo',
        model: 'mock',
        result: {},
        createdAt: old,
        photoId: shared.id,
        photos: {
          create: [
            { photoId: shared.id, role: 'food', position: 0 },
            { photoId: staleOnly.id, role: 'label', position: 1 },
          ],
        },
      },
    });
    const logged = await prisma.analysis.create({
      data: {
        userId,
        mode: 'food_photo',
        model: 'mock',
        result: {},
        createdAt: old,
        previousAnalysisId: stale.id,
        photos: {
          create: [
            { photoId: shared.id, role: 'food', position: 0 },
            { photoId: labelOnly.id, role: 'label', position: 1 },
          ],
        },
      },
    });
    await prisma.entry.create({
      data: {
        userId,
        name: 'Labneh',
        mealType: 'breakfast',
        source: 'food_photo',
        timestamp: now,
        localDate: '2026-09-28',
        analysisId: logged.id,
        ...zeroNutrients(),
      },
    });

    const result = await app.get(PhotoCleanupService).runCleanup(now);

    expect(result.analyses).toBe(1);
    await expect(
      prisma.analysis.findUnique({ where: { id: stale.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.analysisPhoto.count({ where: { analysisId: logged.id } }),
    ).resolves.toBe(2);
    await expect(
      prisma.photo.findUnique({ where: { id: shared.id } }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.photo.findUnique({ where: { id: labelOnly.id } }),
    ).resolves.not.toBeNull();
    await expect(storage.get(labelOnly.storageKey)).resolves.toHaveLength(
      labelOnly.bytes,
    );
    await expect(
      prisma.photo.findUnique({ where: { id: staleOnly.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(staleOnly.storageKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps photos and analyses of a draft however old they are', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 30 * DAY_MS);
    const drafted = await createPhoto();
    const analysisOnly = await createPhoto();
    await prisma.photo.updateMany({
      where: { id: { in: [drafted.id, analysisOnly.id] } },
      data: { createdAt: old },
    });
    const analysis = await prisma.analysis.create({
      data: {
        userId,
        mode: 'food_photo',
        model: 'mock',
        result: {},
        createdAt: old,
        photoId: drafted.id,
        photos: {
          create: [
            { photoId: drafted.id, role: 'food', position: 0 },
            { photoId: analysisOnly.id, role: 'label', position: 1 },
          ],
        },
      },
    });
    const draft = await prisma.draft.create({
      data: {
        userId,
        mode: 'food_photo',
        timestamp: old,
        localDate: '2026-08-31',
        analysisId: analysis.id,
        photos: { create: { photoId: drafted.id, role: 'food' } },
      },
    });

    await expect(photos.deleteIfUnreferenced(drafted.id)).resolves.toBe(false);
    const result = await app.get(PhotoCleanupService).runCleanup(now);

    expect(result.analyses).toBe(0);
    await expect(
      prisma.analysis.findUnique({ where: { id: analysis.id } }),
    ).resolves.not.toBeNull();
    await expect(storage.get(drafted.storageKey)).resolves.toHaveLength(
      drafted.bytes,
    );
    await expect(storage.get(analysisOnly.storageKey)).resolves.toHaveLength(
      analysisOnly.bytes,
    );

    await agent.delete(`/api/drafts/${draft.id}`).expect(204);
    await expect(
      prisma.photo.findUnique({ where: { id: drafted.id } }),
    ).resolves.not.toBeNull();
    const afterDraft = await app.get(PhotoCleanupService).runCleanup(now);

    expect(afterDraft.analyses).toBe(1);
    await expect(
      prisma.photo.findUnique({ where: { id: drafted.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.photo.findUnique({ where: { id: analysisOnly.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(drafted.storageKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('deletes a draft photo as soon as its draft is deleted', async () => {
    const photo = await createPhoto();
    const draft = await prisma.draft.create({
      data: {
        userId,
        mode: 'food_photo',
        timestamp: new Date(),
        localDate: '2026-09-30',
        photos: { create: { photoId: photo.id, role: 'food' } },
      },
    });

    await expect(photos.deleteIfUnreferenced(photo.id)).resolves.toBe(false);
    await app
      .get(PhotoCleanupService)
      .runCleanup(new Date(Date.now() + 30 * DAY_MS));
    await agent.get(`/api/photos/${photo.id}`).expect(200);

    await agent.delete(`/api/drafts/${draft.id}`).expect(204);

    await expect(
      prisma.photo.findUnique({ where: { id: photo.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
      status: 404,
    });
    await expect(storage.get(photo.thumbKey)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('cleans up stale analyses and orphan photos', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 8 * DAY_MS);
    const orphan = await createPhoto();
    const recentOrphan = await createPhoto();
    const referenced = await createPhoto();
    await prisma.photo.updateMany({
      where: { id: { in: [orphan.id, referenced.id] } },
      data: { createdAt: old },
    });
    const analysisBase = {
      userId,
      mode: 'food_photo' as const,
      model: 'mock',
      result: {},
      createdAt: old,
    };
    const staleAnalysis = await prisma.analysis.create({
      data: { ...analysisBase, photoId: orphan.id },
    });
    const usedAnalysis = await prisma.analysis.create({ data: analysisBase });
    await prisma.entry.create({
      data: {
        userId,
        name: 'Soup',
        mealType: 'dinner',
        source: 'food_photo',
        timestamp: now,
        localDate: '2026-09-28',
        photoId: referenced.id,
        analysisId: usedAnalysis.id,
        ...zeroNutrients(),
      },
    });

    const result = await app.get(PhotoCleanupService).runCleanup(now);

    expect(result.analyses).toBe(1);
    expect(result.photos).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.analysis.findUnique({ where: { id: staleAnalysis.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.analysis.findUnique({ where: { id: usedAnalysis.id } }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.photo.findUnique({ where: { id: orphan.id } }),
    ).resolves.toBeNull();
    await expect(storage.get(orphan.storageKey)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      prisma.photo.findUnique({ where: { id: recentOrphan.id } }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.photo.findUnique({ where: { id: referenced.id } }),
    ).resolves.not.toBeNull();
  });
});

describe('photo thumbnail throttling (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let photo: Photo;
  const shortLimit =
    APP_THROTTLERS.find((throttler) => throttler.name === 'short')?.limit ?? 0;
  const longLimit =
    APP_THROTTLERS.find((throttler) => throttler.name === 'long')?.limit ?? 0;

  beforeAll(async () => {
    app = await createTestApp({ throttling: true });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    const userId = (await getTestUser(app)).id;
    photo = await app
      .get(PhotosService)
      .createFromUpload(userId, await testImage(400, 300), { role: 'food' });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('serves a burst of thumbnails without the per-second limit', async () => {
    const responses = await Promise.all(
      Array.from({ length: shortLimit + 10 }, () =>
        agent.get(`/api/photos/${photo.id}/thumb`),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: shortLimit + 10 }, () => 200),
    );
    expect(responses[0]?.headers['x-ratelimit-limit-long']).toBe(
      String(longLimit),
    );
    expect(responses[0]?.headers['x-ratelimit-limit-short']).toBeUndefined();
  });

  it('keeps the per-second limit on full-size photos', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= shortLimit; attempt += 1) {
      statuses.push((await agent.get(`/api/photos/${randomUUID()}`)).status);
    }

    expect(
      statuses.slice(0, shortLimit).every((status) => status === 404),
    ).toBe(true);
    expect(statuses[shortLimit]).toBe(429);
  });
});
