import { Injectable } from '@nestjs/common';
import {
  FAVORITE_INCLUDE,
  type FavoriteWithPhoto,
  parseFavoriteItems,
} from '../common/mappers.js';
import type { Product } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { productEntryName } from '../products/product-data.js';
import type { LibraryCandidate } from './food-library.js';
import { distinctDetail, singleItemDetail } from './food-text.js';
import {
  FOOD_ITEM_INCLUDE,
  type FoodItemWithEntry,
  LIBRARY_MEAL_ARGS,
  type LibraryMeal,
} from './food-results.js';

interface UsageRow {
  latestId: string;
  name: string;
  detail: string | null;
  useCount: number;
  recentCount: number;
  lastUsedAt: Date;
  productId?: string | null;
}

interface ItemGramsRow {
  id: string;
  grams: number;
}

interface ProductIdRow {
  productId: string;
}

function toCandidate(
  kind: 'meal' | 'food',
): (row: UsageRow) => LibraryCandidate {
  return (row) => ({
    kind,
    id: row.latestId,
    name: row.name,
    detail: distinctDetail(row.name, row.detail),
    useCount: Number(row.useCount),
    recentCount: Number(row.recentCount),
    lastUsedAt: new Date(row.lastUsedAt),
    ...(kind === 'food' ? { linkedProductId: row.productId ?? null } : {}),
  });
}

export function favoriteCandidate(
  favorite: FavoriteWithPhoto,
): LibraryCandidate {
  return {
    kind: 'favorite',
    id: favorite.id,
    name: favorite.name,
    detail: singleItemDetail(favorite.name, parseFavoriteItems(favorite.items)),
    useCount: favorite.useCount,
    recentCount: 0,
    lastUsedAt: favorite.lastUsedAt,
  };
}

export function productCandidate(
  since: Date,
): (product: Product) => LibraryCandidate {
  return (product) => ({
    kind: 'product',
    id: product.id,
    name: productEntryName(product),
    detail: product.brand,
    aliases: product.aliases,
    useCount: product.useCount,
    recentCount:
      product.lastUsedAt !== null && product.lastUsedAt >= since
        ? product.useCount
        : 0,
    lastUsedAt: product.lastUsedAt,
  });
}

@Injectable()
export class FoodLibraryRepository {
  constructor(private readonly prisma: PrismaService) {}

  favorites(userId: string): Promise<FavoriteWithPhoto[]> {
    return this.prisma.favorite.findMany({
      where: { userId },
      include: FAVORITE_INCLUDE,
    });
  }

  products(userId: string): Promise<Product[]> {
    return this.prisma.product.findMany({ where: { userId } });
  }

  async mealUsage(userId: string, since: Date): Promise<LibraryCandidate[]> {
    const rows = await this.prisma.$queryRaw<UsageRow[]>`
      SELECT
        (array_agg(e."id"::text ORDER BY e."timestamp" DESC, e."id" DESC))[1] AS "latestId",
        (array_agg(e."name" ORDER BY e."timestamp" DESC, e."id" DESC))[1] AS "name",
        (array_agg(single."name" ORDER BY e."timestamp" DESC, e."id" DESC))[1] AS "detail",
        count(*)::int AS "useCount",
        (count(*) FILTER (WHERE e."timestamp" >= ${since}))::int AS "recentCount",
        max(e."timestamp") AS "lastUsedAt"
      FROM "Entry" e
      LEFT JOIN LATERAL (
        SELECT min(i."name") AS "name"
        FROM "EntryItem" i
        WHERE i."entryId" = e."id"
        HAVING count(*) = 1
      ) single ON true
      WHERE e."userId" = ${userId}::uuid
      GROUP BY lower(btrim(e."name")) COLLATE "C"`;
    return rows.map(toCandidate('meal'));
  }

  async foodUsage(userId: string, since: Date): Promise<LibraryCandidate[]> {
    const rows = await this.prisma.$queryRaw<UsageRow[]>`
      SELECT
        (array_agg(i."id"::text ORDER BY e."timestamp" DESC, e."id" DESC, i."position" ASC))[1] AS "latestId",
        (array_agg(i."name" ORDER BY e."timestamp" DESC, e."id" DESC, i."position" ASC))[1] AS "name",
        (array_agg(e."name" ORDER BY e."timestamp" DESC, e."id" DESC, i."position" ASC))[1] AS "detail",
        count(DISTINCT e."id")::int AS "useCount",
        (count(DISTINCT e."id") FILTER (WHERE e."timestamp" >= ${since}))::int AS "recentCount",
        max(e."timestamp") AS "lastUsedAt",
        CASE
          WHEN bool_and(i."productId" IS NOT NULL)
            AND count(DISTINCT i."productId") = 1
          THEN min(i."productId"::text)
        END AS "productId"
      FROM "EntryItem" i
      JOIN "Entry" e ON e."id" = i."entryId"
      WHERE e."userId" = ${userId}::uuid
        AND EXISTS (
          SELECT 1
          FROM "EntryItem" sibling
          WHERE sibling."entryId" = i."entryId" AND sibling."id" <> i."id"
        )
      GROUP BY lower(btrim(i."name")) COLLATE "C"`;
    return rows.map(toCandidate('food'));
  }

  async componentProductIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<ProductIdRow[]>`
      SELECT i."productId"::text AS "productId"
      FROM "EntryItem" i
      JOIN "Entry" e ON e."id" = i."entryId"
      WHERE e."userId" = ${userId}::uuid
        AND i."productId" IS NOT NULL
      GROUP BY i."productId"
      HAVING bool_and(EXISTS (
        SELECT 1
        FROM "EntryItem" sibling
        WHERE sibling."entryId" = i."entryId" AND sibling."id" <> i."id"
      ))`;
    return new Set(rows.map((row) => row.productId));
  }

  async hiddenNames(userId: string): Promise<string[]> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { hiddenFoods: true },
    });
    return profile?.hiddenFoods ?? [];
  }

  async meals(userId: string, ids: string[]): Promise<LibraryMeal[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.entry.findMany({
      ...LIBRARY_MEAL_ARGS,
      where: { userId, id: { in: ids } },
    });
  }

  async itemGrams(userId: string, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows: ItemGramsRow[] = await this.prisma.entryItem.findMany({
      where: { id: { in: ids }, entry: { userId } },
      select: { id: true, grams: true },
    });
    return new Map(rows.map(({ id, grams }) => [id, grams]));
  }

  async foods(userId: string, ids: string[]): Promise<FoodItemWithEntry[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.entryItem.findMany({
      where: { id: { in: ids }, entry: { userId } },
      include: FOOD_ITEM_INCLUDE,
    });
  }
}
