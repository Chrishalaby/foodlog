import type { UpdateNoteRequest } from '@food/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { PhotoRole } from '../photos/photo-processing.js';

export const NOTE_PHOTO_ROLE: PhotoRole = 'food';

export interface NotePhotoRow {
  photoId: string;
  position: number;
}

export function notePhotoRows(photoIds: readonly string[]): NotePhotoRow[] {
  return photoIds.map((photoId, position) => ({ photoId, position }));
}

export function isEmptyNoteUpdate(dto: UpdateNoteRequest): boolean {
  return dto.text === undefined && dto.done === undefined;
}

export function noteUpdateData(
  dto: UpdateNoteRequest,
  wasDone: boolean,
  now: Date,
): Prisma.NoteUncheckedUpdateInput {
  const data: Prisma.NoteUncheckedUpdateInput = {};
  if (dto.text !== undefined) {
    data.text = dto.text;
  }
  if (dto.done === false) {
    data.done = false;
    data.doneAt = null;
  }
  if (dto.done === true && !wasDone) {
    data.done = true;
    data.doneAt = now;
  }
  return data;
}
