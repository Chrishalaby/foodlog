import type { PrismaService } from '../prisma/prisma.service.js';
import { FoodRenameService } from './food-rename.service.js';
import type { RenameEntry, RenameFavorite } from './food-rename.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';

const ENTRIES: RenameEntry[] = [
  {
    id: 'e1',
    name: 'Khoury strawberry yogurt',
    items: [{ id: 'i1', name: 'Khoury strawberry yogurt' }],
  },
  {
    id: 'e2',
    name: 'khoury strawberry yogurt',
    items: [
      { id: 'i2', name: 'Khoury strawberry yogurt' },
      { id: 'i3', name: 'Granola' },
    ],
  },
];

const FAVORITES: RenameFavorite[] = [
  {
    id: 'v1',
    name: 'Khoury Strawberry Yogurt',
    items: [{ name: 'khoury strawberry yogurt', grams: 170 }],
  },
  { id: 'v2', name: 'Granola', items: [{ name: 'Granola', grams: 40 }] },
];

function setup(
  names: string[] = ['Khoury strawberry yogurt', 'Granola'],
  entries: RenameEntry[] = ENTRIES,
  favorites: RenameFavorite[] = [],
) {
  const client = {
    entry: {
      groupBy: vi.fn().mockResolvedValue(names.map((name) => ({ name }))),
      findMany: vi.fn().mockResolvedValue(entries),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    entryItem: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    favorite: {
      findMany: vi.fn().mockResolvedValue(favorites),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    ...client,
    $transaction: vi.fn((run: (tx: typeof client) => Promise<unknown>) =>
      run(client),
    ),
  };
  const service = new FoodRenameService(prisma as unknown as PrismaService);
  return { client, prisma, service };
}

describe('FoodRenameService', () => {
  it('counts a dry run without a transaction or any write', async () => {
    const { client, prisma, service } = setup();

    const result = await service.rename(USER_ID, {
      from: 'KHOURY strawberry yogurt',
      to: 'Strawberry yogurt cup',
      dryRun: true,
    });

    expect(result).toEqual({
      matchedEntries: 2,
      renamedEntries: 2,
      renamedItems: 1,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(client.entry.updateMany).not.toHaveBeenCalled();
    expect(client.entryItem.updateMany).not.toHaveBeenCalled();
    expect(client.favorite.updateMany).not.toHaveBeenCalled();
  });

  it('loads only entries of the user whose name matches', async () => {
    const { client, service } = setup([
      'Khoury strawberry yogurt',
      'khoury  STRAWBERRY yogurt ×2',
      'Granola',
    ]);

    await service.rename(USER_ID, {
      from: 'Khoury strawberry yogurt',
      to: 'Yogurt cup',
      dryRun: true,
    });

    expect(client.entry.groupBy).toHaveBeenCalledWith({
      by: ['name'],
      where: { userId: USER_ID },
    });
    expect(client.entry.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        name: {
          in: ['Khoury strawberry yogurt', 'khoury  STRAWBERRY yogurt ×2'],
        },
      },
      select: {
        id: true,
        name: true,
        items: {
          select: { id: true, name: true },
          orderBy: { position: 'asc' },
          take: 2,
        },
      },
    });
  });

  it('renames entries and single items of the user in one transaction', async () => {
    const { client, prisma, service } = setup();

    const result = await service.rename(USER_ID, {
      from: 'Khoury strawberry yogurt',
      to: 'Strawberry yogurt cup',
    });

    expect(result).toEqual({
      matchedEntries: 2,
      renamedEntries: 2,
      renamedItems: 1,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(client.entry.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ['e1', 'e2'] } },
      data: { name: 'Strawberry yogurt cup' },
    });
    expect(client.entryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['i1'] }, entry: { userId: USER_ID } },
      data: { name: 'Strawberry yogurt cup' },
    });
  });

  it('renames the servings variants of a name with their own suffix', async () => {
    const { client, service } = setup(
      ['Yogurt', 'Yogurt ×2'],
      [
        { id: 'e1', name: 'Yogurt', items: [{ id: 'i1', name: 'Yogurt' }] },
        { id: 'e2', name: 'Yogurt ×2', items: [{ id: 'i2', name: 'Yogurt' }] },
      ],
    );

    await service.rename(USER_ID, { from: 'Yogurt', to: 'Strawberry yogurt' });

    expect(client.entry.updateMany).toHaveBeenCalledTimes(2);
    expect(client.entry.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ['e1'] } },
      data: { name: 'Strawberry yogurt' },
    });
    expect(client.entry.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ['e2'] } },
      data: { name: 'Strawberry yogurt ×2' },
    });
    expect(client.entryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['i1', 'i2'] }, entry: { userId: USER_ID } },
      data: { name: 'Strawberry yogurt' },
    });
  });

  it('renames the matching favorites of the user in the same transaction', async () => {
    const { client, prisma, service } = setup(undefined, ENTRIES, FAVORITES);

    await service.rename(USER_ID, {
      from: 'Khoury strawberry yogurt',
      to: 'Strawberry yogurt cup',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(client.favorite.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { id: true, name: true, items: true },
    });
    expect(client.favorite.updateMany).toHaveBeenCalledTimes(1);
    expect(client.favorite.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1', userId: USER_ID },
      data: {
        name: 'Strawberry yogurt cup',
        items: [{ name: 'Strawberry yogurt cup', grams: 170 }],
      },
    });
  });

  it('renames a favorite even when no entry has the name any more', async () => {
    const { client, service } = setup(['Granola'], [], FAVORITES);

    const dryRun = await service.rename(USER_ID, {
      from: 'Khoury strawberry yogurt',
      to: 'Yogurt cup',
      dryRun: true,
    });
    await service.rename(USER_ID, {
      from: 'Khoury strawberry yogurt',
      to: 'Yogurt cup',
    });

    expect(dryRun).toEqual({
      matchedEntries: 0,
      renamedEntries: 0,
      renamedItems: 0,
    });
    expect(client.entry.updateMany).not.toHaveBeenCalled();
    expect(client.favorite.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1', userId: USER_ID },
      data: {
        name: 'Yogurt cup',
        items: [{ name: 'Yogurt cup', grams: 170 }],
      },
    });
  });

  it('writes nothing when no entry has the name', async () => {
    const { client, service } = setup(['Granola']);

    const result = await service.rename(USER_ID, {
      from: 'Oats',
      to: 'Porridge',
    });

    expect(result).toEqual({
      matchedEntries: 0,
      renamedEntries: 0,
      renamedItems: 0,
    });
    expect(client.entry.findMany).not.toHaveBeenCalled();
    expect(client.entry.updateMany).not.toHaveBeenCalled();
    expect(client.entryItem.updateMany).not.toHaveBeenCalled();
    expect(client.favorite.updateMany).not.toHaveBeenCalled();
  });
});
