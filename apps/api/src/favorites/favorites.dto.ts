import {
  API_LIMITS,
  type CreateFavoriteFromEntryRequest,
  type CreateFavoriteRequest,
  type LogFavoriteRequest,
  MEAL_TYPES,
  type MealType,
  type UpdateFavoriteRequest,
} from '@food/shared';
import {
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  EntryItemInputDto,
  IsLocalDate,
  IsOptionalPortion,
  PortionDto,
} from '../common/dto.js';
import {
  IsEntryItemList,
  IsEntryName,
  IsEntryTimestamp,
  IsOptionalUuid,
} from '../entries/entry-validation.js';

export class CreateFavoriteDto implements CreateFavoriteRequest {
  @IsEntryName()
  name: string;

  @IsOptional()
  @IsIn(MEAL_TYPES)
  mealType?: MealType | null;

  @IsEntryItemList()
  items: EntryItemInputDto[];

  @IsOptionalPortion()
  portion?: PortionDto | null;

  @IsOptionalUuid()
  photoId?: string | null;
}

export class CreateFavoriteFromEntryDto implements CreateFavoriteFromEntryRequest {
  @IsOptional()
  @IsEntryName()
  name?: string;
}

export class UpdateFavoriteDto implements UpdateFavoriteRequest {
  @IsEntryName()
  name: string;

  @ValidateIf((_dto: object, value: unknown) => value !== null)
  @IsIn(MEAL_TYPES)
  mealType: MealType | null;

  @IsEntryItemList()
  items: EntryItemInputDto[];

  @IsOptionalPortion()
  portion?: PortionDto | null;
}

export class LogFavoriteDto implements LogFavoriteRequest {
  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;

  @IsIn(MEAL_TYPES)
  mealType: MealType;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(API_LIMITS.favoriteServingsMin)
  @Max(API_LIMITS.favoriteServingsMax)
  servings?: number;
}
