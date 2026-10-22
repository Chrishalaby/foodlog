import { computeTargets, type DaySummary, eachDate } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';
import { dayFluids, fluidsMlByDate } from './day-fluids.js';
import {
  CAFFEINATED_FLUID_KINDS,
  type DayMicros,
  microsByDate,
} from './day-micros.js';
import {
  buildDaySummaries,
  buildDaySummary,
  type DayTotals,
  NUTRIENT_SUM,
  nutrientsFromSums,
} from './day-summaries.js';

interface DayExtras {
  micros: Map<string, DayMicros>;
  fluidsMl: Map<string, number>;
}

@Injectable()
export class DaySummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
  ) {}

  async forDay(userId: string, date: string): Promise<DaySummary> {
    const [profile, meta, aggregate, extras] = await Promise.all([
      this.profiles.getProfile(userId),
      this.prisma.dayMeta.findUnique({
        where: { userId_date: { userId, date } },
        select: { trainingDay: true },
      }),
      this.prisma.entry.aggregate({
        where: { userId, localDate: date },
        _sum: NUTRIENT_SUM,
        _count: { _all: true },
      }),
      this.dayExtras(userId, date, date),
    ]);
    const trainingDay = meta?.trainingDay ?? false;
    return buildDaySummary(
      date,
      trainingDay,
      computeTargets(profile),
      {
        totals: nutrientsFromSums(aggregate._sum),
        entryCount: aggregate._count._all,
      },
      extras.micros.get(date),
      dayFluids(profile, trainingDay, extras.fluidsMl.get(date)),
    );
  }

  async forRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<DaySummary[]> {
    const [profile, totalsByDate, trainingDates, extras] = await Promise.all([
      this.profiles.getProfile(userId),
      this.totalsByDate(userId, from, to),
      this.trainingDates(userId, from, to),
      this.dayExtras(userId, from, to),
    ]);
    return buildDaySummaries(
      eachDate(from, to),
      totalsByDate,
      trainingDates,
      computeTargets(profile),
      extras.micros,
      { profile, mlByDate: extras.fluidsMl },
    );
  }

  private async dayExtras(
    userId: string,
    from: string,
    to: string,
  ): Promise<DayExtras> {
    const [items, logs] = await Promise.all([
      this.prisma.entryItem.findMany({
        where: { entry: { userId, localDate: { gte: from, lte: to } } },
        select: {
          micros: true,
          fluidMl: true,
          entry: { select: { localDate: true } },
        },
      }),
      this.prisma.fluidLog.findMany({
        where: { userId, localDate: { gte: from, lte: to } },
        select: { localDate: true, kind: true, ml: true },
      }),
    ]);
    const rows = items.map((item) => ({
      localDate: item.entry.localDate,
      micros: item.micros,
      fluidMl: item.fluidMl,
    }));
    return {
      micros: microsByDate(
        rows,
        logs.filter((log) => CAFFEINATED_FLUID_KINDS.includes(log.kind)),
      ),
      fluidsMl: fluidsMlByDate(rows, logs),
    };
  }

  private async totalsByDate(
    userId: string,
    from: string,
    to: string,
  ): Promise<Map<string, DayTotals>> {
    const groups = await this.prisma.entry.groupBy({
      by: ['localDate'],
      where: { userId, localDate: { gte: from, lte: to } },
      _sum: NUTRIENT_SUM,
      _count: { _all: true },
    });
    return new Map(
      groups.map((group) => [
        group.localDate,
        {
          totals: nutrientsFromSums(group._sum),
          entryCount: group._count._all,
        },
      ]),
    );
  }

  private async trainingDates(
    userId: string,
    from: string,
    to: string,
  ): Promise<Set<string>> {
    const metas = await this.prisma.dayMeta.findMany({
      where: {
        userId,
        trainingDay: true,
        date: { gte: from, lte: to },
      },
      select: { date: true },
    });
    return new Set(metas.map((meta) => meta.date));
  }
}
