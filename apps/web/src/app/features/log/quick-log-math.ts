import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  formatCount,
  guessMealType,
  isFiniteNumber,
  roundNutrients,
  roundTo,
  sanitizeNutrients,
  scaleNutrients,
  type EntryItemInput,
  type FoodSearchResult,
  type MealType,
  type Nutrients,
  type Portion,
  type QuickLogRequest,
} from '@food/shared';
import { portionFactorLabel, sanitizeGrams } from '../../shared/ui/items-editor/items-math';
import {
  clampCount,
  itemCountFields,
  itemPortion,
  scaledPortion,
} from '../../shared/utils/portion';
import { scaledItemExtras } from '../../shared/utils/micros';
import { productIdField } from '../../shared/utils/saved-foods';
import type { EntryTiming } from './entry-timing';

export type QuickPortion =
  | { readonly mode: 'grams'; readonly grams: number }
  | { readonly mode: 'servings'; readonly servings: number }
  | { readonly mode: 'count'; readonly count: number };

export const QUICK_SERVING_STEP = 0.25;
export const QUICK_SERVING_MIN = QUICK_SERVING_STEP;
export const QUICK_SERVING_MAX = API_LIMITS.favoriteServingsMax;
export const QUICK_GRAMS_MIN = 1;
export const GRAM_CHIP_FACTORS = [0.5, 1, 1.5, 2] as const;
const MEAL_SERVINGS_DECIMALS = 4;

export type QuickBaseline = 'last_time' | 'serving';

export function usesGrams(result: FoodSearchResult): boolean {
  return result.items.length === 1 && sanitizeGrams(result.grams) > 0;
}

export function resultPortion(result: Pick<FoodSearchResult, 'portion'>): Portion | null {
  const portion = result.portion;
  return portion && isFiniteNumber(portion.count) && portion.count > 0 ? portion : null;
}

export function defaultPortion(result: FoodSearchResult): QuickPortion {
  const portion = resultPortion(result);
  if (portion) {
    return { mode: 'count', count: clampCount(portion.count) };
  }
  return usesGrams(result)
    ? { mode: 'grams', grams: sanitizeGrams(result.grams) }
    : { mode: 'servings', servings: 1 };
}

export function quickBaseline(result: Pick<FoodSearchResult, 'kind'>): QuickBaseline {
  return result.kind === 'meal' || result.kind === 'food' ? 'last_time' : 'serving';
}

export function clampServings(value: number): number {
  if (!isFiniteNumber(value)) {
    return 1;
  }
  return roundTo(Math.min(QUICK_SERVING_MAX, Math.max(QUICK_SERVING_MIN, value)), 2);
}

export function clampQuickGrams(value: number): number {
  if (!isFiniteNumber(value)) {
    return QUICK_GRAMS_MIN;
  }
  return sanitizeGrams(Math.min(MAX_ITEM_GRAMS, Math.max(QUICK_GRAMS_MIN, value)));
}

export function stepQuickServings(servings: number, direction: 1 | -1): number {
  const current = isFiniteNumber(servings) && servings > 0 ? servings : 0;
  const steps =
    direction > 0
      ? Math.floor(current / QUICK_SERVING_STEP + 1e-9) + 1
      : Math.ceil(current / QUICK_SERVING_STEP - 1e-9) - 1;
  return clampServings(steps * QUICK_SERVING_STEP);
}

export function portionFactor(result: FoodSearchResult, portion: QuickPortion): number {
  if (portion.mode === 'servings') {
    return clampServings(portion.servings);
  }
  if (portion.mode === 'count') {
    const base = resultPortion(result)?.count ?? 0;
    return base > 0 ? clampCount(portion.count) / base : 1;
  }
  const base = sanitizeGrams(result.grams);
  if (base <= 0) {
    return 1;
  }
  return usesGrams(result)
    ? clampQuickGrams(portion.grams) / base
    : mealServingsForGrams(base, portion.grams);
}

function mealServingsForGrams(base: number, grams: number): number {
  const servings = clampQuickGrams(grams) / base;
  return roundTo(
    Math.min(QUICK_SERVING_MAX, Math.max(API_LIMITS.favoriteServingsMin, servings)),
    MEAL_SERVINGS_DECIMALS,
  );
}

export function quickLogGrams(result: FoodSearchResult, portion: QuickPortion): number {
  return portion.mode === 'grams'
    ? clampQuickGrams(portion.grams)
    : sanitizeGrams(result.grams * portionFactor(result, portion));
}

export function quickLogTotals(result: FoodSearchResult, portion: QuickPortion): Nutrients {
  return roundNutrients(
    scaleNutrients(sanitizeNutrients(result.totals), portionFactor(result, portion)),
  );
}

export function isValidPortion(portion: QuickPortion): boolean {
  switch (portion.mode) {
    case 'grams':
      return isFiniteNumber(portion.grams) && portion.grams >= QUICK_GRAMS_MIN;
    case 'servings':
      return isFiniteNumber(portion.servings) && portion.servings >= API_LIMITS.favoriteServingsMin;
    case 'count':
      return isFiniteNumber(portion.count) && portion.count > 0;
  }
}

export function defaultMealType(result: FoodSearchResult, now: Date = new Date()): MealType {
  return result.kind === 'favorite' && result.mealType ? result.mealType : guessMealType(now);
}

export function quickLogBody(
  result: FoodSearchResult,
  portion: QuickPortion,
  mealType: MealType,
  timing: EntryTiming,
): QuickLogRequest {
  return {
    key: result.key,
    ...quickLogAmount(result, portion),
    timestamp: timing.timestamp,
    localDate: timing.localDate,
    mealType,
  };
}

export function quickLogAmount(
  result: FoodSearchResult,
  portion: QuickPortion,
): Pick<QuickLogRequest, 'grams' | 'servings' | 'portionCount'> {
  switch (portion.mode) {
    case 'count':
      return resultPortion(result)
        ? { portionCount: clampCount(portion.count) }
        : { servings: clampServings(portion.count) };
    case 'servings':
      return { servings: clampServings(portion.servings) };
    case 'grams':
      return usesGrams(result)
        ? { grams: clampQuickGrams(portion.grams) }
        : { servings: portionFactor(result, portion) };
  }
}

export function scaledEntryItems(
  items: readonly EntryItemInput[],
  factor: number,
): EntryItemInput[] {
  const safe = isFiniteNumber(factor) && factor > 0 ? factor : 1;
  return items.map((item) => ({
    name: item.name,
    grams: sanitizeGrams(item.grams * safe),
    nutrients: roundNutrients(scaleNutrients(sanitizeNutrients(item.nutrients), safe)),
    confidence: item.confidence ?? null,
    ...itemCountFields(scaledPortion(itemPortion(item), safe)),
    ...productIdField(item.productId),
    ...scaledItemExtras(item, safe),
  }));
}

export function scaledResultPortion(
  result: FoodSearchResult,
  portion: QuickPortion,
): Portion | null {
  return scaledPortion(resultPortion(result), portionFactor(result, portion));
}

export function baselinePhrase(baseline: QuickBaseline, factor: number): string {
  const label = formatCount(factor);
  if (baseline === 'serving') {
    return `${label} ${factor > 1 + 1e-6 ? 'servings' : 'serving'}`;
  }
  if (Math.abs(factor - 1) < 1e-6) {
    return 'Same as last time';
  }
  return factor < 1 ? `${label} of last time` : `${label}× last time`;
}

export function servingChipLabel(servings: number): string {
  return portionFactorLabel(servings);
}
