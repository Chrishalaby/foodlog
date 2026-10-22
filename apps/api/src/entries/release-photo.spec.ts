import type { Logger } from '@nestjs/common';
import type { PhotosService } from '../photos/photos.service.js';
import { releasePhoto } from './release-photo.js';

const PHOTO_ID = '019a0000-0000-7000-8000-0000000000f1';

function setup(deleteIfUnreferenced: () => Promise<boolean>) {
  const photos = { deleteIfUnreferenced: vi.fn(deleteIfUnreferenced) };
  const logger = { warn: vi.fn() };
  return {
    photos,
    logger,
    release: (photoId: string | null) =>
      releasePhoto(
        photos as unknown as PhotosService,
        logger as unknown as Logger,
        photoId,
      ),
  };
}

describe('releasePhoto', () => {
  it('asks the photos service to delete the photo once unreferenced', async () => {
    const { photos, logger, release } = setup(() => Promise.resolve(true));

    await release(PHOTO_ID);

    expect(photos.deleteIfUnreferenced).toHaveBeenCalledWith(PHOTO_ID);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does nothing without a photo', async () => {
    const { photos, release } = setup(() => Promise.resolve(false));

    await release(null);

    expect(photos.deleteIfUnreferenced).not.toHaveBeenCalled();
  });

  it('logs instead of failing the request when the cleanup fails', async () => {
    const { logger, release } = setup(() =>
      Promise.reject(new Error('storage offline')),
    );

    await expect(release(PHOTO_ID)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('storage offline'),
    );
  });
});
