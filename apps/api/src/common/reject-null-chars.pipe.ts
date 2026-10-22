import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

const MAX_DEPTH = 32;

export function containsNullChar(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') {
    return value.includes('\u0000');
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return false;
  }
  if (Buffer.isBuffer(value)) {
    return false;
  }
  const values = Array.isArray(value) ? value : Object.values(value);
  return values.some((item) => containsNullChar(item, depth + 1));
}

@Injectable()
export class RejectNullCharsPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') {
      return value;
    }
    if (containsNullChar(value)) {
      throw new BadRequestException('Text must not contain null characters');
    }
    return value;
  }
}
