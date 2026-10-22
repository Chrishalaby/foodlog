import type {
  EntryDto,
  FoodRenameResponse,
  FoodSearchResponse,
  HiddenFoodsResponse,
} from '@food/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FoodRenameService } from './food-rename.service.js';
import { FoodSearchService } from './food-search.service.js';
import {
  FoodRenameDto,
  FoodSearchQueryDto,
  HiddenFoodQueryDto,
  HideFoodDto,
  QuickLogDto,
} from './foods.dto.js';
import { HiddenFoodsService } from './hidden-foods.service.js';
import { QuickLogService } from './quick-log.service.js';

export const FOOD_RENAME_THROTTLE = {
  long: { limit: 20, ttl: 60_000 },
} as const;

@Controller('foods')
export class FoodsController {
  constructor(
    private readonly search: FoodSearchService,
    private readonly quickLog: QuickLogService,
    private readonly renames: FoodRenameService,
    private readonly hidden: HiddenFoodsService,
  ) {}

  @Get()
  find(
    @CurrentUser() user: AuthUser,
    @Query() query: FoodSearchQueryDto,
  ): Promise<FoodSearchResponse> {
    return this.search.search(user.id, query);
  }

  @Post('log')
  log(
    @CurrentUser() user: AuthUser,
    @Body() body: QuickLogDto,
  ): Promise<EntryDto> {
    return this.quickLog.log(user.id, body);
  }

  @Post('rename')
  @HttpCode(HttpStatus.OK)
  @Throttle(FOOD_RENAME_THROTTLE)
  rename(
    @CurrentUser() user: AuthUser,
    @Body() body: FoodRenameDto,
  ): Promise<FoodRenameResponse> {
    return this.renames.rename(user.id, body);
  }

  @Get('hidden')
  hiddenFoods(@CurrentUser() user: AuthUser): Promise<HiddenFoodsResponse> {
    return this.hidden.list(user.id);
  }

  @Post('hidden')
  @HttpCode(HttpStatus.OK)
  hide(
    @CurrentUser() user: AuthUser,
    @Body() body: HideFoodDto,
  ): Promise<HiddenFoodsResponse> {
    return this.hidden.hide(user.id, body.name);
  }

  @Delete('hidden')
  unhide(
    @CurrentUser() user: AuthUser,
    @Query() query: HiddenFoodQueryDto,
  ): Promise<HiddenFoodsResponse> {
    return this.hidden.unhide(user.id, query.name);
  }
}
