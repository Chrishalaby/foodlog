import { zeroNutrients } from '@food/shared';
import {
  type EntryWithRelations,
  type FavoriteWithPhoto,
  nutrientColumns,
  nutrientsFromRow,
  parseFavoriteItems,
  toEntryDto,
  toFavoriteDto,
  toPhotoRef,
} from './mappers.js';

const CREATED_AT = new Date('2026-09-28T08:00:00.000Z');
const UPDATED_AT = new Date('2026-09-28T09:00:00.000Z');

const photo = {
  id: '01a0e797-fca7-70a6-847e-659c7fa2e6c4',
  userId: 'user-1',
  storageKey: 'photos/a.jpg',
  thumbKey: 'photos/a_thumb.webp',
  width: 1024,
  height: 768,
  bytes: 1234,
  createdAt: CREATED_AT,
};

const labelPhoto = {
  ...photo,
  id: '01a0e797-fca7-70a6-847e-659c7fa2e6c5',
  storageKey: 'photos/b.jpg',
  thumbKey: 'photos/b_thumb.webp',
  width: 1344,
  height: 1792,
};

function entryPhoto(
  stored: typeof photo,
  role: string,
  position: number,
): EntryWithRelations['photos'][number] {
  return {
    entryId: 'entry-1',
    photoId: stored.id,
    role,
    position,
    photo: stored,
  };
}

function nutrientRow(calories: number, protein: number) {
  return { ...zeroNutrients(), calories, protein };
}

const SAVED_FOOD_ID = '019a0000-0000-7000-8000-0000000000d2';

function entryItem(position: number, name: string) {
  return {
    id: `item-${position}`,
    entryId: 'entry-1',
    position,
    name,
    grams: 100 + position,
    count: position === 0 ? 2 : null,
    unit: position === 0 ? 'egg' : null,
    unitPlural: position === 0 ? 'eggs' : null,
    confidence: position === 0 ? ('high' as const) : null,
    productId: position === 0 ? SAVED_FOOD_ID : null,
    micros: position === 0 ? { vitaminD: 2.2, calcium: 50, junk: 1 } : null,
    fluidMl: position === 0 ? null : 250,
    ...nutrientRow(100 * (position + 1), 10),
  };
}

const entry: EntryWithRelations = {
  id: 'entry-1',
  userId: 'user-1',
  name: 'Lunch bowl',
  description: null,
  mealType: 'lunch',
  source: 'food_photo',
  timestamp: new Date('2026-09-28T12:30:00.000Z'),
  localDate: '2026-09-28',
  photoId: photo.id,
  analysisId: 'analysis-1',
  favoriteId: null,
  rawAiJson: null,
  productId: null,
  portionCount: null,
  portionUnit: null,
  portionUnitPlural: null,
  ...nutrientRow(300, 20),
  items: [entryItem(1, 'Second'), entryItem(0, 'First')],
  photo,
  photos: [entryPhoto(labelPhoto, 'label', 1), entryPhoto(photo, 'food', 0)],
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

describe('mappers', () => {
  it('picks nutrient columns from rows and objects', () => {
    const row = { id: 'x', name: 'y', ...nutrientRow(12, 3) };

    expect(nutrientsFromRow(row)).toEqual(nutrientRow(12, 3));
    expect(
      nutrientColumns({ ...nutrientRow(1, 2), extra: 5 } as never),
    ).toEqual(nutrientRow(1, 2));
  });

  it('builds photo refs', () => {
    expect(toPhotoRef(photo)).toEqual({
      id: photo.id,
      url: `/api/photos/${photo.id}`,
      thumbUrl: `/api/photos/${photo.id}/thumb`,
      width: 1024,
      height: 768,
    });
    expect(toPhotoRef(null)).toBeNull();
  });

  it('maps entries with items sorted by position and ISO timestamps', () => {
    const dto = toEntryDto(entry);

    expect(dto).toMatchObject({
      id: 'entry-1',
      name: 'Lunch bowl',
      description: null,
      mealType: 'lunch',
      source: 'food_photo',
      timestamp: '2026-09-28T12:30:00.000Z',
      localDate: '2026-09-28',
      totals: nutrientRow(300, 20),
      analysisId: 'analysis-1',
      favoriteId: null,
      productId: null,
      createdAt: '2026-09-28T08:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(dto.photo?.url).toBe(`/api/photos/${photo.id}`);
    expect(dto.items).toEqual([
      {
        id: 'item-0',
        position: 0,
        name: 'First',
        grams: 100,
        nutrients: nutrientRow(100, 10),
        confidence: 'high',
        count: 2,
        unit: 'egg',
        unitPlural: 'eggs',
        productId: SAVED_FOOD_ID,
        micros: { vitaminD: 2.2, calcium: 50 },
        fluidMl: null,
      },
      {
        id: 'item-1',
        position: 1,
        name: 'Second',
        grams: 101,
        nutrients: nutrientRow(200, 10),
        confidence: null,
        count: null,
        unit: null,
        unitPlural: null,
        productId: null,
        micros: null,
        fluidMl: 250,
      },
    ]);
    expect(dto.portion).toBeNull();
  });

  it('maps a stored meal portion and ignores incomplete ones', () => {
    expect(
      toEntryDto({
        ...entry,
        portionCount: 1.5,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
      }).portion,
    ).toEqual({ count: 1.5, unit: 'burger', unitPlural: 'burgers' });
    expect(
      toEntryDto({
        ...entry,
        portionCount: 2,
        portionUnit: 'burger',
        portionUnitPlural: null,
      }).portion,
    ).toEqual({ count: 2, unit: 'burger', unitPlural: 'burgers' });
    expect(
      toEntryDto({
        ...entry,
        portionCount: 0,
        portionUnit: 'burger',
        portionUnitPlural: 'burgers',
      }).portion,
    ).toBeNull();
    expect(
      toEntryDto({ ...entry, portionCount: 2, portionUnit: null }).portion,
    ).toBeNull();
  });

  it('maps every entry photo in position order with its role', () => {
    const dto = toEntryDto(entry);

    expect(dto.photos).toEqual([
      { photo: toPhotoRef(photo), role: 'food' },
      { photo: toPhotoRef(labelPhoto), role: 'label' },
    ]);
    expect(dto.photo).toEqual(toPhotoRef(photo));
  });

  it('keeps the cover in the photo list even without an entry photo row', () => {
    const labelEntry = {
      ...entry,
      source: 'nutrition_label' as const,
      photoId: labelPhoto.id,
      photo: labelPhoto,
      photos: [],
    };

    expect(toEntryDto(labelEntry).photos).toEqual([
      { photo: toPhotoRef(labelPhoto), role: 'label' },
    ]);
    expect(
      toEntryDto({ ...entry, photoId: null, photo: null, photos: [] }).photos,
    ).toEqual([]);
  });

  it('falls back to the natural role for unknown stored roles', () => {
    const dto = toEntryDto({
      ...entry,
      photos: [entryPhoto(photo, 'menu', 0)],
    });

    expect(dto.photos).toEqual([{ photo: toPhotoRef(photo), role: 'food' }]);
  });

  it('links entries to the product they were logged from', () => {
    const productId = '019a0000-0000-7000-8000-0000000000d1';

    expect(
      toEntryDto({ ...entry, source: 'barcode', productId }),
    ).toMatchObject({ source: 'barcode', productId });
  });

  it('maps favorites and parses their JSON items defensively', () => {
    const favorite: FavoriteWithPhoto = {
      id: 'fav-1',
      userId: 'user-1',
      name: 'Oats',
      mealType: null,
      items: [
        {
          name: 'Oats',
          grams: 80,
          nutrients: nutrientRow(300, 10),
          confidence: 'medium',
          count: 2,
          unit: 'bar',
          unitPlural: 'bars',
          productId: SAVED_FOOD_ID.toUpperCase(),
          micros: { iron: 3.4, magnesium: -2, omega3: 1 },
          fluidMl: 200.4,
        },
        {
          name: 'Milk',
          grams: -5,
          nutrients: { calories: 'lots' },
          confidence: 'unsure',
          count: 'two',
          unit: 'glass',
          productId: 'not-a-uuid',
          micros: 'lots',
          fluidMl: -1,
        },
        { grams: 10 },
        'garbage',
        null,
      ],
      photoId: null,
      photo: null,
      ...nutrientRow(300, 10),
      portionCount: 2,
      portionUnit: 'bar',
      portionUnitPlural: 'bars',
      useCount: 3,
      lastUsedAt: UPDATED_AT,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    };

    expect(toFavoriteDto(favorite)).toEqual({
      id: 'fav-1',
      name: 'Oats',
      mealType: null,
      items: [
        {
          name: 'Oats',
          grams: 80,
          nutrients: nutrientRow(300, 10),
          confidence: 'medium',
          count: 2,
          unit: 'bar',
          unitPlural: 'bars',
          productId: SAVED_FOOD_ID,
          micros: { iron: 3.4 },
          fluidMl: 200,
        },
        {
          name: 'Milk',
          grams: 0,
          nutrients: zeroNutrients(),
          confidence: null,
          count: null,
          unit: null,
          unitPlural: null,
          productId: null,
          micros: null,
          fluidMl: null,
        },
      ],
      totals: nutrientRow(300, 10),
      portion: { count: 2, unit: 'bar', unitPlural: 'bars' },
      photo: null,
      useCount: 3,
      lastUsedAt: '2026-09-28T09:00:00.000Z',
      createdAt: '2026-09-28T08:00:00.000Z',
      updatedAt: '2026-09-28T09:00:00.000Z',
    });
  });

  it('returns no favorite items for non-array JSON', () => {
    expect(parseFavoriteItems({ name: 'x' })).toEqual([]);
    expect(parseFavoriteItems(null)).toEqual([]);
  });
});
