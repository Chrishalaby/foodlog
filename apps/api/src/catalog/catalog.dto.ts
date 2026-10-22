import {
  API_LIMITS,
  CATALOG_GROUPS,
  type CatalogGroup,
  type CatalogSearchQuery,
} from '@food/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Trim } from '../common/dto.js';

export class CatalogSearchQueryDto implements CatalogSearchQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(API_LIMITS.foodQueryMax)
  q?: string;

  @IsOptional()
  @IsIn(CATALOG_GROUPS)
  group?: CatalogGroup;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_LIMITS.catalogSearchMax)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(API_LIMITS.catalogOffsetMax)
  offset?: number;
}
