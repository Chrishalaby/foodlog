import type {
  AnalysisMode,
  EntryItemInput,
  EntrySource,
  ImageRole,
} from '@food/shared';
import { favoriteItemsJson, normalizeItems } from '../common/items.js';
import { portionUpdateColumns } from '../common/portions.js';
import { blankToNull } from '../entries/entry-data.js';
import { Prisma } from '../generated/prisma/client.js';
import type { UpdateDraftDto } from './drafts.dto.js';

export interface DraftPhotoRef {
  photoId: string;
  role: ImageRole;
}

export interface DraftPhotoRow extends DraftPhotoRef {
  position: number;
}

export function draftItemsJson(
  items: readonly EntryItemInput[] | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (!items) {
    return Prisma.DbNull;
  }
  return favoriteItemsJson(normalizeItems(items).items);
}

export function draftPhotoRows(
  photos: readonly DraftPhotoRef[],
): DraftPhotoRow[] {
  return photos.map(({ photoId, role }, position) => ({
    photoId,
    role,
    position,
  }));
}

export function draftUpdateData(
  dto: UpdateDraftDto,
  items: readonly EntryItemInput[] | null | undefined = dto.items,
): Prisma.DraftUncheckedUpdateInput {
  const data: Prisma.DraftUncheckedUpdateInput = {
    ...portionUpdateColumns(dto.portion),
  };
  if (dto.name !== undefined) {
    data.name = blankToNull(dto.name);
  }
  if (dto.description !== undefined) {
    data.description = blankToNull(dto.description);
  }
  if (dto.mealType !== undefined) {
    data.mealType = dto.mealType;
  }
  if (dto.timestamp !== undefined) {
    data.timestamp = new Date(dto.timestamp);
  }
  if (dto.localDate !== undefined) {
    data.localDate = dto.localDate;
  }
  if (items !== undefined) {
    data.items = draftItemsJson(items);
  }
  if (dto.analysisId !== undefined) {
    data.analysisId = dto.analysisId;
  }
  return data;
}

export function draftEntrySource(
  draftMode: AnalysisMode,
  analysisMode: AnalysisMode | null,
): EntrySource {
  return analysisMode ?? draftMode;
}

export function draftEntryPhotos(
  draftPhotos: readonly DraftPhotoRef[],
  analysisPhotos: readonly DraftPhotoRef[],
): DraftPhotoRef[] {
  return [...(draftPhotos.length > 0 ? draftPhotos : analysisPhotos)];
}

export function releasedPhotoIds(
  before: readonly string[],
  kept: readonly (string | null)[],
): string[] {
  const keep = new Set(kept);
  return [...new Set(before)].filter((photoId) => !keep.has(photoId));
}
