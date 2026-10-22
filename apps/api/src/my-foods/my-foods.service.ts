import {
  type MyFoodChangeResponse,
  type MyFoodDto,
  type Nutrients,
  sanitizeNutrients,
} from '@food/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { nutrientColumns } from '../common/mappers.js';
import { microsJson, per100Micros } from '../common/micros.js';
import { blankToNull } from '../entries/entry-data.js';
import type { Prisma, Product } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  correctedMissingNutrients,
  PRODUCT_ORDER,
  productPer100,
} from '../products/product-data.js';
import {
  cleanAliases,
  matchesMyFoodQuery,
  microsPer100Update,
  MY_FOOD_INCLUDE,
  type MyFoodRow,
  NO_SAVED_FOOD_CHANGES,
  toChangeResponse,
  toMyFoodDto,
  unitGramsOrNull,
} from './my-food-data.js';
import type { SaveMyFoodDto, UpdateMyFoodDto } from './my-foods.dto.js';
import {
  applySavedFoodToPast,
  unlinkSavedFoodCopies,
} from './saved-food-apply.js';

export const SAVED_FOOD_TRANSACTION = { timeout: 30_000 } as const;

type ProductClient = Pick<Prisma.TransactionClient, 'product'>;

export function myFoodNotFound(): NotFoundException {
  return new NotFoundException('Food not found');
}

export async function requireOwnedProduct(
  client: ProductClient,
  userId: string,
  id: string,
): Promise<Product> {
  const product = await client.product.findFirst({ where: { id, userId } });
  if (!product) {
    throw myFoodNotFound();
  }
  return product;
}

export function loadMyFood(
  client: ProductClient,
  id: string,
): Promise<MyFoodRow> {
  return client.product.findUniqueOrThrow({
    where: { id },
    include: MY_FOOD_INCLUDE,
  });
}

function keptOr<T>(value: T | undefined, current: T): T {
  return value === undefined ? current : value;
}

function updatedPer100(
  existing: Product,
  per100: Nutrients | undefined | null,
): Nutrients {
  return per100 ? sanitizeNutrients(per100) : productPer100(existing);
}

function updateData(
  existing: Product,
  dto: UpdateMyFoodDto,
): Prisma.ProductUncheckedUpdateInput {
  const name = dto.name ?? existing.name;
  const brand =
    dto.brand === undefined ? existing.brand : blankToNull(dto.brand);
  const per100 = updatedPer100(existing, dto.per100);
  return {
    name,
    brand,
    aliases: cleanAliases(dto.aliases ?? existing.aliases, name, brand),
    basisUnit: dto.basisUnit ?? existing.basisUnit,
    ...nutrientColumns(per100),
    ...microsPer100Update(dto.microsPer100),
    unitName: keptOr(dto.unitName, existing.unitName),
    unitGrams:
      dto.unitGrams === undefined
        ? existing.unitGrams
        : unitGramsOrNull(dto.unitGrams),
    servingSizeG: keptOr(dto.servingSizeG, existing.servingSizeG),
    missingNutrients: dto.per100
      ? correctedMissingNutrients(existing, existing.source, per100)
      : existing.missingNutrients,
  };
}

@Injectable()
export class MyFoodsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, q?: string): Promise<MyFoodDto[]> {
    const products = await this.prisma.product.findMany({
      where: { userId },
      orderBy: PRODUCT_ORDER,
      include: MY_FOOD_INCLUDE,
    });
    return products
      .filter((product) => matchesMyFoodQuery(product, q))
      .map(toMyFoodDto);
  }

  async create(userId: string, dto: SaveMyFoodDto): Promise<MyFoodDto> {
    const brand = blankToNull(dto.brand);
    const product = await this.prisma.product.create({
      data: {
        userId,
        barcode: null,
        name: dto.name,
        brand,
        aliases: cleanAliases(dto.aliases ?? [], dto.name, brand),
        basisUnit: dto.basisUnit,
        ...nutrientColumns(sanitizeNutrients(dto.per100)),
        microsPer100: microsJson(per100Micros(dto.microsPer100)),
        unitName: dto.unitName ?? null,
        unitGrams: unitGramsOrNull(dto.unitGrams),
        servingSizeG: dto.servingSizeG ?? null,
        source: dto.source ?? 'manual',
        missingNutrients: [],
      },
      include: MY_FOOD_INCLUDE,
    });
    return toMyFoodDto(product);
  }

  update(
    userId: string,
    id: string,
    dto: UpdateMyFoodDto,
  ): Promise<MyFoodChangeResponse> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await requireOwnedProduct(tx, userId, id);
      const updated = await tx.product.update({
        where: { id: existing.id },
        data: updateData(existing, dto),
      });
      const changes = dto.applyToPast
        ? await applySavedFoodToPast(tx, userId, updated, {
            matchNames: false,
          })
        : NO_SAVED_FOOD_CHANGES;
      return toChangeResponse(await loadMyFood(tx, updated.id), changes);
    }, SAVED_FOOD_TRANSACTION);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await requireOwnedProduct(tx, userId, id);
      await unlinkSavedFoodCopies(tx, userId, existing.id);
      await tx.product.delete({ where: { id: existing.id } });
    });
  }
}
