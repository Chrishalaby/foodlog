import { API_LIMITS, type MenuScanFields } from '@food/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IMAGE_ROLES_MAX_LENGTH } from '../ai/analyze-uploads.js';
import { Trim } from '../common/dto.js';

export class MenuScanDto implements MenuScanFields {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(API_LIMITS.descriptionMax)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(IMAGE_ROLES_MAX_LENGTH)
  imageRoles?: string;
}
