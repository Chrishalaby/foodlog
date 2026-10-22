import type { FoodRenameResponse } from '@food/shared';
import { nameWithSuffix } from '../favorites/favorite-servings.js';
import type { Prisma } from '../generated/prisma/client.js';
import { normalizeFoodName, splitServingsSuffix } from './food-text.js';

export interface RenameItem {
  id: string;
  name: string;
}

export interface RenameEntry {
  id: string;
  name: string;
  items: RenameItem[];
}

export interface RenameFavorite {
  id: string;
  name: string;
  items: Prisma.JsonValue;
}

export interface EntryRenameGroup {
  name: string;
  ids: string[];
}

export interface FavoriteRename {
  id: string;
  name: string;
  items: Prisma.JsonArray | null;
}

export interface FoodRenamePlan extends FoodRenameResponse {
  entryRenames: EntryRenameGroup[];
  itemIds: string[];
  itemName: string;
  matchedFavorites: number;
  favoriteRenames: FavoriteRename[];
}

export const RENAME_ITEMS_PROBE = 2;

export function matchesFoodName(name: string, target: string): boolean {
  return normalizeFoodName(name) === target;
}

export function renamedFoodName(name: string, base: string): string {
  const { suffix } = splitServingsSuffix(name);
  return suffix === '' ? base : nameWithSuffix(base, suffix);
}

function renamedItemIds(
  entry: RenameEntry,
  target: string,
  itemName: string,
): string[] {
  const [only, ...others] = entry.items;
  if (only === undefined || others.length > 0 || only.name === itemName) {
    return [];
  }
  return matchesFoodName(only.name, target) ? [only.id] : [];
}

function isJsonObject(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renamedFavoriteItems(
  items: Prisma.JsonValue,
  target: string,
  itemName: string,
): Prisma.JsonArray | null {
  if (!Array.isArray(items) || items.length !== 1) {
    return null;
  }
  const [only] = items;
  if (
    !isJsonObject(only) ||
    typeof only.name !== 'string' ||
    only.name === itemName ||
    !matchesFoodName(only.name, target)
  ) {
    return null;
  }
  return [{ ...only, name: itemName }];
}

function groupByName(
  changes: readonly { id: string; name: string }[],
): EntryRenameGroup[] {
  const groups = new Map<string, string[]>();
  for (const change of changes) {
    const ids = groups.get(change.name);
    if (ids) {
      ids.push(change.id);
    } else {
      groups.set(change.name, [change.id]);
    }
  }
  return [...groups].map(([name, ids]) => ({ name, ids }));
}

function planFavoriteRenames(
  favorites: readonly RenameFavorite[],
  target: string,
  base: string,
): { matched: number; renames: FavoriteRename[] } {
  const matched = favorites.filter((favorite) =>
    matchesFoodName(favorite.name, target),
  );
  const renames = matched.flatMap((favorite): FavoriteRename[] => {
    const name = renamedFoodName(favorite.name, base);
    const items = renamedFavoriteItems(favorite.items, target, base);
    return name === favorite.name && items === null
      ? []
      : [{ id: favorite.id, name, items }];
  });
  return { matched: matched.length, renames };
}

export function planFoodRename(
  entries: readonly RenameEntry[],
  favorites: readonly RenameFavorite[],
  from: string,
  to: string,
): FoodRenamePlan {
  const target = normalizeFoodName(from);
  const base = splitServingsSuffix(to).base;
  const matched = entries.filter((entry) =>
    matchesFoodName(entry.name, target),
  );
  const renamedEntries = matched.flatMap((entry) => {
    const name = renamedFoodName(entry.name, base);
    return name === entry.name ? [] : [{ id: entry.id, name }];
  });
  const itemIds = matched.flatMap((entry) =>
    renamedItemIds(entry, target, base),
  );
  const favoritePlan = planFavoriteRenames(favorites, target, base);
  return {
    matchedEntries: matched.length,
    renamedEntries: renamedEntries.length,
    renamedItems: itemIds.length,
    entryRenames: groupByName(renamedEntries),
    itemIds,
    itemName: base,
    matchedFavorites: favoritePlan.matched,
    favoriteRenames: favoritePlan.renames,
  };
}

export function renameSummary(plan: FoodRenamePlan): FoodRenameResponse {
  return {
    matchedEntries: plan.matchedEntries,
    renamedEntries: plan.renamedEntries,
    renamedItems: plan.renamedItems,
  };
}
