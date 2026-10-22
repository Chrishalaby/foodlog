import type { EntrySource } from '@food/shared';
import { NotFoundException } from '@nestjs/common';
import { carriedPhotos } from '../ai/analysis-plan.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PhotosService } from '../photos/photos.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  type EntryPhotoRef,
  type EntryPhotos,
  entryPhotos,
  sourcePhotoRole,
  withPhoto,
} from './entry-photos.js';

export interface EntryOriginRequest {
  analysisId?: string | null;
  photoId?: string | null;
  coverPhotoId?: string | null;
}

export interface EntryOrigin extends EntryPhotos {
  analysisId: string | null;
  rawAiJson: Prisma.JsonValue | null;
}

interface OwnedAnalysis {
  id: string;
  photos: EntryPhotoRef[];
  rawResponse: Prisma.JsonValue | null;
}

type AnalysisReader = Pick<PrismaService, 'analysis'>;
type PhotoOwnership = Pick<PhotosService, 'findOwned'>;

function analysisSelect(userId: string) {
  return {
    id: true,
    mode: true,
    photoId: true,
    rawResponse: true,
    photos: {
      where: { photo: { userId } },
      orderBy: { position: 'asc' },
      select: { photoId: true, role: true },
    },
  } as const satisfies Prisma.AnalysisSelect;
}

async function requireAnalysis(
  prisma: AnalysisReader,
  userId: string,
  id: string,
): Promise<OwnedAnalysis> {
  const analysis = await prisma.analysis.findFirst({
    where: { id, userId },
    select: analysisSelect(userId),
  });
  if (!analysis) {
    throw new NotFoundException('Analysis not found');
  }
  const mode =
    analysis.mode === 'menu' ||
    analysis.mode === 'voice' ||
    analysis.mode === 'ideas'
      ? 'food_photo'
      : analysis.mode;
  return {
    id: analysis.id,
    photos: carriedPhotos(mode, analysis.photos, analysis.photoId),
    rawResponse: analysis.rawResponse,
  };
}

export async function resolveEntryOrigin(
  prisma: AnalysisReader,
  photos: PhotoOwnership,
  userId: string,
  request: EntryOriginRequest,
  source: EntrySource,
): Promise<EntryOrigin> {
  const analysis = request.analysisId
    ? await requireAnalysis(prisma, userId, request.analysisId)
    : null;
  const chosenPhotoId = request.photoId
    ? (await photos.findOwned(userId, request.photoId)).id
    : null;
  const chosen = chosenPhotoId
    ? { photoId: chosenPhotoId, role: sourcePhotoRole(source) }
    : null;
  return {
    analysisId: analysis?.id ?? null,
    rawAiJson: analysis?.rawResponse ?? null,
    ...entryPhotos(
      withPhoto(analysis?.photos ?? [], chosen),
      request.coverPhotoId ?? chosenPhotoId,
    ),
  };
}
