import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DaysService } from './days.service.js';
import { ParseLocalDatePipe } from './local-date.pipe.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const DATE = '2026-09-28';

function setup() {
  const prisma = {
    dayMeta: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  const service = new DaysService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('DaysService', () => {
  it('returns a rest day when nothing is stored for the date', async () => {
    const { prisma, service } = setup();
    prisma.dayMeta.findUnique.mockResolvedValue(null);

    await expect(service.get(USER_ID, DATE)).resolves.toEqual({
      date: DATE,
      trainingDay: false,
    });
    expect(prisma.dayMeta.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_date: { userId: USER_ID, date: DATE } },
      }),
    );
  });

  it('returns the stored day', async () => {
    const { prisma, service } = setup();
    prisma.dayMeta.findUnique.mockResolvedValue({
      date: DATE,
      trainingDay: true,
    });

    await expect(service.get(USER_ID, DATE)).resolves.toEqual({
      date: DATE,
      trainingDay: true,
    });
  });

  it('upserts the day scoped to the user', async () => {
    const { prisma, service } = setup();
    prisma.dayMeta.upsert.mockResolvedValue({ date: DATE, trainingDay: true });

    await expect(
      service.put(USER_ID, DATE, { trainingDay: true }),
    ).resolves.toEqual({ date: DATE, trainingDay: true });
    expect(prisma.dayMeta.upsert).toHaveBeenCalledWith({
      where: { userId_date: { userId: USER_ID, date: DATE } },
      create: { userId: USER_ID, date: DATE, trainingDay: true },
      update: { trainingDay: true },
      select: { date: true, trainingDay: true },
    });
  });
});

describe('ParseLocalDatePipe', () => {
  const pipe = new ParseLocalDatePipe();

  it('passes valid dates through', () => {
    expect(pipe.transform('2028-02-29')).toBe('2028-02-29');
  });

  it.each(['2026-02-30', '2026-13-01', '26-09-28', 'today', '', undefined])(
    'rejects %s',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
