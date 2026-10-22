import {
  API_LIMITS,
  BODY_BOUNDS,
  FLUID_KINDS,
  FLUID_LIMITS,
  type FluidKind,
  IMPORT_SOURCES,
  type ImportBatchRequest,
  type ImportEntryInput,
  type ImportFluidInput,
  type ImportSource,
  type ImportWeightInput,
  MEAL_TYPES,
  type MealType,
} from '@food/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
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
  IsOptionalEntryDescription,
} from '../entries/entry-validation.js';

const FINITE = { allowNaN: false, allowInfinity: false } as const;

export class ImportEntryDto implements ImportEntryInput {
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

  @IsOptionalPortion()
  portion?: PortionDto | null;
}

export class ImportWeightDto implements ImportWeightInput {
  @IsLocalDate()
  date: string;

  @IsNumber(FINITE)
  @Min(BODY_BOUNDS.weightKg.min)
  @Max(BODY_BOUNDS.weightKg.max)
  weightKg: number;

  @IsOptional()
  @ValidateIf((_object: object, value: unknown) => value !== null)
  @IsNumber(FINITE)
  @Min(BODY_BOUNDS.bodyFatPct.min)
  @Max(BODY_BOUNDS.bodyFatPct.max)
  bodyFatPct?: number | null;
}

export class ImportFluidDto implements ImportFluidInput {
  @IsLocalDate()
  localDate: string;

  @IsEntryTimestamp()
  timestamp: string;

  @IsNumber(FINITE)
  @Min(FLUID_LIMITS.logMinMl)
  @Max(FLUID_LIMITS.logMaxMl)
  ml: number;

  @IsIn(FLUID_KINDS)
  kind: FluidKind;
}

export class ImportBatchDto implements ImportBatchRequest {
  @IsIn(IMPORT_SOURCES)
  source: ImportSource;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_LIMITS.importEntriesMax)
  @ValidateNested({ each: true })
  @Type(() => ImportEntryDto)
  entries?: ImportEntryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_LIMITS.importWeightsMax)
  @ValidateNested({ each: true })
  @Type(() => ImportWeightDto)
  weights?: ImportWeightDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_LIMITS.importFluidsMax)
  @ValidateNested({ each: true })
  @Type(() => ImportFluidDto)
  fluids?: ImportFluidDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(API_LIMITS.importTrainingDaysMax)
  @IsLocalDate({ each: true })
  trainingDays?: string[];
}
