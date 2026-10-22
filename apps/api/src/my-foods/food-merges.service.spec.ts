import { zeroNutrients } from '@food/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, type Product } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PRODUCT_ORDER } from '../products/product-data.js';
import {
  DISMISSED_FOOD_MERGES_MAX,
  dismissedKey,
  FoodMergesService,
  withDismissedKey,
} from './food-merges.service.js';
import {
  FOOD_MERGE_DECISIONS_MAX,
  type FoodMergeDecision,
} from './merge-decisions.js';
import type { MergeFoodsDto } from './my-foods.dto.js';
import { applySavedFoodToPast } from './saved-food-apply.js';

vi.mock('./saved-food-apply.js', () => ({
  applySavedFoodToPast: vi.fn(() =>
    Promise.resolve({
      updatedItems: 3,
      updatedEntries: 2,
      updatedFavorites: 1,
    }),
  ),
  unlinkSavedFoodCopies: vi.fn(() => Promise.resolve()),
}));

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const FOOD_ID = '019a0000-0000-7000-8000-0000000000d1';
const NOW = new Date('2026-09-30T10:00:00.000Z');
const PER_100 = { ...zeroNutrients(), calories: 110, carbs: 25 };

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: FOOD_ID,
    userId: USER_ID,
    barcode: '5000157024671',
    name: 'Tomato Ketchup',
    brand: 'Heinz',
    aliases: ['Catsup'],
    unitName: null,
    unitGrams: null,
    basisUnit: 'g',
    ...zeroNutrients(),
    calories: 102,
    microsPer100: null,
    servingSizeG: 15,
    packSizeG: 500,
    source: 'openfoodfacts',
    imageUrl: null,
    missingNutrients: ['fiber'],
    useCount: 2,
    lastUsedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function mergeDto(overrides: Partial<MergeFoodsDto> = {}): MergeFoodsDto {
  return {
    key: 'tomato ketchup',
    names: ['Heinz tomato ketchup', 'Tomato ketchup'],
    name: 'Heinz tomato ketchup',
    basisUnit: 'g',
    per100: PER_100,
    applyToPast: false,
    ...overrides,
  } as MergeFoodsDto;
}

function setup() {
  const prisma = {
    entryItem: { findMany: vi.fn().mockResolvedValue([]) },
    product: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(product()),
      findUniqueOrThrow: vi.fn((args: { where: { id: string } }) =>
        Promise.resolve({
          ...product({ id: args.where.id }),
          _count: { items: 3 },
        }),
      ),
      create: vi.fn((args: { data: Partial<Product> }) =>
        Promise.resolve(product({ ...args.data, id: 'new-food' })),
      ),
      update: vi.fn((args: { data: Partial<Product> }) =>
        Promise.resolve(product(args.data)),
      ),
    },
    profile: {
      findUnique: vi.fn().mockResolvedValue({ dismissedFoodMerges: ['mayo'] }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ dismissedFoodMerges: ['mayo'] }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  const service = new FoodMergesService(prisma as unknown as PrismaService);
  return { prisma, service };
}

function itemRow(
  id: string,
  entryId: string,
  name: string,
  kcal: number,
  overrides: object = {},
) {
  return {
    id,
    entryId,
    position: 0,
    name,
    grams: 100,
    productId: null,
    micros: null,
    ...zeroNutrients(),
    calories: kcal,
    entry: { timestamp: NOW, createdAt: NOW, source: 'text' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(applySavedFoodToPast).mockClear();
});

describe('FoodMergesService.suggestions', () => {
  it('loads the last 120 days of own weighed items and every saved food', async () => {
    const { prisma, service } = setup();
    prisma.entryItem.findMany.mockResolvedValue([
      itemRow('i1', 'e1', 'Heinz tomato ketchup', 103),
      itemRow('i2', 'e2', 'Tomato ketchup', 118),
      itemRow('i3', 'e3', 'Ketchup', 120, { productId: FOOD_ID }),
    ]);
    prisma.product.findMany.mockResolvedValue([product()]);

    const response = await service.suggestions(USER_ID, NOW);

    expect(prisma.entryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          grams: { gt: 0 },
          entry: {
            userId: USER_ID,
            timestamp: { gte: new Date('2026-06-02T10:00:00.000Z') },
          },
        },
      }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        orderBy: PRODUCT_ORDER,
      }),
    );
    expect(response.suggestions).toHaveLength(1);
    expect(response.suggestions[0]?.variants[0]).toMatchObject({
      name: 'Heinz Tomato Ketchup',
      productId: FOOD_ID,
      valueSource: 'saved',
      recommended: true,
    });
  });

  it('marks values from label and barcode entries and skips dismissed groups', async () => {
    const { prisma, service } = setup();
    prisma.entryItem.findMany.mockResolvedValue([
      itemRow('i1', 'e1', 'Greek yogurt', 97, {
        entry: { timestamp: NOW, createdAt: NOW, source: 'nutrition_label' },
      }),
      itemRow('i2', 'e2', 'Yogurt', 61),
      itemRow('i3', 'e3', 'Mayo', 680),
      itemRow('i4', 'e4', 'Heinz mayo', 600),
    ]);

    const response = await service.suggestions(USER_ID, NOW);

    expect(response.suggestions.map(({ key }) => key)).toEqual(['yogurt']);
    expect(response.suggestions[0]?.variants[0]).toMatchObject({
      name: 'Greek yogurt',
      valueSource: 'label',
    });
  });
  it('suggests variants with the micros of their latest item', async () => {
    const { prisma, service } = setup();
    prisma.entryItem.findMany.mockResolvedValue([
      itemRow('i1', 'e1', 'Heinz tomato ketchup', 103, {
        grams: 20,
        micros: { potassium: 56, vitaminA: 4 },
      }),
      itemRow('i2', 'e2', 'Tomato ketchup', 118),
    ]);

    const response = await service.suggestions(USER_ID, NOW);

    expect(
      response.suggestions[0]?.variants.map(({ name, microsPer100 }) => [
        name,
        microsPer100,
      ]),
    ).toEqual([
      ['Heinz tomato ketchup', { potassium: 280, vitaminA: 20 }],
      ['Tomato ketchup', null],
    ]);
  });
});

describe('FoodMergesService.suggestions after merges', () => {
  it('leaves out items the user already decided about', async () => {
    const { prisma, service } = setup();
    const decision: FoodMergeDecision = {
      names: ['heinz tomato ketchup', 'tomato ketchup'],
      keptApart: [],
      productId: FOOD_ID,
      at: NOW.toISOString(),
    };
    prisma.profile.findUnique.mockResolvedValue({
      dismissedFoodMerges: [],
      foodMergeDecisions: [decision],
    });
    const later = new Date(NOW.getTime() + 60_000);
    const rows = [
      itemRow('i1', 'e1', 'Heinz tomato ketchup', 103),
      itemRow('i2', 'e2', 'Tomato ketchup', 118),
    ];
    prisma.entryItem.findMany.mockResolvedValue(rows);

    await expect(service.suggestions(USER_ID, later)).resolves.toEqual({
      suggestions: [],
    });
    expect(prisma.profile.findUnique).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { dismissedFoodMerges: true, foodMergeDecisions: true },
    });

    prisma.entryItem.findMany.mockResolvedValue(
      rows.map((row) => ({
        ...row,
        entry: { ...row.entry, createdAt: later },
      })),
    );
    const response = await service.suggestions(USER_ID, later);
    expect(response.suggestions.map(({ key }) => key)).toEqual([
      'tomato ketchup',
    ]);
  });
});

describe('FoodMergesService.merge', () => {
  it('creates a manual saved food named after the choice with the other names as aliases', async () => {
    const { prisma, service } = setup();

    const response = await service.merge(USER_ID, mergeDto());

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        name: 'Heinz tomato ketchup',
        brand: null,
        basisUnit: 'g',
        ...PER_100,
        microsPer100: Prisma.DbNull,
        userId: USER_ID,
        barcode: null,
        aliases: ['Tomato ketchup'],
        source: 'manual',
        missingNutrients: [],
      },
    });
    expect(applySavedFoodToPast).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      food: { id: 'new-food', itemCount: 3 },
      updatedItems: 0,
      updatedEntries: 0,
      updatedFavorites: 0,
    });
  });

  it('stores the chosen micros on a new saved food', async () => {
    const { prisma, service } = setup();

    await service.merge(
      USER_ID,
      mergeDto({ microsPer100: { potassium: 281, vitaminA: 21 } }),
    );

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        microsPer100: { potassium: 281, vitaminA: 21 },
      }),
    });
  });

  it('replaces the micros of an existing saved food only when they are sent', async () => {
    const { prisma, service } = setup();

    await service.merge(
      USER_ID,
      mergeDto({ productId: FOOD_ID, microsPer100: { potassium: 281 } }),
    );
    await service.merge(USER_ID, mergeDto({ productId: FOOD_ID }));

    expect(prisma.product.update).toHaveBeenNthCalledWith(1, {
      where: { id: FOOD_ID },
      data: expect.objectContaining({ microsPer100: { potassium: 281 } }),
    });
    expect(prisma.product.update.mock.calls[1]?.[0].data).not.toHaveProperty(
      'microsPer100',
    );
  });

  it('updates an own saved food, keeps its brand and adds the merged names', async () => {
    const { prisma, service } = setup();

    await service.merge(
      USER_ID,
      mergeDto({
        productId: FOOD_ID,
        names: ['Ketchup packet', 'Heinz tomato ketchup'],
        name: 'Tomato ketchup',
      }),
    );

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: FOOD_ID, userId: USER_ID },
    });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: FOOD_ID },
      data: {
        name: 'Tomato ketchup',
        brand: 'Heinz',
        basisUnit: 'g',
        ...PER_100,
        aliases: ['Ketchup packet', 'Catsup'],
        missingNutrients: ['fiber'],
      },
    });
  });

  it('removes kept-apart names from the aliases of the saved food', async () => {
    const { prisma, service } = setup();
    prisma.product.findFirst.mockResolvedValue(
      product({ aliases: ['Catsup', 'Tomato ketchup', 'Ketchup packet'] }),
    );
    prisma.$queryRaw.mockResolvedValue([{ foodMergeDecisions: [] }]);

    await service.merge(
      USER_ID,
      mergeDto({
        productId: FOOD_ID,
        names: ['Heinz tomato ketchup'],
        keptApart: ['Tomato ketchup'],
        applyToPast: true,
      }),
      NOW,
    );

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: FOOD_ID },
      data: expect.objectContaining({
        aliases: ['Catsup', 'Ketchup packet'],
      }) as object,
    });
    expect(applySavedFoodToPast).toHaveBeenCalledWith(
      prisma,
      USER_ID,
      expect.objectContaining({ aliases: ['Catsup', 'Ketchup packet'] }),
      { matchNames: true },
    );
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: {
        foodMergeDecisions: [
          expect.objectContaining({ keptApart: ['tomato ketchup'] }),
        ],
      },
    });
  });

  it('applies the values to past items when asked and reports the counts', async () => {
    const { prisma, service } = setup();

    const response = await service.merge(
      USER_ID,
      mergeDto({ productId: FOOD_ID, applyToPast: true, brand: '' }),
    );

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ brand: null }),
      }),
    );
    expect(applySavedFoodToPast).toHaveBeenCalledWith(
      prisma,
      USER_ID,
      expect.objectContaining({ id: FOOD_ID }),
      { matchNames: true },
    );
    expect(response).toMatchObject({
      updatedItems: 3,
      updatedEntries: 2,
      updatedFavorites: 1,
    });
  });

  it('remembers the merged and kept-apart names with the server time', async () => {
    const { prisma, service } = setup();
    prisma.$queryRaw.mockResolvedValue([{ foodMergeDecisions: [] }]);

    await service.merge(
      USER_ID,
      mergeDto({ keptApart: ['Ketchup packet', 'Tomato ketchup'] }),
      NOW,
    );

    expect(prisma.profile.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID }],
      skipDuplicates: true,
    });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: {
        foodMergeDecisions: [
          {
            names: ['heinz tomato ketchup', 'tomato ketchup'],
            keptApart: ['ketchup packet'],
            productId: 'new-food',
            at: NOW.toISOString(),
          },
        ],
      },
    });
  });

  it('adds the saved food names to the decision and keeps the newest decisions', async () => {
    const { prisma, service } = setup();
    const old = Array.from({ length: FOOD_MERGE_DECISIONS_MAX }, (_, i) => ({
      names: [`food ${i}`],
      keptApart: [],
      productId: null,
      at: NOW.toISOString(),
    }));
    prisma.$queryRaw.mockResolvedValue([{ foodMergeDecisions: old }]);

    await service.merge(
      USER_ID,
      mergeDto({ productId: FOOD_ID, names: ['Ketchup'], name: 'Ketchup' }),
      NOW,
    );

    const [call] = prisma.profile.update.mock.calls as [
      { data: { foodMergeDecisions: FoodMergeDecision[] } },
    ][];
    const stored = call?.[0].data.foodMergeDecisions ?? [];
    expect(stored).toHaveLength(FOOD_MERGE_DECISIONS_MAX);
    expect(stored[0]?.names).toEqual(['food 1']);
    expect(stored.at(-1)).toEqual({
      names: ['ketchup', 'heinz ketchup', 'tomato ketchup'],
      keptApart: [],
      productId: FOOD_ID,
      at: NOW.toISOString(),
    });
  });

  it('returns 404 for saved foods of someone else', async () => {
    const { prisma, service } = setup();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.merge(USER_ID, mergeDto({ productId: FOOD_ID })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});

describe('FoodMergesService.dismiss', () => {
  it('remembers the normalized key once', async () => {
    const { prisma, service } = setup();

    await service.dismiss(USER_ID, 'Tomato Ketchups');

    expect(prisma.profile.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID }],
      skipDuplicates: true,
    });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { dismissedFoodMerges: { set: ['mayo', 'tomato ketchup'] } },
    });

    prisma.profile.update.mockClear();
    await service.dismiss(USER_ID, 'Mayonnaise');
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('rejects keys without words', async () => {
    const { service } = setup();

    await expect(service.dismiss(USER_ID, '!!')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('dismissed keys', () => {
  it('normalizes keys and keeps the newest ones', () => {
    expect(dismissedKey('Mayonnaise, regular')).toBe('mayo');
    expect(withDismissedKey(['mayo'], 'mayo')).toEqual(['mayo']);
    const full = Array.from(
      { length: DISMISSED_FOOD_MERGES_MAX },
      (_, i) => `food ${i}`,
    );
    const next = withDismissedKey(full, 'ketchup');
    expect(next).toHaveLength(DISMISSED_FOOD_MERGES_MAX);
    expect(next.at(-1)).toBe('ketchup');
    expect(next[0]).toBe('food 1');
  });
});
