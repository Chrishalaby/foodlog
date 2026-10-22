import { randomUUID } from 'node:crypto';
import {
  addDays,
  API_LIMITS,
  type CreateEntryRequest,
  type EntryDto,
  type EntryItemInput,
  type EntryListResponse,
  type EntryRawAiResponse,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  type Nutrients,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import type { Photo } from '../src/generated/prisma/client.js';
import { PhotoCleanupService } from '../src/photos/photo-cleanup.service.js';
import { PhotosService } from '../src/photos/photos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  createTestApp,
  getTestUser,
  resetDatabase,
  sessionCookieFor,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const RAW_AI_RESPONSE = {
  id: 'resp_mock',
  model: 'mock',
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
};

interface Stranger {
  id: string;
  cookie: string;
}

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function itemInput(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Chicken breast',
    grams: 150,
    nutrients: nutrients({ calories: 248, protein: 46.5, fat: 5.4 }),
    confidence: 'high',
    ...overrides,
  };
}

function entryBody(
  overrides: Partial<CreateEntryRequest> = {},
): CreateEntryRequest {
  return {
    name: 'Chicken salad',
    mealType: 'lunch',
    source: 'manual',
    timestamp: '2026-09-28T12:30:00.000+02:00',
    localDate: '2026-09-28',
    items: [itemInput()],
    ...overrides,
  };
}

function timestampAt(localDate: string, time: string): string {
  return `${localDate}T${time}:00.000Z`;
}

function byNewest(a: EntryDto, b: EntryDto): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp < b.timestamp ? 1 : -1;
  }
  return a.id < b.id ? 1 : -1;
}

function testImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

describe('entries (e2e)', () => {
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

  beforeEach(async () => {
    await prisma.entry.deleteMany();
    await prisma.favorite.deleteMany();
    await prisma.analysis.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: userId } } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function createEntry(
    body: CreateEntryRequest = entryBody(),
  ): Promise<EntryDto> {
    const response = await agent.post('/api/entries').send(body).expect(201);
    return response.body as EntryDto;
  }

  async function createPhoto(ownerId = userId): Promise<Photo> {
    return photos.createFromUpload(ownerId, await testImage(), {
      maxDimension: 1024,
    });
  }

  async function createAnalysis(photoId: string | null, ownerId = userId) {
    return prisma.analysis.create({
      data: {
        userId: ownerId,
        mode: 'food_photo',
        model: 'mock',
        result: {},
        rawResponse: RAW_AI_RESPONSE,
        photoId,
      },
    });
  }

  async function createTwoPhotoAnalysis(food: Photo, label: Photo) {
    return prisma.analysis.create({
      data: {
        userId,
        mode: 'food_photo',
        model: 'mock',
        result: {},
        rawResponse: RAW_AI_RESPONSE,
        photoId: food.id,
        photos: {
          create: [
            { photoId: food.id, role: 'food', position: 0 },
            { photoId: label.id, role: 'label', position: 1 },
          ],
        },
      },
    });
  }

  function photoRoles(entry: EntryDto): [string, string][] {
    return entry.photos.map(({ photo, role }) => [photo.id, role]);
  }

  async function photoExists(photo: Photo): Promise<boolean> {
    return (
      (await prisma.photo.findUnique({ where: { id: photo.id } })) !== null
    );
  }

  async function createStranger(): Promise<Stranger> {
    const user = await prisma.user.create({
      data: {
        email: `stranger-${randomUUID()}@example.com`,
        passwordHash: 'not-a-real-hash',
      },
      select: { id: true, email: true },
    });
    return { id: user.id, cookie: await sessionCookieFor(app, user.id) };
  }

  async function createStrangerEntry(
    stranger: Stranger,
    body: CreateEntryRequest = entryBody({ name: 'Stranger lunch' }),
  ): Promise<EntryDto> {
    const response = await request(app.getHttpServer())
      .post('/api/entries')
      .set('Cookie', stranger.cookie)
      .send(body)
      .expect(201);
    return response.body as EntryDto;
  }

  async function listEntries(
    query: Record<string, string | number>,
  ): Promise<EntryListResponse> {
    const response = await agent.get('/api/entries').query(query).expect(200);
    return response.body as EntryListResponse;
  }

  describe('create', () => {
    it('stores normalized items and recomputes every total server-side', async () => {
      const created = await createEntry(
        entryBody({
          name: '  Lunch bowl  ',
          description: '   ',
          items: [
            itemInput({
              name: '  Chicken breast  ',
              grams: 150.04,
              nutrients: nutrients({
                calories: 247.56,
                protein: 46.44,
                fat: 5.36,
                satFat: 1.51,
                sodium: 110.6,
              }),
              micros: { vitaminB6: 0.904, potassium: 384.4 },
            }),
            itemInput({
              name: 'Olive oil',
              grams: 10,
              nutrients: nutrients({
                calories: 88.4,
                fat: 10.04,
                satFat: 1.38,
              }),
              confidence: null,
            }),
          ],
        }),
      );

      expect(created).toMatchObject({
        name: 'Lunch bowl',
        description: null,
        mealType: 'lunch',
        source: 'manual',
        timestamp: '2026-09-28T10:30:00.000Z',
        localDate: '2026-09-28',
        photo: null,
        analysisId: null,
        favoriteId: null,
      });
      expect(created.items).toEqual([
        {
          id: expect.any(String),
          position: 0,
          name: 'Chicken breast',
          grams: 150,
          nutrients: nutrients({
            calories: 248,
            protein: 46.4,
            fat: 5.4,
            satFat: 1.5,
            sodium: 111,
          }),
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: { vitaminB6: 0.9, potassium: 384 },
          fluidMl: null,
        },
        {
          id: expect.any(String),
          position: 1,
          name: 'Olive oil',
          grams: 10,
          nutrients: nutrients({ calories: 88, fat: 10, satFat: 1.4 }),
          confidence: null,
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: null,
          fluidMl: null,
        },
      ]);
      expect(created.totals).toEqual(
        nutrients({
          calories: 336,
          protein: 46.4,
          fat: 15.4,
          satFat: 2.9,
          sodium: 111,
        }),
      );
      const row = await prisma.entry.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect([row.userId, row.calories, row.fat]).toEqual([userId, 336, 15.4]);
    });

    it('stores the drink volume and micros of each item', async () => {
      const created = await createEntry(
        entryBody({
          items: [
            itemInput({
              name: 'Diet Pepsi',
              grams: 330,
              nutrients: nutrients({ sodium: 33 }),
              micros: { caffeine: 34.98, potassium: 36.3 },
              fluidMl: 330.4,
            }),
            itemInput({ name: 'Water', grams: 250, micros: {}, fluidMl: 250 }),
          ],
        }),
      );

      expect(
        created.items.map(({ name, micros, fluidMl }) => [
          name,
          micros,
          fluidMl,
        ]),
      ).toEqual([
        ['Diet Pepsi', { caffeine: 35, potassium: 36 }, 330],
        ['Water', null, 250],
      ]);
      const rows = await prisma.entryItem.findMany({
        where: { entryId: created.id },
        orderBy: { position: 'asc' },
        select: { micros: true, fluidMl: true },
      });
      expect(rows).toEqual([
        { micros: { caffeine: 35, potassium: 36 }, fluidMl: 330 },
        { micros: null, fluidMl: 250 },
      ]);
    });

    it('rejects client supplied totals instead of trusting them', async () => {
      await agent
        .post('/api/entries')
        .send({ ...entryBody(), totals: nutrients({ calories: 1 }) })
        .expect(400);
      await expect(prisma.entry.count()).resolves.toBe(0);
    });

    it.each<[string, Record<string, unknown>]>([
      ['an impossible local date', { localDate: '2026-02-30' }],
      ['a malformed local date', { localDate: '28.09.2026' }],
      ['a timestamp without an offset', { timestamp: '2026-09-28T12:30:00' }],
      ['a missing timestamp', { timestamp: undefined }],
      ['an empty item list', { items: [] }],
      [
        'too many items',
        {
          items: Array.from({ length: API_LIMITS.itemsMax + 1 }, () =>
            itemInput(),
          ),
        },
      ],
      ['negative grams', { items: [itemInput({ grams: -1 })] }],
      [
        'grams above the maximum',
        { items: [itemInput({ grams: MAX_ITEM_GRAMS + 1 })] },
      ],
      [
        'a negative nutrient',
        { items: [itemInput({ nutrients: nutrients({ protein: -0.1 }) })] },
      ],
      [
        'a nutrient above its maximum',
        {
          items: [
            itemInput({
              nutrients: nutrients({
                calories: NUTRIENT_META.calories.max + 1,
              }),
            }),
          ],
        },
      ],
      [
        'an item without nutrients',
        { items: [{ name: 'Mystery', grams: 100 }] },
      ],
      ['a blank item name', { items: [itemInput({ name: '   ' })] }],
      [
        'an unknown vitamin',
        { items: [{ ...itemInput(), micros: { vitaminQ: 1 } }] },
      ],
      ['a negative mineral', { items: [itemInput({ micros: { iron: -1 } })] }],
      [
        'a vitamin above its item maximum',
        { items: [itemInput({ micros: { vitaminD: 2501 } })] },
      ],
      [
        'micros that are not an object',
        { items: [{ ...itemInput(), micros: [125] }] },
      ],
      [
        'a drink volume above the maximum',
        { items: [itemInput({ fluidMl: 5001 })] },
      ],
      ['a negative drink volume', { items: [itemInput({ fluidMl: -1 })] }],
      ['a blank name', { name: '   ' }],
      ['a name that is too long', { name: 'x'.repeat(API_LIMITS.nameMax + 1) }],
      [
        'a description that is too long',
        { description: 'x'.repeat(API_LIMITS.descriptionMax + 1) },
      ],
      ['an unknown meal type', { mealType: 'brunch' }],
      ['an unknown source', { source: 'magic' }],
      ['a malformed analysis id', { analysisId: 'analysis-1' }],
      ['a malformed photo id', { photoId: 'photo-1' }],
      ['a null character in the name', { name: 'Chicken\u0000salad' }],
      [
        'a null character in the description',
        { description: 'Extra\u0000dressing' },
      ],
      [
        'a null character in an item name',
        { items: [itemInput({ name: 'Chicken\u0000breast' })] },
      ],
      ['a timestamp before year 1', { timestamp: '0000-12-31T12:00:00.000Z' }],
      [
        'a timestamp pushed past year 9999 by its offset',
        { timestamp: '9999-12-31T23:30:00.000-01:00' },
      ],
    ])('rejects %s with 400', async (_label, invalid) => {
      await agent
        .post('/api/entries')
        .send({ ...entryBody(), ...invalid })
        .expect(400);
      await expect(prisma.entry.count()).resolves.toBe(0);
    });

    it.each(['0001-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z'])(
      'stores the extreme timestamp %s',
      async (timestamp) => {
        const created = await createEntry(entryBody({ timestamp }));

        expect(created.timestamp).toBe(timestamp);
        const stored = await agent
          .get(`/api/entries/${created.id}`)
          .expect(200);
        expect((stored.body as EntryDto).timestamp).toBe(timestamp);
      },
    );

    it('reuses the analysis photo when the photo id is null and keeps no photo when the analysis has none', async () => {
      const photo = await createPhoto();
      const withPhoto = await createAnalysis(photo.id);
      const withoutPhoto = await createAnalysis(null);

      const fromPhoto = await createEntry(
        entryBody({ analysisId: withPhoto.id, photoId: null }),
      );
      const fromText = await createEntry(
        entryBody({ source: 'text', analysisId: withoutPhoto.id }),
      );

      expect(fromPhoto.photo?.id).toBe(photo.id);
      expect(fromText).toMatchObject({
        photo: null,
        analysisId: withoutPhoto.id,
      });
    });

    it('links the analysis, copies its raw model response and reuses its photo', async () => {
      const photo = await createPhoto();
      const analysis = await createAnalysis(photo.id);

      const created = await createEntry(
        entryBody({ source: 'food_photo', analysisId: analysis.id }),
      );

      expect(created.analysisId).toBe(analysis.id);
      expect(created.photo).toEqual({
        id: photo.id,
        url: `/api/photos/${photo.id}`,
        thumbUrl: `/api/photos/${photo.id}/thumb`,
        width: photo.width,
        height: photo.height,
      });
      const raw = await agent
        .get(`/api/entries/${created.id}/raw-ai`)
        .expect(200);
      expect(raw.body).toEqual<EntryRawAiResponse>({
        entryId: created.id,
        analysisId: analysis.id,
        rawAiJson: RAW_AI_RESPONSE,
      });
    });

    it('prefers an explicitly given photo over the analysis photo', async () => {
      const analysisPhoto = await createPhoto();
      const chosenPhoto = await createPhoto();
      const analysis = await createAnalysis(analysisPhoto.id);

      const created = await createEntry(
        entryBody({ analysisId: analysis.id, photoId: chosenPhoto.id }),
      );

      expect(created.photo?.id).toBe(chosenPhoto.id);
    });

    it('rejects analyses and photos that are unknown or owned by someone else', async () => {
      const stranger = await createStranger();
      const foreignPhoto = await createPhoto(stranger.id);
      const foreignAnalysis = await createAnalysis(null, stranger.id);

      for (const refs of [
        { analysisId: randomUUID() },
        { analysisId: foreignAnalysis.id },
        { photoId: randomUUID() },
        { photoId: foreignPhoto.id },
      ]) {
        await agent.post('/api/entries').send(entryBody(refs)).expect(404);
      }
      await expect(prisma.entry.count()).resolves.toBe(0);
    });
  });

  describe('entry photos', () => {
    it('keeps the food and the label photo of an analysis and shows the food photo as cover', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const analysis = await createTwoPhotoAnalysis(food, label);

      const created = await createEntry(
        entryBody({
          source: 'food_photo',
          analysisId: analysis.id,
          photoId: food.id,
        }),
      );

      expect(created.photo?.id).toBe(food.id);
      expect(created.photos).toEqual([
        {
          role: 'food',
          photo: {
            id: food.id,
            url: `/api/photos/${food.id}`,
            thumbUrl: `/api/photos/${food.id}/thumb`,
            width: food.width,
            height: food.height,
          },
        },
        {
          role: 'label',
          photo: {
            id: label.id,
            url: `/api/photos/${label.id}`,
            thumbUrl: `/api/photos/${label.id}/thumb`,
            width: label.width,
            height: label.height,
          },
        },
      ]);
      const read = await agent.get(`/api/entries/${created.id}`).expect(200);
      expect(read.body).toEqual(created);
      const listed = await listEntries({
        from: created.localDate,
        to: created.localDate,
      });
      expect(listed.items[0]?.photos).toEqual(created.photos);
      await expect(
        prisma.entryPhoto.findMany({
          where: { entryId: created.id },
          orderBy: { position: 'asc' },
          select: { photoId: true, role: true, position: true },
        }),
      ).resolves.toEqual([
        { photoId: food.id, role: 'food', position: 0 },
        { photoId: label.id, role: 'label', position: 1 },
      ]);
    });

    it('uses the first food photo as cover even when the label came first', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const analysis = await prisma.analysis.create({
        data: {
          userId,
          mode: 'food_photo',
          model: 'mock',
          result: {},
          photoId: food.id,
          photos: {
            create: [
              { photoId: label.id, role: 'label', position: 0 },
              { photoId: food.id, role: 'food', position: 1 },
            ],
          },
        },
      });

      const created = await createEntry(
        entryBody({ source: 'food_photo', analysisId: analysis.id }),
      );

      expect(created.photo?.id).toBe(food.id);
      expect(photoRoles(created)).toEqual([
        [label.id, 'label'],
        [food.id, 'food'],
      ]);
    });

    it('picks a requested cover on create and rejects covers outside the entry', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const unrelated = await createPhoto();
      const analysis = await createTwoPhotoAnalysis(food, label);

      const labelCover = await createEntry(
        entryBody({ analysisId: analysis.id, coverPhotoId: label.id }),
      );
      expect(labelCover.photo?.id).toBe(label.id);
      expect(photoRoles(labelCover)).toEqual([
        [food.id, 'food'],
        [label.id, 'label'],
      ]);

      for (const refs of [
        { analysisId: analysis.id, coverPhotoId: unrelated.id },
        { photoId: food.id, coverPhotoId: label.id },
        { coverPhotoId: food.id },
      ]) {
        await agent.post('/api/entries').send(entryBody(refs)).expect(400);
      }
      await agent
        .post('/api/entries')
        .send(entryBody({ coverPhotoId: 'not-a-uuid' }))
        .expect(400);
      await expect(prisma.entry.count()).resolves.toBe(1);
    });

    it('stores a lone photo as the only entry photo', async () => {
      const photo = await createPhoto();

      const created = await createEntry(
        entryBody({ source: 'nutrition_label', photoId: photo.id }),
      );

      expect(created.photo?.id).toBe(photo.id);
      expect(photoRoles(created)).toEqual([[photo.id, 'label']]);
    });

    it('changes the cover with PUT and rejects photos that are not the entry photos', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const unrelated = await createPhoto();
      const stranger = await createStranger();
      const foreign = await createPhoto(stranger.id);
      const analysis = await createTwoPhotoAnalysis(food, label);
      const created = await createEntry(
        entryBody({ source: 'food_photo', analysisId: analysis.id }),
      );
      const replacement = {
        name: 'Yogurt and granola',
        mealType: 'breakfast',
        timestamp: '2026-09-28T08:00:00.000Z',
        localDate: '2026-09-28',
        items: [itemInput()],
      };

      const changed = (
        await agent
          .put(`/api/entries/${created.id}`)
          .send({ ...replacement, coverPhotoId: label.id })
          .expect(200)
      ).body as EntryDto;

      expect(changed.photo?.id).toBe(label.id);
      expect(changed.photos).toEqual(created.photos);
      expect(changed.name).toBe('Yogurt and granola');

      const kept = (
        await agent
          .put(`/api/entries/${created.id}`)
          .send(replacement)
          .expect(200)
      ).body as EntryDto;
      expect(kept.photo?.id).toBe(label.id);

      for (const coverPhotoId of [unrelated.id, foreign.id, randomUUID()]) {
        await agent
          .put(`/api/entries/${created.id}`)
          .send({ ...replacement, name: 'Rejected', coverPhotoId })
          .expect(400);
      }
      await agent
        .put(`/api/entries/${created.id}`)
        .send({ ...replacement, coverPhotoId: 'nope' })
        .expect(400);
      const unchanged = (
        await agent.get(`/api/entries/${created.id}`).expect(200)
      ).body as EntryDto;
      expect(unchanged).toMatchObject({
        name: 'Yogurt and granola',
        photo: { id: label.id },
      });

      const back = (
        await agent
          .put(`/api/entries/${created.id}`)
          .send({ ...replacement, coverPhotoId: food.id })
          .expect(200)
      ).body as EntryDto;
      expect(back.photo?.id).toBe(food.id);
    });

    it('keeps an old cover without a photo row when PUT picks another cover', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const legacy = await prisma.entry.create({
        data: {
          userId,
          name: 'Granola',
          mealType: 'breakfast',
          source: 'food_photo',
          timestamp: new Date('2026-09-28T08:00:00.000Z'),
          localDate: '2026-09-28',
          photoId: food.id,
          photos: {
            create: { photoId: label.id, role: 'label', position: 0 },
          },
        },
      });
      const before = (await agent.get(`/api/entries/${legacy.id}`).expect(200))
        .body as EntryDto;
      expect(photoRoles(before)).toEqual([
        [label.id, 'label'],
        [food.id, 'food'],
      ]);

      const changed = (
        await agent
          .put(`/api/entries/${legacy.id}`)
          .send({
            name: 'Granola',
            mealType: 'breakfast',
            timestamp: '2026-09-28T08:00:00.000Z',
            localDate: '2026-09-28',
            items: [itemInput()],
            coverPhotoId: label.id,
          })
          .expect(200)
      ).body as EntryDto;

      expect(changed.photo?.id).toBe(label.id);
      expect(changed.photos).toEqual(before.photos);
      await expect(
        prisma.entryPhoto.findMany({
          where: { entryId: legacy.id },
          orderBy: { position: 'asc' },
          select: { photoId: true, role: true, position: true },
        }),
      ).resolves.toEqual([
        { photoId: label.id, role: 'label', position: 0 },
        { photoId: food.id, role: 'food', position: 1 },
      ]);
      await expect(photos.deleteIfUnreferenced(food.id)).resolves.toBe(false);

      await agent.delete(`/api/entries/${legacy.id}`).expect(204);

      await expect(photoExists(food)).resolves.toBe(false);
      await expect(photoExists(label)).resolves.toBe(false);
    });

    it('logs again with every photo and the same cover', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const analysis = await createTwoPhotoAnalysis(food, label);
      const original = await createEntry(
        entryBody({
          source: 'food_photo',
          analysisId: analysis.id,
          coverPhotoId: label.id,
        }),
      );

      const copy = (
        await agent
          .post(`/api/entries/${original.id}/duplicate`)
          .send({
            timestamp: '2026-09-29T12:00:00.000Z',
            localDate: '2026-09-29',
          })
          .expect(201)
      ).body as EntryDto;

      expect(copy.analysisId).toBeNull();
      expect(copy.photo?.id).toBe(label.id);
      expect(copy.photos).toEqual(original.photos);
    });

    it('keeps photos another entry still uses and removes them with the last entry', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const analysis = await createTwoPhotoAnalysis(food, label);
      const original = await createEntry(
        entryBody({ source: 'food_photo', analysisId: analysis.id }),
      );
      await prisma.analysis.delete({ where: { id: analysis.id } });
      const copy = (
        await agent
          .post(`/api/entries/${original.id}/duplicate`)
          .send({
            timestamp: '2026-09-29T12:00:00.000Z',
            localDate: '2026-09-29',
          })
          .expect(201)
      ).body as EntryDto;

      await agent.delete(`/api/entries/${original.id}`).expect(204);

      await expect(photoExists(food)).resolves.toBe(true);
      await expect(photoExists(label)).resolves.toBe(true);
      await expect(storage.get(label.storageKey)).resolves.toBeInstanceOf(
        Buffer,
      );

      await agent.delete(`/api/entries/${copy.id}`).expect(204);

      await expect(photoExists(food)).resolves.toBe(false);
      await expect(photoExists(label)).resolves.toBe(false);
      await expect(storage.get(label.storageKey)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('removes a label photo that only the deleted entry kept', async () => {
      const food = await createPhoto();
      const label = await createPhoto();
      const analysis = await createTwoPhotoAnalysis(food, label);
      const created = await createEntry(
        entryBody({ source: 'food_photo', analysisId: analysis.id }),
      );
      await prisma.analysisPhoto.deleteMany({
        where: { analysisId: analysis.id, photoId: label.id },
      });

      await agent.delete(`/api/entries/${created.id}`).expect(204);

      await expect(photoExists(label)).resolves.toBe(false);
      await expect(photoExists(food)).resolves.toBe(true);
      await expect(
        prisma.entryPhoto.count({ where: { entryId: created.id } }),
      ).resolves.toBe(0);
    });

    it('keeps the label photo of an entry after its analysis is cleaned up', async () => {
      const now = new Date();
      const old = new Date(now.getTime() - 30 * DAY_MS);
      const food = await createPhoto();
      const label = await createPhoto();
      const analysis = await createTwoPhotoAnalysis(food, label);
      const created = await createEntry(
        entryBody({ source: 'food_photo', analysisId: analysis.id }),
      );
      const copy = (
        await agent
          .post(`/api/entries/${created.id}/duplicate`)
          .send({
            timestamp: '2026-09-29T12:00:00.000Z',
            localDate: '2026-09-29',
          })
          .expect(201)
      ).body as EntryDto;
      await agent.delete(`/api/entries/${created.id}`).expect(204);
      await prisma.analysis.update({
        where: { id: analysis.id },
        data: { createdAt: old },
      });
      await prisma.photo.updateMany({
        where: { id: { in: [food.id, label.id] } },
        data: { createdAt: old },
      });

      await app.get(PhotoCleanupService).runCleanup(now);

      await expect(
        prisma.analysis.findUnique({ where: { id: analysis.id } }),
      ).resolves.toBeNull();
      const read = (await agent.get(`/api/entries/${copy.id}`).expect(200))
        .body as EntryDto;
      expect(photoRoles(read)).toEqual([
        [food.id, 'food'],
        [label.id, 'label'],
      ]);
      await agent.get(`/api/photos/${label.id}`).expect(200);
    });
  });

  describe('read', () => {
    it('returns an entry to its owner only', async () => {
      const created = await createEntry();
      const stranger = await createStranger();

      const response = await agent
        .get(`/api/entries/${created.id}`)
        .expect(200);
      expect(response.body).toEqual(created);

      await request(app.getHttpServer())
        .get(`/api/entries/${created.id}`)
        .set('Cookie', stranger.cookie)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/entries/${created.id}/raw-ai`)
        .set('Cookie', stranger.cookie)
        .expect(404);
    });

    it('returns 404 for unknown ids and 400 for malformed ids', async () => {
      await agent.get(`/api/entries/${randomUUID()}`).expect(404);
      await agent.get(`/api/entries/${randomUUID()}/raw-ai`).expect(404);
      await agent.get('/api/entries/not-a-uuid').expect(400);
      await agent.get('/api/entries/not-a-uuid/raw-ai').expect(400);
    });

    it('returns null raw AI json for entries without an analysis', async () => {
      const created = await createEntry();

      const raw = await agent
        .get(`/api/entries/${created.id}/raw-ai`)
        .expect(200);

      expect(raw.body).toEqual<EntryRawAiResponse>({
        entryId: created.id,
        analysisId: null,
        rawAiJson: null,
      });
    });

    it('requires authentication', async () => {
      const server = app.getHttpServer();
      await request(server).get('/api/entries').expect(401);
      await request(server).post('/api/entries').send(entryBody()).expect(401);
      await request(server).get(`/api/entries/${randomUUID()}`).expect(401);
    });
  });

  describe('update', () => {
    it('replaces fields and items, recomputes totals and keeps references', async () => {
      const photo = await createPhoto();
      const analysis = await createAnalysis(photo.id);
      const created = await createEntry(
        entryBody({
          source: 'food_photo',
          description: 'Original',
          analysisId: analysis.id,
          items: [itemInput(), itemInput({ name: 'Lettuce', grams: 50 })],
        }),
      );

      const response = await agent
        .put(`/api/entries/${created.id}`)
        .send({
          name: ' Dinner plate ',
          description: null,
          mealType: 'dinner',
          timestamp: '2026-09-27T19:05:00.000Z',
          localDate: '2026-09-27',
          items: [
            itemInput({
              name: 'Salmon',
              grams: 120.06,
              nutrients: nutrients({
                calories: 249.64,
                protein: 24.46,
                fat: 16.2,
              }),
              micros: { vitaminD: 13.1 },
            }),
          ],
        })
        .expect(200);
      const updated = response.body as EntryDto;

      expect(updated).toMatchObject({
        id: created.id,
        name: 'Dinner plate',
        description: null,
        mealType: 'dinner',
        source: 'food_photo',
        timestamp: '2026-09-27T19:05:00.000Z',
        localDate: '2026-09-27',
        analysisId: analysis.id,
        photo: { id: photo.id },
        createdAt: created.createdAt,
      });
      expect(updated.items).toEqual([
        {
          id: expect.any(String),
          position: 0,
          name: 'Salmon',
          grams: 120.1,
          nutrients: nutrients({ calories: 250, protein: 24.5, fat: 16.2 }),
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: { vitaminD: 13.1 },
          fluidMl: null,
        },
      ]);
      expect(created.items.map((item) => item.id)).not.toContain(
        updated.items[0]?.id,
      );
      expect(updated.totals).toEqual(
        nutrients({ calories: 250, protein: 24.5, fat: 16.2 }),
      );
      await expect(
        prisma.entryItem.count({ where: { entryId: created.id } }),
      ).resolves.toBe(1);
      const raw = await agent
        .get(`/api/entries/${created.id}/raw-ai`)
        .expect(200);
      expect((raw.body as EntryRawAiResponse).rawAiJson).toEqual(
        RAW_AI_RESPONSE,
      );
    });

    it('rejects invalid bodies and entries owned by someone else', async () => {
      const created = await createEntry();
      const stranger = await createStranger();
      const foreign = await createStrangerEntry(stranger);
      const replacement = {
        name: 'Replacement',
        mealType: 'snack',
        timestamp: '2026-09-28T15:00:00.000Z',
        localDate: '2026-09-28',
        items: [itemInput()],
      };

      await agent
        .put(`/api/entries/${created.id}`)
        .send({ ...replacement, items: [] })
        .expect(400);
      await agent
        .put(`/api/entries/${created.id}`)
        .send({ ...replacement, source: 'copy' })
        .expect(400);
      await agent
        .put(`/api/entries/${created.id}`)
        .send({ ...replacement, localDate: '2026-13-01' })
        .expect(400);
      await agent
        .put(`/api/entries/${created.id}`)
        .send({ ...replacement, timestamp: '0000-06-01T00:00:00.000Z' })
        .expect(400);
      await agent
        .put(`/api/entries/${created.id}`)
        .send({ ...replacement, items: [itemInput({ name: 'Ri\u0000ce' })] })
        .expect(400);
      await agent
        .put(`/api/entries/${randomUUID()}`)
        .send(replacement)
        .expect(404);
      await agent
        .put(`/api/entries/${foreign.id}`)
        .send(replacement)
        .expect(404);

      const untouched = await request(app.getHttpServer())
        .get(`/api/entries/${foreign.id}`)
        .set('Cookie', stranger.cookie)
        .expect(200);
      expect(untouched.body).toEqual(foreign);
    });
  });

  describe('delete', () => {
    it('deletes the entry, its items and its no longer referenced photo', async () => {
      const photo = await createPhoto();
      const created = await createEntry(entryBody({ photoId: photo.id }));

      await agent.delete(`/api/entries/${created.id}`).expect(204);

      await agent.get(`/api/entries/${created.id}`).expect(404);
      await expect(
        prisma.entryItem.count({ where: { entryId: created.id } }),
      ).resolves.toBe(0);
      await expect(
        prisma.photo.findUnique({ where: { id: photo.id } }),
      ).resolves.toBeNull();
      await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('keeps a photo that a favorite still uses', async () => {
      const photo = await createPhoto();
      const created = await createEntry(entryBody({ photoId: photo.id }));
      await agent
        .post(`/api/favorites/from-entry/${created.id}`)
        .send({})
        .expect(201);

      await agent.delete(`/api/entries/${created.id}`).expect(204);

      await expect(
        prisma.photo.findUnique({ where: { id: photo.id } }),
      ).resolves.not.toBeNull();
      await expect(storage.get(photo.storageKey)).resolves.toBeInstanceOf(
        Buffer,
      );
    });

    it('keeps a photo shared with another entry', async () => {
      const photo = await createPhoto();
      const first = await createEntry(entryBody({ photoId: photo.id }));
      const copy = await agent
        .post(`/api/entries/${first.id}/duplicate`)
        .send({
          timestamp: '2026-09-29T12:00:00.000Z',
          localDate: '2026-09-29',
        })
        .expect(201);

      await agent.delete(`/api/entries/${first.id}`).expect(204);

      await expect(
        prisma.photo.findUnique({ where: { id: photo.id } }),
      ).resolves.not.toBeNull();
      await agent
        .delete(`/api/entries/${(copy.body as EntryDto).id}`)
        .expect(204);
      await expect(
        prisma.photo.findUnique({ where: { id: photo.id } }),
      ).resolves.toBeNull();
    });

    it('returns 404 for unknown and foreign entries', async () => {
      const stranger = await createStranger();
      const foreign = await createStrangerEntry(stranger);

      await agent.delete(`/api/entries/${randomUUID()}`).expect(404);
      await agent.delete(`/api/entries/${foreign.id}`).expect(404);
      await agent.delete('/api/entries/not-a-uuid').expect(400);

      await expect(
        prisma.entry.findUnique({ where: { id: foreign.id } }),
      ).resolves.not.toBeNull();
    });
  });

  describe('duplicate', () => {
    it('logs an entry again with new time while copying content and references', async () => {
      const photo = await createPhoto();
      const analysis = await createAnalysis(photo.id);
      const original = await createEntry(
        entryBody({
          source: 'food_photo',
          description: 'Extra dressing',
          analysisId: analysis.id,
          items: [
            itemInput(),
            itemInput({
              name: 'Avocado',
              grams: 70,
              nutrients: nutrients({ calories: 112, fat: 10.3, fiber: 4.7 }),
              confidence: 'low',
              micros: { potassium: 341, vitaminK: 15 },
            }),
            itemInput({
              name: 'Soy milk',
              grams: 250,
              micros: { calcium: 300 },
              fluidMl: 250,
            }),
          ],
        }),
      );
      const favorite = await agent
        .post(`/api/favorites/from-entry/${original.id}`)
        .send({})
        .expect(201);
      const favoriteId = (favorite.body as { id: string }).id;
      await prisma.entry.update({
        where: { id: original.id },
        data: { favoriteId },
      });

      const response = await agent
        .post(`/api/entries/${original.id}/duplicate`)
        .send({
          timestamp: '2026-09-29T11:15:00.000+02:00',
          localDate: '2026-09-29',
        })
        .expect(201);
      const copy = response.body as EntryDto;

      expect(copy.id).not.toBe(original.id);
      expect(copy).toMatchObject({
        name: original.name,
        description: 'Extra dressing',
        mealType: 'lunch',
        source: 'copy',
        timestamp: '2026-09-29T09:15:00.000Z',
        localDate: '2026-09-29',
        analysisId: null,
        favoriteId,
        photo: original.photo,
        totals: original.totals,
      });
      const strip = (items: EntryDto['items']) =>
        items.map(({ id: _id, ...rest }) => rest);
      expect(strip(copy.items)).toEqual(strip(original.items));
      expect(
        copy.items.map(({ micros, fluidMl }) => [micros, fluidMl]),
      ).toEqual([
        [null, null],
        [{ potassium: 341, vitaminK: 15 }, null],
        [{ calcium: 300 }, 250],
      ]);
      const raw = await agent.get(`/api/entries/${copy.id}/raw-ai`).expect(200);
      expect(raw.body).toEqual<EntryRawAiResponse>({
        entryId: copy.id,
        analysisId: null,
        rawAiJson: RAW_AI_RESPONSE,
      });
      const unchanged = await agent
        .get(`/api/entries/${original.id}`)
        .expect(200);
      expect((unchanged.body as EntryDto).localDate).toBe('2026-09-28');
    });

    it('lets the client override the meal type', async () => {
      const original = await createEntry();

      const response = await agent
        .post(`/api/entries/${original.id}/duplicate`)
        .send({
          timestamp: '2026-09-29T21:00:00.000Z',
          localDate: '2026-09-29',
          mealType: 'snack',
        })
        .expect(201);

      expect((response.body as EntryDto).mealType).toBe('snack');
    });

    it('validates the body and ownership', async () => {
      const original = await createEntry();
      const stranger = await createStranger();
      const foreign = await createStrangerEntry(stranger);
      const body = {
        timestamp: '2026-09-29T21:00:00.000Z',
        localDate: '2026-09-29',
      };

      await agent
        .post(`/api/entries/${original.id}/duplicate`)
        .send({ timestamp: body.timestamp })
        .expect(400);
      await agent
        .post(`/api/entries/${original.id}/duplicate`)
        .send({ ...body, mealType: 'brunch' })
        .expect(400);
      await agent
        .post(`/api/entries/${original.id}/duplicate`)
        .send({ ...body, name: 'Renamed' })
        .expect(400);
      await agent
        .post(`/api/entries/${original.id}/duplicate`)
        .send({ ...body, timestamp: '0000-06-01T00:00:00.000Z' })
        .expect(400);
      await agent
        .post(`/api/entries/${randomUUID()}/duplicate`)
        .send(body)
        .expect(404);
      await agent
        .post(`/api/entries/${foreign.id}/duplicate`)
        .send(body)
        .expect(404);
      await expect(prisma.entry.count({ where: { userId } })).resolves.toBe(1);
    });
  });

  describe('list by date range', () => {
    it('returns every entry of the range ordered newest first', async () => {
      const stranger = await createStranger();
      await createStrangerEntry(
        stranger,
        entryBody({
          localDate: '2026-09-03',
          timestamp: timestampAt('2026-09-03', '12:00'),
        }),
      );
      const created: EntryDto[] = [];
      for (const [localDate, time] of [
        ['2026-09-01', '08:00'],
        ['2026-09-02', '08:00'],
        ['2026-09-02', '19:00'],
        ['2026-09-03', '12:00'],
        ['2026-09-03', '12:00'],
        ['2026-09-04', '23:30'],
        ['2026-09-05', '07:00'],
      ] as const) {
        created.push(
          await createEntry(
            entryBody({ localDate, timestamp: timestampAt(localDate, time) }),
          ),
        );
      }

      const result = await listEntries({
        from: '2026-09-02',
        to: '2026-09-04',
      });

      const expected = created
        .filter(
          (e) => e.localDate >= '2026-09-02' && e.localDate <= '2026-09-04',
        )
        .sort(byNewest);
      expect(result.nextCursor).toBeNull();
      expect(result.items.map((e) => e.id)).toEqual(expected.map((e) => e.id));
      expect(result.items).toHaveLength(5);
    });

    it('ignores the page size in range mode', async () => {
      for (let i = 0; i < 3; i++) {
        await createEntry();
      }

      const result = await listEntries({
        from: '2026-09-28',
        to: '2026-09-28',
        limit: 1,
      });

      expect(result.items).toHaveLength(3);
      expect(result.nextCursor).toBeNull();
    });

    it('accepts the maximum span', async () => {
      await createEntry();
      const from = addDays('2026-09-28', -(API_LIMITS.rangeMaxDays - 1));

      const result = await listEntries({ from, to: '2026-09-28' });

      expect(result.items).toHaveLength(1);
    });

    it.each<[string, Record<string, string>]>([
      ['only from', { from: '2026-09-01' }],
      ['only to', { to: '2026-09-01' }],
      ['from after to', { from: '2026-09-02', to: '2026-09-01' }],
      [
        'a span above the maximum',
        {
          from: addDays('2026-09-28', -API_LIMITS.rangeMaxDays),
          to: '2026-09-28',
        },
      ],
      ['an impossible date', { from: '2026-02-30', to: '2026-03-02' }],
      ['a malformed date', { from: '2026-9-1', to: '2026-09-02' }],
    ])('rejects %s with 400', async (_label, query) => {
      await agent.get('/api/entries').query(query).expect(400);
    });
  });

  describe('history pagination', () => {
    async function seedWithTies(): Promise<EntryDto[]> {
      const created: EntryDto[] = [];
      for (const time of [
        '12:00',
        '09:00',
        '12:00',
        '11:00',
        '12:00',
        '10:00',
        '11:00',
      ]) {
        created.push(
          await createEntry(
            entryBody({ timestamp: timestampAt('2026-09-28', time) }),
          ),
        );
      }
      return created.sort(byNewest);
    }

    async function collectPages(
      limit: number,
      extra: Record<string, string> = {},
    ): Promise<{ ids: string[]; pageSizes: number[] }> {
      const ids: string[] = [];
      const pageSizes: number[] = [];
      let before: string | null = null;
      do {
        const page = await listEntries({
          ...extra,
          limit,
          ...(before ? { before } : {}),
        });
        ids.push(...page.items.map((e) => e.id));
        pageSizes.push(page.items.length);
        before = page.nextCursor;
      } while (before !== null && pageSizes.length < 20);
      return { ids, pageSizes };
    }

    it('walks every entry exactly once across pages with timestamp ties', async () => {
      const expected = await seedWithTies();
      const stranger = await createStranger();
      await createStrangerEntry(stranger);

      const { ids, pageSizes } = await collectPages(3);

      expect(pageSizes).toEqual([3, 3, 1]);
      expect(ids).toEqual(expected.map((e) => e.id));
    });

    it('issues a cursor only when more rows exist', async () => {
      await seedWithTies();

      const exact = await listEntries({ limit: 7 });
      expect(exact.items).toHaveLength(7);
      expect(exact.nextCursor).toBeNull();

      const partial = await listEntries({ limit: 6 });
      expect(partial.nextCursor).toEqual(expect.any(String));
      const rest = await listEntries({
        limit: 6,
        before: partial.nextCursor ?? '',
      });
      expect(rest.items).toHaveLength(1);
      expect(rest.nextCursor).toBeNull();
    });

    it('defaults to 30 entries per page', async () => {
      for (let i = 0; i < 31; i++) {
        await createEntry(
          entryBody({
            timestamp: new Date(Date.UTC(2026, 8, 28, 0, i)).toISOString(),
          }),
        );
      }

      const first = await listEntries({});
      expect(first.items).toHaveLength(30);
      expect(first.items[0]?.timestamp).toBe('2026-09-28T00:30:00.000Z');
      const second = await listEntries({ before: first.nextCursor ?? '' });
      expect(second.items.map((e) => e.timestamp)).toEqual([
        '2026-09-28T00:00:00.000Z',
      ]);
      expect(second.nextCursor).toBeNull();
    });

    it.each<[string, Record<string, string | number>]>([
      ['a zero limit', { limit: 0 }],
      ['a limit above the maximum', { limit: API_LIMITS.historyPageMax + 1 }],
      ['a fractional limit', { limit: 1.5 }],
      ['a non-numeric limit', { limit: 'ten' }],
      ['a malformed cursor', { before: 'not a cursor' }],
      ['a forged cursor', { before: Buffer.from('1.2').toString('base64url') }],
      [
        'a cursor whose timestamp the database cannot store',
        {
          before: Buffer.from(`-8640000000000000.${randomUUID()}`).toString(
            'base64url',
          ),
        },
      ],
    ])('rejects %s with 400', async (_label, query) => {
      await agent.get('/api/entries').query(query).expect(400);
    });

    it('accepts the maximum page size', async () => {
      await createEntry();

      const result = await listEntries({ limit: API_LIMITS.historyPageMax });

      expect(result.items).toHaveLength(1);
    });
  });

  describe('search', () => {
    let salad: EntryDto;
    let wrap: EntryDto;
    let bowl: EntryDto;

    beforeEach(async () => {
      salad = await createEntry(
        entryBody({
          name: 'Chicken Salad',
          items: [
            itemInput({ name: 'Romaine' }),
            itemInput({ name: 'Olive oil' }),
          ],
          timestamp: timestampAt('2026-09-26', '12:00'),
          localDate: '2026-09-26',
        }),
      );
      wrap = await createEntry(
        entryBody({
          name: 'Lunch wrap',
          description: 'with Feta cheese and 100% whole wheat',
          items: [
            itemInput({ name: 'Tortilla' }),
            itemInput({ name: 'Olive oil' }),
          ],
          timestamp: timestampAt('2026-09-27', '12:00'),
          localDate: '2026-09-27',
        }),
      );
      bowl = await createEntry(
        entryBody({
          name: 'Breakfast bowl',
          items: [
            itemInput({ name: 'Blueberries' }),
            itemInput({ name: 'Skyr' }),
          ],
          timestamp: timestampAt('2026-09-28', '08:00'),
          localDate: '2026-09-28',
        }),
      );
    });

    async function search(query: Record<string, string | number>) {
      return (await listEntries(query)).items.map((e) => e.id);
    }

    it('matches names, descriptions and item names case-insensitively', async () => {
      await expect(search({ q: 'CHICKEN' })).resolves.toEqual([salad.id]);
      await expect(search({ q: 'feta' })).resolves.toEqual([wrap.id]);
      await expect(search({ q: 'blueb' })).resolves.toEqual([bowl.id]);
      await expect(search({ q: '  bowl ' })).resolves.toEqual([bowl.id]);
      await expect(search({ q: 'tortilla' })).resolves.toEqual([wrap.id]);
      await expect(search({ q: 'Olive OIL' })).resolves.toEqual([
        wrap.id,
        salad.id,
      ]);
      await expect(search({ q: 'pizza' })).resolves.toEqual([]);
    });

    it('treats wildcard characters literally', async () => {
      await expect(search({ q: '%' })).resolves.toEqual([wrap.id]);
      await expect(search({ q: '100%' })).resolves.toEqual([wrap.id]);
      await expect(search({ q: '_' })).resolves.toEqual([]);
      await expect(search({ q: '\\' })).resolves.toEqual([]);
    });

    it('combines with date ranges and pagination', async () => {
      await expect(
        search({ q: 'olive', from: '2026-09-27', to: '2026-09-28' }),
      ).resolves.toEqual([wrap.id]);

      const first = await listEntries({ q: 'olive', limit: 1 });
      expect(first.items.map((e) => e.id)).toEqual([wrap.id]);
      const second = await listEntries({
        q: 'olive',
        limit: 1,
        before: first.nextCursor ?? '',
      });
      expect(second.items.map((e) => e.id)).toEqual([salad.id]);
      expect(second.nextCursor).toBeNull();
      await expect(search({ q: 'olive' })).resolves.not.toContain(bowl.id);
    });

    it('never returns entries of other users', async () => {
      const stranger = await createStranger();
      await createStrangerEntry(stranger, entryBody({ name: 'Chicken Salad' }));

      await expect(search({ q: 'salad' })).resolves.toEqual([salad.id]);
    });

    it('rejects overly long queries and null characters', async () => {
      await agent
        .get('/api/entries')
        .query({ q: 'x'.repeat(API_LIMITS.nameMax + 1) })
        .expect(400);
      await agent.get('/api/entries').query({ q: 'sal\u0000ad' }).expect(400);
    });
  });
});
