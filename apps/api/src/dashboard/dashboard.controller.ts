import type {
  DayDashboardResponse,
  RangeDashboardResponse,
} from '@food/shared';
import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  DayDashboardQueryDto,
  RangeDashboardQueryDto,
} from './dashboard.dto.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('day')
  day(
    @CurrentUser() user: AuthUser,
    @Query() query: DayDashboardQueryDto,
  ): Promise<DayDashboardResponse> {
    return this.dashboard.day(user.id, query.date);
  }

  @Get('range')
  range(
    @CurrentUser() user: AuthUser,
    @Query() query: RangeDashboardQueryDto,
  ): Promise<RangeDashboardResponse> {
    return this.dashboard.range(user.id, query.from, query.to);
  }
}
