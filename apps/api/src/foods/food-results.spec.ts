import { type FoodSearchResult, zeroNutrients } from '@food/shared';
import type { FavoriteWithPhoto } from '../common/mappers.js';
import type { Photo, Product } from '../generated/prisma/client.js';
import type { LibraryCandidate } from './food-library.js';
import {
  type FoodItemWithEntry,
  libraryAmounts,
  type LibraryMeal,
  type LibraryRows,
  toSearchResult,
} from './food-results.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const ENTRY_ID = '019a0000-0000-7000-8000-0000000000e1';
const ITEM_ID = '019a0000-0000-7000-8000-0000000000a1';
const FAVORITE_ID = '019a0000-0000-7000-8000-0000000000c1';
const PRODUCT_ID = '019a0000-0000-7000-8000-0000000000d1';
const PHOTO_ID = '019a0000-0000-7000-8000-0000000000f1';
const NOW = new Date('2026-09-28T08:00:00.000Z');
const LAST_USED = new Date('2026-09-27T07:30:00.000Z');

const PHOTO: Photo = {
  id: PHOTO_ID,
  userId: USER_ID,
  storageKey: 'k',
  thumbKey: 't',
  width: 800,
  height: 600,
  bytes: 1000,
  createdAt: NOW,
};

const PHOTO_REF = {
  id: PHOTO_ID,
  url: `/api/photos/${PHOTO_ID}`,
  thumbUrl: `/api/photos/${PHOTO_ID}/thumb`,
  width: 800,
  height: 600,
};

function itemRow(
  overrides: Partial<LibraryMeal['items'][number]> = {},
): LibraryMeal['items'][number] {
  return {
    id: ITEM_ID,
    entryId: ENTRY_ID,
    position: 0,
    name: 'Khoury strawberry yogurt',
    grams: 170,
    count: null,
    unit: null,
    unitPlural: null,
    confidence: 'high',
    productId: null,
    micros: { calcium: 204, vitaminB12: 0.63 },
    fluidMl: null,
    ...zeroNutrients(),
    calories: 150,
    protein: 6.8,
    ...overrides,
  };
}

function entryFields(): FoodItemWithEntry['entry'] {
  return {
    id: ENTRY_ID,
    userId: USER_ID,
    productId: null,
    name: 'Breakfast bowl',
    description: null,
    mealType: 'breakfast',
    source: 'food_photo',
    timestamp: LAST_USED,
    localDate: '2026-09-27',
    photoId: PHOTO_ID,
    analysisId: null,
    favoriteId: null,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    ...zeroNutrients(),
    calories: 330,
    protein: 10.8,
    createdAt: NOW,
    updatedAt: NOW,
    photo: PHOTO,
  };
}

function entryRow(): LibraryMeal {
  return {
    ...entryFields(),
    items: [
      itemRow({
        id: 'item-2',
        position: 1,
        name: 'Granola',
        grams: 40.04,
        confidence: null,
        micros: null,
        calories: 180,
        protein: 4,
      }),
      itemRow(),
    ],
  };
}

function favoriteRow(): FavoriteWithPhoto {
  return {
    id: FAVORITE_ID,
    userId: USER_ID,
    name: 'Protein shake',
    mealType: null,
    items: [
      {
        name: 'Whey',
        grams: 30,
        nutrients: { ...zeroNutrients(), calories: 120, protein: 24 },
        confidence: 'high',
      },
      {
        name: 'Milk',
        grams: 250.04,
        nutrients: { ...zeroNutrients(), calories: 160.4, protein: 8.3 },
        confidence: null,
        micros: { calcium: 300, vitaminD: 2.5 },
        fluidMl: 250,
      },
    ],
    photoId: null,
    ...zeroNutrients(),
    calories: 280,
    protein: 32.3,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    useCount: 4,
    lastUsedAt: LAST_USED,
    createdAt: NOW,
    updatedAt: NOW,
    photo: null,
  };
}

function productRow(overrides: Partial<Product> = {}): Product {
  return {
    id: PRODUCT_ID,
    userId: USER_ID,
    barcode: '5281234567892',
    name: 'Laban drink',
    brand: 'Almarai',
    basisUnit: 'ml',
    ...zeroNutrients(),
    calories: 45,
    protein: 3.2,
    fat: 1.5,
    sodium: 50,
    microsPer100: { calcium: 120, vitaminD: 0.8 },
    servingSizeG: 180,
    packSizeG: 1000,
    source: 'openfoodfacts',
    imageUrl: null,
    missingNutrients: [],
    aliases: [],
    unitName: null,
    unitGrams: null,
    useCount: 2,
    lastUsedAt: LAST_USED,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function foodRow(entryName = 'Breakfast bowl'): FoodItemWithEntry {
  return { ...itemRow(), entry: { ...entryFields(), name: entryName } };
}

function candidate(overrides: Partial<LibraryCandidate>): LibraryCandidate {
  return {
    kind: 'meal',
    id: ENTRY_ID,
    name: 'Breakfast bowl',
    detail: null,
    useCount: 3,
    recentCount: 2,
    lastUsedAt: LAST_USED,
    ...overrides,
  };
}

function rows(overrides: Partial<LibraryRows> = {}): LibraryRows {
  return {
    favorites: new Map([[FAVORITE_ID, favoriteRow()]]),
    products: new Map([[PRODUCT_ID, productRow()]]),
    meals: new Map([[ENTRY_ID, entryRow()]]),
    foods: new Map([[ITEM_ID, foodRow()]]),
    ...overrides,
  };
}

describe('libraryAmounts', () => {
  it('sums and rounds totals and grams', () => {
    expect(
      libraryAmounts([
        {
          name: 'A',
          grams: 0.1,
          nutrients: { ...zeroNutrients(), calories: 10.4, protein: 0.04 },
        },
        {
          name: 'B',
          grams: 0.2,
          nutrients: { ...zeroNutrients(), calories: 10.4, protein: 0.04 },
        },
      ]),
    ).toMatchObject({
      grams: 0.3,
      totals: { ...zeroNutrients(), calories: 21, protein: 0.1 },
    });
  });
});

describe('toSearchResult', () => {
  it('maps a favorite with its stored usage', () => {
    expect(
      toSearchResult(candidate({ kind: 'favorite', id: FAVORITE_ID }), rows()),
    ).toEqual<FoodSearchResult>({
      key: `favorite:${FAVORITE_ID}`,
      kind: 'favorite',
      name: 'Protein shake',
      detail: null,
      items: [
        {
          name: 'Whey',
          grams: 30,
          nutrients: { ...zeroNutrients(), calories: 120, protein: 24 },
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: null,
          fluidMl: null,
        },
        {
          name: 'Milk',
          grams: 250.04,
          nutrients: { ...zeroNutrients(), calories: 160.4, protein: 8.3 },
          confidence: null,
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: { calcium: 300, vitaminD: 2.5 },
          fluidMl: 250,
        },
      ],
      totals: { ...zeroNutrients(), calories: 280, protein: 32.3 },
      grams: 280,
      portion: null,
      mealType: null,
      photo: null,
      favoriteId: FAVORITE_ID,
      entryId: null,
      useCount: 4,
      lastUsedAt: LAST_USED.toISOString(),
      productId: null,
      starred: true,
    });
  });

  it('uses the single item name of a favorite as detail when it differs', () => {
    const single = (itemName: string): FavoriteWithPhoto => ({
      ...favoriteRow(),
      name: 'Strawberry Yogurt',
      items: [
        {
          name: itemName,
          grams: 170,
          nutrients: { ...zeroNutrients(), calories: 150 },
          confidence: null,
        },
      ],
    });
    const favorite = candidate({ kind: 'favorite', id: FAVORITE_ID });

    const distinct = toSearchResult(
      favorite,
      rows({
        favorites: new Map([[FAVORITE_ID, single('Khoury strawberry yogurt')]]),
      }),
    );
    const same = toSearchResult(
      favorite,
      rows({
        favorites: new Map([[FAVORITE_ID, single(' strawberry  YOGURT ')]]),
      }),
    );

    expect(distinct).toMatchObject({
      kind: 'favorite',
      name: 'Strawberry Yogurt',
      detail: 'Khoury strawberry yogurt',
      starred: true,
    });
    expect(same?.detail).toBeNull();
  });

  it('maps a meal with its items in position order and aggregated usage', () => {
    expect(toSearchResult(candidate({}), rows())).toEqual<FoodSearchResult>({
      key: `meal:${ENTRY_ID}`,
      kind: 'meal',
      name: 'Breakfast bowl',
      detail: null,
      items: [
        {
          name: 'Khoury strawberry yogurt',
          grams: 170,
          nutrients: { ...zeroNutrients(), calories: 150, protein: 6.8 },
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: { calcium: 204, vitaminB12: 0.63 },
          fluidMl: null,
        },
        {
          name: 'Granola',
          grams: 40.04,
          nutrients: { ...zeroNutrients(), calories: 180, protein: 4 },
          confidence: null,
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: null,
          fluidMl: null,
        },
      ],
      totals: { ...zeroNutrients(), calories: 330, protein: 10.8 },
      grams: 210,
      portion: null,
      mealType: 'breakfast',
      photo: PHOTO_REF,
      favoriteId: null,
      entryId: ENTRY_ID,
      useCount: 3,
      lastUsedAt: LAST_USED.toISOString(),
      productId: null,
      starred: false,
    });
  });

  it('uses the single item name of a meal as detail when it differs', () => {
    const single = (name: string): LibraryMeal => ({
      ...entryFields(),
      name: 'Strawberry yogurt cup',
      items: [itemRow({ name })],
    });

    const renamed = toSearchResult(
      candidate({}),
      rows({
        meals: new Map([[ENTRY_ID, single('Khoury strawberry yogurt')]]),
      }),
    );
    const same = toSearchResult(
      candidate({}),
      rows({ meals: new Map([[ENTRY_ID, single('STRAWBERRY  yogurt cup')]]) }),
    );

    expect(renamed).toMatchObject({
      kind: 'meal',
      name: 'Strawberry yogurt cup',
      detail: 'Khoury strawberry yogurt',
      grams: 170,
    });
    expect(same?.detail).toBeNull();
  });

  it('maps a food with the meal it came from as detail', () => {
    expect(
      toSearchResult(
        candidate({ kind: 'food', id: ITEM_ID, useCount: 6 }),
        rows(),
      ),
    ).toEqual<FoodSearchResult>({
      key: `food:${ITEM_ID}`,
      kind: 'food',
      name: 'Khoury strawberry yogurt',
      detail: 'Breakfast bowl',
      items: [
        {
          name: 'Khoury strawberry yogurt',
          grams: 170,
          nutrients: { ...zeroNutrients(), calories: 150, protein: 6.8 },
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: { calcium: 204, vitaminB12: 0.63 },
          fluidMl: null,
        },
      ],
      totals: { ...zeroNutrients(), calories: 150, protein: 6.8 },
      grams: 170,
      portion: null,
      mealType: 'breakfast',
      photo: PHOTO_REF,
      favoriteId: null,
      entryId: ENTRY_ID,
      useCount: 6,
      lastUsedAt: LAST_USED.toISOString(),
      productId: null,
      starred: false,
    });
  });

  it('exposes the stored portion of meals, foods and favorites', () => {
    const burgers = {
      portionCount: 2,
      portionUnit: 'burger',
      portionUnitPlural: 'burgers',
    };
    const library = rows({
      meals: new Map([[ENTRY_ID, { ...entryRow(), ...burgers }]]),
      foods: new Map([
        [
          ITEM_ID,
          {
            ...foodRow(),
            count: 3,
            unit: 'slice',
            unitPlural: 'slices',
          },
        ],
      ]),
      favorites: new Map([[FAVORITE_ID, { ...favoriteRow(), ...burgers }]]),
    });

    expect(toSearchResult(candidate({}), library)?.portion).toEqual({
      count: 2,
      unit: 'burger',
      unitPlural: 'burgers',
    });
    expect(
      toSearchResult(candidate({ kind: 'food', id: ITEM_ID }), library)
        ?.portion,
    ).toEqual({ count: 3, unit: 'slice', unitPlural: 'slices' });
    expect(
      toSearchResult(candidate({ kind: 'favorite', id: FAVORITE_ID }), library)
        ?.portion,
    ).toEqual({ count: 2, unit: 'burger', unitPlural: 'burgers' });
    expect(
      toSearchResult(candidate({ kind: 'product', id: PRODUCT_ID }), library)
        ?.portion,
    ).toBeNull();
  });

  it('drops a detail that only repeats the food name', () => {
    const result = toSearchResult(
      candidate({ kind: 'food', id: ITEM_ID }),
      rows({
        foods: new Map([[ITEM_ID, foodRow('KHOURY strawberry yogurt ×2')]]),
      }),
    );
    expect(result?.detail).toBeNull();
  });

  it('maps a product to one serving named after its brand with the brand as detail', () => {
    expect(
      toSearchResult(
        candidate({ kind: 'product', id: PRODUCT_ID, useCount: 9 }),
        rows(),
      ),
    ).toEqual<FoodSearchResult>({
      key: `product:${PRODUCT_ID}`,
      kind: 'product',
      name: 'Almarai Laban drink',
      detail: 'Almarai',
      items: [
        {
          name: 'Almarai Laban drink',
          grams: 180,
          nutrients: {
            ...zeroNutrients(),
            calories: 81,
            protein: 5.8,
            fat: 2.7,
            sodium: 90,
          },
          confidence: 'high',
          productId: PRODUCT_ID,
          micros: { calcium: 216, vitaminD: 1.4 },
          fluidMl: 180,
        },
      ],
      totals: {
        ...zeroNutrients(),
        calories: 81,
        protein: 5.8,
        fat: 2.7,
        sodium: 90,
      },
      grams: 180,
      portion: null,
      mealType: null,
      photo: null,
      favoriteId: null,
      entryId: null,
      useCount: 2,
      lastUsedAt: LAST_USED.toISOString(),
      productId: PRODUCT_ID,
      barcode: '5281234567892',
      starred: false,
    });
  });

  it('uses the grams of the latest linked item as the default amount of a saved food', () => {
    const result = toSearchResult(
      candidate({ kind: 'product', id: PRODUCT_ID }),
      rows({ productGrams: new Map([[PRODUCT_ID, 26.04]]) }),
    );

    expect(result).toMatchObject({
      grams: 26,
      items: [
        {
          name: 'Almarai Laban drink',
          grams: 26,
          nutrients: { calories: 12, protein: 0.8 },
          productId: PRODUCT_ID,
        },
      ],
      totals: { calories: 12, protein: 0.8 },
    });
  });

  it('falls back to 100 g for products without a serving size', () => {
    const result = toSearchResult(
      candidate({ kind: 'product', id: PRODUCT_ID }),
      rows({
        products: new Map([
          [
            PRODUCT_ID,
            productRow({
              name: 'Almarai laban',
              basisUnit: 'g',
              brand: 'ALMARAI',
              servingSizeG: null,
              useCount: 0,
              lastUsedAt: null,
            }),
          ],
        ]),
      }),
    );
    expect(result).toMatchObject({
      name: 'Almarai laban',
      detail: 'ALMARAI',
      items: [{ name: 'Almarai laban', grams: 100 }],
      grams: 100,
      totals: { calories: 45, protein: 3.2 },
      useCount: 0,
      lastUsedAt: null,
    });
  });

  it('has no product detail without a brand and keeps items, grams and totals at one serving', () => {
    const result = toSearchResult(
      candidate({ kind: 'product', id: PRODUCT_ID }),
      rows({
        products: new Map([
          [PRODUCT_ID, productRow({ brand: null, servingSizeG: 33.25 })],
        ]),
      }),
    );
    expect(result).toMatchObject({
      name: 'Laban drink',
      detail: null,
      grams: 33.3,
    });
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.grams).toBe(result?.grams);
    expect(result?.totals).toEqual(result?.items[0]?.nutrients);
    expect(result?.totals).toEqual({
      ...zeroNutrients(),
      calories: 15,
      protein: 1.1,
      fat: 0.5,
      sodium: 17,
    });
  });

  it('skips rows that disappeared since ranking', () => {
    const empty = rows({
      favorites: new Map(),
      products: new Map(),
      meals: new Map(),
      foods: new Map(),
    });
    expect(toSearchResult(candidate({}), empty)).toBeNull();
    expect(
      toSearchResult(candidate({ kind: 'food', id: ITEM_ID }), empty),
    ).toBeNull();
    expect(
      toSearchResult(candidate({ kind: 'favorite', id: FAVORITE_ID }), empty),
    ).toBeNull();
    expect(
      toSearchResult(candidate({ kind: 'product', id: PRODUCT_ID }), empty),
    ).toBeNull();
  });
});
