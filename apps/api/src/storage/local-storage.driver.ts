import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { NotFoundException } from '@nestjs/common';
import {
  assertValidStorageKey,
  InvalidStorageKeyError,
} from './storage-key.js';
import { StorageService } from './storage.service.js';

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

export class LocalStorageDriver extends StorageService {
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, data);
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      throw this.translateError(error);
    }
  }

  async getStream(key: string): Promise<Readable> {
    try {
      const handle = await open(this.pathFor(key), 'r');
      return handle.createReadStream();
    } catch (error) {
      throw this.translateError(error);
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    assertValidStorageKey(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) {
      throw new InvalidStorageKeyError(key);
    }
    return path;
  }

  private translateError(error: unknown): unknown {
    return isMissingFileError(error)
      ? new NotFoundException('File not found')
      : error;
  }
}
