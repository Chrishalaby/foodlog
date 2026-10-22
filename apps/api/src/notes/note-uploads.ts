import { API_LIMITS } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import type { UploadedFile } from '../ai/analyze-uploads.js';
import { acceptUploadedImage } from '../ai/uploaded-image.js';

export interface NoteUploadFiles {
  images?: UploadedFile[];
}

export const TOO_MANY_NOTE_PHOTOS_MESSAGE = `Attach at most ${API_LIMITS.notePhotosMax} photos per note`;

export function collectNoteUploads(
  files: NoteUploadFiles | undefined,
): Buffer[] {
  const images = files?.images ?? [];
  if (images.length > API_LIMITS.notePhotosMax) {
    throw new BadRequestException(TOO_MANY_NOTE_PHOTOS_MESSAGE);
  }
  return images.map((file) => acceptUploadedImage(file));
}
