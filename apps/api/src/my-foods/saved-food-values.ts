import {
  NUTRIENT_KEYS,
  type Nutrients,
  nutrientsFromPer100g,
  roundNutrients,
} from '@food/shared';

const VALUE_TOLERANCE = 1e-6;

export interface WeighedNutrients {
  grams: number;
  nutrients: Nutrients;
}

export function savedItemNutrients(
  per100: Nutrients,
  grams: number,
): Nutrients {
  return roundNutrients(nutrientsFromPer100g(per100, grams));
}

export function sameNutrients(a: Nutrients, b: Nutrients): boolean {
  return NUTRIENT_KEYS.every(
    (key) => Math.abs(a[key] - b[key]) < VALUE_TOLERANCE,
  );
}

export function matchesSavedValues(
  item: WeighedNutrients,
  per100: Nutrients,
): boolean {
  return sameNutrients(savedItemNutrients(per100, item.grams), item.nutrients);
}
