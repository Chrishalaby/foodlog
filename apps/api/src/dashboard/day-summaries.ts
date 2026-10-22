import {
  type DaySummary,
  NUTRIENT_KEYS,
  type NutrientKey,
  type Nutrients,
  roundNutrients,
  targetsForDay,
  type TargetsResult,
  zeroNutrients,
} from '@food/shared';
import {
  type DayFluidContext,
  type DayFluids,
  dayFluids,
} from './day-fluids.js';
import { type DayMicros, emptyCoverage } from './day-micros.js';

export const NUTRIENT_SUM = {
  calories: true,
  protein: true,
  carbs: true,
  fat: true,
  satFat: true,
  fiber: true,
  sugar: true,
  sodium: true,
  alcohol: true,
} as const satisfies Record<NutrientKey, true>;

export type NutrientSums = Record<NutrientKey, number | null>;

export interface DayTotals {
  totals: Nutrients;
  entryCount: number;
}

export function nutrientsFromSums(
  sums: NutrientSums | null | undefined,
): Nutrients {
  const totals = zeroNutrients();
  if (!sums) {
    return totals;
  }
  for (const key of NUTRIENT_KEYS) {
    totals[key] = sums[key] ?? 0;
  }
  return roundNutrients(totals);
}

export function buildDaySummary(
  date: string,
  trainingDay: boolean,
  targets: Pick<TargetsResult, 'trainingDay' | 'restDay'>,
  dayTotals: DayTotals | undefined,
  dayMicros?: DayMicros,
  fluids?: DayFluids,
): DaySummary {
  return {
    date,
    trainingDay,
    targets: { ...targetsForDay(targets, trainingDay) },
    totals: dayTotals ? { ...dayTotals.totals } : zeroNutrients(),
    entryCount: dayTotals?.entryCount ?? 0,
    micros: { ...dayMicros?.micros },
    microsCoverage: dayMicros ? { ...dayMicros.coverage } : emptyCoverage(),
    fluidsMl: fluids?.ml ?? 0,
    fluidTargetMl: fluids?.targetMl ?? 0,
  };
}

export function buildDaySummaries(
  dates: readonly string[],
  totalsByDate: ReadonlyMap<string, DayTotals>,
  trainingDates: ReadonlySet<string>,
  targets: Pick<TargetsResult, 'trainingDay' | 'restDay'>,
  microsByDate: ReadonlyMap<string, DayMicros> = new Map(),
  fluids?: DayFluidContext,
): DaySummary[] {
  return dates.map((date) => {
    const trainingDay = trainingDates.has(date);
    return buildDaySummary(
      date,
      trainingDay,
      targets,
      totalsByDate.get(date),
      microsByDate.get(date),
      fluids &&
        dayFluids(fluids.profile, trainingDay, fluids.mlByDate.get(date)),
    );
  });
}
