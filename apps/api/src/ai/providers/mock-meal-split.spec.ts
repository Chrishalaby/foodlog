import { MealSplitSchema } from '../meal-split.schema.js';
import type { AiAnalyzeRequest } from './ai-provider.js';
import { mockMealSplit, splitMockDescription } from './mock-meal-split.js';
import { MOCK_MODEL, MockProvider } from './mock.provider.js';

const PROMPT: AiAnalyzeRequest['prompt'] = {
  mode: 'text',
  imageRoles: [],
  description:
    'For breakfast I had 2 scrambled eggs with toast, and for lunch 150g chicken and rice',
  localTime: '2026-10-04T21:30',
  mealType: null,
  location: null,
  answeredQuestions: [],
  followUp: null,
};

describe('splitMockDescription', () => {
  it('keeps a description with at most one meal word whole', () => {
    expect(splitMockDescription('2 eggs and toast')).toEqual([
      { text: '2 eggs and toast', mealType: null },
    ]);
    expect(splitMockDescription('Dinner: pizza')).toEqual([
      { text: 'Dinner: pizza', mealType: 'dinner' },
    ]);
  });

  it('cuts at each meal word and trims the connecting words', () => {
    expect(splitMockDescription(PROMPT.description ?? '')).toEqual([
      {
        text: 'For breakfast I had 2 scrambled eggs with toast',
        mealType: 'breakfast',
      },
      { text: 'lunch 150g chicken and rice', mealType: 'lunch' },
    ]);
  });

  it('maps brunch and supper to the closest meal type', () => {
    expect(
      splitMockDescription('brunch pancakes then supper soup').map(
        (segment) => segment.mealType,
      ),
    ).toEqual(['lunch', 'dinner']);
  });
});

describe('mock meal split', () => {
  it('returns schema-valid, deterministic meals with their own items', () => {
    const first = mockMealSplit(PROMPT);

    expect(MealSplitSchema.parse(first)).toEqual(first);
    expect(mockMealSplit(PROMPT)).toEqual(first);
    expect(first.meals.map((meal) => meal.meal_type)).toEqual([
      'breakfast',
      'lunch',
    ]);
    expect(first.meals.map((meal) => meal.days_ago)).toEqual([0, 0]);
    expect(first.meals[0]?.items.map((item) => item.name).join(' ')).toMatch(
      /egg/i,
    );
    expect(first.meals[1]?.items.map((item) => item.name).join(' ')).toMatch(
      /chicken/i,
    );
  });

  it('places everything a day back when the description says yesterday', () => {
    const split = mockMealSplit({
      ...PROMPT,
      description: 'yesterday for dinner I had pizza',
    });

    expect(split.meals.map((meal) => meal.days_ago)).toEqual([1]);
  });

  it('is served by the mock provider at no cost', async () => {
    const provider = new MockProvider({ latencyMs: 0 });

    const result = await provider.analyzeMeals({
      model: 'gpt-5.6-sol',
      images: [],
      prompt: PROMPT,
    });

    expect(result.model).toBe(MOCK_MODEL);
    expect(result.raw.meals).toHaveLength(2);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});
