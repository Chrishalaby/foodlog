import { zeroNutrients } from '@food/shared';
import type { FavoriteWithPhoto } from '../common/mappers.js';
import type { Product } from '../generated/prisma/client.js';
import type { FoodLibraryRepository } from './food-library.repository.js';
import type { LibraryCandidate } from './food-library.js';
import type { FoodItemWithEntry, LibraryMeal } from './food-results.js';
import { FoodSearchService } from './food-search.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const DAY_MS = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function entryRow(id: string, name: string): LibraryMeal {
  return {
    id,
    userId: USER_ID,
    name,
    description: null,
    mealType: 'lunch',
    source: 'text',
    timestamp: daysAgo(1),
    localDate: '2026-09-27',
    photoId: null,
    analysisId: null,
    favoriteId: null,
    productId: null,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    ...zeroNutrients(),
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: `${id}-item`,
        entryId: id,
        position: 0,
        name,
        grams: 100,
        count: null,
        unit: null,
        unitPlural: null,
        confidence: null,
        productId: null,
        micros: null,
        fluidMl: null,
        ...zeroNutrients(),
        calories: 100,
      },
    ],
    photo: null,
  };
}

function foodRow(
  id: string,
  name: string,
  entryName: string,
): FoodItemWithEntry {
  const { items: _items, ...entry } = entryRow(`${id}-entry`, entryName);
  return {
    id,
    entryId: entry.id,
    position: 1,
    name,
    grams: 50,
    count: null,
    unit: null,
    unitPlural: null,
    confidence: 'low',
    productId: null,
    micros: null,
    fluidMl: null,
    ...zeroNutrients(),
    calories: 60,
    entry,
  };
}

function favoriteRow(
  id: string,
  name: string,
  useCount: number,
): FavoriteWithPhoto {
  return {
    id,
    userId: USER_ID,
    name,
    mealType: 'snack',
    items: [
      {
        name,
        grams: 30,
        nutrients: { ...zeroNutrients(), calories: 120 },
        confidence: null,
      },
    ],
    photoId: null,
    ...zeroNutrients(),
    calories: 120,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    useCount,
    lastUsedAt: useCount > 0 ? daysAgo(2) : null,
    createdAt: NOW,
    updatedAt: NOW,
    photo: null,
  };
}

function productRow(
  id: string,
  name: string,
  useCount: number,
  lastUsedAt: Date | null,
): Product {
  return {
    id,
    userId: USER_ID,
    barcode: `528000000000${id.length}`,
    name,
    brand: 'Almarai',
    basisUnit: 'g',
    ...zeroNutrients(),
    calories: 60,
    microsPer100: null,
    servingSizeG: 200,
    packSizeG: null,
    source: 'label',
    imageUrl: null,
    missingNutrients: [],
    aliases: [],
    unitName: null,
    unitGrams: null,
    useCount,
    lastUsedAt,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function usage(overrides: Partial<LibraryCandidate>): LibraryCandidate {
  return {
    kind: 'meal',
    id: 'm1',
    name: 'Lentil soup',
    detail: null,
    useCount: 1,
    recentCount: 1,
    lastUsedAt: daysAgo(1),
    ...overrides,
  };
}

function setup() {
  const library = {
    favorites: vi
      .fn()
      .mockResolvedValue([
        favoriteRow('v1', 'Protein bar', 3),
        favoriteRow('v2', 'Almonds', 7),
      ]),
    products: vi
      .fn()
      .mockResolvedValue([
        productRow('p1', 'Laban', 3, daysAgo(1)),
        productRow('p2', 'Lemon juice', 0, null),
        productRow('p3', 'Almarai cheese', 2, daysAgo(120)),
      ]),
    mealUsage: vi.fn().mockResolvedValue([
      usage({ id: 'm1', name: 'Lentil soup', useCount: 4, recentCount: 4 }),
      usage({ id: 'm4', name: 'almarai  laban', useCount: 5, recentCount: 5 }),
      usage({ id: 'm2', name: 'Protein bar', useCount: 9, recentCount: 9 }),
      usage({
        id: 'm3',
        name: 'Lemon tart',
        lastUsedAt: daysAgo(200),
        recentCount: 0,
      }),
    ]),
    foodUsage: vi.fn().mockResolvedValue([
      usage({
        kind: 'food',
        id: 'f1',
        name: 'Lemon',
        detail: 'Fish dinner',
        useCount: 2,
        recentCount: 2,
      }),
    ]),
    meals: vi.fn((_userId: string, ids: string[]) =>
      Promise.resolve(
        ids
          .filter((id) => id !== 'm3')
          .map((id) => entryRow(id, id === 'm1' ? 'Lentil soup' : 'Other')),
      ),
    ),
    foods: vi.fn((_userId: string, ids: string[]) =>
      Promise.resolve(ids.map((id) => foodRow(id, 'Lemon', 'Fish dinner'))),
    ),
    itemGrams: vi.fn((_userId: string, ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, 26]))),
    ),
    hiddenNames: vi.fn().mockResolvedValue([]),
    componentProductIds: vi.fn().mockResolvedValue(new Set<string>()),
  };
  const service = new FoodSearchService(
    library as unknown as FoodLibraryRepository,
  );
  return { library, service };
}

describe('FoodSearchService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads usage scoped to the user with the 90-day window', async () => {
    const { library, service } = setup();

    await service.search(USER_ID, {});

    const since = daysAgo(90);
    expect(library.favorites).toHaveBeenCalledWith(USER_ID);
    expect(library.products).toHaveBeenCalledWith(USER_ID);
    expect(library.mealUsage).toHaveBeenCalledWith(USER_ID, since);
    expect(library.foodUsage).toHaveBeenCalledWith(USER_ID, since);
    expect(library.hiddenNames).toHaveBeenCalledWith(USER_ID);
  });

  it('returns favorites first and then recent habits for an empty query', async () => {
    const { service } = setup();

    const response = await service.search(USER_ID, {});

    expect(response.query).toBe('');
    expect(response.results.map((r) => r.key)).toEqual([
      'favorite:v2',
      'favorite:v1',
      'product:p1',
      'meal:m1',
      'food:f1',
    ]);
  });

  it('leaves parts of meals out of the standalone scope', async () => {
    const { library, service } = setup();
    library.componentProductIds.mockResolvedValue(new Set(['p1']));

    const response = await service.search(USER_ID, { scope: 'standalone' });

    expect(library.componentProductIds).toHaveBeenCalledWith(USER_ID);
    expect(response.results.map((r) => r.key)).toEqual([
      'favorite:v2',
      'favorite:v1',
      'meal:m4',
      'meal:m1',
    ]);
  });

  it('finds no meal part by name in the standalone scope', async () => {
    const { service } = setup();

    const everything = await service.search(USER_ID, { q: 'lemon' });
    const standalone = await service.search(USER_ID, {
      q: 'lemon',
      scope: 'standalone',
    });

    expect(everything.results.map((r) => r.key)).toContain('food:f1');
    expect(standalone.results.map((r) => r.key)).toEqual(['product:p2']);
  });

  it('does not look up meal parts outside the standalone scope', async () => {
    const { library, service } = setup();

    await service.search(USER_ID, { scope: 'all' });

    expect(library.componentProductIds).not.toHaveBeenCalled();
  });

  it('prefers a product over the meals logged from it', async () => {
    const { library, service } = setup();

    const response = await service.search(USER_ID, { q: 'laban' });

    expect(response.results).toEqual([
      expect.objectContaining({
        key: 'product:p1',
        kind: 'product',
        name: 'Almarai Laban',
        detail: 'Almarai',
        productId: 'p1',
        useCount: 3,
        grams: 200,
      }),
    ]);
    expect(library.meals).toHaveBeenCalledWith(USER_ID, []);
  });

  it('finds unused and older products only when searching', async () => {
    const { service } = setup();

    const empty = await service.search(USER_ID, {});
    const byName = await service.search(USER_ID, { q: 'juice' });
    const byBrand = await service.search(USER_ID, { q: 'almarai' });

    expect(empty.results.map((r) => r.key)).not.toContain('product:p2');
    expect(empty.results.map((r) => r.key)).not.toContain('product:p3');
    expect(byName.results.map((r) => r.key)).toEqual(['product:p2']);
    expect(byBrand.results.map((r) => r.key)).toEqual([
      'product:p1',
      'product:p3',
      'product:p2',
    ]);
  });

  it('searches, ranks and resolves only the top results', async () => {
    const { library, service } = setup();

    const response = await service.search(USER_ID, { q: 'le', limit: 2 });

    expect(response.query).toBe('le');
    expect(response.results.map((r) => [r.kind, r.name])).toEqual([
      ['meal', 'Lentil soup'],
      ['food', 'Lemon'],
    ]);
    expect(library.meals).toHaveBeenCalledWith(USER_ID, ['m1']);
    expect(library.foods).toHaveBeenCalledWith(USER_ID, ['f1']);
  });

  it('skips results whose rows disappeared after ranking', async () => {
    const { service } = setup();

    const response = await service.search(USER_ID, { q: 'lemon tart' });

    expect(response.results).toEqual([]);
  });

  it('leaves hidden meals and foods out of suggestions and search', async () => {
    const { library, service } = setup();
    library.hiddenNames.mockResolvedValue(['lentil soup', 'lemon']);

    const empty = await service.search(USER_ID, {});
    const searched = await service.search(USER_ID, { q: 'le' });

    expect(empty.results.map((r) => r.key)).toEqual([
      'favorite:v2',
      'favorite:v1',
      'product:p1',
    ]);
    expect(searched.results.map((r) => r.key)).toEqual(['product:p2']);
  });

  it('keeps favorites and products whose names are hidden', async () => {
    const { library, service } = setup();
    library.hiddenNames.mockResolvedValue(['protein bar', 'almarai laban']);

    const bar = await service.search(USER_ID, { q: 'protein bar' });
    const laban = await service.search(USER_ID, { q: 'laban' });

    expect(bar.results.map((r) => r.key)).toEqual(['favorite:v1']);
    expect(laban.results.map((r) => r.key)).toEqual(['product:p1']);
  });

  it('finds a meal through the name of its single item after name matches', async () => {
    const { library, service } = setup();
    library.mealUsage.mockResolvedValue([
      usage({
        id: 'm5',
        name: 'Strawberry yogurt cup',
        detail: 'Khoury strawberry yogurt',
        useCount: 9,
        recentCount: 9,
      }),
      usage({ id: 'm6', name: 'Khoury labneh', useCount: 1 }),
    ]);
    library.foodUsage.mockResolvedValue([]);

    const response = await service.search(USER_ID, { q: 'khoury' });

    expect(response.results.map((r) => r.entryId)).toEqual(['m6', 'm5']);
  });

  it('still finds a starred single-item meal through its item name', async () => {
    const { library, service } = setup();
    const starred: FavoriteWithPhoto = {
      ...favoriteRow('v3', 'Strawberry Yogurt', 1),
      items: [
        {
          name: 'Khoury strawberry yogurt',
          grams: 170,
          nutrients: { ...zeroNutrients(), calories: 150 },
          confidence: null,
        },
      ],
    };
    library.favorites.mockResolvedValue([starred]);
    library.mealUsage.mockResolvedValue([
      usage({
        id: 'm7',
        name: 'Strawberry Yogurt',
        detail: 'Khoury strawberry yogurt',
        useCount: 2,
        recentCount: 2,
      }),
    ]);
    library.foodUsage.mockResolvedValue([]);

    const response = await service.search(USER_ID, { q: 'kho' });

    expect(response.results).toEqual([
      expect.objectContaining({
        key: 'favorite:v3',
        name: 'Strawberry Yogurt',
        detail: 'Khoury strawberry yogurt',
        starred: true,
      }),
    ]);
  });

  it('still finds a starred multi-item meal through the item name of its meal', async () => {
    const { library, service } = setup();
    library.favorites.mockResolvedValue([
      {
        ...favoriteRow('v4', 'Strawberry Yogurt', 1),
        items: [
          {
            name: 'Khoury strawberry yogurt',
            grams: 170,
            nutrients: zeroNutrients(),
            confidence: null,
          },
          {
            name: 'Honey',
            grams: 10,
            nutrients: zeroNutrients(),
            confidence: null,
          },
        ],
      },
    ]);
    library.mealUsage.mockResolvedValue([
      usage({
        id: 'm8',
        name: 'strawberry yogurt',
        detail: 'Khoury strawberry yogurt',
      }),
    ]);
    library.foodUsage.mockResolvedValue([]);

    const response = await service.search(USER_ID, { q: 'khoury' });

    expect(response.results.map((r) => r.key)).toEqual(['favorite:v4']);
  });

  it('still finds a starred label entry through the words of its item name', async () => {
    const { library, service } = setup();
    library.favorites.mockResolvedValue([
      {
        ...favoriteRow('v5', 'Crunchy Oat Clusters', 1),
        items: [
          {
            name: 'Crunchy Oat Clusters cereal with honey',
            grams: 40,
            nutrients: { ...zeroNutrients(), calories: 180 },
            confidence: 'high',
          },
        ],
      },
    ]);
    library.mealUsage.mockResolvedValue([
      usage({
        id: 'm9',
        name: 'Crunchy Oat Clusters',
        detail: 'Crunchy Oat Clusters cereal with honey',
      }),
    ]);
    library.foodUsage.mockResolvedValue([]);

    const response = await service.search(USER_ID, { q: 'honey' });

    expect(response.results.map((r) => r.key)).toEqual(['favorite:v5']);
  });

  it('returns nothing when no name matches', async () => {
    const { library, service } = setup();

    const response = await service.search(USER_ID, { q: 'pizza' });

    expect(response.results).toEqual([]);
    expect(library.meals).toHaveBeenCalledWith(USER_ID, []);
  });

  it('folds a food whose items all use one saved food into the saved food', async () => {
    const { library, service } = setup();
    library.products.mockResolvedValue([
      productRow('p1', 'Heinz tomato ketchup', 1, daysAgo(10)),
    ]);
    library.mealUsage.mockResolvedValue([]);
    library.foodUsage.mockResolvedValue([
      usage({
        kind: 'food',
        id: 'f1',
        name: 'Tomato ketchup',
        detail: 'Burger',
        useCount: 3,
        recentCount: 3,
        lastUsedAt: daysAgo(3),
        linkedProductId: 'p1',
      }),
      usage({
        kind: 'food',
        id: 'f2',
        name: 'Ketchup packet',
        detail: 'Fries',
        useCount: 1,
        recentCount: 1,
        lastUsedAt: daysAgo(1),
        linkedProductId: 'p1',
      }),
      usage({
        kind: 'food',
        id: 'f3',
        name: 'Ketchup, spicy',
        useCount: 1,
        recentCount: 1,
        linkedProductId: null,
      }),
    ]);

    const response = await service.search(USER_ID, { q: 'ketchup' });

    expect(response.results.map((r) => r.key).sort()).toEqual([
      'food:f3',
      'product:p1',
    ]);
    expect(response.results.find((r) => r.key === 'product:p1')).toMatchObject({
      grams: 26,
      items: [{ grams: 26, productId: 'p1' }],
    });
    expect(library.itemGrams).toHaveBeenCalledWith(USER_ID, ['f2']);
    expect(library.foods).toHaveBeenCalledWith(USER_ID, ['f3']);
  });

  it('keeps a linked food whose saved food is gone', async () => {
    const { library, service } = setup();
    library.products.mockResolvedValue([]);
    library.foodUsage.mockResolvedValue([
      usage({
        kind: 'food',
        id: 'f1',
        name: 'Lemon',
        linkedProductId: 'p9',
      }),
    ]);

    const response = await service.search(USER_ID, { q: 'lemon' });

    expect(response.results.map((r) => r.key)).toContain('food:f1');
    expect(library.itemGrams).toHaveBeenCalledWith(USER_ID, []);
  });

  it('finds saved foods by their other names', async () => {
    const { library, service } = setup();
    library.products.mockResolvedValue([
      {
        ...productRow('p1', 'Heinz tomato ketchup', 1, daysAgo(10)),
        aliases: ['Catsup'],
      },
    ]);

    const response = await service.search(USER_ID, { q: 'catsup' });

    expect(response.results.map((r) => r.key)).toEqual(['product:p1']);
  });
});
