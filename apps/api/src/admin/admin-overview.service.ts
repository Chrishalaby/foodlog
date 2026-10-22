import type { AdminOverviewResponse } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { pendingTokens } from '../auth/auth-token-queries.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  roundUsd,
  trailingWindowStart,
  utcMonthOf,
  utcMonthRange,
} from '../usage/usage-period.js';
import { UsageService } from '../usage/usage.service.js';

@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  async overview(now: Date = new Date()): Promise<AdminOverviewResponse> {
    const { start } = utcMonthRange(utcMonthOf(now));
    const [users, activeUsers30d, pendingRequests, pendingInvites, ai] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({
          where: { lastSeenAt: { gte: trailingWindowStart(now) } },
        }),
        this.prisma.accessRequest.count({ where: { status: 'pending' } }),
        this.prisma.authToken.count({
          where: pendingTokens({ type: 'invite', expiresAt: { gt: now } }),
        }),
        this.prisma.aiUsage.aggregate({
          where: { createdAt: { gte: start } },
          _count: { _all: true },
          _sum: { costUsd: true },
        }),
      ]);
    return {
      users,
      activeUsers30d,
      pendingRequests,
      pendingInvites,
      aiCostMonthUsd: roundUsd(ai._sum.costUsd ?? 0),
      aiRequestsMonth: ai._count._all,
      globalBudgetUsd: this.usage.globalBudgetUsd,
      memberDefaultBudgetUsd: this.usage.memberDefaultBudgetUsd,
    };
  }
}
