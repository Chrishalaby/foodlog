import { zeroNutrients } from '@food/shared';
import { ENTRY_INCLUDE } from '../common/mappers.js';
import { NOTE_INCLUDE } from '../notes/note-mapper.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProfileService } from '../profile/profile.service.js';
import { ExportService } from './export.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const ENTRY_ID = '019a0000-0000-7000-8000-0000000000e1';
const NOW = new Date('2026-09-28T08:00:00.000Z');
const FOOD_PHOTO_ID = '019a0000-0000-7000-8000-0000000000f1';
const LABEL_PHOTO_ID = '019a0000-0000-7000-8000-0000000000f2';
const FLUID_ID = '019a0000-0000-7000-8000-0000000000a1';
const NOTE_ID = '019a0000-0000-7000-8000-0000000000b1';
const DONE_NOTE_ID = '019a0000-0000-7000-8000-0000000000b2';

function storedPhoto(id: string) {
  return {
    id,
    userId: USER_ID,
    storageKey: `photos/${id}.jpg`,
    thumbKey: `photos/${id}_thumb.webp`,
    width: 1344,
    height: 1792,
    bytes: 1000,
    createdAt: NOW,
  };
}

function entryRow() {
  return {
    id: ENTRY_ID,
    userId: USER_ID,
    name: 'Labneh',
    description: null,
    mealType: 'breakfast',
    source: 'text',
    timestamp: NOW,
    localDate: '2026-09-28',
    photoId: FOOD_PHOTO_ID,
    analysisId: null,
    favoriteId: null,
    productId: null,
    ...zeroNutrients(),
    calories: 160,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: 'item-1',
        entryId: ENTRY_ID,
        position: 0,
        name: 'Labneh',
        grams: 100,
        confidence: 'high',
        ...zeroNutrients(),
        calories: 160,
      },
    ],
    photo: storedPhoto(FOOD_PHOTO_ID),
    photos: [
      {
        entryId: ENTRY_ID,
        photoId: LABEL_PHOTO_ID,
        role: 'label',
        position: 1,
        photo: storedPhoto(LABEL_PHOTO_ID),
      },
      {
        entryId: ENTRY_ID,
        photoId: FOOD_PHOTO_ID,
        role: 'food',
        position: 0,
        photo: storedPhoto(FOOD_PHOTO_ID),
      },
    ],
  };
}

function setup() {
  const prisma = {
    entry: { findMany: vi.fn().mockResolvedValue([entryRow()]) },
    favorite: { findMany: vi.fn().mockResolvedValue([]) },
    dayMeta: { findMany: vi.fn().mockResolvedValue([]) },
    weightLog: { findMany: vi.fn().mockResolvedValue([]) },
    fluidLog: { findMany: vi.fn().mockResolvedValue([]) },
    note: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const profiles = { getProfile: vi.fn().mockResolvedValue({}) };
  const service = new ExportService(
    prisma as unknown as PrismaService,
    profiles as unknown as ProfileService,
  );
  return { prisma, service };
}

describe('ExportService', () => {
  it('never loads the raw AI response of entries for a CSV export', async () => {
    const { prisma, service } = setup();

    const file = await service.export(USER_ID, 'csv', NOW);

    expect(prisma.entry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        include: ENTRY_INCLUDE,
        omit: { rawAiJson: true },
      }),
    );
    expect(file.body.toString('utf8')).toContain(ENTRY_ID);
  });

  it('never loads or exports the raw AI response in a JSON export', async () => {
    const { prisma, service } = setup();

    const document = await service.document(USER_ID, NOW);

    expect(prisma.entry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ omit: { rawAiJson: true } }),
    );
    expect(document.entries).toHaveLength(1);
    expect(document.entries[0]).not.toHaveProperty('rawAiJson');
    expect(document.entries[0]).toMatchObject({ id: ENTRY_ID, name: 'Labneh' });
  });

  it('exports the fluid logs in time order without touching the CSV', async () => {
    const { prisma, service } = setup();
    prisma.fluidLog.findMany.mockResolvedValue([
      {
        id: FLUID_ID,
        localDate: '2026-09-27',
        timestamp: new Date('2026-09-27T22:10:00.000Z'),
        ml: 250,
        kind: 'water',
        createdAt: new Date('2026-09-27T22:10:01.000Z'),
      },
    ]);

    const document = await service.document(USER_ID, NOW);
    const csv = await service.export(USER_ID, 'csv', NOW);

    expect(prisma.fluidLog.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        localDate: true,
        timestamp: true,
        ml: true,
        kind: true,
        createdAt: true,
      },
    });
    expect(document.fluids).toEqual([
      {
        id: FLUID_ID,
        localDate: '2026-09-27',
        timestamp: '2026-09-27T22:10:00.000Z',
        ml: 250,
        kind: 'water',
        createdAt: '2026-09-27T22:10:01.000Z',
      },
    ]);
    expect(csv.body.toString('utf8')).not.toContain(FLUID_ID);
  });

  it('exports the notes oldest first with their photos, without touching the CSV', async () => {
    const { prisma, service } = setup();
    const doneAt = new Date('2026-09-28T07:00:00.000Z');
    prisma.note.findMany.mockResolvedValue([
      {
        id: NOTE_ID,
        userId: USER_ID,
        text: 'Install this for the bathroom',
        done: false,
        doneAt: null,
        createdAt: new Date('2026-09-27T10:00:00.000Z'),
        updatedAt: new Date('2026-09-27T10:00:00.000Z'),
        photos: [
          {
            noteId: NOTE_ID,
            photoId: LABEL_PHOTO_ID,
            position: 1,
            photo: storedPhoto(LABEL_PHOTO_ID),
          },
          {
            noteId: NOTE_ID,
            photoId: FOOD_PHOTO_ID,
            position: 0,
            photo: storedPhoto(FOOD_PHOTO_ID),
          },
        ],
      },
      {
        id: DONE_NOTE_ID,
        userId: USER_ID,
        text: 'Buy mirror',
        done: true,
        doneAt,
        createdAt: new Date('2026-09-27T11:00:00.000Z'),
        updatedAt: doneAt,
        photos: [],
      },
    ]);

    const document = await service.document(USER_ID, NOW);
    const csv = await service.export(USER_ID, 'csv', NOW);

    expect(prisma.note.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.note.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      include: NOTE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(document.notes).toEqual([
      {
        id: NOTE_ID,
        text: 'Install this for the bathroom',
        photos: [FOOD_PHOTO_ID, LABEL_PHOTO_ID].map((id) => ({
          id,
          url: `/api/photos/${id}`,
          thumbUrl: `/api/photos/${id}/thumb`,
          width: 1344,
          height: 1792,
        })),
        done: false,
        doneAt: null,
        createdAt: '2026-09-27T10:00:00.000Z',
        updatedAt: '2026-09-27T10:00:00.000Z',
      },
      {
        id: DONE_NOTE_ID,
        text: 'Buy mirror',
        photos: [],
        done: true,
        doneAt: '2026-09-28T07:00:00.000Z',
        createdAt: '2026-09-27T11:00:00.000Z',
        updatedAt: '2026-09-28T07:00:00.000Z',
      },
    ]);
    expect(csv.body.toString('utf8')).not.toContain('Buy mirror');
  });

  it('exports every photo of an entry in order', async () => {
    const { service } = setup();

    const document = await service.document(USER_ID, NOW);

    expect(document.entries[0]?.photo?.id).toBe(FOOD_PHOTO_ID);
    expect(
      document.entries[0]?.photos.map(({ photo, role }) => [photo.id, role]),
    ).toEqual([
      [FOOD_PHOTO_ID, 'food'],
      [LABEL_PHOTO_ID, 'label'],
    ]);
  });
});
