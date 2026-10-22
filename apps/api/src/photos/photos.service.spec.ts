import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { PhotosService } from './photos.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';

function image(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 90, g: 140, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();
}

interface Fakes {
  service: PhotosService;
  files: Map<string, Buffer>;
  photoCreate: ReturnType<typeof vi.fn>;
  photoDeleteMany: ReturnType<typeof vi.fn>;
}

function fakes(): Fakes {
  const files = new Map<string, Buffer>();
  const rows = new Map<string, { storageKey: string; thumbKey: string }>();
  let nextId = 0;
  const storage = {
    put: vi.fn((key: string, data: Buffer) => {
      files.set(key, data);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      files.delete(key);
      return Promise.resolve();
    }),
  };
  const photoCreate = vi.fn(
    ({
      data,
    }: {
      data: { storageKey: string; thumbKey: string; width: number };
    }) => {
      nextId += 1;
      const id = `photo-${nextId}`;
      rows.set(id, data);
      return Promise.resolve({ id, ...data });
    },
  );
  const photoDeleteMany = vi.fn(({ where }: { where: { id: string } }) => {
    const existed = rows.delete(where.id);
    return Promise.resolve({ count: existed ? 1 : 0 });
  });
  const tx = {
    photo: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.get(where.id) ?? null),
      ),
      deleteMany: photoDeleteMany,
    },
  };
  const prisma = {
    photo: { create: photoCreate },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  return {
    service: new PhotosService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    ),
    files,
    photoCreate,
    photoDeleteMany,
  };
}

describe('PhotosService', () => {
  it('sizes each upload to the vision patch budget whatever its role', async () => {
    const { service, photoCreate } = fakes();
    const upload = await image(3024, 4032);

    const photos = await service.createManyFromUploads(USER_ID, [
      { buffer: upload, role: 'food' },
      { buffer: upload, role: 'label' },
    ]);

    expect(photos.map(({ width, height }) => [width, height])).toEqual([
      [1344, 1792],
      [1344, 1792],
    ]);
    expect(photoCreate).toHaveBeenCalledTimes(2);
  });

  it('removes the photos already stored when another upload fails', async () => {
    const { service, files, photoDeleteMany } = fakes();

    await expect(
      service.createManyFromUploads(USER_ID, [
        { buffer: await image(800, 600), role: 'food' },
        { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), role: 'label' },
      ]),
    ).rejects.toMatchObject({ status: 400 });

    expect(files.size).toBe(0);
    expect(photoDeleteMany).toHaveBeenCalledWith({
      where: {
        id: 'photo-1',
        entries: { none: {} },
        entryPhotos: { none: {} },
        favorites: { none: {} },
        analyses: { none: {} },
        analysisPhotos: { none: {} },
        draftPhotos: { none: {} },
        notePhotos: { none: {} },
      },
    });
  });

  it('releases each photo once and keeps going when one fails', async () => {
    const { service, photoDeleteMany } = fakes();
    const [first, second] = await service.createManyFromUploads(USER_ID, [
      { buffer: await image(400, 300), role: 'food' },
      { buffer: await image(400, 300), role: 'food' },
    ]);
    photoDeleteMany.mockRejectedValueOnce(new Error('database unavailable'));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.releaseAll([first!.id, first!.id, second!.id]),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }

    expect(photoDeleteMany.mock.calls.map(([{ where }]) => where.id)).toEqual([
      first!.id,
      second!.id,
    ]);
  });
});
