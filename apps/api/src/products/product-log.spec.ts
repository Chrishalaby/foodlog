import { MAX_ITEM_GRAMS, zeroNutrients } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import type { LinkedProductRow } from './product-data.js';
import {
  productAmount,
  productFluidMl,
  productLogGrams,
  productLogItem,
  productServingItem,
} from './product-log.js';

const PRODUCT_ID = '019a0000-0000-7000-8000-0000000000d1';

function product(overrides: Partial<LinkedProductRow> = {}): LinkedProductRow {
  return {
    id: PRODUCT_ID,
    name: 'Laban Ayran',
    brand: 'Almarai',
    basisUnit: 'ml',
    servingSizeG: 250,
    ...zeroNutrients(),
    calories: 42,
    protein: 3.2,
    carbs: 4.6,
    fat: 1.2,
    satFat: 0.8,
    sugar: 4.6,
    sodium: 50,
    ...overrides,
  };
}

describe('productAmount', () => {
  it('defaults to one serving', () => {
    expect(productAmount(undefined, undefined)).toEqual({ servings: 1 });
    expect(productAmount(null, null)).toEqual({ servings: 1 });
  });

  it('prefers grams over servings', () => {
    expect(productAmount(125, 2)).toEqual({ grams: 125 });
    expect(productAmount(undefined, 2)).toEqual({ servings: 2 });
  });
});

describe('productLogGrams', () => {
  it('multiplies servings by the serving size', () => {
    expect(productLogGrams(product(), { servings: 1 })).toBe(250);
    expect(productLogGrams(product(), { servings: 1.5 })).toBe(375);
    expect(
      productLogGrams(product({ servingSizeG: 33.3 }), { servings: 3 }),
    ).toBe(99.9);
  });

  it('uses 100 g per serving without a serving size', () => {
    expect(
      productLogGrams(product({ servingSizeG: null }), { servings: 2 }),
    ).toBe(200);
  });

  it('uses grams as given', () => {
    expect(productLogGrams(product(), { grams: 180 })).toBe(180);
    expect(productLogGrams(product(), { grams: 12.34 })).toBe(12.3);
  });

  it('rejects amounts beyond the item limits', () => {
    expect(() =>
      productLogGrams(product({ servingSizeG: 1000 }), { servings: 10.01 }),
    ).toThrow(BadRequestException);
    expect(
      productLogGrams(product({ servingSizeG: 1000 }), { servings: 10 }),
    ).toBe(MAX_ITEM_GRAMS);
  });

  it('rejects amounts that round to nothing', () => {
    expect(() =>
      productLogGrams(product({ servingSizeG: 0.1 }), { servings: 0.1 }),
    ).toThrow(/too small/);
  });
});

describe('productLogItem', () => {
  it('computes the item from the per-100 values and links it to the product', () => {
    expect(productLogItem(product(), 250)).toEqual({
      name: 'Almarai Laban Ayran',
      grams: 250,
      nutrients: {
        ...zeroNutrients(),
        calories: 105,
        protein: 8,
        carbs: 11.5,
        fat: 3,
        satFat: 2,
        sugar: 11.5,
        sodium: 125,
      },
      confidence: 'high',
      productId: PRODUCT_ID,
      micros: null,
      fluidMl: 250,
    });
  });

  it('sets item micros from the micros per 100 of the product', () => {
    expect(
      productLogItem(
        product({ microsPer100: { calcium: 110, vitaminB12: 0.3, junk: 4 } }),
        250,
      ),
    ).toMatchObject({ micros: { calcium: 275, vitaminB12: 0.75 } });
  });

  it('counts only millilitre products as a drink', () => {
    expect(productLogItem(product({ basisUnit: 'g' }), 30).fluidMl).toBeNull();
    expect(productFluidMl({ basisUnit: 'ml' }, 330.4)).toBe(330);
    expect(productFluidMl({ basisUnit: 'ml' }, 6000)).toBeNull();
    expect(productFluidMl({ basisUnit: 'g' }, 330)).toBeNull();
  });

  it('rejects items whose nutrients exceed the limits', () => {
    expect(() => productLogItem(product({ sodium: 100_000 }), 1000)).toThrow(
      /nutrient limits/,
    );
  });
});

describe('productServingItem', () => {
  it('describes one serving, or 100 g without a serving size', () => {
    expect(productServingItem(product())).toMatchObject({
      grams: 250,
      nutrients: { calories: 105 },
      productId: PRODUCT_ID,
    });
    expect(productServingItem(product({ servingSizeG: null }))).toMatchObject({
      grams: 100,
      nutrients: { calories: 42, protein: 3.2 },
    });
    expect(
      productServingItem(product({ servingSizeG: null, unitGrams: 70 })),
    ).toMatchObject({ grams: 70 });
    expect(
      productServingItem(product({ servingSizeG: 0, unitGrams: 0 })),
    ).toMatchObject({ grams: 100 });
  });
});
