import { API_LIMITS } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import type { UploadedFile } from '../ai/analyze-uploads.js';
import { acceptUploadedImage } from '../ai/uploaded-image.js';

export const MENU_IMAGES_FIELD = 'images';
export const MENU_IMAGES_MAX = API_LIMITS.analyzeImagesMax;
export const MENU_PHOTO_REQUIRED_MESSAGE = 'Add a photo of the menu';

export function collectMenuImages(
  files: readonly UploadedFile[] | undefined,
): Buffer[] {
  const images = files ?? [];
  if (images.length === 0) {
    throw new BadRequestException(MENU_PHOTO_REQUIRED_MESSAGE);
  }
  if (images.length > MENU_IMAGES_MAX) {
    throw new BadRequestException(
      `Attach at most ${MENU_IMAGES_MAX} photos of the menu`,
    );
  }
  return images.map((file) => acceptUploadedImage(file));
}
