import {
  type EntryItemInput,
  type FoodSearchResult,
  type Nutrients,
  roundNutrients,
  roundTo,
  sumNutrients,
} from '@food/shared';
import {
  ENTRY_INCLUDE,
  type FavoriteWithPhoto,
  toFavoriteDto,
  toPhotoRef,
} from '../common/mappers.js';
import { itemPortion, portionFromColumns } from '../common/portions.js';
import { toEntryItemInput } from '../entries/entry-data.js';
import type { Prisma, Product } from '../generated/prisma/client.js';
import { productEntryName } from '../products/product-data.js';
import { productItem, productServingItem } from '../products/product-log.js';
import { foodKey } from './food-key.js';
import type { LibraryCandidate } from './food-library.js';
import { distinctDetail, singleItemDetail } from './food-text.js';

const LIBRARY_ENTRY_OMIT = {
  rawAiJson: true,
} as const satisfies Prisma.EntryOmit;

export const LIBRARY_MEAL_ARGS = {
  include: { items: ENTRY_INCLUDE.items, photo: true },
  omit: LIBRARY_ENTRY_OMIT,
} as const satisfies Prisma.EntryDefaultArgs;

export const FOOD_ITEM_INCLUDE = {
  entry: { include: { photo: true }, omit: LIBRARY_ENTRY_OMIT },
} as const satisfies Prisma.EntryItemInclude;

export type LibraryMeal = Prisma.EntryGetPayload<typeof LIBRARY_MEAL_ARGS>;

export type FoodItemWithEntry = Prisma.EntryItemGetPayload<{
  include: typeof FOOD_ITEM_INCLUDE;
}>;

export interface LibraryRows {
  favorites: ReadonlyMap<string, FavoriteWithPhoto>;
  products: ReadonlyMap<string, Product>;
  meals: ReadonlyMap<string, LibraryMeal>;
  foods: ReadonlyMap<string, FoodItemWithEntry>;
  productGrams?: ReadonlyMap<string, number>;
}

interface LibraryAmounts {
  items: EntryItemInput[];
  totals: Nutrients;
  grams: number;
}

const GRAMS_DECIMALS = 1;

export function libraryAmounts(
  items: readonly EntryItemInput[],
): LibraryAmounts {
  return {
    items: [...items],
    totals: roundNutrients(sumNutrients(items.map((item) => item.nutrients))),
    grams: roundTo(
      items.reduce((sum, item) => sum + item.grams, 0),
      GRAMS_DECIMALS,
    ),
  };
}

export function favoriteResult(row: FavoriteWithPhoto): FoodSearchResult {
  const favorite = toFavoriteDto(row);
  return {
    key: foodKey('favorite', favorite.id),
    kind: 'favorite',
    name: favorite.name,
    detail: singleItemDetail(favorite.name, favorite.items),
    ...libraryAmounts(favorite.items),
    portion: favorite.portion,
    mealType: favorite.mealType,
    photo: favorite.photo,
    favoriteId: favorite.id,
    entryId: null,
    useCount: favorite.useCount,
    lastUsedAt: favorite.lastUsedAt,
    productId: null,
    starred: true,
  };
}

function productDefaultItem(
  product: Product,
  linkedGrams: number | undefined,
): EntryItemInput {
  return linkedGrams !== undefined && linkedGrams > 0
    ? productItem(product, roundTo(linkedGrams, GRAMS_DECIMALS))
    : productServingItem(product);
}

export function productResult(
  product: Product,
  linkedGrams?: number,
): FoodSearchResult {
  return {
    key: foodKey('product', product.id),
    kind: 'product',
    name: productEntryName(product),
    detail: product.brand || null,
    ...libraryAmounts([productDefaultItem(product, linkedGrams)]),
    portion: null,
    mealType: null,
    photo: null,
    favoriteId: null,
    entryId: null,
    productId: product.id,
    barcode: product.barcode,
    useCount: product.useCount,
    lastUsedAt: product.lastUsedAt?.toISOString() ?? null,
    starred: false,
  };
}

export function mealResult(
  entry: LibraryMeal,
  usage: LibraryCandidate,
): FoodSearchResult {
  const items = [...entry.items]
    .sort((a, b) => a.position - b.position)
    .map(toEntryItemInput);
  return {
    key: foodKey('meal', entry.id),
    kind: 'meal',
    name: entry.name,
    detail: singleItemDetail(entry.name, entry.items),
    ...libraryAmounts(items),
    portion: portionFromColumns(entry),
    mealType: entry.mealType,
    photo: toPhotoRef(entry.photo),
    favoriteId: null,
    entryId: entry.id,
    useCount: usage.useCount,
    lastUsedAt: usage.lastUsedAt?.toISOString() ?? null,
    productId: null,
    starred: false,
  };
}

export function foodResult(
  item: FoodItemWithEntry,
  usage: LibraryCandidate,
): FoodSearchResult {
  return {
    key: foodKey('food', item.id),
    kind: 'food',
    name: item.name,
    detail: distinctDetail(item.name, item.entry.name),
    ...libraryAmounts([toEntryItemInput(item)]),
    portion: itemPortion(item),
    mealType: item.entry.mealType,
    photo: toPhotoRef(item.entry.photo),
    favoriteId: null,
    entryId: item.entry.id,
    useCount: usage.useCount,
    lastUsedAt: usage.lastUsedAt?.toISOString() ?? null,
    productId: null,
    starred: false,
  };
}

export function toSearchResult(
  candidate: LibraryCandidate,
  rows: LibraryRows,
): FoodSearchResult | null {
  switch (candidate.kind) {
    case 'favorite': {
      const favorite = rows.favorites.get(candidate.id);
      return favorite ? favoriteResult(favorite) : null;
    }
    case 'meal': {
      const entry = rows.meals.get(candidate.id);
      return entry ? mealResult(entry, candidate) : null;
    }
    case 'food': {
      const item = rows.foods.get(candidate.id);
      return item ? foodResult(item, candidate) : null;
    }
    case 'product': {
      const product = rows.products.get(candidate.id);
      return product
        ? productResult(product, rows.productGrams?.get(candidate.id))
        : null;
    }
  }
}
