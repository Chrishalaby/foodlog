import type { ActivityLevel, Goal, Sex } from './enums.js';

export const TARGET_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'satFatMax',
  'fiberMin',
  'sugarMax',
  'sodiumMax',
] as const;

export type TargetKey = (typeof TARGET_KEYS)[number];
export type TargetValues = Record<TargetKey, number>;
export type TargetOverrides = Partial<TargetValues>;

export const TARGET_META: Record<TargetKey, { label: string; unit: 'kcal' | 'g' | 'mg'; kind: 'goal' | 'min' | 'max' }> = {
  calories: { label: 'Calories', unit: 'kcal', kind: 'goal' },
  protein: { label: 'Protein', unit: 'g', kind: 'goal' },
  carbs: { label: 'Carbs', unit: 'g', kind: 'goal' },
  fat: { label: 'Fat', unit: 'g', kind: 'goal' },
  satFatMax: { label: 'Saturated fat limit', unit: 'g', kind: 'max' },
  fiberMin: { label: 'Fiber minimum', unit: 'g', kind: 'min' },
  sugarMax: { label: 'Sugar limit', unit: 'g', kind: 'max' },
  sodiumMax: { label: 'Sodium limit', unit: 'mg', kind: 'max' },
};

export const TARGET_OVERRIDE_BOUNDS: Record<TargetKey, { min: number; max: number }> = {
  calories: { min: 800, max: 8000 },
  protein: { min: 20, max: 500 },
  carbs: { min: 0, max: 1200 },
  fat: { min: 10, max: 400 },
  satFatMax: { min: 1, max: 200 },
  fiberMin: { min: 1, max: 150 },
  sugarMax: { min: 1, max: 500 },
  sodiumMax: { min: 100, max: 10000 },
};

export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

export const GOAL_FACTOR: Record<Goal, number> = { maintain: 1.0, cut: 0.8, bulk: 1.1 };
export const PROTEIN_G_PER_KG: Record<Goal, number> = { maintain: 1.6, cut: 2.2, bulk: 1.8 };
export const FAT_SHARE: Record<Goal, number> = { maintain: 0.3, cut: 0.25, bulk: 0.25 };

export const TARGET_LIMITS = {
  maxDeficitKcal: 1000,
  maxSurplusKcal: 500,
  kcalFloor: { male: 1500, female: 1200 } as Record<Sex, number>,
  genericKcalFloor: 1200,
  fatMinGPerKg: 0.5,
  fatMinShare: 0.2,
  defaultFatShare: 0.3,
  satFatMaxShare: 0.1,
  fiberGPer1000Kcal: 14,
  fiberMinG: 25,
  sugarRefGPer2000Kcal: 90,
  sodiumMaxMg: 2300,
  carbRdaG: 130,
  trainingDayShare: 0.1,
  restDayMaxShare: 0.15,
  proteinRefBmi: 25,
  proteinRefBmiThreshold: 30,
} as const;

export const DEFAULT_BASE_TARGETS: TargetValues = {
  calories: 2000,
  protein: 120,
  carbs: 225,
  fat: 67,
  satFatMax: 22,
  fiberMin: 28,
  sugarMax: 90,
  sodiumMax: 2300,
};

export interface TargetProfileInput {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: Sex | null;
  bodyFatPct?: number | null;
  tdeeOverride?: number | null;
  activityLevel: ActivityLevel;
  goal: Goal;
  trainingDaysPerWeek: number;
  targetOverrides: TargetOverrides;
}

export type BmrFormula = 'mifflin_st_jeor' | 'katch_mcardle';
export type TdeeSource = 'formula' | 'override';

export interface TargetsResult {
  complete: boolean;
  bmr: number | null;
  bmrFormula: BmrFormula | null;
  tdee: number | null;
  tdeeSource: TdeeSource | null;
  computedBase: TargetValues;
  base: TargetValues;
  trainingDay: TargetValues;
  restDay: TargetValues;
  trainingDeltaKcal: number;
  restDeltaKcal: number;
  warnings: string[];
}

const round10 = (x: number): number => Math.round(x / 10) * 10;

export function bmrMifflinStJeor(p: { sex: Sex; age: number; heightCm: number; weightKg: number }): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}

export function bmrKatchMcArdle(p: { weightKg: number; bodyFatPct: number }): number {
  return 370 + 21.6 * p.weightKg * (1 - p.bodyFatPct / 100);
}

function validNumber(value: number | null | undefined, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function proteinReferenceKg(p: { heightCm: number; weightKg: number }): number {
  const h2 = (p.heightCm / 100) ** 2;
  return p.weightKg / h2 > TARGET_LIMITS.proteinRefBmiThreshold ? TARGET_LIMITS.proteinRefBmi * h2 : p.weightKg;
}

export function isProfileComplete(
  p: Pick<TargetProfileInput, 'weightKg' | 'heightCm' | 'age' | 'sex'>,
): p is Pick<TargetProfileInput, 'weightKg' | 'heightCm' | 'age' | 'sex'> & {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
} {
  return (
    typeof p.weightKg === 'number' &&
    p.weightKg > 0 &&
    typeof p.heightCm === 'number' &&
    p.heightCm > 0 &&
    typeof p.age === 'number' &&
    p.age > 0 &&
    (p.sex === 'male' || p.sex === 'female')
  );
}

function scaledLimits(kcal: number): Pick<TargetValues, 'satFatMax' | 'fiberMin' | 'sugarMax' | 'sodiumMax'> {
  return {
    satFatMax: Math.round((TARGET_LIMITS.satFatMaxShare * kcal) / 9),
    fiberMin: Math.max(TARGET_LIMITS.fiberMinG, Math.round((TARGET_LIMITS.fiberGPer1000Kcal * kcal) / 1000)),
    sugarMax: Math.round((TARGET_LIMITS.sugarRefGPer2000Kcal * kcal) / 2000),
    sodiumMax: TARGET_LIMITS.sodiumMaxMg,
  };
}

function carbsRemainder(kcal: number, protein: number, fat: number): number {
  return Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4));
}

function validOverride(overrides: TargetOverrides, key: keyof TargetValues): number | undefined {
  const value = overrides[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function dayTargets(
  base: TargetValues,
  overrides: TargetOverrides,
  deltaKcal: number,
): TargetValues {
  if (deltaKcal === 0) {
    return { ...base };
  }
  const calories = Math.max(0, base.calories + deltaKcal);
  const limits = scaledLimits(calories);
  return {
    calories,
    protein: base.protein,
    fat: base.fat,
    carbs: Math.max(0, Math.round(base.carbs + deltaKcal / 4)),
    satFatMax: validOverride(overrides, 'satFatMax') ?? limits.satFatMax,
    fiberMin: validOverride(overrides, 'fiberMin') ?? limits.fiberMin,
    sugarMax: validOverride(overrides, 'sugarMax') ?? limits.sugarMax,
    sodiumMax: validOverride(overrides, 'sodiumMax') ?? limits.sodiumMax,
  };
}

export function computeTargets(input: TargetProfileInput): TargetsResult {
  const warnings: string[] = [];
  const overrides = input.targetOverrides ?? {};
  let bmr: number | null = null;
  let bmrFormula: BmrFormula | null = null;
  let tdee: number | null = null;
  let tdeeSource: TdeeSource | null = null;
  let computedBase: TargetValues;
  let fatShare: number = TARGET_LIMITS.defaultFatShare;
  let fatFloorG = 0;
  const floor: number = input.sex ? TARGET_LIMITS.kcalFloor[input.sex] : TARGET_LIMITS.genericKcalFloor;
  const weightKg = validNumber(input.weightKg, 1, 1000) ? input.weightKg : null;
  const bodyFatPct = validNumber(input.bodyFatPct, 1, 80) ? input.bodyFatPct : null;
  const tdeeOverride = validNumber(input.tdeeOverride, 500, 10000) ? input.tdeeOverride : null;

  if (weightKg !== null && bodyFatPct !== null) {
    bmr = bmrKatchMcArdle({ weightKg, bodyFatPct });
    bmrFormula = 'katch_mcardle';
  } else if (isProfileComplete(input)) {
    bmr = bmrMifflinStJeor(input);
    bmrFormula = 'mifflin_st_jeor';
  }
  if (tdeeOverride !== null) {
    tdee = tdeeOverride;
    tdeeSource = 'override';
  } else if (bmr !== null) {
    tdee = bmr * ACTIVITY_FACTOR[input.activityLevel];
    tdeeSource = 'formula';
  }
  const complete = tdee !== null && weightKg !== null;

  if (tdee !== null && weightKg !== null) {
    let kcal = tdee * GOAL_FACTOR[input.goal];
    kcal = Math.min(Math.max(kcal, tdee - TARGET_LIMITS.maxDeficitKcal), tdee + TARGET_LIMITS.maxSurplusKcal);
    if (kcal < floor) {
      warnings.push(`Calories raised to the safe minimum of ${floor} kcal.`);
      kcal = floor;
    }
    kcal = round10(kcal);
    fatShare = FAT_SHARE[input.goal];
    fatFloorG = TARGET_LIMITS.fatMinGPerKg * weightKg;
    const referenceKg =
      typeof input.heightCm === 'number' && input.heightCm > 0
        ? proteinReferenceKg({ heightCm: input.heightCm, weightKg })
        : weightKg;
    const protein = Math.round(PROTEIN_G_PER_KG[input.goal] * referenceKg);
    const fat = Math.round(Math.max((fatShare * kcal) / 9, (TARGET_LIMITS.fatMinShare * kcal) / 9, fatFloorG));
    computedBase = { calories: kcal, protein, fat, carbs: carbsRemainder(kcal, protein, fat), ...scaledLimits(kcal) };
    bmr = bmr === null ? null : Math.round(bmr);
    tdee = Math.round(tdee);
  } else {
    computedBase = { ...DEFAULT_BASE_TARGETS };
    bmr = bmr === null ? null : Math.round(bmr);
    tdee = tdee === null ? null : Math.round(tdee);
    warnings.push('Profile incomplete: using generic 2000 kcal targets. Add weight, height, age and sex in Settings.');
  }

  const calories = validOverride(overrides, 'calories') ?? computedBase.calories;
  const caloriesChanged = calories !== computedBase.calories;
  const protein = validOverride(overrides, 'protein') ?? computedBase.protein;
  const fat =
    validOverride(overrides, 'fat') ??
    (caloriesChanged
      ? Math.round(Math.max((fatShare * calories) / 9, (TARGET_LIMITS.fatMinShare * calories) / 9, fatFloorG))
      : computedBase.fat);
  const carbs = validOverride(overrides, 'carbs') ?? carbsRemainder(calories, protein, fat);
  const limits = scaledLimits(calories);
  const base: TargetValues = {
    calories,
    protein,
    fat,
    carbs,
    satFatMax: validOverride(overrides, 'satFatMax') ?? limits.satFatMax,
    fiberMin: validOverride(overrides, 'fiberMin') ?? limits.fiberMin,
    sugarMax: validOverride(overrides, 'sugarMax') ?? limits.sugarMax,
    sodiumMax: validOverride(overrides, 'sodiumMax') ?? limits.sodiumMax,
  };

  const macroKcal = 4 * base.protein + 4 * base.carbs + 9 * base.fat;
  if (Math.abs(macroKcal - base.calories) > Math.max(100, base.calories * 0.1)) {
    warnings.push(
      `Protein, carbs and fat add up to ${Math.round(macroKcal)} kcal, which differs from the ${base.calories} kcal target.`,
    );
  }
  if (base.carbs < TARGET_LIMITS.carbRdaG) {
    warnings.push(`Carbs (${base.carbs} g) are below the ${TARGET_LIMITS.carbRdaG} g/day recommended minimum.`);
  }

  const t = Math.min(Math.max(Math.round(input.trainingDaysPerWeek ?? 0), 0), 7);
  let trainingDeltaKcal = 0;
  let restDeltaKcal = 0;
  if (t === 0) {
    trainingDeltaKcal = round10(base.calories * TARGET_LIMITS.trainingDayShare);
  } else if (t < 7) {
    let delta = round10(base.calories * TARGET_LIMITS.trainingDayShare);
    const maxRestReduction = Math.min(base.calories - floor, base.calories * TARGET_LIMITS.restDayMaxShare);
    const maxDelta = (Math.max(0, maxRestReduction) * (7 - t)) / t;
    if (delta > maxDelta) {
      delta = Math.max(0, Math.floor(maxDelta / 10) * 10);
    }
    trainingDeltaKcal = delta;
    restDeltaKcal = -round10((delta * t) / (7 - t));
  }

  return {
    complete,
    bmr,
    bmrFormula,
    tdee,
    tdeeSource,
    computedBase,
    base,
    trainingDay: dayTargets(base, overrides, trainingDeltaKcal),
    restDay: dayTargets(base, overrides, restDeltaKcal),
    trainingDeltaKcal,
    restDeltaKcal,
    warnings,
  };
}

export function targetsForDay(result: Pick<TargetsResult, 'trainingDay' | 'restDay'>, trainingDay: boolean): TargetValues {
  return trainingDay ? result.trainingDay : result.restDay;
}
