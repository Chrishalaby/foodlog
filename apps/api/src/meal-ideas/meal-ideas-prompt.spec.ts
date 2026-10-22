import {
  API_LIMITS,
  type Nutrients,
  type TargetValues,
  zeroNutrients,
} from '@food/shared';
import {
  buildMealIdeasUserMessage,
  describeLeft,
  FOODS_HEADER,
  MEAL_IDEAS_INSTRUCTIONS,
  type MealIdeasPromptInput,
} from './meal-ideas-prompt.js';

const TARGETS: TargetValues = {
  calories: 2200,
  protein: 170,
  carbs: 220,
  fat: 70,
  satFatMax: 24,
  fiberMin: 30,
  sugarMax: 99,
  sodiumMax: 2300,
};

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

const EATEN = nutrients({
  calories: 1300,
  protein: 90,
  carbs: 130,
  fat: 45,
  satFat: 14,
  fiber: 12,
  sugar: 40,
  sodium: 1500,
});

function input(
  overrides: Partial<MealIdeasPromptInput> = {},
): MealIdeasPromptInput {
  return {
    count: 3,
    localTime: '2026-10-11T16:20',
    goal: 'cut',
    trainingDay: true,
    location: null,
    targets: TARGETS,
    eaten: EATEN,
    logged: [],
    foods: [],
    exclude: [],
    note: null,
    ...overrides,
  };
}

describe('MEAL_IDEAS_INSTRUCTIONS', () => {
  it('builds options from the usual foods first and allows one new idea', () => {
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'Build options from the usual foods whenever they fit',
    );
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'at least two options must be made mostly of them',
    );
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain('One option may be a new idea');
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      `An option has 1 to ${API_LIMITS.mealIdeaPartsMax} parts`,
    );
  });

  it('fits calories first, then protein, fiber and the limits, leaving room for later meals', () => {
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'Calories first: an option must not exceed what is left',
    );
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'use only a sensible share of what is left',
    );
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain('Then protein');
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain('Then fiber still to reach');
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'Never tell the user to skip eating',
    );
  });

  it('leaves the nutrition of listed foods to the app and asks for a full estimate of new foods', () => {
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      "The app takes the nutrition from the user's records",
    );
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'carbs_g = total carbohydrate INCLUDING fiber',
    );
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'including cooking fat, sauces and dressings',
    );
  });

  it('treats the request as ground truth, never refuses and keeps numbers out of the reason', () => {
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'What the user asks for is ground truth',
    );
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain('Never refuse');
    expect(MEAL_IDEAS_INSTRUCTIONS).toContain(
      'do not restate calorie or macro numbers',
    );
  });
});

describe('describeLeft', () => {
  it('states what is left, what is still to reach and the room under each limit', () => {
    expect(describeLeft(TARGETS, EATEN)).toBe(
      'Left today: calories 900 kcal, protein still to reach 80 g, carbs 90 g, fat 25 g, fiber still to reach 18 g, room under limits: saturated fat 10 g, sugar 59 g, sodium 800 mg',
    );
  });

  it('says by how much the day is over instead of printing negative numbers', () => {
    const over = nutrients({
      calories: 2350,
      protein: 190,
      carbs: 240,
      fat: 82,
      satFat: 27,
      fiber: 34,
      sugar: 120,
      sodium: 2600,
    });

    expect(describeLeft(TARGETS, over)).toBe(
      'Left today: calories over by 150 kcal, protein still to reach 0 g, carbs over by 20 g, fat over by 12 g, fiber still to reach 0 g, room under limits: saturated fat over by 3 g, sugar over by 21 g, sodium over by 300 mg',
    );
  });
});

describe('buildMealIdeasUserMessage', () => {
  it('describes an empty day with no usual foods and no request', () => {
    const message = buildMealIdeasUserMessage(
      input({ eaten: zeroNutrients(), trainingDay: false, goal: 'maintain' }),
    );

    expect(message.split('\n')).toEqual([
      'Mode: meal ideas. Suggest 3 options for what to eat next.',
      'Local time: Sunday 2026-10-11 16:20 (snack)',
      'Goal: maintain. Rest day.',
      'Targets today: 2200 kcal, protein 170 g, carbs 220 g, fat 70 g, fiber at least 30 g, saturated fat at most 24 g, sugar at most 99 g, sodium at most 2300 mg',
      'Eaten so far: 0 kcal, protein 0 g, carbs 0 g, fat 0 g, fiber 0 g, saturated fat 0 g, sugar 0 g, sodium 0 mg',
      'Left today: calories 2200 kcal, protein still to reach 170 g, carbs 220 g, fat 70 g, fiber still to reach 30 g, room under limits: saturated fat 24 g, sugar 99 g, sodium 2300 mg',
      'Logged today: nothing yet',
      'Usual foods: none logged yet, so every option is a new idea',
      'User request: none',
    ]);
  });

  it('lists logged meals, usual foods with ids, exclusions and the quoted request', () => {
    const message = buildMealIdeasUserMessage(
      input({
        location: '  Beirut, Lebanon ',
        logged: [
          {
            name: 'Oats with "whey"',
            mealType: 'breakfast',
            calories: 449.6,
            protein: 35.2,
          },
        ],
        foods: [
          {
            id: 'F1',
            name: 'Khoury strawberry yogurt',
            amount: '125 g',
            contains: [],
            nutrients: nutrients({
              calories: 110,
              protein: 5,
              carbs: 17.25,
              fat: 2.5,
            }),
            useCount: 14,
            mealType: 'snack',
          },
          {
            id: 'F2',
            name: 'Lunch at home',
            amount: '1 plate (450 g)',
            contains: ['Chicken breast, grilled', 'White rice'],
            nutrients: nutrients({
              calories: 640.4,
              protein: 52,
              carbs: 60,
              fat: 18,
              fiber: 4.26,
            }),
            useCount: 3,
            mealType: null,
          },
        ],
        exclude: ['Tuna sandwich', 'Omelette with toast'],
        note: 'eating out tonight',
      }),
    );
    const lines = message.split('\n');

    expect(lines).toContain('Goal: cut (lose fat). Training day.');
    expect(lines).toContain('Location: "Beirut, Lebanon"');
    expect(lines).toContain('Logged today, in order:');
    expect(lines).toContain(
      '- breakfast: "Oats with \\"whey\\"" (450 kcal, 35 g protein)',
    );
    expect(lines).toContain(FOODS_HEADER);
    expect(lines).toContain(
      'F1 | "Khoury strawberry yogurt" | 125 g | 110 | 5 | 17.3 | 2.5 | 0 | 14 | snack',
    );
    expect(lines).toContain(
      'F2 | "Lunch at home" (contains: Chicken breast, grilled, White rice) | 1 plate (450 g) | 640 | 52 | 60 | 18 | 4.3 | 3 | any',
    );
    expect(lines).toContain(
      'Do not suggest again: "Tuna sandwich", "Omelette with toast"',
    );
    expect(lines.at(-1)).toBe(
      'User request (ground truth for what they want): "eating out tonight"',
    );
  });
});
