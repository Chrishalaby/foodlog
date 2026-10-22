import { BadRequestException } from '@nestjs/common';
import {
  COVER_PHOTO_MESSAGE,
  coverEntryPhoto,
  coverUpdateData,
  entryPhotoIds,
  entryPhotoRows,
  entryPhotos,
  requireEntryPhoto,
  singleEntryPhoto,
  sourcePhotoRole,
  storedEntryPhotos,
  storedPhotoRole,
  withPhoto,
} from './entry-photos.js';

const FOOD = { photoId: 'food', role: 'food' as const };
const LABEL = { photoId: 'label', role: 'label' as const };
const SECOND_FOOD = { photoId: 'food-2', role: 'food' as const };

describe('entryPhotos', () => {
  it('uses the first food photo as cover by default', () => {
    expect(entryPhotos([LABEL, FOOD, SECOND_FOOD])).toEqual({
      photoId: 'food',
      photos: [LABEL, FOOD, SECOND_FOOD],
    });
  });

  it('falls back to the first photo, or none', () => {
    expect(entryPhotos([LABEL, { photoId: 'b', role: 'label' }]).photoId).toBe(
      'label',
    );
    expect(entryPhotos([])).toEqual({ photoId: null, photos: [] });
  });

  it('honours a requested cover among the photos', () => {
    expect(entryPhotos([FOOD, LABEL], 'label').photoId).toBe('label');
  });

  it('rejects a cover that is not one of the photos', () => {
    expect(() => entryPhotos([FOOD], 'label')).toThrow(
      new BadRequestException(COVER_PHOTO_MESSAGE),
    );
    expect(() => entryPhotos([], 'label')).toThrow(BadRequestException);
  });

  it('drops repeated photos, keeping the first role', () => {
    expect(
      entryPhotos([FOOD, { photoId: 'food', role: 'label' }]).photos,
    ).toEqual([FOOD]);
  });
});

describe('withPhoto', () => {
  it('appends a photo that is not there yet', () => {
    expect(withPhoto([LABEL], FOOD)).toEqual([LABEL, FOOD]);
  });

  it('keeps the existing role of a photo that is already there', () => {
    expect(withPhoto([LABEL], { photoId: 'label', role: 'food' })).toEqual([
      LABEL,
    ]);
    expect(withPhoto([LABEL], null)).toEqual([LABEL]);
  });
});

describe('singleEntryPhoto', () => {
  it('turns one photo into a one-photo set', () => {
    expect(singleEntryPhoto('food')).toEqual({
      photoId: 'food',
      photos: [FOOD],
    });
    expect(singleEntryPhoto('label', 'label').photos).toEqual([LABEL]);
    expect(singleEntryPhoto(null)).toEqual({ photoId: null, photos: [] });
  });
});

describe('storedEntryPhotos', () => {
  it('orders stored photos by position and keeps the cover', () => {
    expect(
      storedEntryPhotos({
        source: 'food_photo',
        photoId: 'label',
        photos: [
          { photoId: 'food', role: 'food', position: 1 },
          { photoId: 'label', role: 'label', position: 0 },
        ],
      }),
    ).toEqual({ photoId: 'label', photos: [LABEL, FOOD] });
  });

  it('adds a cover that has no photo row with the role of the source', () => {
    expect(
      storedEntryPhotos({
        source: 'nutrition_label',
        photoId: 'label',
        photos: [],
      }),
    ).toEqual({ photoId: 'label', photos: [LABEL] });
    expect(
      storedEntryPhotos({ source: 'copy', photoId: null, photos: [] }),
    ).toEqual({ photoId: null, photos: [] });
  });

  it('normalizes unknown stored roles', () => {
    expect(
      storedEntryPhotos({
        source: 'text',
        photoId: 'food',
        photos: [{ photoId: 'food', role: 'menu', position: 0 }],
      }).photos,
    ).toEqual([FOOD]);
  });
});

describe('coverEntryPhoto', () => {
  it('keeps only the cover photo', () => {
    expect(
      coverEntryPhoto({ photoId: 'label', photos: [FOOD, LABEL] }),
    ).toEqual({ photoId: 'label', photos: [LABEL] });
    expect(coverEntryPhoto({ photoId: null, photos: [] })).toEqual({
      photoId: null,
      photos: [],
    });
  });
});

describe('entryPhotoRows', () => {
  it('numbers distinct photos in order', () => {
    expect(entryPhotoRows([LABEL, FOOD, LABEL])).toEqual([
      { ...LABEL, position: 0 },
      { ...FOOD, position: 1 },
    ]);
  });
});

describe('entryPhotoIds', () => {
  it('lists every photo of an entry once, including the cover', () => {
    expect(
      entryPhotoIds({
        photoId: 'food',
        photos: [{ photoId: 'food' }, { photoId: 'label' }],
      }),
    ).toEqual(['food', 'label']);
    expect(entryPhotoIds({ photoId: 'legacy', photos: [] })).toEqual([
      'legacy',
    ]);
    expect(entryPhotoIds({ photoId: null, photos: [] })).toEqual([]);
  });
});

describe('requireEntryPhoto', () => {
  const entry = {
    photoId: 'food',
    photos: [{ photoId: 'food' }, { photoId: 'label' }],
  };

  it('accepts any photo of the entry', () => {
    expect(requireEntryPhoto(entry, 'label')).toBe('label');
    expect(requireEntryPhoto(entry, 'food')).toBe('food');
  });

  it('rejects photos of other entries', () => {
    expect(() => requireEntryPhoto(entry, 'other')).toThrow(
      new BadRequestException(COVER_PHOTO_MESSAGE),
    );
  });
});

describe('coverUpdateData', () => {
  it('only moves the cover when the current cover already has a photo row', () => {
    expect(
      coverUpdateData(
        {
          source: 'food_photo',
          photoId: 'food',
          photos: [
            { photoId: 'food', position: 0 },
            { photoId: 'label', position: 1 },
          ],
        },
        'label',
      ),
    ).toEqual({ photoId: 'label' });
  });

  it('keeps a cover without a photo row as an entry photo when another photo becomes the cover', () => {
    expect(
      coverUpdateData(
        {
          source: 'nutrition_label',
          photoId: 'legacy',
          photos: [
            { photoId: 'food', position: 0 },
            { photoId: 'label', position: 3 },
          ],
        },
        'food',
      ),
    ).toEqual({
      photoId: 'food',
      photos: { create: { photoId: 'legacy', role: 'label', position: 4 } },
    });
  });

  it('keeps the same cover without adding rows', () => {
    expect(
      coverUpdateData(
        { source: 'food_photo', photoId: 'legacy', photos: [] },
        'legacy',
      ),
    ).toEqual({ photoId: 'legacy' });
  });

  it('rejects photos that are not the entry photos', () => {
    expect(() =>
      coverUpdateData(
        {
          source: 'food_photo',
          photoId: 'food',
          photos: [{ photoId: 'food', position: 0 }],
        },
        'other',
      ),
    ).toThrow(new BadRequestException(COVER_PHOTO_MESSAGE));
    expect(() =>
      coverUpdateData({ source: 'manual', photoId: null, photos: [] }, 'food'),
    ).toThrow(BadRequestException);
  });
});

describe('photo roles', () => {
  it('derives the natural role from the entry source', () => {
    expect(sourcePhotoRole('nutrition_label')).toBe('label');
    expect(sourcePhotoRole('food_photo')).toBe('food');
    expect(sourcePhotoRole('barcode')).toBe('food');
    expect(storedPhotoRole('label', 'food_photo')).toBe('label');
    expect(storedPhotoRole('menu', 'nutrition_label')).toBe('label');
  });
});
