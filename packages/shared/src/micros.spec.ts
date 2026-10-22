import { describe, expect, it } from 'vitest';
import type { Sex } from './enums.js';
import {
  MICRO_AGE_BANDS,
  MICRO_KEYS,
  MICRO_META,
  addMicros,
  microAgeBand,
  microPercent,
  microTargets,
  microsFromPer100,
  microsPer100From,
  roundMicros,
  sanitizeMicros,
  sanitizeMicrosPer100,
  scaleMicros,
  sumMicros,
  type MicroAgeBand,
  type MicroKey,
} from './micros.js';

const BAND_AGES: Record<MicroAgeBand, number> = { '14-18': 16, '19-30': 25, '31-50': 40, '51-70': 60, '71+': 80 };

type Row = Record<MicroAgeBand, [male: number, female: number]>;

const allBands = (teen: [number, number], adult: [number, number]): Row => ({
  '14-18': teen,
  '19-30': adult,
  '31-50': adult,
  '51-70': adult,
  '71+': adult,
});

const EXPECTED_AMOUNTS: Record<Exclude<MicroKey, 'cholesterol' | 'caffeine'>, Row> = {
  vitaminA: allBands([900, 700], [900, 700]),
  vitaminC: allBands([75, 65], [90, 75]),
  vitaminD: { '14-18': [15, 15], '19-30': [15, 15], '31-50': [15, 15], '51-70': [15, 15], '71+': [20, 20] },
  vitaminE: allBands([15, 15], [15, 15]),
  vitaminK: allBands([75, 75], [120, 90]),
  vitaminB6: { '14-18': [1.3, 1.2], '19-30': [1.3, 1.3], '31-50': [1.3, 1.3], '51-70': [1.7, 1.5], '71+': [1.7, 1.5] },
  vitaminB12: allBands([2.4, 2.4], [2.4, 2.4]),
  folate: allBands([400, 400], [400, 400]),
  calcium: {
    '14-18': [1300, 1300],
    '19-30': [1000, 1000],
    '31-50': [1000, 1000],
    '51-70': [1000, 1200],
    '71+': [1200, 1200],
  },
  iron: { '14-18': [11, 15], '19-30': [8, 18], '31-50': [8, 18], '51-70': [8, 8], '71+': [8, 8] },
  magnesium: {
    '14-18': [410, 360],
    '19-30': [400, 310],
    '31-50': [420, 320],
    '51-70': [420, 320],
    '71+': [420, 320],
  },
  potassium: allBands([3000, 2300], [3400, 2600]),
  zinc: allBands([11, 9], [11, 8]),
};

const EXPECTED_UPPER: Partial<Record<MicroKey, Record<MicroAgeBand, number>>> = {
  vitaminC: { '14-18': 1800, '19-30': 2000, '31-50': 2000, '51-70': 2000, '71+': 2000 },
  vitaminD: { '14-18': 100, '19-30': 100, '31-50': 100, '51-70': 100, '71+': 100 },
  vitaminB6: { '14-18': 80, '19-30': 100, '31-50': 100, '51-70': 100, '71+': 100 },
  calcium: { '14-18': 3000, '19-30': 2500, '31-50': 2500, '51-70': 2000, '71+': 2000 },
  iron: { '14-18': 45, '19-30': 45, '31-50': 45, '51-70': 45, '71+': 45 },
  zinc: { '14-18': 34, '19-30': 40, '31-50': 40, '51-70': 40, '71+': 40 },
};

const SEX_INDEX: Record<Sex, 0 | 1> = { male: 0, female: 1 };

describe('micro targets', () => {
  it('maps ages to DRI bands with 31-50 as the default', () => {
    expect(microAgeBand(null)).toBe('31-50');
    expect(microAgeBand(Number.NaN)).toBe('31-50');
    expect(microAgeBand(13)).toBe('14-18');
    expect(microAgeBand(18)).toBe('14-18');
    expect(microAgeBand(19)).toBe('19-30');
    expect(microAgeBand(30)).toBe('19-30');
    expect(microAgeBand(31)).toBe('31-50');
    expect(microAgeBand(50)).toBe('31-50');
    expect(microAgeBand(51)).toBe('51-70');
    expect(microAgeBand(70)).toBe('51-70');
    expect(microAgeBand(71)).toBe('71+');
    expect(microAgeBand(100)).toBe('71+');
  });

  for (const band of MICRO_AGE_BANDS) {
    for (const sex of ['male', 'female'] as const) {
      it(`matches the Food and Nutrition Board RDA/AI and UL for ${sex}s aged ${band}`, () => {
        const targets = microTargets(sex, BAND_AGES[band]);
        for (const [key, row] of Object.entries(EXPECTED_AMOUNTS) as [MicroKey, Row][]) {
          expect(targets[key].amount, `${key} amount`).toBe(row[band][SEX_INDEX[sex]]);
          expect(targets[key].upperLimit, `${key} upper limit`).toBe(EXPECTED_UPPER[key]?.[band] ?? null);
        }
      });
    }
  }

  it('marks adequate intakes and limits by kind', () => {
    const targets = microTargets('male', 30);
    expect(targets.vitaminK.kind).toBe('ai');
    expect(targets.potassium.kind).toBe('ai');
    expect(targets.cholesterol.kind).toBe('limit');
    expect(targets.caffeine.kind).toBe('limit');
    for (const key of ['vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminB6', 'vitaminB12', 'folate'] as const) {
      expect(targets[key].kind).toBe('rda');
    }
    for (const key of ['calcium', 'iron', 'magnesium', 'zinc'] as const) {
      expect(targets[key].kind).toBe('rda');
    }
  });

  it('leaves the upper limit off where the UL covers only supplements or preformed forms', () => {
    const targets = microTargets('female', 40);
    for (const key of ['vitaminA', 'vitaminE', 'vitaminK', 'vitaminB12', 'folate', 'magnesium', 'potassium'] as const) {
      expect(targets[key].upperLimit).toBeNull();
    }
  });

  it('uses a 300 mg cholesterol limit and a 400 mg caffeine limit, 100 mg under 18', () => {
    expect(microTargets('male', 30).cholesterol).toEqual({ amount: 300, kind: 'limit', upperLimit: null });
    expect(microTargets('male', 30).caffeine).toEqual({ amount: 400, kind: 'limit', upperLimit: null });
    expect(microTargets(null, null).caffeine.amount).toBe(400);
    expect(microTargets('female', 17).caffeine.amount).toBe(100);
    expect(microTargets('female', 18).caffeine.amount).toBe(400);
    expect(microTargets('female', 18).iron.amount).toBe(15);
  });

  it('averages both sexes when sex is unknown, rounded to the display precision', () => {
    const adult = microTargets(null, 25);
    expect(adult.vitaminA.amount).toBe(800);
    expect(adult.vitaminC.amount).toBe(83);
    expect(adult.vitaminK.amount).toBe(105);
    expect(adult.iron.amount).toBe(13);
    expect(adult.magnesium.amount).toBe(355);
    expect(adult.potassium.amount).toBe(3000);
    expect(adult.zinc.amount).toBe(9.5);
    expect(adult.vitaminB6.amount).toBe(1.3);
    expect(microTargets(null, 16).vitaminB6.amount).toBe(1.25);
    expect(microTargets(null, 60).calcium.amount).toBe(1100);
    expect(microTargets(null, 60).vitaminB6.amount).toBe(1.6);
    expect(adult.vitaminC.upperLimit).toBe(2000);
  });

  it('defaults to the 31-50 band when age is unknown', () => {
    expect(microTargets('male', null)).toEqual(microTargets('male', 40));
    expect(microTargets(null, null)).toEqual(microTargets(null, 45));
  });

  it('keeps every target and upper limit inside the per-item sanity range', () => {
    for (const band of MICRO_AGE_BANDS) {
      for (const sex of ['male', 'female', null] as const) {
        const targets = microTargets(sex, BAND_AGES[band]);
        for (const key of MICRO_KEYS) {
          const { amount, upperLimit } = targets[key];
          expect(amount).toBeGreaterThan(0);
          expect(amount).toBeLessThan(MICRO_META[key].max);
          if (upperLimit !== null) {
            expect(upperLimit).toBeGreaterThan(amount);
            expect(upperLimit).toBeLessThan(MICRO_META[key].max);
          }
        }
      }
    }
  });
});

describe('micro meta', () => {
  it('describes every key with DRI units', () => {
    expect(Object.keys(MICRO_META).sort()).toEqual([...MICRO_KEYS].sort());
    const micrograms = MICRO_KEYS.filter((key) => MICRO_META[key].unit === 'µg');
    expect(micrograms.sort()).toEqual(['folate', 'vitaminA', 'vitaminB12', 'vitaminD', 'vitaminK']);
    expect(MICRO_META.vitaminE.unit).toBe('mg');
    expect(MICRO_META.caffeine.group).toBe('other');
    expect(MICRO_META.cholesterol.group).toBe('other');
    expect(MICRO_META.zinc.group).toBe('mineral');
    expect(MICRO_META.folate.group).toBe('vitamin');
  });

  it('accepts single high-dose supplements and pre-workouts as one item', () => {
    const supplements = sanitizeMicros({
      vitaminD: 125,
      vitaminC: 1000,
      caffeine: 300,
      vitaminB12: 5000,
      vitaminE: 268,
      zinc: 50,
      iron: 65,
      folate: 1700,
      vitaminB6: 100,
      vitaminA: 3000,
      magnesium: 500,
      calcium: 1200,
    });
    expect(supplements).toEqual({
      vitaminD: 125,
      vitaminC: 1000,
      caffeine: 300,
      vitaminB12: 5000,
      vitaminE: 268,
      zinc: 50,
      iron: 65,
      folate: 1700,
      vitaminB6: 100,
      vitaminA: 3000,
      magnesium: 500,
      calcium: 1200,
    });
    expect(sanitizeMicros({ vitaminD: 1250 })).toEqual({ vitaminD: 1250 });
    expect(sanitizeMicros({ caffeine: 400 })).toEqual({ caffeine: 400 });
  });
});

describe('micros math', () => {
  it('sanitizes unknown keys, invalid values and implausible amounts', () => {
    expect(
      sanitizeMicros({
        vitaminC: 12.5,
        iron: 0,
        zinc: -1,
        calcium: Number.NaN,
        potassium: Number.POSITIVE_INFINITY,
        magnesium: '40',
        caffeine: 5000,
        sodium: 400,
      }),
    ).toEqual({ vitaminC: 12.5, iron: 0 });
    expect(sanitizeMicros({ zinc: -1 })).toBeNull();
    expect(sanitizeMicros({})).toBeNull();
    expect(sanitizeMicros(null)).toBeNull();
    expect(sanitizeMicros(undefined)).toBeNull();
    expect(sanitizeMicros('vitaminC')).toBeNull();
    expect(sanitizeMicros([1, 2])).toBeNull();
    expect(sanitizeMicros(Object.create({ vitaminC: 10 }))).toBeNull();
  });

  it('allows per-100 values of concentrated supplements up to the physical maximum', () => {
    expect(sanitizeMicrosPer100({ vitaminD: 41667, vitaminC: 77000, caffeine: 4600 })).toEqual({
      vitaminD: 41667,
      vitaminC: 77000,
      caffeine: 4600,
    });
    expect(sanitizeMicros({ vitaminD: 41667 })).toBeNull();
    expect(sanitizeMicrosPer100({ caffeine: 100_001, vitaminD: 100_000_001, iron: -2 })).toBeNull();
    expect(sanitizeMicrosPer100({ caffeine: 100_000 })).toEqual({ caffeine: 100_000 });
  });

  it('adds as a union where a missing key stays unknown', () => {
    expect(addMicros({ vitaminC: 10, iron: 1 }, { vitaminC: 5, zinc: 2 })).toEqual({ vitaminC: 15, iron: 1, zinc: 2 });
    expect(addMicros(null, { iron: 2 })).toEqual({ iron: 2 });
    expect(addMicros(undefined, null)).toEqual({});
    expect(addMicros({ iron: Number.NaN }, { iron: 2 })).toEqual({ iron: 2 });
    expect(sumMicros([{ caffeine: 120 }, null, { caffeine: 80, vitaminD: 125 }, undefined])).toEqual({
      caffeine: 200,
      vitaminD: 125,
    });
    expect(sumMicros([])).toEqual({});
  });

  it('scales and converts between per-100 and absolute amounts', () => {
    expect(scaleMicros({ vitaminC: 10, iron: 2 }, 1.5)).toEqual({ vitaminC: 15, iron: 3 });
    expect(scaleMicros({ vitaminC: 10 }, -1)).toEqual({ vitaminC: 0 });
    expect(scaleMicros({ vitaminC: 10 }, Number.NaN)).toEqual({ vitaminC: 0 });
    expect(scaleMicros(null, 2)).toBeNull();
    const apple = microsFromPer100({ vitaminC: 4.6, potassium: 107, vitaminK: 2.2 }, 182);
    expect(roundMicros(apple)).toEqual({ vitaminC: 8, potassium: 195, vitaminK: 4 });
    expect(microsFromPer100(undefined, 100)).toBeNull();
    expect(microsPer100From({ vitaminD: 125 }, 0.5)).toEqual({ vitaminD: 25000 });
    expect(microsPer100From({ vitaminD: 125 }, 0)).toBeNull();
    expect(microsPer100From({ vitaminD: 125 }, -3)).toBeNull();
    expect(microsPer100From({ vitaminD: 125 }, Number.NaN)).toBeNull();
    expect(microsPer100From(null, 100)).toBeNull();
    expect(microsFromPer100(microsPer100From({ caffeine: 300 }, 6.5)!, 6.5).caffeine).toBeCloseTo(300, 9);
  });

  it('rounds each key to its display precision', () => {
    expect(
      roundMicros({
        vitaminA: 12.6,
        vitaminD: 2.46,
        vitaminB6: 0.123,
        vitaminB12: 0.456,
        iron: 1.25,
        caffeine: 79.5,
      }),
    ).toEqual({ vitaminA: 13, vitaminD: 2.5, vitaminB6: 0.12, vitaminB12: 0.46, iron: 1.3, caffeine: 80 });
    expect(roundMicros(null)).toBeNull();
  });

  it('computes whole percentages of a target', () => {
    expect(microPercent(125, 15)).toBe(833);
    expect(microPercent(45, 90)).toBe(50);
    expect(microPercent(1, 3)).toBe(33);
    expect(microPercent(0, 90)).toBe(0);
    expect(microPercent(10, 0)).toBe(0);
    expect(microPercent(-5, 90)).toBe(0);
    expect(microPercent(Number.NaN, 90)).toBe(0);
  });
});
