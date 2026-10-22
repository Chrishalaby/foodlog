import {
  API_LIMITS,
  NUTRIENT_KEYS,
  roundNutrients,
  sanitizeNutrients,
  type FoodValueSource,
  type MyFoodDto,
  type Nutrients,
  type ProductDto,
  type SavedFoodRef,
} from '@food/shared';
import { foldFoodText } from './food-match';
import { formatNumber } from './format';
import { cleanMicrosPer100 } from './micros';

export type SavedFoodBadge = 'Barcode' | 'Label' | 'Manual';

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const UNSTORABLE_CHARACTERS = /[\p{Cc}\p{Cs}]/gu;
const WHITESPACE = /\s+/gu;

function cleanName(value: string): string {
  const collapsed = value.replace(UNSTORABLE_CHARACTERS, ' ').replace(WHITESPACE, ' ').trim();
  return Array.from(collapsed).slice(0, API_LIMITS.nameMax).join('').trimEnd();
}

function startsWithWord(text: string, word: string): boolean {
  return word !== '' && text.startsWith(word) && !WORD_CHARACTER.test(text.charAt(word.length));
}

export function savedFoodItemName(food: Pick<SavedFoodRef, 'name' | 'brand'>): string {
  const name = cleanName(food.name);
  const brand = cleanName(food.brand ?? '');
  if (brand === '' || startsWithWord(foldFoodText(name), foldFoodText(brand))) {
    return name;
  }
  return cleanName(`${brand} ${name}`);
}

export const VALUE_SOURCE_LABELS: Record<FoodValueSource, string> = {
  saved: 'Saved',
  label: 'Label',
  estimate: 'Estimate',
};

export function productIdField(productId: string | null | undefined): { productId?: string } {
  return typeof productId === 'string' && productId.length > 0 ? { productId } : {};
}

export function savedFoodRef(
  food: Pick<
    ProductDto,
    'id' | 'name' | 'brand' | 'basisUnit' | 'per100' | 'unitName' | 'unitGrams'
  > &
    Partial<Pick<ProductDto, 'microsPer100'>>,
): SavedFoodRef {
  return {
    id: food.id,
    name: food.name,
    brand: food.brand,
    basisUnit: food.basisUnit,
    per100: roundNutrients(sanitizeNutrients(food.per100)),
    microsPer100: cleanMicrosPer100(food.microsPer100),
    unitName: food.unitName ?? null,
    unitGrams: food.unitGrams ?? null,
  };
}

export function savedFoodBadges(food: Pick<ProductDto, 'barcode' | 'source'>): SavedFoodBadge[] {
  const badges: SavedFoodBadge[] = [];
  if (food.barcode) {
    badges.push('Barcode');
  }
  if (food.source === 'label') {
    badges.push('Label');
  }
  if (badges.length === 0) {
    badges.push('Manual');
  }
  return badges;
}

export function kcalPer100Text(per100: Pick<Nutrients, 'calories'>, unit: 'g' | 'ml'): string {
  return `${formatNumber(per100.calories)} kcal/100 ${unit}`;
}

export function kcalRangeText(min: number, max: number, unit: 'g' | 'ml' = 'g'): string {
  const low = formatNumber(min);
  const high = formatNumber(max);
  return low === high ? `${low} kcal/100 ${unit}` : `${low}–${high} kcal/100 ${unit}`;
}

export function timesUsed(food: Pick<MyFoodDto, 'useCount' | 'itemCount'>): number {
  return Math.max(food.useCount, food.itemCount);
}

export function usedText(count: number): string {
  if (count <= 0) {
    return 'not used yet';
  }
  return count === 1 ? 'used once' : `used ${formatNumber(count)} times`;
}

export function aliasesText(aliases: readonly string[]): string | null {
  const clean = aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
  return clean.length > 0 ? `also: ${clean.join(', ')}` : null;
}

export function sameValues(a: Nutrients, b: Nutrients): boolean {
  const left = roundNutrients(sanitizeNutrients(a));
  const right = roundNutrients(sanitizeNutrients(b));
  return NUTRIENT_KEYS.every((key) => left[key] === right[key]);
}

export function lowerFirst(text: string): string {
  if (text.length < 2 || text[1] !== text[1].toLowerCase()) {
    return text;
  }
  return text[0].toLowerCase() + text.slice(1);
}

export function pastItemsText(count: number): string {
  return count === 1 ? '1 past item' : `${formatNumber(count)} past items`;
}
