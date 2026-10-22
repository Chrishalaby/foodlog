import {
  normalizeTargetOverrides,
  targetOverrideProblems,
} from './target-overrides.js';

describe('targetOverrideProblems', () => {
  it('accepts an empty object, in-range numbers and null for auto', () => {
    expect(targetOverrideProblems({})).toEqual([]);
    expect(
      targetOverrideProblems({
        calories: 2500,
        protein: 180,
        carbs: 0,
        fat: 10,
        satFatMax: 200,
        fiberMin: 1,
        sugarMax: 500,
        sodiumMax: 10000,
      }),
    ).toEqual([]);
    expect(targetOverrideProblems({ calories: null, protein: 150 })).toEqual(
      [],
    );
  });

  it.each([null, [], 'calories', 42, true])(
    'rejects %j as not an object',
    (value) => {
      expect(targetOverrideProblems(value)).toEqual([
        'targetOverrides must be an object',
      ]);
    },
  );

  it('rejects unknown keys', () => {
    expect(targetOverrideProblems({ calories: 2000, vitaminC: 90 })).toEqual([
      'targetOverrides.vitaminC is not a known target',
    ]);
  });

  it('rejects values outside TARGET_OVERRIDE_BOUNDS and non-numbers', () => {
    expect(
      targetOverrideProblems({
        calories: 799,
        protein: 501,
        sodiumMax: '2000',
        fat: Number.NaN,
      }),
    ).toEqual([
      'targetOverrides.calories must be a number between 800 and 8000, or null',
      'targetOverrides.protein must be a number between 20 and 500, or null',
      'targetOverrides.sodiumMax must be a number between 100 and 10000, or null',
      'targetOverrides.fat must be a number between 10 and 400, or null',
    ]);
  });
});

describe('normalizeTargetOverrides', () => {
  it('drops null, unknown and invalid values', () => {
    expect(
      normalizeTargetOverrides({
        calories: 2400,
        protein: null,
        fat: 5,
        mystery: 3,
      }),
    ).toEqual({ calories: 2400 });
  });

  it('rounds kcal and mg to integers and grams to one decimal', () => {
    expect(
      normalizeTargetOverrides({
        calories: 2400.4,
        sodiumMax: 1999.6,
        protein: 150.26,
      }),
    ).toEqual({ calories: 2400, sodiumMax: 2000, protein: 150.3 });
  });

  it('returns an empty object for stored garbage', () => {
    expect(normalizeTargetOverrides(null)).toEqual({});
    expect(normalizeTargetOverrides(['calories'])).toEqual({});
    expect(normalizeTargetOverrides('{"calories":2000}')).toEqual({});
  });
});
