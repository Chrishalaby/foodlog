import type { DemoStartRequest } from '@food/shared';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { IsLocalDate } from '../common/dto.js';

export const UTC_OFFSET_MINUTES_MAX = 14 * 60;

export class DemoStartDto implements DemoStartRequest {
  @IsLocalDate()
  localDate: string;

  @Type(() => Number)
  @IsInt()
  @Min(-UTC_OFFSET_MINUTES_MAX)
  @Max(UTC_OFFSET_MINUTES_MAX)
  utcOffsetMinutes: number;
}
