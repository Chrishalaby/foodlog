import {
  type FoodMergeSuggestionsResponse,
  type MyFoodChangeResponse,
  type Nutrients,
  sanitizeNutrients,
} from '@food/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { nutrientColumns, nutrientsFromRow } from '../common/mappers.js';
import { itemMicros, microsJson, per100Micros } from '../common/micros.js';
import { blankToNull } from '../entries/entry-data.js';
import type { Prisma, Product } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  correctedMissingNutrients,
  PRODUCT_ORDER,
} from '../products/product-data.js';
import { normalizeFoodKey } from './food-names.js';
import {
  type FoodMergeDecision,
  mergeDecisionsJson,
  newMergeDecision,
  parseMergeDecisions,
  withMergeDecision,
  withoutKeptApart,
} from './merge-decisions.js';
import {
  buildMergeSuggestions,
  type LoggedFoodItem,
  suggestionWindowStart,
} from './merge-suggestions.js';
import {
  cleanAliases,
  microsPer100Update,
  NO_SAVED_FOOD_CHANGES,
  SAVED_FOOD_INFO_SELECT,
  toChangeResponse,
  toSavedFoodInfo,
} from './my-food-data.js';
import type { MergeFoodsDto } from './my-foods.dto.js';
import {
  loadMyFood,
  requireOwnedProduct,
  SAVED_FOOD_TRANSACTION,
} from './my-foods.service.js';
import { savedFoodNames } from './saved-food.js';
import { applySavedFoodToPast } from './saved-food-apply.js';

export const DISMISSED_FOOD_MERGES_MAX = 500;

const LABEL_SOURCES: ReadonlySet<string> = new Set([
  'nutrition_label',
  'barcode',
]);

const SUGGESTION_ITEM_SELECT = {
  id: true,
  entryId: true,
  position: true,
  name: true,
  grams: true,
  productId: true,
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  satFat: true,
  fiber: true,
  sugar: true,
  sodium: true,
  alcohol: true,
  micros: true,
  entry: { select: { timestamp: true, createdAt: true, source: true } },
} as const satisfies Prisma.EntryItemSelect;

type SuggestionItemRow = Prisma.EntryItemGetPayload<{
  select: typeof SUGGESTION_ITEM_SELECT;
}>;

interface DismissedRow {
  dismissedFoodMerges: string[];
}

interface MergeDecisionsRow {
  foodMergeDecisions: unknown;
}

function toLoggedFoodItem(row: SuggestionItemRow): LoggedFoodItem {
  return {
    id: row.id,
    entryId: row.entryId,
    name: row.name,
    grams: row.grams,
    nutrients: nutrientsFromRow(row),
    micros: itemMicros(row.micros),
    productId: row.productId,
    loggedAt: row.entry.timestamp,
    createdAt: row.entry.createdAt,
    fromLabel: LABEL_SOURCES.has(row.entry.source) && row.position === 0,
  };
}

export function dismissedKey(key: string): string {
  const normalized = normalizeFoodKey(key);
  if (normalized === '') {
    throw new BadRequestException('key must contain letters or digits');
  }
  return normalized;
}

export function withDismissedKey(
  keys: readonly string[],
  key: string,
): string[] {
  return keys.includes(key)
    ? [...keys]
    : [...keys, key].slice(-DISMISSED_FOOD_MERGES_MAX);
}

function mergedFields(
  dto: MergeFoodsDto,
  brand: string | null,
  per100: Nutrients,
) {
  return {
    name: dto.name,
    brand,
    basisUnit: dto.basisUnit,
    ...nutrientColumns(per100),
  };
}

@Injectable()
export class FoodMergesService {
  constructor(private readonly prisma: PrismaService) {}

  async suggestions(
    userId: string,
    now: Date = new Date(),
  ): Promise<FoodMergeSuggestionsResponse> {
    const [rows, products, profile] = await Promise.all([
      this.prisma.entryItem.findMany({
        where: {
          grams: { gt: 0 },
          entry: { userId, timestamp: { gte: suggestionWindowStart(now) } },
        },
        select: SUGGESTION_ITEM_SELECT,
      }),
      this.prisma.product.findMany({
        where: { userId },
        orderBy: PRODUCT_ORDER,
        select: SAVED_FOOD_INFO_SELECT,
      }),
      this.prisma.profile.findUnique({
        where: { userId },
        select: { dismissedFoodMerges: true, foodMergeDecisions: true },
      }),
    ]);
    return {
      suggestions: buildMergeSuggestions(
        rows.map(toLoggedFoodItem),
        new Map(
          products.map((product) => [product.id, toSavedFoodInfo(product)]),
        ),
        profile?.dismissedFoodMerges ?? [],
        parseMergeDecisions(profile?.foodMergeDecisions),
      ),
    };
  }

  merge(
    userId: string,
    dto: MergeFoodsDto,
    now: Date = new Date(),
  ): Promise<MyFoodChangeResponse> {
    return this.prisma.$transaction(async (tx) => {
      const per100 = sanitizeNutrients(dto.per100);
      const food = dto.productId
        ? await this.mergeInto(tx, userId, dto.productId, dto, per100)
        : await this.createMerged(tx, userId, dto, per100);
      const changes = dto.applyToPast
        ? await applySavedFoodToPast(tx, userId, food, { matchNames: true })
        : NO_SAVED_FOOD_CHANGES;
      await this.recordDecision(
        tx,
        userId,
        newMergeDecision(
          [...dto.names, ...savedFoodNames(food)],
          dto.keptApart ?? [],
          food.id,
          now,
        ),
      );
      return toChangeResponse(await loadMyFood(tx, food.id), changes);
    }, SAVED_FOOD_TRANSACTION);
  }

  async dismiss(userId: string, key: string): Promise<void> {
    const normalized = dismissedKey(key);
    await this.prisma.$transaction(async (tx) => {
      await tx.profile.createMany({ data: [{ userId }], skipDuplicates: true });
      const rows = await tx.$queryRaw<DismissedRow[]>`
        SELECT "dismissedFoodMerges" FROM "Profile"
        WHERE "userId" = ${userId}::uuid
        FOR UPDATE`;
      const current = rows[0]?.dismissedFoodMerges ?? [];
      if (current.includes(normalized)) {
        return;
      }
      await tx.profile.update({
        where: { userId },
        data: {
          dismissedFoodMerges: { set: withDismissedKey(current, normalized) },
        },
      });
    });
  }

  private async recordDecision(
    tx: Prisma.TransactionClient,
    userId: string,
    decision: FoodMergeDecision,
  ): Promise<void> {
    await tx.profile.createMany({ data: [{ userId }], skipDuplicates: true });
    const rows = await tx.$queryRaw<MergeDecisionsRow[]>`
      SELECT "foodMergeDecisions" FROM "Profile"
      WHERE "userId" = ${userId}::uuid
      FOR UPDATE`;
    const current = parseMergeDecisions(rows[0]?.foodMergeDecisions);
    await tx.profile.update({
      where: { userId },
      data: {
        foodMergeDecisions: mergeDecisionsJson(
          withMergeDecision(current, decision),
        ),
      },
    });
  }

  private async mergeInto(
    tx: Prisma.TransactionClient,
    userId: string,
    productId: string,
    dto: MergeFoodsDto,
    per100: Nutrients,
  ): Promise<Product> {
    const existing = await requireOwnedProduct(tx, userId, productId);
    const brand =
      dto.brand === undefined ? existing.brand : blankToNull(dto.brand);
    return tx.product.update({
      where: { id: existing.id },
      data: {
        ...mergedFields(dto, brand, per100),
        ...microsPer100Update(dto.microsPer100),
        aliases: cleanAliases(
          withoutKeptApart(
            [...dto.names, existing.name, ...existing.aliases],
            dto.names,
            dto.keptApart ?? [],
          ),
          dto.name,
          brand,
        ),
        missingNutrients: correctedMissingNutrients(
          existing,
          existing.source,
          per100,
        ),
      },
    });
  }

  private createMerged(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: MergeFoodsDto,
    per100: Nutrients,
  ): Promise<Product> {
    const brand = blankToNull(dto.brand);
    return tx.product.create({
      data: {
        ...mergedFields(dto, brand, per100),
        microsPer100: microsJson(per100Micros(dto.microsPer100)),
        userId,
        barcode: null,
        aliases: cleanAliases(dto.names, dto.name, brand),
        source: 'manual',
        missingNutrients: [],
      },
    });
  }
}
