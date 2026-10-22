import {
  type AdaptiveTdeeDto,
  BMI_CATEGORY_LABELS,
  type BmiCategory,
  FFMI_CATEGORY_LABELS,
  type FfmiCategory,
  type Goal,
  type Sex,
  diffDays,
  roundTo,
} from '@food/shared';
import { shortDateLabel } from '../../core/time';
import { formatNumber } from '../../shared/utils/format';

export type MetricTone = 'ok' | 'warn' | 'neutral';

export const BMI_EXPLANATION =
  'Body mass index compares your weight with your height. It cannot tell muscle from fat.';
export const LEAN_MASS_EXPLANATION =
  'Lean mass is everything except fat: muscle, bone, organs and water.';
export const FFMI_EXPLANATION =
  'Fat-free mass index is lean mass relative to height, normalized to 1.80 m. It shows how muscular you are.';

export const BMI_SCALE_MIN = 15;
export const BMI_SCALE_MAX = 40;

export interface BmiBand {
  category: BmiCategory;
  from: number;
  to: number;
}

export const BMI_BANDS: readonly BmiBand[] = [
  { category: 'underweight', from: BMI_SCALE_MIN, to: 18.5 },
  { category: 'normal', from: 18.5, to: 25 },
  { category: 'overweight', from: 25, to: 30 },
  { category: 'obese', from: 30, to: BMI_SCALE_MAX },
];

export const BMI_TONES: Record<BmiCategory, MetricTone> = {
  underweight: 'warn',
  normal: 'ok',
  overweight: 'warn',
  obese: 'warn',
};

export const FFMI_TONES: Record<FfmiCategory, MetricTone> = {
  low: 'neutral',
  average: 'neutral',
  above_average: 'ok',
  excellent: 'ok',
  very_high: 'ok',
};

export const TONE_TEXT_CLASSES: Record<MetricTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  neutral: 'text-muted',
};

export const TONE_CHIP_CLASSES: Record<MetricTone, string> = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  neutral: 'bg-surface-2 text-fg',
};

export function oneDecimal(value: number): string {
  return roundTo(value, 1).toFixed(1);
}

export function bmiLabel(category: BmiCategory): string {
  return BMI_CATEGORY_LABELS[category];
}

export function ffmiLabel(category: FfmiCategory): string {
  return FFMI_CATEGORY_LABELS[category];
}

export function scalePercent(value: number, min = BMI_SCALE_MIN, max = BMI_SCALE_MAX): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(((clamped - min) / (max - min)) * 1000) / 10;
}

export function bodyFatHint(sex: Sex | '' | null): string {
  if (sex === 'male') {
    return 'Most men are between 12 and 25 %. Skip if unsure.';
  }
  if (sex === 'female') {
    return 'Most women are between 20 and 35 %. Skip if unsure.';
  }
  return 'Most men are 12–25 %, most women 20–35 %. Skip if unsure.';
}

const MINUS = '−';

export function signedKg(kg: number, decimals = 1): string {
  if (roundTo(Math.abs(kg), decimals) === 0) {
    return '0 kg';
  }
  return `${kg < 0 ? MINUS : '+'}${formatNumber(Math.abs(kg), decimals)} kg`;
}

export function weeklyChangeTone(kg: number | null, goal: Goal): MetricTone {
  if (kg === null || !Number.isFinite(kg)) {
    return 'neutral';
  }
  if (goal === 'cut') {
    return kg < -0.05 ? 'ok' : kg > 0.1 ? 'warn' : 'neutral';
  }
  if (goal === 'bulk') {
    return kg > 0.05 ? 'ok' : kg < -0.1 ? 'warn' : 'neutral';
  }
  return Math.abs(kg) <= 0.25 ? 'ok' : 'warn';
}

export function daysAgoLabel(date: string, today: string): string {
  const days = diffDays(date, today);
  if (days <= 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return shortDateLabel(date, today);
}

export function adaptiveSummary(adaptive: AdaptiveTdeeDto): string {
  const weeks = Math.max(1, Math.round(adaptive.windowDays / 7));
  const weighIns = adaptive.weighIns === 1 ? '1 weigh-in' : `${adaptive.weighIns} weigh-ins`;
  return `From ${adaptive.loggedDays} logged days and ${weighIns} over the last ${weeks} weeks · ${adaptive.confidence} confidence`;
}
