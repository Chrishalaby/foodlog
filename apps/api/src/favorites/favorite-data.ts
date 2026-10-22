import type { EntryItemInput, MealType, Portion } from '@food/shared';
import { favoriteItemsJson, normalizeItems } from '../common/items.js';
import { nutrientColumns } from '../common/mappers.js';
import { portionUpdateColumns } from '../common/portions.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface FavoriteContent {
  name: string;
  mealType: MealType | null;
  items: readonly EntryItemInput[];
  portion?: Portion | null;
}

export interface NewFavorite extends FavoriteContent {
  userId: string;
  photoId: string | null;
}

function contentFields(content: FavoriteContent) {
  const { items, totals } = normalizeItems(content.items);
  return {
    name: content.name,
    mealType: content.mealType,
    items: favoriteItemsJson(items),
    ...portionUpdateColumns(content.portion),
    ...nutrientColumns(totals),
  };
}

export function favoriteUpdateData(
  content: FavoriteContent,
): Prisma.FavoriteUncheckedUpdateInput {
  return contentFields(content);
}

export function favoriteCreateData(
  favorite: NewFavorite,
): Prisma.FavoriteUncheckedCreateInput {
  return {
    ...contentFields(favorite),
    userId: favorite.userId,
    photoId: favorite.photoId,
  };
}
