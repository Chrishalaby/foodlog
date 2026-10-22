import { EXPORT_FORMATS, type ExportFormat } from '@food/shared';
import { IsIn, IsOptional } from 'class-validator';

export class ExportQueryDto {
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format?: ExportFormat;
}
