import { API_LIMITS, zeroNutrients } from '@food/shared';
import { Prisma, type Product } from '../generated/prisma/client.js';
import {
  cleanAliases,
  matchesMyFoodQuery,
  microsPer100Update,
  type MyFoodRow,
  toChangeResponse,
  toMyFoodDto,
  toSavedFoodInfo,
  unitGramsOrNull,
} from './my-food-data.js';
import { MY_FOOD_ALIASES_MAX } from './my-foods.dto.js';

const NOW = new Date('2026-09-30T10:00:00.000Z');

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '019a0000-0000-7000-8000-0000000000d1',
    userId: '019a0000-0000-7000-8000-000000000001',
    barcode: null,
    name: 'Tomato ketchup',
    brand: 'Heinz',
    aliases: ['Catsup'],
    unitName: 'tbsp',
    unitGrams: 17,
    basisUnit: 'g',
    ...zeroNutrients(),
    calories: 110,
    carbs: 25,
    microsPer100: { potassium: 281, vitaminA: 21 },
    servingSizeG: null,
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

describe('cleanAliases', () => {
  it('keeps distinct names that differ from the name and the brand name', () => {
    expect(
      cleanAliases(
        [
          'Tomato ketchup',
          'heinz tomato ketchup',
          '  Catsup ',
          'Ketchup, regular',
          'Ketchup packet',
          '',
          ' ,. ',
        ],
        'Tomato ketchup',
        'Heinz',
      ),
    ).toEqual(['Catsup', 'Ketchup packet']);
  });

  it('dedupes names that only differ in case, punctuation or plural', () => {
    expect(
      cleanAliases(
        [
          'Cabbage, raw shredded',
          'cabbage raw, shredded',
          'Cabbages raw shredded',
        ],
        'Cabbage',
        null,
      ),
    ).toEqual(['Cabbage, raw shredded']);
  });

  it(`keeps at most ${MY_FOOD_ALIASES_MAX} names within the name limit`, () => {
    const aliases = cleanAliases(
      [
        'x'.repeat(API_LIMITS.nameMax + 10),
        ...Array.from({ length: 30 }, (_, i) => `Name ${i}`),
      ],
      'Food',
      null,
    );
    expect(aliases).toHaveLength(MY_FOOD_ALIASES_MAX);
    expect(aliases[0]).toHaveLength(API_LIMITS.nameMax);
  });
});

describe('unitGramsOrNull', () => {
  it('keeps positive weights only', () => {
    expect(unitGramsOrNull(15)).toBe(15);
    expect(unitGramsOrNull(0)).toBeNull();
    expect(unitGramsOrNull(null)).toBeNull();
    expect(unitGramsOrNull(undefined)).toBeNull();
  });
});

describe('matchesMyFoodQuery', () => {
  it('matches every word against the name, brand and other names', () => {
    const ketchup = product();
    expect(matchesMyFoodQuery(ketchup, undefined)).toBe(true);
    expect(matchesMyFoodQuery(ketchup, '  ')).toBe(true);
    expect(matchesMyFoodQuery(ketchup, 'heinz TOMATO')).toBe(true);
    expect(matchesMyFoodQuery(ketchup, 'catsup')).toBe(true);
    expect(matchesMyFoodQuery(ketchup, 'mayo')).toBe(false);
    expect(matchesMyFoodQuery(product({ brand: null }), 'heinz')).toBe(false);
  });
});

describe('microsPer100Update', () => {
  it('keeps, replaces or clears the micros of a saved food', () => {
    expect(microsPer100Update(undefined)).toEqual({});
    expect(microsPer100Update({ potassium: 281.123456 })).toEqual({
      microsPer100: { potassium: 281.12 },
    });
    expect(microsPer100Update(null)).toEqual({ microsPer100: Prisma.DbNull });
    expect(microsPer100Update({})).toEqual({ microsPer100: Prisma.DbNull });
  });
});

describe('toMyFoodDto', () => {
  it('maps the product with its linked item count', () => {
    const row: MyFoodRow = { ...product(), _count: { items: 4 } };

    expect(toMyFoodDto(row)).toEqual({
      id: row.id,
      barcode: null,
      name: 'Tomato ketchup',
      brand: 'Heinz',
      aliases: ['Catsup'],
      unitName: 'tbsp',
      unitGrams: 17,
      basisUnit: 'g',
      per100: { ...zeroNutrients(), calories: 110, carbs: 25 },
      microsPer100: { potassium: 281, vitaminA: 21 },
      servingSizeG: null,
      packSizeG: null,
      source: 'manual',
      imageUrl: null,
      missingNutrients: [],
      useCount: 3,
      lastUsedAt: NOW.toISOString(),
      itemCount: 4,
    });
    expect(
      toChangeResponse(row, {
        updatedItems: 3,
        updatedEntries: 2,
        updatedFavorites: 1,
      }),
    ).toMatchObject({
      food: { id: row.id, itemCount: 4 },
      updatedItems: 3,
      updatedEntries: 2,
      updatedFavorites: 1,
    });
  });
});

describe('toSavedFoodInfo', () => {
  it('describes a saved food for merge suggestions', () => {
    expect(toSavedFoodInfo(product())).toEqual({
      id: product().id,
      displayName: 'Heinz Tomato ketchup',
      names: ['Tomato ketchup', 'Heinz Tomato ketchup', 'Catsup'],
      basisUnit: 'g',
      per100: { ...zeroNutrients(), calories: 110, carbs: 25 },
      microsPer100: { potassium: 281, vitaminA: 21 },
      servingGrams: 17,
      lastUsedAt: NOW,
    });
  });

  it('falls back to the creation date and the default serving', () => {
    const created = new Date('2026-09-01T08:00:00.000Z');

    expect(
      toSavedFoodInfo(
        product({ lastUsedAt: null, createdAt: created, unitGrams: null }),
      ),
    ).toMatchObject({ servingGrams: 100, lastUsedAt: created });
  });
});
