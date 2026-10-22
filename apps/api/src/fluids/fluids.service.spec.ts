import { NotFoundException } from '@nestjs/common';
import type { DaysService } from '../days/days.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProfileService } from '../profile/profile.service.js';
import { FluidsService } from './fluids.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const LOG_ID = '019a0000-0000-7000-8000-0000000000a1';
const ENTRY_ID = '019a0000-0000-7000-8000-0000000000e1';
const DATE = '2026-10-01';
const SELECT = {
  id: true,
  localDate: true,
  timestamp: true,
  ml: true,
  kind: true,
  createdAt: true,
};

function storedLog(overrides: Record<string, unknown> = {}) {
  return {
    id: LOG_ID,
    localDate: DATE,
    timestamp: new Date('2026-10-01T09:00:00.000Z'),
    ml: 250,
    kind: 'water',
    createdAt: new Date('2026-10-01T09:00:01.000Z'),
    ...overrides,
  };
}

function setup() {
  const prisma = {
    fluidLog: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    entryItem: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const profiles = {
    getProfile: vi
      .fn()
      .mockResolvedValue({ weightKg: 80, fluidTargetMl: null }),
  };
  const days = {
    get: vi.fn().mockResolvedValue({ date: DATE, trainingDay: false }),
  };
  const service = new FluidsService(
    prisma as unknown as PrismaService,
    profiles as unknown as ProfileService,
    days as unknown as DaysService,
  );
  return { prisma, profiles, days, service };
}

describe('FluidsService.day', () => {
  it('combines the logs and the drinks inside meals of that day', async () => {
    const { prisma, service } = setup();
    prisma.fluidLog.findMany.mockResolvedValue([
      storedLog({ id: 'water-1' }),
      storedLog({ id: 'water-2', timestamp: new Date('2026-10-01T15:00:00Z') }),
      storedLog({ id: 'coffee', ml: 200, kind: 'coffee' }),
    ]);
    prisma.entryItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        name: 'Diet Pepsi',
        position: 1,
        fluidMl: 330,
        entry: {
          id: ENTRY_ID,
          name: 'Chicken burger meal',
          timestamp: new Date('2026-10-01T10:30:00.000Z'),
        },
      },
    ]);

    const day = await service.day(USER_ID, DATE);

    expect(day).toMatchObject({
      date: DATE,
      targetMl: 2800,
      logsMl: 700,
      foodMl: 330,
      totalMl: 1030,
      caffeineMg: 80,
    });
    expect(day.logs.map(({ id }) => id)).toEqual([
      'water-1',
      'water-2',
      'coffee',
    ]);
    expect(day.drinks).toEqual([
      {
        entryId: ENTRY_ID,
        itemId: 'item-1',
        entryName: 'Chicken burger meal',
        name: 'Diet Pepsi',
        ml: 330,
        timestamp: '2026-10-01T10:30:00.000Z',
      },
    ]);
    expect(prisma.fluidLog.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, localDate: DATE },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: SELECT,
    });
    expect(prisma.entryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fluidMl: { gt: 0 },
          entry: { userId: USER_ID, localDate: DATE },
        },
      }),
    );
  });

  it('adds the training-day bonus to the automatic target', async () => {
    const { days, service } = setup();
    days.get.mockResolvedValue({ date: DATE, trainingDay: true });

    await expect(service.day(USER_ID, DATE)).resolves.toMatchObject({
      targetMl: 3300,
    });
    expect(days.get).toHaveBeenCalledWith(USER_ID, DATE);
  });

  it('uses the custom target from the profile as is', async () => {
    const { days, profiles, service } = setup();
    profiles.getProfile.mockResolvedValue({
      weightKg: 80,
      fluidTargetMl: 3000,
    });
    days.get.mockResolvedValue({ date: DATE, trainingDay: true });

    await expect(service.day(USER_ID, DATE)).resolves.toMatchObject({
      targetMl: 3000,
    });
  });
});

describe('FluidsService writes', () => {
  it('creates a log for the user with whole millilitres', async () => {
    const { prisma, service } = setup();
    prisma.fluidLog.create.mockResolvedValue(storedLog({ ml: 330 }));

    await expect(
      service.create(USER_ID, {
        ml: 330.2,
        kind: 'water',
        timestamp: '2026-10-01T09:00:00.000Z',
        localDate: DATE,
      }),
    ).resolves.toMatchObject({ id: LOG_ID, ml: 330, localDate: DATE });
    expect(prisma.fluidLog.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        ml: 330,
        kind: 'water',
        timestamp: new Date('2026-10-01T09:00:00.000Z'),
        localDate: DATE,
      },
      select: SELECT,
    });
  });

  it('updates only the user’s own log', async () => {
    const { prisma, service } = setup();
    prisma.fluidLog.findFirst.mockResolvedValue({ id: LOG_ID });
    prisma.fluidLog.update.mockResolvedValue(
      storedLog({ ml: 500, kind: 'tea' }),
    );

    await expect(
      service.update(USER_ID, LOG_ID, { ml: 500, kind: 'tea' }),
    ).resolves.toMatchObject({ ml: 500, kind: 'tea' });
    expect(prisma.fluidLog.findFirst).toHaveBeenCalledWith({
      where: { id: LOG_ID, userId: USER_ID },
      select: { id: true },
    });
    expect(prisma.fluidLog.update).toHaveBeenCalledWith({
      where: { id: LOG_ID, userId: USER_ID },
      data: { ml: 500, kind: 'tea' },
      select: SELECT,
    });
  });

  it('reports a missing or foreign log as not found', async () => {
    const { prisma, service } = setup();
    prisma.fluidLog.findFirst.mockResolvedValue(null);
    prisma.fluidLog.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(USER_ID, LOG_ID, { ml: 500 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(USER_ID, LOG_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.fluidLog.update).not.toHaveBeenCalled();
  });

  it('deletes the user’s own log', async () => {
    const { prisma, service } = setup();
    prisma.fluidLog.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove(USER_ID, LOG_ID)).resolves.toBeUndefined();
    expect(prisma.fluidLog.deleteMany).toHaveBeenCalledWith({
      where: { id: LOG_ID, userId: USER_ID },
    });
  });
});
