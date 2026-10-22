import { zeroNutrients } from '@food/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntryWithRelations } from '../common/mappers.js';
import type { Favorite, Prisma } from '../generated/prisma/client.js';
import type { PhotosService } from '../photos/photos.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FAVORITE_ORDER, FavoritesService } from './favorites.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const FAVORITE_ID = '019a0000-0000-7000-8000-0000000000c1';
const ENTRY_ID = '019a0000-0000-7000-8000-0000000000e1';
const PHOTO_ID = '019a0000-0000-7000-8000-0000000000f1';
const NOW = new Date('2026-09-28T08:00:00.000Z');

function favoriteRow(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: FAVORITE_ID,
    userId: USER_ID,
    name: 'Overnight oats',
    mealType: 'breakfast',
    items: [
      {
        name: 'Oats',
        grams: 60,
        nutrients: { ...zeroNutrients(), calories: 226, protein: 8 },
        confidence: 'high',
      },
      {
        name: 'Milk',
        grams: 150,
        nutrients: { ...zeroNutrients(), calories: 96, protein: 5.2 },
        confidence: null,
        micros: { calcium: 180, vitaminD: 1.7 },
        fluidMl: 150,
      },
    ],
    photoId: PHOTO_ID,
    ...zeroNutrients(),
    calories: 322,
    protein: 13.2,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    useCount: 3,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function entryRow(): EntryWithRelations {
  return {
    id: ENTRY_ID,
    userId: USER_ID,
    name: 'Overnight oats ×1.5',
    description: null,
    mealType: 'breakfast',
    source: 'favorite',
    timestamp: NOW,
    localDate: '2026-09-28',
    photoId: PHOTO_ID,
    analysisId: null,
    favoriteId: FAVORITE_ID,
    rawAiJson: null,
    productId: null,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    ...zeroNutrients(),
    createdAt: NOW,
    updatedAt: NOW,
    items: [],
    photo: null,
    photos: [],
  };
}

function setup() {
  const prisma = {
    favorite: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    entry: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  prisma.favorite.create.mockImplementation(() =>
    Promise.resolve({ ...favoriteRow(), photo: null }),
  );
  prisma.favorite.update.mockImplementation(() =>
    Promise.resolve({ ...favoriteRow(), photo: null }),
  );
  prisma.entry.create.mockImplementation(() => Promise.resolve(entryRow()));
  const photos = {
    findOwned: vi.fn((_userId: string, id: string) => Promise.resolve({ id })),
    deleteIfUnreferenced: vi.fn(() => Promise.resolve(true)),
  };
  const service = new FavoritesService(
    prisma as unknown as PrismaService,
    photos as unknown as PhotosService,
  );
  return { prisma, photos, service };
}

describe('FavoritesService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists favorites by use count, recency (never used last) and name', async () => {
    const { prisma, service } = setup();
    prisma.favorite.findMany.mockResolvedValue([]);

    await service.list(USER_ID);

    expect(prisma.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        orderBy: FAVORITE_ORDER,
      }),
    );
    expect(FAVORITE_ORDER.slice(0, 3)).toEqual([
      { useCount: 'desc' },
      { lastUsedAt: { sort: 'desc', nulls: 'last' } },
      { name: 'asc' },
    ]);
  });

  describe('log', () => {
    it('creates a scaled entry and bumps usage in one transaction', async () => {
      const { prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue(favoriteRow());

      await service.log(USER_ID, FAVORITE_ID, {
        timestamp: '2026-09-28T07:45:00.000Z',
        localDate: '2026-09-28',
        mealType: 'snack',
        servings: 1.5,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.favorite.update).toHaveBeenCalledWith({
        where: { id: FAVORITE_ID },
        data: { useCount: { increment: 1 }, lastUsedAt: NOW },
      });
      const [args] = prisma.entry.create.mock.calls[0] as [
        { data: Prisma.EntryUncheckedCreateInput },
      ];
      expect(args.data).toMatchObject({
        userId: USER_ID,
        name: 'Overnight oats ×1.5',
        description: null,
        mealType: 'snack',
        source: 'favorite',
        favoriteId: FAVORITE_ID,
        photoId: PHOTO_ID,
        analysisId: null,
        localDate: '2026-09-28',
        calories: 483,
        protein: 19.8,
        photos: {
          createMany: {
            data: [{ photoId: PHOTO_ID, role: 'food', position: 0 }],
          },
        },
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                position: 0,
                name: 'Oats',
                grams: 90,
                calories: 339,
                protein: 12,
              }),
              expect.objectContaining({
                position: 1,
                name: 'Milk',
                grams: 225,
                calories: 144,
                protein: 7.8,
                micros: { calcium: 270, vitaminD: 2.6 },
                fluidMl: 225,
              }),
            ],
          },
        },
      });
    });

    it('defaults to one serving with the plain favorite name', async () => {
      const { prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue(favoriteRow());

      await service.log(USER_ID, FAVORITE_ID, {
        timestamp: '2026-09-28T07:45:00.000Z',
        localDate: '2026-09-28',
        mealType: 'breakfast',
      });

      const [args] = prisma.entry.create.mock.calls[0] as [
        { data: Prisma.EntryUncheckedCreateInput },
      ];
      expect(args.data).toMatchObject({
        name: 'Overnight oats',
        calories: 322,
        protein: 13.2,
      });
    });

    it('scales the portion and item counts with the servings and keeps the name', async () => {
      const { prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue(
        favoriteRow({
          name: 'Black Angus burgers',
          portionCount: 2,
          portionUnit: 'burger',
          portionUnitPlural: 'burgers',
          items: [
            {
              name: 'Black Angus patties',
              grams: 300,
              nutrients: { ...zeroNutrients(), calories: 810 },
              confidence: 'medium',
              count: 2,
              unit: 'patty',
              unitPlural: 'patties',
            },
            {
              name: 'Burger sauce',
              grams: 30,
              nutrients: { ...zeroNutrients(), calories: 120 },
              confidence: 'low',
            },
          ],
        }),
      );

      await service.log(USER_ID, FAVORITE_ID, {
        timestamp: '2026-09-28T07:45:00.000Z',
        localDate: '2026-09-28',
        mealType: 'dinner',
        servings: 0.75,
      });

      const [args] = prisma.entry.create.mock.calls[0] as [
        { data: Prisma.EntryUncheckedCreateInput },
      ];
      expect(args.data).toMatchObject({
        name: 'Black Angus burgers',
        portionCount: 1.5,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                grams: 225,
                count: 1.5,
                unit: 'patty',
                unitPlural: 'patties',
              }),
              expect.objectContaining({ grams: 22.5, count: null }),
            ],
          },
        },
      });
    });

    it('rejects servings that push an item beyond the limits without side effects', async () => {
      const { prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue(
        favoriteRow({
          items: [
            {
              name: 'Water',
              grams: 6000,
              nutrients: zeroNutrients(),
              confidence: null,
            },
          ],
        }),
      );

      await expect(
        service.log(USER_ID, FAVORITE_ID, {
          timestamp: '2026-09-28T07:45:00.000Z',
          localDate: '2026-09-28',
          mealType: 'snack',
          servings: 2,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.favorite.update).not.toHaveBeenCalled();
      expect(prisma.entry.create).not.toHaveBeenCalled();
    });

    it('returns 404 for favorites of other users', async () => {
      const { prisma, service } = setup();
      prisma.favorite.findFirst.mockResolvedValue(null);

      await expect(
        service.log(USER_ID, FAVORITE_ID, {
          timestamp: '2026-09-28T07:45:00.000Z',
          localDate: '2026-09-28',
          mealType: 'snack',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.favorite.findFirst).toHaveBeenCalledWith({
        where: { id: FAVORITE_ID, userId: USER_ID },
      });
    });
  });

  it('creates a favorite from an entry with its name, items and photo but no pinned meal type', async () => {
    const { prisma, service } = setup();
    prisma.entry.findFirst.mockResolvedValue({
      ...entryRow(),
      name: 'Chicken bowl',
      mealType: 'dinner',
      items: [
        {
          id: 'item-1',
          entryId: ENTRY_ID,
          position: 0,
          name: 'Chicken',
          grams: 150,
          count: null,
          unit: null,
          unitPlural: null,
          confidence: 'high',
          productId: null,
          micros: { vitaminB6: 0.9, potassium: 384 },
          fluidMl: null,
          ...zeroNutrients(),
          calories: 248,
          protein: 46.5,
        },
      ],
    });

    await service.createFromEntry(USER_ID, ENTRY_ID, {});

    const [args] = prisma.favorite.create.mock.calls[0] as [
      { data: Prisma.FavoriteUncheckedCreateInput },
    ];
    expect(args.data).toMatchObject({
      userId: USER_ID,
      name: 'Chicken bowl',
      mealType: null,
      photoId: PHOTO_ID,
      calories: 248,
      protein: 46.5,
      items: [
        {
          name: 'Chicken',
          grams: 150,
          confidence: 'high',
          nutrients: { ...zeroNutrients(), calories: 248, protein: 46.5 },
          micros: { vitaminB6: 0.9, potassium: 384 },
          fluidMl: null,
        },
      ],
    });
  });

  it('copies the entry portion and item counts into a new favorite', async () => {
    const { prisma, service } = setup();
    prisma.entry.findFirst.mockResolvedValue({
      ...entryRow(),
      name: 'Eggs',
      portionCount: 3,
      portionUnit: 'egg',
      portionUnitPlural: 'eggs',
      items: [
        {
          id: 'item-1',
          entryId: ENTRY_ID,
          position: 0,
          name: 'Eggs, boiled',
          grams: 150,
          count: 3,
          unit: 'egg',
          unitPlural: 'eggs',
          confidence: 'high',
          ...zeroNutrients(),
          calories: 233,
        },
      ],
    });

    await service.createFromEntry(USER_ID, ENTRY_ID, {});

    const [args] = prisma.favorite.create.mock.calls[0] as [
      { data: Prisma.FavoriteUncheckedCreateInput },
    ];
    expect(args.data).toMatchObject({
      portionCount: 3,
      portionUnit: 'egg',
      portionUnitPlural: 'eggs',
      items: [
        expect.objectContaining({ count: 3, unit: 'egg', unitPlural: 'eggs' }),
      ],
    });
  });

  it('stores a portion on create and keeps it on updates that leave it out', async () => {
    const { prisma, service } = setup();
    prisma.favorite.findFirst.mockResolvedValue(favoriteRow());
    const items = [
      {
        name: 'Bar',
        grams: 40,
        nutrients: { ...zeroNutrients(), calories: 180 },
      },
    ];

    await service.create(USER_ID, {
      name: 'Protein bar',
      items,
      portion: { count: 1, unit: 'bar', unitPlural: 'bars' },
    });
    await service.update(USER_ID, FAVORITE_ID, {
      name: 'Protein bar',
      mealType: null,
      items,
    });
    await service.update(USER_ID, FAVORITE_ID, {
      name: 'Protein bar',
      mealType: null,
      items,
      portion: null,
    });

    const [createArgs] = prisma.favorite.create.mock.calls[0] as [
      { data: Prisma.FavoriteUncheckedCreateInput },
    ];
    const [[keep], [clear]] = prisma.favorite.update.mock.calls as [
      { data: Prisma.FavoriteUncheckedUpdateInput },
    ][];
    expect(createArgs.data).toMatchObject({
      portionCount: 1,
      portionUnit: 'bar',
      portionUnitPlural: 'bars',
    });
    expect(keep?.data).not.toHaveProperty('portionCount');
    expect(clear?.data).toMatchObject({
      portionCount: null,
      portionUnit: null,
      portionUnitPlural: null,
    });
  });

  it('deletes a favorite and then releases its photo', async () => {
    const { prisma, photos, service } = setup();
    prisma.favorite.findFirst.mockResolvedValue(favoriteRow());

    await service.remove(USER_ID, FAVORITE_ID);

    expect(prisma.favorite.delete).toHaveBeenCalledWith({
      where: { id: FAVORITE_ID },
    });
    expect(photos.deleteIfUnreferenced).toHaveBeenCalledWith(PHOTO_ID);
  });
});
