import { zeroNutrients } from '@food/shared';
import { NotFoundException } from '@nestjs/common';
import { Prisma, type Product } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SaveMyFoodDto, UpdateMyFoodDto } from './my-foods.dto.js';
import { MyFoodsService } from './my-foods.service.js';
import {
  applySavedFoodToPast,
  unlinkSavedFoodCopies,
} from './saved-food-apply.js';

vi.mock('./saved-food-apply.js', () => ({
  applySavedFoodToPast: vi.fn(() =>
    Promise.resolve({
      updatedItems: 2,
      updatedEntries: 2,
      updatedFavorites: 0,
    }),
  ),
  unlinkSavedFoodCopies: vi.fn(() => Promise.resolve()),
}));

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const FOOD_ID = '019a0000-0000-7000-8000-0000000000d1';
const NOW = new Date('2026-09-30T10:00:00.000Z');

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: FOOD_ID,
    userId: USER_ID,
    barcode: null,
    name: 'Heinz tomato ketchup',
    brand: null,
    aliases: ['Tomato ketchup'],
    unitName: 'tbsp',
    unitGrams: 17,
    basisUnit: 'g',
    ...zeroNutrients(),
    calories: 110,
    microsPer100: null,
    servingSizeG: 17,
    packSizeG: null,
    source: 'manual',
    imageUrl: null,
    missingNutrients: [],
    useCount: 3,
    lastUsedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    product: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(product()),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        ...product(),
        _count: { items: 5 },
      }),
      create: vi.fn((args: { data: Partial<Product> }) =>
        Promise.resolve({ ...product(args.data), _count: { items: 0 } }),
      ),
      update: vi.fn((args: { data: Partial<Product> }) =>
        Promise.resolve(product(args.data)),
      ),
      delete: vi.fn().mockResolvedValue(product()),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  const service = new MyFoodsService(prisma as unknown as PrismaService);
  return { prisma, service };
}

beforeEach(() => {
  vi.mocked(applySavedFoodToPast).mockClear();
  vi.mocked(unlinkSavedFoodCopies).mockClear();
});

describe('MyFoodsService.list', () => {
  it('lists own foods most used first and filters by any name', async () => {
    const { prisma, service } = setup();
    prisma.product.findMany.mockResolvedValue([
      { ...product(), _count: { items: 5 } },
      {
        ...product({ id: 'mayo', name: 'Mayonnaise', aliases: [] }),
        _count: { items: 1 },
      },
    ]);

    const all = await service.list(USER_ID);
    const found = await service.list(USER_ID, 'tomato');

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: [
        { useCount: 'desc' },
        { lastUsedAt: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
        { id: 'asc' },
      ],
      include: { _count: { select: { items: true } } },
    });
    expect(all.map(({ id, itemCount }) => [id, itemCount])).toEqual([
      [FOOD_ID, 5],
      ['mayo', 1],
    ]);
    expect(found.map(({ id }) => id)).toEqual([FOOD_ID]);
  });
});

describe('MyFoodsService.create', () => {
  it('saves a barcode-less food with clean aliases', async () => {
    const { prisma, service } = setup();

    const food = await service.create(USER_ID, {
      name: 'Heinz tomato ketchup',
      brand: '',
      aliases: ['Tomato ketchup', 'heinz tomato ketchup', 'Tomato ketchup.'],
      basisUnit: 'g',
      per100: { ...zeroNutrients(), calories: 110, carbs: 25 },
      unitName: 'tbsp',
      unitGrams: 0,
    } as SaveMyFoodDto);

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        barcode: null,
        name: 'Heinz tomato ketchup',
        brand: null,
        aliases: ['Tomato ketchup'],
        basisUnit: 'g',
        ...zeroNutrients(),
        calories: 110,
        carbs: 25,
        microsPer100: Prisma.DbNull,
        unitName: 'tbsp',
        unitGrams: null,
        servingSizeG: null,
        source: 'manual',
        missingNutrients: [],
      },
      include: { _count: { select: { items: true } } },
    });
    expect(food).toMatchObject({ barcode: null, itemCount: 0 });
  });

  it('stores the micros per 100 of a saved food', async () => {
    const { prisma, service } = setup();

    const food = await service.create(USER_ID, {
      name: 'Alpro soya drink',
      basisUnit: 'ml',
      per100: { ...zeroNutrients(), calories: 39 },
      microsPer100: { calcium: 120, vitaminD: 0.75 },
    } as SaveMyFoodDto);

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          microsPer100: { calcium: 120, vitaminD: 0.75 },
        }),
      }),
    );
    expect(food.microsPer100).toEqual({ calcium: 120, vitaminD: 0.75 });
  });

  it('keeps the source of a food saved from a label', async () => {
    const { prisma, service } = setup();

    await service.create(USER_ID, {
      name: 'Greek yogurt',
      basisUnit: 'g',
      per100: zeroNutrients(),
      source: 'label',
    } as SaveMyFoodDto);

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'label', aliases: [] }),
      }),
    );
  });
});

describe('MyFoodsService.update', () => {
  it('changes only the sent fields and clears nulls', async () => {
    const { prisma, service } = setup();

    const response = await service.update(USER_ID, FOOD_ID, {
      name: 'Tomato ketchup',
      brand: 'Heinz',
      unitName: null,
    } as UpdateMyFoodDto);

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: FOOD_ID, userId: USER_ID },
    });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: FOOD_ID },
      data: expect.objectContaining({
        name: 'Tomato ketchup',
        brand: 'Heinz',
        aliases: [],
        basisUnit: 'g',
        calories: 110,
        unitName: null,
        unitGrams: 17,
        servingSizeG: 17,
        missingNutrients: [],
      }),
    });
    expect(prisma.product.update.mock.calls[0]?.[0].data).not.toHaveProperty(
      'microsPer100',
    );
    expect(applySavedFoodToPast).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      food: { itemCount: 5 },
      updatedItems: 0,
      updatedEntries: 0,
      updatedFavorites: 0,
    });
  });

  it('recomputes linked past items when asked', async () => {
    const { prisma, service } = setup();

    const response = await service.update(USER_ID, FOOD_ID, {
      per100: { ...zeroNutrients(), calories: 100 },
      applyToPast: true,
    } as UpdateMyFoodDto);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: FOOD_ID },
      data: expect.objectContaining({ calories: 100 }),
    });
    expect(applySavedFoodToPast).toHaveBeenCalledWith(
      prisma,
      USER_ID,
      expect.objectContaining({ id: FOOD_ID, calories: 100 }),
      { matchNames: false },
    );
    expect(response).toMatchObject({ updatedItems: 2, updatedEntries: 2 });
  });

  it('replaces or clears the micros and applies them to past items', async () => {
    const { prisma, service } = setup();

    await service.update(USER_ID, FOOD_ID, {
      microsPer100: { potassium: 281 },
      applyToPast: true,
    } as UpdateMyFoodDto);
    await service.update(USER_ID, FOOD_ID, {
      microsPer100: null,
    } as UpdateMyFoodDto);

    expect(prisma.product.update).toHaveBeenNthCalledWith(1, {
      where: { id: FOOD_ID },
      data: expect.objectContaining({ microsPer100: { potassium: 281 } }),
    });
    expect(applySavedFoodToPast).toHaveBeenCalledWith(
      prisma,
      USER_ID,
      expect.objectContaining({ microsPer100: { potassium: 281 } }),
      { matchNames: false },
    );
    expect(prisma.product.update).toHaveBeenNthCalledWith(2, {
      where: { id: FOOD_ID },
      data: expect.objectContaining({ microsPer100: Prisma.DbNull }),
    });
  });

  it('returns 404 for foods of someone else', async () => {
    const { prisma, service } = setup();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.update(USER_ID, FOOD_ID, {} as UpdateMyFoodDto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});

describe('MyFoodsService.remove', () => {
  it('unlinks copies and deletes the food', async () => {
    const { prisma, service } = setup();

    await service.remove(USER_ID, FOOD_ID);

    expect(unlinkSavedFoodCopies).toHaveBeenCalledWith(
      prisma,
      USER_ID,
      FOOD_ID,
    );
    expect(prisma.product.delete).toHaveBeenCalledWith({
      where: { id: FOOD_ID },
    });
  });

  it('returns 404 for foods of someone else', async () => {
    const { prisma, service } = setup();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.remove(USER_ID, FOOD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });
});
