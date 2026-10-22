import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { IsLocalDate } from '../common/dto.js';

export const INSIGHT_WINDOW = { min: 7, max: 90, default: 7 } as const;

export class InsightsQueryDto {
  @IsOptional()
  @IsLocalDate()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(INSIGHT_WINDOW.min)
  @Max(INSIGHT_WINDOW.max)
  days?: number;
}
