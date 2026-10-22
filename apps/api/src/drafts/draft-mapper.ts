import {
  ANALYSIS_MODES,
  type AnalysisMode,
  type DraftDto,
  type EntryItemInput,
} from '@food/shared';
import { toImageRole } from '../ai/analysis-plan.js';
import { parseFavoriteItems, toPhotoRef } from '../common/mappers.js';
import { portionFromColumns } from '../common/portions.js';
import type { Prisma } from '../generated/prisma/client.js';

export const DRAFT_INCLUDE = {
  photos: { orderBy: { position: 'asc' }, include: { photo: true } },
} as const satisfies Prisma.DraftInclude;

export const DRAFT_ORDER: Prisma.DraftOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { id: 'desc' },
];

export type DraftWithPhotos = Prisma.DraftGetPayload<{
  include: typeof DRAFT_INCLUDE;
}>;

export function toDraftMode(mode: string): AnalysisMode {
  return (ANALYSIS_MODES as readonly string[]).includes(mode)
    ? (mode as AnalysisMode)
    : 'food_photo';
}

export function parseDraftItems(
  value: Prisma.JsonValue | null,
): EntryItemInput[] | null {
  return value === null ? null : parseFavoriteItems(value);
}

export function toDraftDto(draft: DraftWithPhotos): DraftDto {
  const mode = toDraftMode(draft.mode);
  return {
    id: draft.id,
    mode,
    name: draft.name,
    description: draft.description,
    mealType: draft.mealType,
    timestamp: draft.timestamp.toISOString(),
    localDate: draft.localDate,
    items: parseDraftItems(draft.items),
    portion: portionFromColumns(draft),
    analysisId: draft.analysisId,
    photos: [...draft.photos]
      .sort((a, b) => a.position - b.position)
      .map(({ photo, role }) => ({
        photo: toPhotoRef(photo),
        role: toImageRole(role, mode),
      })),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}
