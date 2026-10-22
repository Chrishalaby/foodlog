import type { Sex } from './enums.js';
import { isFiniteNumber, roundTo } from './nutrients.js';

export const MICRO_KEYS = [
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'vitaminB6',
  'vitaminB12',
  'folate',
  'calcium',
  'iron',
  'magnesium',
  'potassium',
  'zinc',
  'cholesterol',
  'caffeine',
] as const;

export type MicroKey = (typeof MICRO_KEYS)[number];
export type Micros = Partial<Record<MicroKey, number>>;

export const MICRO_GROUPS = ['vitamin', 'mineral', 'other'] as const;
export type MicroGroup = (typeof MICRO_GROUPS)[number];

export interface MicroMeta {
  label: string;
  shortLabel: string;
  unit: 'mg' | 'µg';
  group: MicroGroup;
  decimals: number;
  max: number;
}

export const MICRO_TARGET_KINDS = ['rda', 'ai', 'limit'] as const;
export type MicroTargetKind = (typeof MICRO_TARGET_KINDS)[number];

export interface MicroTarget {
  amount: number;
  kind: MicroTargetKind;
  upperLimit: number | null;
}

export type MicroTargets = Record<MicroKey, MicroTarget>;

export interface MicrosCoverage {
  items: number;
  withMicros: number;
}

export const MICRO_META: Record<MicroKey, MicroMeta> = {
  vitaminA: { label: 'Vitamin A', shortLabel: 'Vit A', unit: 'µg', group: 'vitamin', decimals: 0, max: 30000 },
  vitaminC: { label: 'Vitamin C', shortLabel: 'Vit C', unit: 'mg', group: 'vitamin', decimals: 0, max: 10000 },
  vitaminD: { label: 'Vitamin D', shortLabel: 'Vit D', unit: 'µg', group: 'vitamin', decimals: 1, max: 2500 },
  vitaminE: { label: 'Vitamin E', shortLabel: 'Vit E', unit: 'mg', group: 'vitamin', decimals: 1, max: 1500 },
  vitaminK: { label: 'Vitamin K', shortLabel: 'Vit K', unit: 'µg', group: 'vitamin', decimals: 0, max: 10000 },
  vitaminB6: { label: 'Vitamin B6', shortLabel: 'B6', unit: 'mg', group: 'vitamin', decimals: 2, max: 500 },
  vitaminB12: { label: 'Vitamin B12', shortLabel: 'B12', unit: 'µg', group: 'vitamin', decimals: 2, max: 10000 },
  folate: { label: 'Folate', shortLabel: 'Folate', unit: 'µg', group: 'vitamin', decimals: 0, max: 20000 },
  calcium: { label: 'Calcium', shortLabel: 'Ca', unit: 'mg', group: 'mineral', decimals: 0, max: 5000 },
  iron: { label: 'Iron', shortLabel: 'Fe', unit: 'mg', group: 'mineral', decimals: 1, max: 300 },
  magnesium: { label: 'Magnesium', shortLabel: 'Mg', unit: 'mg', group: 'mineral', decimals: 0, max: 3000 },
  potassium: { label: 'Potassium', shortLabel: 'K', unit: 'mg', group: 'mineral', decimals: 0, max: 10000 },
  zinc: { label: 'Zinc', shortLabel: 'Zn', unit: 'mg', group: 'mineral', decimals: 1, max: 500 },
  cholesterol: { label: 'Cholesterol', shortLabel: 'Chol', unit: 'mg', group: 'other', decimals: 0, max: 10000 },
  caffeine: { label: 'Caffeine', shortLabel: 'Caff', unit: 'mg', group: 'other', decimals: 0, max: 2000 },
};

export const MICRO_PER100_CEILING: Record<MicroMeta['unit'], number> = { mg: 100_000, 'µg': 100_000_000 };

export const MICRO_LIMITS = {
  cholesterolMg: 300,
  caffeineMg: 400,
  caffeineUnder18Mg: 100,
  caffeineAdultAge: 18,
} as const;

export const MICRO_AGE_BANDS = ['14-18', '19-30', '31-50', '51-70', '71+'] as const;
export type MicroAgeBand = (typeof MICRO_AGE_BANDS)[number];

type ReferenceMicroKey = Exclude<MicroKey, 'cholesterol' | 'caffeine'>;

interface MicroReference {
  kind: Exclude<MicroTargetKind, 'limit'>;
  amounts: Record<MicroAgeBand, Readonly<Record<Sex, number>>>;
  upperLimits: Record<MicroAgeBand, number> | null;
}

function sameForAdults(teen: Readonly<Record<Sex, number>>, adult: Readonly<Record<Sex, number>>) {
  return { '14-18': teen, '19-30': adult, '31-50': adult, '51-70': adult, '71+': adult };
}

const MICRO_REFERENCES: Record<ReferenceMicroKey, MicroReference> = {
  vitaminA: {
    kind: 'rda',
    amounts: sameForAdults({ male: 900, female: 700 }, { male: 900, female: 700 }),
    upperLimits: null,
  },
  vitaminC: {
    kind: 'rda',
    amounts: sameForAdults({ male: 75, female: 65 }, { male: 90, female: 75 }),
    upperLimits: { '14-18': 1800, '19-30': 2000, '31-50': 2000, '51-70': 2000, '71+': 2000 },
  },
  vitaminD: {
    kind: 'rda',
    amounts: {
      '14-18': { male: 15, female: 15 },
      '19-30': { male: 15, female: 15 },
      '31-50': { male: 15, female: 15 },
      '51-70': { male: 15, female: 15 },
      '71+': { male: 20, female: 20 },
    },
    upperLimits: { '14-18': 100, '19-30': 100, '31-50': 100, '51-70': 100, '71+': 100 },
  },
  vitaminE: {
    kind: 'rda',
    amounts: sameForAdults({ male: 15, female: 15 }, { male: 15, female: 15 }),
    upperLimits: null,
  },
  vitaminK: {
    kind: 'ai',
    amounts: sameForAdults({ male: 75, female: 75 }, { male: 120, female: 90 }),
    upperLimits: null,
  },
  vitaminB6: {
    kind: 'rda',
    amounts: {
      '14-18': { male: 1.3, female: 1.2 },
      '19-30': { male: 1.3, female: 1.3 },
      '31-50': { male: 1.3, female: 1.3 },
      '51-70': { male: 1.7, female: 1.5 },
      '71+': { male: 1.7, female: 1.5 },
    },
    upperLimits: { '14-18': 80, '19-30': 100, '31-50': 100, '51-70': 100, '71+': 100 },
  },
  vitaminB12: {
    kind: 'rda',
    amounts: sameForAdults({ male: 2.4, female: 2.4 }, { male: 2.4, female: 2.4 }),
    upperLimits: null,
  },
  folate: {
    kind: 'rda',
    amounts: sameForAdults({ male: 400, female: 400 }, { male: 400, female: 400 }),
    upperLimits: null,
  },
  calcium: {
    kind: 'rda',
    amounts: {
      '14-18': { male: 1300, female: 1300 },
      '19-30': { male: 1000, female: 1000 },
      '31-50': { male: 1000, female: 1000 },
      '51-70': { male: 1000, female: 1200 },
      '71+': { male: 1200, female: 1200 },
    },
    upperLimits: { '14-18': 3000, '19-30': 2500, '31-50': 2500, '51-70': 2000, '71+': 2000 },
  },
  iron: {
    kind: 'rda',
    amounts: {
      '14-18': { male: 11, female: 15 },
      '19-30': { male: 8, female: 18 },
      '31-50': { male: 8, female: 18 },
      '51-70': { male: 8, female: 8 },
      '71+': { male: 8, female: 8 },
    },
    upperLimits: { '14-18': 45, '19-30': 45, '31-50': 45, '51-70': 45, '71+': 45 },
  },
  magnesium: {
    kind: 'rda',
    amounts: {
      '14-18': { male: 410, female: 360 },
      '19-30': { male: 400, female: 310 },
      '31-50': { male: 420, female: 320 },
      '51-70': { male: 420, female: 320 },
      '71+': { male: 420, female: 320 },
    },
    upperLimits: null,
  },
  potassium: {
    kind: 'ai',
    amounts: sameForAdults({ male: 3000, female: 2300 }, { male: 3400, female: 2600 }),
    upperLimits: null,
  },
  zinc: {
    kind: 'rda',
    amounts: sameForAdults({ male: 11, female: 9 }, { male: 11, female: 8 }),
    upperLimits: { '14-18': 34, '19-30': 40, '31-50': 40, '51-70': 40, '71+': 40 },
  },
};

export function microAgeBand(age: number | null): MicroAgeBand {
  if (!isFiniteNumber(age)) {
    return '31-50';
  }
  if (age < 19) {
    return '14-18';
  }
  if (age < 31) {
    return '19-30';
  }
  if (age < 51) {
    return '31-50';
  }
  if (age < 71) {
    return '51-70';
  }
  return '71+';
}

function referenceTarget(key: ReferenceMicroKey, sex: Sex | null, band: MicroAgeBand): MicroTarget {
  const reference = MICRO_REFERENCES[key];
  const { male, female } = reference.amounts[band];
  const amount = sex === null ? roundTo((male + female) / 2, MICRO_META[key].decimals) : sex === 'male' ? male : female;
  return { amount, kind: reference.kind, upperLimit: reference.upperLimits?.[band] ?? null };
}

export function microTargets(sex: Sex | null, age: number | null): MicroTargets {
  const band = microAgeBand(age);
  const target = (key: ReferenceMicroKey): MicroTarget => referenceTarget(key, sex, band);
  const minor = isFiniteNumber(age) && age < MICRO_LIMITS.caffeineAdultAge;
  return {
    vitaminA: target('vitaminA'),
    vitaminC: target('vitaminC'),
    vitaminD: target('vitaminD'),
    vitaminE: target('vitaminE'),
    vitaminK: target('vitaminK'),
    vitaminB6: target('vitaminB6'),
    vitaminB12: target('vitaminB12'),
    folate: target('folate'),
    calcium: target('calcium'),
    iron: target('iron'),
    magnesium: target('magnesium'),
    potassium: target('potassium'),
    zinc: target('zinc'),
    cholesterol: { amount: MICRO_LIMITS.cholesterolMg, kind: 'limit', upperLimit: null },
    caffeine: {
      amount: minor ? MICRO_LIMITS.caffeineUnder18Mg : MICRO_LIMITS.caffeineMg,
      kind: 'limit',
      upperLimit: null,
    },
  };
}

function sanitizeWithCeiling(input: unknown, ceiling: (key: MicroKey) => number): Micros | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const out: Micros = {};
  for (const key of MICRO_KEYS) {
    const value = Object.hasOwn(record, key) ? record[key] : undefined;
    if (isFiniteNumber(value) && value >= 0 && value <= ceiling(key)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function sanitizeMicros(input: unknown): Micros | null {
  return sanitizeWithCeiling(input, (key) => MICRO_META[key].max);
}

export function sanitizeMicrosPer100(input: unknown): Micros | null {
  return sanitizeWithCeiling(input, (key) => MICRO_PER100_CEILING[MICRO_META[key].unit]);
}

export function addMicros(a: Micros | null | undefined, b: Micros | null | undefined): Micros {
  const out: Micros = {};
  for (const key of MICRO_KEYS) {
    const x = a?.[key];
    const y = b?.[key];
    const hasX = isFiniteNumber(x);
    const hasY = isFiniteNumber(y);
    if (hasX || hasY) {
      out[key] = (hasX ? x : 0) + (hasY ? y : 0);
    }
  }
  return out;
}

export function sumMicros(list: ReadonlyArray<Micros | null | undefined>): Micros {
  return list.reduce<Micros>((acc, m) => addMicros(acc, m), {});
}

export function scaleMicros(m: Micros, factor: number): Micros;
export function scaleMicros(m: Micros | null | undefined, factor: number): Micros | null;
export function scaleMicros(m: Micros | null | undefined, factor: number): Micros | null {
  if (!m) {
    return null;
  }
  const safe = isFiniteNumber(factor) && factor > 0 ? factor : 0;
  const out: Micros = {};
  for (const key of MICRO_KEYS) {
    const value = m[key];
    if (isFiniteNumber(value)) {
      out[key] = value * safe;
    }
  }
  return out;
}

export function microsFromPer100(per100: Micros, grams: number): Micros;
export function microsFromPer100(per100: Micros | null | undefined, grams: number): Micros | null;
export function microsFromPer100(per100: Micros | null | undefined, grams: number): Micros | null {
  return scaleMicros(per100, grams / 100);
}

export function microsPer100From(micros: Micros | null | undefined, grams: number): Micros | null {
  if (!micros || !isFiniteNumber(grams) || grams <= 0) {
    return null;
  }
  return scaleMicros(micros, 100 / grams);
}

export function roundMicros(m: Micros): Micros;
export function roundMicros(m: Micros | null | undefined): Micros | null;
export function roundMicros(m: Micros | null | undefined): Micros | null {
  if (!m) {
    return null;
  }
  const out: Micros = {};
  for (const key of MICRO_KEYS) {
    const value = m[key];
    if (isFiniteNumber(value)) {
      out[key] = roundTo(value, MICRO_META[key].decimals);
    }
  }
  return out;
}

export function microPercent(amount: number, target: number): number {
  if (!isFiniteNumber(amount) || !isFiniteNumber(target) || amount <= 0 || target <= 0) {
    return 0;
  }
  return Math.round((amount / target) * 100);
}
