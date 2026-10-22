import type {
  DayDashboardResponse,
  RangeDashboardResponse,
} from '@food/shared';
import { Injectable } from '@nestjs/common';
import { ENTRY_INCLUDE, toEntryDto } from '../common/mappers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DaySummariesService } from './day-summaries.service.js';
import { computeRangeStats } from './stats.js';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: DaySummariesService,
  ) {}

  async day(userId: string, date: string): Promise<DayDashboardResponse> {
    const [day, entries] = await Promise.all([
      this.summaries.forDay(userId, date),
      this.prisma.entry.findMany({
        where: { userId, localDate: date },
        include: ENTRY_INCLUDE,
        orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { day, entries: entries.map(toEntryDto) };
  }

  async range(
    userId: string,
    from: string,
    to: string,
  ): Promise<RangeDashboardResponse> {
    const days = await this.summaries.forRange(userId, from, to);
    return { from, to, days, stats: computeRangeStats(days) };
  }
}
