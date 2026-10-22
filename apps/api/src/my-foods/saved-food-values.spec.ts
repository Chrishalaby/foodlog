import { zeroNutrients } from '@food/shared';
import {
  matchesSavedValues,
  sameNutrients,
  savedItemNutrients,
} from './saved-food-values.js';

const PER_100 = { ...zeroNutrients(), calories: 110, carbs: 25.4, sodium: 907 };

describe('savedItemNutrients', () => {
  it('scales per-100 values to the item weight with the project rounding', () => {
    expect(savedItemNutrients(PER_100, 26)).toEqual({
      ...zeroNutrients(),
      calories: 29,
      carbs: 6.6,
      sodium: 236,
    });
  });
});

describe('matchesSavedValues', () => {
  it('compares against the rounded per-100 values for the item weight', () => {
    const nutrients = {
      ...zeroNutrients(),
      calories: 29,
      carbs: 6.6,
      sodium: 236,
    };
    expect(matchesSavedValues({ grams: 26, nutrients }, PER_100)).toBe(true);
    expect(
      matchesSavedValues(
        { grams: 26, nutrients: { ...nutrients, calories: 30 } },
        PER_100,
      ),
    ).toBe(false);
  });
});

describe('sameNutrients', () => {
  it('ignores floating point noise only', () => {
    const a = { ...zeroNutrients(), protein: 0.1 + 0.2 };
    expect(sameNutrients(a, { ...zeroNutrients(), protein: 0.3 })).toBe(true);
    expect(sameNutrients(a, { ...zeroNutrients(), protein: 0.4 })).toBe(false);
  });
});
