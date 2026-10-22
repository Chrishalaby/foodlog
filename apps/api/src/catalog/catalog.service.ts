import {
  CATALOG_GROUPS,
  type CatalogFoodDto,
  type CatalogGroup,
  type CatalogInfoResponse,
  type CatalogSearchResponse,
  isCatalogGroup,
} from '@food/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CATALOG_DATASET_ID } from './catalog-loader.service.js';
import {
  CATALOG_PLAIN_WORDS,
  type CatalogQueryPlan,
  DEFAULT_CATALOG_LIMIT,
  planCatalogQuery,
} from './catalog-search.js';
import { type CatalogFoodRow, toCatalogFoodDto } from './catalog.mapper.js';

export const CATALOG_SOURCE_TEXT =
  'USDA FoodData Central: Foundation Foods, SR Legacy and FNDDS';
export const CATALOG_LICENSE_TEXT = 'Public domain (CC0 1.0)';

export interface CatalogSearchInput {
  q?: string;
  group?: CatalogGroup;
  limit?: number;
  offset?: number;
}

const SELECTED_COLUMNS = Prisma.sql`
  "id", "source", "name", "category", "group", "calories", "protein", "carbs", "fat",
  "satFat", "fiber", "sugar", "sodium", "alcohol", "missing", "microsPer100", "portions"`;

interface CountRow {
  count: number;
}

interface GroupRow {
  group: string;
  count: number;
}

type MatchMode = 'words' | 'fuzzy';

function matchClause(plan: CatalogQueryPlan, mode: MatchMode): Prisma.Sql {
  return mode === 'words'
    ? Prisma.sql`"searchName" LIKE ALL (${plan.containsPatterns}::text[])`
    : Prisma.sql`word_similarity(${plan.normalized}, "searchName") >= ${plan.fuzzyThreshold}`;
}

function groupClause(group: CatalogGroup | undefined): Prisma.Sql {
  return group ? Prisma.sql`AND "group" = ${group}` : Prisma.empty;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async info(): Promise<CatalogInfoResponse> {
    const [dataset, groups] = await Promise.all([
      this.prisma.catalogDataset.findUnique({ where: { id: CATALOG_DATASET_ID } }),
      this.prisma.$queryRaw<GroupRow[]>`
        SELECT "group", count(*)::int AS "count" FROM "CatalogFood" GROUP BY "group"`,
    ]);
    const counts = new Map(groups.map((row) => [row.group, row.count]));
    return {
      version: dataset?.version ?? null,
      foodCount: groups.reduce((sum, row) => sum + row.count, 0),
      loadedAt: dataset?.loadedAt.toISOString() ?? null,
      groups: CATALOG_GROUPS.filter((group) => (counts.get(group) ?? 0) > 0).map((group) => ({
        group,
        count: counts.get(group) ?? 0,
      })),
      source: CATALOG_SOURCE_TEXT,
      license: CATALOG_LICENSE_TEXT,
    };
  }

  async get(id: number): Promise<CatalogFoodDto> {
    const row = await this.prisma.catalogFood.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Food not found');
    }
    return toCatalogFoodDto(row);
  }

  async search(input: CatalogSearchInput): Promise<CatalogSearchResponse> {
    const limit = input.limit ?? DEFAULT_CATALOG_LIMIT;
    const offset = input.offset ?? 0;
    const group = isCatalogGroup(input.group) ? input.group : undefined;
    const plan = planCatalogQuery(input.q);
    const [rows, total] = plan
      ? await this.rankedWithTotal(plan, group, limit, offset)
      : await Promise.all([this.browse(group, limit, offset), this.countGroup(group)]);
    return {
      query: input.q?.trim() ?? '',
      group: group ?? null,
      total,
      results: rows.map(toCatalogFoodDto),
    };
  }

  private async rankedWithTotal(
    plan: CatalogQueryPlan,
    group: CatalogGroup | undefined,
    limit: number,
    offset: number,
  ): Promise<[CatalogFoodRow[], number]> {
    const wordTotal = await this.countMatches(plan, group, 'words');
    const mode: MatchMode = wordTotal > 0 ? 'words' : 'fuzzy';
    const total = mode === 'words' ? wordTotal : await this.countMatches(plan, group, mode);
    if (total === 0 || offset >= total) {
      return [[], total];
    }
    return [await this.ranked(plan, mode, group, limit, offset), total];
  }

  private ranked(
    plan: CatalogQueryPlan,
    mode: MatchMode,
    group: CatalogGroup | undefined,
    limit: number,
    offset: number,
  ): Promise<CatalogFoodRow[]> {
    return this.prisma.$queryRaw<CatalogFoodRow[]>`
      SELECT ${SELECTED_COLUMNS}
      FROM "CatalogFood"
      WHERE ${matchClause(plan, mode)} ${groupClause(group)}
      ORDER BY
        CASE WHEN "searchName" ~ ALL (${plan.wordPatterns}::text[]) THEN 0 ELSE 1 END,
        (
          SELECT count(*)
          FROM unnest(string_to_array("searchName", ' ')) AS word
          WHERE word <> ALL (${plan.tokens}::text[])
            AND word <> ALL (${[...CATALOG_PLAIN_WORDS]}::text[])
        ),
        CASE
          WHEN "searchName" = ${plan.normalized} THEN 0
          WHEN "searchName" LIKE ${plan.firstWordsPattern} THEN 1
          WHEN "searchName" LIKE ${plan.prefixPattern} THEN 2
          WHEN "searchName" ~ ALL (${plan.wordPatterns}::text[]) THEN 3
          WHEN "searchName" LIKE ALL (${plan.containsPatterns}::text[]) THEN 4
          ELSE 5
        END,
        word_similarity(${plan.normalized}, "searchName") DESC,
        CASE "source" WHEN 'survey' THEN 0 WHEN 'foundation' THEN 1 ELSE 2 END,
        length("name"),
        "id"
      LIMIT ${limit} OFFSET ${offset}`;
  }

  private async countMatches(
    plan: CatalogQueryPlan,
    group: CatalogGroup | undefined,
    mode: MatchMode,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<CountRow[]>`
      SELECT count(*)::int AS "count"
      FROM "CatalogFood"
      WHERE ${matchClause(plan, mode)} ${groupClause(group)}`;
    return row?.count ?? 0;
  }

  private browse(group: CatalogGroup | undefined, limit: number, offset: number): Promise<CatalogFoodRow[]> {
    return this.prisma.$queryRaw<CatalogFoodRow[]>`
      SELECT ${SELECTED_COLUMNS}
      FROM "CatalogFood"
      WHERE true ${groupClause(group)}
      ORDER BY "name", "id"
      LIMIT ${limit} OFFSET ${offset}`;
  }

  private async countGroup(group: CatalogGroup | undefined): Promise<number> {
    return this.prisma.catalogFood.count({ where: group ? { group } : undefined });
  }
}
