import { zeroNutrients } from '@food/shared';
import { Prisma } from '../generated/prisma/client.js';
import {
  draftEntryPhotos,
  draftEntrySource,
  draftItemsJson,
  draftPhotoRows,
  draftUpdateData,
  releasedPhotoIds,
} from './draft-data.js';
import type { UpdateDraftDto } from './drafts.dto.js';

const FOOD = { photoId: 'food', role: 'food' as const };
const LABEL = { photoId: 'label', role: 'label' as const };
const SECOND_FOOD = { photoId: 'food-2', role: 'food' as const };

describe('draftItemsJson', () => {
  it('stores normalized items without positions', () => {
    expect(
      draftItemsJson([
        {
          name: '  Rice ',
          grams: 180.26,
          nutrients: { ...zeroNutrients(), calories: 234.44, protein: -3 },
          micros: { magnesium: 21.6, iron: -1 },
        },
        {
          name: 'Soy milk',
          grams: 250,
          nutrients: zeroNutrients(),
          fluidMl: 249.6,
        },
      ]),
    ).toEqual([
      {
        name: 'Rice',
        grams: 180.3,
        nutrients: { ...zeroNutrients(), calories: 234 },
        confidence: null,
        count: null,
        unit: null,
        unitPlural: null,
        productId: null,
        micros: { magnesium: 22 },
        fluidMl: null,
      },
      {
        name: 'Soy milk',
        grams: 250,
        nutrients: zeroNutrients(),
        confidence: null,
        count: null,
        unit: null,
        unitPlural: null,
        productId: null,
        micros: null,
        fluidMl: 250,
      },
    ]);
  });

  it('stores a database null when there are no items', () => {
    expect(draftItemsJson(null)).toBe(Prisma.DbNull);
    expect(draftItemsJson(undefined)).toBe(Prisma.DbNull);
  });
});

describe('draftPhotoRows', () => {
  it('numbers photos in order', () => {
    expect(draftPhotoRows([LABEL, FOOD])).toEqual([
      { ...LABEL, position: 0 },
      { ...FOOD, position: 1 },
    ]);
  });
});

describe('draftUpdateData', () => {
  it('changes only the fields that were sent', () => {
    expect(draftUpdateData({} as UpdateDraftDto)).toEqual({});
    expect(
      draftUpdateData({
        mealType: 'dinner',
        localDate: '2026-09-30',
      } as UpdateDraftDto),
    ).toEqual({ mealType: 'dinner', localDate: '2026-09-30' });
  });

  it('clears fields sent as null or blank', () => {
    expect(
      draftUpdateData({
        name: '',
        description: null,
        mealType: null,
        items: null,
        analysisId: null,
      } as UpdateDraftDto),
    ).toEqual({
      name: null,
      description: null,
      mealType: null,
      items: Prisma.DbNull,
      analysisId: null,
    });
  });

  it('parses the timestamp and normalizes items', () => {
    const data = draftUpdateData({
      timestamp: '2026-09-30T19:00:00+02:00',
      items: [{ name: 'Soup', grams: 300, nutrients: zeroNutrients() }],
    } as UpdateDraftDto);

    expect(data.timestamp).toEqual(new Date('2026-09-30T17:00:00.000Z'));
    expect(data.items).toEqual([
      {
        name: 'Soup',
        grams: 300,
        nutrients: zeroNutrients(),
        confidence: null,
        count: null,
        unit: null,
        unitPlural: null,
        productId: null,
        micros: null,
        fluidMl: null,
      },
    ]);
  });

  it('stores the given items instead of the request items', () => {
    const productId = '019a0000-0000-7000-8000-0000000000d1';
    const data = draftUpdateData({ items: [] } as unknown as UpdateDraftDto, [
      { name: 'Rice', grams: 100, nutrients: zeroNutrients(), productId },
    ]);

    expect(data.items).toMatchObject([{ name: 'Rice', productId }]);
  });

  it('sets, clears or keeps the portion', () => {
    expect(
      draftUpdateData({
        portion: { count: 2, unit: 'wrap', unitPlural: 'wraps' },
      } as UpdateDraftDto),
    ).toEqual({
      portionCount: 2,
      portionUnit: 'wrap',
      portionUnitPlural: 'wraps',
    });
    expect(draftUpdateData({ portion: null } as UpdateDraftDto)).toEqual({
      portionCount: null,
      portionUnit: null,
      portionUnitPlural: null,
    });
    expect(draftUpdateData({ name: 'Wraps' } as UpdateDraftDto)).toEqual({
      name: 'Wraps',
    });
  });
});

describe('draftEntrySource', () => {
  it('uses the mode of the draft', () => {
    expect(draftEntrySource('text', null)).toBe('text');
    expect(draftEntrySource('food_photo', null)).toBe('food_photo');
    expect(draftEntrySource('nutrition_label', null)).toBe('nutrition_label');
  });

  it('follows the analysis the items came from', () => {
    expect(draftEntrySource('text', 'food_photo')).toBe('food_photo');
    expect(draftEntrySource('food_photo', 'nutrition_label')).toBe(
      'nutrition_label',
    );
  });
});

describe('draftEntryPhotos', () => {
  it('keeps every draft photo in order with its role', () => {
    expect(draftEntryPhotos([LABEL, FOOD, SECOND_FOOD], [FOOD])).toEqual([
      LABEL,
      FOOD,
      SECOND_FOOD,
    ]);
  });

  it("falls back to the analysis' photos when the draft has none", () => {
    expect(draftEntryPhotos([], [FOOD, LABEL])).toEqual([FOOD, LABEL]);
    expect(draftEntryPhotos([], [])).toEqual([]);
  });
});

describe('releasedPhotoIds', () => {
  it('lists each photo that is no longer kept once', () => {
    expect(releasedPhotoIds(['a', 'b', 'a', 'c'], ['b', null])).toEqual([
      'a',
      'c',
    ]);
    expect(releasedPhotoIds([], ['a'])).toEqual([]);
  });
});
