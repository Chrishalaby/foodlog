import { describe, expect, it } from 'vitest';
import { bmiCategory, computeBodyMetrics, ffmiCategory } from './body.js';

describe('computeBodyMetrics', () => {
  it('computes BMI only when body fat is unknown', () => {
    const m = computeBodyMetrics({ weightKg: 82, heightCm: 180, sex: 'male' });
    expect(m.bmi).toBe(25.3);
    expect(m.bmiCategory).toBe('overweight');
    expect(m.ffmi).toBeNull();
  });

  it('computes lean mass and FFMI with body fat', () => {
    const m = computeBodyMetrics({ weightKg: 82, heightCm: 180, bodyFatPct: 15, sex: 'male' });
    expect(m.leanMassKg).toBe(69.7);
    expect(m.fatMassKg).toBe(12.3);
    expect(m.ffmi).toBe(21.5);
    expect(m.ffmiNormalized).toBe(21.5);
    expect(m.ffmiCategory).toBe('above_average');
  });

  it('returns nulls without height or weight', () => {
    expect(computeBodyMetrics({ weightKg: null, heightCm: 180, sex: 'male' }).bmi).toBeNull();
  });

  it('categorizes', () => {
    expect(bmiCategory(17)).toBe('underweight');
    expect(bmiCategory(22)).toBe('normal');
    expect(bmiCategory(31)).toBe('obese');
    expect(ffmiCategory(17, 'female')).toBe('above_average');
  });
});
