import { MICRO_META } from '@food/shared';
import { Prisma } from '../generated/prisma/client.js';
import {
  FLUID_ITEM_MAX_ML,
  ITEM_MICROS_CEILING,
  itemFluidMl,
  itemMicros,
  microsForGrams,
  microsJson,
  microsProblems,
  PER100_MICROS_CEILING,
  per100Micros,
  sameMicros,
  scaledItemExtras,
  scaleFluidMl,
  scaleItemMicros,
} from './micros.js';

describe('item micros', () => {
  it('keeps known, finite, non-negative values and rounds them per nutrient', () => {
    expect(
      itemMicros({
        vitaminD: 18.34,
        vitaminB12: 3.921,
        potassium: 537.6,
        iron: -1,
        zinc: Number.NaN,
        omega3: 4,
        calcium: '12',
      }),
    ).toEqual({ vitaminD: 18.3, vitaminB12: 3.92, potassium: 538 });
  });

  it('treats empty, missing and malformed values as unknown', () => {
    expect(itemMicros({})).toBeNull();
    expect(itemMicros(null)).toBeNull();
    expect(itemMicros(undefined)).toBeNull();
    expect(itemMicros('lots')).toBeNull();
    expect(itemMicros([1, 2])).toBeNull();
  });

  it('drops item amounts above the sanity maximum', () => {
    expect(
      itemMicros({ vitaminD: MICRO_META.vitaminD.max + 1, calcium: 5 }),
    ).toEqual({ calcium: 5 });
  });
});

describe('per-100 g micros', () => {
  it('allows supplement-sized values and keeps two extra decimals', () => {
    expect(
      per100Micros({ vitaminD: 12500, vitaminB12: 0.38456, iron: 3.6049 }),
    ).toEqual({ vitaminD: 12500, vitaminB12: 0.3846, iron: 3.605 });
  });

  it('rejects values beyond the per-100 g ceiling', () => {
    expect(per100Micros({ calcium: 100_001, iron: 2 })).toEqual({ iron: 2 });
    expect(per100Micros({ calcium: 100_001 })).toBeNull();
  });

  it('turns per-100 g values into rounded amounts for a weight', () => {
    expect(microsForGrams({ vitaminD: 12500, caffeine: 10.6 }, 1)).toEqual({
      vitaminD: 125,
      caffeine: 0,
    });
    expect(microsForGrams({ caffeine: 10.6, potassium: 11 }, 330)).toEqual({
      caffeine: 35,
      potassium: 36,
    });
    expect(microsForGrams(null, 330)).toBeNull();
  });
});

describe('scaling copies', () => {
  it('scales micros by the copy factor and rounds them', () => {
    expect(scaleItemMicros({ vitaminD: 125, calcium: 13 }, 1.5)).toEqual({
      vitaminD: 187.5,
      calcium: 20,
    });
    expect(scaleItemMicros(null, 2)).toBeNull();
    expect(scaleItemMicros({ calcium: 13 }, 0)).toEqual({ calcium: 0 });
  });

  it('scales the drink volume to whole millilitres within the item limit', () => {
    expect(scaleFluidMl(330, 1.5)).toBe(495);
    expect(scaleFluidMl(250, 0.333)).toBe(83);
    expect(scaleFluidMl(330, 20)).toBeNull();
    expect(scaleFluidMl(null, 2)).toBeNull();
    expect(scaleFluidMl(330, 0)).toBeNull();
    expect(scaleFluidMl(330, Number.NaN)).toBeNull();
  });

  it('scales both extras of an item together', () => {
    expect(
      scaledItemExtras({ micros: { caffeine: 35 }, fluidMl: 330 }, 2),
    ).toEqual({ micros: { caffeine: 70 }, fluidMl: 660 });
    expect(scaledItemExtras({}, 2)).toEqual({ micros: null, fluidMl: null });
  });
});

describe('drink volume', () => {
  it.each([
    [330, 330],
    [250.6, 251],
    [FLUID_ITEM_MAX_ML, FLUID_ITEM_MAX_ML],
    [FLUID_ITEM_MAX_ML + 1, null],
    [0.4, null],
    [0, null],
    [-5, null],
    ['330', null],
    [null, null],
  ])('stores %s as %s', (value, expected) => {
    expect(itemFluidMl(value)).toBe(expected);
  });
});

describe('micros helpers', () => {
  it('compares micros key by key, treating missing as unknown', () => {
    expect(sameMicros({ iron: 1 }, { iron: 1 })).toBe(true);
    expect(sameMicros(null, {})).toBe(true);
    expect(sameMicros({ iron: 1 }, { iron: 1, zinc: 0 })).toBe(false);
    expect(sameMicros({ iron: 1 }, { iron: 2 })).toBe(false);
  });

  it('stores missing micros as a database null', () => {
    expect(microsJson({ iron: 1 })).toEqual({ iron: 1 });
    expect(microsJson(null)).toBe(Prisma.DbNull);
    expect(microsJson(undefined)).toBe(Prisma.DbNull);
  });

  it('lists every problem of submitted micros', () => {
    expect(microsProblems('micros', undefined, ITEM_MICROS_CEILING)).toEqual(
      [],
    );
    expect(microsProblems('micros', null, ITEM_MICROS_CEILING)).toEqual([]);
    expect(
      microsProblems('micros', { iron: null, zinc: 2 }, ITEM_MICROS_CEILING),
    ).toEqual([]);
    expect(microsProblems('micros', [1], ITEM_MICROS_CEILING)).toEqual([
      'micros must be an object',
    ]);
    expect(
      microsProblems(
        'microsPer100',
        { omega3: 1, calcium: 100_001, vitaminD: 12500 },
        PER100_MICROS_CEILING,
      ),
    ).toEqual([
      'microsPer100.omega3 is not a known vitamin or mineral',
      'microsPer100.calcium must be a number between 0 and 100000, or null',
    ]);
  });
});
