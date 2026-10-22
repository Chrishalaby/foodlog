import { zeroNutrients } from '@food/shared';
import type { FavoriteWithPhoto } from '../common/mappers.js';
import type { Product } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  favoriteCandidate,
  FoodLibraryRepository,
  productCandidate,
} from './food-library.repository.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const SINCE = new Date('2026-06-30T12:00:00.000Z');
const LAST_USED = new Date('2026-09-27T07:30:00.000Z');

function setup() {
  const prisma = {
    $queryRaw: vi.fn(),
    entry: { findMany: vi.fn().mockResolvedValue([]) },
    entryItem: { findMany: vi.fn().mockResolvedValue([]) },
    favorite: { findMany: vi.fn().mockResolvedValue([]) },
    product: { findMany: vi.fn().mockResolvedValue([]) },
    profile: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const repository = new FoodLibraryRepository(
    prisma as unknown as PrismaService,
  );
  return { prisma, repository };
}

function productRow(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    userId: USER_ID,
    barcode: '5281234567892',
    name: 'Almarai Laban',
    brand: 'ALMARAI',
    basisUnit: 'ml',
    ...zeroNutrients(),
    microsPer100: null,
    servingSizeG: 180,
    packSizeG: null,
    source: 'openfoodfacts',
    imageUrl: null,
    missingNutrients: [],
    aliases: [],
    unitName: null,
    unitGrams: null,
    useCount: 4,
    lastUsedAt: LAST_USED,
    createdAt: LAST_USED,
    updatedAt: LAST_USED,
    ...overrides,
  };
}

function favoriteRow(
  name: string,
  itemNames: readonly string[],
): FavoriteWithPhoto {
  return {
    id: 'v1',
    userId: USER_ID,
    name,
    mealType: null,
    items: itemNames.map((itemName) => ({
      name: itemName,
      grams: 150,
      nutrients: { ...zeroNutrients(), calories: 120 },
      confidence: null,
    })),
    photoId: null,
    ...zeroNutrients(),
    calories: 120 * itemNames.length,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    useCount: 2,
    lastUsedAt: LAST_USED,
    createdAt: LAST_USED,
    updatedAt: LAST_USED,
    photo: null,
  };
}

function queryValues(call: unknown[]): unknown[] {
  const [, ...values] = call;
  return values;
}

describe('FoodLibraryRepository', () => {
  it('loads only the favorites of the user with their photos', async () => {
    const { prisma, repository } = setup();

    await repository.favorites(USER_ID);

    expect(prisma.favorite.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      include: { photo: true },
    });
  });

  it('loads only the products of the user', async () => {
    const { prisma, repository } = setup();

    await repository.products(USER_ID);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
  });

  it('maps a favorite to a candidate whose detail is its single distinct item name', () => {
    expect(
      favoriteCandidate(
        favoriteRow('Strawberry Yogurt', ['Khoury strawberry yogurt']),
      ),
    ).toEqual({
      kind: 'favorite',
      id: 'v1',
      name: 'Strawberry Yogurt',
      detail: 'Khoury strawberry yogurt',
      useCount: 2,
      recentCount: 0,
      lastUsedAt: LAST_USED,
    });
  });

  it('gives favorites no detail for several items or an item named like the favorite', () => {
    expect(
      favoriteCandidate(favoriteRow('Breakfast', ['Granola', 'Milk'])).detail,
    ).toBeNull();
    expect(
      favoriteCandidate(favoriteRow('Oat clusters', ['  OAT  clusters ']))
        .detail,
    ).toBeNull();
    expect(favoriteCandidate(favoriteRow('Empty', [])).detail).toBeNull();
  });

  it('maps products to candidates named like their logged entries', () => {
    expect(productCandidate(SINCE)(productRow())).toEqual({
      kind: 'product',
      id: 'p1',
      name: 'Almarai Laban',
      detail: 'ALMARAI',
      aliases: [],
      useCount: 4,
      recentCount: 4,
      lastUsedAt: LAST_USED,
    });
    expect(
      productCandidate(SINCE)(productRow({ name: 'Laban', brand: 'Almarai' })),
    ).toMatchObject({ name: 'Almarai Laban', detail: 'Almarai' });
    expect(
      productCandidate(SINCE)(
        productRow({ aliases: ['Ayran', 'Laban drink'] }),
      ),
    ).toMatchObject({ aliases: ['Ayran', 'Laban drink'] });
  });

  it('counts product uses as recent only when last used in the window', () => {
    const old = new Date(SINCE.getTime() - 1);

    expect(
      productCandidate(SINCE)(productRow({ lastUsedAt: old })),
    ).toMatchObject({ useCount: 4, recentCount: 0, lastUsedAt: old });
    expect(
      productCandidate(SINCE)(
        productRow({ brand: null, useCount: 0, lastUsedAt: null }),
      ),
    ).toMatchObject({ detail: null, recentCount: 0, lastUsedAt: null });
  });

  it('aggregates meal usage for the user and maps rows to candidates', async () => {
    const { prisma, repository } = setup();
    prisma.$queryRaw.mockResolvedValue([
      {
        latestId: 'e1',
        name: 'Breakfast bowl',
        detail: null,
        useCount: 3,
        recentCount: 2,
        lastUsedAt: LAST_USED.toISOString(),
      },
    ]);

    const candidates = await repository.mealUsage(USER_ID, SINCE);

    expect(queryValues(prisma.$queryRaw.mock.calls[0] ?? [])).toEqual([
      SINCE,
      USER_ID,
    ]);
    expect(candidates).toEqual([
      {
        kind: 'meal',
        id: 'e1',
        name: 'Breakfast bowl',
        detail: null,
        useCount: 3,
        recentCount: 2,
        lastUsedAt: LAST_USED,
      },
    ]);
  });

  it('uses the single item of the latest meal as detail only when its name differs', async () => {
    const { prisma, repository } = setup();
    prisma.$queryRaw.mockResolvedValue([
      {
        latestId: 'e1',
        name: 'Strawberry yogurt cup',
        detail: 'Khoury strawberry yogurt',
        useCount: 1,
        recentCount: 1,
        lastUsedAt: LAST_USED,
      },
      {
        latestId: 'e2',
        name: 'Labneh',
        detail: '  LABNEH ',
        useCount: 2,
        recentCount: 2,
        lastUsedAt: LAST_USED,
      },
    ]);

    const candidates = await repository.mealUsage(USER_ID, SINCE);

    expect(candidates.map((c) => [c.id, c.detail])).toEqual([
      ['e1', 'Khoury strawberry yogurt'],
      ['e2', null],
    ]);
  });

  it('builds meal details from single-item entries and foods from multi-item entries only', async () => {
    const { prisma, repository } = setup();
    prisma.$queryRaw.mockResolvedValue([]);

    await repository.mealUsage(USER_ID, SINCE);
    await repository.foodUsage(USER_ID, SINCE);

    const [mealSql, foodSql] = prisma.$queryRaw.mock.calls.map((call) =>
      (call[0] as readonly string[]).join('?').replace(/\s+/g, ' '),
    );
    expect(mealSql).toContain('HAVING count(*) = 1');
    expect(foodSql).toContain(
      'sibling."entryId" = i."entryId" AND sibling."id" <> i."id"',
    );
  });

  it('aggregates food usage for the user with the latest meal as detail', async () => {
    const { prisma, repository } = setup();
    prisma.$queryRaw.mockResolvedValue([
      {
        latestId: 'i1',
        name: 'Granola',
        detail: 'Breakfast bowl',
        useCount: 5,
        recentCount: 0,
        lastUsedAt: LAST_USED,
      },
    ]);

    const [candidate] = await repository.foodUsage(USER_ID, SINCE);

    expect(queryValues(prisma.$queryRaw.mock.calls[0] ?? [])).toEqual([
      SINCE,
      USER_ID,
    ]);
    expect(candidate).toMatchObject({
      kind: 'food',
      id: 'i1',
      detail: 'Breakfast bowl',
      useCount: 5,
      recentCount: 0,
      lastUsedAt: LAST_USED,
      linkedProductId: null,
    });
  });

  it('marks foods whose items all use one saved food', async () => {
    const { prisma, repository } = setup();
    prisma.$queryRaw.mockResolvedValue([
      {
        latestId: 'i1',
        name: 'Heinz tomato ketchup',
        detail: 'Burger',
        useCount: 3,
        recentCount: 3,
        lastUsedAt: LAST_USED,
        productId: 'p1',
      },
    ]);

    const [candidate] = await repository.foodUsage(USER_ID, SINCE);
    const [sql] = prisma.$queryRaw.mock.calls.map((call) =>
      (call[0] as readonly string[]).join('?').replace(/\s+/g, ' '),
    );

    expect(candidate?.linkedProductId).toBe('p1');
    expect(sql).toContain('bool_and(i."productId" IS NOT NULL)');
    expect(sql).toContain('count(DISTINCT i."productId") = 1');
  });

  it('lists the saved foods only ever logged inside bigger meals', async () => {
    const { prisma, repository } = setup();
    prisma.$queryRaw.mockResolvedValue([{ productId: 'p1' }]);

    const ids = await repository.componentProductIds(USER_ID);
    const calls = prisma.$queryRaw.mock.calls;
    const [sql] = calls.map((call) =>
      (call[0] as readonly string[]).join('?').replace(/\s+/g, ' '),
    );

    expect([...ids]).toEqual(['p1']);
    expect(calls.map(queryValues)).toEqual([[USER_ID]]);
    expect(sql).toContain('i."productId" IS NOT NULL');
    expect(sql).toContain('GROUP BY i."productId"');
    expect(sql).toContain('HAVING bool_and(EXISTS (');
    expect(sql).toContain('sibling."id" <> i."id"');
  });

  it('reads the grams of linked items of the user', async () => {
    const { prisma, repository } = setup();
    prisma.entryItem.findMany.mockResolvedValue([{ id: 'i1', grams: 26 }]);

    await expect(repository.itemGrams(USER_ID, [])).resolves.toEqual(new Map());
    await expect(repository.itemGrams(USER_ID, ['i1'])).resolves.toEqual(
      new Map([['i1', 26]]),
    );
    expect(prisma.entryItem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.entryItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['i1'] }, entry: { userId: USER_ID } },
      select: { id: true, grams: true },
    });
  });

  it('reads the hidden names of the user and none without a profile', async () => {
    const { prisma, repository } = setup();

    await expect(repository.hiddenNames(USER_ID)).resolves.toEqual([]);
    prisma.profile.findUnique.mockResolvedValue({
      hiddenFoods: ['granola', 'lentil soup'],
    });
    await expect(repository.hiddenNames(USER_ID)).resolves.toEqual([
      'granola',
      'lentil soup',
    ]);

    expect(prisma.profile.findUnique).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { hiddenFoods: true },
    });
  });

  it('loads meals for the user without their raw AI JSON', async () => {
    const { prisma, repository } = setup();

    await repository.meals(USER_ID, ['e1', 'e2']);

    expect(prisma.entry.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ['e1', 'e2'] } },
      include: {
        items: { orderBy: { position: 'asc' } },
        photo: true,
      },
      omit: { rawAiJson: true },
    });
  });

  it('loads foods scoped through their entry without the raw AI JSON', async () => {
    const { prisma, repository } = setup();

    await repository.foods(USER_ID, ['i1']);

    expect(prisma.entryItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['i1'] }, entry: { userId: USER_ID } },
      include: {
        entry: { include: { photo: true }, omit: { rawAiJson: true } },
      },
    });
  });

  it('skips the queries when there is nothing to load', async () => {
    const { prisma, repository } = setup();

    await expect(repository.meals(USER_ID, [])).resolves.toEqual([]);
    await expect(repository.foods(USER_ID, [])).resolves.toEqual([]);

    expect(prisma.entry.findMany).not.toHaveBeenCalled();
    expect(prisma.entryItem.findMany).not.toHaveBeenCalled();
  });
});
