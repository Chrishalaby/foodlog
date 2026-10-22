import type { UsageSummaryResponse } from '@food/shared';
import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UsageQueryDto } from './usage.dto.js';
import { UsageService } from './usage.service.js';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  summary(
    @CurrentUser() user: AuthUser,
    @Query() query: UsageQueryDto,
  ): Promise<UsageSummaryResponse> {
    return this.usage.summary(user.id, query.month);
  }
}
