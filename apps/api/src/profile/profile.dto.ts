import {
  ACTIVITY_LEVELS,
  type ActivityLevel,
  API_LIMITS,
  BODY_BOUNDS,
  DAY_START_HOURS,
  DEFAULT_DAY_START_HOUR,
  FLUID_LIMITS,
  GOALS,
  type Goal,
  IMAGE_DETAILS,
  type ImageDetail,
  SEXES,
  type Sex,
  type TargetOverrides,
  THEMES,
  type ThemePreference,
  type UpdateProfileRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { targetOverrideProblems } from './target-overrides.js';

export const AI_MODEL_MAX_LENGTH = 100;

export const DAY_START_HOUR = {
  min: Math.min(...DAY_START_HOURS),
  max: Math.max(...DAY_START_HOURS),
  default: DEFAULT_DAY_START_HOUR,
} as const;

function AllowNull(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== null);
}

function AllowAbsent(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

function AllowAbsentOrNull(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value != null);
}

function TrimToNull(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });
}

function NumberBetween(min: number, max: number): PropertyDecorator {
  return applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false }),
    Min(min),
    Max(max),
  );
}

function NullableNumberBetween(min: number, max: number): PropertyDecorator {
  return applyDecorators(AllowNull(), NumberBetween(min, max));
}

function IntegerBetween(min: number, max: number): PropertyDecorator {
  return applyDecorators(IsInt(), Min(min), Max(max));
}

function IsTargetOverrides(): PropertyDecorator {
  return ValidateBy({
    name: 'isTargetOverrides',
    validator: {
      validate: (value: unknown): boolean =>
        targetOverrideProblems(value).length === 0,
      defaultMessage: (args?: ValidationArguments): string =>
        targetOverrideProblems(args?.value).join('; '),
    },
  });
}

export class UpdateProfileDto implements UpdateProfileRequest {
  @NullableNumberBetween(BODY_BOUNDS.weightKg.min, BODY_BOUNDS.weightKg.max)
  weightKg: number | null;

  @NullableNumberBetween(BODY_BOUNDS.heightCm.min, BODY_BOUNDS.heightCm.max)
  heightCm: number | null;

  @AllowNull()
  @IntegerBetween(BODY_BOUNDS.age.min, BODY_BOUNDS.age.max)
  age: number | null;

  @AllowNull()
  @IsIn(SEXES)
  sex: Sex | null;

  @AllowAbsentOrNull()
  @NumberBetween(BODY_BOUNDS.bodyFatPct.min, BODY_BOUNDS.bodyFatPct.max)
  bodyFatPct?: number | null;

  @AllowAbsentOrNull()
  @IntegerBetween(BODY_BOUNDS.tdeeOverride.min, BODY_BOUNDS.tdeeOverride.max)
  tdeeOverride?: number | null;

  @AllowAbsent()
  @IsBoolean()
  onboarded?: boolean;

  @IsIn(ACTIVITY_LEVELS)
  activityLevel: ActivityLevel;

  @IsIn(GOALS)
  goal: Goal;

  @IntegerBetween(
    BODY_BOUNDS.trainingDaysPerWeek.min,
    BODY_BOUNDS.trainingDaysPerWeek.max,
  )
  trainingDaysPerWeek: number;

  @IsTargetOverrides()
  targetOverrides: TargetOverrides;

  @TrimToNull()
  @AllowNull()
  @IsString()
  @MaxLength(API_LIMITS.locationMax)
  location: string | null;

  @TrimToNull()
  @AllowNull()
  @IsString()
  @MaxLength(AI_MODEL_MAX_LENGTH)
  aiModel: string | null;

  @IsIn(IMAGE_DETAILS)
  aiDetailFood: ImageDetail;

  @IsIn(IMAGE_DETAILS)
  aiDetailLabel: ImageDetail;

  @IsIn(THEMES)
  theme: ThemePreference;

  @AllowAbsent()
  @IntegerBetween(DAY_START_HOUR.min, DAY_START_HOUR.max)
  dayStartHour?: number;

  @AllowAbsentOrNull()
  @IntegerBetween(FLUID_LIMITS.targetMinMl, FLUID_LIMITS.targetMaxMl)
  fluidTargetMl?: number | null;
}
