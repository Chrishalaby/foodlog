import {
  API_LIMITS,
  addDays,
  guessMealType,
  type AnalyzeResponse,
  type CreateEntryRequest,
  type MealTiming,
  type MealType,
  type Portion,
} from '@food/shared';
import { dayStartHour } from '../../core/day-start';
import { localClockTime, localDateOf, relativeDayLabel, todayLocalDate } from '../../core/time';
import {
  itemsTotals,
  toEntryItemInputs,
  validateItems,
  type DraftItem,
} from '../../shared/ui/items-editor/items-math';
import { formatGrams } from '../../shared/utils/format';
import { toPortion } from '../../shared/utils/portion';
import {
  currentDateTimeInput,
  dateTimeInputParts,
  parseDateTimeInput,
  timingFromInput,
} from './entry-timing';
import { deriveMealName, draftsFromResult, entrySourceFor } from './log-helpers';

export const DEFAULT_MEAL_TIMES: Record<MealType, string> = {
  breakfast: '08:00',
  lunch: '13:00',
  snack: '16:00',
  dinner: '20:00',
};

export const MEAL_ITEMS_PREVIEW = 3;

export interface MealPlacement {
  readonly dateTime: string;
  readonly mealType: MealType;
  readonly mealTypeAuto: boolean;
}

export interface PendingMeal extends MealPlacement {
  readonly id: number;
  readonly analysis: AnalyzeResponse;
  readonly name: string;
  readonly seedName: string;
  readonly items: DraftItem[];
  readonly portion: Portion | null;
}

export function hasTimingHint(timing: MealTiming | null | undefined): timing is MealTiming {
  return !!timing && (timing.mealType !== null || timing.time !== null || timing.daysAgo > 0);
}

export function mealPlacement(
  timing: MealTiming | null | undefined,
  now: Date = new Date(),
  hour: number = dayStartHour(),
): MealPlacement {
  const current = currentDateTimeInput(now, hour);
  if (!hasTimingHint(timing)) {
    return { dateTime: current, mealType: guessMealType(now), mealTypeAuto: true };
  }
  const day = addDays(localDateOf(now, hour), -timing.daysAgo);
  const time =
    timing.time ?? (timing.mealType ? DEFAULT_MEAL_TIMES[timing.mealType] : localClockTime(now));
  const at = parseDateTimeInput(`${day}T${time}`, hour);
  const past = at !== null && at.getTime() <= now.getTime();
  return {
    dateTime: past ? `${day}T${time}` : current,
    mealType: timing.mealType ?? guessMealType(past && at ? at : now),
    mealTypeAuto: timing.mealType === null,
  };
}

export function pendingMeal(
  id: number,
  analysis: AnalyzeResponse,
  now: Date = new Date(),
  hour: number = dayStartHour(),
): PendingMeal {
  const { moreMeals: _moreMeals, ...own } = analysis;
  const name = own.result.mealName.trim().slice(0, API_LIMITS.nameMax);
  return {
    id,
    analysis: own,
    name,
    seedName: name,
    items: draftsFromResult(own.result),
    portion: toPortion(own.result.portion),
    ...mealPlacement(own.timing, now, hour),
  };
}

export function sortMeals(
  meals: readonly PendingMeal[],
  hour: number = dayStartHour(),
): PendingMeal[] {
  const time = (meal: PendingMeal): number =>
    parseDateTimeInput(meal.dateTime, hour)?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...meals].sort((a, b) => time(a) - time(b) || a.id - b.id);
}

export function withMealTime(
  meal: PendingMeal,
  time: string,
  hour: number = dayStartHour(),
): PendingMeal {
  const parts = dateTimeInputParts(meal.dateTime);
  const dateTime = parts ? `${parts.localDate}T${time}` : meal.dateTime;
  const at = parseDateTimeInput(dateTime, hour);
  if (!at) {
    return meal;
  }
  return { ...meal, dateTime, mealType: meal.mealTypeAuto ? guessMealType(at) : meal.mealType };
}

export function withMealDay(meal: PendingMeal, localDate: string): PendingMeal {
  const parts = dateTimeInputParts(meal.dateTime);
  const dateTime = parts ? `${localDate}T${parts.time}` : meal.dateTime;
  return dateTimeInputParts(dateTime) ? { ...meal, dateTime } : meal;
}

export function mealDay(meal: PendingMeal): string | null {
  return dateTimeInputParts(meal.dateTime)?.localDate ?? null;
}

export function mealClock(meal: PendingMeal): string {
  return dateTimeInputParts(meal.dateTime)?.time ?? '';
}

export function sharedMealDay(meals: readonly PendingMeal[]): string | null {
  const days = new Set(meals.map(mealDay));
  const [only] = days;
  return days.size === 1 && only ? only : null;
}

export function mealDayLabel(meal: PendingMeal, today: string = todayLocalDate()): string | null {
  const day = mealDay(meal);
  return day === null || day === today ? null : relativeDayLabel(day, today);
}

export function mealTitle(meal: PendingMeal): string {
  return deriveMealName(meal.name, meal.items) || 'Meal';
}

export function mealItemsLine(meal: PendingMeal): string {
  const named = meal.items.filter((item) => item.name.trim().length > 0);
  const shown = named
    .slice(0, MEAL_ITEMS_PREVIEW)
    .map((item) => `${item.name.trim()} ${formatGrams(item.grams)}`);
  const more = named.length - shown.length;
  return [...shown, ...(more > 0 ? [`+${more} more`] : [])].join(' · ');
}

export function mealProblem(meal: PendingMeal, hour: number = dayStartHour()): string | null {
  if (!timingFromInput(meal.dateTime, hour)) {
    return 'Choose a valid time.';
  }
  return validateItems(meal.items);
}

export function pendingMealRequest(
  meal: PendingMeal,
  hour: number = dayStartHour(),
): CreateEntryRequest | null {
  const timing = timingFromInput(meal.dateTime, hour);
  const name = deriveMealName(meal.name, meal.items);
  if (!timing || !name || validateItems(meal.items)) {
    return null;
  }
  const description = (meal.analysis.description ?? '').trim();
  const portion = toPortion(meal.portion);
  return {
    name,
    description: description ? description.slice(0, API_LIMITS.descriptionMax) : null,
    mealType: meal.mealType,
    source: entrySourceFor(meal.analysis.mode),
    timestamp: timing.timestamp,
    localDate: timing.localDate,
    items: toEntryItemInputs(meal.items),
    analysisId: meal.analysis.analysisId,
    photoId: null,
    ...(portion ? { portion } : {}),
  };
}

export function mealsCalories(meals: readonly PendingMeal[]): number {
  return meals.reduce((total, meal) => total + itemsTotals(meal.items).calories, 0);
}
