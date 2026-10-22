import {
  API_LIMITS,
  type EntryItemInput,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  zeroNutrients,
} from '@food/shared';
import {
  favoriteEntryName,
  formatServings,
  isWithinItemLimits,
  nameWithSuffix,
  scaleFavoriteItem,
  scaleFavoriteItems,
} from './favorite-servings.js';

function item(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Greek yogurt',
    grams: 170,
    nutrients: {
      ...zeroNutrients(),
      calories: 100,
      protein: 17.3,
      sodium: 61,
    },
    confidence: 'high',
    ...overrides,
  };
}

describe('formatServings', () => {
  it.each([
    [1, '1'],
    [2, '2'],
    [1.5, '1.5'],
    [0.25, '0.25'],
    [1.1, '1.1'],
    [0.333333, '0.33'],
    [20, '20'],
  ])('formats %s as %s without trailing zeros', (servings, expected) => {
    expect(formatServings(servings)).toBe(expected);
  });
});

describe('nameWithSuffix', () => {
  it('appends the suffix to a short name', () => {
    expect(nameWithSuffix('Yogurt', ' ×2')).toBe('Yogurt ×2');
  });

  it('cuts long names by code points so the suffix still fits', () => {
    const name = `${'a'.repeat(API_LIMITS.nameMax - 4)}😀 tail`;

    const suffixed = nameWithSuffix(name, ' ×2');

    expect(suffixed).toBe(`${'a'.repeat(API_LIMITS.nameMax - 4)}😀 ×2`);
    expect(Array.from(suffixed)).toHaveLength(API_LIMITS.nameMax);
  });
});

describe('favoriteEntryName', () => {
  it('uses the plain favorite name for a single serving', () => {
    expect(favoriteEntryName('Protein shake', 1)).toBe('Protein shake');
  });

  it.each([
    [1.5, 'Protein shake ×1.5'],
    [2, 'Protein shake ×2'],
    [0.5, 'Protein shake ×0.5'],
    [0.75, 'Protein shake ×0.75'],
  ])('appends %s servings', (servings, expected) => {
    expect(favoriteEntryName('Protein shake', servings)).toBe(expected);
  });

  it('treats servings that round to one as a single serving', () => {
    expect(favoriteEntryName('Protein shake', 1.001)).toBe('Protein shake');
  });

  it('shortens long names so the result still fits the name limit', () => {
    const name = 'x'.repeat(API_LIMITS.nameMax);
    const result = favoriteEntryName(name, 1.5);

    expect(result).toHaveLength(API_LIMITS.nameMax);
    expect(result.endsWith(' ×1.5')).toBe(true);
  });

  it('never splits a character made of two UTF-16 code units', () => {
    const name = `${'x'.repeat(API_LIMITS.nameMax - 4)}🥣🥣🥣🥣`;

    const result = favoriteEntryName(name, 2);

    expect(result).toBe(`${'x'.repeat(API_LIMITS.nameMax - 4)}🥣 ×2`);
    expect(result).not.toMatch(/\p{Cs}/u);
    expect(Array.from(result)).toHaveLength(API_LIMITS.nameMax);
  });

  it('does not leave dangling whitespace before the suffix', () => {
    const name = `${'x'.repeat(API_LIMITS.nameMax - 6)}      tail`;

    expect(favoriteEntryName(name, 2)).toBe(
      `${'x'.repeat(API_LIMITS.nameMax - 6)} ×2`,
    );
  });
});

describe('scaleFavoriteItem', () => {
  it('scales grams and every nutrient by the servings', () => {
    expect(scaleFavoriteItem(item(), 1.5)).toEqual({
      name: 'Greek yogurt',
      grams: 255,
      nutrients: {
        ...zeroNutrients(),
        calories: 150,
        protein: expect.closeTo(25.95, 6),
        sodium: 91.5,
      },
      confidence: 'high',
      micros: null,
      fluidMl: null,
    });
  });

  it('scales micros and the drink volume with the grams', () => {
    expect(
      scaleFavoriteItem(
        item({
          name: 'Diet Pepsi',
          grams: 330,
          micros: { caffeine: 35, potassium: 36 },
          fluidMl: 330,
        }),
        1.5,
      ),
    ).toMatchObject({
      grams: 495,
      micros: { caffeine: 53, potassium: 54 },
      fluidMl: 495,
    });
    expect(
      scaleFavoriteItem(
        item({ micros: { vitaminD: 125 }, fluidMl: null }),
        0.5,
      ),
    ).toMatchObject({ micros: { vitaminD: 62.5 }, fluidMl: null });
  });

  it('keeps the original items untouched', () => {
    const items = [item(), item({ name: 'Honey', grams: 21 })];

    const scaled = scaleFavoriteItems(items, 2);

    expect(scaled.map((i) => [i.name, i.grams])).toEqual([
      ['Greek yogurt', 340],
      ['Honey', 42],
    ]);
    expect(items[0]?.grams).toBe(170);
  });
});

describe('isWithinItemLimits', () => {
  it('accepts items at the limits', () => {
    expect(isWithinItemLimits(item({ grams: MAX_ITEM_GRAMS }))).toBe(true);
    expect(
      isWithinItemLimits(
        item({
          nutrients: {
            ...zeroNutrients(),
            calories: NUTRIENT_META.calories.max,
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects items above the gram or nutrient limits', () => {
    expect(isWithinItemLimits(item({ grams: MAX_ITEM_GRAMS + 1 }))).toBe(false);
    expect(
      isWithinItemLimits(
        item({
          nutrients: {
            ...zeroNutrients(),
            sodium: NUTRIENT_META.sodium.max + 1,
          },
        }),
      ),
    ).toBe(false);
  });
});
