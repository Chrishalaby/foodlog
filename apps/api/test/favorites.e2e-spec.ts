import { randomUUID } from 'node:crypto';
import {
  API_LIMITS,
  type CreateEntryRequest,
  type CreateFavoriteRequest,
  type EntryDto,
  type EntryItemInput,
  type FavoriteDto,
  MAX_ITEM_GRAMS,
  type Nutrients,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import type { Photo } from '../src/generated/prisma/client.js';
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

interface Stranger {
  id: string;
  cookie: string;
}

const LOG_BODY = {
  timestamp: '2026-09-28T07:45:00.000+02:00',
  localDate: '2026-09-28',
  mealType: 'breakfast',
} as const;

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function oats(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Oats',
    grams: 60,
    nutrients: nutrients({
      calories: 226,
      protein: 8,
      carbs: 40.4,
      fiber: 6.2,
    }),
    confidence: 'high',
    count: null,
    unit: null,
    unitPlural: null,
    productId: null,
    micros: { iron: 2.6, magnesium: 83 },
    fluidMl: null,
    ...overrides,
  };
}

function milk(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Milk',
    grams: 150,
    nutrients: nutrients({ calories: 96, protein: 5.2, fat: 5 }),
    confidence: null,
    count: null,
    unit: null,
    unitPlural: null,
    productId: null,
    micros: { calcium: 180, vitaminD: 1.7 },
    fluidMl: 150,
    ...overrides,
  };
}

function favoriteBody(
  overrides: Partial<CreateFavoriteRequest> = {},
): CreateFavoriteRequest {
  return {
    name: 'Overnight oats',
    mealType: 'breakfast',
    items: [oats(), milk()],
    ...overrides,
  };
}

function entryBody(
  overrides: Partial<CreateEntryRequest> = {},
): CreateEntryRequest {
  return {
    name: 'Chicken bowl',
    description: 'Meal prep',
    mealType: 'dinner',
    source: 'food_photo',
    timestamp: '2026-09-27T19:00:00.000Z',
    localDate: '2026-09-27',
    items: [
      {
        name: 'Chicken breast',
        grams: 150,
        nutrients: nutrients({ calories: 248, protein: 46.5, fat: 5.4 }),
        confidence: 'high',
      },
      {
        name: 'Rice',
        grams: 180,
        nutrients: nutrients({ calories: 234, protein: 4.9, carbs: 51.5 }),
        confidence: 'medium',
      },
    ],
    ...overrides,
  };
}

function testImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 40, g: 90, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe('favorites (e2e)', () => {
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

  async function createFavorite(
    body: CreateFavoriteRequest = favoriteBody(),
  ): Promise<FavoriteDto> {
    const response = await agent.post('/api/favorites').send(body).expect(201);
    return response.body as FavoriteDto;
  }

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

  async function createStrangerFavorite(
    stranger: Stranger,
  ): Promise<FavoriteDto> {
    const response = await request(app.getHttpServer())
      .post('/api/favorites')
      .set('Cookie', stranger.cookie)
      .send(favoriteBody({ name: 'Stranger oats' }))
      .expect(201);
    return response.body as FavoriteDto;
  }

  async function listFavorites(): Promise<FavoriteDto[]> {
    const response = await agent.get('/api/favorites').expect(200);
    return response.body as FavoriteDto[];
  }

  async function logFavorite(
    id: string,
    body: Record<string, unknown> = LOG_BODY,
  ): Promise<EntryDto> {
    const response = await agent
      .post(`/api/favorites/${id}/log`)
      .send(body)
      .expect(201);
    return response.body as EntryDto;
  }

  describe('create', () => {
    it('stores normalized items with server-side totals', async () => {
      const favorite = await createFavorite(
        favoriteBody({
          name: '  Overnight oats  ',
          items: [
            oats({
              name: ' Oats ',
              grams: 60.04,
              nutrients: nutrients({ calories: 225.6, protein: 8.04 }),
            }),
            milk(),
          ],
        }),
      );

      expect(favorite).toEqual<FavoriteDto>({
        id: expect.any(String),
        name: 'Overnight oats',
        mealType: 'breakfast',
        items: [
          {
            name: 'Oats',
            grams: 60,
            nutrients: nutrients({ calories: 226, protein: 8 }),
            confidence: 'high',
            count: null,
            unit: null,
            unitPlural: null,
            productId: null,
            micros: { iron: 2.6, magnesium: 83 },
            fluidMl: null,
          },
          milk(),
        ],
        totals: nutrients({ calories: 322, protein: 13.2, fat: 5 }),
        portion: null,
        photo: null,
        useCount: 0,
        lastUsedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('accepts a missing meal type and an owned photo', async () => {
      const photo = await createPhoto();

      const favorite = await createFavorite({
        name: 'Snack plate',
        items: [oats()],
        photoId: photo.id,
      });

      expect(favorite.mealType).toBeNull();
      expect(favorite.photo).toEqual({
        id: photo.id,
        url: `/api/photos/${photo.id}`,
        thumbUrl: `/api/photos/${photo.id}/thumb`,
        width: photo.width,
        height: photo.height,
      });
    });

    it('rejects photos that are unknown or owned by someone else', async () => {
      const stranger = await createStranger();
      const foreignPhoto = await createPhoto(stranger.id);

      await agent
        .post('/api/favorites')
        .send(favoriteBody({ photoId: randomUUID() }))
        .expect(404);
      await agent
        .post('/api/favorites')
        .send(favoriteBody({ photoId: foreignPhoto.id }))
        .expect(404);
      await expect(prisma.favorite.count()).resolves.toBe(0);
    });

    it.each<[string, Record<string, unknown>]>([
      ['an empty item list', { items: [] }],
      [
        'too many items',
        {
          items: Array.from({ length: API_LIMITS.itemsMax + 1 }, () => oats()),
        },
      ],
      ['negative grams', { items: [oats({ grams: -5 })] }],
      ['a blank name', { name: ' ' }],
      ['a name that is too long', { name: 'x'.repeat(API_LIMITS.nameMax + 1) }],
      ['an unknown meal type', { mealType: 'brunch' }],
      ['a malformed photo id', { photoId: 'photo' }],
      ['client supplied totals', { totals: nutrients() }],
      ['a null character in the name', { name: 'Overnight\u0000oats' }],
      [
        'a null character in an item name',
        { items: [oats({ name: 'Oa\u0000ts' })] },
      ],
    ])('rejects %s with 400', async (_label, invalid) => {
      await agent
        .post('/api/favorites')
        .send({ ...favoriteBody(), ...invalid })
        .expect(400);
      await expect(prisma.favorite.count()).resolves.toBe(0);
    });
  });

  describe('list', () => {
    it('sorts by use count, most recent use (never used last) and name', async () => {
      const stranger = await createStranger();
      await createStrangerFavorite(stranger);
      const usedEarlier = await createFavorite(
        favoriteBody({ name: 'Zucchini' }),
      );
      const usedRecently = await createFavorite(
        favoriteBody({ name: 'Yogurt' }),
      );
      const neverUsedPopular = await createFavorite(
        favoriteBody({ name: 'Apple' }),
      );
      const banana = await createFavorite(favoriteBody({ name: 'Banana' }));
      const apricot = await createFavorite(favoriteBody({ name: 'Apricot' }));
      await prisma.favorite.update({
        where: { id: usedEarlier.id },
        data: { useCount: 5, lastUsedAt: new Date('2026-09-20T08:00:00Z') },
      });
      await prisma.favorite.update({
        where: { id: usedRecently.id },
        data: { useCount: 5, lastUsedAt: new Date('2026-09-25T08:00:00Z') },
      });
      await prisma.favorite.update({
        where: { id: neverUsedPopular.id },
        data: { useCount: 5 },
      });

      const favorites = await listFavorites();

      expect(favorites.map((f) => f.name)).toEqual([
        'Yogurt',
        'Zucchini',
        'Apple',
        'Apricot',
        'Banana',
      ]);
      expect(favorites.map((f) => f.id)).toEqual([
        usedRecently.id,
        usedEarlier.id,
        neverUsedPopular.id,
        apricot.id,
        banana.id,
      ]);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/favorites').expect(401);
      await request(app.getHttpServer())
        .post(`/api/favorites/${randomUUID()}/log`)
        .send(LOG_BODY)
        .expect(401);
    });
  });

  describe('from entry', () => {
    it('copies the entry name, items and photo and leaves the meal type to the logging time', async () => {
      const photo = await createPhoto();
      const entry = await createEntry(entryBody({ photoId: photo.id }));

      const response = await agent
        .post(`/api/favorites/from-entry/${entry.id}`)
        .expect(201);
      const favorite = response.body as FavoriteDto;

      expect(entry.mealType).toBe('dinner');
      expect(favorite).toMatchObject({
        name: 'Chicken bowl',
        mealType: null,
        photo: { id: photo.id },
        totals: entry.totals,
        useCount: 0,
        lastUsedAt: null,
      });
      expect(favorite.items).toEqual(
        entry.items.map(({ id: _id, position: _position, ...item }) => item),
      );
    });

    it('uses a trimmed custom name', async () => {
      const entry = await createEntry();

      const response = await agent
        .post(`/api/favorites/from-entry/${entry.id}`)
        .send({ name: '  Meal prep bowl ' })
        .expect(201);

      expect((response.body as FavoriteDto).name).toBe('Meal prep bowl');
    });

    it('rejects blank names, malformed ids and entries owned by someone else', async () => {
      const entry = await createEntry();
      const stranger = await createStranger();
      const foreign = await request(app.getHttpServer())
        .post('/api/entries')
        .set('Cookie', stranger.cookie)
        .send(entryBody())
        .expect(201);

      await agent
        .post(`/api/favorites/from-entry/${entry.id}`)
        .send({ name: '   ' })
        .expect(400);
      await agent.post('/api/favorites/from-entry/nope').send({}).expect(400);
      await agent
        .post(`/api/favorites/from-entry/${randomUUID()}`)
        .send({})
        .expect(404);
      await agent
        .post(`/api/favorites/from-entry/${(foreign.body as EntryDto).id}`)
        .send({})
        .expect(404);
      await expect(prisma.favorite.count()).resolves.toBe(0);
    });
  });

  describe('update', () => {
    it('replaces name, meal type and items and recomputes totals', async () => {
      const photo = await createPhoto();
      const favorite = await createFavorite(
        favoriteBody({ photoId: photo.id }),
      );
      await prisma.favorite.update({
        where: { id: favorite.id },
        data: { useCount: 4 },
      });

      const response = await agent
        .put(`/api/favorites/${favorite.id}`)
        .send({
          name: 'Protein oats',
          mealType: null,
          items: [
            oats(),
            {
              name: 'Whey',
              grams: 30.06,
              nutrients: nutrients({ calories: 119.6, protein: 24.04 }),
            },
          ],
        })
        .expect(200);
      const updated = response.body as FavoriteDto;

      expect(updated).toMatchObject({
        id: favorite.id,
        name: 'Protein oats',
        mealType: null,
        photo: { id: photo.id },
        useCount: 4,
        createdAt: favorite.createdAt,
      });
      expect(updated.items).toEqual([
        oats(),
        {
          name: 'Whey',
          grams: 30.1,
          nutrients: nutrients({ calories: 120, protein: 24 }),
          confidence: null,
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: null,
          fluidMl: null,
        },
      ]);
      expect(updated.totals).toEqual(
        nutrients({ calories: 346, protein: 32, carbs: 40.4, fiber: 6.2 }),
      );
    });

    it('validates the body and ownership', async () => {
      const favorite = await createFavorite();
      const stranger = await createStranger();
      const foreign = await createStrangerFavorite(stranger);
      const body = { name: 'Renamed', mealType: 'snack', items: [oats()] };

      await agent
        .put(`/api/favorites/${favorite.id}`)
        .send({ name: 'Renamed', items: [oats()] })
        .expect(400);
      await agent
        .put(`/api/favorites/${favorite.id}`)
        .send({ ...body, items: [] })
        .expect(400);
      await agent
        .put(`/api/favorites/${favorite.id}`)
        .send({ ...body, mealType: 'elevenses' })
        .expect(400);
      await agent.put(`/api/favorites/${randomUUID()}`).send(body).expect(404);
      await agent.put(`/api/favorites/${foreign.id}`).send(body).expect(404);

      const unchanged = await prisma.favorite.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      expect(unchanged.name).toBe('Stranger oats');
    });
  });

  describe('delete', () => {
    it('deletes the favorite and its no longer referenced photo', async () => {
      const photo = await createPhoto();
      const favorite = await createFavorite(
        favoriteBody({ photoId: photo.id }),
      );

      await agent.delete(`/api/favorites/${favorite.id}`).expect(204);

      await expect(listFavorites()).resolves.toEqual([]);
      await expect(
        prisma.photo.findUnique({ where: { id: photo.id } }),
      ).resolves.toBeNull();
      await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('keeps the photo and the logged entries when entries still use them', async () => {
      const photo = await createPhoto();
      const favorite = await createFavorite(
        favoriteBody({ photoId: photo.id }),
      );
      const logged = await logFavorite(favorite.id);

      await agent.delete(`/api/favorites/${favorite.id}`).expect(204);

      const entry = await agent.get(`/api/entries/${logged.id}`).expect(200);
      expect(entry.body).toMatchObject({
        favoriteId: null,
        photo: { id: photo.id },
        photos: [{ photo: { id: photo.id }, role: 'food' }],
      });
      await expect(storage.get(photo.storageKey)).resolves.toBeInstanceOf(
        Buffer,
      );

      await agent.delete(`/api/entries/${logged.id}`).expect(204);
      await expect(storage.get(photo.storageKey)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('returns 404 for unknown and foreign favorites', async () => {
      const stranger = await createStranger();
      const foreign = await createStrangerFavorite(stranger);

      await agent.delete(`/api/favorites/${randomUUID()}`).expect(404);
      await agent.delete(`/api/favorites/${foreign.id}`).expect(404);
      await agent.delete('/api/favorites/nope').expect(400);
      await expect(
        prisma.favorite.findUnique({ where: { id: foreign.id } }),
      ).resolves.not.toBeNull();
    });
  });

  describe('log', () => {
    it('logs one serving by default and records the usage', async () => {
      const photo = await createPhoto();
      const favorite = await createFavorite(
        favoriteBody({ photoId: photo.id }),
      );
      const before = Date.now();

      const entry = await logFavorite(favorite.id);

      expect(entry).toMatchObject({
        name: 'Overnight oats',
        description: null,
        mealType: 'breakfast',
        source: 'favorite',
        timestamp: '2026-09-28T05:45:00.000Z',
        localDate: '2026-09-28',
        favoriteId: favorite.id,
        analysisId: null,
        photo: { id: photo.id },
        totals: favorite.totals,
      });
      expect(
        entry.photos.map(({ photo: stored, role }) => [stored.id, role]),
      ).toEqual([[photo.id, 'food']]);
      await expect(
        prisma.entryPhoto.findMany({
          where: { entryId: entry.id },
          select: { photoId: true, role: true, position: true },
        }),
      ).resolves.toEqual([{ photoId: photo.id, role: 'food', position: 0 }]);
      expect(
        entry.items.map(
          ({
            name,
            grams,
            nutrients: n,
            confidence,
            count,
            unit,
            unitPlural,
            productId,
            micros,
            fluidMl,
          }) => ({
            name,
            grams,
            nutrients: n,
            confidence,
            count,
            unit,
            unitPlural,
            productId,
            micros,
            fluidMl,
          }),
        ),
      ).toEqual(favorite.items);
      const [stored] = await listFavorites();
      expect(stored?.useCount).toBe(1);
      const lastUsedAt = Date.parse(stored?.lastUsedAt ?? '');
      expect(lastUsedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(lastUsedAt).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('scales items by 1.5 servings and names the entry accordingly', async () => {
      const favorite = await createFavorite();
      await logFavorite(favorite.id);

      const entry = await logFavorite(favorite.id, {
        ...LOG_BODY,
        mealType: 'snack',
        servings: 1.5,
      });

      expect(entry.name).toBe('Overnight oats ×1.5');
      expect(entry.mealType).toBe('snack');
      expect(entry.items).toEqual([
        {
          id: expect.any(String),
          position: 0,
          name: 'Oats',
          grams: 90,
          nutrients: nutrients({
            calories: 339,
            protein: 12,
            carbs: 60.6,
            fiber: 9.3,
          }),
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: { iron: 3.9, magnesium: 125 },
          fluidMl: null,
        },
        {
          id: expect.any(String),
          position: 1,
          name: 'Milk',
          grams: 225,
          nutrients: nutrients({ calories: 144, protein: 7.8, fat: 7.5 }),
          confidence: null,
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: { calcium: 270, vitaminD: 2.6 },
          fluidMl: 225,
        },
      ]);
      expect(entry.totals).toEqual(
        nutrients({
          calories: 483,
          protein: 19.8,
          carbs: 60.6,
          fat: 7.5,
          fiber: 9.3,
        }),
      );
      const stored = await prisma.favorite.findUniqueOrThrow({
        where: { id: favorite.id },
      });
      expect(stored.useCount).toBe(2);
      expect(stored.calories).toBe(322);
    });

    it.each<[number, string, number, number]>([
      [API_LIMITS.favoriteServingsMin, 'Overnight oats ×0.1', 6, 33],
      [API_LIMITS.favoriteServingsMax, 'Overnight oats ×20', 1200, 6440],
    ])(
      'accepts %s servings at the allowed bounds with totals summed from rounded items',
      async (servings, name, oatsGrams, calories) => {
        const favorite = await createFavorite();

        const entry = await logFavorite(favorite.id, { ...LOG_BODY, servings });

        expect(entry.name).toBe(name);
        expect(entry.items[0]?.grams).toBe(oatsGrams);
        expect(entry.totals.calories).toBe(calories);
      },
    );

    it('keeps long names within the name limit', async () => {
      const name = 'Big '.repeat(40).trim().slice(0, API_LIMITS.nameMax);
      const favorite = await createFavorite(favoriteBody({ name }));

      const entry = await logFavorite(favorite.id, {
        ...LOG_BODY,
        servings: 2,
      });

      expect(entry.name.length).toBeLessThanOrEqual(API_LIMITS.nameMax);
      expect(entry.name.endsWith(' ×2')).toBe(true);
    });

    it.each<[string, Record<string, unknown>]>([
      [
        'servings below the minimum',
        { servings: API_LIMITS.favoriteServingsMin / 2 },
      ],
      [
        'servings above the maximum',
        { servings: API_LIMITS.favoriteServingsMax + 1 },
      ],
      ['non-numeric servings', { servings: 'two' }],
      ['a missing meal type', { mealType: undefined }],
      ['an impossible local date', { localDate: '2026-02-29' }],
      ['a timestamp without an offset', { timestamp: '2026-09-28T07:45' }],
      ['a timestamp before year 1', { timestamp: '0000-06-01T00:00:00Z' }],
      ['unknown properties', { name: 'Custom' }],
    ])(
      'rejects %s with 400 without recording a use',
      async (_label, invalid) => {
        const favorite = await createFavorite();

        await agent
          .post(`/api/favorites/${favorite.id}/log`)
          .send({ ...LOG_BODY, ...invalid })
          .expect(400);

        const [stored] = await listFavorites();
        expect(stored?.useCount).toBe(0);
        await expect(prisma.entry.count()).resolves.toBe(0);
      },
    );

    it('rejects servings that would push an item past the limits and rolls back', async () => {
      const favorite = await createFavorite(
        favoriteBody({ items: [oats({ grams: MAX_ITEM_GRAMS / 2 + 1 })] }),
      );

      await agent
        .post(`/api/favorites/${favorite.id}/log`)
        .send({ ...LOG_BODY, servings: 2 })
        .expect(400);

      const stored = await prisma.favorite.findUniqueOrThrow({
        where: { id: favorite.id },
      });
      expect([stored.useCount, stored.lastUsedAt]).toEqual([0, null]);
      await expect(prisma.entry.count()).resolves.toBe(0);
    });

    it('returns 404 for unknown and foreign favorites', async () => {
      const stranger = await createStranger();
      const foreign = await createStrangerFavorite(stranger);

      await agent
        .post(`/api/favorites/${randomUUID()}/log`)
        .send(LOG_BODY)
        .expect(404);
      await agent
        .post(`/api/favorites/${foreign.id}/log`)
        .send(LOG_BODY)
        .expect(404);

      const stored = await prisma.favorite.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      expect(stored.useCount).toBe(0);
      await expect(prisma.entry.count()).resolves.toBe(0);
    });
  });
});
