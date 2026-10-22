import {
  type AnalysisPhotoRef,
  CONFIDENCE_LEVELS,
  type Confidence,
  type EntryDto,
  type EntryItemDto,
  type EntryItemInput,
  type FavoriteDto,
  isFiniteNumber,
  NUTRIENT_KEYS,
  type NutrientKey,
  type Nutrients,
  type PhotoRef,
  sanitizeNutrients,
  zeroNutrients,
} from '@food/shared';
import {
  byPosition,
  sourcePhotoRole,
  storedPhotoRole,
} from '../entries/entry-photos.js';
import type { Photo, Prisma } from '../generated/prisma/client.js';
import { itemFluidMl, itemMicros } from './micros.js';
import {
  itemCount,
  normalizeItemCount,
  portionFromColumns,
  toPortion,
} from './portions.js';

export const ENTRY_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  photo: true,
  photos: { orderBy: { position: 'asc' }, include: { photo: true } },
} as const satisfies Prisma.EntryInclude;

export const ENTRY_DTO_OMIT = {
  rawAiJson: true,
} as const satisfies Prisma.EntryOmit;

export const FAVORITE_INCLUDE = {
  photo: true,
} as const satisfies Prisma.FavoriteInclude;

export type EntryWithRelations = Prisma.EntryGetPayload<{
  include: typeof ENTRY_INCLUDE;
}>;

export type FavoriteWithPhoto = Prisma.FavoriteGetPayload<{
  include: typeof FAVORITE_INCLUDE;
}>;

export type NutrientColumns = Record<NutrientKey, number>;

type PhotoRow = Pick<Photo, 'id' | 'width' | 'height'>;

export function nutrientsFromRow(row: NutrientColumns): Nutrients {
  const nutrients = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    nutrients[key] = row[key];
  }
  return nutrients;
}

export function nutrientColumns(nutrients: Nutrients): NutrientColumns {
  return nutrientsFromRow(nutrients);
}

export function toPhotoRef(photo: PhotoRow): PhotoRef;
export function toPhotoRef(photo: PhotoRow | null | undefined): PhotoRef | null;
export function toPhotoRef(
  photo: PhotoRow | null | undefined,
): PhotoRef | null {
  if (!photo) {
    return null;
  }
  return {
    id: photo.id,
    url: `/api/photos/${photo.id}`,
    thumbUrl: `/api/photos/${photo.id}/thumb`,
    width: photo.width,
    height: photo.height,
  };
}

function toEntryItemDto(
  item: EntryWithRelations['items'][number],
): EntryItemDto {
  return {
    id: item.id,
    position: item.position,
    name: item.name,
    grams: item.grams,
    nutrients: nutrientsFromRow(item),
    confidence: item.confidence ?? null,
    ...normalizeItemCount(item),
    productId: item.productId ?? null,
    micros: itemMicros(item.micros),
    fluidMl: itemFluidMl(item.fluidMl),
  };
}

function toEntryPhotoRefs(
  entry: Pick<EntryWithRelations, 'photo' | 'photos' | 'source'>,
): AnalysisPhotoRef[] {
  const photos = byPosition(entry.photos).map(({ photo, role }) => ({
    photo: toPhotoRef(photo),
    role: storedPhotoRole(role, entry.source),
  }));
  const cover = entry.photo;
  if (!cover || photos.some(({ photo }) => photo.id === cover.id)) {
    return photos;
  }
  return [
    ...photos,
    { photo: toPhotoRef(cover), role: sourcePhotoRole(entry.source) },
  ];
}

export function toEntryDto(
  entry: Omit<EntryWithRelations, 'rawAiJson'>,
): EntryDto {
  const items = [...entry.items]
    .sort((a, b) => a.position - b.position)
    .map(toEntryItemDto);
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    mealType: entry.mealType,
    source: entry.source,
    timestamp: entry.timestamp.toISOString(),
    localDate: entry.localDate,
    items,
    totals: nutrientsFromRow(entry),
    portion: portionFromColumns(entry),
    photo: toPhotoRef(entry.photo),
    photos: toEntryPhotoRefs(entry),
    analysisId: entry.analysisId,
    favoriteId: entry.favoriteId,
    productId: entry.productId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConfidence(value: unknown): value is Confidence {
  return (CONFIDENCE_LEVELS as readonly unknown[]).includes(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toProductLink(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function parseFavoriteItem(value: unknown): EntryItemInput | null {
  if (!isJsonObject(value) || typeof value.name !== 'string') {
    return null;
  }
  const { grams, nutrients, confidence } = value;
  return {
    name: value.name,
    grams: isFiniteNumber(grams) && grams > 0 ? grams : 0,
    nutrients: sanitizeNutrients(isJsonObject(nutrients) ? nutrients : null),
    confidence: isConfidence(confidence) ? confidence : null,
    ...itemCount(toPortion(value.count, value.unit, value.unitPlural)),
    productId: toProductLink(value.productId),
    micros: itemMicros(value.micros),
    fluidMl: itemFluidMl(value.fluidMl),
  };
}

export function parseFavoriteItems(value: Prisma.JsonValue): EntryItemInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((raw) => {
    const item = parseFavoriteItem(raw);
    return item ? [item] : [];
  });
}

export function toFavoriteDto(favorite: FavoriteWithPhoto): FavoriteDto {
  return {
    id: favorite.id,
    name: favorite.name,
    mealType: favorite.mealType,
    items: parseFavoriteItems(favorite.items),
    totals: nutrientsFromRow(favorite),
    portion: portionFromColumns(favorite),
    photo: toPhotoRef(favorite.photo),
    useCount: favorite.useCount,
    lastUsedAt: favorite.lastUsedAt?.toISOString() ?? null,
    createdAt: favorite.createdAt.toISOString(),
    updatedAt: favorite.updatedAt.toISOString(),
  };
}
