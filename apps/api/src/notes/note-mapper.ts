import type { NoteDto } from '@food/shared';
import { toPhotoRef } from '../common/mappers.js';
import { byPosition } from '../entries/entry-photos.js';
import type { Prisma } from '../generated/prisma/client.js';

export const NOTE_INCLUDE = {
  photos: { orderBy: { position: 'asc' }, include: { photo: true } },
} as const satisfies Prisma.NoteInclude;

export type NoteWithPhotos = Prisma.NoteGetPayload<{
  include: typeof NOTE_INCLUDE;
}>;

export function toNoteDto(note: NoteWithPhotos): NoteDto {
  return {
    id: note.id,
    text: note.text,
    photos: byPosition(note.photos).map(({ photo }) => toPhotoRef(photo)),
    done: note.done,
    doneAt: note.doneAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}
