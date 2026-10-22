import { zeroNutrients, type ProductDto } from '@food/shared';
import {
  FALLBACK_SERVING_G,
  chipSelected,
  clampProductGrams,
  clampProductServings,
  defaultProductPortion,
  isValidProductPortion,
  logProductBody,
  maxProductServings,
  portionChips,
  portionGrams,
  portionServings,
  productDisplayName,
  productTotals,
  stepProductServings,
} from './product-portion';

const YOGURT: ProductDto = {
  id: 'product-1',
  barcode: '5281234567896',
  name: 'Strawberry yogurt',
  brand: 'Khoury',
  aliases: [],
  unitName: null,
  unitGrams: null,
  basisUnit: 'g',
  per100: {
    ...zeroNutrients(),
    calories: 88,
    protein: 3.5,
    carbs: 13,
    fat: 2.5,
    sugar: 12,
    satFat: 1.6,
    sodium: 45,
  },
  microsPer100: null,
  servingSizeG: 170,
  packSizeG: 170,
  source: 'label',
  imageUrl: null,
  missingNutrients: [],
  useCount: 0,
  lastUsedAt: null,
};

const CHIPS: ProductDto = { ...YOGURT, servingSizeG: 30, packSizeG: 150, name: 'Chips' };
const RICE: ProductDto = { ...YOGURT, servingSizeG: null, packSizeG: 1000, name: 'Rice' };
const BAR: ProductDto = { ...YOGURT, servingSizeG: null, packSizeG: 45, name: 'Chocolate bar' };
const JUICE: ProductDto = { ...YOGURT, basisUnit: 'ml', servingSizeG: 250, packSizeG: 1000 };

const TIMING = { timestamp: '2026-09-28T07:30:00.000Z', localDate: '2026-09-28' };

describe('product portions', () => {
  it('starts with one serving, a small pack, or 100 g', () => {
    expect(defaultProductPortion(YOGURT)).toEqual({ mode: 'servings', servings: 1 });
    expect(defaultProductPortion(BAR)).toEqual({ mode: 'grams', grams: 45 });
    expect(defaultProductPortion(RICE)).toEqual({ mode: 'grams', grams: FALLBACK_SERVING_G });
  });

  it('turns servings into grams and back', () => {
    expect(portionGrams(CHIPS, { mode: 'servings', servings: 1.5 })).toBe(45);
    expect(portionGrams(RICE, { mode: 'servings', servings: 2 })).toBe(200);
    expect(portionServings(CHIPS, { mode: 'grams', grams: 40 })).toBe(1.33);
    expect(portionServings(CHIPS, { mode: 'servings', servings: 2 })).toBe(2);
  });

  it('computes live nutrients from per-100 values', () => {
    const totals = productTotals(YOGURT, 170);
    expect(totals.calories).toBe(150);
    expect(totals.protein).toBe(6);
    expect(totals.carbs).toBe(22.1);
    expect(totals.fat).toBe(4.3);
    expect(totals.sodium).toBe(77);
    expect(productTotals(YOGURT, Number.NaN).calories).toBe(0);
  });

  it('offers serving, half pack, pack and 100 g chips without duplicates', () => {
    expect(portionChips(CHIPS).map((chip) => [chip.label, chip.grams])).toEqual([
      ['1 serving', 30],
      ['½ pack', 75],
      ['1 pack', 150],
      ['100 g', 100],
    ]);
    expect(portionChips(YOGURT).map((chip) => chip.id)).toEqual([
      'serving',
      'half-pack',
      'hundred',
    ]);
    expect(portionChips(RICE).map((chip) => chip.id)).toEqual(['half-pack', 'pack', 'hundred']);
    expect(portionChips(JUICE).at(-1)?.label).toBe('100 ml');
    expect(chipSelected(portionChips(CHIPS)[0]!, 30.01)).toBe(true);
  });

  it('steps servings in halves within bounds', () => {
    expect(stepProductServings(1, 1)).toBe(1.5);
    expect(stepProductServings(1.33, 1)).toBe(1.5);
    expect(stepProductServings(1.33, -1)).toBe(1);
    expect(stepProductServings(0.5, -1)).toBe(0.5);
    expect(stepProductServings(20, 1)).toBe(20);
    expect(clampProductServings(Number.NaN)).toBe(1);
    expect(clampProductGrams(-4)).toBe(1);
    expect(clampProductGrams(50000)).toBe(10000);
  });

  it('caps servings so the portion stays within the item weight limit', () => {
    expect(maxProductServings(CHIPS)).toBe(20);
    expect(maxProductServings({ ...YOGURT, servingSizeG: 1500 })).toBe(6.5);
    expect(maxProductServings({ ...YOGURT, servingSizeG: 10000 })).toBe(1);
    expect(maxProductServings(RICE)).toBe(20);
  });

  it('validates portions', () => {
    expect(isValidProductPortion({ mode: 'grams', grams: 0 })).toBe(false);
    expect(isValidProductPortion({ mode: 'grams', grams: 12.5 })).toBe(true);
    expect(isValidProductPortion({ mode: 'servings', servings: 0.05 })).toBe(false);
    expect(isValidProductPortion({ mode: 'servings', servings: 1 })).toBe(true);
  });

  it('builds the log request with grams or servings', () => {
    expect(logProductBody(CHIPS, { mode: 'servings', servings: 1.5 }, 'snack', TIMING)).toEqual({
      servings: 1.5,
      timestamp: TIMING.timestamp,
      localDate: TIMING.localDate,
      mealType: 'snack',
    });
    expect(logProductBody(CHIPS, { mode: 'grams', grams: 42.26 }, 'lunch', TIMING)).toEqual({
      grams: 42.3,
      timestamp: TIMING.timestamp,
      localDate: TIMING.localDate,
      mealType: 'lunch',
    });
  });

  it('names products with their brand once', () => {
    expect(productDisplayName(YOGURT)).toBe('Khoury Strawberry yogurt');
    expect(productDisplayName({ name: 'Khoury labneh', brand: 'Khoury' })).toBe('Khoury labneh');
    expect(productDisplayName({ name: 'Labneh', brand: null })).toBe('Labneh');
  });
});
