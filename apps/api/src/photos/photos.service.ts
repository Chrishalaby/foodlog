import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Photo, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  type PhotoEncodingOptions,
  type PhotoRole,
  processPhoto,
} from './photo-processing.js';

export type CreatePhotoOptions = PhotoEncodingOptions;

export interface PhotoUpload {
  buffer: Buffer;
  role: PhotoRole;
}

const UNREFERENCED_PHOTO = {
  entries: { none: {} },
  entryPhotos: { none: {} },
  favorites: { none: {} },
  analyses: { none: {} },
  analysisPhotos: { none: {} },
  draftPhotos: { none: {} },
  notePhotos: { none: {} },
} as const satisfies Prisma.PhotoWhereInput;

const ORPHAN_BATCH_SIZE = 100;
const PHOTO_DELETE_TIMEOUT_MS = 30_000;

type PhotoFiles = Pick<Photo, 'storageKey' | 'thumbKey'>;

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createFromUpload(
    userId: string,
    buffer: Buffer,
    options: CreatePhotoOptions,
  ): Promise<Photo> {
    const processed = await processPhoto(buffer, options);
    const baseKey = `photos/${randomUUID()}`;
    const files: PhotoFiles = {
      storageKey: `${baseKey}.jpg`,
      thumbKey: `${baseKey}_thumb.webp`,
    };
    try {
      await this.storage.put(files.storageKey, processed.full, 'image/jpeg');
      await this.storage.put(files.thumbKey, processed.thumb, 'image/webp');
      return await this.prisma.photo.create({
        data: {
          userId,
          ...files,
          width: processed.width,
          height: processed.height,
          bytes: processed.full.length,
        },
      });
    } catch (error) {
      await this.removeFilesBestEffort(files);
      throw error;
    }
  }

  async createManyFromUploads(
    userId: string,
    uploads: readonly PhotoUpload[],
  ): Promise<Photo[]> {
    const results = await Promise.allSettled(
      uploads.map(({ buffer, role }) =>
        this.createFromUpload(userId, buffer, { role }),
      ),
    );
    const stored = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) {
      await this.releaseAll(stored.map(({ id }) => id));
      throw failure.reason;
    }
    return stored;
  }

  async findOwned(userId: string, id: string): Promise<Photo> {
    const photo = await this.prisma.photo.findFirst({ where: { id, userId } });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    return photo;
  }

  readFull(photo: PhotoFiles): Promise<Buffer> {
    return this.storage.get(photo.storageKey);
  }

  openFull(photo: PhotoFiles): Promise<Readable> {
    return this.storage.getStream(photo.storageKey);
  }

  openThumb(photo: PhotoFiles): Promise<Readable> {
    return this.storage.getStream(photo.thumbKey);
  }

  async deleteIfUnreferenced(
    photoId: string | null | undefined,
  ): Promise<boolean> {
    if (!photoId) {
      return false;
    }
    return this.prisma.$transaction(
      async (tx) => {
        const photo = await tx.photo.findUnique({
          where: { id: photoId },
          select: { storageKey: true, thumbKey: true },
        });
        if (!photo) {
          return false;
        }
        const { count } = await tx.photo.deleteMany({
          where: { id: photoId, ...UNREFERENCED_PHOTO },
        });
        if (count === 0) {
          return false;
        }
        await this.removeFilesStrict(photo);
        return true;
      },
      { timeout: PHOTO_DELETE_TIMEOUT_MS },
    );
  }

  async releaseAll(photoIds: readonly string[]): Promise<void> {
    for (const photoId of new Set(photoIds)) {
      try {
        await this.deleteIfUnreferenced(photoId);
      } catch (error) {
        this.logger.warn(
          `Could not release photo ${photoId}; the orphan cleanup will retry: ${String(error)}`,
        );
      }
    }
  }

  async deleteOrphansCreatedBefore(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (;;) {
      const batch = await this.prisma.photo.findMany({
        where: { createdAt: { lt: cutoff }, ...UNREFERENCED_PHOTO },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: ORPHAN_BATCH_SIZE,
      });
      let deletedInBatch = 0;
      for (const { id } of batch) {
        if (await this.deleteOrphan(id)) {
          deletedInBatch += 1;
        }
      }
      deleted += deletedInBatch;
      if (batch.length < ORPHAN_BATCH_SIZE || deletedInBatch === 0) {
        return deleted;
      }
    }
  }

  private async deleteOrphan(id: string): Promise<boolean> {
    try {
      return await this.deleteIfUnreferenced(id);
    } catch (error) {
      this.logger.warn(
        `Could not delete orphan photo ${id}; the next cleanup will retry: ${String(error)}`,
      );
      return false;
    }
  }

  private async deleteFiles(
    files: PhotoFiles,
  ): Promise<PromiseSettledResult<void>[]> {
    const results = await Promise.allSettled([
      this.storage.delete(files.storageKey),
      this.storage.delete(files.thumbKey),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to delete a photo file: ${String(result.reason)}`,
        );
      }
    }
    return results;
  }

  private async removeFilesBestEffort(files: PhotoFiles): Promise<void> {
    await this.deleteFiles(files);
  }

  private async removeFilesStrict(files: PhotoFiles): Promise<void> {
    const failure = (await this.deleteFiles(files)).find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) {
      throw failure.reason instanceof Error
        ? failure.reason
        : new Error(String(failure.reason));
    }
  }
}
