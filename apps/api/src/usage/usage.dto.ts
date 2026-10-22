import { IsOptional, Matches } from 'class-validator';
import { MONTH_PATTERN } from './usage-period.js';

export class UsageQueryDto {
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: 'month must be formatted as YYYY-MM' })
  month?: string;
}
