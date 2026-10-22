import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FoodLibraryRepository } from './food-library.repository.js';
import { HiddenFoodsService } from './hidden-foods.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';

function setup(stored: string[] | null = ['granola']) {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue(stored === null ? [] : [{ hiddenFoods: stored }]),
    profile: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const library = {
    hiddenNames: vi.fn().mockResolvedValue(stored ?? []),
  };
  const service = new HiddenFoodsService(
    prisma as unknown as PrismaService,
    library as unknown as FoodLibraryRepository,
  );
  return { tx, prisma, library, service };
}

function queryValues(call: unknown[] | undefined): unknown[] {
  const [, ...values] = call ?? [];
  return values;
}

describe('HiddenFoodsService', () => {
  it('lists the hidden names of the user', async () => {
    const { library, service } = setup(['granola', 'toast']);

    await expect(service.list(USER_ID)).resolves.toEqual({
      names: ['granola', 'toast'],
    });
    expect(library.hiddenNames).toHaveBeenCalledWith(USER_ID);
  });

  it('creates the profile when missing and stores the normalized name', async () => {
    const { tx, service } = setup(null);

    const result = await service.hide(USER_ID, ' Café  LATTE ');

    expect(result).toEqual({ names: ['cafe latte'] });
    expect(tx.profile.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID }],
      skipDuplicates: true,
    });
    expect(queryValues(tx.$queryRaw.mock.calls[0])).toEqual([USER_ID]);
    expect(tx.profile.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { hiddenFoods: { set: ['cafe latte'] } },
    });
  });

  it('locks the profile row while changing the list', async () => {
    const { tx, service } = setup();

    await service.hide(USER_ID, 'Toast');

    const [sql] = tx.$queryRaw.mock.calls[0] ?? [];
    expect((sql as readonly string[]).join('')).toContain('FOR UPDATE');
    expect(tx.profile.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { hiddenFoods: { set: ['granola', 'toast'] } },
    });
  });

  it('does not write when the name is already hidden', async () => {
    const { tx, service } = setup();

    await expect(service.hide(USER_ID, 'GRANOLA')).resolves.toEqual({
      names: ['granola'],
    });
    expect(tx.profile.update).not.toHaveBeenCalled();
  });

  it('rejects a name without letters or digits before touching the profile', async () => {
    const { prisma, service } = setup();

    await expect(service.hide(USER_ID, '́')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('unhides a name without creating a profile', async () => {
    const { tx, service } = setup(['granola', 'toast']);

    await expect(service.unhide(USER_ID, 'Granola')).resolves.toEqual({
      names: ['toast'],
    });
    expect(tx.profile.createMany).not.toHaveBeenCalled();
    expect(tx.profile.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { hiddenFoods: { set: ['toast'] } },
    });
  });

  it('does not write when unhiding a name that is not hidden', async () => {
    const { tx, service } = setup(null);

    await expect(service.unhide(USER_ID, 'Granola')).resolves.toEqual({
      names: [],
    });
    expect(tx.profile.update).not.toHaveBeenCalled();
  });
});
