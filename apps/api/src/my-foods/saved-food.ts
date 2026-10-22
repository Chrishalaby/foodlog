import type { SavedFoodRef } from '@food/shared';
import type { Prisma, Product } from '../generated/prisma/client.js';
import {
  productEntryName,
  productMicrosPer100,
  productPer100,
  toBasisUnit,
} from '../products/product-data.js';
import {
  containedExtraTokens,
  type FoodName,
  toFoodName,
} from './food-names.js';

export const SAVED_FOOD_SELECT = {
  id: true,
  name: true,
  brand: true,
  aliases: true,
  basisUnit: true,
  unitName: true,
  unitGrams: true,
  servingSizeG: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  satFat: true,
  fiber: true,
  sugar: true,
  sodium: true,
  alcohol: true,
  microsPer100: true,
} as const satisfies Prisma.ProductSelect;

export type SavedFoodRow = Pick<Product, keyof typeof SAVED_FOOD_SELECT>;

export interface SavedFood {
  ref: SavedFoodRef;
  itemName: string;
  aliases: string[];
  names: FoodName[];
}

interface ScoredFood {
  food: SavedFood;
  extra: number;
  order: number;
}

export function toSavedFoodRef(product: SavedFoodRow): SavedFoodRef {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    basisUnit: toBasisUnit(product.basisUnit),
    per100: productPer100(product),
    microsPer100: productMicrosPer100(product),
    unitName: product.unitName,
    unitGrams: product.unitGrams,
  };
}

export function savedFoodNames(product: SavedFoodRow): string[] {
  return [product.name, productEntryName(product), ...product.aliases];
}

export function toSavedFood(product: SavedFoodRow): SavedFood {
  return {
    ref: toSavedFoodRef(product),
    itemName: productEntryName(product),
    aliases: [...product.aliases],
    names: savedFoodNames(product)
      .map(toFoodName)
      .filter((name) => name.key !== ''),
  };
}

function matchesKey(food: SavedFood, key: string): boolean {
  return key !== '' && food.names.some((name) => name.key === key);
}

export function findSavedFoodByName(
  name: string | null | undefined,
  foods: readonly SavedFood[],
): SavedFood | null {
  const key = toFoodName(name ?? '').key;
  return foods.find((food) => matchesKey(food, key)) ?? null;
}

function fewestExtraTokens(food: SavedFood, item: FoodName): number | null {
  const extras = food.names.flatMap((name) => {
    const extra = containedExtraTokens(name, item);
    return extra === null ? [] : [extra.length];
  });
  return extras.length === 0 ? null : Math.min(...extras);
}

export function suggestSavedFood(
  name: string,
  foods: readonly SavedFood[],
): SavedFood | null {
  const item = toFoodName(name);
  if (item.key === '') {
    return null;
  }
  const scored = foods.flatMap((food, order): ScoredFood[] => {
    const extra = fewestExtraTokens(food, item);
    return extra === null ? [] : [{ food, extra, order }];
  });
  const [best] = scored.sort((a, b) => a.extra - b.extra || a.order - b.order);
  return best?.food ?? null;
}
