import { zeroNutrients, type AnalysisItem, type AnalyzeResponse } from '@food/shared';
import {
  DEFAULT_MEAL_TIMES,
  hasTimingHint,
  mealClock,
  mealDayLabel,
  mealItemsLine,
  mealPlacement,
  mealProblem,
  mealTitle,
  mealsCalories,
  pendingMeal,
  pendingMealRequest,
  sharedMealDay,
  sortMeals,
  withMealDay,
  withMealTime,
  type PendingMeal,
} from './meal-batch';

const NOW = new Date(2026, 9, 4, 21, 30);
const DAY_START = 3;

function item(name: string, grams: number, calories: number): AnalysisItem {
  return {
    name,
    grams,
    count: null,
    unit: null,
    unitPlural: null,
    nutrients: { ...zeroNutrients(), calories },
    per100g: zeroNutrients(),
    micros: null,
    microsPer100g: null,
    fluidMl: null,
    confidence: 'medium',
    amountSource: 'user_stated',
    state: 'cooked',
    portionBasis: '',
    flags: [],
    savedFood: null,
    suggestedFood: null,
  };
}

function analysis(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    analysisId: 'a-1',
    mode: 'text',
    description: 'chicken and rice for lunch',
    result: {
      inputType: 'text',
      mealName: 'Chicken and rice',
      portion: null,
      scaleCues: 'none',
      items: [item('Chicken', 150, 248), item('Rice', 180, 234)],
      label: null,
      totals: zeroNutrients(),
      assumptions: [],
      followUpQuestion: null,
      followUpOptions: [],
      warnings: [],
    },
    photo: null,
    photos: [],
    usage: {
      model: 'mock',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      durationMs: 0,
      attempts: 1,
    },
    precise: false,
    ...overrides,
  };
}

function meal(id: number, overrides: Partial<AnalyzeResponse> = {}): PendingMeal {
  return pendingMeal(id, analysis(overrides), NOW, DAY_START);
}

describe('hasTimingHint', () => {
  it('needs a meal, a time or an earlier day', () => {
    expect(hasTimingHint(null)).toBe(false);
    expect(hasTimingHint(undefined)).toBe(false);
    expect(hasTimingHint({ mealType: null, time: null, daysAgo: 0 })).toBe(false);
    expect(hasTimingHint({ mealType: 'lunch', time: null, daysAgo: 0 })).toBe(true);
    expect(hasTimingHint({ mealType: null, time: '09:00', daysAgo: 0 })).toBe(true);
    expect(hasTimingHint({ mealType: null, time: null, daysAgo: 1 })).toBe(true);
  });
});

describe('mealPlacement', () => {
  it('logs now and guesses the meal without a hint', () => {
    expect(mealPlacement(null, NOW, DAY_START)).toEqual({
      dateTime: '2026-10-04T21:30',
      mealType: 'dinner',
      mealTypeAuto: true,
    });
  });

  it('uses the usual time of a named meal', () => {
    expect(
      mealPlacement({ mealType: 'breakfast', time: null, daysAgo: 0 }, NOW, DAY_START),
    ).toEqual({
      dateTime: `2026-10-04T${DEFAULT_MEAL_TIMES.breakfast}`,
      mealType: 'breakfast',
      mealTypeAuto: false,
    });
  });

  it('uses a stated time and guesses the meal from it', () => {
    expect(mealPlacement({ mealType: null, time: '12:30', daysAgo: 0 }, NOW, DAY_START)).toEqual({
      dateTime: '2026-10-04T12:30',
      mealType: 'lunch',
      mealTypeAuto: true,
    });
  });

  it('goes back whole days', () => {
    expect(
      mealPlacement({ mealType: 'dinner', time: null, daysAgo: 1 }, NOW, DAY_START).dateTime,
    ).toBe('2026-10-03T20:00');
    expect(mealPlacement({ mealType: null, time: null, daysAgo: 2 }, NOW, DAY_START)).toEqual({
      dateTime: '2026-10-02T21:30',
      mealType: 'dinner',
      mealTypeAuto: true,
    });
  });

  it('never places a meal in the future', () => {
    const afternoon = new Date(2026, 9, 4, 15, 0);

    expect(
      mealPlacement({ mealType: 'dinner', time: null, daysAgo: 0 }, afternoon, DAY_START),
    ).toEqual({ dateTime: '2026-10-04T15:00', mealType: 'dinner', mealTypeAuto: false });
  });

  it('counts a time after midnight toward the eating day', () => {
    const lateNight = new Date(2026, 9, 5, 1, 30);

    expect(
      mealPlacement({ mealType: 'snack', time: '00:45', daysAgo: 0 }, lateNight, DAY_START),
    ).toEqual({ dateTime: '2026-10-04T00:45', mealType: 'snack', mealTypeAuto: false });
    expect(
      mealPlacement({ mealType: 'dinner', time: null, daysAgo: 0 }, lateNight, DAY_START).dateTime,
    ).toBe('2026-10-04T20:00');
  });
});

describe('pending meals', () => {
  it('starts from the analysis without its sibling meals', () => {
    const pending = meal(1, {
      timing: { mealType: 'lunch', time: null, daysAgo: 0 },
      moreMeals: [analysis({ analysisId: 'a-2' })],
    });

    expect(pending.analysis.moreMeals).toBeUndefined();
    expect(pending).toMatchObject({
      id: 1,
      name: 'Chicken and rice',
      seedName: 'Chicken and rice',
      mealType: 'lunch',
      dateTime: '2026-10-04T13:00',
    });
    expect(pending.items.map((draft) => draft.name)).toEqual(['Chicken', 'Rice']);
  });

  it('sorts by time and keeps the described order for equal times', () => {
    const lunch = meal(1, { timing: { mealType: 'lunch', time: null, daysAgo: 0 } });
    const breakfast = meal(2, { timing: { mealType: 'breakfast', time: null, daysAgo: 0 } });
    const alsoLunch = meal(3, { timing: { mealType: 'lunch', time: null, daysAgo: 0 } });
    const yesterday = meal(4, { timing: { mealType: 'dinner', time: null, daysAgo: 1 } });

    expect(
      sortMeals([lunch, breakfast, alsoLunch, yesterday], DAY_START).map((item) => item.id),
    ).toEqual([4, 2, 1, 3]);
  });

  it('changes the time and follows it with the meal type only when that was a guess', () => {
    const guessed = meal(1, { timing: { mealType: null, time: '09:00', daysAgo: 0 } });
    const named = meal(2, { timing: { mealType: 'breakfast', time: null, daysAgo: 0 } });

    expect(withMealTime(guessed, '19:30', DAY_START)).toMatchObject({
      dateTime: '2026-10-04T19:30',
      mealType: 'dinner',
    });
    expect(withMealTime(named, '19:30', DAY_START)).toMatchObject({
      dateTime: '2026-10-04T19:30',
      mealType: 'breakfast',
    });
    expect(withMealTime(named, 'soon', DAY_START)).toBe(named);
  });

  it('moves a meal to another day and reports the shared day', () => {
    const lunch = meal(1, { timing: { mealType: 'lunch', time: null, daysAgo: 0 } });
    const dinner = meal(2, { timing: { mealType: 'dinner', time: null, daysAgo: 1 } });

    expect(sharedMealDay([lunch, dinner])).toBeNull();
    expect(sharedMealDay([lunch])).toBe('2026-10-04');
    expect(sharedMealDay([lunch, withMealDay(dinner, '2026-10-04')])).toBe('2026-10-04');
    expect(withMealDay(lunch, '2026-10-02').dateTime).toBe('2026-10-02T13:00');
    expect(withMealDay(lunch, 'nope')).toBe(lunch);
    expect(mealClock(lunch)).toBe('13:00');
    expect(mealDayLabel(lunch, '2026-10-04')).toBeNull();
    expect(mealDayLabel(dinner, '2026-10-04')).toBe('Yesterday');
  });

  it('summarises a meal for its row', () => {
    const big = meal(1, {
      result: {
        ...analysis().result,
        mealName: '',
        items: [
          item('Bun', 60, 170),
          item('Patty', 150, 300),
          item('Cheese', 20, 70),
          item('Ketchup', 15, 17),
        ],
      },
    });

    expect(mealTitle(big)).toBe('Bun, Patty +2 more');
    expect(mealItemsLine(big)).toBe('Bun 60 g · Patty 150 g · Cheese 20 g · +1 more');
    expect(mealsCalories([big, meal(2)])).toBe(557 + 482);
  });
});

describe('pendingMealRequest', () => {
  it('builds the entry from the meal as it stands', () => {
    const lunch = meal(1, { timing: { mealType: 'lunch', time: '13:20', daysAgo: 1 } });

    const request = pendingMealRequest({ ...lunch, name: '  Chicken bowl ' }, DAY_START);

    expect(request).toMatchObject({
      name: 'Chicken bowl',
      description: 'chicken and rice for lunch',
      mealType: 'lunch',
      source: 'text',
      localDate: '2026-10-03',
      analysisId: 'a-1',
      photoId: null,
    });
    expect(new Date(request!.timestamp)).toEqual(new Date(2026, 9, 3, 13, 20));
    expect(request!.items.map((entry) => [entry.name, entry.grams])).toEqual([
      ['Chicken', 150],
      ['Rice', 180],
    ]);
    expect(request).not.toHaveProperty('portion');
  });

  it('refuses a meal without items or with a broken time', () => {
    const empty = meal(1, { result: { ...analysis().result, items: [] } });

    expect(mealProblem(empty, DAY_START)).toBe('Item 1 needs a name.');
    expect(pendingMealRequest(empty, DAY_START)).toBeNull();
    expect(mealProblem({ ...meal(2), dateTime: 'never' }, DAY_START)).toBe('Choose a valid time.');
    expect(pendingMealRequest({ ...meal(2), dateTime: 'never' }, DAY_START)).toBeNull();
    expect(mealProblem(meal(3), DAY_START)).toBeNull();
  });
});
