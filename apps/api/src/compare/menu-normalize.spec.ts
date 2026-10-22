import { API_LIMITS, type Nutrients } from '@food/shared';
import {
  dishNotes,
  estimateServing,
  NO_DISHES_WARNING,
  normalizeMenuScan,
} from './menu-normalize.js';
import type {
  MenuScanDish,
  MenuScanOutput,
  MenuServingNutrients,
} from './menu-scan.schema.js';

function serving(
  overrides: Partial<MenuServingNutrients> = {},
): MenuServingNutrients {
  return {
    calories: 570,
    protein_g: 52,
    carbs_g: 58,
    fat_g: 16,
    saturated_fat_g: 4,
    fiber_g: 7,
    sugar_g: 6,
    sodium_mg: 980,
    alcohol_g: 0,
    ...overrides,
  };
}

function dish(overrides: Partial<MenuScanDish> = {}): MenuScanDish {
  return {
    name: 'Grilled chicken plate',
    description: 'Chicken, rice, vegetables',
    portion_basis: 'Plate with ~180 g chicken',
    portion: { count: 1, unit: 'plate', unit_plural: 'plates' },
    estimated_quantity_g: 450,
    per_serving: serving(),
    confidence: 'medium',
    notes: null,
    ...overrides,
  };
}

function scan(overrides: Partial<MenuScanOutput> = {}): MenuScanOutput {
  return { restaurant: null, dishes: [dish()], warnings: [], ...overrides };
}

function nutrients(overrides: Partial<Nutrients> = {}): Nutrients {
  return {
    calories: 570,
    protein: 52,
    carbs: 58,
    fat: 16,
    satFat: 4,
    fiber: 7,
    sugar: 6,
    sodium: 980,
    alcohol: 0,
    ...overrides,
  };
}

describe('normalizeMenuScan', () => {
  it('maps model dishes to MenuDish with per-serving nutrients and no warnings', () => {
    const result = normalizeMenuScan(
      scan({ restaurant: '  Cafe   Nour ', warnings: ['  '] }),
    );

    expect(result).toEqual({
      restaurant: 'Cafe Nour',
      dishes: [
        {
          name: 'Grilled chicken plate',
          description: 'Chicken, rice, vegetables',
          grams: 450,
          portion: { count: 1, unit: 'plate', unitPlural: 'plates' },
          nutrients: nutrients(),
          confidence: 'medium',
          notes: 'Plate with ~180 g chicken',
        },
      ],
      warnings: [],
    });
  });

  it('cleans the serving portion and drops unusable ones', () => {
    const result = normalizeMenuScan(
      scan({
        dishes: [
          dish({
            name: 'Wings',
            portion: { count: 6, unit: '  wing ', unit_plural: '' },
          }),
          dish({ name: 'Dip', portion: null }),
          dish({
            name: 'Blank',
            portion: { count: 1, unit: '  ', unit_plural: 'x' },
          }),
          dish({
            name: 'Huge',
            portion: { count: 250, unit: 'piece', unit_plural: 'pieces' },
          }),
        ],
      }),
    );

    expect(result.dishes.map((d) => d.portion)).toEqual([
      { count: 6, unit: 'wing', unitPlural: 'wings' },
      null,
      null,
      { count: 100, unit: 'piece', unitPlural: 'pieces' },
    ]);
  });

  it('rounds grams and nutrients to their display precision', () => {
    const [result] = normalizeMenuScan(
      scan({
        dishes: [
          dish({
            estimated_quantity_g: 333.333,
            per_serving: serving({
              calories: 570.4,
              protein_g: 52.04,
              sodium_mg: 980.6,
            }),
          }),
        ],
      }),
    ).dishes;

    expect(result?.grams).toBe(333.3);
    expect(result?.nutrients.calories).toBe(570);
    expect(result?.nutrients.protein).toBe(52);
    expect(result?.nutrients.sodium).toBe(981);
  });

  it('turns calorie/macro inconsistencies into dish warnings', () => {
    const result = normalizeMenuScan(
      scan({
        dishes: [
          dish({
            name: 'Mystery bowl',
            per_serving: serving({ calories: 200 }),
          }),
          dish({
            name: 'Odd salad',
            per_serving: serving({
              calories: 492,
              fiber_g: 70,
              saturated_fat_g: 20,
            }),
          }),
        ],
      }),
    );

    expect(result.warnings).toEqual([
      "Calories for 'Mystery bowl' don't match its macros — double-check",
      "Fiber for 'Odd salad' is higher than its carbs — double-check",
      "Saturated fat for 'Odd salad' is higher than its total fat — double-check",
    ]);
  });

  it('converts kJ reported as kcal and replaces invalid values with 0', () => {
    const result = normalizeMenuScan(
      scan({
        dishes: [
          dish({ per_serving: serving({ calories: 570 * 4.184 }) }),
          dish({
            name: 'Broken wrap',
            per_serving: serving({ sugar_g: -3, sodium_mg: Number.NaN }),
          }),
        ],
      }),
    );

    expect(result.dishes[0]?.nutrients.calories).toBe(570);
    expect(result.dishes[1]?.nutrients).toMatchObject({ sugar: 0, sodium: 0 });
    expect(result.warnings).toEqual([
      "Converted kJ to kcal for 'Grilled chicken plate'",
      "Replaced invalid nutrient values for 'Broken wrap' with 0",
    ]);
  });

  it('drops unnamed and duplicate dishes and keeps at most the dish limit', () => {
    const many = Array.from({ length: API_LIMITS.menuDishesMax + 3 }, (_, i) =>
      dish({ name: `Dish ${i + 1}` }),
    );
    const result = normalizeMenuScan(
      scan({
        dishes: [
          dish({ name: '   ' }),
          dish({ name: 'Dish 1' }),
          dish({ name: 'dísh 1 ' }),
          ...many,
        ],
      }),
    );

    expect(result.dishes).toHaveLength(API_LIMITS.menuDishesMax);
    expect(result.dishes.map((d) => d.name).slice(0, 3)).toEqual([
      'Dish 1',
      'Dish 2',
      'Dish 3',
    ]);
    expect(result.warnings).toEqual([
      `Only the first ${API_LIMITS.menuDishesMax} dishes were kept`,
    ]);
  });

  it('keeps model warnings first and adds a hint when no dishes were found', () => {
    const result = normalizeMenuScan(
      scan({
        dishes: [],
        warnings: ['Photo is blurry', 'Photo is blurry', 'Right side cut off'],
      }),
    );

    expect(result.dishes).toEqual([]);
    expect(result.warnings).toEqual([
      'Photo is blurry',
      'Right side cut off',
      NO_DISHES_WARNING,
    ]);
  });

  it('cleans descriptions and falls back to null for empty text', () => {
    const [result] = normalizeMenuScan(
      scan({
        dishes: [
          dish({
            description: '   ',
            portion_basis: '',
            notes: '  Half portion applied. ',
          }),
        ],
      }),
    ).dishes;

    expect(result?.description).toBeNull();
    expect(result?.notes).toBe('Half portion applied');
  });
});

describe('estimateServing', () => {
  it('keeps per-serving values when the weight is unknown, without density checks', () => {
    const result = estimateServing(
      nutrients({ calories: 2600, protein: 120, carbs: 250, fat: 120 }),
      0,
    );

    expect(result.grams).toBe(0);
    expect(result.nutrients.calories).toBe(2600);
    expect(result.flags).toEqual([]);
  });

  it('flags physically impossible densities when the weight is known', () => {
    const result = estimateServing(nutrients({ protein: 300 }), 100);

    expect(result.flags).toContain('mass_balance');
  });

  it('caps absurd weights but keeps the per-serving nutrients', () => {
    const result = estimateServing(nutrients(), 20_000);

    expect(result.grams).toBe(10_000);
    expect(result.nutrients).toEqual(nutrients());
    expect(result.flags).toEqual(['grams_clamped']);
  });

  it('treats a weight that rounds to 0 g as unknown instead of zeroing the dish', () => {
    const result = estimateServing(nutrients(), 0.04);

    expect(result.grams).toBe(0);
    expect(result.nutrients).toEqual(nutrients());
    expect(result.flags).toEqual([]);
  });

  it('keeps the per-serving values exactly when the weight has more decimals than grams keep', () => {
    const result = estimateServing(nutrients({ calories: 570 }), 450.04);

    expect(result.grams).toBe(450);
    expect(result.nutrients).toEqual(nutrients());
  });
});

describe('dishNotes', () => {
  it('joins the portion basis and notes without repeating them', () => {
    expect(dishNotes('Burger with ~150 g patty.', 'Fries not included')).toBe(
      'Burger with ~150 g patty. Fries not included',
    );
    expect(dishNotes('Wrap', 'wrap.')).toBe('Wrap');
    expect(dishNotes('  ', null)).toBeNull();
  });
});
