import type { EntrySource, ImageRole } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import { isImageRole, primaryPhoto } from '../ai/analysis-plan.js';
import type { Prisma } from '../generated/prisma/client.js';

export const COVER_PHOTO_MESSAGE =
  "coverPhotoId must be one of the entry's photos";

export const STORED_ENTRY_PHOTOS = {
  select: { photoId: true, role: true, position: true },
} as const satisfies Prisma.Entry$photosArgs;

export interface EntryPhotoRef {
  photoId: string;
  role: ImageRole;
}

export interface EntryPhotoRow extends EntryPhotoRef {
  position: number;
}

export interface EntryPhotos {
  photoId: string | null;
  photos: EntryPhotoRef[];
}

export interface StoredEntryPhoto {
  photoId: string;
  role: string;
  position: number;
}

export interface StoredEntryPhotos {
  source: EntrySource;
  photoId: string | null;
  photos: readonly StoredEntryPhoto[];
}

export interface EntryPhotoIds {
  photoId: string | null;
  photos: readonly { photoId: string }[];
}

export function sourcePhotoRole(source: EntrySource): ImageRole {
  return source === 'nutrition_label' ? 'label' : 'food';
}

export function storedPhotoRole(role: string, source: EntrySource): ImageRole {
  return isImageRole(role) ? role : sourcePhotoRole(source);
}

export function byPosition<T extends { position: number }>(
  photos: readonly T[],
): T[] {
  return [...photos].sort((a, b) => a.position - b.position);
}

function uniquePhotos(photos: readonly EntryPhotoRef[]): EntryPhotoRef[] {
  const seen = new Set<string>();
  return photos.filter(({ photoId }) => {
    if (seen.has(photoId)) {
      return false;
    }
    seen.add(photoId);
    return true;
  });
}

export function withPhoto(
  photos: readonly EntryPhotoRef[],
  photo: EntryPhotoRef | null,
): EntryPhotoRef[] {
  const unique = uniquePhotos(photos);
  if (!photo || unique.some(({ photoId }) => photoId === photo.photoId)) {
    return unique;
  }
  return [...unique, photo];
}

export function noEntryPhotos(): EntryPhotos {
  return { photoId: null, photos: [] };
}

export function entryPhotos(
  photos: readonly EntryPhotoRef[],
  coverPhotoId: string | null = null,
): EntryPhotos {
  const unique = uniquePhotos(photos);
  if (coverPhotoId && !unique.some(({ photoId }) => photoId === coverPhotoId)) {
    throw new BadRequestException(COVER_PHOTO_MESSAGE);
  }
  return {
    photoId: coverPhotoId ?? primaryPhoto(unique)?.photoId ?? null,
    photos: unique,
  };
}

export function singleEntryPhoto(
  photoId: string | null,
  role: ImageRole = 'food',
): EntryPhotos {
  return photoId ? { photoId, photos: [{ photoId, role }] } : noEntryPhotos();
}

export function storedEntryPhotos(entry: StoredEntryPhotos): EntryPhotos {
  const photos = byPosition(entry.photos).map(({ photoId, role }) => ({
    photoId,
    role: storedPhotoRole(role, entry.source),
  }));
  const cover = entry.photoId
    ? { photoId: entry.photoId, role: sourcePhotoRole(entry.source) }
    : null;
  return entryPhotos(withPhoto(photos, cover), entry.photoId);
}

export function coverEntryPhoto(photos: EntryPhotos): EntryPhotos {
  return {
    photoId: photos.photoId,
    photos: photos.photos.filter(({ photoId }) => photoId === photos.photoId),
  };
}

export function entryPhotoRows(
  photos: readonly EntryPhotoRef[],
): EntryPhotoRow[] {
  return uniquePhotos(photos).map(({ photoId, role }, position) => ({
    photoId,
    role,
    position,
  }));
}

export function entryPhotoIds(entry: EntryPhotoIds): string[] {
  const ids = entry.photos.map(({ photoId }) => photoId);
  return [...new Set(entry.photoId ? [...ids, entry.photoId] : ids)];
}

export function requireEntryPhoto(
  entry: EntryPhotoIds,
  coverPhotoId: string,
): string {
  if (!entryPhotoIds(entry).includes(coverPhotoId)) {
    throw new BadRequestException(COVER_PHOTO_MESSAGE);
  }
  return coverPhotoId;
}

export interface EntryCover {
  source: EntrySource;
  photoId: string | null;
  photos: readonly { photoId: string; position: number }[];
}

export function coverUpdateData(
  entry: EntryCover,
  coverPhotoId: string,
): Prisma.EntryUncheckedUpdateInput {
  const photoId = requireEntryPhoto(entry, coverPhotoId);
  const current = entry.photoId;
  if (
    !current ||
    current === photoId ||
    entry.photos.some((photo) => photo.photoId === current)
  ) {
    return { photoId };
  }
  const position =
    Math.max(-1, ...entry.photos.map((photo) => photo.position)) + 1;
  return {
    photoId,
    photos: {
      create: {
        photoId: current,
        role: sourcePhotoRole(entry.source),
        position,
      },
    },
  };
}
