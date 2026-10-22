import { type EntryItemInput, zeroNutrients } from '@food/shared';
import { Prisma } from '../generated/prisma/client.js';
import { entryItemData, favoriteItemsJson, normalizeItems } from './items.js';

function item(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Rice',
    grams: 150,
    nutrients: {
      ...zeroNutrients(),
      calories: 195.4,
      protein: 4.06,
      carbs: 42.94,
    },
    confidence: 'high',
    ...overrides,
  };
}

describe('normalizeItems', () => {
  it('assigns positions in array order and rounds each item', () => {
    const result = normalizeItems([
      item({ name: '  Rice  ' }),
      item({
        name: 'Chicken',
        grams: 120.46,
        nutrients: { ...zeroNutrients(), protein: 37.26 },
      }),
    ]);

    expect(result.items.map((i) => [i.position, i.name, i.grams])).toEqual([
      [0, 'Rice', 150],
      [1, 'Chicken', 120.5],
    ]);
    expect(result.items[0]?.nutrients).toMatchObject({
      calories: 195,
      protein: 4.1,
      carbs: 42.9,
    });
    expect(result.items[1]?.nutrients.protein).toBe(37.3);
  });

  it('sanitizes invalid numbers', () => {
    const result = normalizeItems([
      item({
        grams: Number.NaN,
        nutrients: {
          ...zeroNutrients(),
          calories: -10,
          fat: Number.POSITIVE_INFINITY,
        },
      }),
    ]);

    expect(result.items[0]?.grams).toBe(0);
    expect(result.items[0]?.nutrients.calories).toBe(0);
    expect(result.items[0]?.nutrients.fat).toBe(0);
  });

  it('recomputes totals from the rounded items', () => {
    const result = normalizeItems([
      item({
        nutrients: {
          ...zeroNutrients(),
          calories: 100.4,
          protein: 1.26,
          sodium: 10.4,
        },
      }),
      item({
        nutrients: {
          ...zeroNutrients(),
          calories: 50.4,
          protein: 2.21,
          sodium: 20.4,
        },
      }),
    ]);

    expect(result.totals).toEqual({
      ...zeroNutrients(),
      calories: 150,
      protein: 3.5,
      sodium: 30,
    });
  });

  it('defaults a missing confidence to null', () => {
    const { confidence: _omitted, ...withoutConfidence } = item();
    const result = normalizeItems([
      withoutConfidence,
      item({ confidence: null }),
    ]);

    expect(result.items.map((i) => i.confidence)).toEqual([null, null]);
  });

  it('returns zero totals for no items', () => {
    expect(normalizeItems([])).toEqual({ items: [], totals: zeroNutrients() });
  });
});

describe('item persistence helpers', () => {
  it('maps a normalized item to entry item columns', () => {
    const [normalized] = normalizeItems([item()]).items;

    expect(entryItemData(normalized!)).toEqual({
      position: 0,
      name: 'Rice',
      grams: 150,
      count: null,
      unit: null,
      unitPlural: null,
      confidence: 'high',
      productId: null,
      micros: Prisma.DbNull,
      fluidMl: null,
      calories: 195,
      protein: 4.1,
      carbs: 42.9,
      fat: 0,
      satFat: 0,
      fiber: 0,
      sugar: 0,
      sodium: 0,
      alcohol: 0,
    });
  });

  it('serializes favorite items without positions', () => {
    const { items } = normalizeItems([item()]);

    expect(favoriteItemsJson(items)).toEqual([
      {
        name: 'Rice',
        grams: 150,
        nutrients: {
          ...zeroNutrients(),
          calories: 195,
          protein: 4.1,
          carbs: 42.9,
        },
        confidence: 'high',
        count: null,
        unit: null,
        unitPlural: null,
        productId: null,
        micros: null,
        fluidMl: null,
      },
    ]);
  });

  it('keeps the saved food link of each item', () => {
    const productId = '019a0000-0000-7000-8000-0000000000d1';
    const { items } = normalizeItems([item({ productId }), item()]);

    expect(items.map((normalized) => normalized.productId)).toEqual([
      productId,
      null,
    ]);
    expect(entryItemData(items[0]!)).toMatchObject({ productId });
    expect(favoriteItemsJson(items)).toMatchObject([
      { productId },
      { productId: null },
    ]);
  });

  it('keeps a complete item count, deriving the plural and rounding the count', () => {
    const { items } = normalizeItems([
      item({ count: 1.504, unit: ' slice ', unitPlural: null }),
      item({ count: 2, unit: 'x'.repeat(60), unitPlural: 'y' }),
      item({ count: 0, unit: 'egg', unitPlural: 'eggs' }),
      item({ count: 101, unit: 'egg', unitPlural: 'eggs' }),
    ]);

    expect(
      items.map(({ count, unit, unitPlural }) => ({ count, unit, unitPlural })),
    ).toEqual([
      { count: 1.5, unit: 'slice', unitPlural: 'slices' },
      { count: 2, unit: 'x'.repeat(40), unitPlural: 'y' },
      { count: null, unit: null, unitPlural: null },
      { count: null, unit: null, unitPlural: null },
    ]);
    expect(favoriteItemsJson(items.slice(0, 1))).toEqual([
      expect.objectContaining({
        count: 1.5,
        unit: 'slice',
        unitPlural: 'slices',
      }),
    ]);
  });

  it('keeps rounded micros and the drink volume of each item', () => {
    const { items } = normalizeItems([
      item({
        micros: { vitaminD: 125.04, calcium: 12.6, caffeine: 34.98 },
        fluidMl: 330.4,
      }),
      item({ micros: {}, fluidMl: 0 }),
    ]);

    expect(items.map(({ micros, fluidMl }) => ({ micros, fluidMl }))).toEqual([
      { micros: { vitaminD: 125, calcium: 13, caffeine: 35 }, fluidMl: 330 },
      { micros: null, fluidMl: null },
    ]);
    expect(entryItemData(items[0]!)).toMatchObject({
      micros: { vitaminD: 125, calcium: 13, caffeine: 35 },
      fluidMl: 330,
    });
    expect(entryItemData(items[1]!)).toMatchObject({
      micros: Prisma.DbNull,
      fluidMl: null,
    });
    expect(favoriteItemsJson(items)).toMatchObject([
      { micros: { vitaminD: 125, calcium: 13, caffeine: 35 }, fluidMl: 330 },
      { micros: null, fluidMl: null },
    ]);
  });

  it('drops micros that are unknown, negative or above the item maximum', () => {
    const { items } = normalizeItems([
      item({
        micros: {
          vitaminD: 2600,
          iron: -1,
          zinc: Number.NaN,
          potassium: 300,
          ...({ omega3: 2 } as object),
        },
        fluidMl: 6000,
      }),
    ]);

    expect(items[0]).toMatchObject({
      micros: { potassium: 300 },
      fluidMl: null,
    });
  });
});
