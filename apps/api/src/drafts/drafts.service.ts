import {
  type AnalysisMode,
  API_LIMITS,
  type DraftDto,
  type EntryDto,
} from '@food/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { carriedPhotos, toImageRole, uploadRole } from '../ai/analysis-plan.js';
import type { AnalyzeUpload } from '../ai/analyze-uploads.js';
import { toEntryDto } from '../common/mappers.js';
import { portionColumns, portionFromColumns } from '../common/portions.js';
import { withOwnedProductLinks } from '../common/product-links.js';
import { createLinkedEntry } from '../entries/entry-create.js';
import { blankToNull } from '../entries/entry-data.js';
import { entryPhotoIds, entryPhotos } from '../entries/entry-photos.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PhotosService } from '../photos/photos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type DraftPhotoRef,
  draftEntryPhotos,
  draftEntrySource,
  draftItemsJson,
  draftPhotoRows,
  draftUpdateData,
  releasedPhotoIds,
} from './draft-data.js';
import {
  DRAFT_INCLUDE,
  DRAFT_ORDER,
  toDraftDto,
  toDraftMode,
} from './draft-mapper.js';
import type {
  CreateDraftDto,
  LogDraftDto,
  UpdateDraftDto,
} from './drafts.dto.js';

export const EMPTY_DRAFT_MESSAGE =
  'Add a photo, a name or a description to save a draft';
export const DRAFTS_FULL_MESSAGE = `You already have ${API_LIMITS.draftsMax} drafts — log or delete some to save a new one`;

type DraftClient = Pick<Prisma.TransactionClient, 'draft'>;
type AnalysisClient = Pick<Prisma.TransactionClient, 'analysis'>;

interface DraftAnalysis {
  id: string;
  mode: AnalysisMode;
  photos: DraftPhotoRef[];
}

function draftNotFound(): NotFoundException {
  return new NotFoundException('Draft not found');
}

function analysisNotFound(): NotFoundException {
  return new NotFoundException('Analysis not found');
}

function analysisSelect(userId: string) {
  return {
    id: true,
    mode: true,
    photoId: true,
    photos: {
      where: { photo: { userId } },
      orderBy: { position: 'asc' },
      select: { photoId: true, role: true },
    },
  } as const satisfies Prisma.AnalysisSelect;
}

@Injectable()
export class DraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  async list(userId: string): Promise<DraftDto[]> {
    const drafts = await this.prisma.draft.findMany({
      where: { userId },
      orderBy: DRAFT_ORDER,
      include: DRAFT_INCLUDE,
    });
    return drafts.map(toDraftDto);
  }

  async create(
    userId: string,
    dto: CreateDraftDto,
    uploads: readonly AnalyzeUpload[],
  ): Promise<DraftDto> {
    await this.assertRoomForDraft(this.prisma, userId);
    const analysis = dto.analysisId
      ? await this.requireAnalysis(this.prisma, userId, dto.analysisId)
      : null;
    const name = blankToNull(dto.name);
    const description = blankToNull(dto.description);
    if (
      uploads.length === 0 &&
      !analysis &&
      !name &&
      !description &&
      !dto.items
    ) {
      throw new BadRequestException(EMPTY_DRAFT_MESSAGE);
    }
    const items = dto.items
      ? await withOwnedProductLinks(this.prisma, userId, dto.items)
      : dto.items;
    const roles = uploads.map((upload, index) =>
      uploadRole(upload, dto.mode, index === 0),
    );
    const stored = await this.photos.createManyFromUploads(
      userId,
      uploads.map(({ buffer }, index) => ({ buffer, role: roles[index] })),
    );
    const photos: DraftPhotoRef[] =
      stored.length > 0
        ? stored.map(({ id }, index) => ({ photoId: id, role: roles[index] }))
        : (analysis?.photos ?? []);
    try {
      const draft = await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        await this.assertRoomForDraft(tx, userId);
        return tx.draft.create({
          data: {
            userId,
            mode: dto.mode,
            name,
            description,
            mealType: dto.mealType ?? null,
            timestamp: new Date(dto.timestamp),
            localDate: dto.localDate,
            ...portionColumns(dto.portion),
            items: draftItemsJson(items),
            analysisId: analysis?.id ?? null,
            photos: { create: draftPhotoRows(photos) },
          },
          include: DRAFT_INCLUDE,
        });
      });
      return toDraftDto(draft);
    } catch (error) {
      await this.photos.releaseAll(stored.map(({ id }) => id));
      throw error;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateDraftDto,
  ): Promise<DraftDto> {
    const { draft, released } = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireDraftPhotos(tx, userId, id);
      const analysis = dto.analysisId
        ? await this.requireAnalysis(tx, userId, dto.analysisId)
        : null;
      const replacement = draftPhotoRows(analysis?.photos ?? []);
      const replacesPhotos = replacement.length > 0;
      const items = dto.items
        ? await withOwnedProductLinks(tx, userId, dto.items)
        : dto.items;
      const updated = await tx.draft.update({
        where: { id: existing.id },
        data: {
          ...draftUpdateData(dto, items),
          ...(analysis ? { mode: analysis.mode } : {}),
          ...(replacesPhotos
            ? { photos: { deleteMany: {}, create: replacement } }
            : {}),
        },
        include: DRAFT_INCLUDE,
      });
      const kept = replacement.map(({ photoId }) => photoId);
      return {
        draft: updated,
        released: replacesPhotos
          ? releasedPhotoIds(existing.photoIds, kept)
          : [],
      };
    });
    await this.photos.releaseAll(released);
    return toDraftDto(draft);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.requireDraftPhotos(this.prisma, userId, id);
    const { count } = await this.prisma.draft.deleteMany({
      where: { id: existing.id, userId },
    });
    if (count === 0) {
      throw draftNotFound();
    }
    await this.photos.releaseAll(existing.photoIds);
  }

  async log(userId: string, id: string, dto: LogDraftDto): Promise<EntryDto> {
    const { entry, photoIds } = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.draft.findFirst({
        where: { id, userId },
        select: {
          id: true,
          mode: true,
          portionCount: true,
          portionUnit: true,
          portionUnitPlural: true,
          photos: {
            orderBy: { position: 'asc' },
            select: { photoId: true, role: true },
          },
          analysis: {
            select: {
              ...analysisSelect(userId),
              userId: true,
              rawResponse: true,
            },
          },
        },
      });
      if (!draft) {
        throw draftNotFound();
      }
      const mode = toDraftMode(draft.mode);
      const analysis =
        draft.analysis?.userId === userId && draft.analysis.mode !== 'menu'
          ? draft.analysis
          : null;
      const analysisMode = analysis ? toDraftMode(analysis.mode) : null;
      const photos = draft.photos.map(({ photoId, role }) => ({
        photoId,
        role: toImageRole(role, mode),
      }));
      const analysisPhotos =
        analysis && analysisMode
          ? carriedPhotos(analysisMode, analysis.photos, analysis.photoId)
          : [];
      const created = await createLinkedEntry(tx, {
        userId,
        name: dto.name,
        description: blankToNull(dto.description),
        mealType: dto.mealType,
        source: draftEntrySource(mode, analysisMode),
        timestamp: new Date(dto.timestamp),
        localDate: dto.localDate,
        items: dto.items,
        portion:
          dto.portion === undefined ? portionFromColumns(draft) : dto.portion,
        ...entryPhotos(draftEntryPhotos(photos, analysisPhotos)),
        analysisId: analysis?.id ?? null,
        favoriteId: null,
        rawAiJson: analysis?.rawResponse ?? null,
      });
      const { count } = await tx.draft.deleteMany({
        where: { id: draft.id, userId },
      });
      if (count === 0) {
        throw draftNotFound();
      }
      return {
        entry: created,
        photoIds: photos.map(({ photoId }) => photoId),
      };
    });
    await this.photos.releaseAll(
      releasedPhotoIds(photoIds, entryPhotoIds(entry)),
    );
    return toEntryDto(entry);
  }

  private async requireAnalysis(
    client: AnalysisClient,
    userId: string,
    id: string,
  ): Promise<DraftAnalysis> {
    const analysis = await client.analysis.findFirst({
      where: { id, userId, mode: { not: 'menu' } },
      select: analysisSelect(userId),
    });
    if (!analysis) {
      throw analysisNotFound();
    }
    const mode = toDraftMode(analysis.mode);
    return {
      id: analysis.id,
      mode,
      photos: carriedPhotos(mode, analysis.photos, analysis.photoId),
    };
  }

  private async requireDraftPhotos(
    client: DraftClient,
    userId: string,
    id: string,
  ): Promise<{ id: string; photoIds: string[] }> {
    const draft = await client.draft.findFirst({
      where: { id, userId },
      select: { id: true, photos: { select: { photoId: true } } },
    });
    if (!draft) {
      throw draftNotFound();
    }
    return {
      id: draft.id,
      photoIds: draft.photos.map(({ photoId }) => photoId),
    };
  }

  private async assertRoomForDraft(
    client: DraftClient,
    userId: string,
  ): Promise<void> {
    const count = await client.draft.count({ where: { userId } });
    if (count >= API_LIMITS.draftsMax) {
      throw new ConflictException(DRAFTS_FULL_MESSAGE);
    }
  }

  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
  }
}
