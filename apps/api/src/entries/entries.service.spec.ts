import { zeroNutrients } from '@food/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntryWithRelations } from '../common/mappers.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PhotosService } from '../photos/photos.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CreateEntryDto } from './entries.dto.js';
import { EntriesService } from './entries.service.js';
import { decodeEntryCursor, encodeEntryCursor } from './entry-cursor.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const ENTRY_ID = '019a0000-0000-7000-8000-0000000000e1';
const ANALYSIS_ID = '019a0000-0000-7000-8000-0000000000a1';
const PHOTO_ID = '019a0000-0000-7000-8000-0000000000f1';
const OTHER_PHOTO_ID = '019a0000-0000-7000-8000-0000000000f2';
const LABEL_PHOTO_ID = '019a0000-0000-7000-8000-0000000000f3';
const CREATED_AT = new Date('2026-09-28T08:00:00.000Z');
const SAVED_FOOD_ID = '019a0000-0000-7000-8000-0000000000d1';
const FOREIGN_FOOD_ID = '019a0000-0000-7000-8000-0000000000d9';

function entryRow(
  overrides: Partial<EntryWithRelations> = {},
): EntryWithRelations {
  return {
    id: ENTRY_ID,
    userId: USER_ID,
    name: 'Porridge',
    description: null,
    mealType: 'breakfast',
    source: 'manual',
    timestamp: CREATED_AT,
    localDate: '2026-09-28',
    photoId: null,
    analysisId: null,
    favoriteId: null,
    rawAiJson: null,
    productId: null,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    ...zeroNutrients(),
    calories: 300,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    items: [],
    photo: null,
    photos: [],
    ...overrides,
  };
}

function photoRow(
  photoId: string,
  role: string,
  position: number,
): EntryWithRelations['photos'][number] {
  return {
    entryId: ENTRY_ID,
    photoId,
    role,
    position,
    photo: {
      id: photoId,
      userId: USER_ID,
      storageKey: `photos/${photoId}.jpg`,
      thumbKey: `photos/${photoId}_thumb.webp`,
      width: 1344,
      height: 1792,
      bytes: 1000,
      createdAt: CREATED_AT,
    },
  };
}

function createDto(overrides: Partial<CreateEntryDto> = {}): CreateEntryDto {
  return {
    name: 'Porridge',
    mealType: 'breakfast',
    source: 'food_photo',
    timestamp: '2026-09-28T08:00:00.000Z',
    localDate: '2026-09-28',
    items: [
      {
        name: 'Oats',
        grams: 80,
        nutrients: { ...zeroNutrients(), calories: 300 },
      },
    ],
    ...overrides,
  };
}

function setup() {
  const prisma = {
    entry: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    entryItem: { deleteMany: vi.fn() },
    analysis: { findFirst: vi.fn() },
    product: {
      findMany: vi.fn((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          args.where.id.in
            .filter((id) => id === SAVED_FOOD_ID)
            .map((id) => ({ id })),
        ),
      ),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  prisma.entry.create.mockImplementation(() => Promise.resolve(entryRow()));
  prisma.entry.update.mockImplementation(() => Promise.resolve(entryRow()));
  const photos = {
    findOwned: vi.fn((_userId: string, id: string) => Promise.resolve({ id })),
    releaseAll: vi.fn(() => Promise.resolve()),
  };
  const service = new EntriesService(
    prisma as unknown as PrismaService,
    photos as unknown as PhotosService,
  );
  return { prisma, photos, service };
}

function analysisRow(
  photos: { photoId: string; role: string }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: ANALYSIS_ID,
    mode: 'food_photo',
    photoId: photos[0]?.photoId ?? null,
    rawResponse: null,
    photos,
    ...overrides,
  };
}

function updateBody(coverPhotoId?: string) {
  return {
    name: 'Edited',
    mealType: 'lunch' as const,
    timestamp: '2026-09-28T12:00:00.000Z',
    localDate: '2026-09-28',
    items: createDto().items,
    ...(coverPhotoId ? { coverPhotoId } : {}),
  };
}

function updateCallData(prisma: ReturnType<typeof setup>['prisma']) {
  const [args] = prisma.entry.update.mock.calls[0] as [
    { data: Prisma.EntryUncheckedUpdateInput },
  ];
  return args.data;
}

function createCallData(prisma: ReturnType<typeof setup>['prisma']) {
  const [args] = prisma.entry.create.mock.calls[0] as [
    { data: Prisma.EntryUncheckedCreateInput },
  ];
  return args.data;
}

describe('EntriesService', () => {
  describe('create', () => {
    it('copies the raw model response and photo from the analysis', async () => {
      const { prisma, photos, service } = setup();
      const rawResponse = { id: 'resp_1', output: [] };
      prisma.analysis.findFirst.mockResolvedValue(
        analysisRow([{ photoId: PHOTO_ID, role: 'food' }], { rawResponse }),
      );

      await service.create(USER_ID, createDto({ analysisId: ANALYSIS_ID }));

      expect(prisma.analysis.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ANALYSIS_ID, userId: USER_ID },
        }),
      );
      expect(photos.findOwned).not.toHaveBeenCalled();
      expect(createCallData(prisma)).toMatchObject({
        userId: USER_ID,
        analysisId: ANALYSIS_ID,
        photoId: PHOTO_ID,
        rawAiJson: rawResponse,
        source: 'food_photo',
        favoriteId: null,
        timestamp: new Date('2026-09-28T08:00:00.000Z'),
        photos: {
          createMany: {
            data: [{ photoId: PHOTO_ID, role: 'food', position: 0 }],
          },
        },
      });
    });

    it('keeps every analysis photo in order and uses the first food photo as cover', async () => {
      const { prisma, service } = setup();
      prisma.analysis.findFirst.mockResolvedValue(
        analysisRow(
          [
            { photoId: LABEL_PHOTO_ID, role: 'label' },
            { photoId: PHOTO_ID, role: 'food' },
          ],
          { photoId: LABEL_PHOTO_ID },
        ),
      );

      await service.create(USER_ID, createDto({ analysisId: ANALYSIS_ID }));

      expect(createCallData(prisma)).toMatchObject({
        photoId: PHOTO_ID,
        photos: {
          createMany: {
            data: [
              { photoId: LABEL_PHOTO_ID, role: 'label', position: 0 },
              { photoId: PHOTO_ID, role: 'food', position: 1 },
            ],
          },
        },
      });
    });

    it('uses the first photo as cover when an analysis has only labels', async () => {
      const { prisma, service } = setup();
      prisma.analysis.findFirst.mockResolvedValue(
        analysisRow(
          [
            { photoId: LABEL_PHOTO_ID, role: 'label' },
            { photoId: OTHER_PHOTO_ID, role: 'label' },
          ],
          { mode: 'nutrition_label' },
        ),
      );

      await service.create(
        USER_ID,
        createDto({ source: 'nutrition_label', analysisId: ANALYSIS_ID }),
      );

      expect(createCallData(prisma).photoId).toBe(LABEL_PHOTO_ID);
    });

    it('keeps the legacy photo of an analysis without photo rows', async () => {
      const { prisma, service } = setup();
      prisma.analysis.findFirst.mockResolvedValue(
        analysisRow([], { mode: 'nutrition_label', photoId: LABEL_PHOTO_ID }),
      );

      await service.create(USER_ID, createDto({ analysisId: ANALYSIS_ID }));

      expect(createCallData(prisma)).toMatchObject({
        photoId: LABEL_PHOTO_ID,
        photos: {
          createMany: {
            data: [{ photoId: LABEL_PHOTO_ID, role: 'label', position: 0 }],
          },
        },
      });
    });

    it('picks the requested cover among the analysis photos', async () => {
      const { prisma, service } = setup();
      prisma.analysis.findFirst.mockResolvedValue(
        analysisRow([
          { photoId: PHOTO_ID, role: 'food' },
          { photoId: LABEL_PHOTO_ID, role: 'label' },
        ]),
      );

      await service.create(
        USER_ID,
        createDto({ analysisId: ANALYSIS_ID, coverPhotoId: LABEL_PHOTO_ID }),
      );

      expect(createCallData(prisma).photoId).toBe(LABEL_PHOTO_ID);
    });

    it('rejects a cover that is not one of the entry photos', async () => {
      const { prisma, service } = setup();
      prisma.analysis.findFirst.mockResolvedValue(
        analysisRow([{ photoId: PHOTO_ID, role: 'food' }]),
      );

      await expect(
        service.create(
          USER_ID,
          createDto({ analysisId: ANALYSIS_ID, coverPhotoId: OTHER_PHOTO_ID }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(USER_ID, createDto({ coverPhotoId: OTHER_PHOTO_ID })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.entry.create).not.toHaveBeenCalled();
    });

    it('adds an explicitly given photo to the analysis photos and uses it as cover', async () => {
      const { prisma, photos, service } = setup();
      prisma.analysis.findFirst.mockResolvedValue(
        analysisRow([{ photoId: PHOTO_ID, role: 'food' }]),
      );

      await service.create(
        USER_ID,
        createDto({ analysisId: ANALYSIS_ID, photoId: OTHER_PHOTO_ID }),
      );

      expect(photos.findOwned).toHaveBeenCalledWith(USER_ID, OTHER_PHOTO_ID);
      expect(createCallData(prisma)).toMatchObject({
        photoId: OTHER_PHOTO_ID,
        rawAiJson: Prisma.DbNull,
        photos: {
          createMany: {
            data: [
              { photoId: PHOTO_ID, role: 'food', position: 0 },
              { photoId: OTHER_PHOTO_ID, role: 'food', position: 1 },
            ],
          },
        },
      });
    });

    it('stores a single photo without an analysis as one entry photo', async () => {
      const { prisma, service } = setup();

      await service.create(
        USER_ID,
        createDto({ source: 'nutrition_label', photoId: LABEL_PHOTO_ID }),
      );

      expect(prisma.analysis.findFirst).not.toHaveBeenCalled();
      expect(createCallData(prisma)).toMatchObject({
        photoId: LABEL_PHOTO_ID,
        analysisId: null,
        photos: {
          createMany: {
            data: [{ photoId: LABEL_PHOTO_ID, role: 'label', position: 0 }],
          },
        },
      });
    });

    it('rejects analyses owned by another user', async () => {
      const { prisma, service } = setup();
      prisma.analysis.findFirst.mockResolvedValue(null);

      await expect(
        service.create(USER_ID, createDto({ analysisId: ANALYSIS_ID })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.entry.create).not.toHaveBeenCalled();
    });

    it('stores a blank description as null and no references for manual entries', async () => {
      const { prisma, service } = setup();

      await service.create(USER_ID, createDto({ description: '' }));

      expect(prisma.analysis.findFirst).not.toHaveBeenCalled();
      expect(createCallData(prisma)).toMatchObject({
        description: null,
        photoId: null,
        analysisId: null,
        rawAiJson: Prisma.DbNull,
      });
      expect(createCallData(prisma)).not.toHaveProperty('photos');
    });

    it('stores the meal portion and item counts, cleaning the units', async () => {
      const { prisma, service } = setup();

      await service.create(
        USER_ID,
        createDto({
          portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
          items: [
            {
              name: 'Beef patties',
              grams: 180,
              nutrients: { ...zeroNutrients(), calories: 486 },
              count: 2.004,
              unit: '  patty ',
            },
            {
              name: 'Ketchup',
              grams: 15,
              nutrients: { ...zeroNutrients(), calories: 17 },
            },
          ],
        }),
      );

      expect(createCallData(prisma)).toMatchObject({
        portionCount: 2,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                count: 2,
                unit: 'patty',
                unitPlural: 'patties',
              }),
              expect.objectContaining({
                count: null,
                unit: null,
                unitPlural: null,
              }),
            ],
          },
        },
      });
    });

    it('stores no portion when none is given', async () => {
      const { prisma, service } = setup();

      await service.create(USER_ID, createDto());

      expect(createCallData(prisma)).toMatchObject({
        portionCount: null,
        portionUnit: null,
        portionUnitPlural: null,
      });
    });

    it('keeps links to own saved foods, drops others and counts the use once', async () => {
      const { prisma, service } = setup();
      const oats = {
        name: 'Oats',
        grams: 80,
        nutrients: { ...zeroNutrients(), calories: 300 },
      };

      await service.create(
        USER_ID,
        createDto({
          items: [
            { ...oats, productId: SAVED_FOOD_ID },
            { ...oats, name: 'More oats', productId: SAVED_FOOD_ID },
            { ...oats, name: 'Foreign', productId: FOREIGN_FOOD_ID },
            { ...oats, name: 'Plain' },
          ],
        }),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          id: { in: [SAVED_FOOD_ID, FOREIGN_FOOD_ID] },
        },
        select: { id: true },
      });
      const items = createCallData(prisma).items as {
        createMany: { data: { name: string; productId: string | null }[] };
      };
      expect(
        items.createMany.data.map(({ name, productId }) => [name, productId]),
      ).toEqual([
        ['Oats', SAVED_FOOD_ID],
        ['More oats', SAVED_FOOD_ID],
        ['Foreign', null],
        ['Plain', null],
      ]);
      expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, id: { in: [SAVED_FOOD_ID] } },
        data: { useCount: { increment: 1 }, lastUsedAt: expect.any(Date) },
      });
    });

    it('does not query saved foods for unlinked items', async () => {
      const { prisma, service } = setup();

      await service.create(USER_ID, createDto());

      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('fetches one extra row to decide whether another page exists', async () => {
      const { prisma, service } = setup();
      const rows = [
        entryRow({ id: '019a0000-0000-7000-8000-000000000003' }),
        entryRow({ id: '019a0000-0000-7000-8000-000000000002' }),
        entryRow({ id: '019a0000-0000-7000-8000-000000000001' }),
      ];
      prisma.entry.findMany.mockResolvedValue(rows);

      const result = await service.list(USER_ID, { limit: 2 });

      expect(prisma.entry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
      expect(result.items.map((item) => item.id)).toEqual([
        rows[0]?.id,
        rows[1]?.id,
      ]);
      expect(decodeEntryCursor(result.nextCursor ?? '')).toEqual({
        id: rows[1]?.id,
        timestamp: CREATED_AT,
      });
    });

    it('defaults to 30 rows per page and continues after the cursor', async () => {
      const { prisma, service } = setup();
      prisma.entry.findMany.mockResolvedValue([entryRow()]);
      const before = encodeEntryCursor({ timestamp: CREATED_AT, id: ENTRY_ID });

      const result = await service.list(USER_ID, { before });

      expect(prisma.entry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 31,
          where: {
            userId: USER_ID,
            AND: [
              {},
              {
                OR: [
                  { timestamp: { lt: CREATED_AT } },
                  { timestamp: CREATED_AT, id: { lt: ENTRY_ID } },
                ],
              },
            ],
          },
        }),
      );
      expect(result.nextCursor).toBeNull();
    });

    it('returns every entry of a date range without paging', async () => {
      const { prisma, service } = setup();
      prisma.entry.findMany.mockResolvedValue([entryRow()]);

      const result = await service.list(USER_ID, {
        from: '2026-09-01',
        to: '2026-09-30',
        limit: 1,
      });

      const [args] = prisma.entry.findMany.mock.calls[0] as [
        Prisma.EntryFindManyArgs,
      ];
      expect(args.take).toBeUndefined();
      expect(args.where).toEqual({
        userId: USER_ID,
        AND: [{ localDate: { gte: '2026-09-01', lte: '2026-09-30' } }, {}],
      });
      expect(result).toMatchObject({ nextCursor: null });
      expect(result.items).toHaveLength(1);
    });

    it('rejects malformed cursors before querying', async () => {
      const { prisma, service } = setup();

      await expect(
        service.list(USER_ID, { before: 'bogus' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.entry.findMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('replaces the items inside one transaction after checking ownership', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(entryRow());

      await service.update(USER_ID, ENTRY_ID, updateBody());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.entry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ENTRY_ID, userId: USER_ID } }),
      );
      expect(prisma.entryItem.deleteMany).toHaveBeenCalledWith({
        where: { entryId: ENTRY_ID },
      });
      const deleteOrder =
        prisma.entryItem.deleteMany.mock.invocationCallOrder[0] ?? 0;
      const updateOrder = prisma.entry.update.mock.invocationCallOrder[0] ?? 0;
      expect(deleteOrder).toBeLessThan(updateOrder);
      expect(updateCallData(prisma)).not.toHaveProperty('photoId');
    });

    it('keeps only own saved food links without counting a new use', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(entryRow());
      const oats = {
        name: 'Oats',
        grams: 80,
        nutrients: { ...zeroNutrients(), calories: 300 },
      };

      await service.update(USER_ID, ENTRY_ID, {
        ...updateBody(),
        items: [
          { ...oats, productId: SAVED_FOOD_ID },
          { ...oats, productId: FOREIGN_FOOD_ID },
        ],
      });

      const items = updateCallData(prisma).items as {
        createMany: { data: { productId: string | null }[] };
      };
      expect(items.createMany.data.map(({ productId }) => productId)).toEqual([
        SAVED_FOOD_ID,
        null,
      ]);
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('keeps the stored portion when the request leaves it out', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(entryRow());

      await service.update(USER_ID, ENTRY_ID, updateBody());

      expect(updateCallData(prisma)).not.toHaveProperty('portionCount');
      expect(updateCallData(prisma)).not.toHaveProperty('portionUnit');
    });

    it('sets a portion on an entry and clears it with null', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(entryRow());

      await service.update(USER_ID, ENTRY_ID, {
        ...updateBody(),
        portion: { count: 1.5, unit: 'burger', unitPlural: 'burgers' },
      });
      await service.update(USER_ID, ENTRY_ID, {
        ...updateBody(),
        portion: null,
      });

      const [[first], [second]] = prisma.entry.update.mock.calls as [
        { data: Prisma.EntryUncheckedUpdateInput },
      ][];
      expect(first?.data).toMatchObject({
        portionCount: 1.5,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
      });
      expect(second?.data).toMatchObject({
        portionCount: null,
        portionUnit: null,
        portionUnitPlural: null,
      });
    });

    it('changes the cover to another photo of the entry', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue({
        id: ENTRY_ID,
        photoId: PHOTO_ID,
        photos: [{ photoId: PHOTO_ID }, { photoId: LABEL_PHOTO_ID }],
      });

      await service.update(USER_ID, ENTRY_ID, updateBody(LABEL_PHOTO_ID));

      expect(updateCallData(prisma)).toMatchObject({
        name: 'Edited',
        photoId: LABEL_PHOTO_ID,
      });
    });

    it('keeps a previous cover that has no photo row when the cover changes', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue({
        id: ENTRY_ID,
        source: 'food_photo',
        photoId: PHOTO_ID,
        photos: [{ photoId: LABEL_PHOTO_ID, position: 0 }],
      });

      await service.update(USER_ID, ENTRY_ID, updateBody(LABEL_PHOTO_ID));

      expect(updateCallData(prisma)).toMatchObject({
        photoId: LABEL_PHOTO_ID,
        photos: {
          create: { photoId: PHOTO_ID, role: 'food', position: 1 },
        },
      });
    });

    it('rejects a cover that does not belong to the entry', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue({
        id: ENTRY_ID,
        photoId: PHOTO_ID,
        photos: [{ photoId: PHOTO_ID }],
      });

      await expect(
        service.update(USER_ID, ENTRY_ID, updateBody(OTHER_PHOTO_ID)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.entryItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.entry.update).not.toHaveBeenCalled();
    });

    it('does not touch items of entries owned by someone else', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(null);

      await expect(
        service.update(USER_ID, ENTRY_ID, updateBody(PHOTO_ID)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.entryItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.entry.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the entry and then releases every photo it used', async () => {
      const { prisma, photos, service } = setup();
      prisma.entry.findFirst.mockResolvedValue({
        id: ENTRY_ID,
        photoId: PHOTO_ID,
        photos: [{ photoId: PHOTO_ID }, { photoId: LABEL_PHOTO_ID }],
      });

      await service.remove(USER_ID, ENTRY_ID);

      expect(prisma.entry.delete).toHaveBeenCalledWith({
        where: { id: ENTRY_ID },
      });
      expect(photos.releaseAll).toHaveBeenCalledWith([
        PHOTO_ID,
        LABEL_PHOTO_ID,
      ]);
      const deleteOrder = prisma.entry.delete.mock.invocationCallOrder[0] ?? 0;
      const releaseOrder = photos.releaseAll.mock.invocationCallOrder[0] ?? 0;
      expect(deleteOrder).toBeLessThan(releaseOrder);
    });

    it('returns 404 without deleting anything for unknown entries', async () => {
      const { prisma, photos, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(null);

      await expect(service.remove(USER_ID, ENTRY_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.entry.delete).not.toHaveBeenCalled();
      expect(photos.releaseAll).not.toHaveBeenCalled();
    });
  });

  describe('duplicate', () => {
    it('copies content and references but never the analysis', async () => {
      const { prisma, service } = setup();
      const rawAiJson = { id: 'resp_1' };
      prisma.entry.findFirst.mockResolvedValue(
        entryRow({
          description: 'Big bowl',
          source: 'food_photo',
          photoId: PHOTO_ID,
          analysisId: ANALYSIS_ID,
          favoriteId: 'favorite-1',
          rawAiJson,
          photos: [
            photoRow(LABEL_PHOTO_ID, 'label', 1),
            photoRow(PHOTO_ID, 'food', 0),
          ],
          items: [
            {
              id: 'item-1',
              entryId: ENTRY_ID,
              position: 0,
              name: 'Oats',
              grams: 80,
              count: null,
              unit: null,
              unitPlural: null,
              confidence: 'medium',
              productId: SAVED_FOOD_ID,
              micros: { iron: 3.4, magnesium: 110 },
              fluidMl: null,
              ...zeroNutrients(),
              calories: 300,
            },
          ],
        }),
      );

      await service.duplicate(USER_ID, ENTRY_ID, {
        timestamp: '2026-09-29T07:00:00.000Z',
        localDate: '2026-09-29',
      });

      expect(createCallData(prisma)).toMatchObject({
        name: 'Porridge',
        description: 'Big bowl',
        mealType: 'breakfast',
        source: 'copy',
        localDate: '2026-09-29',
        timestamp: new Date('2026-09-29T07:00:00.000Z'),
        photoId: PHOTO_ID,
        analysisId: null,
        favoriteId: 'favorite-1',
        rawAiJson,
        calories: 300,
        photos: {
          createMany: {
            data: [
              { photoId: PHOTO_ID, role: 'food', position: 0 },
              { photoId: LABEL_PHOTO_ID, role: 'label', position: 1 },
            ],
          },
        },
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                position: 0,
                name: 'Oats',
                confidence: 'medium',
                productId: SAVED_FOOD_ID,
                micros: { iron: 3.4, magnesium: 110 },
                fluidMl: null,
              }),
            ],
          },
        },
      });
      expect(prisma.product.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, id: { in: [SAVED_FOOD_ID] } },
        data: { useCount: { increment: 1 }, lastUsedAt: expect.any(Date) },
      });
    });

    it('copies the portion and item counts as they are', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(
        entryRow({
          portionCount: 2,
          portionUnit: 'burger',
          portionUnitPlural: 'burgers',
          items: [
            {
              id: 'item-1',
              entryId: ENTRY_ID,
              position: 0,
              name: 'Burger bun',
              grams: 110,
              count: 2,
              unit: 'bun',
              unitPlural: 'buns',
              confidence: 'medium',
              productId: null,
              micros: null,
              fluidMl: null,
              ...zeroNutrients(),
              calories: 307,
            },
          ],
        }),
      );

      await service.duplicate(USER_ID, ENTRY_ID, {
        timestamp: '2026-09-29T07:00:00.000Z',
        localDate: '2026-09-29',
      });

      expect(createCallData(prisma)).toMatchObject({
        portionCount: 2,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
        items: {
          createMany: {
            data: [
              expect.objectContaining({
                grams: 110,
                count: 2,
                unit: 'bun',
                unitPlural: 'buns',
              }),
            ],
          },
        },
      });
    });

    it('keeps a cover that has no entry photo row yet', async () => {
      const { prisma, service } = setup();
      prisma.entry.findFirst.mockResolvedValue(
        entryRow({
          source: 'nutrition_label',
          photoId: LABEL_PHOTO_ID,
          photos: [],
        }),
      );

      await service.duplicate(USER_ID, ENTRY_ID, {
        timestamp: '2026-09-29T07:00:00.000Z',
        localDate: '2026-09-29',
      });

      expect(createCallData(prisma)).toMatchObject({
        photoId: LABEL_PHOTO_ID,
        photos: {
          createMany: {
            data: [{ photoId: LABEL_PHOTO_ID, role: 'label', position: 0 }],
          },
        },
      });
    });
  });
});
