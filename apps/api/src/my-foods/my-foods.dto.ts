import {
  API_LIMITS,
  type DismissFoodMergeRequest,
  type MergeFoodsRequest,
  type Micros,
  type MyFoodsQuery,
  PORTION_UNIT_MAX,
  PRODUCT_SOURCES,
  type ProductSource,
  type SaveMyFoodRequest,
  type UpdateMyFoodRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  buildMessage,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { IsOptionalMicrosPer100, NutrientsDto } from '../common/dto.js';
import {
  hasNoNullCharacter,
  IsEntryName,
  IsOptionalSearchTerm,
  IsOptionalUuid,
} from '../entries/entry-validation.js';
import { BASIS_UNITS, type BasisUnit } from '../products/product-data.js';
import { IsOptionalAmount, IsOptionalBrand } from '../products/products.dto.js';

export const MY_FOOD_ALIASES_MAX = 20;
export const MERGE_NAMES_MAX = 20;
export const MY_FOOD_UNIT_GRAMS_MAX = 2000;

const FINITE_NUMBER = { allowNaN: false, allowInfinity: false } as const;

function trimEach(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((item: unknown) =>
        typeof item === 'string' ? item.trim() : item,
      )
    : value;
}

function trimToNull(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function everyHasNoNullCharacter(value: unknown): boolean {
  return !Array.isArray(value) || value.every(hasNoNullCharacter);
}

function IsNameList(minSize: number, maxSize: number): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => trimEach(value)),
    IsArray(),
    ArrayMinSize(minSize),
    ArrayMaxSize(maxSize),
    IsString({ each: true }),
    Length(1, API_LIMITS.nameMax, { each: true }),
    ValidateBy({
      name: 'hasNoNullCharacterInNames',
      validator: {
        validate: everyHasNoNullCharacter,
        defaultMessage: buildMessage(
          (each) => `${each}$property must not contain null characters`,
        ),
      },
    }),
  );
}

function IsOptionalAliases(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsNameList(0, MY_FOOD_ALIASES_MAX));
}

function IsOptionalUnitName(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => trimToNull(value)),
    IsOptional(),
    IsString(),
    Length(1, PORTION_UNIT_MAX),
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

function IsOptionalUnitGrams(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsNumber(FINITE_NUMBER),
    Min(0),
    Max(MY_FOOD_UNIT_GRAMS_MAX),
  );
}

function IsPer100(): PropertyDecorator {
  return applyDecorators(
    IsDefined(),
    ValidateNested(),
    Type(() => NutrientsDto),
  );
}

export class MyFoodsQueryDto implements MyFoodsQuery {
  @IsOptionalSearchTerm()
  q?: string;
}

export class SaveMyFoodDto implements SaveMyFoodRequest {
  @IsEntryName()
  name: string;

  @IsOptionalBrand()
  brand?: string | null;

  @IsOptionalAliases()
  aliases?: string[];

  @IsIn(BASIS_UNITS)
  basisUnit: BasisUnit;

  @IsPer100()
  per100: NutrientsDto;

  @IsOptionalMicrosPer100()
  microsPer100?: Micros | null;

  @IsOptionalUnitName()
  unitName?: string | null;

  @IsOptionalUnitGrams()
  unitGrams?: number | null;

  @IsOptionalAmount()
  servingSizeG?: number | null;

  @IsOptional()
  @IsIn(PRODUCT_SOURCES)
  source?: ProductSource;
}

export class UpdateMyFoodDto implements UpdateMyFoodRequest {
  @IsOptional()
  @IsEntryName()
  name?: string;

  @IsOptionalBrand()
  brand?: string | null;

  @IsOptionalAliases()
  aliases?: string[];

  @IsOptional()
  @IsIn(BASIS_UNITS)
  basisUnit?: BasisUnit;

  @IsOptional()
  @ValidateNested()
  @Type(() => NutrientsDto)
  per100?: NutrientsDto;

  @IsOptionalMicrosPer100()
  microsPer100?: Micros | null;

  @IsOptionalUnitName()
  unitName?: string | null;

  @IsOptionalUnitGrams()
  unitGrams?: number | null;

  @IsOptionalAmount()
  servingSizeG?: number | null;

  @IsOptional()
  @IsBoolean()
  applyToPast?: boolean;
}

export class MergeFoodsDto implements MergeFoodsRequest {
  @IsEntryName()
  key: string;

  @IsNameList(1, MERGE_NAMES_MAX)
  names: string[];

  @IsEntryName()
  name: string;

  @IsOptionalBrand()
  brand?: string | null;

  @IsIn(BASIS_UNITS)
  basisUnit: BasisUnit;

  @IsPer100()
  per100: NutrientsDto;

  @IsOptionalMicrosPer100()
  microsPer100?: Micros | null;

  @IsOptionalUuid()
  productId?: string | null;

  @IsOptional()
  @IsNameList(0, MERGE_NAMES_MAX)
  keptApart?: string[];

  @IsBoolean()
  applyToPast: boolean;
}

export class DismissFoodMergeDto implements DismissFoodMergeRequest {
  @IsEntryName()
  key: string;
}
