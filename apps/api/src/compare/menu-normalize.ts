import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  type MenuDish,
  type MenuScanResponse,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  type Nutrients,
  nutrientsFromPer100g,
  per100gFromNutrients,
  roundNutrients,
  roundTo,
  zeroNutrients,
} from '@food/shared';
import {
  cleanText,
  type ItemFlag,
  type NutrientFlag,
  normalizeOutputPortion,
  nutrientsFromOutput,
  validatePer100,
} from '../ai/normalize.js';
import { foldText } from '../foods/food-text.js';
import type { MenuScanDish, MenuScanOutput } from './menu-scan.schema.js';

export type NormalizedMenuScan = Omit<MenuScanResponse, 'usage'>;

export const MENU_TEXT_LIMITS = {
  restaurant: API_LIMITS.nameMax,
  name: API_LIMITS.nameMax,
  description: 200,
  notes: 240,
  warning: 200,
  modelWarnings: 5,
} as const;

export const NO_DISHES_WARNING =
  'No dishes found — try a sharper photo of the menu';

const GRAMS_DECIMALS = 1;
const TRAILING_PUNCTUATION = /[\s.;:,]+$/u;
const DENSITY_FLAGS: ReadonlySet<NutrientFlag> = new Set([
  'mass_balance',
  'energy_density_impossible',
  'sodium_impossible',
]);

const DISH_FLAG_WARNINGS: Record<ItemFlag, (dish: string) => string> = {
  negative_value: (d) => `Replaced invalid nutrient values for ${d} with 0`,
  kj_as_kcal_fixed: (d) => `Converted kJ to kcal for ${d}`,
  atwater_mismatch: (d) =>
    `Calories for ${d} don't match its macros — double-check`,
  mass_balance: (d) =>
    `Macros for ${d} add up to more than its weight — double-check`,
  fiber_gt_carbs: (d) =>
    `Fiber for ${d} is higher than its carbs — double-check`,
  sugar_gt_carbs: (d) =>
    `Sugar for ${d} is higher than its carbs — double-check`,
  satfat_gt_fat: (d) =>
    `Saturated fat for ${d} is higher than its total fat — double-check`,
  energy_density_impossible: (d) =>
    `Calories for ${d} are impossibly high — double-check`,
  sodium_impossible: (d) => `Sodium for ${d} is impossibly high — double-check`,
  grams_clamped: (d) => `Weight for ${d} was capped at ${MAX_ITEM_GRAMS} g`,
};

interface ServingEstimate {
  grams: number;
  nutrients: Nutrients;
  flags: ItemFlag[];
}

interface NormalizedDish {
  dish: MenuDish;
  flags: ItemFlag[];
}

function optionalText(value: string | null, max: number): string | null {
  return cleanText(value, max) || null;
}

function clampToNutrientMax(n: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = Math.min(n[key], NUTRIENT_META[key].max);
  }
  return out;
}

function withoutDensityFlags(flags: readonly NutrientFlag[]): NutrientFlag[] {
  return flags.filter((flag) => !DENSITY_FLAGS.has(flag));
}

function servingWithoutWeight(perServing: Nutrients): ServingEstimate {
  const { per100: values, flags } = validatePer100(perServing);
  return {
    grams: 0,
    nutrients: roundNutrients(clampToNutrientMax(values)),
    flags: withoutDensityFlags(flags),
  };
}

export function estimateServing(
  perServing: Nutrients,
  quantityG: number,
): ServingEstimate {
  const per100 = per100gFromNutrients(perServing, quantityG);
  const grams = roundTo(Math.min(quantityG, MAX_ITEM_GRAMS), GRAMS_DECIMALS);
  if (per100 === null || grams <= 0) {
    return servingWithoutWeight(perServing);
  }
  const validated = validatePer100(per100);
  const flags: ItemFlag[] =
    quantityG > MAX_ITEM_GRAMS
      ? [...validated.flags, 'grams_clamped']
      : validated.flags;
  return {
    grams,
    nutrients: roundNutrients(
      clampToNutrientMax(nutrientsFromPer100g(validated.per100, quantityG)),
    ),
    flags,
  };
}

function withoutTrailingPunctuation(text: string): string {
  return text.replace(TRAILING_PUNCTUATION, '');
}

export function dishNotes(
  portionBasis: string,
  notes: string | null,
): string | null {
  const parts = [portionBasis, notes ?? '']
    .map((part) =>
      withoutTrailingPunctuation(cleanText(part, MENU_TEXT_LIMITS.notes)),
    )
    .filter(Boolean);
  const unique = parts.filter(
    (part, index) =>
      parts.findIndex((other) => foldText(other) === foldText(part)) === index,
  );
  return cleanText(unique.join('. '), MENU_TEXT_LIMITS.notes) || null;
}

function normalizeDish(dish: MenuScanDish, name: string): NormalizedDish {
  const serving = estimateServing(
    nutrientsFromOutput(dish.per_serving),
    dish.estimated_quantity_g,
  );
  return {
    dish: {
      name,
      description: optionalText(dish.description, MENU_TEXT_LIMITS.description),
      grams: serving.grams,
      portion: normalizeOutputPortion(dish.portion),
      nutrients: serving.nutrients,
      confidence: dish.confidence,
      notes: dishNotes(dish.portion_basis, dish.notes),
    },
    flags: serving.flags,
  };
}

interface NamedDish {
  dish: MenuScanDish;
  name: string;
}

function uniqueNamedDishes(dishes: readonly MenuScanDish[]): NamedDish[] {
  const seen = new Set<string>();
  const named: NamedDish[] = [];
  for (const dish of dishes) {
    const name = cleanText(dish.name, MENU_TEXT_LIMITS.name);
    const key = foldText(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      named.push({ dish, name });
    }
  }
  return named;
}

function modelWarnings(warnings: readonly string[]): string[] {
  return warnings
    .map((warning) => cleanText(warning, MENU_TEXT_LIMITS.warning))
    .filter(Boolean)
    .slice(0, MENU_TEXT_LIMITS.modelWarnings);
}

function dishWarnings(normalized: readonly NormalizedDish[]): string[] {
  return normalized.flatMap(({ dish, flags }) =>
    flags.map((flag) => DISH_FLAG_WARNINGS[flag](`'${dish.name}'`)),
  );
}

function countWarnings(named: number, kept: number): string[] {
  if (kept === 0) {
    return [NO_DISHES_WARNING];
  }
  return kept < named ? [`Only the first ${kept} dishes were kept`] : [];
}

export function normalizeMenuScan(raw: MenuScanOutput): NormalizedMenuScan {
  const named = uniqueNamedDishes(raw.dishes);
  const kept = named.slice(0, API_LIMITS.menuDishesMax);
  const normalized = kept.map(({ dish, name }) => normalizeDish(dish, name));
  const warnings = [
    ...modelWarnings(raw.warnings),
    ...countWarnings(named.length, kept.length),
    ...dishWarnings(normalized),
  ];
  return {
    restaurant: optionalText(raw.restaurant, MENU_TEXT_LIMITS.restaurant),
    dishes: normalized.map(({ dish }) => dish),
    warnings: [...new Set(warnings)],
  };
}
