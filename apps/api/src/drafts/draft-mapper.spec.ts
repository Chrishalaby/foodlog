import { zeroNutrients } from '@food/shared';
import {
  type DraftWithPhotos,
  parseDraftItems,
  toDraftDto,
  toDraftMode,
} from './draft-mapper.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const DRAFT_ID = '019a0000-0000-7000-8000-0000000000d1';
const FOOD_ID = '019a0000-0000-7000-8000-0000000000f1';
const LABEL_ID = '019a0000-0000-7000-8000-0000000000f2';
const CREATED_AT = new Date('2026-09-30T08:00:00.000Z');
const UPDATED_AT = new Date('2026-09-30T08:05:00.000Z');

function photo(id: string, width: number, height: number) {
  return {
    id,
    userId: USER_ID,
    storageKey: `photos/${id}.jpg`,
    thumbKey: `photos/${id}_thumb.webp`,
    width,
    height,
    bytes: 1000,
    createdAt: CREATED_AT,
  };
}

function draftRow(overrides: Partial<DraftWithPhotos> = {}): DraftWithPhotos {
  return {
    id: DRAFT_ID,
    userId: USER_ID,
    mode: 'food_photo',
    name: null,
    description: 'office lunch',
    mealType: 'lunch',
    timestamp: new Date('2026-09-30T12:15:00.000Z'),
    localDate: '2026-09-30',
    portionCount: null,
    portionUnit: null,
    portionUnitPlural: null,
    items: null,
    analysisId: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    photos: [],
    ...overrides,
  };
}

describe('toDraftDto', () => {
  it('maps a draft with its photos in position order', () => {
    const dto = toDraftDto(
      draftRow({
        photos: [
          {
            draftId: DRAFT_ID,
            photoId: LABEL_ID,
            role: 'label',
            position: 1,
            photo: photo(LABEL_ID, 1536, 2048),
          },
          {
            draftId: DRAFT_ID,
            photoId: FOOD_ID,
            role: 'food',
            position: 0,
            photo: photo(FOOD_ID, 1600, 1200),
          },
        ],
      }),
    );

    expect(dto).toEqual({
      id: DRAFT_ID,
      mode: 'food_photo',
      name: null,
      description: 'office lunch',
      mealType: 'lunch',
      timestamp: '2026-09-30T12:15:00.000Z',
      localDate: '2026-09-30',
      items: null,
      portion: null,
      analysisId: null,
      photos: [
        {
          role: 'food',
          photo: {
            id: FOOD_ID,
            url: `/api/photos/${FOOD_ID}`,
            thumbUrl: `/api/photos/${FOOD_ID}/thumb`,
            width: 1600,
            height: 1200,
          },
        },
        {
          role: 'label',
          photo: {
            id: LABEL_ID,
            url: `/api/photos/${LABEL_ID}`,
            thumbUrl: `/api/photos/${LABEL_ID}/thumb`,
            width: 1536,
            height: 2048,
          },
        },
      ],
      createdAt: CREATED_AT.toISOString(),
      updatedAt: UPDATED_AT.toISOString(),
    });
  });

  it('maps stored items and falls back to the natural role for unknown roles', () => {
    const dto = toDraftDto(
      draftRow({
        mode: 'nutrition_label',
        portionCount: 2,
        portionUnit: 'bar',
        portionUnitPlural: 'bars',
        items: [
          {
            name: 'Granola',
            grams: 30,
            nutrients: { ...zeroNutrients(), calories: 130 },
            confidence: 'high',
            count: 2,
            unit: 'bar',
            unitPlural: 'bars',
            productId: '019a0000-0000-7000-8000-0000000000d1',
            micros: { iron: 1.1, caffeine: 'none' },
            fluidMl: null,
          },
        ],
        photos: [
          {
            draftId: DRAFT_ID,
            photoId: LABEL_ID,
            role: 'menu',
            position: 0,
            photo: photo(LABEL_ID, 2048, 1536),
          },
        ],
      }),
    );

    expect(dto.items).toEqual([
      {
        name: 'Granola',
        grams: 30,
        nutrients: { ...zeroNutrients(), calories: 130 },
        confidence: 'high',
        count: 2,
        unit: 'bar',
        unitPlural: 'bars',
        productId: '019a0000-0000-7000-8000-0000000000d1',
        micros: { iron: 1.1 },
        fluidMl: null,
      },
    ]);
    expect(dto.portion).toEqual({ count: 2, unit: 'bar', unitPlural: 'bars' });
    expect(dto.photos.map(({ role }) => role)).toEqual(['label']);
  });
});

describe('parseDraftItems', () => {
  it('keeps null apart from an empty list and drops malformed items', () => {
    expect(parseDraftItems(null)).toBeNull();
    expect(parseDraftItems([])).toEqual([]);
    expect(parseDraftItems([{ grams: 10 }, 'x'])).toEqual([]);
  });
});

describe('toDraftMode', () => {
  it('only returns analysis modes the API exposes', () => {
    expect(toDraftMode('text')).toBe('text');
    expect(toDraftMode('nutrition_label')).toBe('nutrition_label');
    expect(toDraftMode('menu')).toBe('food_photo');
  });
});
