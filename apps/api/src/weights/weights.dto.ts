import {
  addDays,
  BODY_BOUNDS,
  diffDays,
  isValidLocalDate,
  type UpsertWeightRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import {
  IsNumber,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { IsLocalDate } from '../common/dto.js';

export const WEIGHT_RANGE_MAX_DAYS = 400;
export const FUTURE_WEIGH_IN_MESSAGE = 'date must not be in the future';

export function latestLocalDate(now: Date): string {
  return addDays(now.toISOString().slice(0, 10), 1);
}

export function isFutureWeighIn(date: string, now: Date): boolean {
  return date > latestLocalDate(now);
}

export function weightRangeProblem(from: unknown, to: unknown): string | null {
  if (!isValidLocalDate(from) || !isValidLocalDate(to)) {
    return null;
  }
  const days = diffDays(from, to) + 1;
  if (days < 1) {
    return 'to must be on or after from';
  }
  if (days > WEIGHT_RANGE_MAX_DAYS) {
    return `the range from..to must span at most ${WEIGHT_RANGE_MAX_DAYS} days`;
  }
  return null;
}

function rangeStart(args: ValidationArguments | undefined): unknown {
  return (args?.object as { from?: unknown } | undefined)?.from;
}

function IsWeightRangeEnd(): PropertyDecorator {
  return ValidateBy({
    name: 'isWeightRangeEnd',
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean =>
        weightRangeProblem(rangeStart(args), value) === null,
      defaultMessage: (args?: ValidationArguments): string =>
        weightRangeProblem(rangeStart(args), args?.value) ??
        'invalid date range',
    },
  });
}

function FiniteNumberBetween(min: number, max: number): PropertyDecorator {
  return applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false }),
    Min(min),
    Max(max),
  );
}

export class WeightsQueryDto {
  @IsLocalDate()
  from: string;

  @IsLocalDate()
  @IsWeightRangeEnd()
  to: string;
}

export class WeightDateParamDto {
  @IsLocalDate()
  date: string;
}

export class UpsertWeightDto implements UpsertWeightRequest {
  @FiniteNumberBetween(BODY_BOUNDS.weightKg.min, BODY_BOUNDS.weightKg.max)
  weightKg: number;

  @ValidateIf((_object: object, value: unknown) => value != null)
  @FiniteNumberBetween(BODY_BOUNDS.bodyFatPct.min, BODY_BOUNDS.bodyFatPct.max)
  bodyFatPct?: number | null;
}
