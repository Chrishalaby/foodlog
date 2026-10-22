import type { NutrientKey } from '@food/shared';

export const NUTRIENT_COLORS: Record<NutrientKey, string> = {
  calories: 'var(--color-calories)',
  protein: 'var(--color-protein)',
  carbs: 'var(--color-carbs)',
  fat: 'var(--color-fat)',
  satFat: 'var(--color-satfat)',
  fiber: 'var(--color-fiber)',
  sugar: 'var(--color-sugar)',
  sodium: 'var(--color-sodium)',
  alcohol: 'var(--color-alcohol)',
};

export const MACRO_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
] as const satisfies readonly NutrientKey[];
export const EXTRA_NUTRIENT_KEYS = [
  'satFat',
  'fiber',
  'sugar',
  'sodium',
  'alcohol',
] as const satisfies readonly NutrientKey[];
