import {
  type EntryItemInput,
  type Micros,
  type Nutrients,
  roundNutrients,
  sumNutrients,
} from '@food/shared';
import { favoriteItemsJson, normalizeItems } from '../common/items.js';
import {
  nutrientColumns,
  nutrientsFromRow,
  parseFavoriteItems,
} from '../common/mappers.js';
import {
  itemMicros,
  microsForGrams,
  microsJson,
  sameMicros,
} from '../common/micros.js';
import { renamedFoodName } from '../foods/food-rename.js';
import { normalizeFoodName } from '../foods/food-text.js';
import type { Prisma, Product } from '../generated/prisma/client.js';
import {
  productEntryName,
  productMicrosPer100,
  productPer100,
} from '../products/product-data.js';
import { normalizeFoodKey } from './food-names.js';
import type { SavedFoodChanges } from './my-food-data.js';
import { savedFoodNames } from './saved-food.js';
import {
  matchesSavedValues,
  sameNutrients,
  savedItemNutrients,
} from './saved-food-values.js';

type Client = Prisma.TransactionClient;

const ITEM_SELECT = {
  id: true,
  entryId: true,
  name: true,
  grams: true,
  productId: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  satFat: true,
  fiber: true,
  sugar: true,
  sodium: true,
  alcohol: true,
  micros: true,
} as const satisfies Prisma.EntryItemSelect;

type ItemRow = Prisma.EntryItemGetPayload<{ select: typeof ITEM_SELECT }>;

export interface SavedFoodTarget {
  id: string;
  itemName: string;
  per100: Nutrients;
  microsPer100: Micros | null;
  keys: ReadonlySet<string>;
}

export interface ApplyOptions {
  matchNames: boolean;
}

export function savedFoodTarget(product: Product): SavedFoodTarget {
  return {
    id: product.id,
    itemName: productEntryName(product),
    per100: productPer100(product),
    microsPer100: productMicrosPer100(product),
    keys: new Set(
      savedFoodNames(product).map(normalizeFoodKey).filter(Boolean),
    ),
  };
}

export function savedItemMicros(
  target: Pick<SavedFoodTarget, 'microsPer100'>,
  grams: number,
  current: unknown,
): Micros | null {
  return target.microsPer100
    ? microsForGrams(target.microsPer100, grams)
    : itemMicros(current);
}

function hasOutdatedMicros(
  micros: unknown,
  grams: number,
  target: SavedFoodTarget,
): boolean {
  return (
    target.microsPer100 !== null &&
    !sameMicros(itemMicros(micros), savedItemMicros(target, grams, micros))
  );
}

function isOutdated(item: ItemRow, target: SavedFoodTarget): boolean {
  return (
    item.name !== target.itemName ||
    item.productId !== target.id ||
    !matchesSavedValues(
      { grams: item.grams, nutrients: nutrientsFromRow(item) },
      target.per100,
    ) ||
    hasOutdatedMicros(item.micros, item.grams, target)
  );
}

async function matchingItemNames(
  tx: Client,
  userId: string,
  target: SavedFoodTarget,
): Promise<string[]> {
  const names = await tx.entryItem.groupBy({
    by: ['name'],
    where: { entry: { userId } },
  });
  return names
    .map(({ name }) => name)
    .filter((name) => target.keys.has(normalizeFoodKey(name)));
}

async function targetItems(
  tx: Client,
  userId: string,
  target: SavedFoodTarget,
  options: ApplyOptions,
): Promise<ItemRow[]> {
  const names = options.matchNames
    ? await matchingItemNames(tx, userId, target)
    : [];
  return tx.entryItem.findMany({
    where: {
      entry: { userId },
      OR: [
        { productId: target.id },
        ...(names.length > 0 ? [{ name: { in: names } }] : []),
      ],
    },
    select: ITEM_SELECT,
  });
}

function byGrams(items: readonly ItemRow[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const item of items) {
    const ids = groups.get(item.grams);
    if (ids) {
      ids.push(item.id);
    } else {
      groups.set(item.grams, [item.id]);
    }
  }
  return groups;
}

async function updateItems(
  tx: Client,
  items: readonly ItemRow[],
  target: SavedFoodTarget,
): Promise<void> {
  for (const [grams, ids] of byGrams(items)) {
    await tx.entryItem.updateMany({
      where: { id: { in: ids } },
      data: {
        name: target.itemName,
        productId: target.id,
        ...nutrientColumns(savedItemNutrients(target.per100, grams)),
        ...(target.microsPer100
          ? { micros: microsJson(microsForGrams(target.microsPer100, grams)) }
          : {}),
      },
    });
  }
}

function renamedEntry(
  entry: { name: string; items: readonly unknown[] },
  oldItemName: string | undefined,
  itemName: string,
): string | null {
  if (
    entry.items.length !== 1 ||
    oldItemName === undefined ||
    normalizeFoodName(entry.name) !== normalizeFoodName(oldItemName)
  ) {
    return null;
  }
  const renamed = renamedFoodName(entry.name, itemName);
  return renamed === entry.name ? null : renamed;
}

async function recomputeEntries(
  tx: Client,
  userId: string,
  changed: readonly ItemRow[],
  target: SavedFoodTarget,
): Promise<number> {
  const oldNames = new Map(changed.map((item) => [item.entryId, item.name]));
  const entries = await tx.entry.findMany({
    where: { userId, id: { in: [...oldNames.keys()] } },
    select: { id: true, name: true, items: { select: ITEM_SELECT } },
  });
  for (const entry of entries) {
    const totals = roundNutrients(
      sumNutrients(entry.items.map((item) => nutrientsFromRow(item))),
    );
    const name = renamedEntry(entry, oldNames.get(entry.id), target.itemName);
    await tx.entry.update({
      where: { id: entry.id },
      data: { ...nutrientColumns(totals), ...(name ? { name } : {}) },
    });
  }
  return entries.length;
}

function appliedFavoriteItem(
  item: EntryItemInput,
  target: SavedFoodTarget,
  options: ApplyOptions,
): EntryItemInput {
  const matches =
    item.productId === target.id ||
    (options.matchNames && target.keys.has(normalizeFoodKey(item.name)));
  return matches
    ? {
        ...item,
        name: target.itemName,
        productId: target.id,
        nutrients: savedItemNutrients(target.per100, item.grams),
        micros: savedItemMicros(target, item.grams, item.micros),
      }
    : item;
}

function isSameFavoriteItem(a: EntryItemInput, b: EntryItemInput): boolean {
  return (
    a.name === b.name &&
    (a.productId ?? null) === (b.productId ?? null) &&
    sameNutrients(a.nutrients, b.nutrients) &&
    sameMicros(a.micros, b.micros)
  );
}

async function updateFavorites(
  tx: Client,
  userId: string,
  target: SavedFoodTarget,
  options: ApplyOptions,
): Promise<number> {
  const favorites = await tx.favorite.findMany({
    where: { userId },
    select: { id: true, items: true },
  });
  let updated = 0;
  for (const favorite of favorites) {
    const before = parseFavoriteItems(favorite.items);
    const after = before.map((item) =>
      appliedFavoriteItem(item, target, options),
    );
    if (
      after.every((item, index) =>
        isSameFavoriteItem(item, before[index] ?? item),
      )
    ) {
      continue;
    }
    const { items, totals } = normalizeItems(after);
    await tx.favorite.update({
      where: { id: favorite.id },
      data: { items: favoriteItemsJson(items), ...nutrientColumns(totals) },
    });
    updated += 1;
  }
  return updated;
}

async function refreshUsage(
  tx: Client,
  userId: string,
  product: Product,
): Promise<void> {
  const where = { userId, items: { some: { productId: product.id } } };
  const count = await tx.entry.count({ where });
  const latest = await tx.entry.aggregate({
    where,
    _max: { timestamp: true },
  });
  const lastUsed = latest._max.timestamp;
  const useCount = Math.max(product.useCount, count);
  const lastUsedAt =
    lastUsed && (!product.lastUsedAt || lastUsed > product.lastUsedAt)
      ? lastUsed
      : product.lastUsedAt;
  if (useCount !== product.useCount || lastUsedAt !== product.lastUsedAt) {
    await tx.product.update({
      where: { id: product.id },
      data: { useCount, lastUsedAt },
    });
  }
}

export async function applySavedFoodToPast(
  tx: Client,
  userId: string,
  product: Product,
  options: ApplyOptions,
): Promise<SavedFoodChanges> {
  const target = savedFoodTarget(product);
  const changed = (await targetItems(tx, userId, target, options)).filter(
    (item) => isOutdated(item, target),
  );
  await updateItems(tx, changed, target);
  const updatedEntries =
    changed.length > 0
      ? await recomputeEntries(tx, userId, changed, target)
      : 0;
  const updatedFavorites = await updateFavorites(tx, userId, target, options);
  await refreshUsage(tx, userId, product);
  return { updatedItems: changed.length, updatedEntries, updatedFavorites };
}

function withoutProductLink(
  value: Prisma.JsonValue,
  productId: string,
): Prisma.InputJsonValue | null {
  const items = parseFavoriteItems(value);
  if (!items.some((item) => item.productId === productId)) {
    return null;
  }
  return favoriteItemsJson(
    normalizeItems(
      items.map((item) =>
        item.productId === productId ? { ...item, productId: null } : item,
      ),
    ).items,
  );
}

export async function unlinkSavedFoodCopies(
  tx: Client,
  userId: string,
  productId: string,
): Promise<void> {
  const favorites = await tx.favorite.findMany({
    where: { userId },
    select: { id: true, items: true },
  });
  const drafts = await tx.draft.findMany({
    where: { userId },
    select: { id: true, items: true },
  });
  for (const favorite of favorites) {
    const items = withoutProductLink(favorite.items, productId);
    if (items !== null) {
      await tx.favorite.update({ where: { id: favorite.id }, data: { items } });
    }
  }
  for (const draft of drafts) {
    const items =
      draft.items === null ? null : withoutProductLink(draft.items, productId);
    if (items !== null) {
      await tx.draft.update({ where: { id: draft.id }, data: { items } });
    }
  }
}
