import { zeroNutrients } from '@food/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntryWithRelations } from '../common/mappers.js';
import type { FavoritesService } from '../favorites/favorites.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProductLogService } from '../products/product-log.service.js';
import type { QuickLogDto } from './foods.dto.js';
import { QuickLogService } from './quick-log.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const ENTRY_ID = '019a0000-0000-7000-8000-0000000000e1';
const ITEM_ID = '019a0000-0000-7000-8000-0000000000a1';
const FAVORITE_ID = '019a0000-0000-7000-8000-0000000000c1';
const PHOTO_ID = '019a0000-0000-7000-8000-0000000000f1';
const LABEL_PHOTO_ID = '019a0000-0000-7000-8000-0000000000f2';
const PRODUCT_ID = '019a0000-0000-7000-8000-0000000000d1';
const NOW = new Date('2026-09-28T08:00:00.000Z');
const RAW_AI = { id: 'resp_mock' };

function itemRow(overrides: Partial<EntryWithRelations['items'][number]> = {}) {
  return {
    id: ITEM_ID,
    entryId: ENTRY_ID,
    position: 0,
    name: 'Khoury strawberry yogurt',
    grams: 170,
    count: null as number | null,
    unit: null as string | null,
    unitPlural: null as string | null,
    confidence: 'high' as const,
    ...zeroNutrients(),
    calories: 150,
    protein: 6.8,
    ...overrides,
  };
}

function sourceEntry(
  items = [
    itemRow(),
    itemRow({
      id: 'item-2',
      position: 1,
      name: 'Granola',
      grams: 40,
      confidence: null,
      calories: 180,
      protein: 4,
    }),
  ],
) {
  return {
    id: ENTRY_ID,
    userId: USER_ID,
    name: 'Breakfast bowl',
    description: 'Weekday bowl',
    mealType: 'breakfast' as const,
    source: 'food_photo' as const,
    timestamp: NOW,
    localDate: '2026-09-27',
    photoId: PHOTO_ID,
    analysisId: '019a0000-0000-7000-8000-0000000000b1',
    favoriteId: FAVORITE_ID,
    productId: null,
    rawAiJson: RAW_AI,
    portionCount: null as number | null,
    portionUnit: null as string | null,
    portionUnitPlural: null as string | null,
    ...zeroNutrients(),
    createdAt: NOW,
    updatedAt: NOW,
    items,
    photos: [
      { photoId: LABEL_PHOTO_ID, role: 'label', position: 1 },
      { photoId: PHOTO_ID, role: 'food', position: 0 },
    ],
  };
}

function createdEntry(): EntryWithRelations {
  return { ...sourceEntry(), items: [], photo: null, photos: [] };
}

function body(overrides: Partial<QuickLogDto> = {}): QuickLogDto {
  return {
    key: `meal:${ENTRY_ID}`,
    timestamp: '2026-09-28T10:15:00.000+03:00',
    localDate: '2026-09-28',
    mealType: 'snack',
    ...overrides,
  };
}

function setup() {
  const prisma = {
    entry: { findFirst: vi.fn(), create: vi.fn() },
    entryItem: { findFirst: vi.fn() },
    favorite: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  prisma.entry.create.mockResolvedValue(createdEntry());
  const favorites = { log: vi.fn().mockResolvedValue({ id: 'logged' }) };
  const products = { log: vi.fn().mockResolvedValue({ id: 'product-entry' }) };
  const service = new QuickLogService(
    prisma as unknown as PrismaService,
    favorites as unknown as FavoritesService,
    products as unknown as ProductLogService,
  );
  return { prisma, favorites, products, service };
}

function createdData(prisma: ReturnType<typeof setup>['prisma']) {
  const [args] = prisma.entry.create.mock.calls[0] as [
    { data: Prisma.EntryUncheckedCreateInput },
  ];
  return args.data;
}

describe('QuickLogService', () => {
  describe('meals', () => {
    it('copies the source entry with scaled items in a transaction', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(sourceEntry());

      await service.log(USER_ID, body({ servings: 1.5 }));

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.entry.findFirst).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, userId: USER_ID },
        include: {
          items: { orderBy: { position: 'asc' } },
          photos: { select: { photoId: true, role: true, position: true } },
        },
      });
      expect(createdData(prisma)).toMatchObject({
        userId: USER_ID,
        name: 'Breakfast bowl',
        description: 'Weekday bowl',
        mealType: 'snack',
        source: 'copy',
        timestamp: new Date('2026-09-28T07:15:00.000Z'),
        localDate: '2026-09-28',
        photoId: PHOTO_ID,
        analysisId: null,
        favoriteId: FAVORITE_ID,
        rawAiJson: RAW_AI,
        calories: 495,
        protein: 16.2,
        photos: {
          createMany: {
            data: [
              { photoId: PHOTO_ID, role: 'food', position: 0 },
              { photoId: LABEL_PHOTO_ID, role: 'label', position: 1 },
            ],
          },
        },
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                position: 0,
                name: 'Khoury strawberry yogurt',
                grams: 255,
                calories: 225,
                protein: 10.2,
              }),
              expect.objectContaining({
                position: 1,
                name: 'Granola',
                grams: 60,
                calories: 270,
                protein: 6,
              }),
            ],
          },
        },
      });
    });

    it('rejects grams for meals with several items before writing', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(sourceEntry());

      await expect(
        service.log(USER_ID, body({ grams: 100 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.entry.create).not.toHaveBeenCalled();
    });

    it('scales a single-item meal to the requested grams', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(sourceEntry([itemRow()]));

      await service.log(USER_ID, body({ grams: 85 }));

      expect(createdData(prisma)).toMatchObject({
        calories: 75,
        protein: 3.4,
        items: {
          createMany: {
            data: [expect.objectContaining({ grams: 85, calories: 75 })],
          },
        },
      });
    });

    it('logs a number of units of a meal with a portion', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue({
        ...sourceEntry([
          itemRow({
            name: 'Black Angus patties',
            grams: 300,
            count: 2,
            unit: 'patty',
            unitPlural: 'patties',
            calories: 810,
            protein: 72,
          }),
          itemRow({
            id: 'item-2',
            position: 1,
            name: 'Brioche buns',
            grams: 140,
            count: 2,
            unit: 'bun',
            unitPlural: 'buns',
            calories: 460,
            protein: 14,
          }),
        ]),
        name: 'Black Angus burgers',
        portionCount: 2,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
      });

      await service.log(USER_ID, body({ portionCount: 1.5 }));

      expect(createdData(prisma)).toMatchObject({
        name: 'Black Angus burgers',
        portionCount: 1.5,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
        calories: 953,
        protein: 64.5,
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                grams: 225,
                count: 1.5,
                unit: 'patty',
                calories: 608,
              }),
              expect.objectContaining({
                grams: 105,
                count: 1.5,
                unit: 'bun',
                calories: 345,
              }),
            ],
          },
        },
      });
    });

    it('scales the portion with servings too', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue({
        ...sourceEntry(),
        portionCount: 2,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
      });

      await service.log(USER_ID, body({ servings: 0.5 }));

      expect(createdData(prisma)).toMatchObject({
        portionCount: 1,
        portionUnit: 'burger',
      });
    });

    it('rejects a portion count for meals logged without a portion', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(sourceEntry());

      await expect(
        service.log(USER_ID, body({ portionCount: 1 })),
      ).rejects.toThrow(/portionCount needs a food logged as a count/);
      expect(prisma.entry.create).not.toHaveBeenCalled();
    });

    it('rejects a portion count combined with servings or grams before reading', async () => {
      const { prisma, service } = setup();

      await expect(
        service.log(USER_ID, body({ portionCount: 1, servings: 2 })),
      ).rejects.toThrow(/cannot be combined/);
      await expect(
        service.log(USER_ID, body({ portionCount: 1, grams: 100 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.entry.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown or foreign meals', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(null);

      await expect(service.log(USER_ID, body())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.entry.create).not.toHaveBeenCalled();
    });
  });

  describe('foods', () => {
    it('creates a one-item entry named after the item with the parent photo', async () => {
      const { prisma, service } = setup();
      prisma.entryItem.findFirst.mockResolvedValue({
        ...itemRow(),
        entry: {
          source: 'food_photo',
          photoId: PHOTO_ID,
          photos: sourceEntry().photos,
        },
      });

      await service.log(
        USER_ID,
        body({ key: `food:${ITEM_ID.toUpperCase()}`, grams: 340 }),
      );

      expect(prisma.entryItem.findFirst).toHaveBeenCalledWith({
        where: { id: ITEM_ID, entry: { userId: USER_ID } },
        include: {
          entry: {
            select: {
              source: true,
              photoId: true,
              photos: {
                select: { photoId: true, role: true, position: true },
              },
            },
          },
        },
      });
      expect(createdData(prisma)).toMatchObject({
        name: 'Khoury strawberry yogurt',
        description: null,
        source: 'copy',
        photoId: PHOTO_ID,
        photos: {
          createMany: {
            data: [{ photoId: PHOTO_ID, role: 'food', position: 0 }],
          },
        },
        analysisId: null,
        favoriteId: null,
        calories: 300,
        protein: 13.6,
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                position: 0,
                name: 'Khoury strawberry yogurt',
                grams: 340,
                confidence: 'high',
              }),
            ],
          },
        },
      });
    });

    it('logs a counted food by units and gives the new entry that portion', async () => {
      const { prisma, service } = setup();
      prisma.entryItem.findFirst.mockResolvedValue({
        ...itemRow({
          name: 'Eggs, boiled',
          grams: 100,
          count: 2,
          unit: 'egg',
          unitPlural: 'eggs',
          calories: 155,
        }),
        entry: { source: 'food_photo', photoId: null, photos: [] },
      });

      await service.log(
        USER_ID,
        body({ key: `food:${ITEM_ID}`, portionCount: 3 }),
      );

      expect(createdData(prisma)).toMatchObject({
        name: 'Eggs, boiled',
        portionCount: 3,
        portionUnit: 'egg',
        portionUnitPlural: 'eggs',
        calories: 233,
        items: {
          createMany: {
            data: [
              expect.objectContaining({ grams: 150, count: 3, unit: 'egg' }),
            ],
          },
        },
      });
    });

    it('scales the item count when a food is logged by grams', async () => {
      const { prisma, service } = setup();
      prisma.entryItem.findFirst.mockResolvedValue({
        ...itemRow({ grams: 100, count: 2, unit: 'egg', unitPlural: 'eggs' }),
        entry: { source: 'food_photo', photoId: null, photos: [] },
      });

      await service.log(USER_ID, body({ key: `food:${ITEM_ID}`, grams: 25 }));

      expect(createdData(prisma)).toMatchObject({
        portionCount: 0.5,
        items: {
          createMany: {
            data: [expect.objectContaining({ grams: 25, count: 0.5 })],
          },
        },
      });
    });

    it('returns 404 for unknown or foreign foods', async () => {
      const { prisma, service } = setup();
      prisma.entryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.log(USER_ID, body({ key: `food:${ITEM_ID}` })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('favorites', () => {
    it('delegates to the favorite log with the servings', async () => {
      const { favorites, prisma, service } = setup();

      await service.log(
        USER_ID,
        body({ key: `favorite:${FAVORITE_ID}`, servings: 2 }),
      );

      expect(favorites.log).toHaveBeenCalledWith(USER_ID, FAVORITE_ID, {
        timestamp: '2026-09-28T10:15:00.000+03:00',
        localDate: '2026-09-28',
        mealType: 'snack',
        servings: 2,
      });
      expect(prisma.favorite.findFirst).not.toHaveBeenCalled();
    });

    it('converts grams to servings for single-item favorites', async () => {
      const { favorites, prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue({
        items: [
          {
            name: 'Skyr',
            grams: 150,
            nutrients: { ...zeroNutrients(), calories: 95 },
            confidence: 'high',
          },
        ],
      });

      await service.log(
        USER_ID,
        body({ key: `favorite:${FAVORITE_ID}`, grams: 225, servings: 4 }),
      );

      expect(prisma.favorite.findFirst).toHaveBeenCalledWith({
        where: { id: FAVORITE_ID, userId: USER_ID },
        select: {
          items: true,
          portionCount: true,
          portionUnit: true,
          portionUnitPlural: true,
        },
      });
      expect(favorites.log).toHaveBeenCalledWith(
        USER_ID,
        FAVORITE_ID,
        expect.objectContaining({ servings: 1.5 }),
      );
    });

    it('converts a portion count to servings of the favorite portion', async () => {
      const { favorites, prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue({
        items: [],
        portionCount: 2,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
      });

      await service.log(
        USER_ID,
        body({ key: `favorite:${FAVORITE_ID}`, portionCount: 1.5 }),
      );

      expect(favorites.log).toHaveBeenCalledWith(
        USER_ID,
        FAVORITE_ID,
        expect.objectContaining({ servings: 0.75 }),
      );
    });

    it('rejects a portion count for favorites without a portion', async () => {
      const { favorites, prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue({
        items: [],
        portionCount: null,
        portionUnit: null,
        portionUnitPlural: null,
      });

      await expect(
        service.log(
          USER_ID,
          body({ key: `favorite:${FAVORITE_ID}`, portionCount: 2 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(favorites.log).not.toHaveBeenCalled();
    });

    it('rejects grams that would push a favorite beyond the item limits', async () => {
      const { favorites, prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue({
        items: [
          {
            name: 'Salt',
            grams: 1,
            nutrients: { ...zeroNutrients(), sodium: 400 },
            confidence: 'high',
          },
        ],
      });

      await expect(
        service.log(
          USER_ID,
          body({ key: `favorite:${FAVORITE_ID}`, grams: 1000 }),
        ),
      ).rejects.toThrow(/amount is too large/);
      expect(favorites.log).not.toHaveBeenCalled();
    });

    it('returns 404 when grams are sent for an unknown favorite', async () => {
      const { favorites, prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue(null);

      await expect(
        service.log(
          USER_ID,
          body({ key: `favorite:${FAVORITE_ID}`, grams: 100 }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(favorites.log).not.toHaveBeenCalled();
    });
  });

  describe('products', () => {
    it('logs one serving by default through the product log', async () => {
      const { prisma, products, service } = setup();

      await expect(
        service.log(USER_ID, body({ key: `product:${PRODUCT_ID}` })),
      ).resolves.toEqual({ id: 'product-entry' });

      expect(products.log).toHaveBeenCalledWith(USER_ID, PRODUCT_ID, {
        amount: { servings: 1 },
        timestamp: '2026-09-28T10:15:00.000+03:00',
        localDate: '2026-09-28',
        mealType: 'snack',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('passes servings through', async () => {
      const { products, service } = setup();

      await service.log(
        USER_ID,
        body({ key: `product:${PRODUCT_ID}`, servings: 2.5 }),
      );

      expect(products.log).toHaveBeenCalledWith(
        USER_ID,
        PRODUCT_ID,
        expect.objectContaining({ amount: { servings: 2.5 } }),
      );
    });

    it('lets grams override servings like other single-item foods', async () => {
      const { products, service } = setup();

      await service.log(
        USER_ID,
        body({
          key: `product:${PRODUCT_ID.toUpperCase()}`,
          grams: 250,
          servings: 3,
        }),
      );

      expect(products.log).toHaveBeenCalledWith(
        USER_ID,
        PRODUCT_ID,
        expect.objectContaining({ amount: { grams: 250 } }),
      );
    });

    it('rejects a portion count because products have no portion', async () => {
      const { products, service } = setup();

      await expect(
        service.log(
          USER_ID,
          body({ key: `product:${PRODUCT_ID}`, portionCount: 1 }),
        ),
      ).rejects.toThrow(/portionCount needs a food logged as a count/);
      expect(products.log).not.toHaveBeenCalled();
    });

    it('propagates a missing product as 404', async () => {
      const { products, service } = setup();
      products.log.mockRejectedValue(new NotFoundException());

      await expect(
        service.log(USER_ID, body({ key: `product:${PRODUCT_ID}` })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('rejects keys that bypassed validation', async () => {
    const { prisma, service } = setup();
    await expect(
      service.log(USER_ID, body({ key: 'meal:nope' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
