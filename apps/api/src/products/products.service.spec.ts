import { zeroNutrients } from '@food/shared';
import { NotFoundException } from '@nestjs/common';
import { Prisma, type Product } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { OpenFoodFactsClient } from './open-food-facts.client.js';
import type { OffProduct } from './open-food-facts.mapper.js';
import type { UpsertProductDto } from './products.dto.js';
import { ProductsService } from './products.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const PRODUCT_ID = '019a0000-0000-7000-8000-0000000000d1';
const BARCODE = '5280001234566';
const NOW = new Date('2026-09-28T08:00:00.000Z');
const WHERE_BARCODE = {
  userId_barcode: { userId: USER_ID, barcode: BARCODE },
};

function productRow(overrides: Partial<Product> = {}): Product {
  return {
    id: PRODUCT_ID,
    userId: USER_ID,
    barcode: BARCODE,
    name: 'Laban Ayran',
    brand: 'Almarai',
    basisUnit: 'ml',
    ...zeroNutrients(),
    calories: 42,
    microsPer100: null,
    servingSizeG: 250,
    packSizeG: 1000,
    source: 'openfoodfacts',
    imageUrl: null,
    missingNutrients: [],
    aliases: [],
    unitName: null,
    unitGrams: null,
    useCount: 0,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const OFF_PRODUCT: OffProduct = {
  name: 'Laban Ayran',
  brand: 'Almarai',
  basisUnit: 'ml',
  per100: { ...zeroNutrients(), calories: 42 },
  microsPer100: { calcium: 120, potassium: 150 },
  servingSizeG: 250,
  packSizeG: 1000,
  imageUrl: 'https://images.openfoodfacts.org/front.jpg',
  missingNutrients: ['fiber', 'sodium'],
};

function setup() {
  const prisma = {
    product: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue({ id: PRODUCT_ID }),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(productRow()),
      delete: vi.fn().mockResolvedValue(productRow()),
    },
    favorite: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    draft: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  const openFoodFacts = { find: vi.fn().mockResolvedValue(null) };
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    openFoodFacts as unknown as OpenFoodFactsClient,
  );
  return { prisma, openFoodFacts, service };
}

describe('ProductsService', () => {
  describe('lookup', () => {
    it('returns an own product without asking Open Food Facts', async () => {
      const { openFoodFacts, prisma, service } = setup();
      prisma.product.findUnique.mockResolvedValue(
        productRow({ source: 'label' }),
      );

      const response = await service.lookup(USER_ID, BARCODE);

      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: WHERE_BARCODE,
      });
      expect(response).toMatchObject({
        barcode: BARCODE,
        source: 'library',
        product: { id: PRODUCT_ID, source: 'label' },
      });
      expect(openFoodFacts.find).not.toHaveBeenCalled();
    });

    it('saves a product found on Open Food Facts for the user', async () => {
      const { openFoodFacts, prisma, service } = setup();
      openFoodFacts.find.mockResolvedValue(OFF_PRODUCT);

      const response = await service.lookup(USER_ID, BARCODE);

      expect(openFoodFacts.find).toHaveBeenCalledWith(BARCODE);
      expect(prisma.product.upsert).toHaveBeenCalledWith({
        where: WHERE_BARCODE,
        create: {
          userId: USER_ID,
          barcode: BARCODE,
          name: 'Laban Ayran',
          brand: 'Almarai',
          basisUnit: 'ml',
          ...zeroNutrients(),
          calories: 42,
          microsPer100: { calcium: 120, potassium: 150 },
          servingSizeG: 250,
          packSizeG: 1000,
          source: 'openfoodfacts',
          missingNutrients: ['fiber', 'sodium'],
          imageUrl: 'https://images.openfoodfacts.org/front.jpg',
        },
        update: {},
      });
      expect(response).toMatchObject({
        barcode: BARCODE,
        source: 'openfoodfacts',
        product: { id: PRODUCT_ID },
      });
    });

    it('reports an own product saved concurrently as the library copy', async () => {
      const { openFoodFacts, prisma, service } = setup();
      openFoodFacts.find.mockResolvedValue(OFF_PRODUCT);
      prisma.product.upsert.mockResolvedValue(productRow({ source: 'label' }));

      await expect(service.lookup(USER_ID, BARCODE)).resolves.toMatchObject({
        source: 'library',
        product: { source: 'label' },
      });
    });

    it('returns no product when nothing is found', async () => {
      const { prisma, service } = setup();

      await expect(service.lookup(USER_ID, BARCODE)).resolves.toEqual({
        barcode: BARCODE,
        source: null,
        product: null,
      });
      expect(prisma.product.upsert).not.toHaveBeenCalled();
    });
  });

  describe('upsert', () => {
    it('creates or replaces the product of the user', async () => {
      const { prisma, service } = setup();
      const dto = {
        name: 'Labneh',
        brand: '',
        basisUnit: 'g',
        per100: { ...zeroNutrients(), calories: 160 },
        source: 'label',
      } as UpsertProductDto;

      await service.upsert(USER_ID, BARCODE, dto);

      const columns = {
        name: 'Labneh',
        brand: null,
        basisUnit: 'g',
        ...zeroNutrients(),
        calories: 160,
        servingSizeG: null,
        packSizeG: null,
        source: 'label',
        missingNutrients: [],
      };
      expect(prisma.product.upsert).toHaveBeenCalledWith({
        where: WHERE_BARCODE,
        create: { ...columns, userId: USER_ID, barcode: BARCODE },
        update: columns,
      });
      expect(columns).not.toHaveProperty('aliases');
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
    });

    it('stores the printed micros of a label and clears them when sent as null', async () => {
      const { prisma, service } = setup();
      const dto = (microsPer100: UpsertProductDto['microsPer100']) =>
        ({
          name: 'Fortified soy drink',
          basisUnit: 'ml',
          per100: { ...zeroNutrients(), calories: 39 },
          microsPer100,
          source: 'label',
        }) as UpsertProductDto;

      await service.upsert(
        USER_ID,
        BARCODE,
        dto({ calcium: 120, vitaminD: 0.75, vitaminB12: 0.38461 }),
      );
      await service.upsert(USER_ID, BARCODE, dto(null));

      expect(prisma.product.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          create: expect.objectContaining({
            microsPer100: { calcium: 120, vitaminD: 0.75, vitaminB12: 0.3846 },
          }),
          update: expect.objectContaining({
            microsPer100: { calcium: 120, vitaminD: 0.75, vitaminB12: 0.3846 },
          }),
        }),
      );
      expect(prisma.product.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          update: expect.objectContaining({ microsPer100: Prisma.DbNull }),
        }),
      );
    });

    it('keeps the missing nutrients the user did not correct on an Open Food Facts product', async () => {
      const { prisma, service } = setup();
      prisma.product.findUnique.mockResolvedValue(
        productRow({ missingNutrients: ['fiber', 'sodium'] }),
      );
      const dto = {
        name: 'Laban Ayran',
        brand: 'Almarai',
        basisUnit: 'ml',
        per100: { ...zeroNutrients(), calories: 42, fiber: 0.4 },
        servingSizeG: 250,
        packSizeG: 1000,
        source: 'openfoodfacts',
      } as UpsertProductDto;

      await service.upsert(USER_ID, BARCODE, dto);

      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: WHERE_BARCODE,
      });
      expect(prisma.product.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ missingNutrients: ['sodium'] }),
        }),
      );
    });
  });

  it('lists the products of the user most used first', async () => {
    const { prisma, service } = setup();
    prisma.product.findMany.mockResolvedValue([productRow()]);

    await expect(service.list(USER_ID)).resolves.toHaveLength(1);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: [
        { useCount: 'desc' },
        { lastUsedAt: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
        { id: 'asc' },
      ],
    });
  });

  describe('remove', () => {
    it('deletes only a product of the user', async () => {
      const { prisma, service } = setup();

      await service.remove(USER_ID, PRODUCT_ID);

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID, userId: USER_ID },
        select: { id: true },
      });
      expect(prisma.product.delete).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
      });
    });

    it('unlinks the product from favorite and draft items first', async () => {
      const { prisma, service } = setup();
      const linked = {
        name: 'Labneh',
        grams: 30,
        nutrients: { ...zeroNutrients(), calories: 48 },
        confidence: 'high',
        count: null,
        unit: null,
        unitPlural: null,
        productId: PRODUCT_ID,
        micros: { calcium: 33 },
        fluidMl: null,
      };
      prisma.favorite.findMany.mockResolvedValue([
        { id: 'fav-1', items: [linked] },
        { id: 'fav-2', items: [{ ...linked, productId: null }] },
      ]);
      prisma.draft.findMany.mockResolvedValue([
        { id: 'draft-1', items: null },
        { id: 'draft-2', items: [linked] },
      ]);

      await service.remove(USER_ID, PRODUCT_ID);

      expect(prisma.favorite.update).toHaveBeenCalledTimes(1);
      expect(prisma.favorite.update).toHaveBeenCalledWith({
        where: { id: 'fav-1' },
        data: { items: [{ ...linked, productId: null }] },
      });
      expect(prisma.draft.update).toHaveBeenCalledTimes(1);
      expect(prisma.draft.update).toHaveBeenCalledWith({
        where: { id: 'draft-2' },
        data: { items: [{ ...linked, productId: null }] },
      });
      const unlinkOrder =
        prisma.favorite.update.mock.invocationCallOrder[0] ?? 0;
      const deleteOrder =
        prisma.product.delete.mock.invocationCallOrder[0] ?? 0;
      expect(unlinkOrder).toBeLessThan(deleteOrder);
    });

    it('returns 404 for unknown or foreign products', async () => {
      const { prisma, service } = setup();
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.remove(USER_ID, PRODUCT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.product.delete).not.toHaveBeenCalled();
    });
  });
});
