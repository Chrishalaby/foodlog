import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WeightsService } from './weights.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const DATE = '2026-09-28';
const NOW = new Date('2026-09-28T10:00:00.000Z');
const SELECT = { date: true, weightKg: true, bodyFatPct: true };

function setup() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    weightLog: {
      upsert: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
    profile: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
    weightLog: { findMany: vi.fn(), findFirst: vi.fn() },
    entry: { groupBy: vi.fn() },
  };
  const service = new WeightsService(prisma as unknown as PrismaService);
  return { tx, prisma, service };
}

describe('WeightsService.upsert', () => {
  it('rounds, upserts under the user lock and syncs the profile for the latest date', async () => {
    const { tx, service } = setup();
    tx.weightLog.upsert.mockResolvedValue({
      date: DATE,
      weightKg: 80.3,
      bodyFatPct: 18.4,
    });
    tx.weightLog.count.mockResolvedValue(0);

    await expect(
      service.upsert(USER_ID, DATE, { weightKg: 80.26, bodyFatPct: 18.44 }),
    ).resolves.toEqual({ date: DATE, weightKg: 80.3, bodyFatPct: 18.4 });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.weightLog.upsert).toHaveBeenCalledWith({
      where: { userId_date: { userId: USER_ID, date: DATE } },
      create: { userId: USER_ID, date: DATE, weightKg: 80.3, bodyFatPct: 18.4 },
      update: { weightKg: 80.3, bodyFatPct: 18.4 },
      select: SELECT,
    });
    expect(tx.weightLog.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, date: { gt: DATE } },
    });
    expect(tx.profile.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      create: { userId: USER_ID, weightKg: 80.3, bodyFatPct: 18.4 },
      update: { weightKg: 80.3, bodyFatPct: 18.4 },
    });
  });

  it('keeps the stored body fat of the weigh-in and the profile when none is sent', async () => {
    const { tx, service } = setup();
    tx.weightLog.upsert.mockResolvedValue({
      date: DATE,
      weightKg: 80,
      bodyFatPct: 18,
    });
    tx.weightLog.count.mockResolvedValue(0);

    await expect(
      service.upsert(USER_ID, DATE, { weightKg: 80 }),
    ).resolves.toEqual({ date: DATE, weightKg: 80, bodyFatPct: 18 });

    expect(tx.weightLog.upsert).toHaveBeenCalledWith({
      where: { userId_date: { userId: USER_ID, date: DATE } },
      create: { userId: USER_ID, date: DATE, weightKg: 80 },
      update: { weightKg: 80 },
      select: SELECT,
    });
    expect(tx.profile.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      create: { userId: USER_ID, weightKg: 80 },
      update: { weightKg: 80 },
    });
  });

  it('clears the weigh-in body fat on an explicit null without clearing the profile one', async () => {
    const { tx, service } = setup();
    tx.weightLog.upsert.mockResolvedValue({
      date: DATE,
      weightKg: 80,
      bodyFatPct: null,
    });
    tx.weightLog.count.mockResolvedValue(0);

    await service.upsert(USER_ID, DATE, { weightKg: 80, bodyFatPct: null });

    expect(tx.weightLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: USER_ID, date: DATE, weightKg: 80, bodyFatPct: null },
        update: { weightKg: 80, bodyFatPct: null },
      }),
    );
    expect(tx.profile.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      create: { userId: USER_ID, weightKg: 80 },
      update: { weightKg: 80 },
    });
  });

  it('accepts the latest local date on Earth and rejects later dates', async () => {
    const { tx, service } = setup();
    tx.weightLog.upsert.mockResolvedValue({
      date: '2026-09-29',
      weightKg: 80,
      bodyFatPct: null,
    });
    tx.weightLog.count.mockResolvedValue(0);

    await expect(
      service.upsert(USER_ID, '2026-09-29', { weightKg: 80 }, NOW),
    ).resolves.toMatchObject({ date: '2026-09-29' });
    await expect(
      service.upsert(USER_ID, '2026-09-30', { weightKg: 80 }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.weightLog.upsert).toHaveBeenCalledTimes(1);
  });

  it('leaves the profile alone when a newer weigh-in exists', async () => {
    const { tx, service } = setup();
    tx.weightLog.upsert.mockResolvedValue({
      date: DATE,
      weightKg: 80,
      bodyFatPct: null,
    });
    tx.weightLog.count.mockResolvedValue(2);

    await service.upsert(USER_ID, DATE, { weightKg: 80 });

    expect(tx.profile.upsert).not.toHaveBeenCalled();
  });
});

describe('WeightsService.remove', () => {
  it('throws 404 when there is no weigh-in on the date', async () => {
    const { tx, service } = setup();
    tx.weightLog.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove(USER_ID, DATE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.weightLog.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, date: DATE },
    });
    expect(tx.profile.upsert).not.toHaveBeenCalled();
  });

  it('falls back to the new latest weigh-in when the latest one is deleted', async () => {
    const { tx, service } = setup();
    tx.weightLog.deleteMany.mockResolvedValue({ count: 1 });
    tx.weightLog.findFirst.mockResolvedValue({
      date: '2026-09-20',
      weightKg: 81.5,
      bodyFatPct: null,
    });

    await service.remove(USER_ID, DATE);

    expect(tx.weightLog.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: { date: 'desc' },
      select: SELECT,
    });
    expect(tx.profile.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      create: { userId: USER_ID, weightKg: 81.5 },
      update: { weightKg: 81.5 },
    });
  });

  it('leaves the profile alone when an older weigh-in or the last one is deleted', async () => {
    const older = setup();
    older.tx.weightLog.deleteMany.mockResolvedValue({ count: 1 });
    older.tx.weightLog.findFirst.mockResolvedValue({
      date: '2026-09-30',
      weightKg: 79,
      bodyFatPct: null,
    });
    await older.service.remove(USER_ID, DATE);
    expect(older.tx.profile.upsert).not.toHaveBeenCalled();

    const last = setup();
    last.tx.weightLog.deleteMany.mockResolvedValue({ count: 1 });
    last.tx.weightLog.findFirst.mockResolvedValue(null);
    await last.service.remove(USER_ID, DATE);
    expect(last.tx.profile.upsert).not.toHaveBeenCalled();
  });
});

describe('WeightsService.signals', () => {
  it('reads the 28-day window before to and returns weigh-ins with the adaptive TDEE', async () => {
    const { prisma, service } = setup();
    prisma.weightLog.findMany.mockResolvedValue([
      { date: '2026-09-20', weightKg: 80, bodyFatPct: null },
    ]);
    prisma.entry.groupBy.mockResolvedValue([]);

    await expect(service.signals(USER_ID, DATE)).resolves.toEqual({
      weights: [{ date: '2026-09-20', weightKg: 80 }],
      adaptiveTdee: null,
    });
    expect(prisma.weightLog.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, date: { gte: '2026-08-31', lte: DATE } },
      orderBy: { date: 'asc' },
      select: SELECT,
    });
    expect(prisma.entry.groupBy).toHaveBeenCalledWith({
      by: ['localDate'],
      where: {
        userId: USER_ID,
        localDate: { gte: '2026-08-31', lte: '2026-09-27' },
      },
      _sum: { calories: true },
      _count: { _all: true },
    });
  });
});
