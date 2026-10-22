import { guessMealType, type MealType } from '@food/shared';
import type {
  IdeaFood,
  MealIdeasPromptInput,
} from '../../meal-ideas/meal-ideas-prompt.js';
import type {
  MealIdeaOutput,
  MealIdeaPartOutput,
  MealIdeasOutput,
  NewFoodEstimate,
} from '../../meal-ideas/meal-ideas.schema.js';
import { MOCK_NOTICE } from './mock-analysis.js';

type DraftIdea = Omit<MealIdeaOutput, 'meal_type'>;

const LOCAL_TIME_PATTERN = /T(\d{2}):(\d{2})$/;
const SIDE_SERVINGS = 0.5;
const USUAL_REASON = 'One of the foods you log most often';
const USUAL_PAIR_REASON = 'Two of your usual foods that go together';

function newFood(
  name: string,
  grams: number,
  values: readonly [
    calories: number,
    protein: number,
    carbs: number,
    fat: number,
    satFat: number,
    fiber: number,
    sugar: number,
    sodium: number,
  ],
  portion: NewFoodEstimate['portion'] = null,
): MealIdeaPartOutput {
  const [calories, protein, carbs, fat, satFat, fiber, sugar, sodium] = values;
  return {
    food_id: null,
    name,
    servings: 1,
    estimate: {
      grams,
      portion,
      calories,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      saturated_fat_g: satFat,
      fiber_g: fiber,
      sugar_g: sugar,
      sodium_mg: sodium,
    },
  };
}

export const MOCK_NEW_IDEAS: readonly DraftIdea[] = [
  {
    title: 'Grilled chicken with rice and salad',
    parts: [
      newFood('Grilled chicken breast', 150, [235, 46, 0, 5.5, 1.5, 0, 0, 110]),
      newFood('Cooked white rice', 150, [187, 4, 42, 0.5, 0.1, 0.6, 0.1, 2]),
      newFood(
        'Mixed salad with olive oil',
        120,
        [79, 1.5, 6, 6, 0.9, 2.5, 3, 90],
      ),
    ],
    reason: 'Lean protein with steady carbs and some fiber',
  },
  {
    title: 'Greek yogurt with berries and oats',
    parts: [
      newFood('Greek yogurt 2%', 200, [148, 20, 8, 4, 2.6, 0, 8, 70]),
      newFood('Mixed berries', 100, [47, 0.8, 12, 0.3, 0, 3.5, 7, 1]),
      newFood('Rolled oats', 30, [108, 4, 20, 2, 0.4, 3, 0.3, 1]),
    ],
    reason: 'High in protein and fiber for few calories',
  },
  {
    title: 'Omelette with toast',
    parts: [
      newFood(
        'Eggs, cooked in a little oil',
        150,
        [253, 19, 1.5, 19, 5, 0, 0.6, 290],
        { count: 3, unit: 'egg', unit_plural: 'eggs' },
      ),
      newFood('Whole wheat toast', 60, [142, 7, 26, 2, 0.4, 4, 3, 270], {
        count: 2,
        unit: 'slice',
        unit_plural: 'slices',
      }),
    ],
    reason: 'Quick, filling and rich in protein',
  },
];

function listedPart(food: IdeaFood, servings: number): MealIdeaPartOutput {
  return { food_id: food.id, name: food.name, servings, estimate: null };
}

function usualIdeas(foods: readonly IdeaFood[]): DraftIdea[] {
  const [first, second, third, ...rest] = foods;
  const ideas: DraftIdea[] = [];
  if (first) {
    ideas.push({
      title: first.name,
      parts: [listedPart(first, 1)],
      reason: USUAL_REASON,
    });
  }
  if (second && third) {
    ideas.push({
      title: `${second.name} with ${third.name}`,
      parts: [listedPart(second, 1), listedPart(third, SIDE_SERVINGS)],
      reason: USUAL_PAIR_REASON,
    });
  } else if (second) {
    rest.unshift(second);
  }
  return [
    ...ideas,
    ...rest.map((food) => ({
      title: food.name,
      parts: [listedPart(food, 1)],
      reason: USUAL_REASON,
    })),
  ];
}

function fold(text: string): string {
  return text.trim().toLowerCase();
}

function mealSlot(localTime: string): MealType {
  const match = LOCAL_TIME_PATTERN.exec(localTime);
  return match
    ? guessMealType(new Date(2000, 0, 1, Number(match[1]), Number(match[2])))
    : 'snack';
}

function pick(
  usual: readonly DraftIdea[],
  fresh: readonly DraftIdea[],
  count: number,
): DraftIdea[] {
  const reserved = fresh.length > 0 ? 1 : 0;
  return [...usual.slice(0, Math.max(count - reserved, 0)), ...fresh].slice(
    0,
    count,
  );
}

export function mockMealIdeas(prompt: MealIdeasPromptInput): MealIdeasOutput {
  const excluded = new Set(prompt.exclude.map(fold));
  const allowed = (idea: DraftIdea): boolean => !excluded.has(fold(idea.title));
  const usual = usualIdeas(prompt.foods);
  const picked = pick(
    usual.filter(allowed),
    MOCK_NEW_IDEAS.filter(allowed),
    prompt.count,
  );
  const ideas =
    picked.length > 0 ? picked : pick(usual, MOCK_NEW_IDEAS, prompt.count);
  const mealType = mealSlot(prompt.localTime);
  return {
    summary: MOCK_NOTICE,
    ideas: ideas.map((idea) => ({
      title: idea.title,
      meal_type: mealType,
      parts: idea.parts.map((part) => ({
        ...part,
        estimate: part.estimate ? { ...part.estimate } : null,
      })),
      reason: idea.reason,
    })),
  };
}
