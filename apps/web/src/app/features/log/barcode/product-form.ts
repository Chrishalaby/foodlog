import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  isFiniteNumber,
  per100gFromNutrients,
  roundNutrients,
  roundTo,
  sanitizeNutrients,
  zeroNutrients,
  type EntryItemInput,
  type LabelInfo,
  type Micros,
  type NutrientKey,
  type Nutrients,
  type ProductDto,
  type ProductSource,
  type UpsertProductRequest,
} from '@food/shared';
import { cleanMicrosPer100, itemMicrosPer100 } from '../../../shared/utils/micros';
import { nutrientsForAmount } from '../label-portion';

export type BasisUnit = ProductDto['basisUnit'];

export interface ProductDraft {
  name: string;
  brand: string;
  basisUnit: BasisUnit;
  per100: Nutrients;
  microsPer100: Micros | null;
  servingSizeG: number;
  packSizeG: number;
}

export interface Per100Field {
  key: NutrientKey;
  label: string;
  unit: string;
  decimals: number;
  max: number;
  indent: boolean;
}

const PER100_ORDER: readonly { key: NutrientKey; label: string; indent: boolean }[] = [
  { key: 'calories', label: 'Energy', indent: false },
  { key: 'protein', label: 'Protein', indent: false },
  { key: 'carbs', label: 'Carbs', indent: false },
  { key: 'sugar', label: 'of which sugars', indent: true },
  { key: 'fat', label: 'Fat', indent: false },
  { key: 'satFat', label: 'of which saturated', indent: true },
  { key: 'fiber', label: 'Fiber', indent: false },
  { key: 'sodium', label: 'Sodium', indent: false },
  { key: 'alcohol', label: 'Alcohol', indent: false },
];

export const PER100_CALORIES_MAX = 950;
export const PER100_SODIUM_MAX = 40000;

export function per100Max(key: NutrientKey, unit: BasisUnit): number {
  if (key === 'calories') {
    return PER100_CALORIES_MAX;
  }
  if (key === 'sodium') {
    return PER100_SODIUM_MAX;
  }
  return unit === 'ml' ? 150 : 100;
}

export function missingNutrientNames(keys: readonly NutrientKey[]): string[] {
  return NUTRIENT_KEYS.filter((key) => keys.includes(key)).map((key) =>
    NUTRIENT_META[key].label.toLowerCase(),
  );
}

export function per100InRange(per100: Nutrients, unit: BasisUnit): boolean {
  return NUTRIENT_KEYS.every((key) => per100[key] <= per100Max(key, unit));
}

export function per100Fields(unit: BasisUnit): Per100Field[] {
  return PER100_ORDER.map(({ key, label, indent }) => ({
    key,
    label,
    indent,
    unit: NUTRIENT_META[key].unit,
    decimals: NUTRIENT_META[key].decimals,
    max: per100Max(key, unit),
  }));
}

function positiveOrZero(value: number | null | undefined): number {
  return isFiniteNumber(value) && value > 0 ? roundTo(Math.min(value, MAX_ITEM_GRAMS), 1) : 0;
}

export function emptyProductDraft(): ProductDraft {
  return {
    name: '',
    brand: '',
    basisUnit: 'g',
    per100: zeroNutrients(),
    microsPer100: null,
    servingSizeG: 0,
    packSizeG: 0,
  };
}

export function draftFromProduct(product: ProductDto): ProductDraft {
  return {
    name: product.name,
    brand: product.brand ?? '',
    basisUnit: product.basisUnit,
    per100: roundNutrients(sanitizeNutrients(product.per100)),
    microsPer100: cleanMicrosPer100(product.microsPer100),
    servingSizeG: positiveOrZero(product.servingSizeG),
    packSizeG: positiveOrZero(product.packSizeG),
  };
}

export function productDraftError(draft: ProductDraft): string | null {
  if (draft.name.trim().length === 0) {
    return 'Give the product a name.';
  }
  for (const key of NUTRIENT_KEYS) {
    const value = draft.per100[key];
    const max = per100Max(key, draft.basisUnit);
    if (!isFiniteNumber(value) || value < 0 || value > max) {
      return `${NUTRIENT_META[key].label} per 100 ${draft.basisUnit} must be between 0 and ${max}.`;
    }
  }
  if (draft.per100.sugar > draft.per100.carbs + 0.05) {
    return "Sugars can't be more than carbs.";
  }
  if (draft.per100.satFat > draft.per100.fat + 0.05) {
    return "Saturated fat can't be more than fat.";
  }
  for (const size of [draft.servingSizeG, draft.packSizeG]) {
    if (!isFiniteNumber(size) || size < 0 || size > MAX_ITEM_GRAMS) {
      return `Sizes must be between 0 and ${MAX_ITEM_GRAMS} ${draft.basisUnit}.`;
    }
  }
  return null;
}

function cleanText(text: string | null | undefined, max: number): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function size(value: number | null | undefined): number | null {
  const clean = positiveOrZero(value);
  return clean > 0 ? clean : null;
}

export function microsPer100Field(micros: unknown): { microsPer100?: Micros } {
  const clean = cleanMicrosPer100(micros);
  return clean ? { microsPer100: clean } : {};
}

export function productRequestFromDraft(
  draft: ProductDraft,
  source: ProductSource,
): UpsertProductRequest {
  const brand = cleanText(draft.brand, API_LIMITS.nameMax);
  return {
    name: cleanText(draft.name, API_LIMITS.nameMax),
    brand: brand || null,
    basisUnit: draft.basisUnit,
    per100: roundNutrients(sanitizeNutrients(draft.per100)),
    ...microsPer100Field(draft.microsPer100),
    servingSizeG: size(draft.servingSizeG),
    packSizeG: size(draft.packSizeG),
    source,
  };
}

function itemPer100(item: EntryItemInput): Nutrients | null {
  const per100 = per100gFromNutrients(sanitizeNutrients(item.nutrients), item.grams);
  return per100 ? roundNutrients(per100) : null;
}

export function itemMatchesLabel(label: LabelInfo, item: EntryItemInput): boolean {
  const expected = nutrientsForAmount(label, item.grams);
  const actual = roundNutrients(sanitizeNutrients(item.nutrients));
  return NUTRIENT_KEYS.every(
    (key) => Math.abs(expected[key] - actual[key]) <= 10 ** -NUTRIENT_META[key].decimals + 1e-9,
  );
}

export function productRequestFromLabel(
  label: LabelInfo,
  name: string,
  item: EntryItemInput | null = null,
): UpsertProductRequest | null {
  const cleanName = cleanText(name, API_LIMITS.nameMax);
  if (!cleanName) {
    return null;
  }
  const corrected = item && !itemMatchesLabel(label, item) ? itemPer100(item) : null;
  return {
    name: cleanName,
    brand: null,
    basisUnit: label.basisUnit,
    per100: corrected ?? roundNutrients(sanitizeNutrients(label.per100)),
    ...microsPer100Field(label.microsPer100),
    servingSizeG: size(label.servingSize),
    packSizeG: size(label.packSize),
    source: 'label',
  };
}

export function productRequestFromItem(
  item: EntryItemInput,
  productName: string = item.name,
): UpsertProductRequest | null {
  const name = cleanText(productName, API_LIMITS.nameMax);
  const per100 = name ? itemPer100(item) : null;
  if (!per100) {
    return null;
  }
  return {
    name,
    brand: null,
    basisUnit: 'g',
    per100,
    ...microsPer100Field(itemMicrosPer100(item.micros, item.grams)),
    servingSizeG: null,
    packSizeG: null,
    source: 'manual',
  };
}
