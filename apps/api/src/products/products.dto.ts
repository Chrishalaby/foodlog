import {
  API_LIMITS,
  type LogProductRequest,
  MAX_ITEM_GRAMS,
  MEAL_TYPES,
  type MealType,
  type Micros,
  PRODUCT_SOURCES,
  type ProductSource,
  type UpsertProductRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  buildMessage,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  IsLocalDate,
  IsOptionalMicrosPer100,
  NutrientsDto,
  Trim,
} from '../common/dto.js';
import {
  hasNoNullCharacter,
  IsEntryName,
  IsEntryTimestamp,
  IsOptionalEntryDescription,
  IsOptionalUuid,
} from '../entries/entry-validation.js';
import { BASIS_UNITS, type BasisUnit } from './product-data.js';

export const PRODUCT_AMOUNT_MIN = 0.1;

const FINITE_NUMBER = { allowNaN: false, allowInfinity: false } as const;

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function IsOptionalAmount(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_dto: object, value: unknown) => isPresent(value)),
    IsNumber(FINITE_NUMBER),
    Min(PRODUCT_AMOUNT_MIN),
    Max(MAX_ITEM_GRAMS),
  );
}

export function IsOptionalBrand(): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_dto: object, value: unknown) => isPresent(value)),
    Trim(),
    IsString(),
    MaxLength(API_LIMITS.nameMax),
    ValidateBy({
      name: 'hasNoNullCharacter',
      validator: {
        validate: hasNoNullCharacter,
        defaultMessage: buildMessage(
          (each) => `${each}$property must not contain null characters`,
        ),
      },
    }),
  );
}

function IsExclusiveWith(other: string): PropertyDecorator {
  return ValidateBy({
    name: 'isExclusiveWith',
    validator: {
      validate: (value: unknown, args): boolean => {
        const dto = args?.object as Record<string, unknown> | undefined;
        return !isPresent(value) || !isPresent(dto?.[other]);
      },
      defaultMessage: buildMessage(
        (each) => `${each}$property and ${other} cannot both be set`,
      ),
    },
  });
}

export class UpsertProductDto implements UpsertProductRequest {
  @IsEntryName()
  name: string;

  @IsOptionalBrand()
  brand?: string | null;

  @IsIn(BASIS_UNITS)
  basisUnit: BasisUnit;

  @IsDefined()
  @ValidateNested()
  @Type(() => NutrientsDto)
  per100: NutrientsDto;

  @IsOptionalMicrosPer100()
  microsPer100?: Micros | null;

  @IsOptionalAmount()
  servingSizeG?: number | null;

  @IsOptionalAmount()
  packSizeG?: number | null;

  @IsIn(PRODUCT_SOURCES)
  source: ProductSource;
}

export class LogProductDto implements LogProductRequest {
  @IsOptional()
  @IsNumber(FINITE_NUMBER)
  @Min(PRODUCT_AMOUNT_MIN)
  @Max(MAX_ITEM_GRAMS)
  @IsExclusiveWith('servings')
  grams?: number;

  @IsOptional()
  @IsNumber(FINITE_NUMBER)
  @Min(API_LIMITS.favoriteServingsMin)
  @Max(API_LIMITS.favoriteServingsMax)
  servings?: number;

  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;

  @IsIn(MEAL_TYPES)
  mealType: MealType;

  @IsOptionalUuid()
  analysisId?: string | null;

  @IsOptionalUuid()
  photoId?: string | null;

  @IsOptionalEntryDescription()
  description?: string | null;
}
