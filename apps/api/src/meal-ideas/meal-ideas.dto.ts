import { API_LIMITS, type MealIdeasRequest } from '@food/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsLocalTime } from '../ai/analyze.dto.js';
import { IsLocalDate, Trim } from '../common/dto.js';

export class MealIdeasDto implements MealIdeasRequest {
  @IsLocalDate()
  localDate: string;

  @IsLocalTime()
  localTime: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(API_LIMITS.mealIdeaNoteMax)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_LIMITS.mealIdeaExcludeMax)
  @IsString({ each: true })
  @MaxLength(API_LIMITS.nameMax, { each: true })
  exclude?: string[];
}
