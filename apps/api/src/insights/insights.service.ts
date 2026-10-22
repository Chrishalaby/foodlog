import {
  addDays,
  computeTargets,
  type InsightsResponse,
  microTargets,
} from '@food/shared';
import { Injectable } from '@nestjs/common';
import { DaySummariesService } from '../dashboard/day-summaries.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';
import { WeightsService } from '../weights/weights.service.js';
import type { BodyInsightContext } from './body-insights.js';
import { INSIGHT_WINDOW } from './insights.dto.js';
import { buildInsights } from './insights.rules.js';

export interface InsightsWindowQuery {
  to?: string;
  days?: number;
}

interface LoggedDateBounds {
  first: string | null;
  latest: string | null;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function latestDate(
  ...dates: readonly (string | null | undefined)[]
): string | null {
  return dates.reduce<string | null>(
    (latest, date) =>
      date && (latest === null || date > latest) ? date : latest,
    null,
  );
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: DaySummariesService,
    private readonly profiles: ProfileService,
    private readonly weights: WeightsService,
  ) {}

  async insights(
    userId: string,
    query: InsightsWindowQuery,
  ): Promise<InsightsResponse> {
    const bounds = await this.loggedDateBounds(userId);
    const to = query.to ?? bounds.latest ?? todayUtc();
    const from = addDays(to, -((query.days ?? INSIGHT_WINDOW.default) - 1));
    const [days, profile, signals, fluidLogDates] = await Promise.all([
      this.summaries.forRange(userId, from, to),
      this.profiles.getProfile(userId),
      this.weights.signals(userId, to),
      this.fluidLogDates(userId, from, to),
    ]);
    const body: BodyInsightContext = {
      to,
      goal: profile.goal,
      weights: signals.weights,
      tdee: computeTargets(profile).tdee,
      adaptiveTdee: signals.adaptiveTdee,
    };
    return {
      from,
      to,
      insights: buildInsights(days, {
        trackingSince: bounds.first,
        body,
        caffeineLimitMg: microTargets(profile.sex, profile.age).caffeine.amount,
        fluidLogDates,
      }),
    };
  }

  private async fluidLogDates(
    userId: string,
    from: string,
    to: string,
  ): Promise<Set<string>> {
    const groups = await this.prisma.fluidLog.groupBy({
      by: ['localDate'],
      where: { userId, localDate: { gte: from, lte: to } },
    });
    return new Set(groups.map((group) => group.localDate));
  }

  private async loggedDateBounds(userId: string): Promise<LoggedDateBounds> {
    const [entries, fluids] = await Promise.all([
      this.prisma.entry.aggregate({
        where: { userId },
        _min: { localDate: true },
        _max: { localDate: true },
      }),
      this.prisma.fluidLog.aggregate({
        where: { userId },
        _max: { localDate: true },
      }),
    ]);
    return {
      first: entries._min.localDate ?? null,
      latest: latestDate(entries._max.localDate, fluids._max.localDate),
    };
  }
}
