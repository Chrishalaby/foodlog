export const NUTRIENT_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'satFat',
  'fiber',
  'sugar',
  'sodium',
  'alcohol',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Record<NutrientKey, number>;

export interface NutrientMeta {
  label: string;
  shortLabel: string;
  unit: 'kcal' | 'g' | 'mg';
  decimals: number;
  max: number;
}

export const NUTRIENT_META: Record<NutrientKey, NutrientMeta> = {
  calories: { label: 'Calories', shortLabel: 'kcal', unit: 'kcal', decimals: 0, max: 20000 },
  protein: { label: 'Protein', shortLabel: 'P', unit: 'g', decimals: 1, max: 2000 },
  carbs: { label: 'Carbs', shortLabel: 'C', unit: 'g', decimals: 1, max: 2000 },
  fat: { label: 'Fat', shortLabel: 'F', unit: 'g', decimals: 1, max: 2000 },
  satFat: { label: 'Saturated fat', shortLabel: 'Sat', unit: 'g', decimals: 1, max: 2000 },
  fiber: { label: 'Fiber', shortLabel: 'Fib', unit: 'g', decimals: 1, max: 2000 },
  sugar: { label: 'Sugar', shortLabel: 'Sug', unit: 'g', decimals: 1, max: 2000 },
  sodium: { label: 'Sodium', shortLabel: 'Na', unit: 'mg', decimals: 0, max: 200000 },
  alcohol: { label: 'Alcohol', shortLabel: 'Alc', unit: 'g', decimals: 1, max: 2000 },
};

export const MAX_ITEM_GRAMS = 10000;

export function zeroNutrients(): Nutrients {
  return { calories: 0, protein: 0, carbs: 0, fat: 0, satFat: 0, fiber: 0, sugar: 0, sodium: 0, alcohol: 0 };
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizeNutrients(input: Partial<Record<NutrientKey, unknown>> | null | undefined): Nutrients {
  const out = zeroNutrients();
  if (!input) {
    return out;
  }
  for (const key of NUTRIENT_KEYS) {
    const value = input[key];
    out[key] = isFiniteNumber(value) && value > 0 ? value : 0;
  }
  return out;
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = a[key] + b[key];
  }
  return out;
}

export function sumNutrients(list: ReadonlyArray<Nutrients>): Nutrients {
  return list.reduce<Nutrients>((acc, n) => addNutrients(acc, n), zeroNutrients());
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const safe = isFiniteNumber(factor) && factor > 0 ? factor : 0;
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = n[key] * safe;
  }
  return out;
}

export function nutrientsFromPer100g(per100g: Nutrients, grams: number): Nutrients {
  return scaleNutrients(per100g, grams / 100);
}

export function per100gFromNutrients(n: Nutrients, grams: number): Nutrients | null {
  if (!isFiniteNumber(grams) || grams <= 0) {
    return null;
  }
  return scaleNutrients(n, 100 / grams);
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundNutrients(n: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = roundTo(n[key], NUTRIENT_META[key].decimals);
  }
  return out;
}

export function atwaterCalories(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat' | 'fiber' | 'alcohol'>): number {
  const availableCarbs = Math.max(0, n.carbs - n.fiber);
  return 4 * n.protein + 4 * availableCarbs + 2 * n.fiber + 9 * n.fat + 7 * n.alcohol;
}

export interface MacroSplit {
  protein: number;
  carbs: number;
  fat: number;
  alcohol: number;
}

export function macroSplit(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat' | 'alcohol'>): MacroSplit {
  const protein = 4 * n.protein;
  const carbs = 4 * n.carbs;
  const fat = 9 * n.fat;
  const alcohol = 7 * n.alcohol;
  const total = protein + carbs + fat + alcohol;
  if (total <= 0) {
    return { protein: 0, carbs: 0, fat: 0, alcohol: 0 };
  }
  return {
    protein: roundTo((protein / total) * 100, 1),
    carbs: roundTo((carbs / total) * 100, 1),
    fat: roundTo((fat / total) * 100, 1),
    alcohol: roundTo((alcohol / total) * 100, 1),
  };
}

export function formatNutrient(key: NutrientKey, value: number): string {
  const meta = NUTRIENT_META[key];
  const rounded = roundTo(value, meta.decimals);
  return `${rounded.toLocaleString('en-US', { maximumFractionDigits: meta.decimals })}${meta.unit === 'kcal' ? ' kcal' : ` ${meta.unit}`}`;
}
