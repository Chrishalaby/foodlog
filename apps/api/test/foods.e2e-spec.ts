import { randomUUID } from 'node:crypto';
import {
  API_LIMITS,
  type CreateEntryRequest,
  type CreateFavoriteRequest,
  type EntryDto,
  type EntryItemInput,
  type EntryRawAiResponse,
  type FavoriteDto,
  type FoodRenameRequest,
  type FoodRenameResponse,
  type FoodSearchResponse,
  type FoodSearchResult,
  type HiddenFoodsResponse,
  type MealType,
  MAX_ITEM_GRAMS,
  type Nutrients,
  type PhotoRef,
  type ProductDto,
  type QuickLogRequest,
  type UpdateEntryRequest,
  type UpsertProductRequest,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import type { Photo } from '../src/generated/prisma/client.js';
import { FOOD_RENAME_THROTTLE } from '../src/foods/foods.controller.js';
import { PhotosService } from '../src/photos/photos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  OFF_FETCH,
  type OffFetch,
} from '../src/products/open-food-facts.client.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

interface Stranger {
  id: string;
  agent: TestAgent;
}

type StoredNames = [string, string[]];

interface EntrySeed {
  name: string;
  items?: EntryItemInput[];
  daysAgo?: number;
  mealType?: MealType;
  photoId?: string | null;
  analysisId?: string | null;
  description?: string | null;
}

const DAY_MS = 86_400_000;
const LABAN_BARCODE = '5281000000015';
const LABNEH_BARCODE = '5281000000022';
const RAW_AI_RESPONSE = {
  id: 'resp_mock',
  model: 'mock',
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
};

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function moment(daysAgo = 0): { timestamp: string; localDate: string } {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  return {
    timestamp: date.toISOString(),
    localDate: date.toISOString().slice(0, 10),
  };
}

function item(
  name: string,
  grams: number,
  values: Partial<Nutrients> = {},
  confidence: EntryItemInput['confidence'] = 'high',
): EntryItemInput {
  return {
    name,
    grams,
    nutrients: nutrients(values),
    confidence,
    count: null,
    unit: null,
    unitPlural: null,
    micros: null,
    fluidMl: null,
  };
}

function laban(
  overrides: Partial<UpsertProductRequest> = {},
): UpsertProductRequest {
  return {
    name: 'Laban',
    brand: 'Almarai',
    basisUnit: 'ml',
    per100: nutrients({ calories: 42, protein: 3.2, fat: 1.2, sodium: 50 }),
    microsPer100: { calcium: 120, vitaminB12: 0.2 },
    servingSizeG: 250,
    packSizeG: 1000,
    source: 'label',
    ...overrides,
  };
}

function yogurt(grams = 170): EntryItemInput {
  return {
    ...item('Khoury strawberry yogurt', grams, {
      calories: 150,
      protein: 6.8,
      sugar: 20.4,
    }),
    micros: { calcium: Math.round(grams * 1.2) },
  };
}

function granola(): EntryItemInput {
  return item('Granola', 40, { calories: 180, carbs: 26 }, 'medium');
}

function blueberries(): EntryItemInput {
  return item('Blueberries', 50, { calories: 29, fiber: 1.2 }, 'low');
}

function photoRef(photo: Photo): PhotoRef {
  return {
    id: photo.id,
    url: `/api/photos/${photo.id}`,
    thumbUrl: `/api/photos/${photo.id}/thumb`,
    width: photo.width,
    height: photo.height,
  };
}

function testImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 200, g: 60, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

describe('food library (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let photos: PhotosService;
  let agent: TestAgent;
  let userId: string;
  const offFetch = vi.fn<OffFetch>(() =>
    Promise.reject(new Error('Open Food Facts must not be called')),
  );

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) =>
        builder.overrideProvider(OFF_FETCH).useValue(offFetch),
    });
    prisma = app.get(PrismaService);
    photos = app.get(PhotosService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  beforeEach(async () => {
    await prisma.entry.deleteMany();
    await prisma.favorite.deleteMany();
    await prisma.product.deleteMany();
    await prisma.analysis.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: userId } } });
    await prisma.profile.deleteMany();
  });

  afterAll(async () => {
    expect(offFetch).not.toHaveBeenCalled();
    await resetDatabase(prisma);
    await app.close();
  });

  function entryBody(seed: EntrySeed): CreateEntryRequest {
    return {
      name: seed.name,
      description: seed.description ?? null,
      mealType: seed.mealType ?? 'lunch',
      source: 'text',
      ...moment(seed.daysAgo ?? 1),
      items: seed.items ?? [item(seed.name, 100, { calories: 100 })],
      photoId: seed.photoId ?? null,
      analysisId: seed.analysisId ?? null,
    };
  }

  async function createEntry(seed: EntrySeed): Promise<EntryDto> {
    const response = await agent
      .post('/api/entries')
      .send(entryBody(seed))
      .expect(201);
    return response.body as EntryDto;
  }

  async function createEntries(
    name: string,
    daysAgo: readonly number[],
  ): Promise<EntryDto[]> {
    const entries: EntryDto[] = [];
    for (const days of daysAgo) {
      entries.push(await createEntry({ name, daysAgo: days }));
    }
    return entries;
  }

  async function createFavorite(
    body: CreateFavoriteRequest,
  ): Promise<FavoriteDto> {
    const response = await agent.post('/api/favorites').send(body).expect(201);
    return response.body as FavoriteDto;
  }

  async function createPhoto(ownerId = userId): Promise<Photo> {
    return photos.createFromUpload(ownerId, await testImage(), {
      maxDimension: 1024,
    });
  }

  async function createStranger(): Promise<Stranger> {
    const { user, agent: strangerAgent } = await createSignedInUser(app);
    return { id: user.id, agent: strangerAgent };
  }

  async function saveProduct(
    barcode: string,
    body: UpsertProductRequest,
    owner: TestAgent = agent,
  ): Promise<ProductDto> {
    const response = await owner
      .put(`/api/products/barcode/${barcode}`)
      .send(body)
      .expect(200);
    return response.body as ProductDto;
  }

  async function search(
    query: Record<string, string | number> = {},
  ): Promise<FoodSearchResult[]> {
    const response = await agent.get('/api/foods').query(query).expect(200);
    return (response.body as FoodSearchResponse).results;
  }

  async function searchNames(q: string): Promise<string[]> {
    return (await search({ q })).map((result) => result.name);
  }

  async function searchNamed(name: string): Promise<FoodSearchResult[]> {
    const sameName = (value: string): boolean =>
      value.toLowerCase().replace(/\s+/g, ' ') === name;
    return (await search({ q: name })).filter((result) =>
      sameName(result.name),
    );
  }

  async function renameEntry(entry: EntryDto, name: string): Promise<EntryDto> {
    const body: UpdateEntryRequest = {
      name,
      description: entry.description,
      mealType: entry.mealType,
      timestamp: entry.timestamp,
      localDate: entry.localDate,
      items: entry.items.map((stored) => ({
        name: stored.name,
        grams: stored.grams,
        nutrients: stored.nutrients,
        confidence: stored.confidence,
        micros: stored.micros,
        fluidMl: stored.fluidMl,
      })),
    };
    const response = await agent
      .put(`/api/entries/${entry.id}`)
      .send(body)
      .expect(200);
    return response.body as EntryDto;
  }

  async function renameFoods(
    body: FoodRenameRequest,
    owner: TestAgent = agent,
  ): Promise<FoodRenameResponse> {
    const response = await owner
      .post('/api/foods/rename')
      .send(body)
      .expect(200);
    return response.body as FoodRenameResponse;
  }

  async function storedNames(
    entries: readonly EntryDto[],
  ): Promise<StoredNames[]> {
    const rows = await prisma.entry.findMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
      select: {
        id: true,
        name: true,
        items: { select: { name: true }, orderBy: { position: 'asc' } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return entries.map((entry): StoredNames => {
      const row = byId.get(entry.id);
      return [row?.name ?? '', row?.items.map((stored) => stored.name) ?? []];
    });
  }

  async function hiddenNames(owner: TestAgent = agent): Promise<string[]> {
    const response = await owner.get('/api/foods/hidden').expect(200);
    return (response.body as HiddenFoodsResponse).names;
  }

  async function hide(
    name: string,
    owner: TestAgent = agent,
  ): Promise<string[]> {
    const response = await owner
      .post('/api/foods/hidden')
      .send({ name })
      .expect(200);
    return (response.body as HiddenFoodsResponse).names;
  }

  async function unhide(
    name: string,
    owner: TestAgent = agent,
  ): Promise<string[]> {
    const response = await owner
      .delete('/api/foods/hidden')
      .query({ name })
      .expect(200);
    return (response.body as HiddenFoodsResponse).names;
  }

  function summary(results: readonly FoodSearchResult[]): unknown[][] {
    return results.map((result) => [result.kind, result.name, result.detail]);
  }

  function quickLogBody(
    overrides: Partial<QuickLogRequest> & Pick<QuickLogRequest, 'key'>,
  ): QuickLogRequest {
    return { mealType: 'snack', ...moment(0), ...overrides };
  }

  async function quickLog(
    overrides: Partial<QuickLogRequest> & Pick<QuickLogRequest, 'key'>,
  ): Promise<EntryDto> {
    const response = await agent
      .post('/api/foods/log')
      .send(quickLogBody(overrides))
      .expect(201);
    return response.body as EntryDto;
  }

  describe('GET /api/foods', () => {
    it('ranks exact over prefix over word prefix over substring matches', async () => {
      await createEntries('Soyogurt', [0.1, 0.2, 0.3, 0.4, 0.5]);
      await createEntries('Greek yogurt', [0.6, 0.7, 0.8]);
      await createEntries('Yogurt parfait', [30]);
      await createEntries('Yogurt', [60]);
      await createEntries('Granola', [0.1]);

      const results = await search({ q: 'yogurt' });

      expect(results.map((r) => [r.kind, r.name])).toEqual([
        ['meal', 'Yogurt'],
        ['meal', 'Yogurt parfait'],
        ['meal', 'Greek yogurt'],
        ['meal', 'Soyogurt'],
      ]);
      expect(results.map((r) => r.useCount)).toEqual([1, 1, 3, 5]);
    });

    it('orders equally good matches by frequency, then recency', async () => {
      await createEntries('Oat milk', [10, 11, 12, 13]);
      await createEntries('Oat bar', [1]);
      await createEntries('Tea green', [20]);
      await createEntries('Tea black', [2]);

      await expect(searchNames('oat')).resolves.toEqual([
        'Oat milk',
        'Oat bar',
      ]);
      await expect(searchNames('tea')).resolves.toEqual([
        'Tea black',
        'Tea green',
      ]);
    });

    it('ignores case, spacing and diacritics and merges their spellings', async () => {
      await createEntry({ name: 'cafe latte', daysAgo: 5 });
      const latest = await createEntry({ name: 'Café Latte', daysAgo: 1 });
      await createEntry({ name: 'Crème brûlée', daysAgo: 2 });

      await expect(searchNames('cafe')).resolves.toEqual(['Café Latte']);
      await expect(searchNames('CAFÉ   lat')).resolves.toEqual(['Café Latte']);
      await expect(searchNames('latte caf')).resolves.toEqual(['Café Latte']);
      await expect(searchNames('creme brulee')).resolves.toEqual([
        'Crème brûlée',
      ]);
      const [merged] = await search({ q: 'cafe latte' });
      expect(merged).toMatchObject({
        key: `meal:${latest.id}`,
        useCount: 2,
        lastUsedAt: latest.timestamp,
      });
    });

    it('requires every search word to match', async () => {
      await createEntry({ name: 'Khoury strawberry yogurt' });

      await expect(searchNames('straw yog')).resolves.toEqual([
        'Khoury strawberry yogurt',
      ]);
      await expect(searchNames('straw banana')).resolves.toEqual([]);
    });

    it('finds a food inside a multi-item meal with its latest amounts', async () => {
      const photo = await createPhoto();
      await createEntry({
        name: 'Breakfast bowl',
        mealType: 'breakfast',
        items: [yogurt(150), granola()],
        daysAgo: 10,
      });
      const latest = await createEntry({
        name: 'Breakfast bowl',
        mealType: 'breakfast',
        items: [granola(), yogurt(170), blueberries()],
        photoId: photo.id,
        daysAgo: 2,
      });
      const latestYogurt = latest.items[1];

      const results = await search({ q: 'khoury' });

      expect(results).toEqual<FoodSearchResult[]>([
        {
          key: `food:${latestYogurt?.id}`,
          kind: 'food',
          name: 'Khoury strawberry yogurt',
          detail: 'Breakfast bowl',
          items: [{ ...yogurt(170), productId: null }],
          totals: nutrients({ calories: 150, protein: 6.8, sugar: 20.4 }),
          grams: 170,
          portion: null,
          mealType: 'breakfast',
          photo: photoRef(photo),
          favoriteId: null,
          entryId: latest.id,
          useCount: 2,
          lastUsedAt: latest.timestamp,
          productId: null,
          starred: false,
        },
      ]);
    });

    it('lists the meal before foods that only match through the meal name', async () => {
      await createEntry({
        name: 'Breakfast bowl',
        items: [yogurt(), granola(), blueberries()],
        daysAgo: 1,
      });

      const results = await search({ q: 'breakfast' });

      expect(results[0]).toMatchObject({
        kind: 'meal',
        name: 'Breakfast bowl',
        grams: 260,
        totals: nutrients({
          calories: 359,
          protein: 6.8,
          carbs: 26,
          fiber: 1.2,
          sugar: 20.4,
        }),
      });
      expect(results.slice(1).map((r) => [r.kind, r.name, r.detail])).toEqual([
        ['food', 'Blueberries', 'Breakfast bowl'],
        ['food', 'Granola', 'Breakfast bowl'],
        ['food', 'Khoury strawberry yogurt', 'Breakfast bowl'],
      ]);
    });

    it('deduplicates names with favorite > meal > food precedence', async () => {
      await createEntry({
        name: 'Smoothie',
        items: [
          item('Protein shake', 300, { calories: 210, protein: 30 }),
          item('Banana', 100, { calories: 89 }),
        ],
        daysAgo: 1,
      });
      const meal = await createEntry({
        name: 'Protein Shake',
        items: [
          item('Whey', 30, { calories: 120, protein: 24 }),
          item('Milk', 250, { calories: 160, protein: 8.3 }),
        ],
        daysAgo: 3,
      });
      const favorite = await createFavorite({
        name: 'PROTEIN  shake',
        items: [item('Whey', 30, { calories: 120, protein: 24 })],
      });

      const [asFavorite, ...others] = await searchNamed('protein shake');
      expect(others).toEqual([]);
      expect(asFavorite).toMatchObject({
        key: `favorite:${favorite.id}`,
        kind: 'favorite',
        name: 'PROTEIN  shake',
        favoriteId: favorite.id,
        entryId: null,
        starred: true,
        useCount: 0,
        lastUsedAt: null,
        grams: 30,
      });

      await agent.delete(`/api/favorites/${favorite.id}`).expect(204);
      const [asMeal, ...afterFavorite] = await searchNamed('protein shake');
      expect(afterFavorite).toEqual([]);
      expect(asMeal).toMatchObject({
        key: `meal:${meal.id}`,
        kind: 'meal',
        name: 'Protein Shake',
        entryId: meal.id,
        starred: false,
        useCount: 1,
      });

      await agent.delete(`/api/entries/${meal.id}`).expect(204);
      const [asFood, ...afterMeal] = await searchNamed('protein shake');
      expect(afterMeal).toEqual([]);
      expect(asFood).toMatchObject({
        kind: 'food',
        name: 'Protein shake',
        detail: 'Smoothie',
        grams: 300,
      });
    });

    it('lists starred favorites first, then frequent and recent foods of the last 90 days', async () => {
      const almonds = await createFavorite({
        name: 'Almonds',
        mealType: 'snack',
        items: [item('Almonds', 30, { calories: 174 })],
      });
      await createFavorite({
        name: 'Dates',
        items: [item('Dates', 48, { calories: 133 })],
      });
      for (let i = 0; i < 2; i += 1) {
        await agent
          .post(`/api/favorites/${almonds.id}/log`)
          .send({ mealType: 'snack', ...moment(0) })
          .expect(201);
      }
      await createEntries('Lentil soup', [1, 3, 5]);
      await createEntries('Toast', [0]);
      await createEntries('Ancient stew', [120, 130]);
      await createEntry({
        name: 'Salmon plate',
        items: [
          item('Salmon', 150, { calories: 300 }),
          item('Asparagus', 90, { calories: 18 }),
        ],
        daysAgo: 3,
      });

      const results = await search();

      expect(results.map((r) => [r.kind, r.name, r.starred])).toEqual([
        ['favorite', 'Almonds', true],
        ['favorite', 'Dates', true],
        ['meal', 'Lentil soup', false],
        ['meal', 'Toast', false],
        ['meal', 'Salmon plate', false],
        ['food', 'Asparagus', false],
        ['food', 'Salmon', false],
      ]);
      expect(results[0]?.useCount).toBe(2);
    });

    it('limits the number of results', async () => {
      await createEntries('Tea one', [1]);
      await createEntries('Tea two', [2]);
      await createEntries('Tea three', [3]);
      await createEntries('Tea four', [4]);

      await expect(search({ q: 'tea', limit: 2 })).resolves.toHaveLength(2);
      await expect(search({ limit: 3 })).resolves.toHaveLength(3);
      await expect(search({ q: 'tea' })).resolves.toHaveLength(4);
    });

    it('returns 20 results by default and up to the maximum on request', async () => {
      for (let i = 0; i < API_LIMITS.foodSearchMax + 5; i += 1) {
        await createEntry({ name: `Snack ${i}`, daysAgo: 1 });
      }

      await expect(search({ q: 'snack' })).resolves.toHaveLength(20);
      await expect(search()).resolves.toHaveLength(20);
      await expect(
        search({ q: 'snack', limit: API_LIMITS.foodSearchMax }),
      ).resolves.toHaveLength(API_LIMITS.foodSearchMax);
    });

    it('echoes the trimmed query', async () => {
      const response = await agent
        .get('/api/foods')
        .query({ q: '  tea ' })
        .expect(200);
      expect(response.body).toEqual({ query: 'tea', results: [] });
      const empty = await agent.get('/api/foods').expect(200);
      expect(empty.body).toEqual({ query: '', results: [] });
    });

    it.each<[string, Record<string, string>]>([
      [
        'a query that is too long',
        { q: 'x'.repeat(API_LIMITS.foodQueryMax + 1) },
      ],
      ['a limit of zero', { limit: '0' }],
      [
        'a limit above the maximum',
        { limit: String(API_LIMITS.foodSearchMax + 1) },
      ],
      ['a non-numeric limit', { limit: 'lots' }],
      ['a fractional limit', { limit: '1.5' }],
      ['an unknown parameter', { sort: 'name' }],
      ['a null character', { q: 'te\u0000a' }],
    ])('rejects %s with 400', async (_label, query) => {
      await agent.get('/api/foods').query(query).expect(400);
    });

    it('accepts a query at the maximum length', async () => {
      await agent
        .get('/api/foods')
        .query({ q: 'x'.repeat(API_LIMITS.foodQueryMax) })
        .expect(200);
    });

    it("never returns another user's foods", async () => {
      const stranger = await createStranger();
      await stranger.agent
        .post('/api/entries')
        .send(entryBody({ name: 'Stranger yogurt', items: [yogurt()] }))
        .expect(201);
      await stranger.agent
        .post('/api/favorites')
        .send({ name: 'Stranger favorite yogurt', items: [yogurt()] })
        .expect(201);
      await saveProduct(
        LABAN_BARCODE,
        laban({ name: 'Stranger drinking yogurt' }),
        stranger.agent,
      );
      await createEntry({ name: 'My yogurt' });

      await expect(searchNames('yogurt')).resolves.toEqual(['My yogurt']);
      await expect(search()).resolves.toHaveLength(1);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/foods').expect(401);
      await request(app.getHttpServer())
        .post('/api/foods/log')
        .send(quickLogBody({ key: `meal:${randomUUID()}` }))
        .expect(401);
    });
  });

  describe('POST /api/foods/log', () => {
    it('logs a meal again with scaled servings, its photo and raw AI JSON', async () => {
      const photo = await createPhoto();
      const analysis = await prisma.analysis.create({
        data: {
          userId,
          mode: 'food_photo',
          model: 'mock',
          result: {},
          rawResponse: RAW_AI_RESPONSE,
          photoId: photo.id,
        },
      });
      const source = await createEntry({
        name: 'Breakfast bowl',
        description: 'Weekday bowl',
        mealType: 'breakfast',
        items: [yogurt(), granola()],
        analysisId: analysis.id,
        daysAgo: 3,
      });
      const when = moment(0);

      const logged = await quickLog({
        key: `meal:${source.id}`,
        servings: 1.5,
        mealType: 'dinner',
        ...when,
      });

      expect(logged).toEqual<EntryDto>({
        id: expect.any(String),
        name: 'Breakfast bowl',
        description: 'Weekday bowl',
        mealType: 'dinner',
        source: 'copy',
        timestamp: when.timestamp,
        localDate: when.localDate,
        items: [
          {
            id: expect.any(String),
            position: 0,
            name: 'Khoury strawberry yogurt',
            grams: 255,
            nutrients: nutrients({ calories: 225, protein: 10.2, sugar: 30.6 }),
            confidence: 'high',
            count: null,
            unit: null,
            unitPlural: null,
            productId: null,
            micros: { calcium: 306 },
            fluidMl: null,
          },
          {
            id: expect.any(String),
            position: 1,
            name: 'Granola',
            grams: 60,
            nutrients: nutrients({ calories: 270, carbs: 39 }),
            confidence: 'medium',
            count: null,
            unit: null,
            unitPlural: null,
            productId: null,
            micros: null,
            fluidMl: null,
          },
        ],
        totals: nutrients({
          calories: 495,
          protein: 10.2,
          carbs: 39,
          sugar: 30.6,
        }),
        portion: null,
        photo: photoRef(photo),
        photos: [{ photo: photoRef(photo), role: 'food' }],
        analysisId: null,
        favoriteId: null,
        productId: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const raw = await agent
        .get(`/api/entries/${logged.id}/raw-ai`)
        .expect(200);
      expect((raw.body as EntryRawAiResponse).rawAiJson).toEqual(
        RAW_AI_RESPONSE,
      );

      const [result] = await search({ q: 'breakfast bowl' });
      expect(result).toMatchObject({
        key: `meal:${logged.id}`,
        useCount: 2,
        grams: 315,
        mealType: 'dinner',
      });
    });

    it('logs a food from inside a meal as a single-item entry with its photo', async () => {
      const photo = await createPhoto();
      const bowl = await createEntry({
        name: 'Breakfast bowl',
        items: [granola(), yogurt(170)],
        photoId: photo.id,
      });
      const itemId = bowl.items[1]?.id;

      const byGrams = await quickLog({ key: `food:${itemId}`, grams: 250 });

      expect(byGrams).toMatchObject({
        name: 'Khoury strawberry yogurt',
        description: null,
        source: 'copy',
        mealType: 'snack',
        photo: photoRef(photo),
        analysisId: null,
        favoriteId: null,
        items: [
          {
            position: 0,
            name: 'Khoury strawberry yogurt',
            grams: 250,
            nutrients: nutrients({ calories: 221, protein: 10, sugar: 30 }),
            confidence: 'high',
          },
        ],
        totals: nutrients({ calories: 221, protein: 10, sugar: 30 }),
      });
      const raw = await agent
        .get(`/api/entries/${byGrams.id}/raw-ai`)
        .expect(200);
      expect((raw.body as EntryRawAiResponse).rawAiJson).toBeNull();

      const byServings = await quickLog({ key: `food:${itemId}`, servings: 2 });
      expect(byServings.items).toMatchObject([
        {
          grams: 340,
          nutrients: nutrients({ calories: 300, protein: 13.6, sugar: 40.8 }),
        },
      ]);
    });

    it('copies every photo of a meal and only the cover for a food inside it', async () => {
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
              { photoId: food.id, role: 'food', position: 0 },
              { photoId: label.id, role: 'label', position: 1 },
            ],
          },
        },
      });
      const bowl = await createEntry({
        name: 'Yogurt bowl',
        items: [yogurt(), granola()],
        analysisId: analysis.id,
      });
      const both = [
        { photo: photoRef(food), role: 'food' },
        { photo: photoRef(label), role: 'label' },
      ];
      expect(bowl.photos).toEqual(both);

      const meal = await quickLog({ key: `meal:${bowl.id}` });
      const single = await quickLog({ key: `food:${bowl.items[0]?.id}` });

      expect(meal.photo).toEqual(photoRef(food));
      expect(meal.photos).toEqual(both);
      expect(single.photo).toEqual(photoRef(food));
      expect(single.photos).toEqual([{ photo: photoRef(food), role: 'food' }]);

      await agent.delete(`/api/entries/${bowl.id}`).expect(204);
      await prisma.analysis.delete({ where: { id: analysis.id } });
      await agent.get(`/api/photos/${label.id}`).expect(200);
      const kept = (await agent.get(`/api/entries/${meal.id}`).expect(200))
        .body as EntryDto;
      expect(kept.photos).toEqual(both);
    });

    it('offers a quick-logged food once, as a single-item meal that accepts grams', async () => {
      const bowl = await createEntry({
        name: 'Breakfast bowl',
        items: [granola(), yogurt(170)],
        daysAgo: 2,
      });
      const logged = await quickLog({
        key: `food:${bowl.items[1]?.id}`,
        servings: 2,
      });

      const results = await search({ q: 'khoury' });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        key: `meal:${logged.id}`,
        kind: 'meal',
        name: 'Khoury strawberry yogurt',
        grams: 340,
        useCount: 1,
      });

      const half = await quickLog({ key: `meal:${logged.id}`, grams: 85 });
      expect(half.items).toMatchObject([
        {
          grams: 85,
          nutrients: nutrients({ calories: 75, protein: 3.4, sugar: 10.2 }),
        },
      ]);
    });

    it('logs a favorite like the favorites endpoint and counts the use', async () => {
      const favorite = await createFavorite({
        name: 'Overnight oats',
        mealType: 'breakfast',
        items: [
          item('Oats', 60, { calories: 226, protein: 8 }),
          item('Milk', 150, { calories: 96, protein: 5.2 }, null),
        ],
      });

      const logged = await quickLog({
        key: `favorite:${favorite.id}`,
        servings: 1.5,
        mealType: 'breakfast',
      });

      expect(logged).toMatchObject({
        name: 'Overnight oats ×1.5',
        source: 'favorite',
        favoriteId: favorite.id,
        mealType: 'breakfast',
        items: [
          {
            name: 'Oats',
            grams: 90,
            nutrients: nutrients({ calories: 339, protein: 12 }),
          },
          {
            name: 'Milk',
            grams: 225,
            nutrients: nutrients({ calories: 144, protein: 7.8 }),
          },
        ],
        totals: nutrients({ calories: 483, protein: 19.8 }),
      });
      const [stored] = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(stored).toMatchObject({ id: favorite.id, useCount: 1 });
      expect(stored?.lastUsedAt).not.toBeNull();

      const results = await search({ q: 'overnight' });
      expect(results.map((r) => [r.kind, r.name])).toEqual([
        ['favorite', 'Overnight oats'],
        ['food', 'Milk'],
        ['food', 'Oats'],
      ]);
      expect(results[0]).toMatchObject({
        key: `favorite:${favorite.id}`,
        useCount: 1,
        lastUsedAt: stored?.lastUsedAt,
      });
    });

    it('converts grams to servings for a single-item favorite', async () => {
      const favorite = await createFavorite({
        name: 'Skyr',
        items: [item('Skyr', 150, { calories: 95, protein: 16.5 })],
      });

      const logged = await quickLog({
        key: `favorite:${favorite.id}`,
        grams: 225,
      });

      expect(logged).toMatchObject({
        name: 'Skyr ×1.5',
        source: 'favorite',
        items: [
          {
            grams: 225,
            nutrients: nutrients({ calories: 143, protein: 24.8 }),
          },
        ],
      });
      const [stored] = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(stored?.useCount).toBe(1);
    });

    it('rejects grams for results with several items and oversized amounts', async () => {
      const meal = await createEntry({
        name: 'Breakfast bowl',
        items: [yogurt(), granola()],
      });
      const heavy = await createEntry({
        name: 'Water jug',
        items: [item('Water', 6000)],
      });
      const favorite = await createFavorite({
        name: 'Snack plate',
        items: [yogurt(), granola()],
      });
      const before = await prisma.entry.count();

      await agent
        .post('/api/foods/log')
        .send(quickLogBody({ key: `meal:${meal.id}`, grams: 100 }))
        .expect(400);
      await agent
        .post('/api/foods/log')
        .send(quickLogBody({ key: `favorite:${favorite.id}`, grams: 100 }))
        .expect(400);
      await agent
        .post('/api/foods/log')
        .send(quickLogBody({ key: `meal:${heavy.id}`, servings: 2 }))
        .expect(400);
      await agent
        .post('/api/foods/log')
        .send(
          quickLogBody({ key: `food:${heavy.items[0]?.id}`, servings: 1.7 }),
        )
        .expect(400);

      await expect(prisma.entry.count()).resolves.toBe(before);
      const [stored] = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(stored?.useCount).toBe(0);
    });

    it.each<[string, Record<string, unknown>]>([
      ['a missing key', { key: undefined }],
      ['a malformed key', { key: 'meal:nope' }],
      ['an unknown kind', { key: `drink:${randomUUID()}` }],
      ['zero servings', { servings: 0 }],
      ['too many servings', { servings: API_LIMITS.favoriteServingsMax + 1 }],
      ['zero grams', { grams: 0 }],
      ['too many grams', { grams: MAX_ITEM_GRAMS + 1 }],
      ['text servings', { servings: 'two' }],
      ['a missing timestamp', { timestamp: undefined }],
      ['a timestamp without offset', { timestamp: '2026-09-28T08:00:00' }],
      ['an invalid local date', { localDate: '2026-13-01' }],
      ['an unknown meal type', { mealType: 'brunch' }],
      ['an extra property', { name: 'Yogurt' }],
    ])('rejects %s with 400', async (_label, invalid) => {
      const meal = await createEntry({ name: 'Toast' });
      const before = await prisma.entry.count();

      await agent
        .post('/api/foods/log')
        .send({ ...quickLogBody({ key: `meal:${meal.id}` }), ...invalid })
        .expect(400);

      await expect(prisma.entry.count()).resolves.toBe(before);
    });

    it("returns 404 for unknown keys and another user's foods", async () => {
      const stranger = await createStranger();
      const foreignEntry = (
        await stranger.agent
          .post('/api/entries')
          .send(
            entryBody({ name: 'Stranger bowl', items: [yogurt(), granola()] }),
          )
          .expect(201)
      ).body as EntryDto;
      const foreignFavorite = (
        await stranger.agent
          .post('/api/favorites')
          .send({ name: 'Stranger oats', items: [granola()] })
          .expect(201)
      ).body as FavoriteDto;
      const foreignProduct = await saveProduct(
        LABAN_BARCODE,
        laban(),
        stranger.agent,
      );
      const before = await prisma.entry.count();

      for (const key of [
        `meal:${foreignEntry.id}`,
        `food:${foreignEntry.items[0]?.id}`,
        `favorite:${foreignFavorite.id}`,
        `product:${foreignProduct.id}`,
        `meal:${randomUUID()}`,
        `food:${randomUUID()}`,
        `favorite:${randomUUID()}`,
        `product:${randomUUID()}`,
      ]) {
        await agent
          .post('/api/foods/log')
          .send(quickLogBody({ key }))
          .expect(404);
      }
      await agent
        .post('/api/foods/log')
        .send(
          quickLogBody({ key: `favorite:${foreignFavorite.id}`, grams: 50 }),
        )
        .expect(404);

      await expect(prisma.entry.count()).resolves.toBe(before);
      await expect(
        prisma.favorite.findUniqueOrThrow({
          where: { id: foreignFavorite.id },
        }),
      ).resolves.toMatchObject({ useCount: 0, lastUsedAt: null });
      await expect(
        prisma.product.findUniqueOrThrow({
          where: { id: foreignProduct.id },
        }),
      ).resolves.toMatchObject({ useCount: 0, lastUsedAt: null });
    });
  });

  describe('single-item meals', () => {
    it('lists a logged meal once after only the meal was renamed', async () => {
      const logged = await createEntry({
        name: 'Khoury strawberry yogurt',
        items: [yogurt()],
        daysAgo: 1,
      });
      await renameEntry(logged, 'Strawberry yogurt cup');

      const recent = await search();

      expect(summary(recent)).toEqual([
        ['meal', 'Strawberry yogurt cup', 'Khoury strawberry yogurt'],
      ]);
      expect(recent[0]).toMatchObject({
        key: `meal:${logged.id}`,
        grams: 170,
        useCount: 1,
        items: [yogurt()],
      });
      for (const q of ['khoury', 'strawberry yogurt', 'yogurt cup']) {
        const results = await search({ q });
        expect(results.map((r) => r.key)).toEqual([`meal:${logged.id}`]);
      }
    });

    it('ranks meals found through their item below meals matching by name', async () => {
      await createEntries('Khoury labneh', [20]);
      for (const days of [1, 2, 3, 4]) {
        await createEntry({
          name: 'Strawberry yogurt cup',
          items: [yogurt()],
          daysAgo: days,
        });
      }

      const results = await search({ q: 'khoury' });

      expect(summary(results)).toEqual([
        ['meal', 'Khoury labneh', null],
        ['meal', 'Strawberry yogurt cup', 'Khoury strawberry yogurt'],
      ]);
    });

    it('offers foods only from meals with several items', async () => {
      await createEntry({
        name: 'Breakfast bowl',
        items: [yogurt(), granola()],
        daysAgo: 2,
      });
      await createEntry({
        name: 'Morning snack',
        items: [item('Banana', 120, { calories: 107 })],
        daysAgo: 1,
      });
      await createEntry({ name: 'Toast', daysAgo: 3 });

      expect(summary(await search())).toEqual([
        ['meal', 'Morning snack', 'Banana'],
        ['meal', 'Breakfast bowl', null],
        ['food', 'Granola', 'Breakfast bowl'],
        ['food', 'Khoury strawberry yogurt', 'Breakfast bowl'],
        ['meal', 'Toast', null],
      ]);
      expect(summary(await search({ q: 'banana' }))).toEqual([
        ['meal', 'Morning snack', 'Banana'],
      ]);
    });
  });

  describe('POST /api/foods/rename', () => {
    async function seedYogurts(): Promise<EntryDto[]> {
      return [
        await createEntry({
          name: 'Khoury strawberry yogurt',
          items: [yogurt()],
          daysAgo: 4,
        }),
        await createEntry({
          name: 'KHOURY  strawberry yogurt',
          items: [item('khoury strawberry YOGURT', 170, { calories: 150 })],
          daysAgo: 3,
        }),
        await createEntry({
          name: 'Khoury strawberry yogurt',
          items: [item('Yogurt 170 g', 170, { calories: 150 })],
          daysAgo: 2,
        }),
        await createEntry({
          name: 'khoury strawberry yogurt',
          items: [yogurt(), granola()],
          daysAgo: 1,
        }),
        await createEntry({ name: 'Granola', items: [granola()], daysAgo: 1 }),
      ];
    }

    it('only counts on a dry run', async () => {
      const entries = await seedYogurts();
      const before = await storedNames(entries);

      await expect(
        renameFoods({
          from: 'khoury strawberry yogurt',
          to: 'Strawberry yogurt cup',
          dryRun: true,
        }),
      ).resolves.toEqual({
        matchedEntries: 4,
        renamedEntries: 4,
        renamedItems: 2,
      });

      await expect(storedNames(entries)).resolves.toEqual(before);
    });

    it('renames every own entry with the name and the matching items of single-item entries', async () => {
      const entries = await seedYogurts();

      const result = await renameFoods({
        from: '  Khoury Strawberry Yogurt ',
        to: ' Strawberry yogurt cup ',
        dryRun: false,
      });

      expect(result).toEqual<FoodRenameResponse>({
        matchedEntries: 4,
        renamedEntries: 4,
        renamedItems: 2,
      });
      await expect(storedNames(entries)).resolves.toEqual([
        ['Strawberry yogurt cup', ['Strawberry yogurt cup']],
        ['Strawberry yogurt cup', ['Strawberry yogurt cup']],
        ['Strawberry yogurt cup', ['Yogurt 170 g']],
        ['Strawberry yogurt cup', ['Khoury strawberry yogurt', 'Granola']],
        ['Granola', ['Granola']],
      ]);
      const renamed = await search({ q: 'strawberry yogurt cup' });
      expect(summary(renamed)).toEqual([
        ['meal', 'Strawberry yogurt cup', null],
        ['food', 'Khoury strawberry yogurt', 'Strawberry yogurt cup'],
      ]);
      expect(renamed[0]).toMatchObject({
        key: `meal:${entries[3]?.id}`,
        useCount: 4,
      });
      await expect(
        renameFoods({ from: 'Khoury strawberry yogurt', to: 'Yogurt' }),
      ).resolves.toEqual({
        matchedEntries: 0,
        renamedEntries: 0,
        renamedItems: 0,
      });
    });

    it('changes only the display casing when both names normalize alike', async () => {
      const entries = [
        await createEntry({
          name: 'khoury yogurt',
          items: [item('khoury yogurt', 170, { calories: 150 })],
          daysAgo: 2,
        }),
        await createEntry({ name: 'Khoury Yogurt', daysAgo: 1 }),
        await createEntry({
          name: 'Khoury  YOGURT',
          items: [yogurt(), granola()],
          daysAgo: 3,
        }),
      ];

      const result = await renameFoods({
        from: 'khoury yogurt',
        to: 'Khoury Yogurt',
      });

      expect(result).toEqual<FoodRenameResponse>({
        matchedEntries: 3,
        renamedEntries: 2,
        renamedItems: 1,
      });
      await expect(storedNames(entries)).resolves.toEqual([
        ['Khoury Yogurt', ['Khoury Yogurt']],
        ['Khoury Yogurt', ['Khoury Yogurt']],
        ['Khoury Yogurt', ['Khoury strawberry yogurt', 'Granola']],
      ]);
      const results = await search({ q: 'khoury yogurt' });
      expect(results[0]).toMatchObject({
        kind: 'meal',
        name: 'Khoury Yogurt',
        useCount: 3,
      });
    });

    it('keeps the name of an item that differed from its meal', async () => {
      const cup = await createEntry({
        name: 'Strawberry yogurt cup',
        items: [yogurt()],
      });

      await expect(
        renameFoods({ from: 'Strawberry yogurt cup', to: 'Yogurt cup' }),
      ).resolves.toEqual({
        matchedEntries: 1,
        renamedEntries: 1,
        renamedItems: 0,
      });

      await expect(storedNames([cup])).resolves.toEqual([
        ['Yogurt cup', ['Khoury strawberry yogurt']],
      ]);
      expect(summary(await search())).toEqual([
        ['meal', 'Yogurt cup', 'Khoury strawberry yogurt'],
      ]);
    });

    it('renames a starred single-item meal with its favorite so it stays one food', async () => {
      const original = await createEntry({
        name: 'Crunchy Oat Clusters',
        items: [item('Crunchy Oat Clusters', 40, { calories: 231 })],
        daysAgo: 2,
      });
      const favorite = (
        await agent
          .post(`/api/favorites/from-entry/${original.id}`)
          .send({})
          .expect(201)
      ).body as FavoriteDto;
      const doubled = (
        await agent
          .post(`/api/favorites/${favorite.id}/log`)
          .send({ ...moment(1), mealType: 'snack', servings: 2 })
          .expect(201)
      ).body as EntryDto;
      expect(doubled.name).toBe('Crunchy Oat Clusters ×2');

      await expect(
        renameFoods({
          from: 'Crunchy Oat Clusters',
          to: 'Oat clusters cereal',
        }),
      ).resolves.toEqual({
        matchedEntries: 2,
        renamedEntries: 2,
        renamedItems: 2,
      });

      await expect(storedNames([original, doubled])).resolves.toEqual([
        ['Oat clusters cereal', ['Oat clusters cereal']],
        ['Oat clusters cereal ×2', ['Oat clusters cereal']],
      ]);
      const favorites = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(favorites).toEqual([
        expect.objectContaining({
          id: favorite.id,
          name: 'Oat clusters cereal',
          items: [
            expect.objectContaining({
              name: 'Oat clusters cereal',
              grams: 40,
            }),
          ],
          useCount: 1,
        }),
      ]);
      const expected = [
        expect.objectContaining({
          key: `favorite:${favorite.id}`,
          kind: 'favorite',
          name: 'Oat clusters cereal',
          starred: true,
        }),
      ];
      expect(await search()).toEqual(expected);
      expect(await search({ q: 'oat' })).toEqual(expected);
      expect(await search({ q: 'crunchy' })).toEqual([]);
    });

    it('renames a favorite whose entries are all gone', async () => {
      const favorite = await createFavorite({
        name: 'Protein shake',
        mealType: null,
        items: [item('Protein shake', 300, { calories: 250 })],
      });

      await expect(
        renameFoods({
          from: 'protein shake',
          to: 'Whey shake',
          dryRun: true,
        }),
      ).resolves.toEqual({
        matchedEntries: 0,
        renamedEntries: 0,
        renamedItems: 0,
      });
      const unchanged = await prisma.favorite.findUniqueOrThrow({
        where: { id: favorite.id },
      });
      expect(unchanged.name).toBe('Protein shake');

      await renameFoods({ from: 'protein shake', to: 'Whey shake' });

      const renamed = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(renamed).toEqual([
        expect.objectContaining({
          id: favorite.id,
          name: 'Whey shake',
          items: [expect.objectContaining({ name: 'Whey shake' })],
        }),
      ]);
    });

    it("never renames another user's favorites", async () => {
      const stranger = await createStranger();
      const foreign = (
        await stranger.agent
          .post('/api/favorites')
          .send({ name: 'Granola', mealType: null, items: [granola()] })
          .expect(201)
      ).body as FavoriteDto;
      const own = await createFavorite({
        name: 'Granola',
        mealType: null,
        items: [granola(), blueberries()],
      });

      await renameFoods({ from: 'Granola', to: 'Muesli' });

      const rows = await prisma.favorite.findMany({
        where: { id: { in: [own.id, foreign.id] } },
        select: { id: true, name: true, items: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(own.id)).toMatchObject({
        name: 'Muesli',
        items: [
          expect.objectContaining({ name: 'Granola' }),
          expect.objectContaining({ name: 'Blueberries' }),
        ],
      });
      expect(byId.get(foreign.id)).toMatchObject({
        name: 'Granola',
        items: [expect.objectContaining({ name: 'Granola' })],
      });
    });

    it("never renames another user's entries", async () => {
      const stranger = await createStranger();
      const foreign = (
        await stranger.agent
          .post('/api/entries')
          .send(entryBody({ name: 'Granola', items: [granola()] }))
          .expect(201)
      ).body as EntryDto;
      const own = await createEntry({ name: 'Granola', items: [granola()] });

      await expect(
        renameFoods({ from: 'Granola', to: 'Muesli' }),
      ).resolves.toEqual({
        matchedEntries: 1,
        renamedEntries: 1,
        renamedItems: 1,
      });
      await expect(
        renameFoods({ from: 'Muesli', to: 'Oats' }, stranger.agent),
      ).resolves.toEqual({
        matchedEntries: 0,
        renamedEntries: 0,
        renamedItems: 0,
      });

      await expect(storedNames([own, foreign])).resolves.toEqual([
        ['Muesli', ['Muesli']],
        ['Granola', ['Granola']],
      ]);
    });

    it.each<[string, Record<string, unknown>]>([
      ['a missing from', { from: undefined }],
      ['a missing to', { to: undefined }],
      ['a blank to', { to: '   ' }],
      ['a too long to', { to: 'x'.repeat(API_LIMITS.nameMax + 1) }],
      ['a null character', { to: 'Gra\u0000nola' }],
      ['a numeric name', { from: 7 }],
      ['a text dry run', { dryRun: 'yes' }],
      ['an extra property', { entryId: randomUUID() }],
    ])('rejects %s with 400', async (_label, invalid) => {
      const entry = await createEntry({ name: 'Granola' });

      await agent
        .post('/api/foods/rename')
        .send({ from: 'Granola', to: 'Muesli', ...invalid })
        .expect(400);

      await expect(storedNames([entry])).resolves.toEqual([
        ['Granola', ['Granola']],
      ]);
    });
  });

  describe('hidden suggestions', () => {
    it('starts empty without creating a profile', async () => {
      await expect(hiddenNames()).resolves.toEqual([]);
      await expect(unhide('Toast')).resolves.toEqual([]);

      await expect(prisma.profile.count({ where: { userId } })).resolves.toBe(
        0,
      );
    });

    it('hides a name from suggestions and search but keeps the logs', async () => {
      const single = await createEntry({
        name: 'Khoury strawberry yogurt',
        items: [yogurt()],
        daysAgo: 1,
      });
      await createEntry({
        name: 'Breakfast bowl',
        items: [yogurt(), granola()],
        daysAgo: 2,
      });
      await createEntry({ name: 'Toast', daysAgo: 3 });
      const entryCount = await prisma.entry.count();

      await expect(hide('  Khoury Strawberry  Yogurt ')).resolves.toEqual([
        'khoury strawberry yogurt',
      ]);
      await expect(hide('KHOURY strawberry yogurt')).resolves.toEqual([
        'khoury strawberry yogurt',
      ]);

      expect(summary(await search())).toEqual([
        ['meal', 'Breakfast bowl', null],
        ['food', 'Granola', 'Breakfast bowl'],
        ['meal', 'Toast', null],
      ]);
      await expect(search({ q: 'khoury' })).resolves.toEqual([]);
      await expect(prisma.entry.count()).resolves.toBe(entryCount);
      await expect(
        prisma.profile.findUniqueOrThrow({ where: { userId } }),
      ).resolves.toMatchObject({ hiddenFoods: ['khoury strawberry yogurt'] });

      await expect(unhide('Khoury strawberry yogurt')).resolves.toEqual([]);
      const results = await search({ q: 'khoury' });
      expect(results.map((r) => r.key)).toEqual([`meal:${single.id}`]);
    });

    it('never hides favorites or products', async () => {
      const favorite = await createFavorite({
        name: 'Overnight oats',
        items: [item('Oats', 60, { calories: 226 })],
      });
      const product = await saveProduct(LABAN_BARCODE, laban());
      await quickLog({ key: `product:${product.id}`, servings: 1 });
      await createEntry({ name: 'Overnight oats', daysAgo: 2 });

      await hide('Overnight oats');
      await hide('Almarai Laban');

      expect((await search()).map((r) => r.key)).toEqual([
        `favorite:${favorite.id}`,
        `product:${product.id}`,
      ]);
      await expect(searchNames('oats')).resolves.toEqual(['Overnight oats']);
      await expect(searchNames('laban')).resolves.toEqual(['Almarai Laban']);
    });

    it('keeps the list sorted and unhides a name as shown or as stored', async () => {
      await hide('Toast');
      await hide('Almonds');

      await expect(hide('Oats ×2 ×3')).resolves.toEqual([
        'almonds',
        'oats ×2',
        'toast',
      ]);
      await expect(hiddenNames()).resolves.toEqual([
        'almonds',
        'oats ×2',
        'toast',
      ]);
      await expect(unhide('oats ×2')).resolves.toEqual(['almonds', 'toast']);
      await expect(unhide(' ALMONDS ')).resolves.toEqual(['toast']);
      await expect(unhide('Granola')).resolves.toEqual(['toast']);
    });

    it('limits the list to 500 names', async () => {
      const full = Array.from(
        { length: 500 },
        (_, index) => `food ${String(index).padStart(3, '0')}`,
      );
      await prisma.profile.create({ data: { userId, hiddenFoods: full } });

      await agent
        .post('/api/foods/hidden')
        .send({ name: 'One more' })
        .expect(400);
      await expect(hide('Food 007')).resolves.toEqual(full);
      await expect(hiddenNames()).resolves.toHaveLength(500);
    });

    it('keeps hidden names per user', async () => {
      const stranger = await createStranger();
      await createEntry({ name: 'Toast', daysAgo: 1 });

      await expect(hide('Toast', stranger.agent)).resolves.toEqual(['toast']);

      await expect(hiddenNames()).resolves.toEqual([]);
      await expect(hiddenNames(stranger.agent)).resolves.toEqual(['toast']);
      await expect(searchNames('toast')).resolves.toEqual(['Toast']);
      await expect(unhide('Toast')).resolves.toEqual([]);
      await expect(hiddenNames(stranger.agent)).resolves.toEqual(['toast']);
    });

    it.each<[string, Record<string, unknown>]>([
      ['a missing name', {}],
      ['a blank name', { name: '  ' }],
      ['a too long name', { name: 'x'.repeat(API_LIMITS.nameMax + 1) }],
      ['a name without letters', { name: '\u0301' }],
      ['a null character', { name: 'To\u0000ast' }],
      ['an extra property', { name: 'Toast', kind: 'meal' }],
    ])('rejects hiding %s with 400', async (_label, body) => {
      await agent.post('/api/foods/hidden').send(body).expect(400);

      await expect(hiddenNames()).resolves.toEqual([]);
    });

    it.each<[string, Record<string, string>]>([
      ['a missing name', {}],
      ['a blank name', { name: ' ' }],
      ['a too long name', { name: 'x'.repeat(API_LIMITS.nameMax + 1) }],
      ['an extra parameter', { name: 'Toast', all: 'true' }],
    ])('rejects unhiding %s with 400', async (_label, query) => {
      await agent.delete('/api/foods/hidden').query(query).expect(400);
    });

    it('requires authentication for renaming and hiding', async () => {
      const server = app.getHttpServer();
      await request(server)
        .post('/api/foods/rename')
        .send({ from: 'Toast', to: 'Bread' })
        .expect(401);
      await request(server).get('/api/foods/hidden').expect(401);
      await request(server)
        .post('/api/foods/hidden')
        .send({ name: 'Toast' })
        .expect(401);
      await request(server)
        .delete('/api/foods/hidden')
        .query({ name: 'Toast' })
        .expect(401);
    });
  });

  describe('barcode products', () => {
    it('returns a product as one serving named after its brand, with the brand as detail', async () => {
      const product = await saveProduct(LABAN_BARCODE, laban());

      const results = await search({ q: 'laban' });

      expect(results).toEqual<FoodSearchResult[]>([
        {
          key: `product:${product.id}`,
          kind: 'product',
          name: 'Almarai Laban',
          detail: 'Almarai',
          items: [
            {
              name: 'Almarai Laban',
              grams: 250,
              nutrients: nutrients({
                calories: 105,
                protein: 8,
                fat: 3,
                sodium: 125,
              }),
              confidence: 'high',
              productId: product.id,
              micros: { calcium: 300, vitaminB12: 0.5 },
              fluidMl: 250,
            },
          ],
          totals: nutrients({ calories: 105, protein: 8, fat: 3, sodium: 125 }),
          grams: 250,
          portion: null,
          mealType: null,
          photo: null,
          favoriteId: null,
          entryId: null,
          productId: product.id,
          barcode: LABAN_BARCODE,
          useCount: 0,
          lastUsedAt: null,
          starred: false,
        },
      ]);
      await expect(searchNames('almarai')).resolves.toEqual(['Almarai Laban']);
      await expect(search()).resolves.toEqual([]);
    });

    it('uses 100 g as the serving of products without a serving size', async () => {
      await saveProduct(
        LABNEH_BARCODE,
        laban({
          name: 'Taanayel Labneh',
          brand: 'TAANAYEL',
          basisUnit: 'g',
          servingSizeG: null,
          per100: nutrients({ calories: 160, protein: 8.5 }),
        }),
      );

      const [result] = await search({ q: 'labneh' });

      expect(result).toMatchObject({
        kind: 'product',
        name: 'Taanayel Labneh',
        detail: 'TAANAYEL',
        items: [
          {
            name: 'Taanayel Labneh',
            grams: 100,
            nutrients: nutrients({ calories: 160, protein: 8.5 }),
            confidence: 'high',
          },
        ],
        grams: 100,
        totals: nutrients({ calories: 160, protein: 8.5 }),
      });
    });

    it('has no detail for a product without a brand', async () => {
      await saveProduct(
        LABNEH_BARCODE,
        laban({ name: 'Plain labneh', brand: null }),
      );

      const [result] = await search({ q: 'labneh' });

      expect(result).toMatchObject({
        kind: 'product',
        name: 'Plain labneh',
        detail: null,
        grams: 250,
      });
    });

    it('quick logs a product by servings or grams and keeps one library result', async () => {
      const product = await saveProduct(LABAN_BARCODE, laban());
      const when = moment(0);

      const byServings = await quickLog({
        key: `product:${product.id}`,
        servings: 2,
        mealType: 'lunch',
        ...when,
      });
      const byGrams = await quickLog({
        key: `product:${product.id}`,
        grams: 125,
        servings: 3,
      });

      expect(byServings).toEqual<EntryDto>({
        id: expect.any(String),
        name: 'Almarai Laban',
        description: null,
        mealType: 'lunch',
        source: 'barcode',
        timestamp: when.timestamp,
        localDate: when.localDate,
        items: [
          {
            id: expect.any(String),
            position: 0,
            name: 'Almarai Laban',
            grams: 500,
            nutrients: nutrients({
              calories: 210,
              protein: 16,
              fat: 6,
              sodium: 250,
            }),
            confidence: 'high',
            count: null,
            unit: null,
            unitPlural: null,
            productId: product.id,
            micros: { calcium: 600, vitaminB12: 1 },
            fluidMl: 500,
          },
        ],
        totals: nutrients({ calories: 210, protein: 16, fat: 6, sodium: 250 }),
        portion: null,
        photo: null,
        photos: [],
        analysisId: null,
        favoriteId: null,
        productId: product.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(byGrams).toMatchObject({
        source: 'barcode',
        items: [
          {
            grams: 125,
            nutrients: nutrients({
              calories: 53,
              protein: 4,
              fat: 1.5,
              sodium: 63,
            }),
            micros: { calcium: 150, vitaminB12: 0.25 },
            fluidMl: 125,
          },
        ],
      });
      await expect(
        prisma.entry.findMany({
          where: { id: { in: [byServings.id, byGrams.id] } },
          select: { productId: true },
        }),
      ).resolves.toEqual([
        { productId: product.id },
        { productId: product.id },
      ]);

      const results = await search({ q: 'almarai laban' });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        key: `product:${product.id}`,
        kind: 'product',
        useCount: 2,
        grams: 250,
      });
      expect(results[0]?.lastUsedAt).not.toBeNull();
      const recent = await search();
      expect(recent.map((r) => r.key)).toEqual([`product:${product.id}`]);
    });

    it('ranks a favorite above a product with the same name', async () => {
      await saveProduct(LABAN_BARCODE, laban());
      const favorite = await createFavorite({
        name: 'almarai laban',
        items: [item('Laban', 200, { calories: 84 })],
      });

      const results = await search({ q: 'laban' });

      expect(results.map((r) => r.key)).toEqual([`favorite:${favorite.id}`]);
    });

    it('rejects product amounts beyond the item limits', async () => {
      const product = await saveProduct(
        LABAN_BARCODE,
        laban({ servingSizeG: 1000 }),
      );
      const before = await prisma.entry.count();

      await agent
        .post('/api/foods/log')
        .send(quickLogBody({ key: `product:${product.id}`, servings: 11 }))
        .expect(400);

      await expect(prisma.entry.count()).resolves.toBe(before);
      await expect(
        prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      ).resolves.toMatchObject({ useCount: 0, lastUsedAt: null });
    });
  });
});

describe('food rename throttling (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ throttling: true });
    await resetDatabase(app.get(PrismaService));
  });

  afterAll(async () => {
    await resetDatabase(app.get(PrismaService));
    await app.close();
  });

  it(`allows ${FOOD_RENAME_THROTTLE.long.limit} renames per minute`, async () => {
    const agent = await setupAndLogin(app);
    const body: FoodRenameRequest = {
      from: 'Toast',
      to: 'Bread',
      dryRun: true,
    };
    for (let i = 0; i < FOOD_RENAME_THROTTLE.long.limit; i += 1) {
      await agent.post('/api/foods/rename').send(body).expect(200);
    }

    await agent.post('/api/foods/rename').send(body).expect(429);
    await agent.get('/api/foods/hidden').expect(200);
  });
});
