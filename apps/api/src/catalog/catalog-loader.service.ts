import { normalizeCatalogText } from '@food/shared';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type CatalogFile, readCatalogFile } from './catalog-file.js';

export const CATALOG_DATASET_ID = 'usda';
const CATALOG_LOCK_KEY = 7_120_331;
const INSERT_CHUNK = 1000;
const LOAD_TIMEOUT_MS = 180_000;

export type CatalogLoadStatus = 'loaded' | 'current';

export interface CatalogLoadResult {
  status: CatalogLoadStatus;
  version: string;
  foodCount: number;
}

function toRow(food: CatalogFile['foods'][number]): Prisma.CatalogFoodCreateManyInput {
  return {
    id: food.id,
    source: food.source,
    name: food.name,
    searchName: normalizeCatalogText(food.name),
    category: food.category,
    group: food.group,
    ...food.per100,
    missing: food.missing,
    microsPer100: (food.microsPer100 ?? undefined) as Prisma.InputJsonValue | undefined,
    portions: food.portions as unknown as Prisma.InputJsonValue,
  };
}

@Injectable()
export class CatalogLoaderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogLoaderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.catalog.autoload) {
      return;
    }
    try {
      const result = await this.loadFromFile(this.config.catalog.file);
      if (result.status === 'loaded') {
        this.logger.log(
          `Food database loaded: ${result.foodCount.toLocaleString('en-US')} foods (${result.version})`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Food database not loaded: ${message}`);
    }
  }

  async loadFromFile(path: string): Promise<CatalogLoadResult> {
    return this.load(await readCatalogFile(path));
  }

  async load(file: CatalogFile): Promise<CatalogLoadResult> {
    const foodCount = file.foods.length;
    if (await this.isCurrent(this.prisma, file.version, foodCount)) {
      return { status: 'current', version: file.version, foodCount };
    }
    const status = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATALOG_LOCK_KEY}::bigint)`;
        if (await this.isCurrent(tx, file.version, foodCount)) {
          return 'current' as const;
        }
        await tx.catalogFood.deleteMany();
        for (let start = 0; start < foodCount; start += INSERT_CHUNK) {
          await tx.catalogFood.createMany({
            data: file.foods.slice(start, start + INSERT_CHUNK).map(toRow),
          });
        }
        await tx.catalogDataset.upsert({
          where: { id: CATALOG_DATASET_ID },
          create: { id: CATALOG_DATASET_ID, version: file.version, foodCount },
          update: { version: file.version, foodCount, loadedAt: new Date() },
        });
        return 'loaded' as const;
      },
      { timeout: LOAD_TIMEOUT_MS, maxWait: LOAD_TIMEOUT_MS },
    );
    return { status, version: file.version, foodCount };
  }

  private async isCurrent(
    client: Pick<PrismaService, 'catalogDataset' | 'catalogFood'>,
    version: string,
    foodCount: number,
  ): Promise<boolean> {
    const dataset = await client.catalogDataset.findUnique({
      where: { id: CATALOG_DATASET_ID },
    });
    if (dataset?.version !== version || dataset.foodCount !== foodCount) {
      return false;
    }
    return (await client.catalogFood.count()) === foodCount;
  }
}
