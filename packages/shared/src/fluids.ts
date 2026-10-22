import { isFiniteNumber } from './nutrients.js';

export const FLUID_KINDS = ['water', 'coffee', 'tea', 'other'] as const;
export type FluidKind = (typeof FLUID_KINDS)[number];

export const FLUID_KIND_LABELS: Record<FluidKind, string> = {
  water: 'Water',
  coffee: 'Coffee',
  tea: 'Tea',
  other: 'Other',
};

export const FLUID_CAFFEINE_MG_PER_ML: Record<FluidKind, number> = {
  water: 0,
  coffee: 0.4,
  tea: 0.2,
  other: 0,
};

export const FLUID_LIMITS = {
  logMinMl: 10,
  logMaxMl: 3000,
  targetMinMl: 500,
  targetMaxMl: 8000,
} as const;

export const FLUID_AUTO_TARGET = {
  mlPerKg: 35,
  stepMl: 50,
  minMl: 1500,
  maxMl: 4500,
  noWeightMl: 2500,
  trainingDayExtraMl: 500,
} as const;

export function autoFluidTargetMl(weightKg: number | null, trainingDay: boolean): number {
  const rule = FLUID_AUTO_TARGET;
  const base =
    isFiniteNumber(weightKg) && weightKg > 0
      ? Math.min(Math.max(Math.round((weightKg * rule.mlPerKg) / rule.stepMl) * rule.stepMl, rule.minMl), rule.maxMl)
      : rule.noWeightMl;
  return trainingDay ? base + rule.trainingDayExtraMl : base;
}

export function fluidTargetMl(
  profile: { weightKg: number | null; fluidTargetMl?: number | null },
  trainingDay: boolean,
): number {
  const override = profile.fluidTargetMl;
  if (isFiniteNumber(override) && override > 0) {
    return Math.round(Math.min(Math.max(override, FLUID_LIMITS.targetMinMl), FLUID_LIMITS.targetMaxMl));
  }
  return autoFluidTargetMl(profile.weightKg, trainingDay);
}

export function fluidCaffeineMg(kind: FluidKind, ml: number): number {
  if (!isFiniteNumber(ml) || ml <= 0) {
    return 0;
  }
  return Math.round(ml * FLUID_CAFFEINE_MG_PER_ML[kind]);
}
