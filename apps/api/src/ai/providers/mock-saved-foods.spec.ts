import { zeroNutrients } from '@food/shared';
import { toSavedFood } from '../../my-foods/saved-food.js';
import { normalizeAnalysis } from '../normalize.js';
import type { AnalysisPromptInput, SavedFoodPrompt } from '../prompt.js';
import { mockAnalysis } from './mock-analysis.js';
import { MOCK_SAVED_FOOD_GRAMS } from './mock-saved-foods.js';

const KETCHUP: SavedFoodPrompt = {
  name: 'Heinz tomato ketchup',
  brand: null,
  aliases: ['Tomato ketchup'],
};

const CHICKEN: SavedFoodPrompt = {
  name: 'Chicken breast, grilled',
  brand: null,
  aliases: [],
};

function textPrompt(
  description: string,
  savedFoods: SavedFoodPrompt[] = [KETCHUP],
): AnalysisPromptInput {
  return {
    mode: 'text',
    imageRoles: [],
    description,
    localTime: null,
    mealType: null,
    location: null,
    answeredQuestions: [],
    followUp: null,
    savedFoods,
  };
}

function linkedNames(input: AnalysisPromptInput): [string, string | null][] {
  return mockAnalysis(input).items.map((item) => [item.name, item.saved_food]);
}

describe('mock saved food linking', () => {
  it('adds a mentioned saved food that the mock has no item for', () => {
    const output = mockAnalysis(textPrompt('burger with ketchup'));

    expect(output.items.at(-1)).toMatchObject({
      name: 'Heinz tomato ketchup',
      saved_food: 'Heinz tomato ketchup',
      estimated_quantity_g: MOCK_SAVED_FOOD_GRAMS,
    });
    expect(
      output.items.filter((item) => item.saved_food !== null),
    ).toHaveLength(1);
  });

  it('uses a stated weight for the added saved food', () => {
    expect(
      mockAnalysis(textPrompt('rice, 30 g tomato ketchup')).items.at(-1),
    ).toMatchObject({
      saved_food: 'Heinz tomato ketchup',
      estimated_quantity_g: 30,
    });
  });

  it('marks the matching item when the mock already has one', () => {
    expect(
      linkedNames(textPrompt('grilled chicken breast', [CHICKEN])),
    ).toEqual([['Chicken breast, grilled', 'Chicken breast, grilled']]);
  });

  it('links nothing when no saved food is mentioned or none are listed', () => {
    expect(
      linkedNames(textPrompt('rice')).every(([, saved]) => saved === null),
    ).toBe(true);
    expect(
      linkedNames(textPrompt('burger with ketchup', [])).every(
        ([, saved]) => saved === null,
      ),
    ).toBe(true);
    expect(
      linkedNames(textPrompt('burger with light ketchup')).every(
        ([, saved]) => saved === null,
      ),
    ).toBe(true);
  });

  it('adds a saved food only once', () => {
    const output = mockAnalysis(textPrompt('ketchup, tomato ketchup'));

    expect(
      output.items.filter((item) => item.saved_food === KETCHUP.name),
    ).toHaveLength(1);
  });

  it('ends up with the saved values after normalization', () => {
    const food = toSavedFood({
      id: '019a0000-0000-7000-8000-0000000000d1',
      name: KETCHUP.name,
      brand: null,
      aliases: KETCHUP.aliases,
      basisUnit: 'g',
      unitName: null,
      unitGrams: null,
      servingSizeG: null,
      microsPer100: null,
      ...zeroNutrients(),
      calories: 110,
      carbs: 25,
    });
    const result = normalizeAnalysis(
      mockAnalysis(textPrompt('burger with ketchup')),
      { mode: 'text', savedFoods: [food] },
    );

    expect(result.items.at(-1)).toMatchObject({
      name: 'Heinz tomato ketchup',
      grams: MOCK_SAVED_FOOD_GRAMS,
      per100g: { calories: 110, carbs: 25 },
      nutrients: { calories: 22, carbs: 5 },
      savedFood: { id: food.ref.id },
    });
  });
});
