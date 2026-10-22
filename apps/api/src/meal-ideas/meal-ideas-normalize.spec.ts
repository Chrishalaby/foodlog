import {
  API_LIMITS,
  type EntryItemInput,
  type FoodSearchResult,
  MAX_ITEM_GRAMS,
  type Nutrients,
  roundNutrients,
  sumNutrients,
  zeroNutrients,
} from '@food/shared';
import type { ListedFood } from './meal-ideas-foods.js';
import {
  ideaServings,
  NO_IDEAS_SUMMARY,
  normalizeMealIdeas,
} from './meal-ideas-normalize.js';
import type {
  MealIdeaOutput,
  MealIdeaPartOutput,
  MealIdeasOutput,
  NewFoodEstimate,
} from './meal-ideas.schema.js';

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function item(
  name: string,
  grams: number,
  values: Partial<Nutrients> = {},
  extras: Partial<EntryItemInput> = {},
): EntryItemInput {
  return { name, grams, nutrients: nutrients(values), ...extras };
}

function listed(
  id: string,
  name: string,
  items: EntryItemInput[],
  overrides: Partial<FoodSearchResult> = {},
): ListedFood {
  return {
    id,
    food: {
      key: `meal:${id}`,
      kind: 'meal',
      name,
      detail: null,
      items,
      totals: roundNutrients(sumNutrients(items.map((i) => i.nutrients))),
      grams: items.reduce((sum, i) => sum + i.grams, 0),
      portion: null,
      mealType: 'lunch',
      photo: null,
      favoriteId: null,
      entryId: `entry-${id}`,
      productId: null,
      useCount: 4,
      lastUsedAt: null,
      starred: false,
      ...overrides,
    },
  };
}

const WRAP = listed(
  'F1',
  'Chicken wrap',
  [
    item(
      'Chicken wrap',
      320,
      { calories: 640, protein: 40, carbs: 60, fat: 24, sodium: 1100 },
      {
        count: 1,
        unit: 'wrap',
        unitPlural: 'wraps',
        productId: '0198f6a0-0000-7000-8000-000000000001',
        micros: { iron: 3 },
      },
    ),
  ],
  { portion: { count: 1, unit: 'wrap', unitPlural: 'wraps' } },
);

const YOGURT = listed(
  'F2',
  'Khoury strawberry yogurt',
  [item('Khoury strawberry yogurt', 125, { calories: 110, protein: 5 })],
  { key: 'product:yogurt', kind: 'product' },
);

const PLATE = listed('F3', 'Lunch at home', [
  item('Chicken breast, grilled', 180, { calories: 297, protein: 55 }),
  item('White rice', 200, { calories: 260, protein: 5, carbs: 57 }),
]);

function listedPart(
  foodId: string | null,
  name: string,
  servings = 1,
): MealIdeaPartOutput {
  return { food_id: foodId, name, servings, estimate: null };
}

function estimate(overrides: Partial<NewFoodEstimate> = {}): NewFoodEstimate {
  return {
    grams: 100,
    portion: { count: 2, unit: 'egg', unit_plural: 'eggs' },
    calories: 155,
    protein_g: 13,
    carbs_g: 1.1,
    fat_g: 11,
    saturated_fat_g: 3.3,
    fiber_g: 0,
    sugar_g: 1.1,
    sodium_mg: 124,
    ...overrides,
  };
}

function newPart(
  name: string,
  values: Partial<NewFoodEstimate> = {},
): MealIdeaPartOutput {
  return { food_id: null, name, servings: 1, estimate: estimate(values) };
}

function idea(
  title: string,
  parts: MealIdeaPartOutput[],
  overrides: Partial<MealIdeaOutput> = {},
): MealIdeaOutput {
  return {
    title,
    meal_type: 'dinner',
    parts,
    reason: 'Fits what is left',
    ...overrides,
  };
}

function output(ideas: MealIdeaOutput[]): MealIdeasOutput {
  return { summary: '  Protein is the gap  to close. ', ideas };
}

const FOODS = [WRAP, YOGURT, PLATE];

describe('normalizeMealIdeas', () => {
  it("takes a listed food's nutrition from the user's records and scales it by servings", () => {
    const { ideas, summary } = normalizeMealIdeas(
      output([idea('Wrap and a half', [listedPart('f1', 'whatever', 1.5)])]),
      FOODS,
    );

    expect(summary).toBe('Protein is the gap to close.');
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({
      title: 'Wrap and a half',
      mealType: 'dinner',
      reason: 'Fits what is left',
      grams: 480,
      totals: nutrients({
        calories: 960,
        protein: 60,
        carbs: 90,
        fat: 36,
        sodium: 1650,
      }),
    });
    expect(ideas[0]?.parts).toEqual([
      {
        name: 'Chicken wrap',
        foodKey: 'meal:F1',
        servings: 1.5,
        grams: 480,
        portion: { count: 1.5, unit: 'wrap', unitPlural: 'wraps' },
        nutrients: nutrients({
          calories: 960,
          protein: 60,
          carbs: 90,
          fat: 36,
          sodium: 1650,
        }),
        items: [
          {
            name: 'Chicken wrap',
            grams: 480,
            nutrients: nutrients({
              calories: 960,
              protein: 60,
              carbs: 90,
              fat: 36,
              sodium: 1650,
            }),
            count: 1.5,
            unit: 'wrap',
            unitPlural: 'wraps',
            productId: '0198f6a0-0000-7000-8000-000000000001',
            micros: { iron: 4.5 },
            fluidMl: null,
          },
        ],
      },
    ]);
  });

  it('ignores the numbers the model writes for a listed food', () => {
    const { ideas } = normalizeMealIdeas(
      output([
        idea('Yogurt', [
          {
            food_id: 'F2',
            name: 'Khoury strawberry yogurt',
            servings: 1,
            estimate: estimate({ grams: 500, calories: 999 }),
          },
        ]),
      ]),
      FOODS,
    );

    expect(ideas[0]?.totals.calories).toBe(110);
    expect(ideas[0]?.parts[0]).toMatchObject({
      foodKey: 'product:yogurt',
      grams: 125,
    });
  });

  it('keeps a listed meal as one part that logs all of its items', () => {
    const { ideas } = normalizeMealIdeas(
      output([idea('Half the usual lunch', [listedPart('F3', 'Lunch', 0.5)])]),
      FOODS,
    );

    expect(ideas[0]?.parts).toHaveLength(1);
    expect(ideas[0]?.parts[0]?.items.map((i) => [i.name, i.grams])).toEqual([
      ['Chicken breast, grilled', 90],
      ['White rice', 100],
    ]);
    expect(ideas[0]?.totals).toMatchObject({ calories: 279, protein: 30 });
  });

  it('links a part without an id to the listed food of the same name, unless it brings its own estimate', () => {
    const { ideas } = normalizeMealIdeas(
      output([
        idea('By name', [listedPart(null, '  khoury STRAWBERRY yogurt ')]),
        idea('Own estimate', [
          newPart('Khoury strawberry yogurt', { grams: 200, calories: 176 }),
        ]),
      ]),
      FOODS,
    );

    expect(ideas[0]?.parts[0]).toMatchObject({
      foodKey: 'product:yogurt',
      servings: 1,
      grams: 125,
    });
    expect(ideas[1]?.parts[0]).toMatchObject({
      foodKey: null,
      servings: null,
      grams: 200,
    });
  });

  it('turns a new food into one loggable item with its count and medium confidence', () => {
    const { ideas } = normalizeMealIdeas(
      output([idea('Eggs', [newPart('  Boiled   eggs ')])]),
      FOODS,
    );

    expect(ideas[0]?.parts).toEqual([
      {
        name: 'Boiled eggs',
        foodKey: null,
        servings: null,
        grams: 100,
        portion: { count: 2, unit: 'egg', unitPlural: 'eggs' },
        nutrients: nutrients({
          calories: 155,
          protein: 13,
          carbs: 1.1,
          fat: 11,
          satFat: 3.3,
          sugar: 1.1,
          sodium: 124,
        }),
        items: [
          {
            name: 'Boiled eggs',
            grams: 100,
            nutrients: nutrients({
              calories: 155,
              protein: 13,
              carbs: 1.1,
              fat: 11,
              satFat: 3.3,
              sugar: 1.1,
              sodium: 124,
            }),
            confidence: 'medium',
            count: 2,
            unit: 'egg',
            unitPlural: 'eggs',
          },
        ],
      },
    ]);
  });

  it('adds listed and new parts into one total', () => {
    const { ideas } = normalizeMealIdeas(
      output([
        idea('Wrap with eggs', [
          listedPart('F1', 'Chicken wrap'),
          newPart('Boiled eggs', { portion: null }),
        ]),
      ]),
      FOODS,
    );

    expect(ideas[0]?.grams).toBe(420);
    expect(ideas[0]?.totals).toMatchObject({ calories: 795, protein: 53 });
    expect(ideas[0]?.parts[1]?.items[0]).toMatchObject({
      count: null,
      unit: null,
      unitPlural: null,
    });
  });

  it('drops parts that are neither listed nor estimated, and ideas left with nothing', () => {
    const { ideas } = normalizeMealIdeas(
      output([
        idea('Unknown only', [listedPart('F99', 'Mystery food')]),
        idea('Empty estimate', [
          newPart('Nothing', { grams: 0, calories: 0, protein_g: 0, fat_g: 0 }),
          newPart('   '),
        ]),
        idea('Mixed', [
          listedPart('F99', 'Mystery food'),
          listedPart('F2', 'Yogurt'),
        ]),
      ]),
      FOODS,
    );

    expect(ideas.map((i) => i.title)).toEqual(['Mixed']);
    expect(ideas[0]?.parts.map((part) => part.name)).toEqual([
      'Khoury strawberry yogurt',
    ]);
  });

  it('falls back to one serving when the scaled amount would break the item limits', () => {
    const heavy = listed('F4', 'Party platter', [
      item('Party platter', MAX_ITEM_GRAMS / 2, { calories: 9000 }),
    ]);

    const { ideas } = normalizeMealIdeas(
      output([idea('Platter', [listedPart('F4', 'Party platter', 3)])]),
      [heavy],
    );

    expect(ideas[0]?.parts[0]).toMatchObject({
      servings: 1,
      grams: MAX_ITEM_GRAMS / 2,
    });
  });

  it('keeps the asked number of ideas, unique by title, with the part limit', () => {
    const many = Array.from(
      { length: API_LIMITS.mealIdeaPartsMax + 3 },
      (_, index) => newPart(`Food ${index}`),
    );

    const { ideas } = normalizeMealIdeas(
      output([
        idea('Yogurt', [listedPart('F2', 'Yogurt')]),
        idea('  yogurt ', [listedPart('F2', 'Yogurt', 2)]),
        idea('Big plate', many),
        idea('Wrap', [listedPart('F1', 'Wrap')]),
        idea('Lunch', [listedPart('F3', 'Lunch')]),
      ]),
      FOODS,
      3,
    );

    expect(ideas.map((i) => i.title)).toEqual(['Yogurt', 'Big plate', 'Wrap']);
    expect(ideas[1]?.parts).toHaveLength(API_LIMITS.mealIdeaPartsMax);
  });

  it('never returns more items than one entry can hold', () => {
    const big = listed(
      'F5',
      'Buffet',
      Array.from({ length: API_LIMITS.itemsMax - 1 }, (_, index) =>
        item(`Dish ${index}`, 10, { calories: 10 }),
      ),
    );

    const { ideas } = normalizeMealIdeas(
      output([
        idea('Buffet with sides', [
          listedPart('F5', 'Buffet'),
          newPart('Bread'),
          newPart('Butter'),
        ]),
      ]),
      [big],
    );

    expect(ideas[0]?.parts.map((part) => part.name)).toEqual([
      'Buffet',
      'Bread',
    ]);
  });

  it('names an untitled idea after its parts and cuts long texts', () => {
    const { ideas } = normalizeMealIdeas(
      output([
        idea('   ', [listedPart('F1', 'Wrap'), listedPart('F2', 'Yogurt')], {
          reason: 'r'.repeat(500),
        }),
      ]),
      FOODS,
    );

    expect(ideas[0]?.title).toBe('Chicken wrap + Khoury strawberry yogurt');
    expect(ideas[0]?.reason).toHaveLength(200);
  });

  it('says so when nothing usable came back', () => {
    expect(normalizeMealIdeas(output([]), FOODS)).toEqual({
      summary: NO_IDEAS_SUMMARY,
      ideas: [],
    });
  });
});

describe('ideaServings', () => {
  it('keeps servings inside what quick log accepts, rounded to two decimals', () => {
    expect(ideaServings(0.754)).toBe(0.75);
    expect(ideaServings(0.01)).toBe(API_LIMITS.favoriteServingsMin);
    expect(ideaServings(99)).toBe(API_LIMITS.favoriteServingsMax);
  });

  it('means one serving when the model sends nonsense', () => {
    expect(ideaServings(0)).toBe(1);
    expect(ideaServings(-2)).toBe(1);
    expect(ideaServings(Number.NaN)).toBe(1);
  });
});
