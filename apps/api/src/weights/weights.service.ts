import {
  type AdaptiveTdee,
  adaptiveTdee,
  type DailyIntake,
  type UpsertWeightRequest,
  type WeightLogDto,
  type WeightPoint,
  type WeightSummaryResponse,
} from '@food/shared';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type ProfileBodySync,
  profileBodySync,
  toWeightLogDto,
  toWeightPoint,
  WEIGHT_LOG_SELECT,
  weightLogValues,
} from './weight-log.mapper.js';
import {
  adaptiveTdeeWindow,
  buildWeightSummary,
  dailyIntake,
  type DateWindow,
  trendWarmupStart,
} from './weight-summary.js';
import { FUTURE_WEIGH_IN_MESSAGE, isFutureWeighIn } from './weights.dto.js';

export const WEIGHT_LOCK_NAMESPACE = 731_402_118;

export interface WeightSignals {
  weights: WeightPoint[];
  adaptiveTdee: AdaptiveTdee | null;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class WeightsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(
    userId: string,
    from: string,
    to: string,
  ): Promise<WeightSummaryResponse> {
    const [logs, latest, intake] = await Promise.all([
      this.logsBetween(userId, { from: trendWarmupStart(from), to }),
      this.latestOnOrBefore(userId, to),
      this.dailyIntake(userId, adaptiveTdeeWindow(to)),
    ]);
    return buildWeightSummary({ from, to, logs, latest, intake });
  }

  async signals(userId: string, to: string): Promise<WeightSignals> {
    const window = adaptiveTdeeWindow(to);
    const [logs, intake] = await Promise.all([
      this.logsBetween(userId, { from: window.from, to }),
      this.dailyIntake(userId, window),
    ]);
    const weights = logs.map(toWeightPoint);
    return { weights, adaptiveTdee: adaptiveTdee(intake, weights) };
  }

  async upsert(
    userId: string,
    date: string,
    request: UpsertWeightRequest,
    now: Date = new Date(),
  ): Promise<WeightLogDto> {
    if (isFutureWeighIn(date, now)) {
      throw new BadRequestException([FUTURE_WEIGH_IN_MESSAGE]);
    }
    const values = weightLogValues(request);
    return this.prisma.$transaction(async (tx) => {
      await lockWeights(tx, userId);
      const row = await tx.weightLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...values },
        update: values,
        select: WEIGHT_LOG_SELECT,
      });
      const newer = await tx.weightLog.count({
        where: { userId, date: { gt: date } },
      });
      if (newer === 0) {
        await syncProfile(tx, userId, profileBodySync(values));
      }
      return toWeightLogDto(row);
    });
  }

  async remove(userId: string, date: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockWeights(tx, userId);
      const { count } = await tx.weightLog.deleteMany({
        where: { userId, date },
      });
      if (count === 0) {
        throw new NotFoundException('No weigh-in on this date');
      }
      const latest = await tx.weightLog.findFirst({
        where: { userId },
        orderBy: { date: 'desc' },
        select: WEIGHT_LOG_SELECT,
      });
      if (latest && latest.date < date) {
        await syncProfile(tx, userId, profileBodySync(latest));
      }
    });
  }

  private async logsBetween(
    userId: string,
    window: DateWindow,
  ): Promise<WeightLogDto[]> {
    const rows = await this.prisma.weightLog.findMany({
      where: { userId, date: { gte: window.from, lte: window.to } },
      orderBy: { date: 'asc' },
      select: WEIGHT_LOG_SELECT,
    });
    return rows.map(toWeightLogDto);
  }

  private async latestOnOrBefore(
    userId: string,
    to: string,
  ): Promise<WeightLogDto | null> {
    const row = await this.prisma.weightLog.findFirst({
      where: { userId, date: { lte: to } },
      orderBy: { date: 'desc' },
      select: WEIGHT_LOG_SELECT,
    });
    return row ? toWeightLogDto(row) : null;
  }

  private async dailyIntake(
    userId: string,
    window: DateWindow,
  ): Promise<DailyIntake[]> {
    const groups = await this.prisma.entry.groupBy({
      by: ['localDate'],
      where: { userId, localDate: { gte: window.from, lte: window.to } },
      _sum: { calories: true },
      _count: { _all: true },
    });
    return dailyIntake(
      window,
      groups.map((group) => ({
        date: group.localDate,
        calories: group._sum.calories,
        entryCount: group._count._all,
      })),
    );
  }
}

async function lockWeights(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WEIGHT_LOCK_NAMESPACE}::int4, hashtext(${userId}))`;
}

async function syncProfile(
  tx: Tx,
  userId: string,
  body: ProfileBodySync,
): Promise<void> {
  await tx.profile.upsert({
    where: { userId },
    create: { userId, ...body },
    update: body,
  });
}
