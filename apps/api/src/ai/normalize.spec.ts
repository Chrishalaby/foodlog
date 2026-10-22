import { API_LIMITS, MAX_ITEM_GRAMS, zeroNutrients } from '@food/shared';
import type {
  FoodAnalysisItem,
  FoodAnalysisOutput,
  FoodMicroValues,
  FoodNutrientValues,
} from './food-analysis.schema.js';
import { toSavedFood } from '../my-foods/saved-food.js';
import {
  labelItemIndex,
  normalizeAnalysis,
  validatePer100,
} from './normalize.js';

function nutrients(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  satFat: number,
  fiber: number,
  sugar: number,
  sodium: number,
  alcohol = 0,
): FoodNutrientValues {
  return {
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    saturated_fat_g: satFat,
    fiber_g: fiber,
    sugar_g: sugar,
    sodium_mg: sodium,
    alcohol_g: alcohol,
  };
}

const NO_MICROS: FoodMicroValues = {
  vitamin_a_ug_rae: null,
  vitamin_c_mg: null,
  vitamin_d_ug: null,
  vitamin_e_mg: null,
  vitamin_k_ug: null,
  vitamin_b6_mg: null,
  vitamin_b12_ug: null,
  folate_ug_dfe: null,
  calcium_mg: null,
  iron_mg: null,
  magnesium_mg: null,
  potassium_mg: null,
  zinc_mg: null,
  cholesterol_mg: null,
  caffeine_mg: null,
};

function micros(values: Partial<FoodMicroValues>): FoodMicroValues {
  return { ...NO_MICROS, ...values };
}

function item(
  name: string,
  grams: number,
  per100: FoodNutrientValues,
  overrides: Partial<FoodAnalysisItem> = {},
): FoodAnalysisItem {
  return {
    name,
    saved_food: null,
    amount_source: 'user_stated',
    count: null,
    unit: null,
    unit_plural: null,
    portion_basis: 'stated',
    state: 'as_served',
    estimated_quantity_g: grams,
    fluid_ml: null,
    per_100g: per100,
    micros_per_100g: NO_MICROS,
    confidence: 'medium',
    ...overrides,
  };
}

function analysis(overrides: Partial<FoodAnalysisOutput>): FoodAnalysisOutput {
  return {
    input_type: 'food_photo',
    meal_name: 'Meal',
    portion: null,
    scale_cues: 'none',
    items: [],
    label: null,
    assumptions: [],
    follow_up_question: null,
    follow_up_options: [],
    ...overrides,
  };
}

const BURGER = analysis({
  meal_name: 'Double burger, hollowed bun',
  scale_cues: 'Dinner plate ~27 cm; burger ~11 cm wide',
  items: [
    item(
      'Beef patties 80/20, grilled',
      150,
      nutrients(270, 25.8, 0, 17.8, 6.8, 0, 0, 350),
      { state: 'cooked', portion_basis: '2 patties, ~113 g raw each' },
    ),
    item(
      'Burger bun, hollowed',
      36,
      nutrients(279, 9.8, 50.1, 3.9, 0.8, 1.8, 7.3, 494),
    ),
    item(
      'Ketchup-mayo sauce',
      15,
      nutrients(391, 1, 14, 37.5, 5.9, 0.2, 10.9, 771),
      { confidence: 'high' },
    ),
  ],
  assumptions: ['Patties ~113 g raw each', 'Grilled, no added oil'],
  follow_up_question: 'How big were the patties?',
  follow_up_options: [
    'Thin/smash (~55 g raw each)',
    'Quarter-pound (~113 g raw each)',
    'Larger (~170 g raw each)',
  ],
});

const KJ_AS_KCAL = nutrients(1590, 7, 60, 15, 5, 3, 20, 400);

describe('validatePer100', () => {
  it('accepts consistent USDA-style values without flags', () => {
    expect(
      validatePer100({
        calories: 130,
        protein: 2.7,
        carbs: 28.2,
        fat: 0.3,
        satFat: 0.1,
        fiber: 0.4,
        sugar: 0.1,
        sodium: 1,
        alcohol: 0,
      }).flags,
    ).toEqual([]);
  });

  it('divides kilojoules reported as kcal by 4.184', () => {
    const { per100, flags } = validatePer100({
      calories: 1590,
      protein: 7,
      carbs: 60,
      fat: 15,
      satFat: 5,
      fiber: 3,
      sugar: 20,
      sodium: 400,
      alcohol: 0,
    });
    expect(per100.calories).toBeCloseTo(1590 / 4.184, 5);
    expect(flags).toEqual(['kj_as_kcal_fixed']);
  });

  it('counts alcohol so beer passes the energy check', () => {
    const beer = {
      calories: 43,
      protein: 0.5,
      carbs: 3.6,
      fat: 0,
      satFat: 0,
      fiber: 0,
      sugar: 0,
      sodium: 4,
      alcohol: 3.9,
    };
    expect(validatePer100(beer).flags).toEqual([]);
    expect(validatePer100({ ...beer, alcohol: 0 }).flags).toContain(
      'atwater_mismatch',
    );
  });

  it('flags impossible compositions', () => {
    const { flags } = validatePer100({
      calories: 950,
      protein: 40,
      carbs: 10,
      fat: 90,
      satFat: 95,
      fiber: 12,
      sugar: 15,
      sodium: 45_000,
      alcohol: 0,
    });
    expect(flags).toEqual(
      expect.arrayContaining([
        'mass_balance',
        'fiber_gt_carbs',
        'sugar_gt_carbs',
        'satfat_gt_fat',
        'energy_density_impossible',
        'sodium_impossible',
      ]),
    );
  });
});

describe('normalizeAnalysis', () => {
  it('computes item nutrients from grams and per-100 g values and sums the totals (research burger)', () => {
    const result = normalizeAnalysis(BURGER, { mode: 'food_photo' });

    expect(
      result.items.map((i) => [i.name, i.grams, i.nutrients.calories]),
    ).toEqual([
      ['Beef patties 80/20, grilled', 150, 405],
      ['Burger bun, hollowed', 36, 100],
      ['Ketchup-mayo sauce', 15, 59],
    ]);
    expect(result.items[0]).toMatchObject({
      state: 'cooked',
      amountSource: 'user_stated',
      confidence: 'medium',
      portionBasis: '2 patties, ~113 g raw each',
      flags: [],
      per100g: { calories: 270, protein: 25.8, fat: 17.8, sodium: 350 },
      nutrients: { protein: 38.7, fat: 26.7, satFat: 10.2, sodium: 525 },
    });
    expect(result.totals).toEqual({
      calories: 564,
      protein: 42.4,
      carbs: 20.1,
      fat: 33.7,
      satFat: 11.4,
      fiber: 0.6,
      sugar: 4.2,
      sodium: 819,
      alcohol: 0,
    });
    expect(result.warnings).toEqual([]);
    expect(result.followUpQuestion).toBe('How big were the patties?');
    expect(result.followUpOptions).toHaveLength(3);
    expect(result.label).toBeNull();
    expect(result.mealName).toBe('Double burger, hollowed bun');
    expect(result.inputType).toBe('food_photo');
    expect(result.scaleCues).toBe('Dinner plate ~27 cm; burger ~11 cm wide');
  });

  it('recomputes totals from the items instead of trusting any model arithmetic', () => {
    const result = normalizeAnalysis(
      analysis({
        items: [
          item('Apple', 200, nutrients(52, 0.3, 13.8, 0.2, 0, 2.4, 10.4, 1)),
          item('Apple', 50, nutrients(52, 0.3, 13.8, 0.2, 0, 2.4, 10.4, 1)),
        ],
      }),
      { mode: 'text' },
    );
    expect(result.totals.calories).toBe(104 + 26);
    expect(result.totals.carbs).toBeCloseTo(27.6 + 6.9, 5);
  });

  it('fixes kJ entered as kcal and explains it in a warning', () => {
    const result = normalizeAnalysis(
      analysis({ items: [item('Oat biscuits', 25, KJ_AS_KCAL)] }),
      { mode: 'food_photo' },
    );
    const [biscuits] = result.items;
    expect(biscuits?.per100g.calories).toBe(380);
    expect(biscuits?.nutrients.calories).toBe(95);
    expect(biscuits?.flags).toEqual(['kj_as_kcal_fixed']);
    expect(result.warnings).toEqual([
      "Converted kJ to kcal for 'Oat biscuits'",
    ]);
  });

  it('maps a label that printed only salt and kJ, keeping the model sodium in mg', () => {
    const per100 = nutrients(1590, 7, 63, 15, 6, 3, 21, 360);
    const result = normalizeAnalysis(
      analysis({
        input_type: 'nutrition_label',
        meal_name: '  Oat   biscuits ',
        items: [
          item('Oat biscuits', 25, per100, {
            amount_source: 'label',
            confidence: 'high',
          }),
        ],
        label: {
          product_name: 'Oat biscuits',
          basis_unit: 'g',
          per_100: per100,
          micros_per_100: NO_MICROS,
          serving_size: 25,
          serving_text: '2 biscuits (25 g)',
          pack_size: 300,
        },
      }),
      { mode: 'nutrition_label' },
    );
    expect(result.inputType).toBe('nutrition_label');
    expect(result.mealName).toBe('Oat biscuits');
    expect(result.label).toEqual({
      productName: 'Oat biscuits',
      basisUnit: 'g',
      per100: {
        calories: 380,
        protein: 7,
        carbs: 63,
        fat: 15,
        satFat: 6,
        fiber: 3,
        sugar: 21,
        sodium: 360,
        alcohol: 0,
      },
      microsPer100: null,
      servingSize: 25,
      servingText: '2 biscuits (25 g)',
      packSize: 300,
    });
    expect(result.items[0]?.nutrients.sodium).toBe(90);
    expect(result.warnings).toEqual([
      "Converted kJ to kcal for 'Oat biscuits'",
      'Converted kJ to kcal for the label',
    ]);
  });

  it('replaces negative values with 0 and flags them', () => {
    const result = normalizeAnalysis(
      analysis({
        items: [item('Mystery', 100, nutrients(-20, 10, 5, -3, 0, 0, 0, -50))],
      }),
      { mode: 'text' },
    );
    const [mystery] = result.items;
    expect(mystery?.per100g).toEqual({
      ...zeroNutrients(),
      protein: 10,
      carbs: 5,
    });
    expect(mystery?.flags).toEqual(['negative_value', 'atwater_mismatch']);
    expect(result.warnings).toContain(
      "Replaced invalid nutrient values for 'Mystery' with 0",
    );
    expect(result.warnings).toContain(
      "Calories for 'Mystery' don't match its macros — double-check",
    );
  });

  it('reports no food when the model returns no items', () => {
    const result = normalizeAnalysis(
      analysis({
        meal_name: '',
        follow_up_question: 'What did you eat?',
      }),
      { mode: 'food_photo' },
    );
    expect(result.items).toEqual([]);
    expect(result.totals).toEqual(zeroNutrients());
    expect(result.warnings).toEqual(['No food detected']);
    expect(result.mealName).toBe('Meal');
    expect(result.followUpQuestion).toBe('What did you eat?');
  });

  it('drops unnamed items, clamps grams and trims text fields', () => {
    const long = 'x'.repeat(500);
    const result = normalizeAnalysis(
      analysis({
        items: [
          item('   ', 100, nutrients(100, 5, 10, 4, 1, 1, 1, 10)),
          item(
            `  ${long} `,
            20_000,
            nutrients(52, 0.3, 13.8, 0.2, 0, 2.4, 10.4, 1),
          ),
          item('Grapes', -5, nutrients(69, 0.7, 18.1, 0.2, 0.1, 0.9, 15.5, 2)),
        ],
        assumptions: [
          '  one ',
          '',
          'one',
          ...Array.from({ length: 20 }, (_, i) => `a${i}`),
        ],
        follow_up_question: null,
        follow_up_options: ['orphan option'],
      }),
      { mode: 'food_photo' },
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.name).toHaveLength(API_LIMITS.nameMax);
    expect(result.items[0]?.grams).toBe(MAX_ITEM_GRAMS);
    expect(result.items[0]?.flags).toEqual(['grams_clamped']);
    expect(result.items[1]).toMatchObject({ name: 'Grapes', grams: 0 });
    expect(result.items[1]?.nutrients).toEqual(zeroNutrients());
    expect(result.assumptions[0]).toBe('one');
    expect(result.assumptions).toHaveLength(10);
    expect(result.followUpOptions).toEqual([]);
    expect(result.warnings).toEqual([
      'Ignored 1 unnamed item',
      `Weight for '${'x'.repeat(API_LIMITS.nameMax)}' was capped at ${MAX_ITEM_GRAMS} g`,
    ]);
  });

  it('keeps at most the item limit', () => {
    const many = Array.from({ length: API_LIMITS.itemsMax + 5 }, (_, i) =>
      item(`Item ${i}`, 10, nutrients(100, 5, 10, 4, 1, 1, 1, 10)),
    );
    const result = normalizeAnalysis(analysis({ items: many }), {
      mode: 'food_photo',
    });
    expect(result.items).toHaveLength(API_LIMITS.itemsMax);
    expect(result.warnings).toContain(
      `Only the first ${API_LIMITS.itemsMax} items were kept`,
    );
  });

  it('keeps the requested text mode even if the model reports another input type', () => {
    expect(
      normalizeAnalysis(analysis({ input_type: 'food_photo' }), {
        mode: 'text',
      }).inputType,
    ).toBe('text');
    expect(
      normalizeAnalysis(analysis({ input_type: 'nutrition_label' }), {
        mode: 'food_photo',
      }).inputType,
    ).toBe('nutrition_label');
  });

  it('drops a follow-up question the user has already answered', () => {
    const repeated = analysis({
      follow_up_question: '  How was the chicken COOKED? ',
      follow_up_options: ['Grilled', 'Fried'],
    });
    const result = normalizeAnalysis(repeated, {
      mode: 'food_photo',
      answeredQuestions: ['How was the chicken cooked?'],
    });
    expect(result.followUpQuestion).toBeNull();
    expect(result.followUpOptions).toEqual([]);
    expect(
      normalizeAnalysis(repeated, {
        mode: 'food_photo',
        answeredQuestions: ['How big was the portion?'],
      }).followUpQuestion,
    ).toBe('How was the chicken COOKED?');
  });

  it('warns when label mode found no readable label', () => {
    const result = normalizeAnalysis(
      analysis({
        input_type: 'nutrition_label',
        items: [
          item('Granola', 30, nutrients(450, 9, 64, 16, 3.5, 7, 22, 200)),
        ],
      }),
      { mode: 'nutrition_label' },
    );
    expect(result.warnings).toEqual([
      'No nutrition label could be read — values are estimates',
    ]);
    expect(
      normalizeAnalysis(analysis({ items: [] }), { mode: 'food_photo' })
        .warnings,
    ).toEqual(['No food detected']);
  });

  it('caps item nutrients at the storable maximum', () => {
    const result = normalizeAnalysis(
      analysis({
        items: [
          item('Oil drum', 10_000, nutrients(884, 0, 0, 100, 14, 0, 0, 2)),
        ],
      }),
      { mode: 'text' },
    );
    expect(result.items[0]?.nutrients.calories).toBe(20_000);
    expect(result.items[0]?.nutrients.fat).toBe(2000);
  });
});

describe('portions', () => {
  const PATTY = nutrients(270, 25.8, 0, 17.8, 6.8, 0, 0, 350);

  it('maps the meal portion and item counts to the result', () => {
    const result = normalizeAnalysis(
      analysis({
        meal_name: 'Black Angus burgers',
        portion: { count: 2, unit: 'burger', unit_plural: 'burgers' },
        items: [
          item('Black Angus patties', 300, PATTY, {
            count: 2,
            unit: 'patty',
            unit_plural: 'patties',
          }),
          item('Burger sauce', 30, PATTY),
        ],
      }),
      { mode: 'text' },
    );

    expect(result.portion).toEqual({
      count: 2,
      unit: 'burger',
      unitPlural: 'burgers',
    });
    expect(
      result.items.map(({ count, unit, unitPlural }) => [
        count,
        unit,
        unitPlural,
      ]),
    ).toEqual([
      [2, 'patty', 'patties'],
      [null, null, null],
    ]);
  });

  it('keeps fractional counts from the description', () => {
    const result = normalizeAnalysis(
      analysis({
        portion: { count: 1.5, unit: 'burger', unit_plural: 'burgers' },
        items: [item('Burger', 330, PATTY)],
      }),
      { mode: 'text' },
    );
    expect(result.portion?.count).toBe(1.5);
  });

  it('cleans units, derives a missing plural and caps the count', () => {
    const result = normalizeAnalysis(
      analysis({
        portion: { count: 250, unit: '  slice  ', unit_plural: ' ' },
        items: [
          item('Pizza', 300, PATTY, {
            count: 3.3333,
            unit: 'x'.repeat(60),
            unit_plural: null,
          }),
        ],
      }),
      { mode: 'text' },
    );
    expect(result.portion).toEqual({
      count: 100,
      unit: 'slice',
      unitPlural: 'slices',
    });
    expect(result.items[0]).toMatchObject({
      count: 3.33,
      unit: 'x'.repeat(40),
      unitPlural: `${'x'.repeat(40)}s`.slice(0, 40),
    });
  });

  it('drops portions without a positive count or a unit', () => {
    const result = normalizeAnalysis(
      analysis({
        portion: { count: 0, unit: 'burger', unit_plural: 'burgers' },
        items: [
          item('Eggs', 100, PATTY, { count: 2, unit: null, unit_plural: null }),
          item('Toast', 40, PATTY, {
            count: -1,
            unit: 'slice',
            unit_plural: 'slices',
          }),
        ],
      }),
      { mode: 'text' },
    );
    expect(result.portion).toBeNull();
    expect(result.items.map((i) => i.count)).toEqual([null, null]);
    expect(
      normalizeAnalysis(
        analysis({
          portion: { count: 1, unit: '', unit_plural: 'x' },
          items: [item('Toast', 40, PATTY)],
        }),
        { mode: 'text' },
      ).portion,
    ).toBeNull();
  });

  it('has no meal portion when no food was found', () => {
    const result = normalizeAnalysis(
      analysis({
        portion: { count: 1, unit: 'burger', unit_plural: 'burgers' },
        items: [],
      }),
      { mode: 'text' },
    );
    expect(result.portion).toBeNull();
  });

  it('keeps the count of the item matched to a label', () => {
    const label = nutrients(96, 3.5, 13.8, 3, 1.9, 0.2, 12.5, 45);
    const result = normalizeAnalysis(
      analysis({
        portion: { count: 2, unit: 'cup', unit_plural: 'cups' },
        items: [
          item('Strawberry yogurt', 240, label, {
            count: 2,
            unit: 'cup',
            unit_plural: 'cups',
            amount_source: 'label',
          }),
        ],
        label: {
          product_name: 'Strawberry yogurt',
          basis_unit: 'g',
          per_100: label,
          micros_per_100: NO_MICROS,
          serving_size: 120,
          serving_text: '1 cup (120 g)',
          pack_size: 120,
        },
      }),
      { mode: 'nutrition_label' },
    );
    expect(result.items[0]).toMatchObject({ count: 2, unit: 'cup' });
  });

  it.each(['g', 'Grams', 'ml', 'kg.', 'oz', 'fl oz', 'kcal'])(
    'drops counts measured in %j instead of countable units',
    (unit) => {
      const result = normalizeAnalysis(
        analysis({
          portion: { count: 250, unit, unit_plural: unit },
          items: [
            item('Rice, cooked', 250, PATTY, {
              count: 250,
              unit,
              unit_plural: unit,
            }),
          ],
        }),
        { mode: 'text' },
      );
      expect(result.portion).toBeNull();
      expect(result.items[0]).toMatchObject({
        count: null,
        unit: null,
        unitPlural: null,
      });
    },
  );

  it('keeps countable units that only contain a measure word', () => {
    const result = normalizeAnalysis(
      analysis({
        portion: { count: 2, unit: 'glass', unit_plural: 'glasses' },
        items: [item('Milk', 500, PATTY)],
      }),
      { mode: 'text' },
    );
    expect(result.portion).toEqual({
      count: 2,
      unit: 'glass',
      unitPlural: 'glasses',
    });
  });
});

describe('scale cues', () => {
  it.each([
    'none',
    ' None. ',
    'NONE',
    'N/A',
    'n/a',
    'na',
    '-',
    '—',
    'null',
    'Not applicable',
    'No scale cues',
    'no scale cues visible.',
    '',
  ])('hides the placeholder %j', (cues) => {
    expect(
      normalizeAnalysis(analysis({ scale_cues: cues }), {
        mode: 'food_photo',
      }).scaleCues,
    ).toBe('');
  });

  it('keeps real cues that mention a missing reference', () => {
    expect(
      normalizeAnalysis(
        analysis({ scale_cues: '  None visible;  hand for scale ' }),
        { mode: 'food_photo' },
      ).scaleCues,
    ).toBe('None visible; hand for scale');
  });

  it('never shows scale cues for a text description', () => {
    expect(
      normalizeAnalysis(
        analysis({ input_type: 'text', scale_cues: 'Dinner plate ~27 cm' }),
        { mode: 'text' },
      ).scaleCues,
    ).toBe('');
  });
});

describe('meal name', () => {
  const PLAIN = nutrients(100, 3.5, 13, 3, 2, 0, 13, 50);

  function mealName(mealName: string, itemNames: readonly string[]): string {
    return normalizeAnalysis(
      analysis({
        meal_name: mealName,
        items: itemNames.map((name) => item(name, 170, PLAIN)),
      }),
      { mode: 'text' },
    ).mealName;
  }

  it.each([
    [
      'Strawberry Yogurt',
      'Khoury strawberry yogurt',
      'Khoury strawberry yogurt',
    ],
    ['LABAN', 'Almarai laban', 'Almarai laban'],
    ['Cafe latte', 'Starbucks café latte', 'Starbucks café latte'],
  ])(
    'uses the fuller single item name when %j drops words of %j',
    (name, itemName, expected) => {
      expect(mealName(name, [itemName])).toBe(expected);
    },
  );

  it.each<[string, string[]]>([
    ['Afternoon snack', ['Khoury strawberry yogurt']],
    ['Strawberry Yogurt', ['strawberry yogurt']],
    ['Strawberry yogurt', ['Khoury strawberry yogurt', 'Granola']],
  ])('keeps the meal name %j for items %j', (name, itemNames) => {
    expect(mealName(name, itemNames)).toBe(name);
  });

  it('falls back to the label, the first item and then a generic name', () => {
    expect(mealName('', ['Granola'])).toBe('Granola');
    expect(mealName('', [])).toBe('Meal');
  });
});

describe('label item', () => {
  const CEREAL_LABEL = nutrients(380, 8, 70, 6, 1, 7, 20, 300);
  const MILK = nutrients(64, 3.4, 4.8, 3.6, 2.3, 0, 4.8, 44);
  const PASTA_DRY = nutrients(371, 13, 75, 1.5, 0.3, 3.2, 2.7, 6);
  const PASTA_COOKED = nutrients(158, 5.8, 31, 0.9, 0.2, 1.8, 0.6, 1);

  function withLabel(
    items: FoodAnalysisItem[],
    per100: FoodNutrientValues = CEREAL_LABEL,
  ): FoodAnalysisOutput {
    return analysis({
      input_type: 'nutrition_label',
      meal_name: 'Cereal with milk',
      items,
      label: {
        product_name: 'Crunchy Oat Clusters',
        basis_unit: 'g',
        per_100: per100,
        micros_per_100: NO_MICROS,
        serving_size: 30,
        serving_text: '30 g',
        pack_size: 500,
      },
    });
  }

  it('keeps a user-stated item that already carries the label values', () => {
    const result = normalizeAnalysis(
      withLabel([item('Crunchy Oat Clusters', 40, CEREAL_LABEL)]),
      { mode: 'nutrition_label' },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: 'Crunchy Oat Clusters',
      amountSource: 'user_stated',
      grams: 40,
      per100g: { calories: 380, protein: 8, carbs: 70 },
      nutrients: { calories: 152, carbs: 28 },
      flags: [],
    });
  });

  it('moves the item the label belongs to first and leaves the others alone', () => {
    const result = normalizeAnalysis(
      withLabel([
        item('Milk', 200, MILK),
        item('Crunchy Oat Clusters', 40, CEREAL_LABEL),
      ]),
      { mode: 'nutrition_label' },
    );

    expect(result.items.map((i) => [i.name, i.grams])).toEqual([
      ['Crunchy Oat Clusters', 40],
      ['Milk', 200],
    ]);
    expect(result.items[1]?.per100g).toMatchObject({
      calories: 64,
      protein: 3.4,
    });
    expect(result.totals.calories).toBe(152 + 128);
  });

  it('replaces values that drifted from the label with the label values', () => {
    const drifted = nutrients(372, 8, 63, 6, 1, 7, 20, 300);

    const result = normalizeAnalysis(
      withLabel([item('Crunchy Oat Clusters', 40, drifted)]),
      { mode: 'nutrition_label' },
    );

    expect(result.items[0]).toMatchObject({
      per100g: { calories: 380, carbs: 70, fiber: 7 },
      nutrients: { calories: 152, carbs: 28, fiber: 2.8 },
    });
    expect(result.totals.calories).toBe(152);
    expect(result.items[0]?.per100g).toEqual(result.label?.per100);
  });

  it('never attaches a dry label to a cooked item', () => {
    const result = normalizeAnalysis(
      withLabel(
        [item('Salad', 80, MILK), item('Pasta, cooked', 240, PASTA_COOKED)],
        PASTA_DRY,
      ),
      { mode: 'nutrition_label' },
    );

    expect(result.items.map((i) => i.name)).toEqual(['Salad', 'Pasta, cooked']);
    expect(result.items[1]?.per100g.calories).toBe(158);
    expect(result.items[1]?.nutrients.calories).toBe(379);
  });

  it('prefers the item whose amount came from the label', () => {
    const items = normalizeAnalysis(
      analysis({
        items: [
          item('Clusters, bowl one', 40, CEREAL_LABEL),
          item(
            'Clusters, bowl two',
            30,
            nutrients(382, 8, 70, 6, 1, 7, 20, 300),
            {
              amount_source: 'label',
            },
          ),
        ],
      }),
      { mode: 'food_photo' },
    ).items;
    const label = normalizeAnalysis(withLabel([]), { mode: 'nutrition_label' })
      .label?.per100;

    expect(label).toBeDefined();
    expect(labelItemIndex(items, label ?? zeroNutrients())).toBe(1);
  });

  it('picks the closest item among several candidates', () => {
    const items = normalizeAnalysis(
      analysis({
        items: [
          item('Clusters A', 40, nutrients(400, 8.5, 72, 6.5, 1, 7, 20, 300)),
          item('Clusters B', 40, nutrients(381, 8, 70, 6, 1, 7, 20, 300)),
        ],
      }),
      { mode: 'food_photo' },
    ).items;

    expect(
      labelItemIndex(items, {
        ...zeroNutrients(),
        calories: 380,
        protein: 8,
        carbs: 70,
        fat: 6,
      }),
    ).toBe(1);
  });
});

describe('saved foods', () => {
  const KETCHUP_ID = '019a0000-0000-7000-8000-0000000000d1';
  const BUN_ID = '019a0000-0000-7000-8000-0000000000d2';
  const MAYO_ID = '019a0000-0000-7000-8000-0000000000d3';
  const KETCHUP = toSavedFood({
    id: KETCHUP_ID,
    name: 'Tomato ketchup',
    brand: 'Heinz',
    aliases: ['Catsup'],
    basisUnit: 'g',
    unitName: 'tbsp',
    unitGrams: 17,
    servingSizeG: null,
    microsPer100: null,
    ...zeroNutrients(),
    calories: 110,
    carbs: 25.4,
    sugar: 22.8,
    sodium: 907,
  });
  const BUN = toSavedFood({
    id: BUN_ID,
    name: 'Sofisoft potato bun',
    brand: null,
    aliases: [],
    basisUnit: 'g',
    unitName: 'bun',
    unitGrams: 70,
    servingSizeG: 70,
    microsPer100: null,
    ...zeroNutrients(),
    calories: 272,
    protein: 9,
    carbs: 49,
    fat: 4.5,
  });
  const MAYO = toSavedFood({
    id: MAYO_ID,
    name: 'Mayonnaise',
    brand: 'Heinz',
    aliases: [],
    basisUnit: 'g',
    unitName: null,
    unitGrams: null,
    servingSizeG: null,
    microsPer100: null,
    ...zeroNutrients(),
    calories: 680,
    fat: 75,
  });
  const SAVED = [KETCHUP, BUN, MAYO];
  const GUESS = nutrients(100, 1, 24, 0, 0, 0, 20, 800);

  function burger(items: FoodAnalysisItem[]): FoodAnalysisOutput {
    return analysis({ input_type: 'text', meal_name: 'Burger', items });
  }

  it('links the item the model matched and uses the saved name and values', () => {
    const result = normalizeAnalysis(
      burger([item('Ketchup', 26, GUESS, { saved_food: 'Tomato ketchup' })]),
      { mode: 'text', savedFoods: SAVED },
    );

    expect(result.items[0]).toMatchObject({
      name: 'Heinz Tomato ketchup',
      grams: 26,
      per100g: { calories: 110, carbs: 25.4, sodium: 907 },
      nutrients: { calories: 29, carbs: 6.6, sugar: 5.9, sodium: 236 },
      savedFood: {
        id: KETCHUP_ID,
        name: 'Tomato ketchup',
        brand: 'Heinz',
        basisUnit: 'g',
        unitName: 'tbsp',
        unitGrams: 17,
      },
      suggestedFood: null,
      flags: [],
    });
    expect(result.totals.calories).toBe(29);
  });

  it('resolves the model answer through other names and ignores unknown names', () => {
    const result = normalizeAnalysis(
      burger([
        item('Ketchup', 20, GUESS, { saved_food: 'CATSUP' }),
        item('Pickles', 20, GUESS, { saved_food: 'Pickles from my list' }),
      ]),
      { mode: 'text', savedFoods: SAVED },
    );

    expect(result.items.map((i) => [i.name, i.savedFood?.id ?? null])).toEqual([
      ['Heinz Tomato ketchup', KETCHUP_ID],
      ['Pickles', null],
    ]);
  });

  it('links exact name matches when the model returned null', () => {
    const result = normalizeAnalysis(
      burger([
        item('Sofisoft potato buns', 140, GUESS),
        item('heinz mayonnaise', 15, GUESS),
        item('Catsup', 15, GUESS),
      ]),
      { mode: 'text', savedFoods: SAVED },
    );

    expect(result.items.map((i) => i.savedFood?.id)).toEqual([
      BUN_ID,
      MAYO_ID,
      KETCHUP_ID,
    ]);
    expect(result.items[0]).toMatchObject({
      name: 'Sofisoft potato bun',
      nutrients: { calories: 381, protein: 12.6 },
    });
  });

  it('weighs counted items with the unit weight of the saved food', () => {
    const result = normalizeAnalysis(
      burger([
        item('Sofisoft potato bun', 100, GUESS, {
          saved_food: 'Sofisoft potato bun',
          count: 2,
          unit: 'buns',
          unit_plural: 'buns',
        }),
        item('Ketchup', 30, GUESS, {
          saved_food: 'Tomato ketchup',
          count: 2,
          unit: 'slice',
          unit_plural: 'slices',
        }),
      ]),
      { mode: 'text', savedFoods: SAVED },
    );

    expect(result.items.map((i) => [i.grams, i.count])).toEqual([
      [140, 2],
      [30, 2],
    ]);
    expect(result.items[0]?.nutrients.calories).toBe(381);
  });

  it('suggests a saved food for similar unlinked names without conflicts', () => {
    const result = normalizeAnalysis(
      burger([
        item('Ketchup packet', 20, GUESS),
        item('Heinz tomato ketchup squeeze', 20, GUESS),
        item('Light mayonnaise', 15, GUESS),
        item('Garlic mayonnaise sauce', 15, GUESS),
        item('Beef patty', 150, GUESS),
      ]),
      { mode: 'text', savedFoods: SAVED },
    );

    expect(
      result.items.map((i) => [
        i.name,
        i.savedFood?.id ?? null,
        i.suggestedFood?.id ?? null,
      ]),
    ).toEqual([
      ['Ketchup packet', null, KETCHUP_ID],
      ['Heinz tomato ketchup squeeze', null, KETCHUP_ID],
      ['Light mayonnaise', null, null],
      ['Garlic mayonnaise sauce', null, null],
      ['Beef patty', null, null],
    ]);
    expect(result.items[0]?.per100g.calories).toBe(100);
  });

  it('keeps label values for the labelled item and only suggests the saved food', () => {
    const label = nutrients(102, 1.2, 24, 0.1, 0, 0.3, 22, 780);
    const result = normalizeAnalysis(
      analysis({
        meal_name: 'Ketchup',
        items: [
          item('Tomato ketchup', 20, label, { saved_food: 'Tomato ketchup' }),
        ],
        label: {
          product_name: 'Tomato ketchup',
          basis_unit: 'g',
          per_100: label,
          micros_per_100: NO_MICROS,
          serving_size: 15,
          serving_text: '1 tbsp',
          pack_size: 500,
        },
      }),
      { mode: 'food_photo', savedFoods: SAVED },
    );

    expect(result.items[0]).toMatchObject({
      name: 'Tomato ketchup',
      per100g: { calories: 102 },
      savedFood: null,
      suggestedFood: { id: KETCHUP_ID },
    });
  });

  it('leaves items alone without saved foods', () => {
    const result = normalizeAnalysis(
      burger([item('Ketchup', 20, GUESS, { saved_food: 'Tomato ketchup' })]),
      { mode: 'text' },
    );

    expect(result.items[0]).toMatchObject({
      name: 'Ketchup',
      savedFood: null,
      suggestedFood: null,
      per100g: { calories: 100 },
    });
  });

  it('caps grams derived from the unit weight', () => {
    const result = normalizeAnalysis(
      burger([
        item('Sofisoft potato bun', 70, GUESS, {
          saved_food: 'Sofisoft potato bun',
          count: 100,
          unit: 'bun',
          unit_plural: 'buns',
        }),
      ]),
      {
        mode: 'text',
        savedFoods: [{ ...BUN, ref: { ...BUN.ref, unitGrams: 2000 } }],
      },
    );

    expect(result.items[0]).toMatchObject({
      grams: MAX_ITEM_GRAMS,
      flags: ['grams_clamped'],
    });
  });
});

describe('vitamins, minerals and drinks', () => {
  const ZERO = nutrients(0, 0, 0, 0, 0, 0, 0, 0);
  const SALMON = nutrients(206, 22.1, 0, 12.4, 2.5, 0, 0, 61);
  const SOY_MILK = nutrients(54, 3.3, 6.3, 1.8, 0.2, 0.6, 4, 51);

  function text(items: FoodAnalysisItem[]): FoodAnalysisOutput {
    return analysis({ input_type: 'text', items });
  }

  it('turns per-100 g estimates into item amounts and keeps only valid values', () => {
    const result = normalizeAnalysis(
      text([
        item('Salmon fillet, baked', 140, SALMON, {
          micros_per_100g: micros({
            vitamin_d_ug: 13.1,
            vitamin_b12_ug: 2.8,
            potassium_mg: 384,
            cholesterol_mg: 63,
            vitamin_c_mg: -5,
            iron_mg: Number.NaN,
            caffeine_mg: 0,
          }),
        }),
      ]),
      { mode: 'text' },
    );

    expect(result.items[0]).toMatchObject({
      microsPer100g: {
        vitaminD: 13.1,
        vitaminB12: 2.8,
        potassium: 384,
        cholesterol: 63,
        caffeine: 0,
      },
      micros: {
        vitaminD: 18.3,
        vitaminB12: 3.92,
        potassium: 538,
        cholesterol: 88,
        caffeine: 0,
      },
      fluidMl: null,
    });
    expect(result.items[0]?.micros).not.toHaveProperty('vitaminC');
    expect(result.items[0]?.micros).not.toHaveProperty('iron');
  });

  it('has no micros when the model knew none', () => {
    const result = normalizeAnalysis(
      text([item('Mystery stew', 300, SALMON)]),
      { mode: 'text' },
    );

    expect(result.items[0]).toMatchObject({
      micros: null,
      microsPer100g: null,
    });
  });

  it('logs a vitamin D3 softgel with the label amount per unit', () => {
    const result = normalizeAnalysis(
      text([
        item('Vitamin D3 125 mcg (5000 IU) softgel', 1, ZERO, {
          count: 1,
          unit: 'softgel',
          unit_plural: 'softgels',
          micros_per_100g: micros({ vitamin_d_ug: 12500 }),
          confidence: 'high',
        }),
      ]),
      { mode: 'text' },
    );

    expect(result.items[0]).toMatchObject({
      grams: 1,
      count: 1,
      unit: 'softgel',
      nutrients: { calories: 0 },
      microsPer100g: { vitaminD: 12500 },
      micros: { vitaminD: 125 },
      fluidMl: null,
    });
    expect(result.totals.calories).toBe(0);
  });

  it('drops an item amount above the sanity maximum but keeps its per-100 g value', () => {
    const result = normalizeAnalysis(
      text([
        item('Vitamin D3 softgels', 30, ZERO, {
          micros_per_100g: micros({ vitamin_d_ug: 12500, calcium_mg: 10 }),
        }),
      ]),
      { mode: 'text' },
    );

    expect(result.items[0]?.microsPer100g).toEqual({
      vitaminD: 12500,
      calcium: 10,
    });
    expect(result.items[0]?.micros).toEqual({ calcium: 3 });
  });

  it('counts a diet soda as a drink with its caffeine', () => {
    const result = normalizeAnalysis(
      text([
        item('Diet Pepsi', 330, nutrients(0, 0, 0, 0, 0, 0, 0, 10), {
          count: 1,
          unit: 'can',
          unit_plural: 'cans',
          fluid_ml: 330,
          micros_per_100g: micros({ caffeine_mg: 10.6, potassium_mg: 11 }),
        }),
      ]),
      { mode: 'text' },
    );

    expect(result.items[0]).toMatchObject({
      fluidMl: 330,
      micros: { caffeine: 35, potassium: 36 },
      nutrients: { calories: 0, sodium: 33 },
    });
  });

  it.each([
    [250.4, 250],
    [330, 330],
    [5000, 5000],
    [0.4, null],
    [0, null],
    [-10, null],
    [5001, null],
    [null, null],
  ])('stores fluid_ml %s as %s ml', (fluid, expected) => {
    const result = normalizeAnalysis(
      text([item('Water', 250, ZERO, { fluid_ml: fluid })]),
      { mode: 'text' },
    );

    expect(result.items[0]?.fluidMl).toBe(expected);
  });

  it('keeps printed label vitamins and lets them override the estimate', () => {
    const yogurt = nutrients(96, 3.5, 13.8, 3, 1.9, 0.2, 12.5, 45);
    const result = normalizeAnalysis(
      analysis({
        input_type: 'nutrition_label',
        items: [
          item('Strawberry yogurt', 200, yogurt, {
            micros_per_100g: micros({ vitamin_a_ug_rae: 27, calcium_mg: 100 }),
          }),
        ],
        label: {
          product_name: 'Strawberry yogurt',
          basis_unit: 'g',
          per_100: yogurt,
          micros_per_100: micros({ calcium_mg: 120, vitamin_d_ug: -1 }),
          serving_size: 120,
          serving_text: '1 cup (120 g)',
          pack_size: 120,
        },
      }),
      { mode: 'nutrition_label' },
    );

    expect(result.label?.microsPer100).toEqual({ calcium: 120 });
    expect(result.items[0]).toMatchObject({
      microsPer100g: { vitaminA: 27, calcium: 120 },
      micros: { vitaminA: 54, calcium: 240 },
    });
  });

  it('uses the micros of a saved food when it has them and the estimate otherwise', () => {
    const savedId = '019a0000-0000-7000-8000-0000000000e1';
    const plainId = '019a0000-0000-7000-8000-0000000000e2';
    const soyMilk = toSavedFood({
      id: savedId,
      name: 'Alpro soya drink',
      brand: null,
      aliases: ['soy milk'],
      basisUnit: 'ml',
      unitName: 'glass',
      unitGrams: 250,
      servingSizeG: 250,
      microsPer100: { calcium: 120, vitaminD: 0.75, vitaminB12: 0.38 },
      ...zeroNutrients(),
      calories: 39,
      protein: 3,
    });
    const oats = toSavedFood({
      id: plainId,
      name: 'Rolled oats',
      brand: null,
      aliases: [],
      basisUnit: 'g',
      unitName: null,
      unitGrams: null,
      servingSizeG: null,
      microsPer100: null,
      ...zeroNutrients(),
      calories: 379,
    });
    const result = normalizeAnalysis(
      text([
        item('Soy milk', 400, SOY_MILK, {
          saved_food: 'Alpro soya drink',
          count: 2,
          unit: 'glass',
          unit_plural: 'glasses',
          fluid_ml: 400,
          micros_per_100g: micros({ calcium_mg: 25, iron_mg: 0.4 }),
        }),
        item('Rolled oats', 50, nutrients(379, 13, 68, 6.5, 1.1, 10, 1, 6), {
          micros_per_100g: micros({ iron_mg: 4.3, magnesium_mg: 138 }),
        }),
      ]),
      { mode: 'text', savedFoods: [soyMilk, oats] },
    );

    expect(result.items[0]).toMatchObject({
      grams: 500,
      fluidMl: 500,
      savedFood: { id: savedId, microsPer100: { calcium: 120 } },
      microsPer100g: { calcium: 120, vitaminD: 0.75, vitaminB12: 0.38 },
      micros: { calcium: 600, vitaminD: 3.8, vitaminB12: 1.9 },
    });
    expect(result.items[0]?.micros).not.toHaveProperty('iron');
    expect(result.items[1]).toMatchObject({
      savedFood: { id: plainId, microsPer100: null },
      microsPer100g: { iron: 4.3, magnesium: 138 },
      micros: { iron: 2.2, magnesium: 69 },
    });
  });
});
