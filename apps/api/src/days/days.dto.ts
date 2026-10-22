import type { UpdateDayMetaRequest } from '@food/shared';
import { IsBoolean } from 'class-validator';

export class UpdateDayMetaDto implements UpdateDayMetaRequest {
  @IsBoolean()
  trainingDay: boolean;
}
