import type {
  EntryDto,
  EntryListResponse,
  EntryRawAiResponse,
} from '@food/shared';
import { Injectable } from '@nestjs/common';
import {
  ENTRY_INCLUDE,
  type EntryWithRelations,
  toEntryDto,
} from '../common/mappers.js';
import { portionFromColumns } from '../common/portions.js';
import { withOwnedProductLinks } from '../common/product-links.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PhotosService } from '../photos/photos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateEntryDto,
  DuplicateEntryDto,
  EntryListQueryDto,
  UpdateEntryDto,
} from './entries.dto.js';
import { createLinkedEntry } from './entry-create.js';
import {
  blankToNull,
  entryReplaceData,
  toEntryItemInput,
} from './entry-data.js';
import { entryNotFound } from './entry-errors.js';
import { resolveEntryOrigin } from './entry-origin.js';
import {
  coverUpdateData,
  type EntryCover,
  entryPhotoIds,
  storedEntryPhotos,
} from './entry-photos.js';
import {
  DEFAULT_HISTORY_PAGE_SIZE,
  type DateRange,
  entryCursorFilter,
  entryListOrder,
  entryRangeFilter,
  entrySearchFilter,
  parseEntryCursor,
  resolveDateRange,
  toHistoryPage,
} from './entry-query.js';

type EntryClient = Pick<Prisma.TransactionClient, 'entry'>;

interface EntryRef extends EntryCover {
  id: string;
}

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  async list(
    userId: string,
    query: EntryListQueryDto,
  ): Promise<EntryListResponse> {
    const range = resolveDateRange(query.from, query.to);
    if (range) {
      return this.listRange(userId, range, query.q);
    }
    return this.listHistory(userId, query);
  }

  async get(userId: string, id: string): Promise<EntryDto> {
    return toEntryDto(await this.requireEntry(this.prisma, userId, id));
  }

  async rawAi(userId: string, id: string): Promise<EntryRawAiResponse> {
    const entry = await this.prisma.entry.findFirst({
      where: { id, userId },
      select: { id: true, analysisId: true, rawAiJson: true },
    });
    if (!entry) {
      throw entryNotFound();
    }
    return {
      entryId: entry.id,
      analysisId: entry.analysisId,
      rawAiJson: entry.rawAiJson,
    };
  }

  async create(userId: string, dto: CreateEntryDto): Promise<EntryDto> {
    const origin = await resolveEntryOrigin(
      this.prisma,
      this.photos,
      userId,
      dto,
      dto.source,
    );
    const entry = await this.prisma.$transaction((tx) =>
      createLinkedEntry(tx, {
        userId,
        name: dto.name,
        description: blankToNull(dto.description),
        mealType: dto.mealType,
        source: dto.source,
        timestamp: new Date(dto.timestamp),
        localDate: dto.localDate,
        items: dto.items,
        portion: dto.portion ?? null,
        ...origin,
        favoriteId: null,
      }),
    );
    return toEntryDto(entry);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateEntryDto,
  ): Promise<EntryDto> {
    const entry = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireEntryRef(tx, userId, id);
      const cover = dto.coverPhotoId
        ? coverUpdateData(existing, dto.coverPhotoId)
        : {};
      const data = entryReplaceData({
        name: dto.name,
        description: blankToNull(dto.description),
        mealType: dto.mealType,
        timestamp: new Date(dto.timestamp),
        localDate: dto.localDate,
        items: await withOwnedProductLinks(tx, userId, dto.items),
        portion: dto.portion,
      });
      await tx.entryItem.deleteMany({ where: { entryId: id } });
      return tx.entry.update({
        where: { id },
        data: { ...data, ...cover },
        include: ENTRY_INCLUDE,
      });
    });
    return toEntryDto(entry);
  }

  async remove(userId: string, id: string): Promise<void> {
    const entry = await this.requireEntryRef(this.prisma, userId, id);
    await this.prisma.entry.delete({ where: { id: entry.id } });
    await this.photos.releaseAll(entryPhotoIds(entry));
  }

  async duplicate(
    userId: string,
    id: string,
    dto: DuplicateEntryDto,
  ): Promise<EntryDto> {
    const original = await this.requireEntry(this.prisma, userId, id);
    const entry = await this.prisma.$transaction((tx) =>
      createLinkedEntry(tx, {
        userId,
        name: original.name,
        description: original.description,
        mealType: dto.mealType ?? original.mealType,
        source: 'copy',
        timestamp: new Date(dto.timestamp),
        localDate: dto.localDate,
        items: original.items.map(toEntryItemInput),
        portion: portionFromColumns(original),
        ...storedEntryPhotos(original),
        analysisId: null,
        favoriteId: original.favoriteId,
        rawAiJson: original.rawAiJson,
      }),
    );
    return toEntryDto(entry);
  }

  private async listRange(
    userId: string,
    range: DateRange,
    q: string | undefined,
  ): Promise<EntryListResponse> {
    const rows = await this.prisma.entry.findMany({
      where: {
        userId,
        AND: [entryRangeFilter(range), entrySearchFilter(q)],
      },
      orderBy: entryListOrder(),
      include: ENTRY_INCLUDE,
    });
    return { items: rows.map(toEntryDto), nextCursor: null };
  }

  private async listHistory(
    userId: string,
    query: EntryListQueryDto,
  ): Promise<EntryListResponse> {
    const cursor = parseEntryCursor(query.before);
    const limit = query.limit ?? DEFAULT_HISTORY_PAGE_SIZE;
    const rows = await this.prisma.entry.findMany({
      where: {
        userId,
        AND: [entrySearchFilter(query.q), entryCursorFilter(cursor)],
      },
      orderBy: entryListOrder(),
      include: ENTRY_INCLUDE,
      take: limit + 1,
    });
    const page = toHistoryPage(rows, limit);
    return { items: page.rows.map(toEntryDto), nextCursor: page.nextCursor };
  }

  private async requireEntry(
    client: EntryClient,
    userId: string,
    id: string,
  ): Promise<EntryWithRelations> {
    const entry = await client.entry.findFirst({
      where: { id, userId },
      include: ENTRY_INCLUDE,
    });
    if (!entry) {
      throw entryNotFound();
    }
    return entry;
  }

  private async requireEntryRef(
    client: EntryClient,
    userId: string,
    id: string,
  ): Promise<EntryRef> {
    const entry = await client.entry.findFirst({
      where: { id, userId },
      select: {
        id: true,
        source: true,
        photoId: true,
        photos: { select: { photoId: true, position: true } },
      },
    });
    if (!entry) {
      throw entryNotFound();
    }
    return entry;
  }
}
