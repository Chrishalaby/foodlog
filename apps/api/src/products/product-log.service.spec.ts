import { zeroNutrients } from '@food/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntryWithRelations } from '../common/mappers.js';
import type { Prisma, Product } from '../generated/prisma/client.js';
import type { PhotosService } from '../photos/photos.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  type ProductLogRequest,
  ProductLogService,
} from './product-log.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const PRODUCT_ID = '019a0000-0000-7000-8000-0000000000d1';
const NOW = new Date('2026-09-28T08:00:00.000Z');
const ANALYSIS_ID = '019a0000-0000-7000-8000-0000000000a1';
const ANALYSIS_PHOTO_ID = '019a0000-0000-7000-8000-0000000000f1';
const OTHER_PHOTO_ID = '019a0000-0000-7000-8000-0000000000f2';
const RAW_RESPONSE = { id: 'resp_1', output_text: '{"meal_name":"Oats"}' };

function productRow(overrides: Partial<Product> = {}): Product {
  return {
    id: PRODUCT_ID,
    userId: USER_ID,
    barcode: '5280001234566',
    name: 'Labneh',
    brand: 'Taanayel',
    basisUnit: 'g',
    ...zeroNutrients(),
    calories: 160,
    protein: 8.5,
    fat: 12,
    sodium: 500,
    microsPer100: { calcium: 110, cholesterol: 35 },
    servingSizeG: 30,
    packSizeG: 500,
    source: 'label',
    imageUrl: null,
    missingNutrients: [],
    aliases: [],
    unitName: null,
    unitGrams: null,
    useCount: 2,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createdEntry(): EntryWithRelations {
  return {
    id: 'entry',
    userId: USER_ID,
    name: 'Taanayel Labneh',
    description: null,
    mealType: 'breakfast',
    source: 'barcode',
    timestamp: NOW,
    localDate: '2026-09-28',
    photoId: null,
    analysisId: null,
    favoriteId: null,
    productId: PRODUCT_ID,
    rawAiJson: null,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    ...zeroNutrients(),
    createdAt: NOW,
    updatedAt: NOW,
    items: [],
    photo: null,
    photos: [],
  };
}

function request(
  overrides: Partial<ProductLogRequest> = {},
): ProductLogRequest {
  return {
    amount: { servings: 1 },
    timestamp: '2026-09-28T10:15:00.000+03:00',
    localDate: '2026-09-28',
    mealType: 'breakfast',
    ...overrides,
  };
}

function setup() {
  const prisma = {
    product: {
      findFirst: vi.fn().mockResolvedValue(productRow()),
      findMany: vi.fn().mockResolvedValue([{ id: PRODUCT_ID }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    entry: { create: vi.fn().mockResolvedValue(createdEntry()) },
    analysis: {
      findFirst: vi.fn().mockResolvedValue({
        id: ANALYSIS_ID,
        mode: 'nutrition_label',
        photoId: ANALYSIS_PHOTO_ID,
        rawResponse: RAW_RESPONSE,
        photos: [{ photoId: ANALYSIS_PHOTO_ID, role: 'label' }],
      }),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  const photos = {
    findOwned: vi.fn((_userId: string, id: string) => Promise.resolve({ id })),
  };
  const service = new ProductLogService(
    prisma as unknown as PrismaService,
    photos as unknown as PhotosService,
  );
  return { prisma, photos, service };
}

function createdData(prisma: ReturnType<typeof setup>['prisma']) {
  const [args] = prisma.entry.create.mock.calls[0] as [
    { data: Prisma.EntryUncheckedCreateInput },
  ];
  return args.data;
}

describe('ProductLogService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs servings of the product as a barcode entry and counts the use', async () => {
    const { prisma, service } = setup();

    await expect(
      service.log(USER_ID, PRODUCT_ID, request({ amount: { servings: 2 } })),
    ).resolves.toMatchObject({ id: 'entry', source: 'barcode' });

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, userId: USER_ID },
    });
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: [PRODUCT_ID] } },
      data: { useCount: { increment: 1 }, lastUsedAt: NOW },
    });
    expect(createdData(prisma)).toEqual({
      userId: USER_ID,
      name: 'Taanayel Labneh',
      description: null,
      mealType: 'breakfast',
      source: 'barcode',
      timestamp: new Date('2026-09-28T07:15:00.000Z'),
      localDate: '2026-09-28',
      photoId: null,
      analysisId: null,
      favoriteId: null,
      productId: PRODUCT_ID,
      rawAiJson: expect.anything(),
      ...zeroNutrients(),
      calories: 96,
      protein: 5.1,
      fat: 7.2,
      sodium: 300,
      items: {
        createMany: {
          data: [
            {
              position: 0,
              name: 'Taanayel Labneh',
              grams: 60,
              count: null,
              unit: null,
              unitPlural: null,
              confidence: 'high',
              productId: PRODUCT_ID,
              micros: { calcium: 66, cholesterol: 21 },
              fluidMl: null,
              ...zeroNutrients(),
              calories: 96,
              protein: 5.1,
              fat: 7.2,
              sodium: 300,
            },
          ],
        },
      },
    });
  });

  it('keeps the photo, analysis and raw AI response of a label scan', async () => {
    const { prisma, photos, service } = setup();

    await service.log(
      USER_ID,
      PRODUCT_ID,
      request({ analysisId: ANALYSIS_ID, description: '  1 serving ' }),
    );

    expect(prisma.analysis.findFirst).toHaveBeenCalledWith({
      where: { id: ANALYSIS_ID, userId: USER_ID },
      select: {
        id: true,
        mode: true,
        photoId: true,
        rawResponse: true,
        photos: {
          where: { photo: { userId: USER_ID } },
          orderBy: { position: 'asc' },
          select: { photoId: true, role: true },
        },
      },
    });
    expect(photos.findOwned).not.toHaveBeenCalled();
    expect(createdData(prisma)).toMatchObject({
      photoId: ANALYSIS_PHOTO_ID,
      analysisId: ANALYSIS_ID,
      rawAiJson: RAW_RESPONSE,
      description: '  1 serving ',
      productId: PRODUCT_ID,
      source: 'barcode',
      photos: {
        createMany: {
          data: [{ photoId: ANALYSIS_PHOTO_ID, role: 'label', position: 0 }],
        },
      },
    });
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: [PRODUCT_ID] } },
      data: { useCount: { increment: 1 }, lastUsedAt: NOW },
    });
  });

  it('prefers an explicit own photo over the photo of the analysis', async () => {
    const { prisma, photos, service } = setup();

    await service.log(
      USER_ID,
      PRODUCT_ID,
      request({ analysisId: ANALYSIS_ID, photoId: OTHER_PHOTO_ID }),
    );

    expect(photos.findOwned).toHaveBeenCalledWith(USER_ID, OTHER_PHOTO_ID);
    expect(createdData(prisma)).toMatchObject({
      photoId: OTHER_PHOTO_ID,
      analysisId: ANALYSIS_ID,
      photos: {
        createMany: {
          data: [
            { photoId: ANALYSIS_PHOTO_ID, role: 'label', position: 0 },
            { photoId: OTHER_PHOTO_ID, role: 'food', position: 1 },
          ],
        },
      },
    });
  });

  it('logs a product without photos when nothing was scanned', async () => {
    const { prisma, service } = setup();

    await service.log(USER_ID, PRODUCT_ID, request());

    expect(prisma.analysis.findFirst).not.toHaveBeenCalled();
    expect(createdData(prisma)).toMatchObject({
      photoId: null,
      analysisId: null,
    });
    expect(createdData(prisma)).not.toHaveProperty('photos');
  });

  it('stores a blank description as null', async () => {
    const { prisma, service } = setup();

    await service.log(USER_ID, PRODUCT_ID, request({ description: '' }));

    expect(createdData(prisma)).toMatchObject({ description: null });
  });

  it('returns 404 for a foreign analysis without counting the use', async () => {
    const { prisma, service } = setup();
    prisma.analysis.findFirst.mockResolvedValue(null);

    await expect(
      service.log(USER_ID, PRODUCT_ID, request({ analysisId: ANALYSIS_ID })),
    ).rejects.toThrow(new NotFoundException('Analysis not found'));
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.entry.create).not.toHaveBeenCalled();
  });

  it('returns 404 for a foreign photo without counting the use', async () => {
    const { prisma, photos, service } = setup();
    photos.findOwned.mockRejectedValue(
      new NotFoundException('Photo not found'),
    );

    await expect(
      service.log(USER_ID, PRODUCT_ID, request({ photoId: OTHER_PHOTO_ID })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.entry.create).not.toHaveBeenCalled();
  });

  it('logs an exact weight', async () => {
    const { prisma, service } = setup();

    await service.log(USER_ID, PRODUCT_ID, request({ amount: { grams: 45 } }));

    expect(createdData(prisma)).toMatchObject({
      calories: 72,
      items: { createMany: { data: [expect.objectContaining({ grams: 45 })] } },
    });
  });

  it('logs a saved food without a barcode as a food library entry', async () => {
    const { prisma, service } = setup();
    prisma.product.findFirst.mockResolvedValue(productRow({ barcode: null }));

    await service.log(USER_ID, PRODUCT_ID, request());

    expect(createdData(prisma)).toMatchObject({
      source: 'copy',
      productId: PRODUCT_ID,
    });
  });

  it('returns 404 for unknown or foreign products without writing', async () => {
    const { prisma, service } = setup();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.log(USER_ID, PRODUCT_ID, request()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.entry.create).not.toHaveBeenCalled();
  });

  it('rejects oversized amounts before counting the use', async () => {
    const { prisma, service } = setup();
    prisma.product.findFirst.mockResolvedValue(
      productRow({ servingSizeG: 1000 }),
    );

    await expect(
      service.log(USER_ID, PRODUCT_ID, request({ amount: { servings: 11 } })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.entry.create).not.toHaveBeenCalled();
  });
});
