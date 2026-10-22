import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { NotFoundException } from '@nestjs/common';
import { LocalStorageDriver } from './local-storage.driver.js';
import { InvalidStorageKeyError } from './storage-key.js';

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

describe('LocalStorageDriver', () => {
  let root: string;
  let storage: LocalStorageDriver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'foodlog-storage-'));
    storage = new LocalStorageDriver(join(root, 'nested', 'photos'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes into missing directories and reads the data back', async () => {
    const data = Buffer.from('hello photo');

    await storage.put('photos/a.jpg', data, 'image/jpeg');

    await expect(storage.get('photos/a.jpg')).resolves.toEqual(data);
    await expect(
      readFile(join(root, 'nested', 'photos', 'photos', 'a.jpg')),
    ).resolves.toEqual(data);
    expect(await readdir(join(root, 'nested', 'photos', 'photos'))).toEqual([
      'a.jpg',
    ]);
  });

  it('overwrites existing files', async () => {
    await storage.put('photos/a.jpg', Buffer.from('one'), 'image/jpeg');
    await storage.put('photos/a.jpg', Buffer.from('two'), 'image/jpeg');

    await expect(storage.get('photos/a.jpg')).resolves.toEqual(
      Buffer.from('two'),
    );
  });

  it('streams stored files', async () => {
    const data = Buffer.alloc(200_000, 7);
    await storage.put('photos/big.webp', data, 'image/webp');

    const stream = await storage.getStream('photos/big.webp');

    await expect(readStream(stream)).resolves.toEqual(data);
  });

  it('throws NotFoundException for missing files', async () => {
    await expect(storage.get('photos/missing.jpg')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      storage.getStream('photos/missing.jpg'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes idempotently', async () => {
    await storage.put('photos/a.jpg', Buffer.from('x'), 'image/jpeg');

    await storage.delete('photos/a.jpg');
    await storage.delete('photos/a.jpg');

    await expect(storage.get('photos/a.jpg')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    '../escape.jpg',
    'photos/../../escape.jpg',
    '/etc/passwd',
    'photos//a.jpg',
    '.hidden',
    'photos/./a.jpg',
    'photos\\a.jpg',
    '',
  ])('rejects the unsafe key %j', async (key) => {
    await expect(
      storage.put(key, Buffer.from('x'), 'image/jpeg'),
    ).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.get(key)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    await expect(storage.delete(key)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
  });
});
