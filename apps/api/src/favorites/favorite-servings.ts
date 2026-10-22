import {
  API_LIMITS,
  type EntryItemInput,
  MAX_ITEM_GRAMS,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  roundTo,
  scaleNutrients,
} from '@food/shared';
import { scaledItemExtras } from '../common/micros.js';
import { withScaledCount } from '../common/portions.js';

export const DEFAULT_SERVINGS = 1;

const SERVINGS_LABEL_DECIMALS = 2;

export function formatServings(servings: number): string {
  return String(roundTo(servings, SERVINGS_LABEL_DECIMALS));
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  return Array.from(value).slice(0, maxCodePoints).join('');
}

export function favoriteEntryName(
  name: string,
  servings: number,
  hasPortion = false,
): string {
  const label = formatServings(servings);
  if (hasPortion || label === formatServings(DEFAULT_SERVINGS)) {
    return name;
  }
  return nameWithSuffix(name, ` ×${label}`);
}

export function nameWithSuffix(name: string, suffix: string): string {
  const base = truncateCodePoints(
    name,
    API_LIMITS.nameMax - suffix.length,
  ).trimEnd();
  return `${base}${suffix}`;
}

export function scaleFavoriteItem(
  item: EntryItemInput,
  servings: number,
): EntryItemInput {
  return {
    ...withScaledCount(item, servings),
    grams: item.grams * servings,
    nutrients: scaleNutrients(item.nutrients, servings),
    ...scaledItemExtras(item, servings),
  };
}

export function scaleFavoriteItems(
  items: readonly EntryItemInput[],
  servings: number,
): EntryItemInput[] {
  return items.map((item) => scaleFavoriteItem(item, servings));
}

export function isWithinItemLimits(item: EntryItemInput): boolean {
  return (
    item.grams <= MAX_ITEM_GRAMS &&
    NUTRIENT_KEYS.every((key) => item.nutrients[key] <= NUTRIENT_META[key].max)
  );
}
