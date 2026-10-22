import {
  API_LIMITS,
  FOOD_SEARCH_SCOPES,
  type FoodRenameRequest,
  type FoodSearchQuery,
  type FoodSearchScope,
  type HideFoodRequest,
  MAX_ITEM_GRAMS,
  MEAL_TYPES,
  type MealType,
  PORTION_COUNT_MAX,
  type QuickLogRequest,
} from '@food/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsLocalDate, Trim } from '../common/dto.js';
import { PORTION_COUNT_MIN } from '../common/portions.js';
import { IsEntryName, IsEntryTimestamp } from '../entries/entry-validation.js';
import { FOOD_KEY_MESSAGE, FOOD_KEY_PATTERN } from './food-key.js';

export const DEFAULT_FOOD_SEARCH_LIMIT = 20;
export const QUICK_LOG_GRAMS_MIN = 0.1;

const FINITE_NUMBER = { allowNaN: false, allowInfinity: false } as const;

export class FoodSearchQueryDto implements FoodSearchQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(API_LIMITS.foodQueryMax)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_LIMITS.foodSearchMax)
  limit?: number;

  @IsOptional()
  @IsIn(FOOD_SEARCH_SCOPES)
  scope?: FoodSearchScope;
}

export class QuickLogDto implements QuickLogRequest {
  @IsString()
  @Matches(FOOD_KEY_PATTERN, { message: FOOD_KEY_MESSAGE })
  key: string;

  @IsOptional()
  @IsNumber(FINITE_NUMBER)
  @Min(API_LIMITS.favoriteServingsMin)
  @Max(API_LIMITS.favoriteServingsMax)
  servings?: number;

  @IsOptional()
  @IsNumber(FINITE_NUMBER)
  @Min(QUICK_LOG_GRAMS_MIN)
  @Max(MAX_ITEM_GRAMS)
  grams?: number;

  @IsOptional()
  @IsNumber(FINITE_NUMBER)
  @Min(PORTION_COUNT_MIN)
  @Max(PORTION_COUNT_MAX)
  portionCount?: number;

  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;

  @IsIn(MEAL_TYPES)
  mealType: MealType;
}

export class FoodRenameDto implements FoodRenameRequest {
  @IsEntryName()
  from: string;

  @IsEntryName()
  to: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class HideFoodDto implements HideFoodRequest {
  @IsEntryName()
  name: string;
}

export class HiddenFoodQueryDto {
  @IsEntryName()
  name: string;
}
