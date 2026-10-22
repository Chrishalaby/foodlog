import { randomUUID } from 'node:crypto';
import {
  type AnalyzeResponse,
  API_LIMITS,
  type BarcodeLookupResponse,
  type EntryDto,
  type EntryRawAiResponse,
  type LogProductRequest,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  type Nutrients,
  type ProductDto,
  type UpsertProductRequest,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { gs1CheckDigit } from '../src/products/barcode.js';
import {
  OFF_FETCH,
  OFF_USER_AGENT,
  type OffFetch,
} from '../src/products/open-food-facts.client.js';
import {
  createSignedInUser,
  createTestApp,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

type OffFixture = Record<string, unknown>;

interface FakeOpenFoodFacts {
  fetch: ReturnType<typeof vi.fn<OffFetch>>;
  products: Map<string, OffFixture>;
  failing: Set<string>;
}

interface Stranger {
  id: string;
  agent: TestAgent;
}

const IMAGE_URL =
  'https://images.openfoodfacts.org/images/products/528/front_en.3.200.jpg';

const LABAN_OFF: OffFixture = {
  product_name: 'Laban Ayran',
  brands: 'Almarai, Almarai Company',
  quantity: '1 L',
  serving_size: '250 ml',
  serving_quantity: 250,
  product_quantity: '1000',
  nutrition_data_per: '100g',
  image_front_small_url: IMAGE_URL,
  nutriments: {
    'energy-kcal_100g': 42,
    proteins_100g: 3.2,
    carbohydrates_100g: 4.6,
    sugars_100g: 4.6,
    fat_100g: 1.2,
    'saturated-fat_100g': 0.8,
    sodium_100g: 0.05,
    calcium_100g: 0.12,
    'vitamin-d_100g': 0.00000075,
    'vitamin-b12_100g': 0.0000002,
  },
};

const GRANOLA_OFF: OffFixture = {
  product_name: 'Crunchy granola',
  brands: 'Dolly',
  quantity: '500 g',
  serving_quantity: '40',
  nutriments: {
    energy_100g: 1883,
    proteins_100g: 10,
    carbohydrates_100g: 60,
    fiber_100g: 8,
    sugars_100g: 20,
    fat_100g: 18,
    'saturated-fat_100g': 3,
    salt_100g: 0.5,
  },
};

let nextBarcode = 1;

function ean13(): string {
  const payload = `528${String(nextBarcode).padStart(9, '0')}`;
  nextBarcode += 1;
  return `${payload}${gs1CheckDigit(payload)}`;
}

function upcA(): string {
  const payload = `07${String(nextBarcode).padStart(9, '0')}`;
  nextBarcode += 1;
  return `${payload}${gs1CheckDigit(payload)}`;
}

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function labneh(
  overrides: Partial<UpsertProductRequest> = {},
): UpsertProductRequest {
  return {
    name: 'Labneh',
    brand: 'Taanayel',
    basisUnit: 'g',
    per100: nutrients({
      calories: 160,
      protein: 8.5,
      carbs: 4,
      fat: 12,
      satFat: 7.5,
      sodium: 500,
    }),
    microsPer100: { calcium: 110, cholesterol: 40 },
    servingSizeG: 30,
    packSizeG: 500,
    source: 'label',
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeOpenFoodFacts(): FakeOpenFoodFacts {
  const products = new Map<string, OffFixture>();
  const failing = new Set<string>();
  const fetch = vi.fn<OffFetch>((url) => {
    const code = new URL(url).pathname.split('/').at(-1) ?? '';
    if (failing.has(code)) {
      return Promise.reject(
        new DOMException('The operation timed out', 'TimeoutError'),
      );
    }
    const product = products.get(code);
    return Promise.resolve(
      product
        ? json({ code, status: 1, status_verbose: 'product found', product })
        : json({ code, status: 0, status_verbose: 'product not found' }, 404),
    );
  });
  return { fetch, products, failing };
}

function logBody(
  overrides: Partial<LogProductRequest> = {},
): LogProductRequest {
  return {
    timestamp: '2026-09-28T08:15:00.000+03:00',
    localDate: '2026-09-28',
    mealType: 'breakfast',
    ...overrides,
  };
}

describe('barcode products (e2e)', () => {
  const off = fakeOpenFoodFacts();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) =>
        builder.overrideProvider(OFF_FETCH).useValue(off.fetch),
    });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
  });

  beforeEach(async () => {
    off.fetch.mockClear();
    off.products.clear();
    off.failing.clear();
    await prisma.entry.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function createStranger(): Promise<Stranger> {
    const { user, agent: strangerAgent } = await createSignedInUser(app);
    return { id: user.id, agent: strangerAgent };
  }

  async function lookup(
    code: string,
    owner: TestAgent = agent,
  ): Promise<BarcodeLookupResponse> {
    const response = await owner
      .get(`/api/products/barcode/${code}`)
      .expect(200);
    return response.body as BarcodeLookupResponse;
  }

  async function save(
    code: string,
    body: UpsertProductRequest = labneh(),
    owner: TestAgent = agent,
  ): Promise<ProductDto> {
    const response = await owner
      .put(`/api/products/barcode/${code}`)
      .send(body)
      .expect(200);
    return response.body as ProductDto;
  }

  async function list(owner: TestAgent = agent): Promise<ProductDto[]> {
    const response = await owner.get('/api/products').expect(200);
    return response.body as ProductDto[];
  }

  async function logProduct(
    id: string,
    overrides: Partial<LogProductRequest> = {},
  ): Promise<EntryDto> {
    const response = await agent
      .post(`/api/products/${id}/log`)
      .send(logBody(overrides))
      .expect(201);
    return response.body as EntryDto;
  }

  describe('GET /api/products/barcode/:code', () => {
    it('saves an Open Food Facts product and serves it from the library next time', async () => {
      const code = ean13();
      off.products.set(code, LABAN_OFF);

      const found = await lookup(code);

      expect(found).toEqual<BarcodeLookupResponse>({
        barcode: code,
        source: 'openfoodfacts',
        product: {
          id: expect.any(String),
          barcode: code,
          name: 'Laban Ayran',
          brand: 'Almarai',
          aliases: [],
          unitName: null,
          unitGrams: null,
          basisUnit: 'ml',
          per100: nutrients({
            calories: 42,
            protein: 3.2,
            carbs: 4.6,
            fat: 1.2,
            satFat: 0.8,
            sugar: 4.6,
            sodium: 50,
          }),
          microsPer100: { vitaminD: 0.75, vitaminB12: 0.2, calcium: 120 },
          servingSizeG: 250,
          packSizeG: 1000,
          source: 'openfoodfacts',
          imageUrl: IMAGE_URL,
          missingNutrients: ['fiber'],
          useCount: 0,
          lastUsedAt: null,
        },
      });
      expect(off.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = off.fetch.mock.calls[0] ?? [];
      expect(url).toBe(
        `https://world.openfoodfacts.org/api/v2/product/${code}?fields=code,product_name,brands,nutriments,serving_quantity,serving_size,product_quantity,quantity,image_front_small_url,nutrition_data_per`,
      );
      expect(init).toMatchObject({
        headers: { 'User-Agent': OFF_USER_AGENT },
        signal: expect.any(AbortSignal),
      });

      const again = await lookup(code);

      expect(again).toEqual({ ...found, source: 'library' });
      expect(off.fetch).toHaveBeenCalledTimes(1);
      await expect(list()).resolves.toEqual([found.product]);
    });

    it('converts kJ, salt and EU carbohydrates to our conventions', async () => {
      const code = ean13();
      off.products.set(code, GRANOLA_OFF);

      const { product } = await lookup(code);

      expect(product).toMatchObject({
        name: 'Crunchy granola',
        brand: 'Dolly',
        basisUnit: 'g',
        per100: nutrients({
          calories: 450.05,
          protein: 10,
          carbs: 68,
          fat: 18,
          satFat: 3,
          fiber: 8,
          sugar: 20,
          sodium: 200,
        }),
        servingSizeG: 40,
        packSizeG: null,
        imageUrl: null,
        missingNutrients: [],
      });
    });

    it('lists the nutrients Open Food Facts leaves out until the user corrects them', async () => {
      const code = ean13();
      off.products.set(code, {
        product_name: 'Sesame crackers',
        brands: 'Gandour',
        quantity: '200 g',
        nutriments: {
          'energy-kcal_100g': 420,
          proteins_100g: 9,
          carbohydrates_100g: 65,
          fat_100g: 12,
        },
      });

      const { product } = await lookup(code);

      expect(product).toMatchObject({
        per100: nutrients({ calories: 420, protein: 9, carbs: 65, fat: 12 }),
        missingNutrients: ['satFat', 'fiber', 'sugar', 'sodium'],
      });
      const stored = await prisma.product.findFirstOrThrow({
        where: { barcode: code },
        select: { missingNutrients: true },
      });
      expect(stored.missingNutrients).toEqual([
        'satFat',
        'fiber',
        'sugar',
        'sodium',
      ]);
      await expect(list()).resolves.toMatchObject([
        { missingNutrients: ['satFat', 'fiber', 'sugar', 'sodium'] },
      ]);

      const partly = await save(code, {
        name: 'Sesame crackers',
        brand: 'Gandour',
        basisUnit: 'g',
        per100: nutrients({
          calories: 420,
          protein: 9,
          carbs: 65,
          fat: 12,
          sodium: 480,
        }),
        source: 'openfoodfacts',
      });
      expect(partly.missingNutrients).toEqual(['satFat', 'fiber', 'sugar']);

      const corrected = await save(code, {
        name: 'Sesame crackers',
        brand: 'Gandour',
        basisUnit: 'g',
        per100: nutrients({
          calories: 420,
          protein: 9,
          carbs: 65,
          fat: 12,
          satFat: 2,
          sugar: 3,
          sodium: 480,
        }),
        source: 'manual',
      });
      expect(corrected).toMatchObject({
        id: product?.id,
        source: 'manual',
        missingNutrients: [],
      });
      await expect(lookup(code)).resolves.toMatchObject({
        source: 'library',
        product: { missingNutrients: [] },
      });
    });

    it('returns no product when nothing is known, then finds the label values saved for it', async () => {
      const code = ean13();

      await expect(lookup(code)).resolves.toEqual({
        barcode: code,
        source: null,
        product: null,
      });
      await expect(lookup(code)).resolves.toMatchObject({ product: null });
      expect(off.fetch).toHaveBeenCalledTimes(1);
      await expect(list()).resolves.toEqual([]);

      const saved = await save(code);

      expect(saved).toEqual<ProductDto>({
        id: expect.any(String),
        barcode: code,
        name: 'Labneh',
        brand: 'Taanayel',
        aliases: [],
        unitName: null,
        unitGrams: null,
        basisUnit: 'g',
        per100: labneh().per100,
        microsPer100: { calcium: 110, cholesterol: 40 },
        servingSizeG: 30,
        packSizeG: 500,
        source: 'label',
        imageUrl: null,
        missingNutrients: [],
        useCount: 0,
        lastUsedAt: null,
      });
      await expect(lookup(code)).resolves.toEqual({
        barcode: code,
        source: 'library',
        product: saved,
      });
      expect(off.fetch).toHaveBeenCalledTimes(1);
    });

    it('saves one product when the same barcode is scanned twice at once', async () => {
      const code = ean13();
      off.products.set(code, LABAN_OFF);

      const [first, second] = await Promise.all([lookup(code), lookup(code)]);

      expect(first.product).not.toBeNull();
      expect(second.product).toEqual(first.product);
      expect(off.fetch).toHaveBeenCalledTimes(1);
      await expect(list()).resolves.toHaveLength(1);

      const saves = await Promise.all([
        save(code, labneh({ name: 'Laban A' })),
        save(code, labneh({ name: 'Laban B' })),
        save(code, labneh({ name: 'Laban C' })),
      ]);

      expect(new Set(saves.map((saved) => saved.id))).toEqual(
        new Set([first.product?.id]),
      );
      await expect(list()).resolves.toHaveLength(1);
    });

    it('ignores Open Food Facts products without energy', async () => {
      const code = ean13();
      off.products.set(code, {
        ...LABAN_OFF,
        nutriments: { proteins_100g: 3.2 },
      });

      await expect(lookup(code)).resolves.toMatchObject({
        source: null,
        product: null,
      });
      await expect(list()).resolves.toEqual([]);
    });

    it('treats Open Food Facts failures as not found without remembering them', async () => {
      const code = ean13();
      off.products.set(code, LABAN_OFF);
      off.failing.add(code);

      await expect(lookup(code)).resolves.toEqual({
        barcode: code,
        source: null,
        product: null,
      });
      await expect(list()).resolves.toEqual([]);

      off.failing.delete(code);
      await expect(lookup(code)).resolves.toMatchObject({
        source: 'openfoodfacts',
        product: { name: 'Laban Ayran' },
      });
      expect(off.fetch).toHaveBeenCalledTimes(2);
    });

    it('treats UPC-A, EAN-13 and GTIN-14 forms as the same product', async () => {
      const upc = upcA();
      const ean = `0${upc}`;
      const gtin = `00${upc}`;

      const saved = await save(upc);

      expect(saved.barcode).toBe(ean);
      for (const form of [upc, ean, gtin]) {
        await expect(lookup(form)).resolves.toEqual({
          barcode: ean,
          source: 'library',
          product: saved,
        });
      }
      const updated = await save(gtin, labneh({ name: 'Labneh balls' }));
      expect(updated).toMatchObject({ id: saved.id, name: 'Labneh balls' });
      await expect(list()).resolves.toHaveLength(1);
      expect(off.fetch).not.toHaveBeenCalled();
    });

    it('asks Open Food Facts for the EAN-13 form of a UPC-A code', async () => {
      const upc = upcA();
      off.products.set(`0${upc}`, LABAN_OFF);

      await expect(lookup(upc)).resolves.toMatchObject({
        barcode: `0${upc}`,
        source: 'openfoodfacts',
        product: { barcode: `0${upc}` },
      });
    });

    it('treats a UPC-E code as its expanded UPC-A product', async () => {
      const saved = await save('042100005264');

      await expect(lookup('04252614')).resolves.toEqual({
        barcode: '0042100005264',
        source: 'library',
        product: saved,
      });
      const updated = await save('04252614', labneh({ name: 'Labneh jar' }));
      expect(updated).toMatchObject({ id: saved.id, name: 'Labneh jar' });
      expect(off.fetch).not.toHaveBeenCalled();
    });

    it('trims surrounding whitespace from a barcode like the web does', async () => {
      const code = ean13();
      const saved = await save(code);

      await expect(lookup(`%20${code}%20`)).resolves.toEqual({
        barcode: code,
        source: 'library',
        product: saved,
      });
    });

    it.each([
      ['a wrong check digit', '5280001234567'],
      ['a wrong UPC-A check digit', '036000291453'],
      ['a wrong EAN-8 check digit', '96385075'],
      ['a wrong UPC-E check digit', '04252615'],
      ['too few digits', '12345'],
      ['too many digits', '123456789012345'],
      ['letters', '52800012345a6'],
      ['an encoded plus sign', '%2B5280001234566'],
      ['a 9-digit code', '123456789'],
      ['a 6-digit code', '123456'],
    ])('rejects %s with 400', async (_label, code) => {
      await agent.get(`/api/products/barcode/${code}`).expect(400);
      await agent
        .put(`/api/products/barcode/${code}`)
        .send(labneh())
        .expect(400);

      expect(off.fetch).not.toHaveBeenCalled();
      await expect(list()).resolves.toEqual([]);
    });
  });

  describe('PUT /api/products/barcode/:code', () => {
    it('updates the product in place and keeps its usage', async () => {
      const code = ean13();
      const saved = await save(code);
      await logProduct(saved.id);
      await agent
        .put(`/api/my-foods/${saved.id}`)
        .send({ aliases: ['Strained yogurt'], unitName: 'tbsp', unitGrams: 15 })
        .expect(200);

      const updated = await save(
        code,
        labneh({
          name: 'Labneh light',
          brand: null,
          basisUnit: 'g',
          per100: nutrients({ calories: 120 }),
          servingSizeG: null,
          packSizeG: null,
          source: 'manual',
        }),
      );

      expect(updated).toMatchObject({
        id: saved.id,
        barcode: code,
        name: 'Labneh light',
        brand: null,
        per100: nutrients({ calories: 120 }),
        servingSizeG: null,
        packSizeG: null,
        source: 'manual',
        useCount: 1,
        aliases: ['Strained yogurt'],
        unitName: 'tbsp',
        unitGrams: 15,
      });
      expect(updated.lastUsedAt).not.toBeNull();
    });

    it('stores a blank brand as none and trims the name', async () => {
      const saved = await save(
        ean13(),
        labneh({ name: '  Labneh  ', brand: '   ' }),
      );

      expect(saved).toMatchObject({ name: 'Labneh', brand: null });
    });

    it.each<[string, Record<string, unknown>]>([
      ['a missing name', { name: undefined }],
      ['a blank name', { name: '  ' }],
      ['a long name', { name: 'n'.repeat(API_LIMITS.nameMax + 1) }],
      ['a long brand', { brand: 'b'.repeat(API_LIMITS.nameMax + 1) }],
      ['an unknown basis unit', { basisUnit: 'oz' }],
      ['incomplete per-100 values', { per100: { calories: 100 } }],
      [
        'a nutrient above its maximum',
        { per100: nutrients({ sodium: NUTRIENT_META.sodium.max + 1 }) },
      ],
      ['a negative nutrient', { per100: nutrients({ fat: -1 }) }],
      ['a zero serving size', { servingSizeG: 0 }],
      ['a pack above the item limit', { packSizeG: MAX_ITEM_GRAMS + 1 }],
      ['an unknown source', { source: 'ai' }],
      ['an extra property', { barcode: '5280001234566' }],
      ['a null character', { name: 'Lab\u0000neh' }],
    ])('rejects %s with 400', async (_label, invalid) => {
      await agent
        .put(`/api/products/barcode/${ean13()}`)
        .send({ ...labneh(), ...invalid })
        .expect(400);

      await expect(list()).resolves.toEqual([]);
    });
  });

  describe('GET /api/products', () => {
    it('lists the most used and most recent products first', async () => {
      const unused = await save(ean13(), labneh({ name: 'Zaatar' }));
      const alsoUnused = await save(ean13(), labneh({ name: 'Anise' }));
      const once = await save(ean13(), labneh({ name: 'Halloumi' }));
      const twice = await save(ean13(), labneh({ name: 'Kishk' }));
      const onceLater = await save(ean13(), labneh({ name: 'Ayran' }));
      await logProduct(twice.id);
      await logProduct(once.id);
      await logProduct(twice.id);
      await logProduct(onceLater.id);

      const products = await list();

      expect(products.map((p) => [p.id, p.useCount])).toEqual([
        [twice.id, 2],
        [onceLater.id, 1],
        [once.id, 1],
        [alsoUnused.id, 0],
        [unused.id, 0],
      ]);
    });
  });

  describe('POST /api/products/:id/log', () => {
    it('logs one serving by default as a barcode entry and counts the use', async () => {
      const product = await save(ean13());

      const entry = await logProduct(product.id);

      expect(entry).toEqual<EntryDto>({
        id: expect.any(String),
        name: 'Taanayel Labneh',
        description: null,
        mealType: 'breakfast',
        source: 'barcode',
        timestamp: '2026-09-28T05:15:00.000Z',
        localDate: '2026-09-28',
        items: [
          {
            id: expect.any(String),
            position: 0,
            name: 'Taanayel Labneh',
            grams: 30,
            nutrients: nutrients({
              calories: 48,
              protein: 2.6,
              carbs: 1.2,
              fat: 3.6,
              satFat: 2.3,
              sodium: 150,
            }),
            confidence: 'high',
            count: null,
            unit: null,
            unitPlural: null,
            productId: product.id,
            micros: { calcium: 33, cholesterol: 12 },
            fluidMl: null,
          },
        ],
        totals: nutrients({
          calories: 48,
          protein: 2.6,
          carbs: 1.2,
          fat: 3.6,
          satFat: 2.3,
          sodium: 150,
        }),
        portion: null,
        photo: null,
        photos: [],
        analysisId: null,
        favoriteId: null,
        productId: product.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      await expect(
        prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          select: { productId: true },
        }),
      ).resolves.toEqual({ productId: product.id });
      const [stored] = await list();
      expect(stored).toMatchObject({ id: product.id, useCount: 1 });
      expect(stored?.lastUsedAt).not.toBeNull();
      await agent.get(`/api/entries/${entry.id}`).expect(200);
    });

    it('logs servings, grams and 100 g servings for products without a size', async () => {
      const product = await save(ean13());
      const unsized = await save(
        ean13(),
        labneh({ name: 'Taanayel labneh balls', servingSizeG: null }),
      );

      const servings = await logProduct(product.id, { servings: 2.5 });
      const grams = await logProduct(product.id, { grams: 125 });
      const fallback = await logProduct(unsized.id, { servings: 1.5 });

      expect(servings.items).toMatchObject([
        { grams: 75, nutrients: { calories: 120, protein: 6.4, sodium: 375 } },
      ]);
      expect(grams.items).toMatchObject([
        {
          grams: 125,
          nutrients: { calories: 200, protein: 10.6, sodium: 625 },
        },
      ]);
      expect(fallback).toMatchObject({
        name: 'Taanayel labneh balls',
        items: [{ grams: 150, nutrients: { calories: 240, sodium: 750 } }],
      });
    });

    it('rejects grams and servings together, oversized amounts and invalid bodies', async () => {
      const product = await save(ean13(), labneh({ servingSizeG: 1000 }));

      for (const invalid of [
        { grams: 100, servings: 1 },
        { servings: 11 },
        { servings: 0 },
        { servings: API_LIMITS.favoriteServingsMax + 1 },
        { grams: 0 },
        { grams: MAX_ITEM_GRAMS + 1 },
        { mealType: 'brunch' },
        { localDate: '2026-02-30' },
        { timestamp: '2026-09-28T08:15:00' },
        { name: 'Labneh' },
      ]) {
        await agent
          .post(`/api/products/${product.id}/log`)
          .send({ ...logBody(), ...invalid })
          .expect(400);
      }

      await expect(prisma.entry.count()).resolves.toBe(0);
      const [stored] = await list();
      expect(stored).toMatchObject({ useCount: 0, lastUsedAt: null });
    });

    it('keeps the label photo, analysis and description of a label scan', async () => {
      const label = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: { r: 240, g: 240, b: 240 },
        },
      })
        .jpeg()
        .toBuffer();
      const analysis = (
        await agent
          .post('/api/analyze')
          .field('mode', 'nutrition_label')
          .field('description', '1 serving')
          .attach('image', label, {
            filename: 'label.jpg',
            contentType: 'image/jpeg',
          })
          .expect(200)
      ).body as AnalyzeResponse;
      const product = await save(ean13());

      const response = await agent
        .post(`/api/products/${product.id}/log`)
        .send({
          ...logBody({ grams: 40 }),
          analysisId: analysis.analysisId,
          description: '1 serving',
        })
        .expect(201);
      const entry = response.body as EntryDto;

      expect(entry).toMatchObject({
        source: 'barcode',
        productId: product.id,
        analysisId: analysis.analysisId,
        description: '1 serving',
        photo: { id: analysis.photo?.id },
      });
      expect(entry.photo).not.toBeNull();
      const rawAi = (
        await agent.get(`/api/entries/${entry.id}/raw-ai`).expect(200)
      ).body as EntryRawAiResponse;
      expect(rawAi).toMatchObject({ analysisId: analysis.analysisId });
      expect(rawAi.rawAiJson).not.toBeNull();
      const [stored] = await list();
      expect(stored).toMatchObject({ id: product.id, useCount: 1 });
    });

    it('saves the vitamins printed on a scanned label and logs them with the product', async () => {
      const label = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: { r: 240, g: 240, b: 240 },
        },
      })
        .jpeg()
        .toBuffer();
      const analysis = (
        await agent
          .post('/api/analyze')
          .field('mode', 'nutrition_label')
          .attach('image', label, {
            filename: 'label.jpg',
            contentType: 'image/jpeg',
          })
          .expect(200)
      ).body as AnalyzeResponse;
      const printed = analysis.result.label;
      expect(printed?.microsPer100).toEqual({
        iron: 3.6,
        magnesium: 105,
        potassium: 380,
      });

      const product = await save(ean13(), {
        name: printed?.productName ?? 'Granola',
        basisUnit: printed?.basisUnit ?? 'g',
        per100: printed?.per100 ?? nutrients(),
        microsPer100: printed?.microsPer100 ?? null,
        servingSizeG: printed?.servingSize ?? null,
        packSizeG: printed?.packSize ?? null,
        source: 'label',
      });
      expect(product.microsPer100).toEqual({
        iron: 3.6,
        magnesium: 105,
        potassium: 380,
      });
      await expect(
        prisma.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { microsPer100: true },
        }),
      ).resolves.toEqual({
        microsPer100: { iron: 3.6, magnesium: 105, potassium: 380 },
      });

      const entry = await logProduct(product.id, { grams: 45 });
      expect(entry.items[0]).toMatchObject({
        grams: 45,
        micros: { iron: 1.6, magnesium: 47, potassium: 171 },
        fluidMl: null,
      });

      const cleared = await save(product.barcode ?? '', {
        name: product.name,
        basisUnit: 'g',
        per100: product.per100,
        microsPer100: null,
        source: 'label',
      });
      expect(cleared.microsPer100).toBeNull();
    });

    it('counts a logged millilitre product as a drink', async () => {
      const code = ean13();
      off.products.set(code, LABAN_OFF);
      const { product } = await lookup(code);

      const entry = await logProduct(product?.id ?? '', { servings: 1.5 });

      expect(entry.items[0]).toMatchObject({
        grams: 375,
        fluidMl: 375,
        micros: { vitaminD: 2.8, vitaminB12: 0.75, calcium: 450 },
      });
    });

    it('rejects vitamins that are unknown or impossible', async () => {
      const code = ean13();

      for (const microsPer100 of [
        { vitaminQ: 1 },
        { calcium: -1 },
        { calcium: 100_001 },
        [120],
      ]) {
        await agent
          .put(`/api/products/barcode/${code}`)
          .send({ ...labneh(), microsPer100 })
          .expect(400);
      }
      await expect(list()).resolves.toEqual([]);
    });

    it('rejects a foreign analysis or photo without logging or counting the use', async () => {
      const stranger = await createStranger();
      const foreign = (
        await stranger.agent
          .post('/api/analyze')
          .field('mode', 'text')
          .field('description', '40 g oat clusters')
          .expect(200)
      ).body as AnalyzeResponse;
      const product = await save(ean13());

      await agent
        .post(`/api/products/${product.id}/log`)
        .send({ ...logBody(), analysisId: foreign.analysisId })
        .expect(404);
      await agent
        .post(`/api/products/${product.id}/log`)
        .send({ ...logBody(), photoId: randomUUID() })
        .expect(404);
      await agent
        .post(`/api/products/${product.id}/log`)
        .send({ ...logBody(), analysisId: 'not-a-uuid' })
        .expect(400);

      await expect(prisma.entry.count()).resolves.toBe(0);
      const [stored] = await list();
      expect(stored).toMatchObject({ useCount: 0, lastUsedAt: null });
    });

    it('returns 404 for unknown products and 400 for malformed ids', async () => {
      await agent
        .post(`/api/products/${randomUUID()}/log`)
        .send(logBody())
        .expect(404);
      await agent
        .post('/api/products/not-a-uuid/log')
        .send(logBody())
        .expect(400);
    });
  });

  describe('DELETE /api/products/:id', () => {
    it('deletes the product, keeps its entries and looks it up again next time', async () => {
      const code = ean13();
      off.products.set(code, LABAN_OFF);
      const { product } = await lookup(code);
      const entry = await logProduct(product?.id ?? '');

      await agent.delete(`/api/products/${product?.id}`).expect(204);

      await expect(list()).resolves.toEqual([]);
      await agent.delete(`/api/products/${product?.id}`).expect(404);
      await agent.delete('/api/products/not-a-uuid').expect(400);
      await expect(
        prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          select: { productId: true, name: true },
        }),
      ).resolves.toEqual({ productId: null, name: 'Almarai Laban Ayran' });
      await expect(lookup(code)).resolves.toMatchObject({
        source: 'openfoodfacts',
      });
      expect(off.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('user scoping', () => {
    it("never exposes or changes another user's products", async () => {
      const stranger = await createStranger();
      const code = ean13();
      const foreign = await save(code, labneh(), stranger.agent);

      await expect(list()).resolves.toEqual([]);
      await expect(lookup(code)).resolves.toEqual({
        barcode: code,
        source: null,
        product: null,
      });
      await agent
        .post(`/api/products/${foreign.id}/log`)
        .send(logBody())
        .expect(404);
      await agent.delete(`/api/products/${foreign.id}`).expect(404);

      const mine = await save(code, labneh({ name: 'My labneh' }));

      expect(mine.id).not.toBe(foreign.id);
      await expect(list(stranger.agent)).resolves.toEqual([foreign]);
      await expect(lookup(code, stranger.agent)).resolves.toMatchObject({
        source: 'library',
        product: { id: foreign.id, name: 'Labneh' },
      });
      await expect(prisma.entry.count()).resolves.toBe(0);
    });

    it('requires authentication', async () => {
      const anonymous = request(app.getHttpServer());
      const id = randomUUID();

      await anonymous.get('/api/products').expect(401);
      await anonymous.get('/api/products/barcode/5280001234566').expect(401);
      await anonymous
        .put('/api/products/barcode/5280001234566')
        .send(labneh())
        .expect(401);
      await anonymous.delete(`/api/products/${id}`).expect(401);
      await anonymous
        .post(`/api/products/${id}/log`)
        .send(logBody())
        .expect(401);
      expect(off.fetch).not.toHaveBeenCalled();
    });
  });
});

describe('barcode lookup rate limit (e2e)', () => {
  const off = fakeOpenFoodFacts();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;

  beforeAll(async () => {
    app = await createTestApp({
      throttling: true,
      configure: (builder) =>
        builder.overrideProvider(OFF_FETCH).useValue(off.fetch),
    });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    ({ agent } = await createSignedInUser(app));
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('allows 60 barcode lookups per minute per client', async () => {
    const code = ean13();

    const first = await agent.get(`/api/products/barcode/${code}`).expect(200);
    const second = await agent.get(`/api/products/barcode/${code}`).expect(200);
    const listing = await agent.get('/api/products').expect(200);

    expect(first.headers['x-ratelimit-limit-long']).toBe('60');
    expect(first.headers['x-ratelimit-remaining-long']).toBe('59');
    expect(second.headers['x-ratelimit-remaining-long']).toBe('58');
    expect(listing.headers['x-ratelimit-limit-long']).toBe('600');
    expect(off.fetch).toHaveBeenCalledTimes(1);
  });
});
