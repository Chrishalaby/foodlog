import type {
  FoodMergeSuggestionsResponse,
  MyFoodChangeResponse,
  MyFoodDto,
} from '@food/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FoodMergesService } from './food-merges.service.js';
import {
  DismissFoodMergeDto,
  MergeFoodsDto,
  MyFoodsQueryDto,
  SaveMyFoodDto,
  UpdateMyFoodDto,
} from './my-foods.dto.js';
import { MyFoodsService } from './my-foods.service.js';

export const FOOD_MERGE_THROTTLE = {
  long: { limit: 20, ttl: 60_000 },
} as const;

@Controller('my-foods')
export class MyFoodsController {
  constructor(
    private readonly foods: MyFoodsService,
    private readonly merges: FoodMergesService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: MyFoodsQueryDto,
  ): Promise<MyFoodDto[]> {
    return this.foods.list(user.id, query.q);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: SaveMyFoodDto,
  ): Promise<MyFoodDto> {
    return this.foods.create(user.id, body);
  }

  @Get('suggestions')
  suggestions(
    @CurrentUser() user: AuthUser,
  ): Promise<FoodMergeSuggestionsResponse> {
    return this.merges.suggestions(user.id);
  }

  @Post('suggestions/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  dismiss(
    @CurrentUser() user: AuthUser,
    @Body() body: DismissFoodMergeDto,
  ): Promise<void> {
    return this.merges.dismiss(user.id, body.key);
  }

  @Post('merge')
  @Throttle(FOOD_MERGE_THROTTLE)
  merge(
    @CurrentUser() user: AuthUser,
    @Body() body: MergeFoodsDto,
  ): Promise<MyFoodChangeResponse> {
    return this.merges.merge(user.id, body);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMyFoodDto,
  ): Promise<MyFoodChangeResponse> {
    return this.foods.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.foods.remove(user.id, id);
  }
}
