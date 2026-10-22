import {
  type EntryItemInput,
  type FoodSearchResult,
  zeroNutrients,
} from '@food/shared';
import {
  IDEA_FOOD_CONTENTS_MAX,
  IDEA_FOODS_MAX,
  listFoods,
  toIdeaFood,
  usualAmount,
} from './meal-ideas-foods.js';

function item(name: string, grams: number, calories: number): EntryItemInput {
  return { name, grams, nutrients: { ...zeroNutrients(), calories } };
}

function food(overrides: Partial<FoodSearchResult> = {}): FoodSearchResult {
  return {
    key: 'meal:1',
    kind: 'meal',
    name: 'Chicken wrap',
    detail: null,
    items: [item('Chicken wrap', 320, 640)],
    totals: { ...zeroNutrients(), calories: 640 },
    grams: 320,
    portion: null,
    mealType: 'lunch',
    photo: null,
    favoriteId: null,
    entryId: 'entry-1',
    productId: null,
    useCount: 5,
    lastUsedAt: null,
    starred: false,
    ...overrides,
  };
}

describe('listFoods', () => {
  it('gives each food a short id in list order and keeps at most the prompt limit', () => {
    const results = Array.from({ length: IDEA_FOODS_MAX + 5 }, (_, index) =>
      food({ key: `meal:${index}`, name: `Food ${index}` }),
    );

    const listed = listFoods(results);

    expect(listed).toHaveLength(IDEA_FOODS_MAX);
    expect(listed[0]).toEqual({ id: 'F1', food: results[0] });
    expect(listed.at(-1)?.id).toBe(`F${IDEA_FOODS_MAX}`);
  });
});

describe('usualAmount', () => {
  it('leads with the counted portion and adds the weight', () => {
    expect(
      usualAmount({
        portion: { count: 1.5, unit: 'burger', unitPlural: 'burgers' },
        grams: 389.6,
      }),
    ).toBe('1½ burgers (390 g)');
  });

  it('falls back to the weight, then to one serving', () => {
    expect(usualAmount({ portion: null, grams: 125 })).toBe('125 g');
    expect(usualAmount({ portion: null, grams: 0 })).toBe('1 serving');
    expect(
      usualAmount({
        portion: { count: 2, unit: 'slice', unitPlural: 'slices' },
        grams: 0,
      }),
    ).toBe('2 slices');
  });
});

describe('toIdeaFood', () => {
  it('describes a single food by its own totals without contents', () => {
    expect(toIdeaFood({ id: 'F3', food: food() })).toEqual({
      id: 'F3',
      name: 'Chicken wrap',
      amount: '320 g',
      contains: [],
      nutrients: { ...zeroNutrients(), calories: 640 },
      useCount: 5,
      mealType: 'lunch',
    });
  });

  it('names the first few items of a meal made of several foods', () => {
    const items = ['Chicken', 'Rice', 'Salad', 'Garlic sauce', 'Pickles'].map(
      (name) => item(`  ${name}  `, 100, 100),
    );

    const described = toIdeaFood({
      id: 'F1',
      food: food({ name: 'Lunch at home', items }),
    });

    expect(described.contains).toEqual(
      ['Chicken', 'Rice', 'Salad', 'Garlic sauce'].slice(
        0,
        IDEA_FOOD_CONTENTS_MAX,
      ),
    );
  });
});
