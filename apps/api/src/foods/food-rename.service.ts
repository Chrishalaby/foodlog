import type { FoodRenameResponse } from '@food/shared';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type FoodRenamePlan,
  matchesFoodName,
  planFoodRename,
  RENAME_ITEMS_PROBE,
  type RenameEntry,
  type RenameFavorite,
  renameSummary,
} from './food-rename.js';
import { normalizeFoodName } from './food-text.js';
import type { FoodRenameDto } from './foods.dto.js';

type Client = Prisma.TransactionClient | PrismaService;

const RENAME_ENTRY_SELECT = {
  id: true,
  name: true,
  items: {
    select: { id: true, name: true },
    orderBy: { position: 'asc' },
    take: RENAME_ITEMS_PROBE,
  },
} as const satisfies Prisma.EntrySelect;

const RENAME_FAVORITE_SELECT = {
  id: true,
  name: true,
  items: true,
} as const satisfies Prisma.FavoriteSelect;

async function loadRenameEntries(
  client: Client,
  userId: string,
  from: string,
): Promise<RenameEntry[]> {
  const target = normalizeFoodName(from);
  const names = await client.entry.groupBy({
    by: ['name'],
    where: { userId },
  });
  const matching = names
    .map((row) => row.name)
    .filter((name) => matchesFoodName(name, target));
  if (matching.length === 0) {
    return [];
  }
  return client.entry.findMany({
    where: { userId, name: { in: matching } },
    select: RENAME_ENTRY_SELECT,
  });
}

function loadRenameFavorites(
  client: Client,
  userId: string,
): Promise<RenameFavorite[]> {
  return client.favorite.findMany({
    where: { userId },
    select: RENAME_FAVORITE_SELECT,
  });
}

async function planRename(
  client: Client,
  userId: string,
  dto: FoodRenameDto,
): Promise<FoodRenamePlan> {
  const entries = await loadRenameEntries(client, userId, dto.from);
  const favorites = await loadRenameFavorites(client, userId);
  return planFoodRename(entries, favorites, dto.from, dto.to);
}

async function applyRename(
  tx: Prisma.TransactionClient,
  userId: string,
  plan: FoodRenamePlan,
): Promise<void> {
  for (const group of plan.entryRenames) {
    await tx.entry.updateMany({
      where: { userId, id: { in: group.ids } },
      data: { name: group.name },
    });
  }
  if (plan.itemIds.length > 0) {
    await tx.entryItem.updateMany({
      where: { id: { in: plan.itemIds }, entry: { userId } },
      data: { name: plan.itemName },
    });
  }
  for (const favorite of plan.favoriteRenames) {
    await tx.favorite.updateMany({
      where: { id: favorite.id, userId },
      data: {
        name: favorite.name,
        ...(favorite.items === null ? {} : { items: favorite.items }),
      },
    });
  }
}

@Injectable()
export class FoodRenameService {
  constructor(private readonly prisma: PrismaService) {}

  async rename(
    userId: string,
    dto: FoodRenameDto,
  ): Promise<FoodRenameResponse> {
    if (dto.dryRun === true) {
      return renameSummary(await planRename(this.prisma, userId, dto));
    }
    return this.prisma.$transaction(async (tx) => {
      const plan = await planRename(tx, userId, dto);
      await applyRename(tx, userId, plan);
      return renameSummary(plan);
    });
  }
}
