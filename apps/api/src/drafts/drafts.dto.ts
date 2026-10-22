import {
  ANALYSIS_MODES,
  type AnalysisMode,
  API_LIMITS,
  type CreateDraftFields,
  type LogDraftRequest,
  MEAL_TYPES,
  type MealType,
  type UpdateDraftRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { plainToInstance, Transform } from 'class-transformer';
import {
  buildMessage,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { IsImageRoleList } from '../ai/analyze.dto.js';
import {
  EntryItemInputDto,
  IsLocalDate,
  IsOptionalPortion,
  PortionDto,
  Trim,
} from '../common/dto.js';
import {
  hasNoNullCharacter,
  IsEntryItemList,
  IsEntryName,
  IsEntryTimestamp,
  IsOptionalEntryDescription,
} from '../entries/entry-validation.js';

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function parseItemsField(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? plainToInstance(EntryItemInputDto, parsed as object[])
    : parsed;
}

function ItemsFromJson(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => parseItemsField(value));
}

function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePortionField(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.trim() === '') {
    return undefined;
  }
  const parsed = parseJson(value);
  return isPlainObject(parsed) ? plainToInstance(PortionDto, parsed) : parsed;
}

function PortionFromJson(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => parsePortionField(value));
}

function HasNoNullCharacter(): PropertyDecorator {
  return ValidateBy({
    name: 'hasNoNullCharacter',
    validator: {
      validate: hasNoNullCharacter,
      defaultMessage: buildMessage(
        (each) => `${each}$property must not contain null characters`,
      ),
    },
  });
}

function IsOptionalDraftName(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    Trim(),
    IsString(),
    MaxLength(API_LIMITS.nameMax),
    HasNoNullCharacter(),
  );
}

function IsDefinedWhenPresent(): PropertyDecorator {
  return ValidateIf((_dto: object, value: unknown) => value !== undefined);
}

export class CreateDraftDto implements Omit<
  CreateDraftFields,
  'items' | 'portion'
> {
  @IsIn(ANALYSIS_MODES)
  mode: AnalysisMode;

  @PortionFromJson()
  @IsOptionalPortion()
  portion?: PortionDto | null;

  @IsOptionalDraftName()
  name?: string;

  @IsOptionalEntryDescription()
  description?: string;

  @IsOptional()
  @IsIn(MEAL_TYPES)
  mealType?: MealType;

  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;

  @IsOptional()
  @IsUUID()
  analysisId?: string;

  @IsOptional()
  @ItemsFromJson()
  @IsEntryItemList()
  items?: EntryItemInputDto[];

  @IsOptional()
  @IsImageRoleList()
  imageRoles?: string;
}

export class UpdateDraftDto implements UpdateDraftRequest {
  @IsOptionalPortion()
  portion?: PortionDto | null;

  @IsOptionalDraftName()
  name?: string | null;

  @IsOptionalEntryDescription()
  description?: string | null;

  @IsOptional()
  @IsIn(MEAL_TYPES)
  mealType?: MealType | null;

  @IsDefinedWhenPresent()
  @IsEntryTimestamp()
  timestamp?: string;

  @IsDefinedWhenPresent()
  @IsLocalDate()
  localDate?: string;

  @IsOptional()
  @IsEntryItemList()
  items?: EntryItemInputDto[] | null;

  @IsOptional()
  @IsUUID()
  analysisId?: string | null;
}

export class LogDraftDto implements LogDraftRequest {
  @IsOptionalPortion()
  portion?: PortionDto | null;

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
}
