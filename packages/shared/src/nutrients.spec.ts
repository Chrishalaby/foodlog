import { describe, expect, it } from 'vitest';
import {
  atwaterCalories,
  macroSplit,
  nutrientsFromPer100g,
  per100gFromNutrients,
  roundNutrients,
  sanitizeNutrients,
  sumNutrients,
  zeroNutrients,
} from './nutrients.js';

describe('nutrients', () => {
  it('scales per-100g values to grams and back', () => {
    const per100 = { ...zeroNutrients(), calories: 250, protein: 20, fat: 18, sodium: 75 };
    const n = nutrientsFromPer100g(per100, 150);
    expect(n.calories).toBe(375);
    expect(n.protein).toBe(30);
    expect(per100gFromNutrients(n, 150)?.calories).toBe(250);
    expect(per100gFromNutrients(n, 0)).toBeNull();
  });

  it('sums and rounds', () => {
    const a = { ...zeroNutrients(), calories: 100.4, protein: 1.26 };
    const b = { ...zeroNutrients(), calories: 50.3, protein: 2.21 };
    const r = roundNutrients(sumNutrients([a, b]));
    expect(r.calories).toBe(151);
    expect(r.protein).toBe(3.5);
  });

  it('sanitizes negative and invalid values', () => {
    const n = sanitizeNutrients({ calories: -5, protein: Number.NaN, fat: 3 });
    expect(n.calories).toBe(0);
    expect(n.protein).toBe(0);
    expect(n.fat).toBe(3);
  });

  it('computes Atwater calories and macro split', () => {
    expect(atwaterCalories({ protein: 10, carbs: 20, fiber: 5, fat: 10, alcohol: 0 })).toBe(40 + 60 + 10 + 90);
    const split = macroSplit({ protein: 25, carbs: 50, fat: 11.11, alcohol: 0 });
    expect(Math.round(split.protein + split.carbs + split.fat)).toBe(100);
  });
});
