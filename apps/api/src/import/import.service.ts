import type { ImportBatchResponse } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { entryItemData, normalizeItems } from '../common/items.js';
import { nutrientColumns } from '../common/mappers.js';
import { portionUpdateColumns } from '../common/portions.js';
import { uuidV7 } from '../common/uuid-v7.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ImportBatchDto,
  ImportEntryDto,
  ImportFluidDto,
  ImportWeightDto,
} from './import.dto.js';

const IMPORT_TIMEOUT_MS = 60_000;

type Tx = Prisma.TransactionClient;

export function entryImportKey(
  localDate: string,
  timestamp: Date,
  name: string,
  calories: number,
): string {
  return [
    localDate,
    timestamp.getTime(),
    name.trim().toLowerCase(),
    Math.round(calories),
  ].join('|');
}

function fluidKey(localDate: string, timestamp: Date, ml: number): string {
  return `${localDate}|${timestamp.getTime()}|${Math.round(ml)}`;
}

function dateRange(
  dates: readonly string[],
): { from: string; to: string } | null {
  if (dates.length === 0) {
    return null;
  }
  const sorted = [...dates].sort();
  return { from: sorted[0] ?? '', to: sorted[sorted.length - 1] ?? '' };
}

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  async importBatch(
    userId: string,
    batch: ImportBatchDto,
  ): Promise<ImportBatchResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const entries = await this.importEntries(
          tx,
          userId,
          batch.entries ?? [],
        );
        const weights = await this.importWeights(
          tx,
          userId,
          batch.weights ?? [],
        );
        const fluids = await this.importFluids(tx, userId, batch.fluids ?? []);
        const trainingDaysSet = await this.importTrainingDays(
          tx,
          userId,
          batch.trainingDays ?? [],
        );
        return {
          entriesCreated: entries.created,
          entriesSkipped: entries.skipped,
          weightsCreated: weights.created,
          weightsSkipped: weights.skipped,
          fluidsCreated: fluids.created,
          fluidsSkipped: fluids.skipped,
          trainingDaysSet,
        };
      },
      { timeout: IMPORT_TIMEOUT_MS },
    );
  }

  private async importEntries(
    tx: Tx,
    userId: string,
    entries: readonly ImportEntryDto[],
  ): Promise<{ created: number; skipped: number }> {
    const range = dateRange(entries.map((entry) => entry.localDate));
    if (!range) {
      return { created: 0, skipped: 0 };
    }
    const existing = await tx.entry.findMany({
      where: { userId, localDate: { gte: range.from, lte: range.to } },
      select: { localDate: true, timestamp: true, name: true, calories: true },
    });
    const seen = new Set(
      existing.map((row) =>
        entryImportKey(row.localDate, row.timestamp, row.name, row.calories),
      ),
    );
    const rows: Prisma.EntryCreateManyInput[] = [];
    const items: Prisma.EntryItemCreateManyInput[] = [];
    for (const entry of entries) {
      const timestamp = new Date(entry.timestamp);
      const normalized = normalizeItems(entry.items);
      const key = entryImportKey(
        entry.localDate,
        timestamp,
        entry.name,
        normalized.totals.calories,
      );
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const id = uuidV7(timestamp.getTime());
      rows.push({
        id,
        userId,
        name: entry.name,
        description: entry.description?.trim() || null,
        mealType: entry.mealType,
        source: 'import',
        timestamp,
        localDate: entry.localDate,
        ...portionUpdateColumns(entry.portion ?? null),
        ...nutrientColumns(normalized.totals),
      });
      for (const item of normalized.items) {
        items.push({
          ...entryItemData(item),
          id: uuidV7(timestamp.getTime()),
          entryId: id,
        });
      }
    }
    if (rows.length > 0) {
      await tx.entry.createMany({ data: rows });
      await tx.entryItem.createMany({ data: items });
    }
    return { created: rows.length, skipped: entries.length - rows.length };
  }

  private async importWeights(
    tx: Tx,
    userId: string,
    weights: readonly ImportWeightDto[],
  ): Promise<{ created: number; skipped: number }> {
    if (weights.length === 0) {
      return { created: 0, skipped: 0 };
    }
    const dates = [...new Set(weights.map((weight) => weight.date))];
    const existing = await tx.weightLog.findMany({
      where: { userId, date: { in: dates } },
      select: { date: true },
    });
    const taken = new Set(existing.map((row) => row.date));
    const fresh = new Map<string, ImportWeightDto>();
    for (const weight of weights) {
      if (!taken.has(weight.date) && !fresh.has(weight.date)) {
        fresh.set(weight.date, weight);
      }
    }
    if (fresh.size > 0) {
      await tx.weightLog.createMany({
        data: [...fresh.values()].map((weight) => ({
          userId,
          date: weight.date,
          weightKg: weight.weightKg,
          bodyFatPct: weight.bodyFatPct ?? null,
        })),
      });
      await this.syncProfileWeight(tx, userId);
    }
    return { created: fresh.size, skipped: weights.length - fresh.size };
  }

  private async syncProfileWeight(tx: Tx, userId: string): Promise<void> {
    const latest = await tx.weightLog.findFirst({
      where: { userId },
      orderBy: { date: 'desc' },
      select: { weightKg: true, bodyFatPct: true },
    });
    if (!latest) {
      return;
    }
    await tx.profile.upsert({
      where: { userId },
      create: {
        userId,
        weightKg: latest.weightKg,
        ...(latest.bodyFatPct !== null
          ? { bodyFatPct: latest.bodyFatPct }
          : {}),
      },
      update: {
        weightKg: latest.weightKg,
        ...(latest.bodyFatPct !== null
          ? { bodyFatPct: latest.bodyFatPct }
          : {}),
      },
    });
  }

  private async importFluids(
    tx: Tx,
    userId: string,
    fluids: readonly ImportFluidDto[],
  ): Promise<{ created: number; skipped: number }> {
    const range = dateRange(fluids.map((fluid) => fluid.localDate));
    if (!range) {
      return { created: 0, skipped: 0 };
    }
    const existing = await tx.fluidLog.findMany({
      where: { userId, localDate: { gte: range.from, lte: range.to } },
      select: { localDate: true, timestamp: true, ml: true },
    });
    const seen = new Set(
      existing.map((row) => fluidKey(row.localDate, row.timestamp, row.ml)),
    );
    const rows: Prisma.FluidLogCreateManyInput[] = [];
    for (const fluid of fluids) {
      const timestamp = new Date(fluid.timestamp);
      const key = fluidKey(fluid.localDate, timestamp, fluid.ml);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        id: uuidV7(timestamp.getTime()),
        userId,
        localDate: fluid.localDate,
        timestamp,
        ml: fluid.ml,
        kind: fluid.kind,
      });
    }
    if (rows.length > 0) {
      await tx.fluidLog.createMany({ data: rows });
    }
    return { created: rows.length, skipped: fluids.length - rows.length };
  }

  private async importTrainingDays(
    tx: Tx,
    userId: string,
    dates: readonly string[],
  ): Promise<number> {
    const unique = [...new Set(dates)];
    if (unique.length === 0) {
      return 0;
    }
    const result = await tx.dayMeta.createMany({
      data: unique.map((date) => ({ userId, date, trainingDay: true })),
      skipDuplicates: true,
    });
    return result.count;
  }
}
