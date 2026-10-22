import {
  type DaySummary,
  macroSplit,
  NUTRIENT_KEYS,
  type NutrientKey,
  type Nutrients,
  type RangeStats,
  roundNutrients,
  roundTo,
  TARGET_KEYS,
  TARGET_META,
  type TargetKey,
  type TargetValues,
  weekdayOf,
  type WeekdayAverage,
  zeroNutrients,
} from '@food/shared';
import { averageMicros, isMicrosDay, sumCoverage } from './day-micros.js';

export const PROTEIN_HIT_RATIO = 0.9;
export const CALORIE_TOLERANCE = 0.1;
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const FLOAT_TOLERANCE = 1e-9;

export function isAtLeast(value: number, threshold: number): boolean {
  return value >= threshold - FLOAT_TOLERANCE;
}

export function isAtMost(value: number, limit: number): boolean {
  return value <= limit + FLOAT_TOLERANCE;
}

export function isLogged(day: Pick<DaySummary, 'entryCount'>): boolean {
  return day.entryCount > 0;
}

export function loggedDays<T extends Pick<DaySummary, 'entryCount'>>(
  days: readonly T[],
): T[] {
  return days.filter(isLogged);
}

export function proteinHit(day: DaySummary): boolean {
  return isAtLeast(day.totals.protein, day.targets.protein * PROTEIN_HIT_RATIO);
}

export function caloriesOnTarget(day: DaySummary): boolean {
  const target = day.targets.calories;
  return isAtMost(
    Math.abs(day.totals.calories - target),
    target * CALORIE_TOLERANCE,
  );
}

export function isOverLimit(
  day: Pick<DaySummary, 'totals' | 'targets'>,
  nutrient: NutrientKey,
  limit: TargetKey,
): boolean {
  return !isAtMost(day.totals[nutrient], day.targets[limit]);
}

export function satFatOver(day: DaySummary): boolean {
  return isOverLimit(day, 'satFat', 'satFatMax');
}

export function sodiumOver(day: DaySummary): boolean {
  return isOverLimit(day, 'sodium', 'sodiumMax');
}

export function sugarOver(day: DaySummary): boolean {
  return isOverLimit(day, 'sugar', 'sugarMax');
}

export function fiberHit(day: DaySummary): boolean {
  return isAtLeast(day.totals.fiber, day.targets.fiberMin);
}

export function hasFluids(day: Pick<DaySummary, 'fluidsMl'>): boolean {
  return day.fluidsMl > 0;
}

export function fluidHit(
  day: Pick<DaySummary, 'fluidsMl' | 'fluidTargetMl'>,
): boolean {
  return (
    hasFluids(day) &&
    day.fluidTargetMl > 0 &&
    isAtLeast(day.fluidsMl, day.fluidTargetMl)
  );
}

export function countWhere<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): number {
  return items.reduce(
    (count, item) => (predicate(item) ? count + 1 : count),
    0,
  );
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function averageNutrients(
  days: readonly Pick<DaySummary, 'totals'>[],
): Nutrients {
  const average = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    average[key] = mean(days.map((day) => day.totals[key]));
  }
  return roundNutrients(average);
}

function targetDecimals(key: TargetKey): number {
  return TARGET_META[key].unit === 'g' ? 1 : 0;
}

export function averageTargets(
  days: readonly Pick<DaySummary, 'targets'>[],
): TargetValues {
  const average = {} as TargetValues;
  for (const key of TARGET_KEYS) {
    average[key] = roundTo(
      mean(days.map((day) => day.targets[key])),
      targetDecimals(key),
    );
  }
  return average;
}

function weekdayAverage(
  weekday: number,
  days: readonly DaySummary[],
): WeekdayAverage {
  const matching = days.filter((day) => weekdayOf(day.date) === weekday);
  const totals = averageNutrients(matching);
  return {
    weekday,
    loggedDays: matching.length,
    calories: totals.calories,
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
  };
}

export function weekdayAverages(days: readonly DaySummary[]): WeekdayAverage[] {
  const logged = loggedDays(days);
  return WEEKDAYS.map((weekday) => weekdayAverage(weekday, logged));
}

export function microsDays(days: readonly DaySummary[]): DaySummary[] {
  return days.filter((day) => isMicrosDay(day.microsCoverage));
}

export function computeRangeStats(days: readonly DaySummary[]): RangeStats {
  const logged = loggedDays(days);
  const avgTotals = averageNutrients(logged);
  const withMicros = microsDays(days);
  const withFluids = days.filter(hasFluids);
  return {
    loggedDays: logged.length,
    totalDays: days.length,
    avgTotals,
    avgTargets: averageTargets(logged.length > 0 ? logged : days),
    macroSplit: macroSplit(avgTotals),
    proteinHitDays: countWhere(logged, proteinHit),
    calorieOnTargetDays: countWhere(logged, caloriesOnTarget),
    satFatOverDays: countWhere(logged, satFatOver),
    sodiumOverDays: countWhere(logged, sodiumOver),
    fiberHitDays: countWhere(logged, fiberHit),
    weekdayAverages: weekdayAverages(logged),
    avgMicros: averageMicros(withMicros.map((day) => day.micros)),
    microsCoverage: sumCoverage(days.map((day) => day.microsCoverage)),
    microsDays: withMicros.length,
    avgFluidsMl: Math.round(mean(withFluids.map((day) => day.fluidsMl))),
    fluidDays: withFluids.length,
    fluidHitDays: countWhere(withFluids, fluidHit),
  };
}
