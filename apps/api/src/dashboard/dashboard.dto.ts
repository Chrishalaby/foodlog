import { API_LIMITS, diffDays, isValidLocalDate } from '@food/shared';
import {
  ValidateBy,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { IsLocalDate } from '../common/dto.js';

export function rangeDayCount(from: string, to: string): number {
  return diffDays(from, to) + 1;
}

function rangeProblem(
  from: unknown,
  to: unknown,
  maxDays: number,
): string | null {
  if (!isValidLocalDate(from) || !isValidLocalDate(to)) {
    return null;
  }
  const days = rangeDayCount(from, to);
  if (days < 1) {
    return 'to must be on or after from';
  }
  if (days > maxDays) {
    return `the range from..to must span at most ${maxDays} days`;
  }
  return null;
}

function IsRangeEnd(
  startProperty: string,
  maxDays: number,
  options?: ValidationOptions,
): PropertyDecorator {
  const startOf = (args: ValidationArguments | undefined): unknown =>
    (args?.object as Record<string, unknown> | undefined)?.[startProperty];
  return ValidateBy(
    {
      name: 'isRangeEnd',
      constraints: [startProperty, maxDays],
      validator: {
        validate: (value: unknown, args?: ValidationArguments): boolean =>
          rangeProblem(startOf(args), value, maxDays) === null,
        defaultMessage: (args?: ValidationArguments): string =>
          rangeProblem(startOf(args), args?.value, maxDays) ??
          'invalid date range',
      },
    },
    options,
  );
}

export class DayDashboardQueryDto {
  @IsLocalDate()
  date: string;
}

export class RangeDashboardQueryDto {
  @IsLocalDate()
  from: string;

  @IsLocalDate()
  @IsRangeEnd('from', API_LIMITS.rangeMaxDays)
  to: string;
}
