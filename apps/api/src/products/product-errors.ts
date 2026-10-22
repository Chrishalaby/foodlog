import { NotFoundException } from '@nestjs/common';

export function productNotFound(): NotFoundException {
  return new NotFoundException('Product not found');
}
