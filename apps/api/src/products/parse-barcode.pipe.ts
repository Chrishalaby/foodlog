import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { BARCODE_FORMAT_MESSAGE, checkBarcode } from './barcode.js';

@Injectable()
export class ParseBarcodePipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(BARCODE_FORMAT_MESSAGE);
    }
    const result = checkBarcode(value);
    if (!result.valid) {
      throw new BadRequestException(result.message);
    }
    return result.barcode;
  }
}
