import {
  API_LIMITS,
  type Micros,
  NUTRIENT_KEYS,
  type NutrientKey,
  type Nutrients,
  type ProductDto,
  type ProductSource,
} from '@food/shared';
import { nutrientColumns, nutrientsFromRow } from '../common/mappers.js';
import { microsJson, per100Micros } from '../common/micros.js';
import { foldText } from '../foods/food-text.js';
import type { Prisma, Product } from '../generated/prisma/client.js';

export const BASIS_UNITS = [
  'g',
  'ml',
] as const satisfies readonly ProductDto['basisUnit'][];
export type BasisUnit = (typeof BASIS_UNITS)[number];

export const DEFAULT_SERVING_GRAMS = 100;

export const PRODUCT_ORDER: Prisma.ProductOrderByWithRelationInput[] = [
  { useCount: 'desc' },
  { lastUsedAt: { sort: 'desc', nulls: 'last' } },
  { name: 'asc' },
  { id: 'asc' },
];

export interface ProductFields {
  name: string;
  brand: string | null;
  basisUnit: BasisUnit;
  per100: Nutrients;
  microsPer100?: Micros | null;
  servingSizeG: number | null;
  packSizeG: number | null;
  source: ProductSource;
  missingNutrients: NutrientKey[];
}

export type ProductRow = Pick<
  Product,
  'name' | 'brand' | 'basisUnit' | 'servingSizeG'
> &
  Partial<Pick<Product, 'unitGrams' | 'microsPer100'>> &
  Record<keyof Nutrients, number>;

export type LinkedProductRow = ProductRow & Pick<Product, 'id'>;

const UNSTORABLE_CHARACTERS = /[\p{Cc}\p{Cs}]/gu;
const WHITESPACE = /\s+/gu;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function cleanText(value: string, maxCodePoints: number): string {
  const collapsed = value
    .replace(UNSTORABLE_CHARACTERS, ' ')
    .replace(WHITESPACE, ' ')
    .trim();
  return Array.from(collapsed).slice(0, maxCodePoints).join('').trimEnd();
}

export function toBasisUnit(value: string): BasisUnit {
  return value === 'ml' ? 'ml' : 'g';
}

function startsWithWord(text: string, word: string): boolean {
  return (
    word !== '' &&
    text.startsWith(word) &&
    !WORD_CHARACTER.test(text.charAt(word.length))
  );
}

export function productDisplayName(name: string, brand: string | null): string {
  const cleanName = cleanText(name, API_LIMITS.nameMax);
  const cleanBrand = cleanText(brand ?? '', API_LIMITS.nameMax);
  if (
    cleanBrand === '' ||
    startsWithWord(foldText(cleanName), foldText(cleanBrand))
  ) {
    return cleanName;
  }
  return cleanText(`${cleanBrand} ${cleanName}`, API_LIMITS.nameMax);
}

export function productEntryName(product: ProductRow): string {
  return productDisplayName(product.name, product.brand);
}

export function productPer100(product: ProductRow): Nutrients {
  return nutrientsFromRow(product);
}

export function productMicrosPer100(product: ProductRow): Micros | null {
  return per100Micros(product.microsPer100);
}

function positiveOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && value > 0 ? value : null;
}

export function productServingGrams(product: ProductRow): number {
  return (
    positiveOrNull(product.servingSizeG) ??
    positiveOrNull(product.unitGrams) ??
    DEFAULT_SERVING_GRAMS
  );
}

export function toNutrientKeys(values: readonly string[]): NutrientKey[] {
  return NUTRIENT_KEYS.filter((key) => values.includes(key));
}

export function correctedMissingNutrients(
  existing: (ProductRow & Pick<Product, 'missingNutrients'>) | null,
  source: ProductSource,
  per100: Nutrients,
): NutrientKey[] {
  if (existing === null || source !== 'openfoodfacts') {
    return [];
  }
  const stored = productPer100(existing);
  return toNutrientKeys(existing.missingNutrients).filter(
    (key) => per100[key] === stored[key],
  );
}

export function productColumns(fields: ProductFields) {
  return {
    name: fields.name,
    brand: fields.brand,
    basisUnit: fields.basisUnit,
    ...nutrientColumns(fields.per100),
    ...(fields.microsPer100 === undefined
      ? {}
      : { microsPer100: microsJson(fields.microsPer100) }),
    servingSizeG: fields.servingSizeG,
    packSizeG: fields.packSizeG,
    source: fields.source,
    missingNutrients: fields.missingNutrients,
  } satisfies Prisma.ProductUncheckedUpdateInput;
}

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    aliases: [...product.aliases],
    unitName: product.unitName,
    unitGrams: product.unitGrams,
    basisUnit: toBasisUnit(product.basisUnit),
    per100: productPer100(product),
    microsPer100: productMicrosPer100(product),
    servingSizeG: product.servingSizeG,
    packSizeG: product.packSizeG,
    source: product.source,
    imageUrl: product.imageUrl,
    missingNutrients: toNutrientKeys(product.missingNutrients),
    useCount: product.useCount,
    lastUsedAt: product.lastUsedAt?.toISOString() ?? null,
  };
}
