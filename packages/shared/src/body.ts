import type { Sex } from './enums.js';
import { roundTo } from './nutrients.js';

export const BODY_BOUNDS = {
  weightKg: { min: 25, max: 400 },
  heightCm: { min: 100, max: 250 },
  age: { min: 13, max: 100 },
  bodyFatPct: { min: 3, max: 70 },
  trainingDaysPerWeek: { min: 0, max: 7 },
  tdeeOverride: { min: 800, max: 8000 },
} as const;

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese';
export type FfmiCategory = 'low' | 'average' | 'above_average' | 'excellent' | 'very_high';

export const BMI_CATEGORY_LABELS: Record<BmiCategory, string> = {
  underweight: 'Underweight',
  normal: 'Healthy range',
  overweight: 'Overweight',
  obese: 'Obese',
};

export const FFMI_CATEGORY_LABELS: Record<FfmiCategory, string> = {
  low: 'Below average',
  average: 'Average',
  above_average: 'Above average',
  excellent: 'Excellent',
  very_high: 'Very high',
};

export interface BodyMetricsInput {
  weightKg: number | null;
  heightCm: number | null;
  bodyFatPct?: number | null;
  sex: Sex | null;
}

export interface BodyMetrics {
  bmi: number | null;
  bmiCategory: BmiCategory | null;
  leanMassKg: number | null;
  fatMassKg: number | null;
  ffmi: number | null;
  ffmiNormalized: number | null;
  ffmiCategory: FfmiCategory | null;
}

const FFMI_THRESHOLDS: Record<Sex, readonly [number, number, number, number]> = {
  male: [18, 20, 22, 25],
  female: [14, 16, 18, 21],
};

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) {
    return 'underweight';
  }
  if (bmi < 25) {
    return 'normal';
  }
  if (bmi < 30) {
    return 'overweight';
  }
  return 'obese';
}

export function ffmiCategory(ffmiNormalized: number, sex: Sex): FfmiCategory {
  const [low, average, above, excellent] = FFMI_THRESHOLDS[sex];
  if (ffmiNormalized < low) {
    return 'low';
  }
  if (ffmiNormalized < average) {
    return 'average';
  }
  if (ffmiNormalized < above) {
    return 'above_average';
  }
  if (ffmiNormalized < excellent) {
    return 'excellent';
  }
  return 'very_high';
}

export function computeBodyMetrics(input: BodyMetricsInput): BodyMetrics {
  const empty: BodyMetrics = {
    bmi: null,
    bmiCategory: null,
    leanMassKg: null,
    fatMassKg: null,
    ffmi: null,
    ffmiNormalized: null,
    ffmiCategory: null,
  };
  if (!positive(input.weightKg) || !positive(input.heightCm)) {
    return empty;
  }
  const heightM = input.heightCm / 100;
  const bmi = input.weightKg / (heightM * heightM);
  const metrics: BodyMetrics = { ...empty, bmi: roundTo(bmi, 1), bmiCategory: bmiCategory(bmi) };
  if (!positive(input.bodyFatPct) || input.bodyFatPct >= 100) {
    return metrics;
  }
  const leanMassKg = input.weightKg * (1 - input.bodyFatPct / 100);
  const ffmi = leanMassKg / (heightM * heightM);
  const ffmiNormalized = ffmi + 6.1 * (1.8 - heightM);
  return {
    ...metrics,
    leanMassKg: roundTo(leanMassKg, 1),
    fatMassKg: roundTo(input.weightKg - leanMassKg, 1),
    ffmi: roundTo(ffmi, 1),
    ffmiNormalized: roundTo(ffmiNormalized, 1),
    ffmiCategory: input.sex ? ffmiCategory(ffmiNormalized, input.sex) : null,
  };
}
