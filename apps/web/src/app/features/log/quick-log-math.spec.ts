import { API_LIMITS, MAX_ITEM_GRAMS, zeroNutrients, type FoodSearchResult } from '@food/shared';
import {
  QUICK_SERVING_MAX,
  QUICK_SERVING_MIN,
  baselinePhrase,
  quickBaseline,
  quickLogGrams,
  scaledResultPortion,
  clampQuickGrams,
  clampServings,
  defaultMealType,
  defaultPortion,
  isValidPortion,
  portionFactor,
  quickLogBody,
  quickLogTotals,
  scaledEntryItems,
  servingChipLabel,
  stepQuickServings,
  usesGrams,
} from './quick-log-math';

const YOGURT_TOTALS = { ...zeroNutrients(), calories: 150, protein: 6.1, carbs: 22, fat: 4.2 };

function result(overrides: Partial<FoodSearchResult> = {}): FoodSearchResult {
  return {
    portion: null,
    key: 'food:item-1',
    kind: 'food',
    name: 'Khoury strawberry yogurt',
    detail: 'Breakfast bowl',
    items: [{ name: 'Khoury strawberry yogurt', grams: 170, nutrients: YOGURT_TOTALS }],
    totals: YOGURT_TOTALS,
    grams: 170,
    mealType: 'breakfast',
    photo: null,
    favoriteId: null,
    entryId: 'entry-1',
    useCount: 4,
    lastUsedAt: '2026-09-25T07:00:00.000Z',
    productId: null,
    starred: false,
    ...overrides,
  };
}

const meal = (): FoodSearchResult =>
  result({
    key: 'meal:entry-2',
    kind: 'meal',
    name: 'Chicken plate',
    detail: null,
    items: [
      {
        name: 'Chicken',
        grams: 180,
        nutrients: { ...zeroNutrients(), calories: 390, protein: 45 },
      },
      { name: 'Fries', grams: 120, nutrients: { ...zeroNutrients(), calories: 370, fat: 18 } },
    ],
    totals: { ...zeroNutrients(), calories: 760, protein: 45, fat: 18 },
    grams: 300,
  });

describe('portion mode', () => {
  it('uses grams for single foods with a known weight and servings otherwise', () => {
    expect(usesGrams(result())).toBe(true);
    expect(defaultPortion(result())).toEqual({ mode: 'grams', grams: 170 });
    expect(usesGrams(result({ grams: 0 }))).toBe(false);
    expect(defaultPortion(meal())).toEqual({ mode: 'servings', servings: 1 });
  });

  it('uses grams for a food that was logged on its own, as a meal or a favorite', () => {
    const single = result({ key: 'meal:entry-3', kind: 'meal', detail: null });
    expect(usesGrams(single)).toBe(true);
    expect(defaultPortion(single)).toEqual({ mode: 'grams', grams: 170 });
    const starred = result({ key: 'favorite:f1', kind: 'favorite', favoriteId: 'f1' });
    expect(usesGrams(starred)).toBe(true);
    expect(defaultPortion(starred)).toEqual({ mode: 'grams', grams: 170 });
  });

  it('keeps servings for several items or an unknown weight', () => {
    expect(usesGrams(meal())).toBe(false);
    expect(usesGrams({ ...meal(), key: 'favorite:f2', kind: 'favorite' })).toBe(false);
    expect(defaultPortion(result({ key: 'meal:entry-3', kind: 'meal', grams: 0 }))).toEqual({
      mode: 'servings',
      servings: 1,
    });
    expect(defaultPortion(result({ key: 'favorite:f1', kind: 'favorite', grams: 0 }))).toEqual({
      mode: 'servings',
      servings: 1,
    });
  });

  it('uses grams for scanned products too', () => {
    const product = result({ key: 'product:p1', kind: 'product', productId: 'p1', grams: 30 });
    expect(usesGrams(product)).toBe(true);
    expect(defaultPortion(product)).toEqual({ mode: 'grams', grams: 30 });
    const timing = { timestamp: '2026-09-28T07:00:00.000Z', localDate: '2026-09-28' };
    expect(quickLogBody(product, { mode: 'grams', grams: 45 }, 'snack', timing)).toEqual({
      key: 'product:p1',
      grams: 45,
      ...timing,
      mealType: 'snack',
    });
  });
});

describe('quick log amounts', () => {
  it('scales totals live by grams relative to the last amount', () => {
    const totals = quickLogTotals(result(), { mode: 'grams', grams: 255 });
    expect(portionFactor(result(), { mode: 'grams', grams: 255 })).toBe(1.5);
    expect(totals.calories).toBe(225);
    expect(totals.protein).toBe(9.1);
    expect(totals.fat).toBe(6.3);
  });

  it('scales totals by servings', () => {
    const totals = quickLogTotals(meal(), { mode: 'servings', servings: 0.5 });
    expect(totals.calories).toBe(380);
    expect(totals.protein).toBe(22.5);
  });

  it('clamps servings and grams to what the API accepts', () => {
    expect(clampServings(0)).toBe(QUICK_SERVING_MIN);
    expect(clampServings(99)).toBe(QUICK_SERVING_MAX);
    expect(clampServings(Number.NaN)).toBe(1);
    expect(clampServings(1.333)).toBe(1.33);
    expect(QUICK_SERVING_MAX).toBe(API_LIMITS.favoriteServingsMax);
    expect(clampQuickGrams(0)).toBe(1);
    expect(clampQuickGrams(MAX_ITEM_GRAMS * 2)).toBe(MAX_ITEM_GRAMS);
    expect(clampQuickGrams(Number.NaN)).toBe(1);
    expect(clampQuickGrams(12.34)).toBe(12.3);
  });

  it('steps servings in quarters and snaps to the grid', () => {
    expect(stepQuickServings(1, 1)).toBe(1.25);
    expect(stepQuickServings(1, -1)).toBe(0.75);
    expect(stepQuickServings(1.1, 1)).toBe(1.25);
    expect(stepQuickServings(1.1, -1)).toBe(1);
    expect(stepQuickServings(0.25, -1)).toBe(QUICK_SERVING_MIN);
    expect(stepQuickServings(QUICK_SERVING_MAX, 1)).toBe(QUICK_SERVING_MAX);
  });

  it('validates the entered portion', () => {
    expect(isValidPortion({ mode: 'grams', grams: 0 })).toBe(false);
    expect(isValidPortion({ mode: 'grams', grams: 1 })).toBe(true);
    expect(isValidPortion({ mode: 'servings', servings: 0.05 })).toBe(false);
    expect(isValidPortion({ mode: 'servings', servings: 0.25 })).toBe(true);
  });
});

describe('quickLogBody', () => {
  const timing = { timestamp: '2026-09-28T07:30:00.000Z', localDate: '2026-09-28' };

  it('sends grams for single foods', () => {
    expect(quickLogBody(result(), { mode: 'grams', grams: 85 }, 'snack', timing)).toEqual({
      key: 'food:item-1',
      grams: 85,
      timestamp: timing.timestamp,
      localDate: '2026-09-28',
      mealType: 'snack',
    });
  });

  it('sends only grams for a single-item meal or favorite', () => {
    for (const key of ['meal:entry-3', 'favorite:f1']) {
      const single = result({ key, kind: key.startsWith('meal') ? 'meal' : 'favorite' });
      const body = quickLogBody(single, { mode: 'grams', grams: 255 }, 'breakfast', timing);
      expect(body).toEqual({
        key,
        grams: 255,
        timestamp: timing.timestamp,
        localDate: '2026-09-28',
        mealType: 'breakfast',
      });
      expect('servings' in body).toBe(false);
    }
  });

  it('sends servings for meals and favorites', () => {
    expect(quickLogBody(meal(), { mode: 'servings', servings: 1.5 }, 'lunch', timing)).toEqual({
      key: 'meal:entry-2',
      servings: 1.5,
      timestamp: timing.timestamp,
      localDate: '2026-09-28',
      mealType: 'lunch',
    });
  });
});

describe('counted portions', () => {
  const timing = { timestamp: '2026-09-30T19:00:00.000Z', localDate: '2026-09-30' };
  const burgers = (): FoodSearchResult =>
    result({
      ...meal(),
      key: 'meal:entry-5',
      name: 'Black Angus burgers',
      items: [
        {
          name: 'Patty',
          grams: 400,
          nutrients: { ...zeroNutrients(), calories: 1000 },
          count: 2,
          unit: 'patty',
          unitPlural: 'patties',
        },
        { name: 'Bun', grams: 380, nutrients: { ...zeroNutrients(), calories: 450 } },
      ],
      totals: { ...zeroNutrients(), calories: 1450 },
      grams: 780,
      portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
    });

  it("starts from last time's count and logs 1½ of 2 burgers as three quarters", () => {
    const portion = defaultPortion(burgers());
    expect(portion).toEqual({ mode: 'count', count: 2 });
    const oneAndHalf = { mode: 'count', count: 1.5 } as const;
    expect(portionFactor(burgers(), oneAndHalf)).toBe(0.75);
    expect(quickLogTotals(burgers(), oneAndHalf).calories).toBe(1088);
    expect(quickLogGrams(burgers(), oneAndHalf)).toBe(585);
    expect(quickLogBody(burgers(), oneAndHalf, 'dinner', timing)).toEqual({
      key: 'meal:entry-5',
      portionCount: 1.5,
      ...timing,
      mealType: 'dinner',
    });
    expect(scaledResultPortion(burgers(), oneAndHalf)).toEqual({
      count: 1.5,
      unit: 'burger',
      unitPlural: 'burgers',
    });
    expect(isValidPortion(oneAndHalf)).toBe(true);
    expect(isValidPortion({ mode: 'count', count: 0 })).toBe(false);
  });

  it('re-logs a small counted amount exactly as last time', () => {
    const slice = result({
      ...burgers(),
      portion: { count: 0.2, unit: 'cake', unitPlural: 'cakes' },
    });
    const portion = defaultPortion(slice);
    expect(portion).toEqual({ mode: 'count', count: 0.2 });
    expect(portionFactor(slice, portion)).toBe(1);
    expect(quickLogTotals(slice, portion).calories).toBe(1450);
    expect(quickLogBody(slice, portion, 'dinner', timing)).toMatchObject({ portionCount: 0.2 });
  });

  it('logs typed grams of a counted meal as servings', () => {
    expect(quickLogBody(burgers(), { mode: 'grams', grams: 390 }, 'dinner', timing)).toMatchObject({
      servings: 0.5,
    });
  });

  it('previews exactly what typed grams of a meal will log, even for small amounts', () => {
    const small = { mode: 'grams', grams: 100 } as const;
    const factor = portionFactor(burgers(), small);
    expect(factor).toBe(0.1282);
    expect(quickLogBody(burgers(), small, 'dinner', timing)).toMatchObject({ servings: factor });
    expect(quickLogTotals(burgers(), small).calories).toBe(186);
    expect(scaledResultPortion(burgers(), small)?.count).toBe(0.26);

    const tiny = { mode: 'grams', grams: 10 } as const;
    expect(portionFactor(burgers(), tiny)).toBe(0.1);
    expect(quickLogBody(burgers(), tiny, 'dinner', timing)).toMatchObject({ servings: 0.1 });
    expect(quickLogTotals(burgers(), tiny).calories).toBe(145);
  });

  it('scales item counts with the items', () => {
    const items = scaledEntryItems(burgers().items, 0.75);
    expect(items[0]).toMatchObject({ grams: 300, count: 1.5, unit: 'patty' });
    expect(items[1]).toMatchObject({ grams: 285, count: null });
  });

  it('scales vitamins and drink ml with the same factor as grams', () => {
    const items = scaledEntryItems(
      [
        {
          name: 'Diet Pepsi',
          grams: 330,
          nutrients: { ...zeroNutrients(), sodium: 40 },
          micros: { caffeine: 36, vitaminC: 0 },
          fluidMl: 330,
        },
        { name: 'Bun', grams: 70, nutrients: { ...zeroNutrients(), calories: 190 } },
      ],
      1.5,
    );
    expect(items[0]).toMatchObject({
      grams: 495,
      micros: { caffeine: 54, vitaminC: 0 },
      fluidMl: 495,
    });
    expect(items[1]).not.toHaveProperty('micros');
    expect(items[1]).not.toHaveProperty('fluidMl');
  });

  it('spells out multipliers against last time or a serving', () => {
    expect(quickBaseline(meal())).toBe('last_time');
    expect(quickBaseline(result())).toBe('last_time');
    expect(quickBaseline(result({ kind: 'favorite' }))).toBe('serving');
    expect(quickBaseline(result({ kind: 'product' }))).toBe('serving');
    expect(baselinePhrase('last_time', 0.5)).toBe('½ of last time');
    expect(baselinePhrase('last_time', 1)).toBe('Same as last time');
    expect(baselinePhrase('last_time', 1.5)).toBe('1½× last time');
    expect(baselinePhrase('last_time', 0.75)).toBe('¾ of last time');
    expect(baselinePhrase('last_time', 1.75)).toBe('1¾× last time');
    expect(baselinePhrase('serving', 2.25)).toBe('2¼ servings');
    expect(baselinePhrase('serving', 0.5)).toBe('½ serving');
    expect(baselinePhrase('serving', 1)).toBe('1 serving');
    expect(baselinePhrase('serving', 2)).toBe('2 servings');
  });
});

describe('defaultMealType', () => {
  const evening = new Date(2026, 8, 28, 19, 0);

  it('guesses from the time of day', () => {
    expect(defaultMealType(result(), evening)).toBe('dinner');
    expect(defaultMealType(meal(), new Date(2026, 8, 28, 8, 0))).toBe('breakfast');
  });

  it("uses a favorite's own meal type", () => {
    expect(defaultMealType(result({ kind: 'favorite', mealType: 'breakfast' }), evening)).toBe(
      'breakfast',
    );
    expect(defaultMealType(result({ kind: 'favorite', mealType: null }), evening)).toBe('dinner');
  });
});

describe('scaledEntryItems', () => {
  it('scales grams and nutrients of every item', () => {
    const items = scaledEntryItems(meal().items, 0.5);
    expect(items.map((item) => item.grams)).toEqual([90, 60]);
    expect(items[0].nutrients.calories).toBe(195);
    expect(items[1].nutrients.fat).toBe(9);
    expect(items[0].confidence).toBeNull();
  });

  it('keeps saved-food links while scaling', () => {
    const [chicken, other] = meal().items;
    const items = scaledEntryItems([{ ...chicken!, productId: 'food-chicken' }, other!], 2);
    expect(items[0]).toMatchObject({ productId: 'food-chicken', grams: 360 });
    expect(items[1]).not.toHaveProperty('productId');
  });

  it('keeps the amounts for an invalid factor', () => {
    expect(scaledEntryItems(meal().items, Number.NaN)[0].grams).toBe(180);
  });
});

describe('labels', () => {
  it('formats serving chips', () => {
    expect(servingChipLabel(0.5)).toBe('½');
    expect(servingChipLabel(1.5)).toBe('1½');
    expect(servingChipLabel(0.75)).toBe('¾');
  });
});
