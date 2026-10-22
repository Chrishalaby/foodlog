import { zeroNutrients, type LabelInfo } from '@food/shared';
import { createDraftItem } from '../../shared/ui/items-editor/items-math';
import {
  MIN_SERVINGS,
  amountForServings,
  applyLabelPortion,
  labelMicroRows,
  labelRows,
  nutrientsForAmount,
  packSizeOf,
  servingSizeOf,
  servingsForAmount,
  stepServings,
} from './label-portion';

function label(overrides: Partial<LabelInfo> = {}): LabelInfo {
  return {
    productName: 'Oat biscuits',
    basisUnit: 'g',
    per100: {
      ...zeroNutrients(),
      calories: 480,
      protein: 7.5,
      carbs: 62,
      fat: 21,
      satFat: 9.2,
      fiber: 5,
      sugar: 24,
      sodium: 410,
    },
    microsPer100: null,
    servingSize: 30,
    servingText: '2 biscuits (30 g)',
    packSize: 300,
    ...overrides,
  };
}

describe('label portion math', () => {
  it('scales per-100 values to the eaten amount with nutrient rounding', () => {
    const nutrients = nutrientsForAmount(label(), 45);
    expect(nutrients.calories).toBe(216);
    expect(nutrients.protein).toBe(3.4);
    expect(nutrients.carbs).toBe(27.9);
    expect(nutrients.fat).toBe(9.5);
    expect(nutrients.sodium).toBe(184);
    expect(nutrients.alcohol).toBe(0);
  });

  it('sets the item grams and a per-gram basis taken from the label', () => {
    const item = createDraftItem({
      name: 'Oat biscuits',
      grams: 30,
      nutrients: { ...zeroNutrients(), calories: 150, protein: 2 },
    });
    const next = applyLabelPortion(item, label(), 90);
    expect(next.key).toBe(item.key);
    expect(next.name).toBe('Oat biscuits');
    expect(next.grams).toBe(90);
    expect(next.nutrients.calories).toBe(432);
    expect(next.nutrients.protein).toBe(6.8);
    expect(next.basis?.calories).toBeCloseTo(4.8);
  });

  it('rescales the item’s vitamins and drink ml when the label amount changes', () => {
    const item = createDraftItem({
      name: 'Soy milk',
      grams: 250,
      nutrients: { ...zeroNutrients(), calories: 100 },
      micros: { calcium: 300 },
      microsPer100: { calcium: 120 },
      fluidMl: 250,
    });
    const next = applyLabelPortion(item, label({ basisUnit: 'ml' }), 400);
    expect(next.micros).toEqual({ calcium: 480 });
    expect(next.fluidMl).toBe(400);
  });

  it('lists printed vitamins per 100 g and per serving, skipping ones not on the label', () => {
    const rows = labelMicroRows(
      label({ microsPer100: { vitaminD: 1.5, calcium: 120, vitaminB12: 0.38 } }),
    );
    expect(rows).toEqual([
      { key: 'vitaminD', label: 'Vitamin D', per100: '1.5 µg', perServing: '0.5 µg' },
      { key: 'vitaminB12', label: 'Vitamin B12', per100: '0.38 µg', perServing: '0.11 µg' },
      { key: 'calcium', label: 'Calcium', per100: '120 mg', perServing: '36 mg' },
    ]);
    expect(
      labelMicroRows(label({ microsPer100: { calcium: 120 }, servingSize: null }))[0]?.perServing,
    ).toBeNull();
    expect(labelMicroRows(label())).toEqual([]);
  });

  it('treats negative or invalid amounts as zero', () => {
    const next = applyLabelPortion(createDraftItem({ grams: 30 }), label(), -5);
    expect(next.grams).toBe(0);
    expect(next.nutrients.calories).toBe(0);
    expect(nutrientsForAmount(label(), Number.NaN).calories).toBe(0);
  });

  it('converts between amounts and servings', () => {
    expect(servingsForAmount(45, 30)).toBe(1.5);
    expect(servingsForAmount(10, 30)).toBe(0.33);
    expect(servingsForAmount(45, null)).toBeNull();
    expect(servingsForAmount(45, 0)).toBeNull();
    expect(amountForServings(2.5, 30)).toBe(75);
    expect(amountForServings(1 / 3, 25)).toBe(8.3);
  });

  it('steps servings in halves, snapping to the grid and never below half a serving', () => {
    expect(stepServings(1, 1)).toBe(1.5);
    expect(stepServings(1, -1)).toBe(0.5);
    expect(stepServings(1.3, 1)).toBe(1.5);
    expect(stepServings(1.3, -1)).toBe(1);
    expect(stepServings(0, 1)).toBe(0.5);
    expect(stepServings(0.5, -1)).toBe(MIN_SERVINGS);
    expect(stepServings(0.33, -1)).toBe(MIN_SERVINGS);
    expect(stepServings(Number.NaN, 1)).toBe(0.5);
  });

  it('only exposes positive serving and pack sizes', () => {
    expect(servingSizeOf(label())).toBe(30);
    expect(packSizeOf(label())).toBe(300);
    expect(servingSizeOf(label({ servingSize: 0 }))).toBeNull();
    expect(packSizeOf(label({ packSize: null }))).toBeNull();
    expect(servingSizeOf(label({ servingSize: Number.NaN }))).toBeNull();
  });

  it('builds table rows with per-serving values and hides alcohol when absent', () => {
    const rows = labelRows(label());
    expect(rows.map((row) => row.key)).not.toContain('alcohol');
    const calories = rows.find((row) => row.key === 'calories');
    expect(calories).toMatchObject({ per100: 480, perServing: 144, unit: 'kcal' });
    const sodium = rows.find((row) => row.key === 'sodium');
    expect(sodium).toMatchObject({ per100: 410, perServing: 123, unit: 'mg' });

    const beer = labelRows(
      label({
        basisUnit: 'ml',
        servingSize: null,
        per100: { ...zeroNutrients(), calories: 43, alcohol: 3.9 },
      }),
    );
    expect(beer.find((row) => row.key === 'alcohol')?.per100).toBe(3.9);
    expect(beer.every((row) => row.perServing === null)).toBe(true);
  });
});
