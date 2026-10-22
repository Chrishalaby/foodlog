import type { WeightLogDto, WeightSummaryResponse } from '@food/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  UpsertWeightDto,
  WeightDateParamDto,
  WeightsQueryDto,
} from './weights.dto.js';
import { WeightsService } from './weights.service.js';

@Controller('weights')
export class WeightsController {
  constructor(private readonly weights: WeightsService) {}

  @Get()
  summary(
    @CurrentUser() user: AuthUser,
    @Query() query: WeightsQueryDto,
  ): Promise<WeightSummaryResponse> {
    return this.weights.summary(user.id, query.from, query.to);
  }

  @Put(':date')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param() params: WeightDateParamDto,
    @Body() body: UpsertWeightDto,
  ): Promise<WeightLogDto> {
    return this.weights.upsert(user.id, params.date, body);
  }

  @Delete(':date')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param() params: WeightDateParamDto,
  ): Promise<void> {
    return this.weights.remove(user.id, params.date);
  }
}
