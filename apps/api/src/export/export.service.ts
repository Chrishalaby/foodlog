import type {
  DayMetaDto,
  EntryDto,
  ExportFormat,
  FavoriteDto,
  FluidLogDto,
  NoteDto,
  ProfileDto,
  WeightLogDto,
} from '@food/shared';
import { Injectable } from '@nestjs/common';
import {
  ENTRY_DTO_OMIT,
  ENTRY_INCLUDE,
  FAVORITE_INCLUDE,
  toEntryDto,
  toFavoriteDto,
} from '../common/mappers.js';
import {
  FLUID_LOG_ORDER,
  FLUID_LOG_SELECT,
  toFluidLogDto,
} from '../fluids/fluid-log.mapper.js';
import { NOTE_INCLUDE, toNoteDto } from '../notes/note-mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';
import {
  toWeightLogDto,
  WEIGHT_LOG_SELECT,
} from '../weights/weight-log.mapper.js';
import { buildEntriesCsv } from './export-csv.js';

export interface ExportDocument {
  exportedAt: string;
  profile: ProfileDto;
  entries: EntryDto[];
  favorites: FavoriteDto[];
  days: DayMetaDto[];
  weights: WeightLogDto[];
  fluids: FluidLogDto[];
  notes: NoteDto[];
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

export function exportFilename(format: ExportFormat, now: Date): string {
  return `foodlog-export-${now.toISOString().slice(0, 10)}.${format}`;
}

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
  ) {}

  async export(
    userId: string,
    format: ExportFormat,
    now: Date = new Date(),
  ): Promise<ExportFile> {
    const content =
      format === 'csv'
        ? buildEntriesCsv(await this.entries(userId))
        : `${JSON.stringify(await this.document(userId, now), null, 2)}\n`;
    return {
      filename: exportFilename(format, now),
      contentType: EXPORT_CONTENT_TYPES[format],
      body: Buffer.from(content, 'utf8'),
    };
  }

  async document(userId: string, now: Date): Promise<ExportDocument> {
    const [profile, entries, favorites, days, weights, fluids, notes] =
      await Promise.all([
        this.profiles.getProfile(userId),
        this.entries(userId),
        this.favorites(userId),
        this.days(userId),
        this.weights(userId),
        this.fluids(userId),
        this.notes(userId),
      ]);
    return {
      exportedAt: now.toISOString(),
      profile,
      entries,
      favorites,
      days,
      weights,
      fluids,
      notes,
    };
  }

  private async entries(userId: string): Promise<EntryDto[]> {
    const rows = await this.prisma.entry.findMany({
      where: { userId },
      include: ENTRY_INCLUDE,
      omit: ENTRY_DTO_OMIT,
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEntryDto);
  }

  private async favorites(userId: string): Promise<FavoriteDto[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      include: FAVORITE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toFavoriteDto);
  }

  private async days(userId: string): Promise<DayMetaDto[]> {
    const rows = await this.prisma.dayMeta.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { date: true, trainingDay: true },
    });
    return rows.map(({ date, trainingDay }) => ({ date, trainingDay }));
  }

  private async weights(userId: string): Promise<WeightLogDto[]> {
    const rows = await this.prisma.weightLog.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: WEIGHT_LOG_SELECT,
    });
    return rows.map(toWeightLogDto);
  }

  private async fluids(userId: string): Promise<FluidLogDto[]> {
    const rows = await this.prisma.fluidLog.findMany({
      where: { userId },
      orderBy: [...FLUID_LOG_ORDER],
      select: FLUID_LOG_SELECT,
    });
    return rows.map(toFluidLogDto);
  }

  private async notes(userId: string): Promise<NoteDto[]> {
    const rows = await this.prisma.note.findMany({
      where: { userId },
      include: NOTE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toNoteDto);
  }
}
