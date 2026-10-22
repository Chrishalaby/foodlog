import { API_LIMITS, type MealTiming } from '@food/shared';
import type { FoodAnalysisOutput } from './food-analysis.schema.js';
import type { MealSplitMeal, MealSplitOutput } from './meal-split.schema.js';
import { DEVELOPER_INSTRUCTIONS } from './prompt.js';

export const MEAL_SPLIT_MAX_DAYS_AGO = 7;
export const EMPTY_MEAL_QUESTION = 'What did you eat?';

export const MEAL_SPLIT_INSTRUCTIONS = `${DEVELOPER_INSTRUCTIONS}

SEVERAL MEALS
- The description may cover one eating occasion or several (a whole day, or meals from different times). Return one element of meals per eating occasion, in the order they were eaten. Everything eaten or drunk at one sitting is ONE meal, however many foods it has: never make one meal per food, and keep a drink, side or dessert with the meal it was had with.
- Start a new meal only when the description separates occasions: a meal name (breakfast, lunch, dinner, snack, brunch, suhoor, iftar), a time or sequence ("at 2", "around noon", "later", "after the gym", "before bed", "then in the evening") or a different day. A description of a single occasion returns exactly one meal. Never return an empty meals list.
- description = the user's own words for that meal, copied verbatim with every amount, plus anything said about the whole day that applies to it ("everything was cooked without oil").
- meal_type = breakfast, lunch, dinner or snack only when the user names the meal or states a time that implies it (brunch = lunch, suhoor = breakfast, iftar = dinner, dessert or a drink on its own = snack); otherwise null.
- eaten_at = 24-hour HH:MM only when a clock time is stated ("at 2 pm" = "14:00", "noon" = "12:00", "half past eight in the morning" = "08:30"); otherwise null. Never guess a time.
- days_ago = 0 unless the user says the meal was on an earlier day ("yesterday" = 1, "two days ago" = 2, "last night" = 1 when it is now morning or midday).
- Every other field describes that one meal alone, exactly as specified above: its own meal_name, portion, items, assumptions and follow-up question. Whole-day remarks apply to every meal they concern.`;

export interface SplitMeal {
  raw: FoodAnalysisOutput;
  description: string | null;
  timing: MealTiming;
}

const CLOCK_TIME_PATTERN = /^\s*([01]?\d|2[0-3])[:.h]([0-5]\d)\s*$/;

export function normalizeClockTime(value: string | null): string | null {
  const match = value === null ? null : CLOCK_TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, hours = '', minutes = ''] = match;
  return `${hours.padStart(2, '0')}:${minutes}`;
}

export function normalizeDaysAgo(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MEAL_SPLIT_MAX_DAYS_AGO, Math.max(0, Math.round(value)));
}

export function mealTiming(meal: MealSplitMeal): MealTiming {
  return {
    mealType: meal.meal_type,
    time: normalizeClockTime(meal.eaten_at),
    daysAgo: normalizeDaysAgo(meal.days_ago),
  };
}

function analysisOf(meal: MealSplitMeal): FoodAnalysisOutput {
  const {
    description: _description,
    meal_type: _mealType,
    eaten_at: _eatenAt,
    days_ago: _daysAgo,
    ...analysis
  } = meal;
  return analysis;
}

function emptyMeal(): FoodAnalysisOutput {
  return {
    input_type: 'text',
    meal_name: '',
    portion: null,
    scale_cues: 'none',
    items: [],
    label: null,
    assumptions: [],
    follow_up_question: EMPTY_MEAL_QUESTION,
    follow_up_options: [],
  };
}

function ownDescription(meal: MealSplitMeal, whole: string | null): string {
  const text = meal.description.trim().slice(0, API_LIMITS.descriptionMax);
  return text || (whole ?? '');
}

export function splitMeals(
  output: MealSplitOutput,
  description: string | null,
): SplitMeal[] {
  const withFood = output.meals.filter((meal) => meal.items.length > 0);
  const [only] = withFood.length > 0 ? withFood : output.meals;
  if (!only) {
    return [
      {
        raw: emptyMeal(),
        description,
        timing: { mealType: null, time: null, daysAgo: 0 },
      },
    ];
  }
  if (withFood.length <= 1) {
    return [{ raw: analysisOf(only), description, timing: mealTiming(only) }];
  }
  return withFood.slice(0, API_LIMITS.splitMealsMax).map((meal) => ({
    raw: analysisOf(meal),
    description: ownDescription(meal, description) || null,
    timing: mealTiming(meal),
  }));
}
