import { isValidLocalDate } from '@food/shared';
import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

@Injectable()
export class ParseLocalDatePipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isValidLocalDate(value)) {
      throw new BadRequestException(
        'date must be a valid date formatted as YYYY-MM-DD',
      );
    }
    return value;
  }
}
