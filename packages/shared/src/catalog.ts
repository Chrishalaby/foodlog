import type { NutrientKey, Nutrients } from './nutrients.js';
import { MAX_ITEM_GRAMS, nutrientsFromPer100g, roundNutrients, roundTo } from './nutrients.js';
import type { Micros } from './micros.js';
import { microsFromPer100, roundMicros } from './micros.js';

export const CATALOG_GROUPS = [
  'dishes',
  'fast_food',
  'meat',
  'poultry',
  'seafood',
  'dairy_eggs',
  'vegetables',
  'fruits',
  'grains',
  'legumes_nuts',
  'snacks_sweets',
  'drinks',
  'fats_oils',
  'sauces_soups',
  'herbs_spices',
  'baby',
  'other',
] as const;

export type CatalogGroup = (typeof CATALOG_GROUPS)[number];

export const CATALOG_GROUP_LABELS: Record<CatalogGroup, string> = {
  dishes: 'Dishes & sandwiches',
  fast_food: 'Fast food',
  meat: 'Meat',
  poultry: 'Poultry',
  seafood: 'Fish & seafood',
  dairy_eggs: 'Dairy & eggs',
  vegetables: 'Vegetables',
  fruits: 'Fruits',
  grains: 'Bread, grains & pasta',
  legumes_nuts: 'Beans, nuts & seeds',
  snacks_sweets: 'Snacks & sweets',
  drinks: 'Drinks',
  fats_oils: 'Fats & oils',
  sauces_soups: 'Soups & sauces',
  herbs_spices: 'Herbs & spices',
  baby: 'Baby food',
  other: 'Other',
};

export const CATALOG_SOURCES = ['foundation', 'sr_legacy', 'survey'] as const;

export type CatalogSource = (typeof CATALOG_SOURCES)[number];

export const CATALOG_SOURCE_LABELS: Record<CatalogSource, string> = {
  foundation: 'USDA Foundation Foods',
  sr_legacy: 'USDA SR Legacy',
  survey: 'USDA FNDDS',
};

export const CATALOG_DEFAULT_GRAMS = 100;

export interface CatalogPortion {
  label: string;
  grams: number;
}

export interface CatalogFoodValues {
  name: string;
  per100: Nutrients;
  microsPer100: Micros | null;
}

export function isCatalogGroup(value: unknown): value is CatalogGroup {
  return typeof value === 'string' && (CATALOG_GROUPS as readonly string[]).includes(value);
}

export function normalizeCatalogText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function catalogItemName(name: string, max: number): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const cut = trimmed.slice(0, max);
  const comma = cut.lastIndexOf(',');
  if (comma >= Math.floor(max / 2)) {
    return cut.slice(0, comma).trim();
  }
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

export function catalogMissingLabel(missing: readonly NutrientKey[]): string | null {
  if (missing.length === 0) {
    return null;
  }
  const names = missing.map((key) => (key === 'satFat' ? 'saturated fat' : key));
  return `No ${names.join(', ')} data in the source`;
}

export function clampCatalogGrams(grams: number): number {
  if (!Number.isFinite(grams) || grams <= 0) {
    return CATALOG_DEFAULT_GRAMS;
  }
  return roundTo(Math.min(grams, MAX_ITEM_GRAMS), 1);
}

export function catalogNutrients(per100: Nutrients, grams: number): Nutrients {
  return roundNutrients(nutrientsFromPer100g(per100, clampCatalogGrams(grams)));
}

export function catalogMicros(microsPer100: Micros | null, grams: number): Micros | null {
  return roundMicros(microsFromPer100(microsPer100, clampCatalogGrams(grams)));
}
