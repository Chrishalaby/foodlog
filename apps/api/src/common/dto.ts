import {
  API_LIMITS,
  CONFIDENCE_LEVELS,
  type Confidence,
  type EntryItemInput,
  isValidLocalDate,
  MAX_ITEM_GRAMS,
  type Micros,
  NUTRIENT_META,
  type NutrientKey,
  type Nutrients,
  type Portion,
  PORTION_COUNT_MAX,
  PORTION_UNIT_MAX,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  buildMessage,
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';
import {
  FLUID_ITEM_MAX_ML,
  ITEM_MICROS_CEILING,
  type MicrosCeiling,
  microsProblems,
  PER100_MICROS_CEILING,
} from './micros.js';
import { PORTION_COUNT_MIN } from './portions.js';

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

const MIN_STORABLE_MS = Date.parse('0001-01-01T00:00:00.000Z');
const MAX_STORABLE_MS = Date.parse('9999-12-31T23:59:59.999Z');

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && ms >= MIN_STORABLE_MS && ms <= MAX_STORABLE_MS;
}

export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

export function IsLocalDate(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isLocalDate',
      validator: {
        validate: (value: unknown): boolean => isValidLocalDate(value),
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be a valid date formatted as YYYY-MM-DD`,
          options,
        ),
      },
    },
    options,
  );
}

export function IsIsoTimestamp(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIsoTimestamp',
      validator: {
        validate: (value: unknown): boolean => isIsoTimestamp(value),
        defaultMessage: buildMessage(
          (each) =>
            `${each}$property must be an ISO 8601 timestamp with a time zone offset`,
          options,
        ),
      },
    },
    options,
  );
}

function IsFiniteNumber(): PropertyDecorator {
  return IsNumber({ allowNaN: false, allowInfinity: false });
}

function PortionCount(): PropertyDecorator {
  return applyDecorators(
    IsFiniteNumber(),
    Min(PORTION_COUNT_MIN),
    Max(PORTION_COUNT_MAX),
  );
}

function PortionUnit(): PropertyDecorator {
  return applyDecorators(Trim(), IsString(), Length(1, PORTION_UNIT_MAX));
}

function isPresent(value: unknown): boolean {
  return typeof value === 'string'
    ? value.trim() !== ''
    : value !== null && value !== undefined;
}

function hasItemCount(item: { count?: unknown; unit?: unknown }): boolean {
  return isPresent(item.count) || isPresent(item.unit);
}

function WhenItemCounted(): PropertyDecorator {
  return ValidateIf((item: EntryItemInputDto) => hasItemCount(item));
}

export class PortionDto implements Portion {
  @PortionCount()
  count: number;

  @PortionUnit()
  unit: string;

  @PortionUnit()
  unitPlural: string;
}

export function IsOptionalPortion(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsObject(),
    ValidateNested(),
    Type(() => PortionDto),
  );
}

function NutrientValue(key: NutrientKey): PropertyDecorator {
  return applyDecorators(IsFiniteNumber(), Min(0), Max(NUTRIENT_META[key].max));
}

function IsMicros(name: string, ceiling: MicrosCeiling): PropertyDecorator {
  return ValidateBy({
    name,
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean =>
        microsProblems(args?.property ?? '', value, ceiling).length === 0,
      defaultMessage: (args?: ValidationArguments): string =>
        microsProblems(args?.property ?? '', args?.value, ceiling).join('; '),
    },
  });
}

export function IsOptionalMicros(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsMicros('isMicros', ITEM_MICROS_CEILING),
  );
}

export function IsOptionalMicrosPer100(): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsMicros('isMicrosPer100', PER100_MICROS_CEILING),
  );
}

export class NutrientsDto implements Nutrients {
  @NutrientValue('calories')
  calories: number;

  @NutrientValue('protein')
  protein: number;

  @NutrientValue('carbs')
  carbs: number;

  @NutrientValue('fat')
  fat: number;

  @NutrientValue('satFat')
  satFat: number;

  @NutrientValue('fiber')
  fiber: number;

  @NutrientValue('sugar')
  sugar: number;

  @NutrientValue('sodium')
  sodium: number;

  @NutrientValue('alcohol')
  alcohol: number;
}

export class EntryItemInputDto implements EntryItemInput {
  @Trim()
  @IsString()
  @Length(1, API_LIMITS.nameMax)
  name: string;

  @IsFiniteNumber()
  @Min(0)
  @Max(MAX_ITEM_GRAMS)
  grams: number;

  @IsDefined()
  @ValidateNested()
  @Type(() => NutrientsDto)
  nutrients: NutrientsDto;

  @IsOptional()
  @IsIn(CONFIDENCE_LEVELS)
  confidence?: Confidence | null;

  @WhenItemCounted()
  @PortionCount()
  count?: number | null;

  @WhenItemCounted()
  @PortionUnit()
  unit?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PORTION_UNIT_MAX)
  unitPlural?: string | null;

  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @IsOptionalMicros()
  micros?: Micros | null;

  @IsOptional()
  @IsFiniteNumber()
  @Min(0)
  @Max(FLUID_ITEM_MAX_ML)
  fluidMl?: number | null;
}

export function IsEntryItems(): PropertyDecorator {
  return applyDecorators(
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(API_LIMITS.itemsMax),
    ValidateNested({ each: true }),
    Type(() => EntryItemInputDto),
  );
}
