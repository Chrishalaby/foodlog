import type { HiddenFoodsResponse } from '@food/shared';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FoodLibraryRepository } from './food-library.repository.js';
import {
  hiddenFoodName,
  sameNames,
  withHiddenName,
  withoutHiddenName,
} from './hidden-foods.js';

type ChangeNames = (names: readonly string[]) => string[];

interface HiddenFoodsRow {
  hiddenFoods: string[];
}

async function lockedHiddenNames(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<HiddenFoodsRow[]>`
    SELECT "hiddenFoods" FROM "Profile"
    WHERE "userId" = ${userId}::uuid
    FOR UPDATE`;
  return rows[0]?.hiddenFoods ?? [];
}

@Injectable()
export class HiddenFoodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly library: FoodLibraryRepository,
  ) {}

  async list(userId: string): Promise<HiddenFoodsResponse> {
    return { names: await this.library.hiddenNames(userId) };
  }

  async hide(userId: string, name: string): Promise<HiddenFoodsResponse> {
    const hiddenName = hiddenFoodName(name);
    return this.change(userId, true, (names) =>
      withHiddenName(names, hiddenName),
    );
  }

  async unhide(userId: string, name: string): Promise<HiddenFoodsResponse> {
    return this.change(userId, false, (names) =>
      withoutHiddenName(names, name),
    );
  }

  private change(
    userId: string,
    ensureProfile: boolean,
    changeNames: ChangeNames,
  ): Promise<HiddenFoodsResponse> {
    return this.prisma.$transaction(async (tx) => {
      if (ensureProfile) {
        await tx.profile.createMany({
          data: [{ userId }],
          skipDuplicates: true,
        });
      }
      const current = await lockedHiddenNames(tx, userId);
      const next = changeNames(current);
      if (!sameNames(current, next)) {
        await tx.profile.update({
          where: { userId },
          data: { hiddenFoods: { set: next } },
        });
      }
      return { names: next };
    });
  }
}
