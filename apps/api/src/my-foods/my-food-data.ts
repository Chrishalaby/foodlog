import {
  API_LIMITS,
  isFiniteNumber,
  type MyFoodChangeResponse,
  type MyFoodDto,
} from '@food/shared';
import { microsJson, per100Micros } from '../common/micros.js';
import { foldText } from '../foods/food-text.js';
import type { Prisma, Product } from '../generated/prisma/client.js';
import {
  cleanText,
  productDisplayName,
  productEntryName,
  productMicrosPer100,
  productPer100,
  productServingGrams,
  toBasisUnit,
  toProductDto,
} from '../products/product-data.js';
import { normalizeFoodKey } from './food-names.js';
import type { SavedFoodInfo } from './merge-suggestions.js';
import { MY_FOOD_ALIASES_MAX } from './my-foods.dto.js';
import {
  SAVED_FOOD_SELECT,
  savedFoodNames,
  type SavedFoodRow,
} from './saved-food.js';

export const SAVED_FOOD_INFO_SELECT = {
  ...SAVED_FOOD_SELECT,
  lastUsedAt: true,
  createdAt: true,
} as const satisfies Prisma.ProductSelect;

export type SavedFoodInfoRow = SavedFoodRow &
  Pick<Product, 'lastUsedAt' | 'createdAt'>;

export const MY_FOOD_INCLUDE = {
  _count: { select: { items: true } },
} as const satisfies Prisma.ProductInclude;

export type MyFoodRow = Prisma.ProductGetPayload<{
  include: typeof MY_FOOD_INCLUDE;
}>;

export interface SavedFoodChanges {
  updatedItems: number;
  updatedEntries: number;
  updatedFavorites: number;
}

export const NO_SAVED_FOOD_CHANGES: SavedFoodChanges = {
  updatedItems: 0,
  updatedEntries: 0,
  updatedFavorites: 0,
};

export function toMyFoodDto(product: MyFoodRow): MyFoodDto {
  return { ...toProductDto(product), itemCount: product._count.items };
}

export function toChangeResponse(
  product: MyFoodRow,
  changes: SavedFoodChanges,
): MyFoodChangeResponse {
  return { food: toMyFoodDto(product), ...changes };
}

export function cleanAliases(
  aliases: readonly string[],
  name: string,
  brand: string | null,
): string[] {
  const seen = new Set(
    [name, productDisplayName(name, brand)].map(normalizeFoodKey),
  );
  const cleaned: string[] = [];
  for (const alias of aliases) {
    const text = cleanText(alias, API_LIMITS.nameMax);
    const key = normalizeFoodKey(text);
    if (key === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(text);
    if (cleaned.length >= MY_FOOD_ALIASES_MAX) {
      break;
    }
  }
  return cleaned;
}

export function microsPer100Update(
  value: unknown,
): Pick<Prisma.ProductUncheckedUpdateInput, 'microsPer100'> {
  return value === undefined
    ? {}
    : { microsPer100: microsJson(per100Micros(value)) };
}

export function unitGramsOrNull(
  value: number | null | undefined,
): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
}

export function toSavedFoodInfo(product: SavedFoodInfoRow): SavedFoodInfo {
  return {
    id: product.id,
    displayName: productEntryName(product),
    names: savedFoodNames(product),
    basisUnit: toBasisUnit(product.basisUnit),
    per100: productPer100(product),
    microsPer100: productMicrosPer100(product),
    servingGrams: productServingGrams(product),
    lastUsedAt: product.lastUsedAt ?? product.createdAt,
  };
}

export function matchesMyFoodQuery(
  product: Product,
  q: string | undefined,
): boolean {
  const tokens = foldText(q ?? '')
    .split(' ')
    .filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const text = foldText(
    [product.name, product.brand ?? '', ...product.aliases].join(' '),
  );
  return tokens.every((token) => text.includes(token));
}
