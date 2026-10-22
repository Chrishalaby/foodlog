import {
  type EntryItemInput,
  MAX_ITEM_GRAMS,
  nutrientsFromPer100g,
  roundNutrients,
  roundTo,
} from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import { itemFluidMl, microsForGrams } from '../common/micros.js';
import { isWithinItemLimits } from '../favorites/favorite-servings.js';
import {
  type LinkedProductRow,
  productEntryName,
  productMicrosPer100,
  productPer100,
  type ProductRow,
  productServingGrams,
  toBasisUnit,
} from './product-data.js';

export type ProductAmount =
  | { grams: number; servings?: undefined }
  | { servings: number; grams?: undefined };

export const DEFAULT_PRODUCT_SERVINGS = 1;

const GRAMS_DECIMALS = 1;
const MIN_LOGGED_GRAMS = 0.1;

export function productAmount(
  grams: number | null | undefined,
  servings: number | null | undefined,
): ProductAmount {
  if (grams !== undefined && grams !== null) {
    return { grams };
  }
  return { servings: servings ?? DEFAULT_PRODUCT_SERVINGS };
}

export function productLogGrams(
  product: ProductRow,
  amount: ProductAmount,
): number {
  const raw = amount.grams ?? amount.servings * productServingGrams(product);
  const grams = roundTo(raw, GRAMS_DECIMALS);
  if (!(grams >= MIN_LOGGED_GRAMS)) {
    throw new BadRequestException(
      `The amount is too small: log at least ${MIN_LOGGED_GRAMS} g`,
    );
  }
  if (grams > MAX_ITEM_GRAMS) {
    throw new BadRequestException(
      `The amount is too large: log at most ${MAX_ITEM_GRAMS} g`,
    );
  }
  return grams;
}

export function productFluidMl(
  product: Pick<ProductRow, 'basisUnit'>,
  grams: number,
): number | null {
  return toBasisUnit(product.basisUnit) === 'ml' ? itemFluidMl(grams) : null;
}

export function productItem(
  product: LinkedProductRow,
  grams: number,
): EntryItemInput {
  return {
    name: productEntryName(product),
    grams,
    nutrients: roundNutrients(
      nutrientsFromPer100g(productPer100(product), grams),
    ),
    confidence: 'high',
    productId: product.id,
    micros: microsForGrams(productMicrosPer100(product), grams),
    fluidMl: productFluidMl(product, grams),
  };
}

export function productServingItem(product: LinkedProductRow): EntryItemInput {
  return productItem(
    product,
    roundTo(productServingGrams(product), GRAMS_DECIMALS),
  );
}

export function productLogItem(
  product: LinkedProductRow,
  grams: number,
): EntryItemInput {
  const item = productItem(product, grams);
  if (!isWithinItemLimits(item)) {
    throw new BadRequestException(
      'The amount is too large: the logged item would exceed the nutrient limits',
    );
  }
  return item;
}
