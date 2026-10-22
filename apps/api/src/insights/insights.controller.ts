import type { InsightsResponse } from '@food/shared';
import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { InsightsQueryDto } from './insights.dto.js';
import { InsightsService } from './insights.service.js';

@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  get(
    @CurrentUser() user: AuthUser,
    @Query() query: InsightsQueryDto,
  ): Promise<InsightsResponse> {
    return this.insights.insights(user.id, query);
  }
}
