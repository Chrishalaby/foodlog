import {
  API_LIMITS,
  type CreateEntryRequest,
  type DuplicateEntryRequest,
  ENTRY_SOURCES,
  type EntryListQuery,
  type EntrySource,
  MEAL_TYPES,
  type MealType,
  type UpdateEntryRequest,
} from '@food/shared';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EntryItemInputDto,
  IsLocalDate,
  IsOptionalPortion,
  PortionDto,
} from '../common/dto.js';
import { ENTRY_CURSOR_MAX_LENGTH } from './entry-cursor.js';
import {
  IsEntryItemList,
  IsEntryName,
  IsEntryTimestamp,
  IsOptionalEntryDescription,
  IsOptionalSearchTerm,
  IsOptionalUuid,
} from './entry-validation.js';

export class CreateEntryDto implements CreateEntryRequest {
  @IsEntryName()
  name: string;

  @IsOptionalEntryDescription()
  description?: string | null;

  @IsIn(MEAL_TYPES)
  mealType: MealType;

  @IsIn(ENTRY_SOURCES)
  source: EntrySource;

  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;

  @IsEntryItemList()
  items: EntryItemInputDto[];

  @IsOptionalUuid()
  analysisId?: string | null;

  @IsOptionalUuid()
  photoId?: string | null;

  @IsOptionalUuid()
  coverPhotoId?: string | null;

  @IsOptionalPortion()
  portion?: PortionDto | null;
}

export class UpdateEntryDto implements UpdateEntryRequest {
  @IsEntryName()
  name: string;

  @IsOptionalEntryDescription()
  description?: string | null;

  @IsIn(MEAL_TYPES)
  mealType: MealType;

  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;

  @IsEntryItemList()
  items: EntryItemInputDto[];

  @IsOptionalUuid()
  coverPhotoId?: string;

  @IsOptionalPortion()
  portion?: PortionDto | null;
}

export class DuplicateEntryDto implements DuplicateEntryRequest {
  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;

  @IsOptional()
  @IsIn(MEAL_TYPES)
  mealType?: MealType;
}

export class EntryListQueryDto implements EntryListQuery {
  @IsOptional()
  @IsLocalDate()
  from?: string;

  @IsOptional()
  @IsLocalDate()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ENTRY_CURSOR_MAX_LENGTH)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_LIMITS.historyPageMax)
  limit?: number;

  @IsOptionalSearchTerm()
  q?: string;
}
