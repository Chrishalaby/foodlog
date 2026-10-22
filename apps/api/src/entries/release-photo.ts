import type { Logger } from '@nestjs/common';
import type { PhotosService } from '../photos/photos.service.js';

export async function releasePhoto(
  photos: PhotosService,
  logger: Logger,
  photoId: string | null,
): Promise<void> {
  if (!photoId) {
    return;
  }
  try {
    await photos.deleteIfUnreferenced(photoId);
  } catch (error) {
    logger.warn(
      `Could not release photo ${photoId}; the orphan cleanup will retry: ${String(error)}`,
    );
  }
}
