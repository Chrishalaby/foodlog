import {
  API_LIMITS,
  atwaterCalories,
  MAX_ITEM_GRAMS,
  MICRO_KEYS,
  type MicroKey,
  type Micros,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  type NutrientKey,
  type Nutrients,
  roundTo,
  zeroNutrients,
} from '@food/shared';
import { per100Micros } from '../common/micros.js';
import { type BasisUnit, cleanText } from './product-data.js';

export interface OffProduct {
  name: string;
  brand: string | null;
  basisUnit: BasisUnit;
  per100: Nutrients;
  microsPer100: Micros | null;
  servingSizeG: number | null;
  packSizeG: number | null;
  imageUrl: string | null;
  missingNutrients: NutrientKey[];
}

type JsonObject = Record<string, unknown>;

export const OFF_PRODUCT_FIELDS = [
  'code',
  'product_name',
  'brands',
  'nutriments',
  'serving_quantity',
  'serving_size',
  'product_quantity',
  'quantity',
  'image_front_small_url',
  'nutrition_data_per',
] as const;

export const KJ_PER_KCAL = 4.184;
export const SODIUM_MG_PER_G_SALT = 400;
export const ETHANOL_G_PER_ML = 0.789;
export const MAX_KCAL_PER_100 = 900;
export const MG_PER_G = 1000;
export const UG_PER_G = 1_000_000;
export const DFE_PER_UG_FOLIC_ACID = 1.7;

type OffMicroSource = readonly [field: string, perGram: number];

export const OFF_MICRO_SOURCES: Record<MicroKey, readonly OffMicroSource[]> = {
  vitaminA: [['vitamin-a_100g', UG_PER_G]],
  vitaminC: [['vitamin-c_100g', MG_PER_G]],
  vitaminD: [['vitamin-d_100g', UG_PER_G]],
  vitaminE: [['vitamin-e_100g', MG_PER_G]],
  vitaminK: [
    ['vitamin-k_100g', UG_PER_G],
    ['phylloquinone_100g', UG_PER_G],
  ],
  vitaminB6: [['vitamin-b6_100g', MG_PER_G]],
  vitaminB12: [['vitamin-b12_100g', UG_PER_G]],
  folate: [
    ['folates_100g', UG_PER_G],
    ['vitamin-b9_100g', UG_PER_G],
    ['folic-acid_100g', UG_PER_G * DFE_PER_UG_FOLIC_ACID],
  ],
  calcium: [['calcium_100g', MG_PER_G]],
  iron: [['iron_100g', MG_PER_G]],
  magnesium: [['magnesium_100g', MG_PER_G]],
  potassium: [['potassium_100g', MG_PER_G]],
  zinc: [['zinc_100g', MG_PER_G]],
  cholesterol: [['cholesterol_100g', MG_PER_G]],
  caffeine: [['caffeine_100g', MG_PER_G]],
};

const NUTRIENT_DECIMALS = 2;
const AMOUNT_DECIMALS = 1;
const MIN_AMOUNT = 0.1;
const MASS_TOLERANCE_G = 1;
const FIBER_INCLUDED_KCAL_PER_G = 1;
const FIBER_INCLUDED_MIN_KCAL = 10;
const POLYOL_FIELDS = ['polyols_100g', 'erythritol_100g'] as const;
const IMAGE_URL_MAX = 500;
const IMAGE_HOST = 'openfoodfacts.org';
const NUMERIC_TEXT = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
const OFF_NUTRIENT_SOURCES: Partial<Record<NutrientKey, readonly string[]>> = {
  protein: ['proteins_100g'],
  carbs: ['carbohydrates-total_100g', 'carbohydrates_100g'],
  fat: ['fat_100g'],
  satFat: ['saturated-fat_100g'],
  fiber: ['fiber_100g'],
  sugar: ['sugars_100g'],
  sodium: ['sodium_100g', 'salt_100g'],
};
const QUANTITY_UNIT =
  /[\d\u0660-\u0669\u06f0-\u06f9]\s*(?:(?<volume>ml|cl|dl|ltr|lt|l|litres?|liters?|fl\.?\s*oz|مل|لتر|ل)|mg|kg|g|gr|grams?|grammes?|oz|lbs?|غرام|جرام|كغ|كجم|جم|غ)(?![\p{L}\p{N}])/iu;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function offNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !NUMERIC_TEXT.test(value.trim())) {
    return null;
  }
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown): number | null {
  const parsed = offNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function offText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function plausibleKcal(kcal: number): number | null {
  return kcal <= MAX_KCAL_PER_100 ? kcal : null;
}

export function offEnergyKcal(nutriments: JsonObject): number | null {
  const kcal = nonNegative(nutriments['energy-kcal_100g']);
  if (kcal !== null) {
    return plausibleKcal(kcal) ?? plausibleKcal(kcal / KJ_PER_KCAL);
  }
  const kj =
    nonNegative(nutriments['energy-kj_100g']) ??
    nonNegative(nutriments['energy_100g']);
  return kj === null ? null : plausibleKcal(kj / KJ_PER_KCAL);
}

export function offSodiumMg(nutriments: JsonObject): number {
  const sodium = nonNegative(nutriments['sodium_100g']);
  if (sodium !== null) {
    return sodium * MG_PER_G;
  }
  return (nonNegative(nutriments['salt_100g']) ?? 0) * SODIUM_MG_PER_G_SALT;
}

export function offAlcoholG(nutriments: JsonObject): number {
  const alcohol = nonNegative(nutriments['alcohol_100g']) ?? 0;
  const unit = offText(nutriments['alcohol_unit']).trim().toLowerCase();
  return unit === 'g' ? alcohol : alcohol * ETHANOL_G_PER_ML;
}

function hasPolyols(nutriments: JsonObject): boolean {
  return POLYOL_FIELDS.some(
    (field) => (nonNegative(nutriments[field]) ?? 0) > 0,
  );
}

function fiberIncludedByMass(
  nutriments: JsonObject,
  basisUnit: BasisUnit,
  carbs: number,
  fiber: number,
): boolean {
  const otherMass =
    (nonNegative(nutriments['proteins_100g']) ?? 0) +
    (nonNegative(nutriments['fat_100g']) ?? 0);
  const massLimit = 100 + MASS_TOLERANCE_G;
  return (
    basisUnit === 'g' &&
    otherMass + carbs + fiber > massLimit &&
    otherMass + carbs <= massLimit
  );
}

function fiberIncludedByEnergy(
  nutriments: JsonObject,
  carbs: number,
  fiber: number,
  calories: number,
): boolean {
  if (calories <= 0 || hasPolyols(nutriments)) {
    return false;
  }
  const kcalIfFiberExcluded = atwaterCalories({
    protein: nonNegative(nutriments['proteins_100g']) ?? 0,
    fat: nonNegative(nutriments['fat_100g']) ?? 0,
    alcohol: offAlcoholG(nutriments),
    carbs: carbs + fiber,
    fiber,
  });
  return (
    kcalIfFiberExcluded - calories >=
    Math.max(fiber * FIBER_INCLUDED_KCAL_PER_G, FIBER_INCLUDED_MIN_KCAL)
  );
}

export function offTotalCarbs(
  nutriments: JsonObject,
  basisUnit: BasisUnit,
  calories: number,
): number {
  const declaredTotal = nonNegative(nutriments['carbohydrates-total_100g']);
  if (declaredTotal !== null) {
    return declaredTotal;
  }
  const carbs = nonNegative(nutriments['carbohydrates_100g']) ?? 0;
  const fiber = nonNegative(nutriments['fiber_100g']) ?? 0;
  if (
    fiber === 0 ||
    fiberIncludedByMass(nutriments, basisUnit, carbs, fiber) ||
    fiberIncludedByEnergy(nutriments, carbs, fiber, calories)
  ) {
    return carbs;
  }
  return carbs + fiber;
}

function boundedNutrients(values: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = roundTo(
      Math.min(Math.max(values[key], 0), NUTRIENT_META[key].max),
      NUTRIENT_DECIMALS,
    );
  }
  return out;
}

export function offPer100(
  nutriments: JsonObject,
  calories: number,
  basisUnit: BasisUnit,
): Nutrients {
  return boundedNutrients({
    calories,
    protein: nonNegative(nutriments['proteins_100g']) ?? 0,
    carbs: offTotalCarbs(nutriments, basisUnit, calories),
    fat: nonNegative(nutriments['fat_100g']) ?? 0,
    satFat: nonNegative(nutriments['saturated-fat_100g']) ?? 0,
    fiber: nonNegative(nutriments['fiber_100g']) ?? 0,
    sugar: nonNegative(nutriments['sugars_100g']) ?? 0,
    sodium: offSodiumMg(nutriments),
    alcohol: offAlcoholG(nutriments),
  });
}

function offMicroAmount(
  nutriments: JsonObject,
  sources: readonly OffMicroSource[],
): number | null {
  for (const [field, perGram] of sources) {
    const grams = nonNegative(nutriments[field]);
    if (grams !== null) {
      return grams * perGram;
    }
  }
  return null;
}

export function offMicrosPer100(nutriments: JsonObject): Micros | null {
  const micros: Micros = {};
  for (const key of MICRO_KEYS) {
    const amount = offMicroAmount(nutriments, OFF_MICRO_SOURCES[key]);
    if (amount !== null) {
      micros[key] = amount;
    }
  }
  return per100Micros(micros);
}

export function offMissingNutrients(nutriments: JsonObject): NutrientKey[] {
  return NUTRIENT_KEYS.filter((key) => {
    const fields = OFF_NUTRIENT_SOURCES[key] ?? [];
    return (
      fields.length > 0 &&
      fields.every((field) => nonNegative(nutriments[field]) === null)
    );
  });
}

function quantityUnit(value: unknown): BasisUnit | null {
  const match = QUANTITY_UNIT.exec(offText(value));
  if (match === null) {
    return null;
  }
  return match.groups?.['volume'] === undefined ? 'g' : 'ml';
}

export function offBasisUnit(product: JsonObject): BasisUnit {
  return (
    quantityUnit(product['quantity']) ??
    quantityUnit(product['serving_size']) ??
    'g'
  );
}

export function offAmount(value: unknown): number | null {
  const amount = nonNegative(value);
  if (amount === null) {
    return null;
  }
  const rounded = roundTo(amount, AMOUNT_DECIMALS);
  return rounded >= MIN_AMOUNT && rounded <= MAX_ITEM_GRAMS ? rounded : null;
}

export function offBrand(value: unknown): string | null {
  const [first = ''] = offText(value).split(',');
  const brand = cleanText(first, API_LIMITS.nameMax);
  return brand === '' ? null : brand;
}

export function offImageUrl(value: unknown): string | null {
  const text = offText(value).trim();
  if (text === '' || text.length > IMAGE_URL_MAX || !URL.canParse(text)) {
    return null;
  }
  const url = new URL(text);
  const trustedHost =
    url.hostname === IMAGE_HOST || url.hostname.endsWith(`.${IMAGE_HOST}`);
  return url.protocol === 'https:' && trustedHost && url.username === ''
    ? url.toString()
    : null;
}

function offName(
  product: JsonObject,
  brand: string | null,
  barcode: string,
): string {
  const name = cleanText(offText(product['product_name']), API_LIMITS.nameMax);
  return name || brand || `Product ${barcode}`;
}

export function mapOffProduct(
  product: JsonObject,
  barcode: string,
): OffProduct | null {
  const nutriments = isObject(product['nutriments'])
    ? product['nutriments']
    : {};
  const calories = offEnergyKcal(nutriments);
  if (calories === null) {
    return null;
  }
  const basisUnit = offBasisUnit(product);
  const brand = offBrand(product['brands']);
  return {
    name: offName(product, brand, barcode),
    brand,
    basisUnit,
    per100: offPer100(nutriments, calories, basisUnit),
    microsPer100: offMicrosPer100(nutriments),
    servingSizeG: offAmount(product['serving_quantity']),
    packSizeG: offAmount(product['product_quantity']),
    imageUrl: offImageUrl(product['image_front_small_url']),
    missingNutrients: offMissingNutrients(nutriments),
  };
}

export function mapOffResponse(
  body: unknown,
  barcode: string,
): OffProduct | null {
  if (!isObject(body) || body['status'] === 0) {
    return null;
  }
  const product = body['product'];
  return isObject(product) ? mapOffProduct(product, barcode) : null;
}
