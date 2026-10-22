import type {
  AnalysisPhotoRef,
  EntryDto,
  ImageRole,
  PhotoRef,
  UpdateEntryRequest,
} from '@food/shared';
import { itemExtras } from './micros';
import { productIdField } from './saved-foods';

export const IMAGE_ROLE_LABELS: Record<ImageRole, string> = {
  food: 'Food',
  label: 'Label',
};

export interface ViewerPhoto {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
  readonly caption: string | null;
}

export function photoCountLabel(count: number): string {
  return count === 1 ? '1 photo' : `${count} photos`;
}

export function entryPhotoRefs(
  entry: Pick<EntryDto, 'photo' | 'photos' | 'source'>,
): readonly AnalysisPhotoRef[] {
  const cover = entry.photo;
  if (!cover || entry.photos.some(({ photo }) => photo.id === cover.id)) {
    return entry.photos;
  }
  return [
    ...entry.photos,
    { photo: cover, role: entry.source === 'nutrition_label' ? 'label' : 'food' },
  ];
}

export function photoAlt(role: ImageRole, subject: string): string {
  const name = subject.trim();
  const kind = `${IMAGE_ROLE_LABELS[role]} photo`;
  return name ? `${kind} of ${name}` : kind;
}

export function viewerPhotos(photos: readonly AnalysisPhotoRef[], subject: string): ViewerPhoto[] {
  return photos.map(({ photo, role }) => ({
    id: photo.id,
    url: photo.url,
    alt: photoAlt(role, subject),
    caption: IMAGE_ROLE_LABELS[role],
  }));
}

export function coverIndex(photos: readonly AnalysisPhotoRef[], coverId: string | null): number {
  return Math.max(
    0,
    photos.findIndex(({ photo }) => photo.id === coverId),
  );
}

export function findPhoto(
  photos: readonly AnalysisPhotoRef[],
  photoId: string | null,
): PhotoRef | null {
  return photos.find(({ photo }) => photo.id === photoId)?.photo ?? null;
}

export function entryUpdateRequest(entry: EntryDto): UpdateEntryRequest {
  return {
    name: entry.name,
    description: entry.description,
    mealType: entry.mealType,
    timestamp: entry.timestamp,
    localDate: entry.localDate,
    items: entry.items.map(
      ({
        name,
        grams,
        nutrients,
        confidence,
        count,
        unit,
        unitPlural,
        productId,
        micros,
        fluidMl,
      }) => ({
        name,
        grams,
        nutrients,
        confidence,
        count: count ?? null,
        unit: unit ?? null,
        unitPlural: unitPlural ?? null,
        ...productIdField(productId),
        ...itemExtras({ micros, fluidMl }),
      }),
    ),
    portion: entry.portion ?? null,
  };
}

export function coverUpdateRequest(entry: EntryDto, coverPhotoId: string): UpdateEntryRequest {
  return { ...entryUpdateRequest(entry), coverPhotoId };
}
