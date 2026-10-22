import type { MealIdeasResponse } from '@food/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AiThrottlerGuard } from '../common/throttling.js';
import { MealIdeasDto } from './meal-ideas.dto.js';
import { MealIdeasService } from './meal-ideas.service.js';

@Controller('meal-ideas')
export class MealIdeasController {
  constructor(private readonly ideas: MealIdeasService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AiThrottlerGuard)
  suggest(
    @CurrentUser() user: AuthUser,
    @Body() body: MealIdeasDto,
  ): Promise<MealIdeasResponse> {
    return this.ideas.suggest(user.id, body);
  }
}
