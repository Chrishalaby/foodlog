import { type Nutrients, zeroNutrients } from '@food/shared';
import { listFoods } from '../../meal-ideas/meal-ideas-foods.js';
import { normalizeMealIdeas } from '../../meal-ideas/meal-ideas-normalize.js';
import type {
  IdeaFood,
  MealIdeasPromptInput,
} from '../../meal-ideas/meal-ideas-prompt.js';
import { MealIdeasSchema } from '../../meal-ideas/meal-ideas.schema.js';
import type { AiMealIdeasRequest } from './ai-provider.js';
import { MOCK_NOTICE } from './mock-analysis.js';
import { MOCK_NEW_IDEAS, mockMealIdeas } from './mock-meal-ideas.js';
import { MOCK_MODEL, MockProvider } from './mock.provider.js';

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function food(id: string, name: string): IdeaFood {
  return {
    id,
    name,
    amount: '100 g',
    contains: [],
    nutrients: nutrients({ calories: 200, protein: 10 }),
    useCount: 3,
    mealType: null,
  };
}

function prompt(
  overrides: Partial<MealIdeasPromptInput> = {},
): MealIdeasPromptInput {
  return {
    count: 3,
    localTime: '2026-10-11T19:30',
    goal: 'cut',
    trainingDay: false,
    location: null,
    targets: {
      calories: 2200,
      protein: 170,
      carbs: 220,
      fat: 70,
      satFatMax: 24,
      fiberMin: 30,
      sugarMax: 99,
      sodiumMax: 2300,
    },
    eaten: nutrients({ calories: 1300, protein: 90 }),
    logged: [],
    foods: [
      food('F1', 'Chicken wrap'),
      food('F2', 'Khoury yogurt'),
      food('F3', 'Banana'),
      food('F4', 'Protein shake'),
    ],
    exclude: [],
    note: null,
    ...overrides,
  };
}

describe('mock meal ideas', () => {
  it('returns schema-valid, deterministic ideas: usual foods first, then one new idea', () => {
    const first = mockMealIdeas(prompt());

    expect(MealIdeasSchema.parse(first)).toEqual(first);
    expect(mockMealIdeas(prompt())).toEqual(first);
    expect(first.summary).toBe(MOCK_NOTICE);
    expect(first.ideas.map((idea) => idea.title)).toEqual([
      'Chicken wrap',
      'Khoury yogurt with Banana',
      'Grilled chicken with rice and salad',
    ]);
    expect(first.ideas[1]?.parts).toEqual([
      { food_id: 'F2', name: 'Khoury yogurt', servings: 1, estimate: null },
      { food_id: 'F3', name: 'Banana', servings: 0.5, estimate: null },
    ]);
  });

  it('labels the ideas with the meal that fits the local time', () => {
    const at = (localTime: string): string | undefined =>
      mockMealIdeas(prompt({ localTime })).ideas[0]?.meal_type;

    expect(at('2026-10-11T08:00')).toBe('breakfast');
    expect(at('2026-10-11T13:00')).toBe('lunch');
    expect(at('2026-10-11T19:30')).toBe('dinner');
    expect(at('not a time')).toBe('snack');
  });

  it('offers only new ideas when nothing has been logged yet', () => {
    const ideas = mockMealIdeas(prompt({ foods: [] })).ideas;

    expect(ideas.map((idea) => idea.title)).toEqual(
      MOCK_NEW_IDEAS.map((idea) => idea.title),
    );
    expect(ideas.every((idea) => idea.parts.every((p) => p.estimate))).toBe(
      true,
    );
  });

  it('skips excluded titles so asking again gives other ideas', () => {
    const again = mockMealIdeas(
      prompt({
        exclude: [
          ' chicken WRAP ',
          'Khoury yogurt with Banana',
          'Grilled chicken with rice and salad',
        ],
      }),
    );

    expect(again.ideas.map((idea) => idea.title)).toEqual([
      'Protein shake',
      'Greek yogurt with berries and oats',
      'Omelette with toast',
    ]);
  });

  it('starts over instead of returning nothing when everything is excluded', () => {
    const everything = mockMealIdeas(prompt({ count: 10 })).ideas.map(
      (idea) => idea.title,
    );

    expect(mockMealIdeas(prompt({ exclude: everything })).ideas).toHaveLength(
      3,
    );
  });

  it('never shares the idea constants with callers', () => {
    const ideas = mockMealIdeas(prompt({ foods: [] })).ideas;
    ideas[0]!.parts[0]!.estimate!.calories = 1;

    expect(MOCK_NEW_IDEAS[0]!.parts[0]!.estimate!.calories).toBe(235);
  });

  it('gives new foods values that pass the consistency checks unchanged', () => {
    const normalized = normalizeMealIdeas(
      mockMealIdeas(prompt({ foods: [] })),
      listFoods([]),
    );

    expect(normalized.ideas.map((idea) => idea.totals.calories)).toEqual([
      501, 303, 395,
    ]);
    expect(normalized.ideas[2]?.parts[0]?.portion).toEqual({
      count: 3,
      unit: 'egg',
      unitPlural: 'eggs',
    });
  });
});

describe('MockProvider.suggestMeals', () => {
  it('reports the mock model with plausible token usage and no cost basis', async () => {
    const provider = new MockProvider({ latencyMs: 0 });
    const request: AiMealIdeasRequest = {
      model: 'gpt-5.6-sol',
      prompt: prompt(),
    };

    const result = await provider.suggestMeals(request);

    expect(result.model).toBe(MOCK_MODEL);
    expect(result.raw).toEqual(mockMealIdeas(request.prompt));
    expect(result.usage.inputTokens).toBeGreaterThan(500);
    expect(result.usage.outputTokens).toBeGreaterThan(
      result.usage.reasoningTokens,
    );
    expect(result.requestId).toBeNull();
  });
});
