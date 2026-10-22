import {
  FLUID_ITEM_MAX_ML,
  cleanMicros,
  cleanMicrosPer100,
  hasMicros,
  itemExtras,
  itemMicrosPer100,
  sanitizeFluidMl,
  scaledItemExtras,
} from './micros';

describe('micros utils', () => {
  it('tells known micros from missing ones, counting a known zero as known', () => {
    expect(hasMicros(null)).toBe(false);
    expect(hasMicros(undefined)).toBe(false);
    expect(hasMicros({})).toBe(false);
    expect(hasMicros({ vitaminC: 0 })).toBe(true);
  });

  it('cleans item micros to known keys, the per-item limits and display precision', () => {
    expect(cleanMicros({ vitaminC: 12.46, iron: 1.04, bogus: 3, zinc: -1 })).toEqual({
      vitaminC: 12,
      iron: 1,
    });
    expect(cleanMicros({ vitaminD: 3000 })).toBeNull();
    expect(cleanMicros('nope')).toBeNull();
  });

  it('keeps supplement-strength values per 100 g with two extra decimals', () => {
    expect(cleanMicrosPer100({ vitaminD: 25000, vitaminB12: 0.12346, folate: -2 })).toEqual({
      vitaminD: 25000,
      vitaminB12: 0.1235,
    });
    expect(cleanMicrosPer100({})).toBeNull();
  });

  it('turns item micros into per-100 g values for saving a food', () => {
    expect(itemMicrosPer100({ vitaminD: 125 }, 0.5)).toEqual({ vitaminD: 25000 });
    expect(itemMicrosPer100({ caffeine: 36 }, 330)).toEqual({ caffeine: 10.91 });
    expect(itemMicrosPer100({ caffeine: 36 }, 0)).toBeNull();
    expect(itemMicrosPer100(null, 100)).toBeNull();
  });

  it('rounds drink ml to whole millilitres within the API limit', () => {
    expect(sanitizeFluidMl(329.6)).toBe(330);
    expect(sanitizeFluidMl(0.4)).toBeNull();
    expect(sanitizeFluidMl(-5)).toBeNull();
    expect(sanitizeFluidMl('330')).toBeNull();
    expect(sanitizeFluidMl(9000)).toBe(FLUID_ITEM_MAX_ML);
  });

  it('only adds micros and fluid fields when they are known', () => {
    expect(itemExtras({ micros: { caffeine: 36 }, fluidMl: 330 })).toEqual({
      micros: { caffeine: 36 },
      fluidMl: 330,
    });
    expect(itemExtras({ micros: {}, fluidMl: null })).toEqual({});
    expect(itemExtras({})).toEqual({});
  });

  it('scales copies of micros and drink ml by the same factor as grams', () => {
    expect(scaledItemExtras({ micros: { caffeine: 36, vitaminC: 0 }, fluidMl: 330 }, 1.5)).toEqual({
      micros: { caffeine: 54, vitaminC: 0 },
      fluidMl: 495,
    });
    expect(scaledItemExtras({ micros: { caffeine: 36 }, fluidMl: 330 }, Number.NaN)).toEqual({
      micros: { caffeine: 36 },
      fluidMl: 330,
    });
    expect(scaledItemExtras({ micros: null, fluidMl: null }, 2)).toEqual({});
  });
});
