import { NotFoundException } from '@nestjs/common';

export function entryNotFound(): NotFoundException {
  return new NotFoundException('Entry not found');
}
