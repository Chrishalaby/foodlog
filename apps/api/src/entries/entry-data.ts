import type {
  EntryItemInput,
  EntrySource,
  MealType,
  Portion,
} from '@food/shared';
import { entryItemData, normalizeItems } from '../common/items.js';
import {
  type NutrientColumns,
  nutrientColumns,
  nutrientsFromRow,
} from '../common/mappers.js';
import { itemFluidMl, itemMicros } from '../common/micros.js';
import {
  normalizeItemCount,
  portionUpdateColumns,
} from '../common/portions.js';
import { type EntryItem, Prisma } from '../generated/prisma/client.js';
import { type EntryPhotoRef, entryPhotoRows } from './entry-photos.js';

export interface EntryContent {
  name: string;
  description: string | null;
  mealType: MealType;
  timestamp: Date;
  localDate: string;
  items: readonly EntryItemInput[];
  portion?: Portion | null;
}

export interface NewEntry extends EntryContent {
  userId: string;
  source: EntrySource;
  photoId: string | null;
  photos: readonly EntryPhotoRef[];
  analysisId: string | null;
  favoriteId: string | null;
  rawAiJson: Prisma.JsonValue | null;
}

type EntryItemRow = Pick<
  EntryItem,
  | 'name'
  | 'grams'
  | 'confidence'
  | 'count'
  | 'unit'
  | 'unitPlural'
  | 'productId'
  | 'micros'
  | 'fluidMl'
> &
  NutrientColumns;

export function toNullableJson(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export function toEntryItemInput(row: EntryItemRow): EntryItemInput {
  return {
    name: row.name,
    grams: row.grams,
    nutrients: nutrientsFromRow(row),
    confidence: row.confidence ?? null,
    ...normalizeItemCount(row),
    productId: row.productId,
    micros: itemMicros(row.micros),
    fluidMl: itemFluidMl(row.fluidMl),
  };
}

function contentData(content: EntryContent) {
  const { items, totals } = normalizeItems(content.items);
  return {
    fields: {
      name: content.name,
      description: content.description,
      mealType: content.mealType,
      timestamp: content.timestamp,
      localDate: content.localDate,
      ...portionUpdateColumns(content.portion),
      ...nutrientColumns(totals),
    },
    itemRows: items.map(entryItemData),
  };
}

export function entryCreateData(
  entry: NewEntry,
): Prisma.EntryUncheckedCreateInput {
  const { fields, itemRows } = contentData(entry);
  const photoRows = entryPhotoRows(entry.photos);
  return {
    ...fields,
    userId: entry.userId,
    source: entry.source,
    photoId: entry.photoId,
    analysisId: entry.analysisId,
    favoriteId: entry.favoriteId,
    rawAiJson: toNullableJson(entry.rawAiJson),
    items: { createMany: { data: itemRows } },
    ...(photoRows.length > 0
      ? { photos: { createMany: { data: photoRows } } }
      : {}),
  };
}

export function entryReplaceData(
  content: EntryContent,
): Prisma.EntryUncheckedUpdateInput {
  const { fields, itemRows } = contentData(content);
  return { ...fields, items: { createMany: { data: itemRows } } };
}

export function blankToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}
