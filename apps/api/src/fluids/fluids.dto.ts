import {
  type CreateFluidLogRequest,
  FLUID_KINDS,
  FLUID_LIMITS,
  type FluidKind,
  type UpdateFluidLogRequest,
} from '@food/shared';
import { applyDecorators } from '@nestjs/common';
import { IsIn, IsNumber, Max, Min, ValidateIf } from 'class-validator';
import { IsLocalDate } from '../common/dto.js';
import { IsEntryTimestamp } from '../entries/entry-validation.js';

function AllowAbsent(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

function IsFluidMl(): PropertyDecorator {
  return applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false }),
    Min(FLUID_LIMITS.logMinMl),
    Max(FLUID_LIMITS.logMaxMl),
  );
}

export class FluidDayQueryDto {
  @IsLocalDate()
  date: string;
}

export class CreateFluidLogDto implements CreateFluidLogRequest {
  @IsFluidMl()
  ml: number;

  @IsIn(FLUID_KINDS)
  kind: FluidKind;

  @IsEntryTimestamp()
  timestamp: string;

  @IsLocalDate()
  localDate: string;
}

export class UpdateFluidLogDto implements UpdateFluidLogRequest {
  @AllowAbsent()
  @IsFluidMl()
  ml?: number;

  @AllowAbsent()
  @IsIn(FLUID_KINDS)
  kind?: FluidKind;

  @AllowAbsent()
  @IsEntryTimestamp()
  timestamp?: string;

  @AllowAbsent()
  @IsLocalDate()
  localDate?: string;
}
