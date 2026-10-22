import {
  API_LIMITS,
  GOAL_LABELS,
  type Goal,
  type MealType,
  type Nutrients,
  roundTo,
  type TargetValues,
} from '@food/shared';
import { describeLocalTime } from '../ai/prompt.js';

export const MEAL_IDEAS_INSTRUCTIONS = `You are an expert dietitian helping someone decide what to eat next. You get their targets for today, what they have eaten so far, what is left, and the foods and meals they usually eat. Suggest options they would really eat now.

WHAT TO SUGGEST
- Return exactly the number of options asked for, best first. Each option is ONE eating occasion now: the meal that fits the local time, or the one the user asks for.
- Build options from the usual foods whenever they fit: the user likes them, has them at hand, and their nutrition values are the user's own trusted records. When enough usual foods are listed, at least two options must be made mostly of them. One option may be a new idea in the same style of eating (same cuisine, similar effort), useful when the usual foods cannot close a gap.
- Options must differ in their main food, not only in amounts.
- Do not repeat a meal already logged today unless nothing else fits, and never suggest anything under "Do not suggest again".
- An option has 1 to ${API_LIMITS.mealIdeaPartsMax} parts. A listed meal is one part: never split it into its ingredients. Combine parts only the way people really eat them together.

FITTING THE DAY
- Calories first: an option must not exceed what is left (at most 50 kcal over). When more meals are still to come today (judge from the local time and what is logged), use only a sensible share of what is left so the later meals still fit; in the evening an option may use all of it.
- Then protein: prefer options that close as much of the protein still to reach as the calories allow.
- Then fiber still to reach, and the room left under the saturated fat, sugar and sodium limits.
- Change the amount of a listed food to make it fit (servings 0.5, 0.75, 1, 1.5, 2 ...), keeping amounts people really eat and whole units for countable foods (eggs, wraps, burgers).
- When under 150 kcal is left or the day is already over target, suggest very light, filling options (lean protein, vegetables, fruit) and say so plainly in the summary. Never tell the user to skip eating.

LISTED FOODS
- food_id = the id from the list, name = the listed name, servings = multiples of the listed usual amount (1 = exactly as listed), estimate = null. The app takes the nutrition from the user's records.

FOODS NOT LISTED
- food_id = null, servings = 1, estimate = realistic edible grams plus the nutrients of that whole amount as eaten, including cooking fat, sauces and dressings.
- carbs_g = total carbohydrate INCLUDING fiber; calories must match ≈ 4×protein + 4×(carbs − fiber) + 2×fiber + 9×fat.
- portion = the amount as countable units when natural (2 eggs, 1 wrap), else null.
- name = a plain English name with the preparation ("Grilled chicken breast", "Boiled eggs"), max 6 words. Prefer foods commonly available at the user's location.

USER REQUEST
- What the user asks for is ground truth: the kind of meal, the place (home, restaurant, on the go), ingredients they have, foods to avoid. Follow it even when that means using fewer listed foods.

OUTPUT
- Never refuse and never reply with prose: always return options.
- title: max 8 words, what the meal is ("Chicken wrap with yogurt"). reason: max 20 words, plain English, why it fits now; do not restate calorie or macro numbers, the app shows them. summary: one sentence, max 25 words, about what the rest of the day needs.`;

export interface IdeaFood {
  id: string;
  name: string;
  amount: string;
  contains: string[];
  nutrients: Nutrients;
  useCount: number;
  mealType: MealType | null;
}

export interface IdeaLoggedMeal {
  name: string;
  mealType: MealType;
  calories: number;
  protein: number;
}

export interface MealIdeasPromptInput {
  count: number;
  localTime: string;
  goal: Goal;
  trainingDay: boolean;
  location: string | null;
  targets: TargetValues;
  eaten: Nutrients;
  logged: IdeaLoggedMeal[];
  foods: IdeaFood[];
  exclude: string[];
  note: string | null;
}

export const FOODS_HEADER =
  'Usual foods (id | name | usual amount | kcal | protein g | carbs g | fat g | fiber g | times logged | usually eaten as):';

function quote(text: string): string {
  return JSON.stringify(text);
}

function amount(value: number, decimals = 0): string {
  return String(roundTo(Math.max(0, value), decimals));
}

function left(value: number, unit: string): string {
  const rounded = roundTo(value, 0);
  return rounded < 0 ? `over by ${-rounded} ${unit}` : `${rounded} ${unit}`;
}

function describeTargets(targets: TargetValues): string {
  return [
    `Targets today: ${amount(targets.calories)} kcal`,
    `protein ${amount(targets.protein)} g`,
    `carbs ${amount(targets.carbs)} g`,
    `fat ${amount(targets.fat)} g`,
    `fiber at least ${amount(targets.fiberMin)} g`,
    `saturated fat at most ${amount(targets.satFatMax)} g`,
    `sugar at most ${amount(targets.sugarMax)} g`,
    `sodium at most ${amount(targets.sodiumMax)} mg`,
  ].join(', ');
}

function describeEaten(eaten: Nutrients): string {
  return [
    `Eaten so far: ${amount(eaten.calories)} kcal`,
    `protein ${amount(eaten.protein)} g`,
    `carbs ${amount(eaten.carbs)} g`,
    `fat ${amount(eaten.fat)} g`,
    `fiber ${amount(eaten.fiber)} g`,
    `saturated fat ${amount(eaten.satFat)} g`,
    `sugar ${amount(eaten.sugar)} g`,
    `sodium ${amount(eaten.sodium)} mg`,
  ].join(', ');
}

export function describeLeft(targets: TargetValues, eaten: Nutrients): string {
  return [
    `Left today: calories ${left(targets.calories - eaten.calories, 'kcal')}`,
    `protein still to reach ${amount(targets.protein - eaten.protein)} g`,
    `carbs ${left(targets.carbs - eaten.carbs, 'g')}`,
    `fat ${left(targets.fat - eaten.fat, 'g')}`,
    `fiber still to reach ${amount(targets.fiberMin - eaten.fiber)} g`,
    `room under limits: saturated fat ${left(targets.satFatMax - eaten.satFat, 'g')}`,
    `sugar ${left(targets.sugarMax - eaten.sugar, 'g')}`,
    `sodium ${left(targets.sodiumMax - eaten.sodium, 'mg')}`,
  ].join(', ');
}

function describeLogged(logged: readonly IdeaLoggedMeal[]): string[] {
  if (logged.length === 0) {
    return ['Logged today: nothing yet'];
  }
  return [
    'Logged today, in order:',
    ...logged.map(
      (meal) =>
        `- ${meal.mealType}: ${quote(meal.name)} (${amount(meal.calories)} kcal, ${amount(meal.protein)} g protein)`,
    ),
  ];
}

function describeFood(food: IdeaFood): string {
  const name =
    food.contains.length > 0
      ? `${quote(food.name)} (contains: ${food.contains.join(', ')})`
      : quote(food.name);
  return [
    food.id,
    name,
    food.amount,
    amount(food.nutrients.calories),
    amount(food.nutrients.protein, 1),
    amount(food.nutrients.carbs, 1),
    amount(food.nutrients.fat, 1),
    amount(food.nutrients.fiber, 1),
    String(food.useCount),
    food.mealType ?? 'any',
  ].join(' | ');
}

function describeFoods(foods: readonly IdeaFood[]): string[] {
  return foods.length === 0
    ? ['Usual foods: none logged yet, so every option is a new idea']
    : [FOODS_HEADER, ...foods.map(describeFood)];
}

export function buildMealIdeasUserMessage(input: MealIdeasPromptInput): string {
  const lines = [
    `Mode: meal ideas. Suggest ${input.count} options for what to eat next.`,
  ];
  const time = describeLocalTime(input.localTime, null);
  if (time) {
    lines.push(time);
  }
  lines.push(
    `Goal: ${GOAL_LABELS[input.goal].toLowerCase()}. ${input.trainingDay ? 'Training day' : 'Rest day'}.`,
  );
  const location = input.location?.trim().slice(0, API_LIMITS.locationMax);
  if (location) {
    lines.push(`Location: ${quote(location)}`);
  }
  lines.push(
    describeTargets(input.targets),
    describeEaten(input.eaten),
    describeLeft(input.targets, input.eaten),
    ...describeLogged(input.logged),
    ...describeFoods(input.foods),
  );
  if (input.exclude.length > 0) {
    lines.push(`Do not suggest again: ${input.exclude.map(quote).join(', ')}`);
  }
  lines.push(
    input.note
      ? `User request (ground truth for what they want): ${quote(input.note)}`
      : 'User request: none',
  );
  return lines.join('\n');
}
