import type { EntryDto, EntrySource, MealType } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { toEntryDto } from '../common/mappers.js';
import { createLinkedEntry } from '../entries/entry-create.js';
import { blankToNull } from '../entries/entry-data.js';
import { resolveEntryOrigin } from '../entries/entry-origin.js';
import type { Product } from '../generated/prisma/client.js';
import { PhotosService } from '../photos/photos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { productNotFound } from './product-errors.js';
import {
  type ProductAmount,
  productLogGrams,
  productLogItem,
} from './product-log.js';

export interface ProductLogRequest {
  amount: ProductAmount;
  timestamp: string;
  localDate: string;
  mealType: MealType;
  analysisId?: string | null;
  photoId?: string | null;
  description?: string | null;
}

export function productEntrySource(
  product: Pick<Product, 'barcode'>,
): EntrySource {
  return product.barcode ? 'barcode' : 'copy';
}

@Injectable()
export class ProductLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  async log(
    userId: string,
    productId: string,
    request: ProductLogRequest,
  ): Promise<EntryDto> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, userId },
    });
    if (!product) {
      throw productNotFound();
    }
    const source = productEntrySource(product);
    const origin = await resolveEntryOrigin(
      this.prisma,
      this.photos,
      userId,
      request,
      source,
    );
    const entry = await this.prisma.$transaction(async (tx) => {
      const item = productLogItem(
        product,
        productLogGrams(product, request.amount),
      );
      return createLinkedEntry(
        tx,
        {
          userId,
          name: item.name,
          description: blankToNull(request.description),
          mealType: request.mealType,
          source,
          timestamp: new Date(request.timestamp),
          localDate: request.localDate,
          items: [item],
          ...origin,
          favoriteId: null,
        },
        { productId: product.id },
      );
    });
    return toEntryDto(entry);
  }
}
