import type { UsageRecordDto, UsageSummaryResponse } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import type { AiUsage, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BUDGET_SUBJECT_SELECT,
  type BudgetSubject,
  effectiveBudgetUsd,
  isBudgetReached,
  UNKNOWN_BUDGET_SUBJECT,
} from './usage-budget.js';
import {
  roundUsd,
  trailingWindowStart,
  utcMonthOf,
  utcMonthRange,
} from './usage-period.js';

export const RECENT_USAGE_LIMIT = 20;

type ModelBreakdown = UsageSummaryResponse['byModel'][number];

interface ModelGroup {
  model: string;
  _count: { _all: number };
  _sum: { costUsd: number | null };
}

function toUsageRecord(row: AiUsage): UsageRecordDto {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    model: row.model,
    mode: row.mode,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    costUsd: row.costUsd,
    durationMs: row.durationMs,
    success: row.success,
    errorKind: row.errorKind,
  };
}

function toModelBreakdown(groups: readonly ModelGroup[]): ModelBreakdown[] {
  return groups
    .map((group) => ({
      model: group.model,
      requests: group._count._all,
      costUsd: roundUsd(group._sum.costUsd ?? 0),
    }))
    .sort(
      (a, b) =>
        b.costUsd - a.costUsd ||
        b.requests - a.requests ||
        a.model.localeCompare(b.model),
    );
}

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  get globalBudgetUsd(): number | null {
    return this.config.ai.monthlyBudgetUsd;
  }

  get memberDefaultBudgetUsd(): number | null {
    return this.config.ai.memberMonthlyBudgetUsd;
  }

  effectiveBudgetUsd(user: BudgetSubject): number | null {
    return effectiveBudgetUsd(user, this.memberDefaultBudgetUsd);
  }

  async userBudgetUsd(userId: string): Promise<number | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: BUDGET_SUBJECT_SELECT,
    });
    return this.effectiveBudgetUsd(user ?? UNKNOWN_BUDGET_SUBJECT);
  }

  async totalCostUsd(where: Prisma.AiUsageWhereInput): Promise<number> {
    const result = await this.prisma.aiUsage.aggregate({
      where,
      _sum: { costUsd: true },
    });
    return roundUsd(result._sum.costUsd ?? 0);
  }

  async isMonthlyBudgetReached(now: Date = new Date()): Promise<boolean> {
    const budget = this.globalBudgetUsd;
    if (budget === null) {
      return false;
    }
    const { start } = utcMonthRange(utcMonthOf(now));
    const spent = await this.totalCostUsd({ createdAt: { gte: start } });
    return isBudgetReached(spent, budget);
  }

  async isUserBudgetReached(
    userId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const budget = await this.userBudgetUsd(userId);
    if (budget === null) {
      return false;
    }
    const { start } = utcMonthRange(utcMonthOf(now));
    const spent = await this.totalCostUsd({
      userId,
      createdAt: { gte: start },
    });
    return isBudgetReached(spent, budget);
  }

  async summary(
    userId: string,
    month: string | undefined,
    now: Date = new Date(),
  ): Promise<UsageSummaryResponse> {
    const selectedMonth = month ?? utcMonthOf(now);
    const { start, end } = utcMonthRange(selectedMonth);
    const inMonth: Prisma.AiUsageWhereInput = {
      userId,
      createdAt: { gte: start, lt: end },
    };
    const [
      monthUsd,
      requests,
      failed,
      last30DaysUsd,
      allTimeUsd,
      groups,
      recent,
      budgetUsd,
    ] = await Promise.all([
      this.totalCostUsd(inMonth),
      this.prisma.aiUsage.count({ where: inMonth }),
      this.prisma.aiUsage.count({ where: { ...inMonth, success: false } }),
      this.totalCostUsd({
        userId,
        createdAt: { gte: trailingWindowStart(now) },
      }),
      this.totalCostUsd({ userId }),
      this.prisma.aiUsage.groupBy({
        by: ['model'],
        where: inMonth,
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
      this.prisma.aiUsage.findMany({
        where: inMonth,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_USAGE_LIMIT,
      }),
      this.userBudgetUsd(userId),
    ]);
    const successful = requests - failed;
    return {
      month: selectedMonth,
      monthToDateUsd: monthUsd,
      monthRequests: requests,
      monthFailedRequests: failed,
      last30DaysUsd,
      allTimeUsd,
      avgCostPerRequestUsd:
        successful > 0 ? roundUsd(monthUsd / successful) : 0,
      byModel: toModelBreakdown(groups),
      recent: recent.map(toUsageRecord),
      budgetUsd,
    };
  }
}
