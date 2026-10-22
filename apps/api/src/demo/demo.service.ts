import { randomBytes, randomUUID } from 'node:crypto';
import {
  type DemoStartRequest,
  diffDays,
  sanitizeMicrosPer100,
} from '@food/shared';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountsService } from '../auth/accounts.service.js';
import type { SessionResult } from '../auth/auth.types.js';
import { hashPassword } from '../auth/passwords.js';
import { SessionsService } from '../auth/sessions.service.js';
import { entryItemData, normalizeItems } from '../common/items.js';
import { nutrientColumns } from '../common/mappers.js';
import { portionUpdateColumns } from '../common/portions.js';
import { AppConfig } from '../config/app-config.js';
import { favoriteCreateData } from '../favorites/favorite-data.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildDemoSeed,
  DEMO_FOOD_NAMES,
  DEMO_PROFILE,
  type DemoFood,
  type DemoSeed,
  seededRandom,
} from './demo-seed.js';
import { uuidV7 } from '../common/uuid-v7.js';

export const DEMO_DISABLED_MESSAGE = 'The demo is not enabled on this server';
export const DEMO_NOT_READY_MESSAGE =
  'The demo is still getting ready. Please try again in a minute.';
export const DEMO_DATE_MESSAGE = 'localDate must be today on your device';
export const DEMO_EMAIL_DOMAIN = 'demo.invalid';
const HOUR_MS = 3_600_000;
const SEED_TIMEOUT_MS = 60_000;

type Tx = Prisma.TransactionClient;

export function isDemoEmail(email: string): boolean {
  return email.endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

function minutesAt(now: Date, utcOffsetMinutes: number): number {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
  ) {}

  get enabled(): boolean {
    return this.config.demo.enabled;
  }

  async expiresAt(userId: string): Promise<Date | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { demoExpiresAt: true },
    });
    return user?.demoExpiresAt ?? null;
  }

  async start(
    request: DemoStartRequest,
    userAgent: string | null,
    now: Date = new Date(),
  ): Promise<SessionResult> {
    if (!this.enabled) {
      throw new NotFoundException(DEMO_DISABLED_MESSAGE);
    }
    if (
      Math.abs(diffDays(now.toISOString().slice(0, 10), request.localDate)) > 1
    ) {
      throw new BadRequestException(DEMO_DATE_MESSAGE);
    }
    const foods = await this.loadFoods();
    if (foods.size === 0) {
      throw new ServiceUnavailableException(DEMO_NOT_READY_MESSAGE);
    }
    const email = `demo-${randomUUID()}@${DEMO_EMAIL_DOMAIN}`;
    const passwordHash = await hashPassword(
      randomBytes(32).toString('base64url'),
    );
    const seed = buildDemoSeed({
      today: request.localDate,
      utcOffsetMinutes: request.utcOffsetMinutes,
      nowMinutes: minutesAt(now, request.utcOffsetMinutes),
      random: seededRandom(email),
      lookup: (name) => foods.get(name),
    });
    const expiresAt = new Date(
      now.getTime() + this.config.demo.ttlHours * HOUR_MS,
    );
    const user = await this.prisma.$transaction(
      async (tx) => {
        const account = await this.accounts.create(tx, {
          email,
          passwordHash,
          name: 'Demo',
          role: 'member',
        });
        await tx.user.update({
          where: { id: account.id },
          data: { demoExpiresAt: expiresAt },
          select: { id: true },
        });
        await tx.profile.update({
          where: { userId: account.id },
          data: {
            ...DEMO_PROFILE,
            weightKg: seed.latestWeightKg,
            onboardedAt: now,
          },
        });
        await this.writeSeed(tx, account.id, seed);
        return account;
      },
      { timeout: SEED_TIMEOUT_MS },
    );
    return { user, token: await this.sessions.create(user.id, userAgent) };
  }

  private async loadFoods(): Promise<Map<string, DemoFood>> {
    const rows = await this.prisma.catalogFood.findMany({
      where: { name: { in: [...DEMO_FOOD_NAMES] } },
    });
    return new Map(
      rows.map((row) => [
        row.name,
        {
          name: row.name,
          per100: {
            calories: row.calories,
            protein: row.protein,
            carbs: row.carbs,
            fat: row.fat,
            satFat: row.satFat,
            fiber: row.fiber,
            sugar: row.sugar,
            sodium: row.sodium,
            alcohol: row.alcohol,
          },
          microsPer100: sanitizeMicrosPer100(row.microsPer100),
        },
      ]),
    );
  }

  private async writeSeed(
    tx: Tx,
    userId: string,
    seed: DemoSeed,
  ): Promise<void> {
    const entries: Prisma.EntryCreateManyInput[] = [];
    const items: Prisma.EntryItemCreateManyInput[] = [];
    for (const entry of seed.entries) {
      const id = uuidV7(entry.timestamp.getTime());
      const normalized = normalizeItems(entry.items);
      entries.push({
        id,
        userId,
        name: entry.name,
        mealType: entry.mealType,
        source: 'database',
        timestamp: entry.timestamp,
        localDate: entry.localDate,
        ...portionUpdateColumns(entry.portion),
        ...nutrientColumns(normalized.totals),
      });
      for (const item of normalized.items) {
        items.push({
          ...entryItemData(item),
          id: uuidV7(entry.timestamp.getTime()),
          entryId: id,
        });
      }
    }
    await tx.entry.createMany({ data: entries });
    await tx.entryItem.createMany({ data: items });
    await tx.weightLog.createMany({
      data: seed.weights.map((weight) => ({
        userId,
        date: weight.date,
        weightKg: weight.weightKg,
      })),
    });
    await tx.fluidLog.createMany({
      data: seed.fluids.map((fluid) => ({
        id: uuidV7(fluid.timestamp.getTime()),
        userId,
        localDate: fluid.localDate,
        timestamp: fluid.timestamp,
        ml: fluid.ml,
        kind: fluid.kind,
      })),
    });
    await tx.dayMeta.createMany({
      data: seed.trainingDays.map((date) => ({
        userId,
        date,
        trainingDay: true,
      })),
    });
    for (const favorite of seed.favorites) {
      await tx.favorite.create({
        data: {
          ...favoriteCreateData({
            userId,
            photoId: null,
            name: favorite.name,
            mealType: favorite.mealType,
            items: favorite.items,
            portion: favorite.portion,
          }),
          useCount: favorite.useCount,
          lastUsedAt: new Date(),
        },
        select: { id: true },
      });
    }
  }
}
