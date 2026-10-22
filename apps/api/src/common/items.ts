import {
  API_LIMITS,
  type Confidence,
  type EntryItemInput,
  isFiniteNumber,
  MAX_ITEM_GRAMS,
  type Micros,
  type Nutrients,
  roundNutrients,
  roundTo,
  sanitizeNutrients,
  sumNutrients,
} from '@food/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { nutrientColumns } from './mappers.js';
import { itemFluidMl, itemMicros, microsJson } from './micros.js';
import { type ItemCount, normalizeItemCount } from './portions.js';

const GRAMS_DECIMALS = 1;

export interface NormalizedItem extends ItemCount {
  position: number;
  name: string;
  grams: number;
  nutrients: Nutrients;
  confidence: Confidence | null;
  productId: string | null;
  micros: Micros | null;
  fluidMl: number | null;
}

export interface NormalizedItems {
  items: NormalizedItem[];
  totals: Nutrients;
}

function normalizeGrams(grams: unknown): number {
  if (!isFiniteNumber(grams) || grams <= 0) {
    return 0;
  }
  return roundTo(Math.min(grams, MAX_ITEM_GRAMS), GRAMS_DECIMALS);
}

function normalizeItem(item: EntryItemInput, position: number): NormalizedItem {
  return {
    position,
    name: item.name.trim().slice(0, API_LIMITS.nameMax),
    grams: normalizeGrams(item.grams),
    nutrients: roundNutrients(sanitizeNutrients(item.nutrients)),
    confidence: item.confidence ?? null,
    productId: item.productId ?? null,
    ...normalizeItemCount(item),
    micros: itemMicros(item.micros),
    fluidMl: itemFluidMl(item.fluidMl),
  };
}

export function normalizeItems(
  items: readonly EntryItemInput[],
): NormalizedItems {
  const normalized = items.map(normalizeItem);
  return {
    items: normalized,
    totals: roundNutrients(
      sumNutrients(normalized.map((item) => item.nutrients)),
    ),
  };
}

export function entryItemData(
  item: NormalizedItem,
): Prisma.EntryItemCreateManyEntryInput {
  return {
    position: item.position,
    name: item.name,
    grams: item.grams,
    count: item.count,
    unit: item.unit,
    unitPlural: item.unitPlural,
    confidence: item.confidence,
    productId: item.productId,
    micros: microsJson(item.micros),
    fluidMl: item.fluidMl,
    ...nutrientColumns(item.nutrients),
  };
}

export function favoriteItemsJson(
  items: readonly NormalizedItem[],
): Prisma.InputJsonValue {
  return items.map(
    ({
      name,
      grams,
      nutrients,
      confidence,
      count,
      unit,
      unitPlural,
      productId,
      micros,
      fluidMl,
    }) => ({
      name,
      grams,
      nutrients: { ...nutrients },
      confidence,
      count,
      unit,
      unitPlural,
      productId,
      micros: micros ? { ...micros } : null,
      fluidMl,
    }),
  );
}
