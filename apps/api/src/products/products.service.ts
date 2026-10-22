import {
  type BarcodeLookupResponse,
  type ProductDto,
  sanitizeNutrients,
} from '@food/shared';
import { Injectable } from '@nestjs/common';
import { per100Micros } from '../common/micros.js';
import { blankToNull } from '../entries/entry-data.js';
import type { Product } from '../generated/prisma/client.js';
import { unlinkSavedFoodCopies } from '../my-foods/saved-food-apply.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OpenFoodFactsClient } from './open-food-facts.client.js';
import type { OffProduct } from './open-food-facts.mapper.js';
import { productNotFound } from './product-errors.js';
import {
  correctedMissingNutrients,
  PRODUCT_ORDER,
  productColumns,
  type ProductFields,
  toProductDto,
} from './product-data.js';
import type { UpsertProductDto } from './products.dto.js';
import { retryOnUniqueViolation } from './unique-retry.js';

function upsertFields(
  dto: UpsertProductDto,
  existing: Product | null,
): ProductFields {
  const per100 = sanitizeNutrients(dto.per100);
  return {
    name: dto.name,
    brand: blankToNull(dto.brand),
    basisUnit: dto.basisUnit,
    per100,
    microsPer100:
      dto.microsPer100 === undefined
        ? undefined
        : per100Micros(dto.microsPer100),
    servingSizeG: dto.servingSizeG ?? null,
    packSizeG: dto.packSizeG ?? null,
    source: dto.source,
    missingNutrients: correctedMissingNutrients(existing, dto.source, per100),
  };
}

function offFields(product: OffProduct): ProductFields {
  return {
    name: product.name,
    brand: product.brand,
    basisUnit: product.basisUnit,
    per100: product.per100,
    microsPer100: product.microsPer100,
    servingSizeG: product.servingSizeG,
    packSizeG: product.packSizeG,
    source: 'openfoodfacts',
    missingNutrients: product.missingNutrients,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openFoodFacts: OpenFoodFactsClient,
  ) {}

  async lookup(
    userId: string,
    barcode: string,
  ): Promise<BarcodeLookupResponse> {
    const own = await this.findByBarcode(userId, barcode);
    if (own) {
      return { barcode, source: 'library', product: toProductDto(own) };
    }
    const found = await this.openFoodFacts.find(barcode);
    if (!found) {
      return { barcode, source: null, product: null };
    }
    const saved = await this.saveFromOpenFoodFacts(userId, barcode, found);
    return {
      barcode,
      source: saved.source === 'openfoodfacts' ? 'openfoodfacts' : 'library',
      product: toProductDto(saved),
    };
  }

  async upsert(
    userId: string,
    barcode: string,
    dto: UpsertProductDto,
  ): Promise<ProductDto> {
    const product = await retryOnUniqueViolation(async () => {
      const existing =
        dto.source === 'openfoodfacts'
          ? await this.findByBarcode(userId, barcode)
          : null;
      const columns = productColumns(upsertFields(dto, existing));
      return this.prisma.product.upsert({
        where: { userId_barcode: { userId, barcode } },
        create: { ...columns, userId, barcode },
        update: columns,
      });
    });
    return toProductDto(product);
  }

  async list(userId: string): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: { userId },
      orderBy: PRODUCT_ORDER,
    });
    return products.map(toProductDto);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!product) {
        throw productNotFound();
      }
      await unlinkSavedFoodCopies(tx, userId, product.id);
      await tx.product.delete({ where: { id: product.id } });
    });
  }

  private findByBarcode(
    userId: string,
    barcode: string,
  ): Promise<Product | null> {
    return this.prisma.product.findUnique({
      where: { userId_barcode: { userId, barcode } },
    });
  }

  private saveFromOpenFoodFacts(
    userId: string,
    barcode: string,
    found: OffProduct,
  ): Promise<Product> {
    return retryOnUniqueViolation(() =>
      this.prisma.product.upsert({
        where: { userId_barcode: { userId, barcode } },
        create: {
          ...productColumns(offFields(found)),
          imageUrl: found.imageUrl,
          userId,
          barcode,
        },
        update: {},
      }),
    );
  }
}
