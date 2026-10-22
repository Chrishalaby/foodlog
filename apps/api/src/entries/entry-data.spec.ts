import { type EntryItemInput, zeroNutrients } from '@food/shared';
import { Prisma } from '../generated/prisma/client.js';
import {
  blankToNull,
  entryCreateData,
  entryReplaceData,
  type NewEntry,
  toEntryItemInput,
  toNullableJson,
} from './entry-data.js';

const TIMESTAMP = new Date('2026-09-28T07:30:00.000Z');

function item(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Oats',
    grams: 80.04,
    nutrients: { ...zeroNutrients(), calories: 300.6, protein: 10.44 },
    confidence: 'high',
    ...overrides,
  };
}

function newEntry(overrides: Partial<NewEntry> = {}): NewEntry {
  return {
    userId: 'user-1',
    name: 'Breakfast bowl',
    description: null,
    mealType: 'breakfast',
    source: 'manual',
    timestamp: TIMESTAMP,
    localDate: '2026-09-28',
    items: [
      item(),
      item({
        name: 'Milk',
        grams: 200,
        nutrients: { ...zeroNutrients(), calories: 120.4, protein: 6.66 },
        confidence: null,
      }),
    ],
    photoId: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    rawAiJson: null,
    ...overrides,
  };
}

describe('entryCreateData', () => {
  it('stores rounded items in client order and totals computed from them', () => {
    const data = entryCreateData(newEntry());

    expect(data).toMatchObject({
      userId: 'user-1',
      name: 'Breakfast bowl',
      mealType: 'breakfast',
      source: 'manual',
      timestamp: TIMESTAMP,
      localDate: '2026-09-28',
      calories: 421,
      protein: 17.1,
      carbs: 0,
    });
    expect(data.items?.createMany?.data).toEqual([
      expect.objectContaining({
        position: 0,
        name: 'Oats',
        grams: 80,
        calories: 301,
        protein: 10.4,
        confidence: 'high',
      }),
      expect.objectContaining({
        position: 1,
        name: 'Milk',
        grams: 200,
        calories: 120,
        protein: 6.7,
        confidence: null,
      }),
    ]);
  });

  it('writes a database null when there is no raw AI json', () => {
    expect(entryCreateData(newEntry()).rawAiJson).toBe(Prisma.DbNull);
  });

  it('keeps raw AI json and references', () => {
    const rawAiJson = { output: [{ type: 'message' }] };
    const data = entryCreateData(
      newEntry({
        rawAiJson,
        photoId: 'photo-1',
        photos: [{ photoId: 'photo-1', role: 'food' }],
        analysisId: 'analysis-1',
        favoriteId: 'favorite-1',
      }),
    );

    expect(data).toMatchObject({
      rawAiJson,
      photoId: 'photo-1',
      analysisId: 'analysis-1',
      favoriteId: 'favorite-1',
    });
  });

  it('creates one numbered photo row per distinct entry photo', () => {
    const data = entryCreateData(
      newEntry({
        photoId: 'food-1',
        photos: [
          { photoId: 'label-1', role: 'label' },
          { photoId: 'food-1', role: 'food' },
          { photoId: 'label-1', role: 'label' },
        ],
      }),
    );

    expect(data.photos).toEqual({
      createMany: {
        data: [
          { photoId: 'label-1', role: 'label', position: 0 },
          { photoId: 'food-1', role: 'food', position: 1 },
        ],
      },
    });
  });

  it('creates no photo rows for entries without photos', () => {
    expect(entryCreateData(newEntry())).not.toHaveProperty('photos');
  });

  it('stores a valid portion and drops one without a unit', () => {
    expect(
      entryCreateData(
        newEntry({ portion: { count: 1.5, unit: 'burger', unitPlural: '' } }),
      ),
    ).toMatchObject({
      portionCount: 1.5,
      portionUnit: 'burger',
      portionUnitPlural: 'burgers',
    });
    expect(
      entryCreateData(
        newEntry({ portion: { count: 2, unit: ' ', unitPlural: 'x' } }),
      ),
    ).toMatchObject({
      portionCount: null,
      portionUnit: null,
      portionUnitPlural: null,
    });
  });

  it('keeps item counts only together with a unit', () => {
    const data = entryCreateData(
      newEntry({
        items: [
          item({ count: 3, unit: 'slice', unitPlural: 'slices' }),
          item({ name: 'Milk', count: 2, unit: null }),
        ],
      }),
    );

    expect(data.items?.createMany?.data).toEqual([
      expect.objectContaining({
        count: 3,
        unit: 'slice',
        unitPlural: 'slices',
      }),
      expect.objectContaining({ count: null, unit: null, unitPlural: null }),
    ]);
  });
});

describe('entryReplaceData', () => {
  it('replaces the editable fields and never touches references', () => {
    const data = entryReplaceData({
      name: 'Edited',
      description: 'with honey',
      mealType: 'snack',
      timestamp: TIMESTAMP,
      localDate: '2026-09-27',
      items: [item()],
    });

    expect(data).toMatchObject({
      name: 'Edited',
      description: 'with honey',
      mealType: 'snack',
      localDate: '2026-09-27',
      calories: 301,
    });
    expect(data).not.toHaveProperty('photoId');
    expect(data).not.toHaveProperty('analysisId');
    expect(data).not.toHaveProperty('rawAiJson');
    expect(data).not.toHaveProperty('source');
    expect(data).not.toHaveProperty('portionCount');
  });

  it('replaces or clears the portion only when one is given', () => {
    const content = {
      name: 'Edited',
      description: null,
      mealType: 'snack' as const,
      timestamp: TIMESTAMP,
      localDate: '2026-09-27',
      items: [item()],
    };

    expect(
      entryReplaceData({
        ...content,
        portion: { count: 3, unit: 'egg', unitPlural: 'eggs' },
      }),
    ).toMatchObject({
      portionCount: 3,
      portionUnit: 'egg',
      portionUnitPlural: 'eggs',
    });
    expect(entryReplaceData({ ...content, portion: null })).toMatchObject({
      portionCount: null,
      portionUnit: null,
      portionUnitPlural: null,
    });
  });
});

describe('helpers', () => {
  it('converts stored item rows back into item inputs', () => {
    expect(
      toEntryItemInput({
        name: 'Rice',
        grams: 150,
        count: null,
        unit: null,
        unitPlural: null,
        confidence: null,
        productId: null,
        micros: null,
        fluidMl: null,
        ...zeroNutrients(),
        calories: 195,
      }),
    ).toEqual({
      name: 'Rice',
      grams: 150,
      nutrients: { ...zeroNutrients(), calories: 195 },
      confidence: null,
      count: null,
      unit: null,
      unitPlural: null,
      productId: null,
      micros: null,
      fluidMl: null,
    });
    expect(
      toEntryItemInput({
        name: 'Eggs',
        grams: 100,
        count: 2,
        unit: 'egg',
        unitPlural: 'eggs',
        confidence: 'high',
        productId: '019a0000-0000-7000-8000-0000000000d1',
        micros: { vitaminD: 2.2, cholesterol: 373, unknown: 1 },
        fluidMl: 0,
        ...zeroNutrients(),
      }),
    ).toMatchObject({
      count: 2,
      unit: 'egg',
      unitPlural: 'eggs',
      productId: '019a0000-0000-7000-8000-0000000000d1',
      micros: { vitaminD: 2.2, cholesterol: 373 },
      fluidMl: null,
    });
    expect(
      toEntryItemInput({
        name: 'Diet Pepsi',
        grams: 330,
        count: 1,
        unit: 'can',
        unitPlural: 'cans',
        confidence: 'high',
        productId: null,
        micros: { caffeine: 35 },
        fluidMl: 330,
        ...zeroNutrients(),
      }),
    ).toMatchObject({ micros: { caffeine: 35 }, fluidMl: 330 });
  });

  it('maps json values for nullable json columns', () => {
    expect(toNullableJson(null)).toBe(Prisma.DbNull);
    expect(toNullableJson({ a: 1 })).toEqual({ a: 1 });
    expect(toNullableJson([1, 'two'])).toEqual([1, 'two']);
  });

  it('turns blank descriptions into null', () => {
    expect(blankToNull('')).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull('Extra sauce')).toBe('Extra sauce');
  });
});
