import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  isFiniteNumber,
  nutrientsFromPer100g,
  roundNutrients,
  roundTo,
  sanitizeNutrients,
  type LogProductRequest,
  type MealType,
  type Nutrients,
  type ProductDto,
} from '@food/shared';
import { sanitizeGrams } from '../../../shared/ui/items-editor/items-math';
import type { EntryTiming } from '../entry-timing';

export type ProductPortion =
  | { readonly mode: 'grams'; readonly grams: number }
  | { readonly mode: 'servings'; readonly servings: number };

export type PortionChipId = 'serving' | 'half-pack' | 'pack' | 'hundred';

export interface PortionChip {
  id: PortionChipId;
  label: string;
  grams: number;
}

export const FALLBACK_SERVING_G = 100;
export const PACK_DEFAULT_MAX_G = 350;
export const PRODUCT_GRAMS_MIN = 1;
export const PRODUCT_SERVINGS_STEP = 0.5;
export const PRODUCT_SERVINGS_MIN = PRODUCT_SERVINGS_STEP;
export const PRODUCT_SERVINGS_MAX = API_LIMITS.favoriteServingsMax;

const SAME_GRAMS = 0.05;

function positive(value: number | null | undefined): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
}

export function servingSizeOf(product: ProductDto): number | null {
  return positive(product.servingSizeG);
}

export function packSizeOf(product: ProductDto): number | null {
  return positive(product.packSizeG);
}

export function servingGrams(product: ProductDto): number {
  return servingSizeOf(product) ?? FALLBACK_SERVING_G;
}

export function clampProductGrams(value: number): number {
  if (!isFiniteNumber(value)) {
    return PRODUCT_GRAMS_MIN;
  }
  return sanitizeGrams(Math.min(MAX_ITEM_GRAMS, Math.max(PRODUCT_GRAMS_MIN, value)));
}

export function maxProductServings(product: ProductDto): number {
  const steps = Math.floor(MAX_ITEM_GRAMS / servingGrams(product) / PRODUCT_SERVINGS_STEP + 1e-9);
  return Math.max(
    PRODUCT_SERVINGS_MIN,
    Math.min(PRODUCT_SERVINGS_MAX, steps * PRODUCT_SERVINGS_STEP),
  );
}

export function clampProductServings(value: number): number {
  if (!isFiniteNumber(value)) {
    return 1;
  }
  return roundTo(Math.min(PRODUCT_SERVINGS_MAX, Math.max(PRODUCT_SERVINGS_MIN, value)), 2);
}

export function defaultProductPortion(product: ProductDto): ProductPortion {
  if (servingSizeOf(product) !== null) {
    return { mode: 'servings', servings: 1 };
  }
  const pack = packSizeOf(product);
  if (pack !== null && pack <= PACK_DEFAULT_MAX_G) {
    return { mode: 'grams', grams: clampProductGrams(pack) };
  }
  return { mode: 'grams', grams: FALLBACK_SERVING_G };
}

export function portionGrams(product: ProductDto, portion: ProductPortion): number {
  return portion.mode === 'grams'
    ? clampProductGrams(portion.grams)
    : clampProductGrams(clampProductServings(portion.servings) * servingGrams(product));
}

export function portionServings(product: ProductDto, portion: ProductPortion): number {
  return portion.mode === 'servings'
    ? clampProductServings(portion.servings)
    : roundTo(portionGrams(product, portion) / servingGrams(product), 2);
}

export function productTotals(product: ProductDto, grams: number): Nutrients {
  const safe = isFiniteNumber(grams) && grams > 0 ? grams : 0;
  return roundNutrients(nutrientsFromPer100g(sanitizeNutrients(product.per100), safe));
}

export function isValidProductPortion(portion: ProductPortion): boolean {
  return portion.mode === 'grams'
    ? isFiniteNumber(portion.grams) &&
        portion.grams >= PRODUCT_GRAMS_MIN &&
        portion.grams <= MAX_ITEM_GRAMS
    : isFiniteNumber(portion.servings) && portion.servings >= API_LIMITS.favoriteServingsMin;
}

export function stepProductServings(servings: number, direction: 1 | -1): number {
  const current = isFiniteNumber(servings) && servings > 0 ? servings : 0;
  const steps =
    direction > 0
      ? Math.floor(current / PRODUCT_SERVINGS_STEP + 1e-9) + 1
      : Math.ceil(current / PRODUCT_SERVINGS_STEP - 1e-9) - 1;
  return clampProductServings(steps * PRODUCT_SERVINGS_STEP);
}

export function portionChips(product: ProductDto): PortionChip[] {
  const unit = product.basisUnit;
  const serving = servingSizeOf(product);
  const pack = packSizeOf(product);
  const candidates: PortionChip[] = [];
  if (serving !== null) {
    candidates.push({ id: 'serving', label: '1 serving', grams: clampProductGrams(serving) });
  }
  if (pack !== null) {
    candidates.push({ id: 'half-pack', label: '½ pack', grams: clampProductGrams(pack / 2) });
    candidates.push({ id: 'pack', label: '1 pack', grams: clampProductGrams(pack) });
  }
  candidates.push({ id: 'hundred', label: `100 ${unit}`, grams: 100 });
  return candidates.filter(
    (chip, index) =>
      candidates.findIndex((other) => Math.abs(other.grams - chip.grams) < SAME_GRAMS) === index,
  );
}

export function chipSelected(chip: PortionChip, grams: number): boolean {
  return Math.abs(chip.grams - grams) < SAME_GRAMS;
}

export function logProductBody(
  product: ProductDto,
  portion: ProductPortion,
  mealType: MealType,
  timing: EntryTiming,
): LogProductRequest {
  const amount =
    portion.mode === 'servings'
      ? { servings: clampProductServings(portion.servings) }
      : { grams: portionGrams(product, portion) };
  return { ...amount, timestamp: timing.timestamp, localDate: timing.localDate, mealType };
}

export function productDisplayName(product: Pick<ProductDto, 'name' | 'brand'>): string {
  const brand = product.brand?.trim() ?? '';
  const name = product.name.trim();
  if (!brand || name.toLowerCase().startsWith(brand.toLowerCase())) {
    return name;
  }
  return `${brand} ${name}`;
}
