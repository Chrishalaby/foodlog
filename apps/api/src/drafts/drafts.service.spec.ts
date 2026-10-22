import { API_LIMITS, zeroNutrients } from '@food/shared';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AnalyzeUpload } from '../ai/analyze-uploads.js';
import type { PhotosService } from '../photos/photos.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CreateDraftDto, LogDraftDto } from './drafts.dto.js';
import {
  DRAFTS_FULL_MESSAGE,
  DraftsService,
  EMPTY_DRAFT_MESSAGE,
} from './drafts.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const DRAFT_ID = '019a0000-0000-7000-8000-0000000000d1';
const ANALYSIS_ID = '019a0000-0000-7000-8000-0000000000a1';
const CREATED_AT = new Date('2026-09-30T08:00:00.000Z');

function createDto(overrides: Partial<CreateDraftDto> = {}): CreateDraftDto {
  return {
    mode: 'food_photo',
    timestamp: '2026-09-30T12:15:00.000Z',
    localDate: '2026-09-30',
    ...overrides,
  };
}

const UPLOAD: AnalyzeUpload = {
  field: 'images',
  role: null,
  buffer: Buffer.from([0xff, 0xd8, 0xff]),
};

function storedPhoto(id: string) {
  return {
    id,
    userId: USER_ID,
    storageKey: `photos/${id}.jpg`,
    thumbKey: `photos/${id}_thumb.webp`,
    width: 1600,
    height: 1200,
    bytes: 1,
    createdAt: CREATED_AT,
  };
}

function loggedEntry(photos: { photoId: string; role: string }[]) {
  return {
    id: 'entry-1',
    userId: USER_ID,
    name: 'Lunch',
    description: null,
    mealType: 'lunch' as const,
    source: 'food_photo' as const,
    timestamp: CREATED_AT,
    localDate: '2026-09-30',
    photoId: photos[0]?.photoId ?? null,
    analysisId: null,
    favoriteId: null,
    productId: null,
    rawAiJson: null,
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    ...zeroNutrients(),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    items: [],
    photo: photos[0] ? storedPhoto(photos[0].photoId) : null,
    photos: photos.map(({ photoId, role }, position) => ({
      entryId: 'entry-1',
      photoId,
      role,
      position,
      photo: storedPhoto(photoId),
    })),
  };
}

const SAVED_FOOD_ID = '019a0000-0000-7000-8000-0000000000d1';
const FOREIGN_FOOD_ID = '019a0000-0000-7000-8000-0000000000d9';

function setup(draftCounts: number[] = [0, 0]) {
  const counts = [...draftCounts];
  const tx = {
    $queryRaw: vi.fn((_sql: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([]),
    ),
    draft: {
      count: vi.fn(() => Promise.resolve(counts.shift() ?? 0)),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    analysis: { findFirst: vi.fn() },
    entry: { create: vi.fn() },
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
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const photos = {
    createManyFromUploads: vi.fn(
      (_userId: string, uploads: readonly unknown[]) =>
        Promise.resolve(uploads.map((_, index) => storedPhoto(`p${index}`))),
    ),
    releaseAll: vi.fn(() => Promise.resolve()),
  };
  const service = new DraftsService(
    prisma as unknown as PrismaService,
    photos as unknown as PhotosService,
  );
  return { service, prisma, tx, photos };
}

describe('DraftsService.create', () => {
  it('refuses an empty draft before storing anything', async () => {
    const { service, photos } = setup();

    await expect(
      service.create(USER_ID, createDto({ name: '', description: '' }), []),
    ).rejects.toThrow(new BadRequestException(EMPTY_DRAFT_MESSAGE));
    expect(photos.createManyFromUploads).not.toHaveBeenCalled();
  });

  it('refuses a new draft at the limit before storing photos', async () => {
    const { service, photos } = setup([API_LIMITS.draftsMax]);

    await expect(
      service.create(USER_ID, createDto(), [UPLOAD]),
    ).rejects.toThrow(new ConflictException(DRAFTS_FULL_MESSAGE));
    expect(photos.createManyFromUploads).not.toHaveBeenCalled();
  });

  it('releases the stored photos when the limit is reached meanwhile', async () => {
    const { service, tx, photos } = setup([0, API_LIMITS.draftsMax]);

    await expect(
      service.create(USER_ID, createDto(), [UPLOAD, UPLOAD]),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = tx.$queryRaw.mock.calls[0] ?? [[]];
    expect(sql.join('?')).toContain('FOR NO KEY UPDATE');
    expect(values).toEqual([USER_ID]);
    expect(tx.draft.create).not.toHaveBeenCalled();
    expect(photos.releaseAll).toHaveBeenCalledWith(['p0', 'p1']);
  });

  it('stores uploads with the default roles of the mode', async () => {
    const { service, photos, tx } = setup();
    tx.draft.create.mockRejectedValueOnce(new Error('stop'));

    await expect(
      service.create(USER_ID, createDto({ mode: 'nutrition_label' }), [
        UPLOAD,
        { ...UPLOAD, role: 'food' },
      ]),
    ).rejects.toThrow('stop');

    expect(photos.createManyFromUploads).toHaveBeenCalledWith(USER_ID, [
      { buffer: UPLOAD.buffer, role: 'label' },
      { buffer: UPLOAD.buffer, role: 'food' },
    ]);
  });

  it('stores the portion of the draft', async () => {
    const { service, tx } = setup();
    tx.draft.create.mockRejectedValueOnce(new Error('stop'));

    await expect(
      service.create(
        USER_ID,
        createDto({
          name: 'Burgers',
          portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
        }),
        [],
      ),
    ).rejects.toThrow('stop');

    expect(tx.draft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          portionCount: 2,
          portionUnit: 'burger',
          portionUnitPlural: 'burgers',
        }) as unknown,
      }),
    );
  });

  it('rejects an analysis of someone else with 404', async () => {
    const { service, prisma, photos } = setup();
    prisma.analysis.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.create(USER_ID, createDto({ analysisId: ANALYSIS_ID }), [UPLOAD]),
    ).rejects.toThrow(new NotFoundException('Analysis not found'));
    expect(prisma.analysis.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ANALYSIS_ID, userId: USER_ID, mode: { not: 'menu' } },
      }),
    );
    expect(photos.createManyFromUploads).not.toHaveBeenCalled();
  });
});

describe('DraftsService.update', () => {
  function draftRow(mode: string) {
    return {
      id: DRAFT_ID,
      userId: USER_ID,
      mode,
      name: null,
      description: 'burger',
      mealType: null,
      timestamp: CREATED_AT,
      localDate: '2026-09-30',
      items: null,
      analysisId: ANALYSIS_ID,
      photos: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
  }

  it('takes the mode and photos of a linked analysis', async () => {
    const { service, tx, photos } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      photos: [{ photoId: 'old' }, { photoId: 'kept' }],
    });
    tx.analysis.findFirst.mockResolvedValueOnce({
      id: ANALYSIS_ID,
      mode: 'food_photo',
      photoId: 'kept',
      photos: [
        { photoId: 'kept', role: 'food' },
        { photoId: 'added', role: 'label' },
      ],
    });
    tx.draft.update.mockResolvedValueOnce(draftRow('food_photo'));

    const draft = await service.update(USER_ID, DRAFT_ID, {
      analysisId: ANALYSIS_ID,
    });

    expect(draft.mode).toBe('food_photo');
    expect(tx.draft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DRAFT_ID },
        data: {
          analysisId: ANALYSIS_ID,
          mode: 'food_photo',
          photos: {
            deleteMany: {},
            create: [
              { photoId: 'kept', role: 'food', position: 0 },
              { photoId: 'added', role: 'label', position: 1 },
            ],
          },
        },
      }),
    );
    expect(photos.releaseAll).toHaveBeenCalledWith(['old']);
  });

  it('keeps the mode and photos when the analysis is unlinked', async () => {
    const { service, tx, photos } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      photos: [{ photoId: 'p0' }],
    });
    tx.draft.update.mockResolvedValueOnce(draftRow('text'));

    await service.update(USER_ID, DRAFT_ID, { analysisId: null, name: 'x' });

    expect(tx.analysis.findFirst).not.toHaveBeenCalled();
    expect(tx.draft.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { analysisId: null, name: 'x' } }),
    );
    expect(photos.releaseAll).toHaveBeenCalledWith([]);
  });

  it('keeps only links to own saved foods in draft items', async () => {
    const { service, tx } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({ id: DRAFT_ID, photos: [] });
    tx.draft.update.mockResolvedValueOnce(draftRow('text'));
    const rice = { name: 'Rice', grams: 180, nutrients: zeroNutrients() };

    await service.update(USER_ID, DRAFT_ID, {
      items: [
        { ...rice, productId: SAVED_FOOD_ID },
        { ...rice, productId: FOREIGN_FOOD_ID },
      ],
    });

    const [args] = tx.draft.update.mock.calls[0] as [
      { data: { items: { productId: string | null }[] } },
    ];
    expect(args.data.items.map(({ productId }) => productId)).toEqual([
      SAVED_FOOD_ID,
      null,
    ]);
  });
});

describe('DraftsService.log', () => {
  const LOG: LogDraftDto = {
    name: 'Lunch',
    mealType: 'lunch',
    timestamp: '2026-09-30T12:15:00.000Z',
    localDate: '2026-09-30',
    items: [{ name: 'Rice', grams: 180, nutrients: zeroNutrients() }],
  };

  it('returns 404 for a draft that is gone', async () => {
    const { service, tx, photos } = setup();
    tx.draft.findFirst.mockResolvedValueOnce(null);

    await expect(service.log(USER_ID, DRAFT_ID, LOG)).rejects.toThrow(
      new NotFoundException('Draft not found'),
    );
    expect(tx.entry.create).not.toHaveBeenCalled();
    expect(photos.releaseAll).not.toHaveBeenCalled();
  });

  it('fails when another request logged the draft first', async () => {
    const { service, tx, photos } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      mode: 'text',
      photos: [],
      analysis: null,
    });
    tx.entry.create.mockResolvedValueOnce({ photoId: null });
    tx.draft.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.log(USER_ID, DRAFT_ID, LOG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(photos.releaseAll).not.toHaveBeenCalled();
  });

  it('keeps every draft photo with its role on the entry and releases none', async () => {
    const { service, tx, photos } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      mode: 'food_photo',
      photos: [
        { photoId: 'p1', role: 'label' },
        { photoId: 'p0', role: 'food' },
      ],
      analysis: null,
    });
    tx.entry.create.mockResolvedValueOnce(
      loggedEntry([
        { photoId: 'p0', role: 'food' },
        { photoId: 'p1', role: 'label' },
      ]),
    );

    const entry = await service.log(USER_ID, DRAFT_ID, LOG);

    expect(tx.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          photoId: 'p0',
          photos: {
            createMany: {
              data: [
                { photoId: 'p1', role: 'label', position: 0 },
                { photoId: 'p0', role: 'food', position: 1 },
              ],
            },
          },
        }) as unknown,
      }),
    );
    expect(photos.releaseAll).toHaveBeenCalledWith([]);
    expect(entry.photos.map(({ photo, role }) => [photo.id, role])).toEqual([
      ['p0', 'food'],
      ['p1', 'label'],
    ]);
  });

  it.each<[string, LogDraftDto['portion'], number | null]>([
    [
      'uses the portion sent with the log',
      { count: 1.5, unit: 'burger', unitPlural: 'burgers' },
      1.5,
    ],
    ["falls back to the draft's portion", undefined, 2],
    ['clears the portion with null', null, null],
  ])('%s', async (_label, portion, expected) => {
    const { service, tx } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      mode: 'text',
      portionCount: 2,
      portionUnit: 'burger',
      portionUnitPlural: 'burgers',
      photos: [],
      analysis: null,
    });
    tx.entry.create.mockResolvedValueOnce(loggedEntry([]));

    await service.log(USER_ID, DRAFT_ID, {
      name: LOG.name,
      mealType: LOG.mealType,
      timestamp: LOG.timestamp,
      localDate: LOG.localDate,
      items: LOG.items,
      portion,
    });

    expect(tx.draft.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          portionCount: true,
          portionUnit: true,
          portionUnitPlural: true,
        }) as unknown,
      }),
    );
    expect(tx.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          portionCount: expected,
          portionUnit: expected === null ? null : 'burger',
        }) as unknown,
      }),
    );
  });

  it("takes the analysis' photos when the draft has none", async () => {
    const { service, tx } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      mode: 'text',
      photos: [],
      analysis: {
        id: ANALYSIS_ID,
        userId: USER_ID,
        mode: 'nutrition_label',
        photoId: 'a1',
        rawResponse: null,
        photos: [
          { photoId: 'a1', role: 'label' },
          { photoId: 'a2', role: 'food' },
        ],
      },
    });
    tx.entry.create.mockRejectedValueOnce(new Error('stop'));

    await expect(service.log(USER_ID, DRAFT_ID, LOG)).rejects.toThrow('stop');

    expect(tx.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'nutrition_label',
          analysisId: ANALYSIS_ID,
          photoId: 'a2',
          photos: {
            createMany: {
              data: [
                { photoId: 'a1', role: 'label', position: 0 },
                { photoId: 'a2', role: 'food', position: 1 },
              ],
            },
          },
        }) as unknown,
      }),
    );
  });

  it('ignores an analysis that does not belong to the user', async () => {
    const { service, tx } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      mode: 'food_photo',
      photos: [{ photoId: 'p0', role: 'food' }],
      analysis: {
        id: ANALYSIS_ID,
        userId: 'someone-else',
        mode: 'nutrition_label',
        photoId: 'other',
        rawResponse: { secret: true },
      },
    });
    tx.entry.create.mockRejectedValueOnce(new Error('stop'));

    await expect(service.log(USER_ID, DRAFT_ID, LOG)).rejects.toThrow('stop');

    expect(tx.entry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'food_photo',
          photoId: 'p0',
          analysisId: null,
        }) as unknown,
      }),
    );
  });

  it('logs linked items and counts the use of their saved foods', async () => {
    const { service, tx } = setup();
    tx.draft.findFirst.mockResolvedValueOnce({
      id: DRAFT_ID,
      mode: 'text',
      photos: [],
      analysis: null,
    });
    tx.entry.create.mockResolvedValueOnce(loggedEntry([]));

    await service.log(USER_ID, DRAFT_ID, {
      name: LOG.name,
      mealType: LOG.mealType,
      timestamp: LOG.timestamp,
      localDate: LOG.localDate,
      items: [
        {
          name: 'Rice',
          grams: 180,
          nutrients: zeroNutrients(),
          productId: SAVED_FOOD_ID,
        },
        {
          name: 'Sauce',
          grams: 20,
          nutrients: zeroNutrients(),
          productId: FOREIGN_FOOD_ID,
        },
      ],
    });

    const [args] = tx.entry.create.mock.calls[0] as [
      {
        data: {
          items: { createMany: { data: { productId: string | null }[] } };
        };
      },
    ];
    expect(
      args.data.items.createMany.data.map(({ productId }) => productId),
    ).toEqual([SAVED_FOOD_ID, null]);
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: [SAVED_FOOD_ID] } },
      data: { useCount: { increment: 1 }, lastUsedAt: expect.any(Date) },
    });
  });
});
